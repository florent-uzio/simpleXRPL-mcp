import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (access: string = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { prod: custodyEnvironment({ access }) } })
}
afterEach(() => harness?.cleanup())

const base = { environment: 'prod', account: 'rHolder', issuanceId: 'ABC' }
const token = { type: 'MPTokenIssuanceId', issuanceId: 'ABC' }

describe.each([
  ['confidentialMptConvert', { amount: '0' }, { type: 'ConfidentialMPTConvert', tokenIdentifier: token, amount: '0' }],
  [
    'confidentialMptConvertBack',
    { amount: '5' },
    { type: 'ConfidentialMPTConvertBack', tokenIdentifier: token, amount: '5' },
  ],
  ['confidentialMptMergeInbox', {}, { type: 'ConfidentialMPTMergeInbox', tokenIdentifier: token }],
])('%s', (tool, extra, operation) => {
  const input = { ...base, ...extra }

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

  it('blocks the Propose when the Dry run fails', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['nope'] }
    const result = await harness.call(tool, { ...input, dryRun: false })
    expect(result).toMatchObject({ error: { code: 'dry-run-failed' } })
    expect(harness.adapter.proposals).toEqual([])
  })

  it('Proposes after a successful Dry run', async () => {
    await setup()
    const result = await harness.call(tool, { ...input, dryRun: false })
    expect(result).toMatchObject({ dryRun: false, intentId: 'intent-1' })
  })
})

describe('amount', () => {
  it('rejects a negative or decimal amount', async () => {
    await setup()
    await expect(harness.call('confidentialMptConvert', { ...base, amount: '-1' })).rejects.toThrow(/amount/)
    await expect(harness.call('confidentialMptConvertBack', { ...base, amount: '1.5' })).rejects.toThrow(/amount/)
    expect(harness.adapter.dryRuns).toEqual([])
  })
})
