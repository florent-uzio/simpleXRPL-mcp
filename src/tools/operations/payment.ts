import { xrpToDrops } from 'xrpl'
import { z } from 'zod'
import { issuanceId } from './mpt'
import { defineOperation } from './operation'

// Custody takes an IOU amount as an integer: the decimal value times 10^81, which it divides back before signing.
const IOU_SCALE = 81
const scaleIou = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.')
  return (whole + fraction.padEnd(IOU_SCALE, '0')).replace(/^0+(?=\d)/, '')
}

/** What a Payment pays. */
export const paymentCurrency = z.discriminatedUnion('type', [
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

type Currency = z.infer<typeof paymentCurrency>

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
  XRP: { pattern: /^\d+(\.\d{1,6})?$/, message: 'a positive decimal XRP amount with at most 6 decimal places' },
  IOU: {
    pattern: new RegExp(`^\\d+(\\.\\d{1,${IOU_SCALE}})?$`),
    message: `a positive decimal amount with at most ${IOU_SCALE} decimal places`,
  },
  MPT: { pattern: /^\d+$/, message: "a positive integer in the token's smallest unit" },
  Ticker: { pattern: /^\d+$/, message: "a positive integer in the ticker's smallest unit" },
}
// Custody refuses a zero amount; catch it here rather than in the Dry run.
const isPositive = (amount: string) => /[1-9]/.test(amount)

/** Refines a Payment's fields: the amount must be positive and in the unit of the currency it pays. */
export const checkPaymentAmount = (
  { amount, currency }: { amount: string; currency: Currency },
  context: z.RefinementCtx,
) => {
  const format = amountFormats[currency.type]
  if (!format.pattern.test(amount) || !isPositive(amount))
    context.addIssue({ code: 'custom', path: ['amount'], message: format.message })
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

export const PAYMENT_AMOUNT_UNITS =
  'The amount unit depends on `currency`: decimal XRP; a decimal IOU amount (scaled by 10^81 for Custody); an integer in the smallest unit for an MPT or a ticker.'

export const payment = defineOperation({
  shape: {
    destination,
    amount: z
      .string()
      .describe(
        "Amount as a string: decimal XRP for XRP (e.g. '0.25'), a decimal for an IOU (e.g. '10.5'), the smallest unit for an MPT or a ticker (e.g. '1250')",
      ),
    currency: paymentCurrency.default({ type: 'XRP' }).describe('What is paid; XRP when omitted'),
    destinationTag: z.number().int().min(0).max(4294967295).optional().describe('XRPL DestinationTag'),
    flags: z
      .array(z.literal('tfSponsorCreatedAccount'))
      .optional()
      .describe(
        'Payment flags. `tfSponsorCreatedAccount` only works with an XLS-68 sponsor, which this server cannot attach yet',
      ),
  },
  operation: input => ({
    type: 'Payment',
    destination: toDestination(input.destination),
    ...toAmountAndCurrency(input.amount, input.currency),
    ...(input.destinationTag !== undefined && { destinationTag: input.destinationTag }),
    ...(input.flags && { flags: input.flags }),
  }),
})
