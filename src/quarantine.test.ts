import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>

const setup = async (access: string = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { prod: custodyEnvironment({ domainId: 'd-1', access }) } })
}
beforeEach(() => setup())
afterEach(() => harness.cleanup())

const base = { environment: 'prod', account: 'rAlice', transferIds: ['t-1', 't-2'] }

describe('releaseQuarantinedTransfers', () => {
  it('stops at the Dry run by default', async () => {
    expect(await harness.call('releaseQuarantinedTransfers', base)).toEqual({
      environment: 'prod',
      dryRun: true,
      success: true,
      errors: [],
    })
    expect(harness.adapter.releases).toEqual([{ step: 'dryRun', account: 'rAlice', transferIds: ['t-1', 't-2'] }])
  })

  it('proposes after a successful Dry run and returns the intentId at once', async () => {
    expect(await harness.call('releaseQuarantinedTransfers', { ...base, dryRun: false })).toEqual({
      environment: 'prod',
      dryRun: false,
      intentId: 'release-1',
    })
    expect(harness.adapter.releases.map(release => release.step)).toEqual(['dryRun', 'propose'])
  })

  it('proposes nothing when the Dry run fails', async () => {
    harness.adapter.state.releaseDryRun = { success: false, errors: ['Unknown transfer t-2'] }
    expect(await harness.call('releaseQuarantinedTransfers', { ...base, dryRun: false })).toMatchObject({
      error: { code: 'dry-run-failed', message: expect.stringContaining('Unknown transfer t-2') },
    })
    expect(harness.adapter.releases.map(release => release.step)).toEqual(['dryRun'])
  })

  it('needs the propose Access level', async () => {
    await harness.cleanup()
    await setup('read')
    expect(await harness.call('releaseQuarantinedTransfers', base)).toMatchObject({
      error: { message: expect.stringContaining('propose') },
    })
    expect(harness.adapter.releases).toEqual([])
  })

  it('refuses an empty list of transfers', async () => {
    await expect(harness.call('releaseQuarantinedTransfers', { ...base, transferIds: [] })).rejects.toThrow()
  })
})

describe('listQuarantinedTransfers', () => {
  it("lists an account's quarantined transfers in the default domain", async () => {
    harness.adapter.state.quarantined = [
      { id: 't-1', tickerId: 'tk-1', value: '1000', registeredAt: '2026-11-11T00:00:00Z' },
    ]
    expect(await harness.call('listQuarantinedTransfers', { account: 'rAlice' })).toEqual({
      environment: 'prod',
      transfers: harness.adapter.state.quarantined,
    })
    expect(harness.adapter.quarantineLookups).toEqual([{ account: 'rAlice', domainId: 'd-1' }])
  })
})
