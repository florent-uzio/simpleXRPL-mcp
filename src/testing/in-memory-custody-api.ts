import type { CustodyApi, CustodyTransaction, IntentOutcome, Me, TransactionOrderPayload } from '../backend/adapter'
import { fakeMe } from './fake-adapter'

type DryRun = Awaited<ReturnType<CustodyApi['dryRun']>>

/** In-memory Ripple Custody API: tests fill in what Custody holds and read back what was dry-run and proposed. */
export const createInMemoryCustodyApi = () => {
  const dryRuns: TransactionOrderPayload[] = []
  const proposals: TransactionOrderPayload[] = []
  /** XRPL address → the account holding it in the session's Domain. */
  const accounts = new Map<string, { accountId: string; ledgerId: string }>()
  const state = {
    me: fakeMe as Me,
    dryRun: { success: true, errors: [], estimate: { type: 'XRPL', fee: '12' } } as unknown as DryRun,
    accountPages: [] as Awaited<ReturnType<CustodyApi['getAccounts']>>[],
    ledgers: [] as { id: string; type: string }[],
    /** Account id → its addresses. */
    addresses: new Map<string, { address: string; ledgerId: string; scope: string }[]>(),
    /** Order id → the detailed transactions it produced. */
    transactions: new Map<string, CustodyTransaction[]>(),
    outcome: { status: 'Executed', isTerminal: true, isSuccess: true, reason: undefined } as Omit<
      IntentOutcome,
      'intentId'
    >,
  }
  const api: CustodyApi = {
    findAccount: async address => accounts.get(address),
    dryRun: async payload => {
      dryRuns.push(payload)
      return state.dryRun
    },
    propose: async payload => {
      proposals.push(payload)
      return { intentId: payload.id }
    },
    getMe: async () => state.me,
    // The cursor is the index of the page.
    getAccounts: async ({ cursor }) => state.accountPages[Number(cursor ?? 0)] ?? { accounts: [] },
    listLedgers: async () => state.ledgers,
    listAddresses: async ({ accountId }) => state.addresses.get(accountId) ?? [],
    // A transaction's id is `<orderId>/<index>`.
    listOrderTransactionIds: async ({ orderId }) =>
      (state.transactions.get(orderId) ?? []).map((_, i) => `${orderId}/${i}`),
    getTransaction: async ({ transactionId }) => {
      const [orderId, index] = transactionId.split('/')
      const transaction = state.transactions.get(orderId)?.[Number(index)]
      if (!transaction) throw new Error(`No transaction ${transactionId}`)
      return transaction
    },
    waitForIntent: async intentId => ({ ...state.outcome, intentId }),
  }
  return { ...api, accounts, dryRuns, proposals, state }
}
