import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { BatchOrder } from '../backend/adapter'
import { ToolFailure, type Runtime } from '../environments/runtime'
import { memoSchema, toMemos } from './mpt'

const sequencing = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('AccountSequence'), value: z.number().int().min(0) }),
    z.object({ type: z.literal('Ticket'), value: z.number().int().min(0) }),
    z.object({ type: z.literal('PlatformManaged') }),
  ])
  .describe('How the transaction is sequenced; `PlatformManaged` lets Custody pick the Account Sequence')

const innerOperation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('Payment'),
    destination: z.string().describe('Destination r-address'),
    amount: z.string().describe('Drops for XRP, else the MPT amount in its smallest unit'),
    issuanceId: z.string().optional().describe('MPT issuance id; omit to pay XRP'),
    destinationTag: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('MPTokenAuthorize'),
    issuanceId: z.string(),
    holder: z.string().optional().describe('Holder r-address, when the entry sender is the issuer'),
    flags: z.array(z.literal('tfMPTUnauthorize')).default([]),
  }),
  z.object({ type: z.literal('TicketCreate'), ticketCount: z.number().int().min(1).max(250) }),
])

const entry = z
  .object({
    participant: z
      .string()
      .optional()
      .describe("r-address of the account this entry is sent from; omit for an entry from the Batch's own submitter"),
    operation: innerOperation,
    sequencing,
  })
  .refine(item => item.participant === undefined || item.sequencing.type !== 'PlatformManaged', {
    message: 'a participant entry cannot use PlatformManaged sequencing',
    path: ['sequencing'],
  })

const batchShape = {
  environment: z.string().describe('Environment name'),
  account: z.string().describe("The Batch submitter's r-address, an account held in the Environment"),
  ledgerId: z.string().optional().describe('Ledger id, only when the address is on several ledgers'),
  memos: memoSchema.array().optional().describe('On-ledger memos for the outer Batch, as plain text'),
  executionMode: z.enum(['AllOrNothing', 'OnlyOne', 'UntilFailure', 'Independent']),
  sequencing: sequencing.default({ type: 'PlatformManaged' }),
  lastLedgerSequence: z.number().int().optional(),
  entries: z.array(entry).min(2).max(8).describe('The inner transactions, 2 to 8'),
}

type Entry = z.infer<typeof entry>
type BatchInput = {
  account: string
  ledgerId?: string
  memos?: z.infer<typeof memoSchema>[]
  executionMode: BatchOrder['operation']['executionMode']
  sequencing: BatchOrder['operation']['sequencing']
  lastLedgerSequence?: number
  entries: Entry[]
}

const toOperation = (operation: Entry['operation']) => {
  switch (operation.type) {
    case 'Payment':
      return {
        type: 'Payment' as const,
        destination: { type: 'Address' as const, address: operation.destination },
        amount: operation.amount,
        ...(operation.issuanceId && {
          currency: { type: 'MultiPurposeToken' as const, issuanceId: operation.issuanceId },
        }),
        ...(operation.destinationTag !== undefined && { destinationTag: operation.destinationTag }),
      }
    case 'MPTokenAuthorize':
      return {
        type: 'MPTokenAuthorize' as const,
        tokenIdentifier: { type: 'MPTokenIssuanceId' as const, issuanceId: operation.issuanceId },
        flags: operation.flags,
        ...(operation.holder && { holder: { type: 'Address' as const, address: operation.holder } }),
      }
    case 'TicketCreate':
      return operation
  }
}

const toOrder = (input: BatchInput, batchSigners: BatchOrder['operation']['batchSigners']): BatchOrder => ({
  account: input.account,
  ledgerId: input.ledgerId,
  memos: toMemos(input.memos),
  operation: {
    type: 'Batch',
    executionMode: input.executionMode,
    sequencing: input.sequencing,
    lastLedgerSequence: input.lastLedgerSequence,
    batchSigners,
    entries: input.entries.map(({ participant, operation, sequencing }) =>
      participant === undefined
        ? { type: 'SubmitterOperation' as const, operation: toOperation(operation), sequencing }
        : {
            type: 'ParticipantOperation' as const,
            participant: { type: 'Address' as const, address: participant },
            operation: toOperation(operation),
            // A participant entry is sequenced by Account Sequence or Ticket only; the schema refuses PlatformManaged above.
            sequencing: sequencing as { type: 'AccountSequence' | 'Ticket'; value: number },
          },
    ),
  },
})

export const createDryRunBatch = (runtime: Runtime) =>
  createTool({
    id: 'dryRunBatch',
    description:
      'Runs a Dry run of a Batch (XLS-56) without proposing it. Returns the fee estimate and `signers`: one entry per account that must sign, each with the `signingPayload` to sign. Signing is not done by this server yet: sign each payload elsewhere and pass the result to `proposeBatch` as `batchSigners`.',
    inputSchema: z.object(batchShape),
    execute: raw =>
      runtime.run({ environment: raw.environment, requires: 'read' }, async backend => {
        const check = await backend.dryRunBatch(toOrder(raw as BatchInput, []))
        return { dryRun: true as const, ...check }
      }),
  })

export const createProposeBatch = (runtime: Runtime) =>
  createTool({
    id: 'proposeBatch',
    description:
      'Proposes a Batch (XLS-56) with the `batchSigners` the signers returned. Runs a Dry run first and, by default, stops there; with `dryRun: false` it Proposes after a successful Dry run and returns the `intentId` at once; approvers act later. Needs the `propose` Access level and a named Environment. Pass the same Batch input as `dryRunBatch`.',
    inputSchema: z.object({
      ...batchShape,
      batchSigners: z
        .array(
          z.object({
            participant: z.string().describe('r-address of the signer'),
            publicKey: z.string().describe('Signer public key, hex'),
            signature: z.string().describe("Signature of the signer's `signingPayload`, hex"),
          }),
        )
        .default([])
        .describe('One per account from `dryRunBatch` `signers`; empty when none are needed'),
      dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
    }),
    execute: raw =>
      runtime.run({ environment: raw.environment, requires: 'propose' }, async backend => {
        const order = toOrder(
          raw as BatchInput,
          raw.batchSigners.map(({ participant, publicKey, signature }) => ({
            participant: { type: 'Address' as const, address: participant },
            publicKey,
            signature,
          })),
        )
        const check = await backend.dryRunBatch(order)
        if (raw.dryRun) return { dryRun: true as const, ...check }
        if (!check.success) {
          throw new ToolFailure(
            'dry-run-failed',
            `The Dry run failed, nothing was proposed: ${check.errors.join('; ')}`,
          )
        }
        const { intentId } = await backend.proposeBatch(order)
        return { dryRun: false as const, intentId, estimatedFeeDrops: check.estimatedFeeDrops }
      }),
  })
