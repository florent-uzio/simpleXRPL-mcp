// The only module that imports `simplexrpl` (pre-1.0, pinned): everything else uses this interface.
import {
  RippleCustody,
  generateCustodyKeypair,
  type CustodyKeyAlgorithm,
  type CustodyTransactionOrder,
} from 'simplexrpl'
import { xrpToDrops } from 'xrpl'

export type CustodyConnection = {
  rippleCustodyApiUrl: string
  rippleCustodyTokenUrl: string
  domainId?: string
  primary: string
  signingKey: string
  allowRawSigning: boolean
}

export type Me = {
  publicKey: string
  domains: { id: string; alias: string; user: { id: string; alias: string; roles: string[] } }[]
}

export type IntentOutcome = {
  intentId: string
  status: string | undefined
  isTerminal: boolean
  isSuccess: boolean
  reason: string | undefined
}

export type XrpTransfer = {
  to: string
  /** Decimal XRP, e.g. '10' or '0.25'. */
  amount: string
  /** Source r-address. */
  from: string
}

/** A native non-Payment operation (MPT, sponsorship), sent from an XRPL address with optional memos. */
export type MptOrder = Pick<CustodyTransactionOrder, 'account' | 'ledgerId' | 'memos'> & {
  operation: Extract<
    CustodyTransactionOrder['operation'],
    {
      type:
        | 'MPTokenIssuanceCreate'
        | 'MPTokenAuthorize'
        | 'MPTokenIssuanceSet'
        | 'MPTokenIssuanceDestroy'
        | 'ConfidentialMPTConvert'
        | 'ConfidentialMPTConvertBack'
        | 'ConfidentialMPTMergeInbox'
        | 'SponsorshipSetAsSponsor'
        | 'SponsorshipSetAsSponsee'
    }
  >
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
  /** Follows an Intent until it ends or `timeoutMs` runs out; an Intent still awaiting approval is an outcome, not an error. */
  waitForIntent(intentId: string, options?: { timeoutMs?: number }): Promise<IntentOutcome>
  dryRunXrpTransfer(transfer: XrpTransfer): Promise<DryRunResult>
  /** Proposes the Intent and returns as soon as the Backend accepted it, without waiting for approvals. */
  proposeXrpTransfer(transfer: XrpTransfer): Promise<{ intentId: string }>
  dryRunMpt(order: MptOrder): Promise<DryRunResult>
  /** Proposes the Intent and returns as soon as the Backend accepted it, without waiting for approvals. */
  proposeMpt(order: MptOrder): Promise<{ intentId: string }>
  listAccounts(options: { domainId: string; limit?: number; cursor?: string }): Promise<AccountsPage>
}

export type Connect = (connection: CustodyConnection) => Promise<CustodyBackend>

export const connectRippleCustody: Connect = async connection => {
  const custody = await RippleCustody.create({
    gatewayUrl: connection.rippleCustodyApiUrl,
    auth: { tokenUrl: connection.rippleCustodyTokenUrl, signingKey: connection.signingKey },
    domainId: connection.domainId,
    primary: connection.primary,
    allowRawSigning: connection.allowRawSigning,
  })
  const paymentFor = ({ to, amount, from }: XrpTransfer) => ({
    TransactionType: 'Payment' as const,
    Account: from,
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
    dryRunMpt: async order => {
      // The library only dry-runs xrpl transactions, which cannot carry every native MPT flag, so build the order here.
      const reference = await custody.api.findByAddress(order.account, {
        ledgerId: order.ledgerId,
        domainId: connection.domainId,
      })
      if (!reference) return { success: false, errors: [`No account in the Domain holds ${order.account}`] }
      const dryRun = await custody.api.dryRun({
        id: crypto.randomUUID(),
        accountId: reference.accountId,
        ledgerId: reference.ledgerId,
        parameters: {
          feeStrategy: { priority: 'Low', type: 'Priority' },
          memos: [...(order.memos ?? [])],
          operation: order.operation,
          type: 'XRPL',
        },
        customProperties: {},
        type: 'v0_CreateTransactionOrder',
      })
      return {
        success: dryRun.success,
        errors: dryRun.errors ?? [],
        estimatedFeeDrops:
          dryRun.type === 'v0_CreateTransactionOrder' && dryRun.estimate.type === 'XRPL'
            ? dryRun.estimate.fee
            : undefined,
      }
    },
    proposeMpt: async order => {
      const { intentId } = await custody.api.proposeTransactionOrder(order)
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
    waitForIntent: async (intentId, options) => {
      const outcome = await custody.api.waitForIntent(intentId, { timeoutMs: options?.timeoutMs })
      return {
        intentId: outcome.intentId,
        status: outcome.status,
        isTerminal: outcome.isTerminal,
        isSuccess: outcome.isSuccess,
        reason: outcome.reason,
      }
    },
  }
}

export type { CustodyKeyAlgorithm }
export type Keypair = { privateKey: string; publicKey: string }
export type GenerateKeypair = (algorithm: CustodyKeyAlgorithm) => Promise<Keypair>

/** A new Ripple Custody API user key: a PKCS#8 PEM private key and the base64 public key Custody registers. */
export const generateKeypair: GenerateKeypair = async algorithm => {
  const { privateKey, publicKey } = await generateCustodyKeypair(algorithm)
  return { privateKey, publicKey }
}
