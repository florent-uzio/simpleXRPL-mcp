import { describe, expect, it } from 'vitest'
import { createInMemoryCustodyApi } from '../testing/in-memory-custody-api'
import { rippleCustodyBackend, type CustodyTransaction, type NativeOrder } from './adapter'

const payment: NativeOrder = {
  account: 'rSender',
  operation: { type: 'Payment', destination: { type: 'Address', address: 'rReceiver' }, amount: '1000000' },
}

const batchOrder = (account: string) =>
  ({
    account,
    operation: { type: 'Batch', executionMode: 'AllOrNothing', operations: [], batchSigners: [] },
  }) as unknown as NativeOrder

const setup = () => {
  const api = createInMemoryCustodyApi()
  api.accounts.set('rSender', { accountId: 'a-1', ledgerId: 'xrpl-1' })
  return { api, backend: rippleCustodyBackend(api, { domainId: 'd-1' }) }
}

describe('Ripple Custody adapter', () => {
  it('dry-runs exactly the order it proposes', async () => {
    const { api, backend } = setup()
    await backend.dryRun(payment)
    const { intentId } = await backend.propose(payment)
    const [dryRun] = api.dryRuns
    const [proposal] = api.proposals
    expect(intentId).toBe(proposal.id)
    expect({ ...dryRun, id: undefined }).toEqual({ ...proposal, id: undefined })
    expect(proposal).toMatchObject({
      accountId: 'a-1',
      ledgerId: 'xrpl-1',
      type: 'v0_CreateTransactionOrder',
      parameters: { type: 'XRPL', feeStrategy: { priority: 'Low', type: 'Priority' }, operation: payment.operation },
    })
  })

  it('reports the fee estimate of a successful Dry run', async () => {
    const { backend } = setup()
    expect(await backend.dryRun(payment)).toEqual({ success: true, errors: [], estimatedFeeDrops: '12' })
  })

  it('fails the Dry run of an address no account holds, without asking Custody', async () => {
    const { api, backend } = setup()
    expect(await backend.dryRun({ ...payment, account: 'rStranger' })).toEqual({
      success: false,
      errors: ['No account in the Domain holds rStranger'],
    })
    expect(api.dryRuns).toEqual([])
  })

  it("lists a Batch's signers from its Dry run", async () => {
    const { api, backend } = setup()
    const participant = { type: 'Address', address: 'rOther' }
    api.state.dryRun = {
      success: true,
      errors: [],
      estimate: {
        type: 'XRPL',
        fee: '40',
        batchSigningData: {
          executionMode: 'AllOrNothing',
          signers: [{ account: 'rOther', participant, signingPayload: 'ABCD', extra: 'dropped' }],
        },
      },
    } as unknown as typeof api.state.dryRun
    const batch = batchOrder('rSender')
    expect(await backend.dryRun(batch)).toEqual({
      success: true,
      errors: [],
      estimatedFeeDrops: '40',
      executionMode: 'AllOrNothing',
      signers: [{ account: 'rOther', participant, signingPayload: 'ABCD' }],
    })
  })

  it('lists no signers for a Batch from an address no account holds', async () => {
    const { backend } = setup()
    const batch = batchOrder('rStranger')
    expect(await backend.dryRun(batch)).toMatchObject({ success: false, signers: [] })
  })

  it('lists only the external addresses on XRPL ledgers, and the cursor of the next page', async () => {
    const { api, backend } = setup()
    api.state.ledgers = [
      { id: 'xrpl-1', type: 'XRPL' },
      { id: 'eth-1', type: 'Ethereum' },
    ]
    api.state.accountPages = [{ accounts: [{ id: 'a-1', alias: 'treasury' }], nextCursor: '1' }]
    api.state.addresses.set('a-1', [
      { address: 'rTreasury', ledgerId: 'xrpl-1', scope: 'External' },
      { address: 'rInternal', ledgerId: 'xrpl-1', scope: 'Internal' },
      { address: '0xabc', ledgerId: 'eth-1', scope: 'External' },
    ])
    expect(await backend.listAccounts({ domainId: 'd-1' })).toEqual({
      accounts: [{ id: 'a-1', alias: 'treasury', addresses: [{ address: 'rTreasury', ledgerId: 'xrpl-1' }] }],
      nextCursor: '1',
    })
  })
})

