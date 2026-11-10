import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (environment = custodyEnvironment()) => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { dev: environment } })
}
afterEach(() => harness?.cleanup())

describe('getMptIssuanceId', () => {
  it("returns the issuance ID an executed Intent created, looked up in the Environment's default domain", async () => {
    await setup(custodyEnvironment({ domainId: 'd-9' }))
    harness.adapter.state.issuance = { issuanceId: '002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3' }
    expect(await harness.call('getMptIssuanceId', { intentId: 'i-1' })).toEqual({
      environment: 'dev',
      intentId: 'i-1',
      issuanceId: '002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3',
    })
    expect(harness.adapter.issuanceLookups).toEqual([{ intentId: 'i-1', domainId: 'd-9', timeoutMs: undefined }])
  })

  it('uses the only domain of the user when no domain is configured', async () => {
    await setup()
    await harness.call('getMptIssuanceId', { intentId: 'i-1' })
    expect(harness.adapter.issuanceLookups).toMatchObject([{ intentId: 'i-1', domainId: 'd-1' }])
  })

  it('uses the domainId it is given', async () => {
    await setup(custodyEnvironment({ domainId: 'd-9' }))
    await harness.call('getMptIssuanceId', { intentId: 'i-1', domainId: 'd-2' })
    expect(harness.adapter.issuanceLookups).toMatchObject([{ intentId: 'i-1', domainId: 'd-2' }])
  })

  it('passes the wait to the Backend in milliseconds, 0 for a single look', async () => {
    await setup()
    await harness.call('getMptIssuanceId', { intentId: 'i-1', timeoutSeconds: 5 })
    await harness.call('getMptIssuanceId', { intentId: 'i-1', timeoutSeconds: 0 })
    expect(harness.adapter.issuanceLookups.map(lookup => lookup.timeoutMs)).toEqual([5000, 0])
  })

  it('reports an issuance not recorded yet as an answer, not an error', async () => {
    await setup()
    harness.adapter.state.issuance = { reason: 'No transaction is registered yet for Intent i-1.' }
    const result = await harness.call('getMptIssuanceId', { intentId: 'i-1' })
    expect(result).toEqual({
      environment: 'dev',
      intentId: 'i-1',
      reason: 'No transaction is registered yet for Intent i-1.',
    })
  })

  it('shapes an Intent that created no issuance as an error', async () => {
    await setup()
    harness.adapter.state.issuance = new Error(
      'Intent i-1 is not an MPTokenIssuanceCreate: its transaction is Payment.',
    )
    expect(await harness.call('getMptIssuanceId', { intentId: 'i-1' })).toEqual({
      environment: 'dev',
      error: {
        code: 'backend-error',
        message: 'Intent i-1 is not an MPTokenIssuanceCreate: its transaction is Payment.',
      },
    })
  })
})
