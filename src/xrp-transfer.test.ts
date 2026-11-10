import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (access: string = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { prod: custodyEnvironment({ access }) } })
}
afterEach(() => harness?.cleanup())

const transfer = { environment: 'prod', to: 'rDestination', amount: '10.5', from: 'rSource' }
// The Native operation order the transfer becomes: the amount in drops, sent from `from`.
const order = {
  account: 'rSource',
  operation: { type: 'Payment', destination: { type: 'Address', address: 'rDestination' }, amount: '10500000' },
}

describe('xrpTransfer', () => {
  it('refuses a write on a read Environment before touching the Backend', async () => {
    await setup('read')
    const result = await harness.call('xrpTransfer', { ...transfer, dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'access-denied' } })
    expect(harness.adapter.connections).toEqual([])
  })

  it('treats an omitted Environment as an input error, even when a default exists', async () => {
    await setup()
    await expect(harness.call('xrpTransfer', { to: 'rDestination', amount: '1', from: 'rSource' })).rejects.toThrow(
      /environment/,
    )
    expect(harness.adapter.connections).toEqual([])
    expect(harness.adapter.dryRuns).toEqual([])
  })

  it('requires a source address', async () => {
    await setup()
    const { from: _from, ...withoutFrom } = transfer
    await expect(harness.call('xrpTransfer', withoutFrom)).rejects.toThrow(/from/)
    expect(harness.adapter.dryRuns).toEqual([])
  })

  it('rejects an amount that is not a valid XRP amount', async () => {
    await setup()
    await expect(harness.call('xrpTransfer', { ...transfer, amount: '1.1234567' })).rejects.toThrow(/amount/)
    expect(harness.adapter.dryRuns).toEqual([])
  })

  it('defaults to a Dry run: returns the fee estimate and proposes nothing', async () => {
    await setup()
    const result = await harness.call('xrpTransfer', transfer)
    expect(result).toEqual({ environment: 'prod', dryRun: true, success: true, errors: [], estimatedFeeDrops: '12' })
    expect(harness.adapter.dryRuns).toEqual([order])
    expect(harness.adapter.proposals).toEqual([])
  })

  it('reports a failed Dry run as a result when only a Dry run was asked for', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['insufficient balance'] }
    const result = await harness.call('xrpTransfer', transfer)
    expect(result).toMatchObject({ dryRun: true, success: false, errors: ['insufficient balance'] })
  })

  it('blocks the Propose when the Dry run fails', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['insufficient balance'] }
    const result = await harness.call('xrpTransfer', { ...transfer, dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'dry-run-failed' } })
    expect(JSON.stringify(result)).toMatch(/insufficient balance/)
    expect(harness.adapter.proposals).toEqual([])
  })

  it('Proposes after a successful Dry run and returns the intentId at once', async () => {
    await setup()
    const result = await harness.call('xrpTransfer', { ...transfer, dryRun: false })
    expect(result).toEqual({ environment: 'prod', dryRun: false, intentId: 'intent-1', estimatedFeeDrops: '12' })
    // The Propose sends the very order the Dry run checked.
    expect(harness.adapter.proposals).toEqual([order])
    expect(harness.adapter.proposals).toEqual(harness.adapter.dryRuns)
  })
})
