import { describe, expect, it } from 'vitest'
import { mptIssuanceIdOf } from './adapter'

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

describe('mptIssuanceIdOf', () => {
  it('reads the issuance ID off an executed MPTokenIssuanceCreate', () => {
    expect(mptIssuanceIdOf('i-1', [executedIssuanceCreate])).toBe('002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3')
  })

  it('says to retry when no transaction is registered yet', () => {
    expect(() => mptIssuanceIdOf('i-1', [])).toThrow('No transaction is registered yet for Intent i-1')
  })

  it('says to retry when the ledger data is not filled in yet', () => {
    const pending = { ...executedIssuanceCreate, ledgerTransactionData: { ledgerStatus: 'Pending', ledgerData: null } }
    expect(() => mptIssuanceIdOf('i-1', [pending])).toThrow('Intent i-1 carries no MPT issuance ID yet')
  })

  it('rejects a transaction that created no issuance', () => {
    const payment = {
      ledgerTransactionData: { ledgerData: { transactionType: 'Payment', type: 'Xrpl' } },
    }
    expect(() => mptIssuanceIdOf('i-1', [payment])).toThrow('check the Intent was an MPTokenIssuanceCreate')
  })

  it('refuses to pick between several issuances', () => {
    const other = {
      ledgerTransactionData: {
        ledgerData: { type: 'Xrpl', tokenData: { issuanceId: '0000000127A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3' } },
      },
    }
    expect(() => mptIssuanceIdOf('i-1', [executedIssuanceCreate, other])).toThrow('several MPT issuances')
  })
})
