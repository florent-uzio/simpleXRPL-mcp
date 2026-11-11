import type {
  AccountSummary,
  ClientWriteOptions,
  ClientWriteOutcome,
  BatchSigningRequirement,
  Connect,
  CustodyConnection,
  DryRunResult,
  IntentOutcome,
  Me,
  MptIssuanceIdOutcome,
  NativeOrder,
  QuarantinedTransfer,
  ReleaseRequest,
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
  const dryRuns: NativeOrder[] = []
  const proposals: NativeOrder[] = []
  const releases: (ReleaseRequest & { step: 'dryRun' | 'propose' })[] = []
  const quarantineLookups: { account: string; ledgerId?: string; domainId: string }[] = []
  const issuanceLookups: { intentId: string; domainId: string; timeoutMs?: number }[] = []
  const clientWrites: { verb: string; params: unknown; options: ClientWriteOptions }[] = []
  const clientReads: { verb: string; params: unknown }[] = []
  let closed = 0
  const state = {
    batchSigners: [] as BatchSigningRequirement[],
    issuance: { issuanceId: 'ISSUANCE-1' } as Omit<MptIssuanceIdOutcome, 'intentId'> | Error,
    releaseDryRun: { success: true, errors: [] } as DryRunResult,
    quarantined: [] as QuarantinedTransfer[],
    dryRunResult: { success: true, errors: [], estimatedFeeDrops: '12' } as DryRunResult,
    outcome: { intentId: '', status: 'Executed', isTerminal: true, isSuccess: true, reason: undefined } as
      IntentOutcome | Error,
    clientWrite: {
      status: 'done',
      source: 'custody',
      intentId: 'intent-c1',
      txHash: 'HASH1',
      idempotencyKey: 'key-1',
      intent: {},
    } as ClientWriteOutcome,
    clientRead: { data: 'read' } as unknown,
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
      dryRun: async order => {
        dryRuns.push(order)
        return order.operation.type === 'Batch'
          ? { ...state.dryRunResult, executionMode: order.operation.executionMode, signers: state.batchSigners }
          : state.dryRunResult
      },
      propose: async order => {
        proposals.push(order)
        return { intentId: `intent-${proposals.length}` }
      },
      listQuarantinedTransfers: async lookup => {
        quarantineLookups.push(lookup)
        return state.quarantined
      },
      dryRunRelease: async request => {
        releases.push({ step: 'dryRun', ...request })
        return state.releaseDryRun
      },
      proposeRelease: async request => {
        releases.push({ step: 'propose', ...request })
        return { intentId: `release-${releases.filter(release => release.step === 'propose').length}` }
      },
      getMptIssuanceId: async lookup => {
        issuanceLookups.push(lookup)
        if (state.issuance instanceof Error) throw state.issuance
        return { ...state.issuance, intentId: lookup.intentId }
      },
      // Like the real Backend, the client exists only with an XRPL node URL.
      client: connection.xrpldUrl
        ? async () => ({
            write: async (verb, params, options) => {
              clientWrites.push({ verb, params, options })
              return state.clientWrite
            },
            read: async (verb, params) => {
              clientReads.push({ verb, params })
              return state.clientRead
            },
          })
        : undefined,
      close: async () => void closed++,
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
    releases,
    quarantineLookups,
    waits,
    issuanceLookups,
    clientWrites,
    clientReads,
    closed: () => closed,
    state,
  }
}
