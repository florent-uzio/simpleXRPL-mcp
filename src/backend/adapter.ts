// The only module that imports `simplexrpl` (pre-1.0, pinned): everything else uses this interface.
import {
  RippleCustody,
  generateCustodyKeypair,
  type CustodyKeyAlgorithm,
  type CustodyTransactionDryRun,
  type CustodyTransactionOrder,
} from 'simplexrpl'
import { xrpToDrops } from 'xrpl'
import { pollUntil, type Attempt } from './poll'

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

/** A native Payment of XRP, an IOU, an MPT or a Custody ticker, with the order fields simplexrpl passes on. */
export type PaymentOrder = Pick<
  CustodyTransactionOrder,
  'account' | 'ledgerId' | 'memos' | 'sourceTag' | 'maximumFee' | 'feeStrategy'
> & { operation: Extract<CustodyTransactionOrder['operation'], { type: 'Payment' }> }

type BatchOperation = Extract<CustodyTransactionOrder['operation'], { type: 'Batch' }>

/** A native Batch, sent from the submitter's XRPL address. `batchSigners` is empty for a Dry run. */
export type BatchOrder = Pick<CustodyTransactionOrder, 'account' | 'ledgerId' | 'memos'> & { operation: BatchOperation }

/** One account that must sign the Batch: sign `signingPayload`, return it as a `batchSigner` for `participant`. */
export type BatchSigningRequirement = {
  account: string
  participant: BatchOperation['batchSigners'][number]['participant']
  signingPayload: string
}

export type BatchDryRunResult = DryRunResult & { executionMode?: string; signers: BatchSigningRequirement[] }

export type DryRunResult = { success: boolean; errors: string[]; estimatedFeeDrops?: string }

export type AccountSummary = {
  id: string
  alias: string
  addresses: { address: string; ledgerId: string }[]
}

export type AccountsPage = { accounts: AccountSummary[]; nextCursor?: string }

/** The part of a Custody transaction (per-transaction detail, not the list projection) that holds an MPT issuance. */
export type CustodyTransaction = {
  ledgerTransactionData?: {
    ledgerData?: { type: string; transactionType?: string; tokenData?: { issuanceId: string } } | null
  } | null
}

/**
 * The MPT issuance ID created by an Intent, from the detailed transactions its order produced.
 * Pending until Custody has registered the transaction and filled in its ledger data; throws when it never will.
 */
export const mptIssuanceIdOf = (intentId: string, transactions: CustodyTransaction[]): Attempt<string> => {
  const ledgerData = transactions.flatMap(({ ledgerTransactionData }) =>
    ledgerTransactionData?.ledgerData?.type === 'Xrpl' ? [ledgerTransactionData.ledgerData] : [],
  )
  // Other MPT transactions carry the issuance they act on: only a create's is the one this Intent made.
  const other = ledgerData.find(data => data.transactionType && data.transactionType !== 'MPTokenIssuanceCreate')
  if (other)
    throw new Error(`Intent ${intentId} is not an MPTokenIssuanceCreate: its transaction is ${other.transactionType}.`)
  const ids = new Set(ledgerData.flatMap(data => (data.tokenData ? [data.tokenData.issuanceId] : [])))
  if (ids.size > 1) throw new Error(`Intent ${intentId} produced several MPT issuances: ${[...ids].join(', ')}.`)
  if (ids.size === 1) return { value: [...ids][0] }
  return transactions.length === 0
    ? { pending: `No transaction is registered yet for Intent ${intentId}.` }
    : { pending: `The transaction of Intent ${intentId} carries no MPT issuance ID yet.` }
}

