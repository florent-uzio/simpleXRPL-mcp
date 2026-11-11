import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from './testing/harness'

const XRPLD_URL = 'wss://s.altnet.rippletest.net:51233'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (overrides: Record<string, unknown> = {}) => {
  harness = await createHarness({ TEST_KEY: 'pem' })
  await harness.writeConfig({
    environments: { test: custodyEnvironment({ access: 'propose', xrpldUrl: XRPLD_URL, ...overrides }) },
  })
}
afterEach(() => harness?.cleanup())

const transfer = { environment: 'test', to: 'rDestination', amount: '10.5' }

describe('client verb writes', () => {
  it('calls the client verb with a Dry run first, and reports the route it took', async () => {
    await setup()
    const result = await harness.call('clientXrpTransfer', { ...transfer, from: 'rSource', idempotencyKey: 'key-0' })
    expect(harness.adapter.clientWrites).toEqual([
      {
        verb: 'xrp.transfer',
        params: { to: 'rDestination', amount: '10.5' },
        options: { from: 'rSource', idempotencyKey: 'key-0', dryRun: true },
      },
    ])
    expect(result).toEqual({
      environment: 'test',
      verb: 'client.xrp.transfer',
      pending: false,
      route: 'native-operation',
      source: 'custody',
      intentId: 'intent-c1',
      txHash: 'HASH1',
      idempotencyKey: 'key-1',
      intent: {},
    })
    // The client verb path never goes through the Native operation gate.
    expect(harness.adapter.dryRuns).toEqual([])
    expect(harness.adapter.proposals).toEqual([])
  })

  it("leaves `from` to the client, which acts as the Environment's primary", async () => {
    await setup()
    await harness.call('clientXrpTransfer', transfer)
    expect(harness.adapter.clientWrites[0].options).toEqual({ dryRun: true })
  })

  it('reports Raw signing when the client submitted to the XRPL node', async () => {
    await setup()
    harness.adapter.state.clientWrite = { status: 'done', source: 'xrpld', txHash: 'HASH2', intent: undefined }
    const result = await harness.call('clientAccountSet', { environment: 'test', requireDest: true })
    expect(result).toMatchObject({ verb: 'client.account.set', route: 'raw-signing', source: 'xrpld' })
  })

  it('returns an Intent still awaiting approval as pending, not as an error', async () => {
    await setup()
    harness.adapter.state.clientWrite = { status: 'pending', intentId: 'intent-p', lastState: 'Open' }
    const result = await harness.call('clientXrpTransfer', transfer)
    expect(result).toEqual({
      environment: 'test',
      verb: 'client.xrp.transfer',
      pending: true,
      intentId: 'intent-p',
      lastState: 'Open',
    })
  })

  it('shapes a failure the client reported', async () => {
    await setup()
    harness.adapter.state.clientWrite = { status: 'failed', code: 'dry-run-failed', message: 'insufficient balance' }
    const result = await harness.call('clientXrpTransfer', transfer)
    expect(result).toEqual({
      environment: 'test',
      error: { code: 'dry-run-failed', message: 'insufficient balance' },
    })
  })

  it('needs the Environment to name an XRPL node', async () => {
    await setup({ xrpldUrl: undefined })
    const result = await harness.call('clientXrpTransfer', transfer)
    expect(result).toMatchObject({ environment: 'test', error: { code: 'xrpld-url-required' } })
    expect(harness.adapter.clientWrites).toEqual([])
  })

  it('refuses a write on a read Environment before connecting', async () => {
    await setup({ access: 'read' })
    const result = await harness.call('clientXrpTransfer', transfer)
    expect(result).toMatchObject({ error: { code: 'access-denied' } })
    expect(harness.adapter.connections).toEqual([])
  })

  it('treats an omitted Environment as an input error', async () => {
    await setup()
    const { environment: _environment, ...withoutEnvironment } = transfer
    await expect(harness.call('clientXrpTransfer', withoutEnvironment)).rejects.toThrow(/environment/)
    expect(harness.adapter.clientWrites).toEqual([])
  })

  it('sends an MPT amount in display units with its scale', async () => {
    await setup()
    await harness.call('clientTokenTransfer', {
      environment: 'test',
      to: 'rHolder',
      mptIssuanceId: 'MPT1',
      value: '10.5',
      assetScale: 2,
    })
    expect(harness.adapter.clientWrites[0]).toMatchObject({
      verb: 'token.transfer',
      params: { to: 'rHolder', amount: { asset: { kind: 'mpt', mptIssuanceId: 'MPT1', scale: 2 }, value: '10.5' } },
    })
  })

  it('maps each tool to its verb and parameters', async () => {
    await setup()
    const calls: [string, Record<string, unknown>, string, unknown][] = [
      [
        'clientIouIssue',
        { ticker: 'USD', holder: 'rHolder', amount: '100' },
        'iou.issue',
        { ticker: 'USD', holder: 'rHolder', amount: '100' },
      ],
      [
        'clientIouAuthorize',
        { ticker: 'USD', holder: 'rHolder' },
        'iou.authorize',
        { ticker: 'USD', holder: 'rHolder' },
      ],
      [
        'clientIouTransfer',
        { ticker: 'USD', to: 'rHolder', amount: '5' },
        'iou.transfer',
        { ticker: 'USD', to: 'rHolder', amount: '5' },
      ],
      [
        'clientIouClawback',
        { ticker: 'USD', holder: 'rHolder', amount: '5' },
        'iou.clawback',
        { ticker: 'USD', holder: 'rHolder', amount: '5' },
      ],
      [
        'clientTokenIssue',
        { metadata: { ticker: 'TST' }, assetScale: 2, flags: { requireAuth: true } },
        'token.issue',
        { metadata: { ticker: 'TST' }, assetScale: 2, flags: { requireAuth: true } },
      ],
      ['clientTokenAuthorize', { mptIssuanceId: 'MPT1' }, 'token.authorize', { mptIssuanceId: 'MPT1' }],
      [
        'clientTokenLock',
        { mptIssuanceId: 'MPT1', holder: 'rHolder' },
        'token.lock',
        { mptIssuanceId: 'MPT1', holder: 'rHolder' },
      ],
      ['clientTokenUnlock', { mptIssuanceId: 'MPT1' }, 'token.unlock', { mptIssuanceId: 'MPT1' }],
      ['clientTokenDestroy', { mptIssuanceId: 'MPT1' }, 'token.destroy', { mptIssuanceId: 'MPT1' }],
      [
        'clientAccountSet',
        { requireAuth: true, transferRate: 0.5 },
        'account.set',
        { requireAuth: true, transferRate: 0.5 },
      ],
      ['clientAccountDepositPreauth', { authorize: 'rOther' }, 'account.depositPreauth', { authorize: 'rOther' }],
    ]
    for (const [tool, args, verb, params] of calls) {
      await harness.call(tool, { environment: 'test', ...args })
      expect(harness.adapter.clientWrites.at(-1)).toMatchObject({ verb, params, options: { dryRun: true } })
    }
  })
})

