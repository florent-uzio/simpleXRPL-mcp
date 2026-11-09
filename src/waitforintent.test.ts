import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async () => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { dev: custodyEnvironment() } })
}
afterEach(() => harness?.cleanup())

describe('waitForIntent', () => {
  it('reports an executed Intent as terminal and successful', async () => {
    await setup()
    const result = await harness.call('waitForIntent', { intentId: 'i-1' })
    expect(result).toEqual({
      environment: 'dev',
      intentId: 'i-1',
      status: 'Executed',
      isTerminal: true,
      isSuccess: true,
    })
  })

  it('reports a rejected Intent with its reason', async () => {
    await setup()
    harness.adapter.state.outcome = {
      intentId: '',
      status: 'Rejected',
      isTerminal: true,
      isSuccess: false,
      reason: 'Rejected by bob',
    }
    expect(await harness.call('waitForIntent', { intentId: 'i-1' })).toMatchObject({
      status: 'Rejected',
      isTerminal: true,
      isSuccess: false,
      reason: 'Rejected by bob',
    })
  })

  it('reports an Intent still awaiting approval as an answer, not an error', async () => {
    await setup()
    harness.adapter.state.outcome = {
      intentId: '',
      status: 'Open',
      isTerminal: false,
      isSuccess: false,
      reason: 'Still awaiting approval',
    }
    const result = await harness.call('waitForIntent', { intentId: 'i-1' })
    expect(result).toMatchObject({
      environment: 'dev',
      status: 'Open',
      isTerminal: false,
      reason: 'Still awaiting approval',
    })
    expect(result).not.toHaveProperty('error')
  })

  it('passes the timeout to the Backend in milliseconds', async () => {
    await setup()
    await harness.call('waitForIntent', { intentId: 'i-1', timeoutSeconds: 5 })
    expect(harness.adapter.waits).toEqual([{ intentId: 'i-1', timeoutMs: 5000 }])
  })

  it('shapes a Backend failure as an error', async () => {
    await setup()
    harness.adapter.state.outcome = new Error('boom')
    expect(await harness.call('waitForIntent', { intentId: 'i-1' })).toEqual({
      environment: 'dev',
      error: { code: 'backend-error', message: 'boom' },
    })
  })
})
