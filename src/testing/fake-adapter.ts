import type { Connect, CustodyConnection, Me } from '../backend/adapter'

export const fakeMe: Me = {
  publicKey: 'cHVibGlj',
  domains: [{ id: 'd-1', alias: 'main', user: { id: 'u-1', alias: 'alice', roles: ['Author'] } }],
}

/** Fake Backend: records the connections it was given, so tests can see what was (not) read. */
export const createFakeAdapter = () => {
  const connections: CustodyConnection[] = []
  const connect: Connect = async connection => {
    connections.push(connection)
    return { getMe: async () => fakeMe }
  }
  return { connect, connections }
}