describe('client verb writes with no Native operation, and offers', () => {
  const price = { ticker: 'USD', issuer: 'rIssuer', amount: '5' }
  const credList = [{ issuer: 'rIssuer', credType: 'KYC' }]
  const calls: [string, Record<string, unknown>, string, unknown][] = [
    ['clientAccountSetRegularKey', { regularKey: 'rKey' }, 'account.setRegularKey', { regularKey: 'rKey' }],
    ['clientAccountSetRegularKey', {}, 'account.setRegularKey', {}],
    [
      'clientXrpBuyOffer',
      { amount: '10', orderType: 'limit', price },
      'xrp.buyOffer',
      { amount: '10', orderType: 'limit', price },
    ],
    [
      'clientXrpSellOffer',
      { amount: '10', orderType: 'passive', price, domainID: 'DOM1', hybrid: false },
      'xrp.sellOffer',
      { amount: '10', orderType: 'passive', price, domainID: 'DOM1', hybrid: false },
    ],
    ['clientXrpCancelOffer', { offerSequence: 7 }, 'xrp.cancelOffer', { offerSequence: 7 }],
    [
      'clientIouBuyOffer',
      { ticker: 'EUR', amount: '3', orderType: 'fok', price: { currency: 'XRP', amount: '1.5' } },
      'iou.buyOffer',
      { ticker: 'EUR', amount: '3', orderType: 'fok', price: { currency: 'XRP', amount: '1.5' } },
    ],
    [
      'clientIouSellOffer',
      { ticker: 'EUR', amount: '3', orderType: 'market', price, offerSequence: 4 },
      'iou.sellOffer',
      { ticker: 'EUR', amount: '3', orderType: 'market', price, offerSequence: 4 },
    ],
    ['clientIouCancelOffer', { offerSequence: 8 }, 'iou.cancelOffer', { offerSequence: 8 }],
    [
      'clientCredentialIssue',
      { destination: 'rHolder', credType: 'KYC', expiration: 800000000, URI: 'https://kyc.example.com' },
      'credential.issue',
      { destination: 'rHolder', credType: 'KYC', expiration: 800000000, URI: 'https://kyc.example.com' },
    ],
    [
      'clientCredentialAccept',
      { credType: 'KYC', issuer: 'rIssuer' },
      'credential.accept',
      { credType: 'KYC', issuer: 'rIssuer' },
    ],
    [
      'clientCredentialDelete',
      { credType: 'KYC', holder: 'rHolder' },
      'credential.delete',
      { credType: 'KYC', holder: 'rHolder' },
    ],
    ['clientDomainCreate', { credList }, 'domain.create', { credList }],
    ['clientDomainSetCredentials', { domain: 'DOM1', credList }, 'domain.setCredentials', { domain: 'DOM1', credList }],
    ['clientDomainDelete', { domain: 'DOM1' }, 'domain.delete', { domain: 'DOM1' }],
  ]

  it('maps each tool to its verb and parameters, with a Dry run first', async () => {
    await setup({ allowRawSigning: true })
    for (const [tool, args, verb, params] of calls) {
      await harness.call(tool, { environment: 'test', from: 'rActor', ...args })
      expect(harness.adapter.clientWrites.at(-1)).toEqual({
        verb,
        params: expect.objectContaining(params as object),
        options: { from: 'rActor', dryRun: true },
      })
    }
  })

  it('reports Raw signing being off as not supported', async () => {
    await setup()
    harness.adapter.state.clientWrite = {
      status: 'failed',
      code: 'not-supported',
      message: 'CredentialCreate needs raw signing, which is disabled',
    }
    const result = await harness.call('clientCredentialIssue', {
      environment: 'test',
      destination: 'rHolder',
      credType: 'KYC',
    })
    expect(result).toMatchObject({ error: { code: 'not-supported' } })
  })

  it('rejects a domain with no accepted credential, and an MPT offer price', async () => {
    await setup()
    await expect(harness.call('clientDomainCreate', { environment: 'test', credList: [] })).rejects.toThrow(/credList/)
    await expect(
      harness.call('clientXrpBuyOffer', {
        environment: 'test',
        amount: '1',
        orderType: 'limit',
        price: { mptIssuanceId: 'MPT1', amount: '1' },
      }),
    ).rejects.toThrow(/price/)
    expect(harness.adapter.clientWrites).toEqual([])
  })
})

