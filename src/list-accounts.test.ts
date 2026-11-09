import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'
import { fakeAccounts } from './testing/fake-adapter'

let harness: Awaited<ReturnType<typeof createHarness>>

beforeEach(async () => {
  harness = await createHarness({ TEST_KEY: 'pem' })
})
afterEach(() => harness.cleanup())

describe('listAccounts', () => {
  it('pages with a cursor that is omitted on the last page', async () => {
    await harness.writeConfig({ environments: { prod: custodyEnvironment({ domainId: 'd-1' }) } })
    const first = await harness.call('listAccounts', { limit: 3 })
    expect(first).toEqual({ environment: 'prod', accounts: fakeAccounts.slice(0, 3), nextCursor: '3' })
    const last = (await harness.call('listAccounts', { limit: 3, cursor: '3' })) as Record<string, unknown>
    expect(last.accounts).toEqual(fakeAccounts.slice(3))
    expect(last).not.toHaveProperty('nextCursor')
  })

  it("uses the Environment's default domain, or an explicit one", async () => {
    await harness.writeConfig({ environments: { prod: custodyEnvironment({ domainId: 'd-9' }) } })
    await harness.call('listAccounts')
    await harness.call('listAccounts', { domainId: 'd-2' })
    expect(harness.adapter.listCalls.map(call => call.domainId)).toEqual(['d-9', 'd-2'])
  })

  it("falls back to the user's only domain", async () => {
    await harness.writeConfig({ environments: { prod: custodyEnvironment() } })
    await harness.call('listAccounts')
    expect(harness.adapter.listCalls[0].domainId).toBe('d-1')
  })

  it('errors clearly when the domain is ambiguous', async () => {
    harness.adapter.setDomains(['d-1', 'd-2'])
    await harness.writeConfig({ environments: { prod: custodyEnvironment() } })
    expect(await harness.call('listAccounts')).toMatchObject({
      environment: 'prod',
      error: { code: 'domain-required', message: expect.stringContaining('domainId') },
    })
  })
})