/** The MPT issuance an Intent created, or why it is not readable yet when the wait ran out. */
export type MptIssuanceIdOutcome = { intentId: string; issuanceId?: string; reason?: string }

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
  dryRunPayment(order: PaymentOrder): Promise<DryRunResult>
  /** Proposes the Intent and returns as soon as the Backend accepted it, without waiting for approvals. */
  proposePayment(order: PaymentOrder): Promise<{ intentId: string }>
  dryRunBatch(order: BatchOrder): Promise<BatchDryRunResult>
  /** Proposes the Batch and returns as soon as the Backend accepted it, without waiting for approvals. */
  proposeBatch(order: BatchOrder): Promise<{ intentId: string }>
  listAccounts(options: { domainId: string; limit?: number; cursor?: string }): Promise<AccountsPage>
  /**
   * Waits up to `timeoutMs` (default 30 s; 0 looks once) for the MPT issuance ID an MPTokenIssuanceCreate Intent
   * created. Custody records it a few seconds after the Intent executes; not being there yet is an outcome, not an error.
   */
  getMptIssuanceId(options: { intentId: string; domainId: string; timeoutMs?: number }): Promise<MptIssuanceIdOutcome>
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
  // The library only dry-runs xrpl transactions, which cannot carry every native operation, so build the order here.
  const dryRunNative = async (
    order: Pick<
      CustodyTransactionOrder,
      'account' | 'ledgerId' | 'memos' | 'operation' | 'sourceTag' | 'maximumFee' | 'feeStrategy'
    >,
  ): Promise<CustodyTransactionDryRun | undefined> => {
    const reference = await custody.api.findByAddress(order.account, {
      ledgerId: order.ledgerId,
      domainId: connection.domainId,
    })
    if (!reference) return undefined
    return (await custody.api.dryRun({
      id: crypto.randomUUID(),
      accountId: reference.accountId,
      ledgerId: reference.ledgerId,
      parameters: {
        // Same defaults as proposeTransactionOrder, so the Dry run checks the order that would be proposed.
        feeStrategy: order.feeStrategy ?? { priority: 'Low', type: 'Priority' },
        maximumFee: order.maximumFee,
        sourceTag: order.sourceTag,
        memos: [...(order.memos ?? [])],
        operation: order.operation,
        type: 'XRPL',
      },
      customProperties: {},
      type: 'v0_CreateTransactionOrder',
    })) as CustodyTransactionDryRun
  }
  const noAccount = (account: string): DryRunResult => ({
    success: false,
    errors: [`No account in the Domain holds ${account}`],
  })
  const summarize = (dryRun: CustodyTransactionDryRun): DryRunResult => ({
    success: dryRun.success,
    errors: dryRun.errors ?? [],
    estimatedFeeDrops: dryRun.estimate.type === 'XRPL' ? dryRun.estimate.fee : undefined,
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
      const dryRun = await dryRunNative(order)
      return dryRun ? summarize(dryRun) : noAccount(order.account)
    },
    dryRunPayment: async order => {
      const dryRun = await dryRunNative(order)
      return dryRun ? summarize(dryRun) : noAccount(order.account)
    },
    proposePayment: async order => {
      const { intentId } = await custody.api.proposeTransactionOrder(order)
      return { intentId }
    },
    dryRunBatch: async order => {
      const dryRun = await dryRunNative(order)
      if (!dryRun) return { ...noAccount(order.account), signers: [] }
      const signing = dryRun.estimate.type === 'XRPL' ? dryRun.estimate.batchSigningData : undefined
      return {
        ...summarize(dryRun),
        executionMode: signing?.executionMode,
        signers: (signing?.signers ?? []).map(({ account, participant, signingPayload }) => ({
          account,
          participant,
          signingPayload,
        })),
      }
    },
    proposeBatch: async order => {
      const { intentId } = await custody.api.proposeTransactionOrder(order)
      return { intentId }
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
    getMptIssuanceId: async ({ intentId, domainId, timeoutMs = 30_000 }) => {
      const attempt = async () => {
        // The order id is the intentId. The list projection omits ledger data, so read each transaction in full.
        const { items } = await custody.api.call('getTransactions', {
          path: { domainId },
          query: { 'orderReference.Id': intentId },
        })
        const transactions = await Promise.all(
          items.map(item => custody.api.call('getTransaction', { path: { domainId, transactionId: item.id } })),
        )
        return mptIssuanceIdOf(intentId, transactions)
      }
      const result = await pollUntil(attempt, { timeoutMs, intervalMs: 3000 })
      return 'value' in result ? { intentId, issuanceId: result.value } : { intentId, reason: result.pending }
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
