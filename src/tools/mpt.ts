import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { MptOrder } from '../backend/adapter'
import { ToolFailure, type Runtime } from '../environments/runtime'
import { encodeMptMetadata, mptMetadataSchema } from './mpt-metadata'

const hex = (text: string) => Buffer.from(text, 'utf8').toString('hex').toUpperCase()

const memoSchema = z.object({
  data: z.string().optional().describe('Memo text'),
  format: z.string().optional().describe('Memo format, e.g. text/plain'),
  type: z.string().optional().describe('Memo type, e.g. test'),
})

const common = {
  environment: z.string().describe('Environment name; required, a write never uses the default'),
  account: z.string().describe('Sending r-address, an account held in the Environment'),
  ledgerId: z.string().optional().describe('Ledger id, only when the address is on several ledgers'),
  memos: z.array(memoSchema).optional().describe('On-ledger memos, as plain text'),
  dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
}

export const issuanceId = z.string().describe('MPT issuance id (192-bit hex)')
const holder = z.string().describe('Holder r-address')
export const tokenIdentifier = (id: string) => ({ type: 'MPTokenIssuanceId' as const, issuanceId: id })
const holderAddress = (address: string) => ({ type: 'Address' as const, address })

type CommonInput = {
  environment: string
  account: string
  ledgerId?: string
  memos?: z.infer<typeof memoSchema>[]
  dryRun: boolean
}

export const createMptTool = <Shape extends z.ZodRawShape>(
  runtime: Runtime,
  options: {
    id: string
    description: string
    shape: Shape
    operation: (input: z.infer<z.ZodObject<Shape>>) => MptOrder['operation']
  },
) =>
  createTool({
    id: options.id,
    description: `${options.description} Runs a Dry run first and, by default, stops there, returning the fee estimate. With \`dryRun: false\` it Proposes after a successful Dry run and returns the \`intentId\` at once; approvers act later. Needs the \`propose\` Access level and a named Environment.`,
    inputSchema: z.object({ ...common, ...options.shape }),
    execute: raw => {
      const input = raw as CommonInput & z.infer<z.ZodObject<Shape>>
      const {
        environment: _environment,
        account: _account,
        ledgerId: _ledgerId,
        memos: _memos,
        dryRun,
        ...rest
      } = input
      return runtime.run({ environment: input.environment, requires: 'propose' }, async backend => {
        const order: MptOrder = {
          account: input.account,
          ledgerId: input.ledgerId,
          memos: input.memos?.map(memo => ({
            memoData: memo.data === undefined ? undefined : hex(memo.data),
            memoFormat: memo.format === undefined ? undefined : hex(memo.format),
            memoType: memo.type === undefined ? undefined : hex(memo.type),
          })),
          operation: options.operation(rest as unknown as z.infer<z.ZodObject<Shape>>),
        }
        const check = await backend.dryRunMpt(order)
        if (dryRun) return { dryRun: true as const, ...check }
        if (!check.success) {
          throw new ToolFailure(
            'dry-run-failed',
            `The Dry run failed, nothing was proposed: ${check.errors.join('; ')}`,
          )
        }
        const { intentId } = await backend.proposeMpt(order)
        return { dryRun: false as const, intentId, estimatedFeeDrops: check.estimatedFeeDrops }
      })
    },
  })

export const createMptIssuanceCreate = (runtime: Runtime) =>
  createMptTool(runtime, {
    id: 'mptIssuanceCreate',
    description: 'Creates an MPT issuance (MPTokenIssuanceCreate) from the sending account, with XLS-89 metadata.',
    shape: {
      flags: z
        .array(
          z.enum([
            'tfMPTRequireAuth',
            'tfMPTCanClawback',
            'tfMPTCanTransfer',
            'tfMPTCanEscrow',
            'tfMPTCanLock',
            'tfMPTCanTrade',
            'tfMPTCanConfidentialAmount',
          ]),
        )
        .default([])
        .describe('Issuance flags'),
      assetScale: z.number().int().min(0).max(19).optional().describe('Decimal places of one unit'),
      transferFee: z
        .number()
        .int()
        .min(0)
        .max(50000)
        .optional()
        .describe('Transfer fee in 1/100,000ths; needs tfMPTCanTransfer'),
      maximumAmount: z
        .string()
        .regex(/^\d+$/, 'an unsigned integer string')
        .optional()
        .describe('Maximum supply, in the smallest unit'),
      metadata: mptMetadataSchema.optional().describe('XLS-89 token metadata, encoded for you'),
    },
    operation: ({ metadata, ...rest }) => ({
      type: 'MPTokenIssuanceCreate',
      ...rest,
      ...(metadata && { metadata: { type: 'HexEncodedMetadata' as const, value: encodeMptMetadata(metadata) } }),
    }),
  })

export const createMptAuthorize = (runtime: Runtime) =>
  createMptTool(runtime, {
    id: 'mptAuthorize',
    description:
      'Authorizes (MPTokenAuthorize) an MPT: a holder opts in to an issuance, or, with `holder`, the issuer authorizes that holder. `tfMPTUnauthorize` reverses it.',
    shape: {
      issuanceId,
      holder: holder.optional().describe('Holder to authorize, when the sending account is the issuer'),
      flags: z.array(z.literal('tfMPTUnauthorize')).default([]),
    },
    operation: ({ issuanceId: id, holder: address, flags }) => ({
      type: 'MPTokenAuthorize',
      tokenIdentifier: tokenIdentifier(id),
      flags,
      ...(address && { holder: holderAddress(address) }),
    }),
  })

export const createMptIssuanceSet = (runtime: Runtime) =>
  createMptTool(runtime, {
    id: 'mptIssuanceSet',
    description:
      'Updates an MPT issuance (MPTokenIssuanceSet): lock or unlock it or one holder, or enable confidential balances with encryption keys.',
    shape: {
      issuanceId,
      holder: holder.optional().describe('Holder to lock or unlock; omit for the whole issuance'),
      flags: z.array(z.enum(['tfMPTLock', 'tfMPTUnlock'])).default([]),
      mutableFlags: z.array(z.literal('MPTSetCanConfidentialAmount')).default([]),
      issuerEncryptionKey: z.string().optional().describe("The issuer's base64 ElGamal public key"),
      auditorEncryptionKey: z.string().optional().describe("The auditor's base64 ElGamal public key"),
    },
    operation: ({ issuanceId: id, holder: address, ...rest }) => ({
      type: 'MPTokenIssuanceSet',
      tokenIdentifier: tokenIdentifier(id),
      ...rest,
      ...(address && { holder: holderAddress(address) }),
    }),
  })

export const createMptIssuanceDestroy = (runtime: Runtime) =>
  createMptTool(runtime, {
    id: 'mptIssuanceDestroy',
    description: 'Destroys an MPT issuance (MPTokenIssuanceDestroy); only possible with no tokens outstanding.',
    shape: { issuanceId },
    operation: ({ issuanceId: id }) => ({ type: 'MPTokenIssuanceDestroy', tokenIdentifier: tokenIdentifier(id) }),
  })
