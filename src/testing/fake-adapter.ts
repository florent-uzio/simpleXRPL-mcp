import type { Connect, CustodyConnection, IntentOutcome, Me } from '../backend/adapter'

export const fakeMe: Me = {
  publicKey: 'cHVibGlj',
  domains: [{ id: 'd-1', alias: 'main', user: { id: 'u-1', alias: 'alice', roles: ['Author'] } }],
}

/** Fake Backend: records the connections it was given, so tests can see what was (not) read. */
export const createFakeAdapter = () => {
  const connections: CustodyConnection[] = []
  const waits: { intentId: string; timeoutMs?: number }[] = []
  const state: { outcome: IntentOutcome | Error } = {
    outcome: { intentId: '', status: 'Executed', isTerminal: true, isSuccess: true, reason: undefined },
  }
  const connect: Connect = async connection => {
    connections.push(connection)
    return {
      getMe: async () => fakeMe,
      waitForIntent: async (intentId, options) => {
        waits.push({ intentId, timeoutMs: options?.timeoutMs })
        if (state.outcome instanceof Error) throw state.outcome
        return { ...state.outcome, intentId }
      },
    }
  }
  return { connect, connections, waits, state }
}