// GET /v1/domains/{domainId}/transactions/{id} for Intent 01a1c4d5-2e09-775d-80d0-115b0f4ea64d (MPTokenIssuanceCreate), trimmed.
const executedIssuanceCreate = {
  id: '1c434545-cdf3-4317-adaf-ad176ba9c6f1',
  ledgerId: 'xrpl-repo-sandbox',
  orderReference: { id: '01a1c4d5-2e09-775d-80d0-115b0f4ea64d', domainId: '9f425c77-6f77-41a6-85e9-e44975483efb' },
  processing: { status: 'Completed' },
  ledgerTransactionData: {
    ledgerStatus: 'Confirmed',
    failure: null,
    ledgerTransactionId: 'FA5DAFE985E04726A29DC00F3FF28DFFAC750AFCD195424F2ED23FECE9E0F27D',
    ledgerData: {
      tokenData: { issuanceId: '002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3', type: 'MultiPurposeToken' },
      transactionType: 'MPTokenIssuanceCreate',
      type: 'Xrpl',
    },
  },
}

describe('Ripple Custody adapter: MPT issuance ID', () => {
  // A single look, so a pending result returns at once.
  const lookUp = (transactions: CustodyTransaction[]) => {
    const { api, backend } = setup()
    api.state.transactions.set('i-1', transactions)
    return backend.getMptIssuanceId({ intentId: 'i-1', domainId: 'd-1', timeoutMs: 0 })
  }

  it('reads the issuance ID off an executed MPTokenIssuanceCreate', async () => {
    expect(await lookUp([executedIssuanceCreate])).toEqual({
      intentId: 'i-1',
      issuanceId: '002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3',
    })
  })

  it('is pending while no transaction is registered', async () => {
    expect(await lookUp([])).toEqual({ intentId: 'i-1', reason: 'No transaction is registered yet for Intent i-1.' })
  })

  it('is pending while the ledger data is not filled in', async () => {
    const pending = { ...executedIssuanceCreate, ledgerTransactionData: { ledgerStatus: 'Pending', ledgerData: null } }
    expect(await lookUp([pending])).toEqual({
      intentId: 'i-1',
      reason: 'The transaction of Intent i-1 carries no MPT issuance ID yet.',
    })
  })

  it('rejects a transaction that created no issuance', async () => {
    const payment = { ledgerTransactionData: { ledgerData: { transactionType: 'Payment', type: 'Xrpl' } } }
    await expect(lookUp([payment])).rejects.toThrow(
      'Intent i-1 is not an MPTokenIssuanceCreate: its transaction is Payment.',
    )
  })

  it('ignores the issuance of an MPT transaction that did not create it', async () => {
    const authorize = {
      ledgerTransactionData: {
        ledgerData: { ...executedIssuanceCreate.ledgerTransactionData.ledgerData, transactionType: 'MPTokenAuthorize' },
      },
    }
    await expect(lookUp([authorize])).rejects.toThrow(
      'Intent i-1 is not an MPTokenIssuanceCreate: its transaction is MPTokenAuthorize.',
    )
  })

  it('refuses to pick between several issuances', async () => {
    const other = {
      ledgerTransactionData: {
        ledgerData: {
          type: 'Xrpl',
          transactionType: 'MPTokenIssuanceCreate',
          tokenData: { issuanceId: '0000000127A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3' },
        },
      },
    }
    await expect(lookUp([executedIssuanceCreate, other])).rejects.toThrow('several MPT issuances')
  })
})
