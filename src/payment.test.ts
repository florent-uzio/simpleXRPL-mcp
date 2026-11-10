import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (access: string = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { prod: custodyEnvironment({ access }) } })
}
afterEach(() => harness?.cleanup())

const ISSUANCE = '0000000000000000000000000000000000000000000000AA'
const base = { environment: 'prod', account: 'rSender', destination: 'rDestination' }
const toAddress = { type: 'Address', address: 'rDestination' }

describe('payment', () => {
  it('pays XRP: converts the XRP amount to drops and defaults to a Dry run', async () => {
    await setup()
    const result = await harness.call('payment', { ...base, amount: '10.5' })
    expect(result).toEqual({ environment: 'prod', dryRun: true, success: true, errors: [], estimatedFeeDrops: '12' })
    expect(harness.adapter.paymentDryRuns).toEqual([
      { account: 'rSender', operation: { type: 'Payment', destination: toAddress, amount: '10500000' } },
    ])
    expect(harness.adapter.paymentProposals).toEqual([])
  })

  it('pays an IOU: scales the decimal amount by 10^81, the integer unit Custody takes for IOUs', async () => {
    await setup()
    await harness.call('payment', {
      ...base,
      amount: '10.5',
      currency: { type: 'IOU', code: 'USD', issuer: 'rIssuer' },
    })
    expect(harness.adapter.paymentDryRuns[0].operation).toEqual({
      type: 'Payment',
      destination: toAddress,
      amount: '105' + '0'.repeat(80),
      currency: { type: 'Currency', code: 'USD', issuer: 'rIssuer' },
    })
  })

  it('pays an MPT: passes the amount in the smallest unit unchanged', async () => {
    await setup()
    await harness.call('payment', { ...base, amount: '1250', currency: { type: 'MPT', issuanceId: ISSUANCE } })
    expect(harness.adapter.paymentDryRuns[0].operation).toEqual({
      type: 'Payment',
      destination: toAddress,
      amount: '1250',
      currency: { type: 'MultiPurposeToken', issuanceId: ISSUANCE },
    })
  })

  it.each([
    ['XRP with more than 6 decimals', '1.1234567', undefined],
    ['XRP in scientific notation', '1e3', undefined],
    ['an IOU in scientific notation', '1e3', { type: 'IOU', code: 'USD', issuer: 'rIssuer' }],
    ['an IOU with more than 81 decimals', '0.' + '1'.repeat(82), { type: 'IOU', code: 'USD', issuer: 'rIssuer' }],
    ['a fractional MPT amount', '1.5', { type: 'MPT', issuanceId: ISSUANCE }],
    ['a negative ticker amount', '-3', { type: 'Ticker', tickerId: 't-1' }],
  ])('rejects %s before touching the Backend', async (_case, amount, currency) => {
    await setup()
    await expect(harness.call('payment', { ...base, amount, ...(currency && { currency }) })).rejects.toThrow(/amount/)
    expect(harness.adapter.paymentDryRuns).toEqual([])
  })

  it.each([
    ['a Custody account', { accountId: 'acc-1' }, { type: 'Account', accountId: 'acc-1' }],
    ['a Custody endpoint', { endpointId: 'end-1' }, { type: 'Endpoint', endpointId: 'end-1' }],
  ])('pays %s by its id', async (_case, destination, expected) => {
    await setup()
    await harness.call('payment', { ...base, amount: '1', destination })
    expect(harness.adapter.paymentDryRuns[0].operation.destination).toEqual(expected)
  })

  it('carries the optional Payment and order fields, with memos hex-encoded', async () => {
    await setup()
    await harness.call('payment', {
      ...base,
      amount: '1',
      destinationTag: 42,
      flags: ['tfSponsorCreatedAccount'],
      memos: [{ data: 'hi', format: 'text/plain' }],
      sourceTag: 7,
      ledgerId: 'xrpl-1',
      maximumFee: '5000',
      feeStrategy: { type: 'SpecifiedAdditionalFee', drops: '10' },
    })
    expect(harness.adapter.paymentDryRuns).toEqual([
      {
        account: 'rSender',
        ledgerId: 'xrpl-1',
        memos: [{ memoData: '6869', memoFormat: '746578742F706C61696E', memoType: undefined }],
        sourceTag: 7,
        maximumFee: '5000',
        feeStrategy: { type: 'SpecifiedAdditionalFee', drops: '10' },
        operation: {
          type: 'Payment',
          destination: toAddress,
          amount: '1000000',
          destinationTag: 42,
          flags: ['tfSponsorCreatedAccount'],
        },
      },
    ])
  })

  it('accepts a fee priority as the fee strategy', async () => {
    await setup()
    await harness.call('payment', { ...base, amount: '1', feeStrategy: { type: 'Priority', priority: 'High' } })
    expect(harness.adapter.paymentDryRuns[0].feeStrategy).toEqual({ type: 'Priority', priority: 'High' })
  })

  it('refuses a write on a read Environment before touching the Backend', async () => {
    await setup('read')
    const result = await harness.call('payment', { ...base, amount: '1', dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'access-denied' } })
    expect(harness.adapter.connections).toEqual([])
  })

  it('treats an omitted Environment as an input error', async () => {
    await setup()
    const { environment: _environment, ...withoutEnvironment } = base
    await expect(harness.call('payment', { ...withoutEnvironment, amount: '1' })).rejects.toThrow(/environment/)
    expect(harness.adapter.connections).toEqual([])
  })

  it('blocks the Propose when the Dry run fails', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['No funds'] }
    const result = await harness.call('payment', { ...base, amount: '1', dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'dry-run-failed' } })
    expect(JSON.stringify(result)).toMatch(/No funds/)
    expect(harness.adapter.paymentProposals).toEqual([])
  })

  it('Proposes the Dry-run order after a successful Dry run and returns the intentId at once', async () => {
    await setup()
    const result = await harness.call('payment', {
      ...base,
      amount: '1250',
      currency: { type: 'MPT', issuanceId: ISSUANCE },
      dryRun: false,
    })
    expect(result).toEqual({
      environment: 'prod',
      dryRun: false,
      intentId: 'payment-intent-1',
      estimatedFeeDrops: '12',
    })
    expect(harness.adapter.paymentProposals).toEqual(harness.adapter.paymentDryRuns)
  })

  it('pays a Custody ticker by its id, with the amount in its smallest unit', async () => {
    await setup()
    await harness.call('payment', { ...base, amount: '700', currency: { type: 'Ticker', tickerId: 't-1' } })
    expect(harness.adapter.paymentDryRuns[0].operation).toMatchObject({
      amount: '700',
      currency: { type: 'TickerId', tickerId: 't-1' },
    })
  })
})
