import type {
  AccountSummary,
  BatchOrder,
  BatchSigningRequirement,
  Connect,
  CustodyConnection,
  DryRunResult,
  IntentOutcome,
  Me,
  MptIssuanceIdOutcome,
  MptOrder,
  PaymentOrder,
  XrpTransfer,
} from '../backend/adapter'

export const fakeMe: Me = {
  publicKey: 'cHVibGlj',
  domains: [{ id: 'd-1', alias: 'main', user: { id: 'u-1', alias: 'alice', roles: ['Author'] } }],
}

export const fakeAccounts: AccountSummary[] = Array.from({ length: 5 }, (_, index) => ({
  id: `a-${index + 1}`,
  alias: `account ${index + 1}`,
  addresses: [{ address: `rAddress${index + 1}`, ledgerId: 'xrpl-1' }],
}))

/** Fake Backend: records the connections it was given, so tests can see what was (not) read. */
export const createFakeAdapter = () => {
  const connections: CustodyConnection[] = []
  const waits: { intentId: string; timeoutMs?: number }[] = []
  const dryRuns: XrpTransfer[] = []
  const proposals: XrpTransfer[] = []
  const mptDryRuns: MptOrder[] = []
  const mptProposals: MptOrder[] = []
  const paymentDryRuns: PaymentOrder[] = []
  const paymentProposals: PaymentOrder[] = []
  const batchDryRuns: BatchOrder[] = []
  const batchProposals: BatchOrder[] = []
  const issuanceLookups: { intentId: string; domainId: string; timeoutMs?: number }[] = []
  const state = {
    batchSigners: [] as BatchSigningRequirement[],
    issuance: { issuanceId: 'ISSUANCE-1' } as Omit<MptIssuanceIdOutcome, 'intentId'> | Error,
    dryRunResult: { success: true, errors: [], estimatedFeeDrops: '12' } as DryRunResult,
    outcome: { intentId: '', status: 'Executed', isTerminal: true, isSuccess: true, reason: undefined } as
      IntentOutcome | Error,
  }
  let me = fakeMe
  const listCalls: { domainId: string; limit?: number; cursor?: string }[] = []
  const connect: Connect = async connection => {
    connections.push(connection)
    return {
      domainId: connection.domainId,
      getMe: async () => me,
      // The cursor is the index of the next account.
      listAccounts: async options => {
        listCalls.push(options)
        const start = Number(options.cursor ?? 0)
        const end = start + (options.limit ?? 100)
        const accounts = fakeAccounts.slice(start, end)
        return end < fakeAccounts.length ? { accounts, nextCursor: String(end) } : { accounts }
      },
      dryRunXrpTransfer: async transfer => {
        dryRuns.push(transfer)
        return state.dryRunResult
      },
      proposeXrpTransfer: async transfer => {
        proposals.push(transfer)
        return { intentId: `intent-${proposals.length}` }
      },
      dryRunMpt: async order => {
        mptDryRuns.push(order)
        return state.dryRunResult
      },
      proposeMpt: async order => {
        mptProposals.push(order)
        return { intentId: `mpt-intent-${mptProposals.length}` }
      },
      dryRunPayment: async order => {
        paymentDryRuns.push(order)
        return state.dryRunResult
      },
      proposePayment: async order => {
        paymentProposals.push(order)
        return { intentId: `payment-intent-${paymentProposals.length}` }
      },
      dryRunBatch: async order => {
        batchDryRuns.push(order)
        return { ...state.dryRunResult, executionMode: order.operation.executionMode, signers: state.batchSigners }
      },
      proposeBatch: async order => {
        batchProposals.push(order)
        return { intentId: `batch-intent-${batchProposals.length}` }
      },
      getMptIssuanceId: async lookup => {
        issuanceLookups.push(lookup)
        if (state.issuance instanceof Error) throw state.issuance
        return { ...state.issuance, intentId: lookup.intentId }
      },
      waitForIntent: async (intentId, options) => {
        waits.push({ intentId, timeoutMs: options?.timeoutMs })
        if (state.outcome instanceof Error) throw state.outcome
        return { ...state.outcome, intentId }
      },
    }
  }
  const setDomains = (ids: string[]) => {
    me = { ...fakeMe, domains: ids.map(id => ({ ...fakeMe.domains[0], id, alias: id })) }
  }
  return {
    connect,
    connections,
    listCalls,
    setDomains,
    dryRuns,
    proposals,
    mptDryRuns,
    mptProposals,
    paymentDryRuns,
    paymentProposals,
    batchDryRuns,
    batchProposals,
    waits,
    issuanceLookups,
    state,
  }
}
