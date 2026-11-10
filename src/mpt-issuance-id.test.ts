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
    harness.adapter.state.issuanceId = '002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3'
    expect(await harness.call('getMptIssuanceId', { intentId: 'i-1' })).toEqual({
      environment: 'dev',
      intentId: 'i-1',
      issuanceId: '002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3',
    })
    expect(harness.adapter.issuanceLookups).toEqual([{ intentId: 'i-1', domainId: 'd-9' }])
  })

  it('uses the only domain of the user when no domain is configured', async () => {
    await setup()
    await harness.call('getMptIssuanceId', { intentId: 'i-1' })
    expect(harness.adapter.issuanceLookups).toEqual([{ intentId: 'i-1', domainId: 'd-1' }])
  })

  it('uses the domainId it is given', async () => {
    await setup(custodyEnvironment({ domainId: 'd-9' }))
    await harness.call('getMptIssuanceId', { intentId: 'i-1', domainId: 'd-2' })
    expect(harness.adapter.issuanceLookups).toEqual([{ intentId: 'i-1', domainId: 'd-2' }])
  })

  it('shapes a missing issuance as an error', async () => {
    await setup()
    harness.adapter.state.issuanceId = new Error('Intent i-1 carries no MPT issuance ID yet.')
    expect(await harness.call('getMptIssuanceId', { intentId: 'i-1' })).toEqual({
      environment: 'dev',
      error: { code: 'backend-error', message: 'Intent i-1 carries no MPT issuance ID yet.' },
    })
  })
})