describe('client verb reads', () => {
  it('read with the read Access level and the default Environment', async () => {
    await setup({ access: 'read' })
    const result = await harness.call('clientTokenRetrieve', { mptIssuanceId: 'MPT1' })
    expect(result).toEqual({ environment: 'test', verb: 'client.token.retrieve', result: { data: 'read' } })
    expect(harness.adapter.clientReads).toEqual([{ verb: 'token.retrieve', params: { mptIssuanceId: 'MPT1' } }])
  })

  it('map each read tool to its verb and parameters', async () => {
    await setup()
    await harness.call('clientTokenList', { role: 'issuer', account: 'rIssuer' })
    await harness.call('clientIouRetrieve', { ticker: 'USD', issuer: 'rIssuer' })
    await harness.call('clientAccountRetrieve', {})
    expect(harness.adapter.clientReads).toMatchObject([
      { verb: 'token.list', params: { role: 'issuer', account: 'rIssuer' } },
      { verb: 'iou.retrieve', params: { ticker: 'USD', issuer: 'rIssuer' } },
      { verb: 'account.retrieve', params: {} },
    ])
  })

  it('map the offer, credential and domain reads to their verbs', async () => {
    await setup()
    await harness.call('clientAccountListOffers', { account: 'rTrader' })
    await harness.call('clientIouListOffers', { ticker: 'USD', issuer: 'rIssuer' })
    await harness.call('clientCredentialRetrieve', { credType: 'KYC', issuer: 'rIssuer', account: 'rHolder' })
    await harness.call('clientCredentialList', { role: 'issuer' })
    await harness.call('clientDomainRetrieve', { domainID: 'DOM1' })
    await harness.call('clientDomainList', {})
    expect(harness.adapter.clientReads).toMatchObject([
      { verb: 'account.listOffers', params: { account: 'rTrader' } },
      { verb: 'iou.listOffers', params: { ticker: 'USD', issuer: 'rIssuer' } },
      { verb: 'credential.retrieve', params: { credType: 'KYC', issuer: 'rIssuer', account: 'rHolder' } },
      { verb: 'credential.list', params: { role: 'issuer' } },
      { verb: 'domain.retrieve', params: { domainID: 'DOM1' } },
      { verb: 'domain.list', params: {} },
    ])
  })
})

describe('client lifetime', () => {
  it('closes the old Backend when the Environment changes', async () => {
    await setup()
    await harness.call('clientAccountRetrieve', {})
    await harness.writeConfig({
      environments: { test: custodyEnvironment({ access: 'propose', xrpldUrl: 'wss://other.example.com' }) },
    })
    await harness.call('clientAccountRetrieve', {})
    expect(harness.adapter.connections).toHaveLength(2)
    await new Promise(resolve => setImmediate(resolve))
    expect(harness.adapter.closed()).toBe(1)
  })

  it('closes every connected Backend on shutdown', async () => {
    await setup()
    await harness.call('clientAccountRetrieve', {})
    await harness.closeBackends()
    expect(harness.adapter.closed()).toBe(1)
  })
})
