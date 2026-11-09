// The only module that imports `simplexrpl` (pre-1.0, pinned): everything else uses this interface.
import { RippleCustody } from 'simplexrpl'
import { xrpToDrops } from 'xrpl'

export type CustodyConnection = {
  gatewayUrl: string
  tokenUrl: string
  clientId?: string
  domainId?: string
  primary: string
  signingKey: string
  allowRawSigning: boolean
}

export type Me = {
  publicKey: string
  domains: { id: string; alias: string; user: { id: string; alias: string; roles: string[] } }[]
}

export type XrpTransfer = {
  to: string
  /** Decimal XRP, e.g. '10' or '0.25'. */
  amount: string
  /** Source address; the Environment's primary account when omitted. */
  from?: string
}

export type DryRunResult = { success: boolean; errors: string[]; estimatedFeeDrops?: string }

export type AccountSummary = {
  id: string
  alias: string
  addresses: { address: string; ledgerId: string }[]
}

export type AccountsPage = { accounts: AccountSummary[]; nextCursor?: string }

export interface CustodyBackend {
  /** The Environment's configured default domain, if any. */
  readonly domainId?: string
  getMe(): Promise<Me>
  dryRunXrpTransfer(transfer: XrpTransfer): Promise<DryRunResult>
  /** Proposes the Intent and returns as soon as the Backend accepted it, without waiting for approvals. */
  proposeXrpTransfer(transfer: XrpTransfer): Promise<{ intentId: string }>
  listAccounts(options: { domainId: string; limit?: number; cursor?: string }): Promise<AccountsPage>
}

export type Connect = (connection: CustodyConnection) => Promise<CustodyBackend>

export const connectRippleCustody: Connect = async connection => {
  const custody = await RippleCustody.create({
    gatewayUrl: connection.gatewayUrl,
    auth: { tokenUrl: connection.tokenUrl, clientId: connection.clientId, signingKey: connection.signingKey },
    domainId: connection.domainId,
    primary: connection.primary,
    allowRawSigning: connection.allowRawSigning,
  })
  const paymentFor = ({ to, amount, from }: XrpTransfer) => ({
    TransactionType: 'Payment' as const,
    Account: from ?? custody.primary.address,
    Destination: to,
    Amount: xrpToDrops(amount),
  })
  return {
    dryRunXrpTransfer: async transfer => {
      const dryRun = await custody.api.dryRunTransaction(paymentFor(transfer))
      return {
        success: dryRun.success,
        errors: dryRun.errors ?? [],
        estimatedFeeDrops: dryRun.estimate.type === 'XRPL' ? dryRun.estimate.fee : undefined,
      }
    },
    proposeXrpTransfer: async transfer => {
      const payment = paymentFor(transfer)
      const { intentId } = await custody.api.proposeTransactionOrder({
        account: payment.Account,
        operation: {
          type: 'Payment',
          destination: { type: 'Address', address: payment.Destination },
          amount: payment.Amount,
        },
      })
      return { intentId }
    },
    domainId: connection.domainId,
    listAccounts: async ({ domainId, limit, cursor }) => {
      const page = await custody.api.call('getAccounts', {
        path: { domainId },
        query: { limit, startingAfter: cursor },
      })
      // Cost: one ledger lookup per page and one address call per account (Custody's max page size is 100).
      // Only addresses on XRPL ledgers count as XRPL addresses.
      const xrplLedgers = new Set<string>()
      for await (const ledger of custody.api.paginate('getLedgers', { query: { limit: 100 } })) {
        if (ledger.data.parameters.type === 'XRPL') xrplLedgers.add(ledger.data.id)
      }
      const accounts: AccountSummary[] = []
      for (const item of page.items) {
        const addresses: AccountSummary['addresses'] = []
        for await (const entry of custody.api.paginate('getAddresses', {
          path: { domainId, accountId: item.data.id },
          query: { limit: 100 },
        })) {
          if (entry.data.scope === 'External' && xrplLedgers.has(entry.data.ledgerId)) {
            addresses.push({ address: entry.data.address, ledgerId: entry.data.ledgerId })
          }
        }
        accounts.push({ id: item.data.id, alias: item.data.alias, addresses })
      }
      return page.nextStartingAfter ? { accounts, nextCursor: page.nextStartingAfter } : { accounts }
    },
    getMe: async () => {
      const me = await custody.api.call('getMe')
      return {
        publicKey: me.publicKey,
        domains: me.domains.map(domain => ({
          id: domain.id,
          alias: domain.alias,
          user: { id: domain.userReference.id, alias: domain.userReference.alias, roles: domain.userReference.roles },
        })),
      }
    },
  }
}
