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
    expect(mptIssuanceIdOf('i-1', [executedIssuanceCreate])).toEqual({
      value: '002E70E727A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3',
    })
  })

  it('is pending while no transaction is registered', () => {
    expect(mptIssuanceIdOf('i-1', [])).toEqual({ pending: 'No transaction is registered yet for Intent i-1.' })
  })

  it('is pending while the ledger data is not filled in', () => {
    const pending = { ...executedIssuanceCreate, ledgerTransactionData: { ledgerStatus: 'Pending', ledgerData: null } }
    expect(mptIssuanceIdOf('i-1', [pending])).toEqual({
      pending: 'The transaction of Intent i-1 carries no MPT issuance ID yet.',
    })
  })

  it('rejects a transaction that created no issuance', () => {
    const payment = {
      ledgerTransactionData: { ledgerData: { transactionType: 'Payment', type: 'Xrpl' } },
    }
    expect(() => mptIssuanceIdOf('i-1', [payment])).toThrow(
      'Intent i-1 is not an MPTokenIssuanceCreate: its transaction is Payment.',
    )
  })

  it('ignores the issuance of an MPT transaction that did not create it', () => {
    const authorize = {
      ledgerTransactionData: {
        ledgerData: { ...executedIssuanceCreate.ledgerTransactionData.ledgerData, transactionType: 'MPTokenAuthorize' },
      },
    }
    expect(() => mptIssuanceIdOf('i-1', [authorize])).toThrow(
      'Intent i-1 is not an MPTokenIssuanceCreate: its transaction is MPTokenAuthorize.',
    )
  })

  it('refuses to pick between several issuances', () => {
    const other = {
      ledgerTransactionData: {
        ledgerData: {
          type: 'Xrpl',
          transactionType: 'MPTokenIssuanceCreate',
          tokenData: { issuanceId: '0000000127A7571C7691CE271B3C5B3ADA0BDFA09EF1C5F3' },
        },
      },
    }
    expect(() => mptIssuanceIdOf('i-1', [executedIssuanceCreate, other])).toThrow('several MPT issuances')
  })
})
