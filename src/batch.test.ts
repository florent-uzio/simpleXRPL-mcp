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
    {
      operation: { type: 'Payment', destination: 'rBob', amount: '0.001', currency: { type: 'XRP' } },
      sequencing: { type: 'PlatformManaged' },
    },
    {
      participant: 'rAlice',
      operation: { type: 'Payment', destination: 'rBob', amount: '5', currency: { type: 'MPT', issuanceId: 'ABC' } },
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

  it('takes a Payment entry in the same units as the payment tool: decimal XRP, and a decimal IOU', async () => {
    await setup()
    const iou = {
      operation: {
        type: 'Payment',
        destination: { accountId: 'acc-1' },
        amount: '10.5',
        currency: { type: 'IOU', code: 'USD', issuer: 'rIssuer' },
      },
      sequencing: { type: 'PlatformManaged' },
    }
    await harness.call('dryRunBatch', { ...batch, entries: [batch.entries[0], iou] })
    expect(harness.adapter.dryRuns[0].operation).toMatchObject({
      entries: [
        { operation: { amount: '1000' } },
        {
          operation: {
            type: 'Payment',
            destination: { type: 'Account', accountId: 'acc-1' },
            amount: '105' + '0'.repeat(80),
            currency: { type: 'Currency', code: 'USD', issuer: 'rIssuer' },
          },
        },
      ],
    })
  })

  it.each([
    ['an entry in the old drops format, with no currency', { destination: 'rBob', amount: '1000' }],
    ['an old MPT entry, with issuanceId and no currency', { destination: 'rBob', amount: '5', issuanceId: 'ABC' }],
    [
      'an XRP amount with more than 6 decimals',
      { destination: 'rBob', amount: '1.1234567', currency: { type: 'XRP' } },
    ],
  ])('rejects a Payment entry with %s before touching the Backend', async (_case, fields) => {
    await setup()
    const bad = { operation: { type: 'Payment', ...fields }, sequencing: { type: 'PlatformManaged' } }
    await expect(harness.call('dryRunBatch', { ...batch, entries: [batch.entries[0], bad] })).rejects.toThrow(
      /currency|amount/,
    )
    expect(harness.adapter.dryRuns).toEqual([])
  })

  it('maps MPT entries the way their standalone tools do', async () => {
    await setup()
    const entries = [
      { type: 'MPTokenAuthorize', issuanceId: 'ABC', holder: 'rHolder' },
      {
        type: 'MPTokenIssuanceCreate',
        assetScale: 2,
        metadata: { ticker: 'SX', name: 'T', icon: 'i', asset_class: 'other', issuer_name: 'I' },
      },
      { type: 'MPTokenIssuanceSet', issuanceId: 'ABC', flags: ['tfMPTLock'] },
      { type: 'MPTokenIssuanceDestroy', issuanceId: 'ABC' },
    ].map(operation => ({ operation, sequencing: { type: 'PlatformManaged' } }))
    await harness.call('dryRunBatch', { ...batch, entries })
    const tokenIdentifier = { type: 'MPTokenIssuanceId', issuanceId: 'ABC' }
    expect(harness.adapter.dryRuns[0].operation).toMatchObject({
      entries: [
        {
          operation: {
            type: 'MPTokenAuthorize',
            tokenIdentifier,
            flags: [],
            holder: { type: 'Address', address: 'rHolder' },
          },
        },
        {
          operation: {
            type: 'MPTokenIssuanceCreate',
            assetScale: 2,
            flags: [],
            metadata: { type: 'HexEncodedMetadata', value: expect.any(String) },
          },
        },
        { operation: { type: 'MPTokenIssuanceSet', tokenIdentifier, flags: ['tfMPTLock'], mutableFlags: [] } },
        { operation: { type: 'MPTokenIssuanceDestroy', tokenIdentifier } },
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
