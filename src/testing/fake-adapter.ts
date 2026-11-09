import type { AccountSummary, Connect, CustodyConnection, Me } from '../backend/adapter'

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
    }
  }
  const setDomains = (ids: string[]) => {
    me = { ...fakeMe, domains: ids.map(id => ({ ...fakeMe.domains[0], id, alias: id })) }
  }
  return { connect, connections, listCalls, setDomains }
}
