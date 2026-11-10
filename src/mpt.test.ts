import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'
import { encodeMptMetadata } from './tools/mpt-metadata'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (access: string = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({ environments: { prod: custodyEnvironment({ access }) } })
}
afterEach(() => harness?.cleanup())

const base = { environment: 'prod', account: 'rIssuer' }
const metadata = {
  ticker: 'SXTEST',
  name: 'Test',
  icon: 'example.com/i.png',
  asset_class: 'other',
  issuer_name: 'Issuer',
}
const decode = (hex: string) => JSON.parse(Buffer.from(hex, 'hex').toString('utf8'))

describe.each([
  ['mptIssuanceCreate', {}],
  ['mptAuthorize', { issuanceId: 'ABC' }],
  ['mptIssuanceSet', { issuanceId: 'ABC' }],
  ['mptIssuanceDestroy', { issuanceId: 'ABC' }],
])('%s', (tool, extra) => {
  const input = { ...base, ...extra }

  it('refuses a write on a read Environment before touching the Backend', async () => {
    await setup('read')
    const result = await harness.call(tool, { ...input, dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'access-denied' } })
    expect(harness.adapter.connections).toEqual([])
  })

  it('treats an omitted Environment as an input error', async () => {
    await setup()
    await expect(harness.call(tool, { account: 'rIssuer', ...extra })).rejects.toThrow(/environment/)
    expect(harness.adapter.mptDryRuns).toEqual([])
  })

  it('defaults to a Dry run and proposes nothing', async () => {
    await setup()
    const result = await harness.call(tool, input)
    expect(result).toEqual({ environment: 'prod', dryRun: true, success: true, errors: [], estimatedFeeDrops: '12' })
    expect(harness.adapter.mptDryRuns).toHaveLength(1)
    expect(harness.adapter.mptProposals).toEqual([])
  })

  it('blocks the Propose when the Dry run fails', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['tecNO_PERMISSION'] }
    const result = await harness.call(tool, { ...input, dryRun: false })
    expect(result).toMatchObject({ environment: 'prod', error: { code: 'dry-run-failed' } })
    expect(harness.adapter.mptProposals).toEqual([])
  })

  it('Proposes after a successful Dry run and returns the intentId at once', async () => {
    await setup()
    const result = await harness.call(tool, { ...input, dryRun: false })
    expect(result).toEqual({ environment: 'prod', dryRun: false, intentId: 'mpt-intent-1', estimatedFeeDrops: '12' })
    expect(harness.adapter.mptProposals).toHaveLength(1)
  })

  it('hex-encodes memos', async () => {
    await setup()
    await harness.call(tool, { ...input, memos: [{ data: 'simplexrpl test', type: 'test', format: 'text/plain' }] })
    expect(harness.adapter.mptDryRuns[0].memos).toEqual([
      {
        memoData: Buffer.from('simplexrpl test').toString('hex').toUpperCase(),
        memoFormat: '746578742F706C61696E',
        memoType: '74657374',
      },
    ])
  })
})

describe('mptIssuanceCreate operation', () => {
  it('maps flags, scale and XLS-89 metadata to the native operation', async () => {
    await setup()
    await harness.call('mptIssuanceCreate', {
      ...base,
      assetScale: 2,
      flags: ['tfMPTCanTransfer', 'tfMPTCanClawback', 'tfMPTCanConfidentialAmount'],
      metadata,
    })
    const { operation } = harness.adapter.mptDryRuns[0]
    expect(Object.keys(operation).sort()).toEqual(['assetScale', 'flags', 'metadata', 'type'])
    expect(operation).toMatchObject({
      type: 'MPTokenIssuanceCreate',
      assetScale: 2,
      flags: ['tfMPTCanTransfer', 'tfMPTCanClawback', 'tfMPTCanConfidentialAmount'],
      metadata: { type: 'HexEncodedMetadata' },
    })
    const value = (operation as { metadata: { value: string } }).metadata.value
    expect(decode(value)).toEqual({ t: 'SXTEST', n: 'Test', i: 'example.com/i.png', ac: 'other', in: 'Issuer' })
  })

  it('rejects metadata that breaks XLS-89', async () => {
    await setup()
    await expect(
      harness.call('mptIssuanceCreate', { ...base, metadata: { ...metadata, ticker: 'toolong1' } }),
    ).rejects.toThrow(/ticker/)
    await expect(
      harness.call('mptIssuanceCreate', { ...base, metadata: { ...metadata, asset_class: 'rwa' } }),
    ).rejects.toThrow(/asset_subclass/)
    expect(harness.adapter.mptDryRuns).toEqual([])
  })
})

describe('other operations', () => {
  it('maps mptAuthorize with a holder', async () => {
    await setup()
    await harness.call('mptAuthorize', { ...base, issuanceId: 'ABC', holder: 'rHolder' })
    expect(harness.adapter.mptDryRuns[0].operation).toEqual({
      type: 'MPTokenAuthorize',
      tokenIdentifier: { type: 'MPTokenIssuanceId', issuanceId: 'ABC' },
      flags: [],
      holder: { type: 'Address', address: 'rHolder' },
    })
  })

  it('maps mptIssuanceSet with a lock flag', async () => {
    await setup()
    await harness.call('mptIssuanceSet', { ...base, issuanceId: 'ABC', flags: ['tfMPTLock'], memos: [{ data: 'x' }] })
    expect(harness.adapter.mptDryRuns[0].operation).toEqual({
      type: 'MPTokenIssuanceSet',
      tokenIdentifier: { type: 'MPTokenIssuanceId', issuanceId: 'ABC' },
      flags: ['tfMPTLock'],
      mutableFlags: [],
    })
  })

  it('maps mptIssuanceDestroy', async () => {
    await setup()
    await harness.call('mptIssuanceDestroy', { ...base, issuanceId: 'ABC' })
    expect(harness.adapter.mptDryRuns[0].operation).toEqual({
      type: 'MPTokenIssuanceDestroy',
      tokenIdentifier: { type: 'MPTokenIssuanceId', issuanceId: 'ABC' },
    })
  })
})

describe('encodeMptMetadata', () => {
  it('uses XLS-89 short keys, including for uris', () => {
    const hex = encodeMptMetadata({
      ...metadata,
      asset_class: 'other',
      uris: [{ uri: 'example.com', category: 'website', title: 'Home' }],
    })
    expect(decode(hex).us).toEqual([{ u: 'example.com', c: 'website', t: 'Home' }])
  })

  it('rejects metadata over 1024 bytes', () => {
    expect(() => encodeMptMetadata({ ...metadata, asset_class: 'other', desc: 'x'.repeat(1100) })).toThrow(/1024/)
  })
})
