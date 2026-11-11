import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { NativeOrder } from '../backend/adapter'
import type { Runtime } from '../environments/runtime'
import { dryRunThenPropose, memoSchema, toMemos } from './native-write'
import { mptAuthorize, mptIssuanceCreate, mptIssuanceDestroy, mptIssuanceSet } from './operations/mpt'
import { checkPaymentAmount, paymentCurrency, payment } from './operations/payment'

type BatchOrder = NativeOrder<'Batch'>

const sequencing = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('AccountSequence'), value: z.number().int().min(0) }),
    z.object({ type: z.literal('Ticket'), value: z.number().int().min(0) }),
    z.object({ type: z.literal('PlatformManaged') }),
  ])
  .describe('How the transaction is sequenced; `PlatformManaged` lets Custody pick the Account Sequence')

// Each entry operation takes the same input, in the same units, as its standalone tool.
const innerOperation = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('Payment'),
      ...payment.shape,
      // Required here: an old entry gave the amount in drops with no `currency`, and must not pass as decimal XRP.
      currency: paymentCurrency.describe('What is paid'),
    })
    .superRefine(checkPaymentAmount),
  z.object({ type: z.literal('MPTokenAuthorize'), ...mptAuthorize.shape }),
  z.object({ type: z.literal('MPTokenIssuanceCreate'), ...mptIssuanceCreate.shape }),
  z.object({ type: z.literal('MPTokenIssuanceSet'), ...mptIssuanceSet.shape }),
  z.object({ type: z.literal('MPTokenIssuanceDestroy'), ...mptIssuanceDestroy.shape }),
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

// Each builder reads only its own fields, so the entry operation is passed whole.
const toOperation = (operation: Entry['operation']) => {
  switch (operation.type) {
    case 'Payment':
      return payment.operation(operation)
    case 'MPTokenAuthorize':
      return mptAuthorize.operation(operation)
    case 'MPTokenIssuanceCreate':
      return mptIssuanceCreate.operation(operation)
    case 'MPTokenIssuanceSet':
      return mptIssuanceSet.operation(operation)
    case 'MPTokenIssuanceDestroy':
      return mptIssuanceDestroy.operation(operation)
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
      'Runs a Dry run of a Batch (XLS-56) without proposing it. Each entry operation takes the same input, in the same units, as its standalone tool (`payment`, `mptAuthorize`, `mptIssuanceCreate`, `mptIssuanceSet`, `mptIssuanceDestroy`), except that a Payment entry must name its `currency`. Returns the fee estimate and `signers`: one entry per account that must sign, each with the `signingPayload` to sign. Signing is not done by this server yet: sign each payload elsewhere and pass the result to `proposeBatch` as `batchSigners`.',
    inputSchema: z.object(batchShape),
    execute: raw =>
      runtime.run({ environment: raw.environment, requires: 'read' }, async backend => {
        const check = await backend.dryRun(toOrder(raw as BatchInput, []))
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
      dryRunThenPropose(runtime, raw, () =>
        toOrder(
          raw as BatchInput,
          raw.batchSigners.map(({ participant, publicKey, signature }) => ({
            participant: { type: 'Address' as const, address: participant },
            publicKey,
            signature,
          })),
        ),
      ),
  })
