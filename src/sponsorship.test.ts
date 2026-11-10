import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (access: string = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { prod: custodyEnvironment({ access }) } })
}
afterEach(() => harness?.cleanup())

describe.each([
  [
    'sponsorshipSetAsSponsor',
    { account: 'rSponsor', sponsee: 'rSponsee', flags: ['tfRequireSignForFee'], maxFee: '100' },
    {
      type: 'SponsorshipSetAsSponsor',
      sponsee: { type: 'Address', address: 'rSponsee' },
      flags: ['tfRequireSignForFee'],
      maxFee: '100',
    },
  ],
  [
    'sponsorshipSetAsSponsee',
    { account: 'rSponsee', sponsor: 'rSponsor' },
    { type: 'SponsorshipSetAsSponsee', sponsor: { type: 'Address', address: 'rSponsor' } },
  ],
])('%s', (tool, extra, operation) => {
  const input = { environment: 'prod', ...extra }

  it('refuses a write on a read Environment before touching the Backend', async () => {
    await setup('read')
    const result = await harness.call(tool, { ...input, dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'access-denied' } })
    expect(harness.adapter.connections).toEqual([])
  })

  it('maps to the native operation and stops at the Dry run by default', async () => {
    await setup()
    const result = await harness.call(tool, input)
    expect(result).toMatchObject({ dryRun: true, success: true })
    expect(harness.adapter.dryRuns[0].operation).toEqual(operation)
    expect(harness.adapter.proposals).toEqual([])
  })

  it('blocks the Propose when the Dry run fails, and Proposes when it succeeds', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['nope'] }
    expect(await harness.call(tool, { ...input, dryRun: false })).toMatchObject({ error: { code: 'dry-run-failed' } })
    expect(harness.adapter.proposals).toEqual([])
    harness.adapter.state.dryRunResult = { success: true, errors: [], estimatedFeeDrops: '12' }
    expect(await harness.call(tool, { ...input, dryRun: false })).toMatchObject({
      dryRun: false,
      intentId: 'intent-1',
    })
  })
})

describe('sponsorshipSetAsSponsor input', () => {
  it('rejects a negative maxFee', async () => {
    await setup()
    await expect(
      harness.call('sponsorshipSetAsSponsor', {
        environment: 'prod',
        account: 'rSponsor',
        sponsee: 'rSponsee',
        maxFee: '-5',
      }),
    ).rejects.toThrow(/maxFee/)
    expect(harness.adapter.dryRuns).toEqual([])
  })
})
