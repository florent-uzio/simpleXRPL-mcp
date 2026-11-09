import type { Connect, CustodyConnection, DryRunResult, Me, XrpTransfer } from '../backend/adapter'

export const fakeMe: Me = {
  publicKey: 'cHVibGlj',
  domains: [{ id: 'd-1', alias: 'main', user: { id: 'u-1', alias: 'alice', roles: ['Author'] } }],
}

/** Fake Backend: records the connections it was given, so tests can see what was (not) read. */
export const createFakeAdapter = () => {
  const connections: CustodyConnection[] = []
  const dryRuns: XrpTransfer[] = []
  const proposals: XrpTransfer[] = []
  const state = { dryRunResult: { success: true, errors: [], estimatedFeeDrops: '12' } as DryRunResult }
  const connect: Connect = async connection => {
    connections.push(connection)
    return {
      getMe: async () => fakeMe,
      dryRunXrpTransfer: async transfer => {
        dryRuns.push(transfer)
        return state.dryRunResult
      },
      proposeXrpTransfer: async transfer => {
        proposals.push(transfer)
        return { intentId: `intent-${proposals.length}` }
      },
    }
  }
  return { connect, connections, dryRuns, proposals, state }
}
