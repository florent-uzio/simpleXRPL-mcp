import { createTool } from '@mastra/core/tools'
import { xrpToDrops } from 'xrpl'
import { z } from 'zod'
import type { PaymentOrder } from '../backend/adapter'
import { ToolFailure, type Runtime } from '../environments/runtime'
import { issuanceId, memoSchema, toMemos } from './mpt'

// Custody takes an IOU amount as an integer: the decimal value times 10^81, which it divides back before signing.
const IOU_SCALE = 81
const scaleIou = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.')
  return (whole + fraction.padEnd(IOU_SCALE, '0')).replace(/^0+(?=\d)/, '')
}

const currency = z.discriminatedUnion('type', [
  z.object({ type: z.literal('XRP') }),
  z.object({
    type: z.literal('IOU'),
    code: z.string().describe("Currency code: 3 characters, e.g. 'USD', or 40 hex characters"),
    issuer: z.string().describe('Issuer r-address'),
  }),
  z.object({ type: z.literal('MPT'), issuanceId }),
  z.object({
    type: z.literal('Ticker'),
    tickerId: z.string().describe('Custody ticker id; its `decimals` set the smallest unit'),
  }),
])

type Currency = z.infer<typeof currency>

const destination = z
  .union([
    z.string().describe('Destination r-address'),
    z.object({ accountId: z.string().describe('Custody account id') }),
    z.object({ endpointId: z.string().describe('Custody endpoint id') }),
  ])
  .describe('Who is paid: an r-address, or a Custody account or endpoint by its id')

const toDestination = (to: z.infer<typeof destination>) =>
  typeof to === 'string'
    ? { type: 'Address' as const, address: to }
    : 'accountId' in to
      ? { type: 'Account' as const, accountId: to.accountId }
      : { type: 'Endpoint' as const, endpointId: to.endpointId }

// Each currency has its own amount unit, so the amount is checked against the currency it pays.
const amountFormats: Record<Currency['type'], { pattern: RegExp; message: string }> = {
  XRP: { pattern: /^\d+(\.\d{1,6})?$/, message: 'a non-negative decimal XRP amount with at most 6 decimal places' },
  IOU: { pattern: /^\d+(\.\d{1,81})?$/, message: 'a non-negative decimal amount with at most 81 decimal places' },
  MPT: { pattern: /^\d+$/, message: "an unsigned integer in the token's smallest unit" },
  Ticker: { pattern: /^\d+$/, message: "an unsigned integer in the ticker's smallest unit" },
}

const toAmountAndCurrency = (amount: string, paid: Currency) => {
  switch (paid.type) {
    case 'XRP':
      return { amount: xrpToDrops(amount) }
    case 'IOU':
      return {
        amount: scaleIou(amount),
        currency: { type: 'Currency' as const, code: paid.code, issuer: paid.issuer },
      }
    case 'MPT':
      return { amount, currency: { type: 'MultiPurposeToken' as const, issuanceId: paid.issuanceId } }
    case 'Ticker':
      return { amount, currency: { type: 'TickerId' as const, tickerId: paid.tickerId } }
  }
}

export const createPayment = (runtime: Runtime) =>
  createTool({
    id: 'payment',
    description:
      'Proposes a Payment of XRP, an IOU, an MPT or a Custody ticker. The amount unit depends on `currency`: decimal XRP; a decimal IOU amount (scaled by 10^81 for Custody); an integer in the smallest unit for an MPT or a ticker. For an IOU the destination must hold a trust line to the issuer; for an MPT it must have run `mptAuthorize` (and be authorized by the issuer, when the issuance requires auth); the Dry run may not catch a missing one. The issuer paying out mints; a holder paying the issuer burns. Runs a Dry run first and, by default, stops there, returning the fee estimate. With `dryRun: false` it Proposes after a successful Dry run and returns the `intentId` at once; approvers act later. Needs the `propose` Access level and a named Environment.',
    inputSchema: z
      .object({
        environment: z.string().describe('Environment name; required, a write never uses the default'),
        account: z.string().describe('Sending r-address, an account held in the Environment'),
        destination,
        amount: z
          .string()
          .describe(
            "Amount as a string: decimal XRP for XRP (e.g. '0.25'), a decimal for an IOU (e.g. '10.5'), the smallest unit for an MPT or a ticker (e.g. '1250')",
          ),
        currency: currency.default({ type: 'XRP' }).describe('What is paid; XRP when omitted'),
        destinationTag: z.number().int().min(0).max(4294967295).optional().describe('XRPL DestinationTag'),
        flags: z
          .array(z.literal('tfSponsorCreatedAccount'))
          .optional()
          .describe(
            'Payment flags. `tfSponsorCreatedAccount` only works with an XLS-68 sponsor, which this server cannot attach yet',
          ),
        memos: z.array(memoSchema).optional().describe('On-ledger memos, as plain text'),
        sourceTag: z.number().int().min(0).max(4294967295).optional().describe('XRPL SourceTag'),
        ledgerId: z.string().optional().describe('Ledger id, only when the address is on several ledgers'),
        maximumFee: z
          .string()
          .regex(/^\d+$/, 'an unsigned integer string')
          .optional()
          .describe('Highest fee, in drops'),
        feeStrategy: z
          .discriminatedUnion('type', [
            z.object({ type: z.literal('Priority'), priority: z.enum(['Low', 'Medium', 'High']) }),
            z.object({
              type: z.literal('SpecifiedAdditionalFee'),
              drops: z.string().regex(/^\d+$/, 'an unsigned integer string'),
            }),
          ])
          .optional()
          .describe("How Custody sets the fee; Priority 'Low' when omitted"),
        dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
      })
      .superRefine(({ amount, currency: paid }, context) => {
        const format = amountFormats[paid.type]
        if (!format.pattern.test(amount))
          context.addIssue({ code: 'custom', path: ['amount'], message: format.message })
      }),
    execute: input =>
      runtime.run({ environment: input.environment, requires: 'propose' }, async backend => {
        const order: PaymentOrder = {
          account: input.account,
          ledgerId: input.ledgerId,
          memos: toMemos(input.memos),
          sourceTag: input.sourceTag,
          maximumFee: input.maximumFee,
          feeStrategy: input.feeStrategy,
          operation: {
            type: 'Payment',
            destination: toDestination(input.destination),
            ...toAmountAndCurrency(input.amount, input.currency),
            ...(input.destinationTag !== undefined && { destinationTag: input.destinationTag }),
            ...(input.flags && { flags: input.flags }),
          },
        }
        const check = await backend.dryRunPayment(order)
        if (input.dryRun) return { dryRun: true as const, ...check }
        if (!check.success) {
          throw new ToolFailure(
            'dry-run-failed',
            `The Dry run failed, nothing was proposed: ${check.errors.join('; ')}`,
          )
        }
        const { intentId } = await backend.proposePayment(order)
        return { dryRun: false as const, intentId, estimatedFeeDrops: check.estimatedFeeDrops }
      }),
  })
