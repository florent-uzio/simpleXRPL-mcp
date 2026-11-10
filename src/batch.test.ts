import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (access: string = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { prod: custodyEnvironment({ access }) } })
}
afterEach(() => harness?.cleanup())

const batch = {
  environment: 'prod',
  account: 'rSubmitter',
  executionMode: 'AllOrNothing',
  entries: [
    { operation: { type: 'Payment', destination: 'rBob', amount: '1000' }, sequencing: { type: 'PlatformManaged' } },
    {
      participant: 'rAlice',
      operation: { type: 'Payment', destination: 'rBob', amount: '5', issuanceId: 'ABC' },
      sequencing: { type: 'Ticket', value: 7 },
    },
  ],
}

describe('dryRunBatch', () => {
  it('works on a read Environment, returns the signers and proposes nothing', async () => {
    await setup('read')
    harness.adapter.state.batchSigners = [
      { account: 'rAlice', participant: { type: 'Address', address: 'rAlice' }, signingPayload: 'AA' },
    ]
    const result = await harness.call('dryRunBatch', batch)
    expect(result).toMatchObject({
      environment: 'prod',
      dryRun: true,
      success: true,
      executionMode: 'AllOrNothing',
      signers: [{ account: 'rAlice', signingPayload: 'AA' }],
    })
    expect(harness.adapter.proposals).toEqual([])
  })

  it('maps entries to native Batch entries, with no signers on a Dry run', async () => {
    await setup()
    await harness.call('dryRunBatch', batch)
    expect(harness.adapter.dryRuns[0].operation).toMatchObject({
      type: 'Batch',
      executionMode: 'AllOrNothing',
      sequencing: { type: 'PlatformManaged' },
      batchSigners: [],
      entries: [
        {
          type: 'SubmitterOperation',
          operation: { type: 'Payment', destination: { type: 'Address', address: 'rBob' }, amount: '1000' },
          sequencing: { type: 'PlatformManaged' },
        },
        {
          type: 'ParticipantOperation',
          participant: { type: 'Address', address: 'rAlice' },
          operation: { currency: { type: 'MultiPurposeToken', issuanceId: 'ABC' } },
          sequencing: { type: 'Ticket', value: 7 },
        },
      ],
    })
  })

  it('rejects a participant entry with PlatformManaged sequencing', async () => {
    await setup()
    const bad = {
      ...batch,
      entries: [batch.entries[0], { ...batch.entries[1], sequencing: { type: 'PlatformManaged' } }],
    }
    await expect(harness.call('dryRunBatch', bad)).rejects.toThrow(/PlatformManaged/)
    expect(harness.adapter.dryRuns).toEqual([])
  })

  it('rejects a Batch with fewer than 2 entries', async () => {
    await setup()
    await expect(harness.call('dryRunBatch', { ...batch, entries: [batch.entries[0]] })).rejects.toThrow(/entries/)
  })
})

describe('proposeBatch', () => {
  const signed = { ...batch, batchSigners: [{ participant: 'rAlice', publicKey: '02AB', signature: 'CD' }] }

  it('refuses a write on a read Environment before touching the Backend', async () => {
    await setup('read')
    const result = await harness.call('proposeBatch', { ...signed, dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'access-denied' } })
    expect(harness.adapter.connections).toEqual([])
  })

  it('defaults to a Dry run with the signers attached', async () => {
    await setup()
    const result = await harness.call('proposeBatch', signed)
    expect(result).toMatchObject({ dryRun: true, success: true })
    expect(harness.adapter.dryRuns[0].operation).toMatchObject({
      batchSigners: [{ participant: { type: 'Address', address: 'rAlice' }, publicKey: '02AB', signature: 'CD' }],
    })
    expect(harness.adapter.proposals).toEqual([])
  })

  it('blocks the Propose when the Dry run fails', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['InvalidBatchSignature'] }
    const result = await harness.call('proposeBatch', { ...signed, dryRun: false })
    expect(result).toMatchObject({ error: { code: 'dry-run-failed' } })
    expect(harness.adapter.proposals).toEqual([])
  })

  it('Proposes after a successful Dry run and returns the intentId at once', async () => {
    await setup()
    const result = await harness.call('proposeBatch', { ...signed, dryRun: false })
    expect(result).toEqual({ environment: 'prod', dryRun: false, intentId: 'intent-1', estimatedFeeDrops: '12' })
    expect(harness.adapter.proposals[0].operation).toMatchObject({ batchSigners: [expect.anything()] })
  })
})
