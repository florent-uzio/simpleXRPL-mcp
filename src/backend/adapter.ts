// The only module that imports `simplexrpl` (pre-1.0, pinned): everything else uses this interface.
import {
  RippleCustody,
  generateCustodyKeypair,
  uuidV7,
  type CustodyKeyAlgorithm,
  type CustodyProposePayload,
  type CustodyTransactionDryRun,
  type CustodyTransactionOrder,
} from 'simplexrpl'
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

/** The operations sent as Native operations; each tool builds one of them. */
type NativeOperationType =
  | 'Payment'
  | 'MPTokenIssuanceCreate'
  | 'MPTokenAuthorize'
  | 'MPTokenIssuanceSet'
  | 'MPTokenIssuanceDestroy'
  | 'ConfidentialMPTConvert'
  | 'ConfidentialMPTConvertBack'
  | 'ConfidentialMPTMergeInbox'
  | 'SponsorshipSetAsSponsor'
  | 'SponsorshipSetAsSponsee'
  | 'Batch'

/** A Native operation sent from an XRPL address, with the order fields simplexrpl passes on. */
export type NativeOrder<Type extends NativeOperationType = NativeOperationType> = Pick<
  CustodyTransactionOrder,
  'account' | 'ledgerId' | 'memos' | 'sourceTag' | 'maximumFee' | 'feeStrategy'
> & { operation: Extract<CustodyTransactionOrder['operation'], { type: Type }> }

type BatchOperation = NativeOrder<'Batch'>['operation']

/** One account that must sign the Batch: sign `signingPayload`, return it as a `batchSigner` for `participant`. */
export type BatchSigningRequirement = {
  account: string
  participant: BatchOperation['batchSigners'][number]['participant']
  signingPayload: string
}

/** A Batch's Dry run also lists the accounts that must sign it. */
export type NativeDryRunResult = DryRunResult & { executionMode?: string; signers?: BatchSigningRequirement[] }

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

/** The MPT issuance an Intent created, or why it is not readable yet when the wait ran out. */
export type MptIssuanceIdOutcome = { intentId: string; issuanceId?: string; reason?: string }

export interface CustodyBackend {
  /** The Environment's configured default domain, if any. */
  readonly domainId?: string
  getMe(): Promise<Me>
  /** Follows an Intent until it ends or `timeoutMs` runs out; an Intent still awaiting approval is an outcome, not an error. */
  waitForIntent(intentId: string, options?: { timeoutMs?: number }): Promise<IntentOutcome>
  /** Dry-runs the order with the defaults `propose` applies. A Batch's result also lists its `signers`. */
  dryRun(order: NativeOrder): Promise<NativeDryRunResult>
  /** Proposes the Intent and returns as soon as the Backend accepted it, without waiting for approvals. */
  propose(order: NativeOrder): Promise<{ intentId: string }>
  listAccounts(options: { domainId: string; limit?: number; cursor?: string }): Promise<AccountsPage>
  /**
   * Waits up to `timeoutMs` (default 30 s; 0 looks once) for the MPT issuance ID an MPTokenIssuanceCreate Intent
   * created. Custody records it a few seconds after the Intent executes; not being there yet is an outcome, not an error.
   */
  getMptIssuanceId(options: { intentId: string; domainId: string; timeoutMs?: number }): Promise<MptIssuanceIdOutcome>
}

export type Connect = (connection: CustodyConnection) => Promise<CustodyBackend>

/** A Native operation order as Custody dry-runs and proposes it. */
export type TransactionOrderPayload = Extract<CustodyProposePayload, { type: 'v0_CreateTransactionOrder' }>

/** The Ripple Custody API calls the adapter makes: simplexrpl in production, in memory in tests. */
export interface CustodyApi {
  /** The account in the session's Domain that holds an XRPL address, if any. */
  findAccount(address: string, ledgerId?: string): Promise<{ accountId: string; ledgerId: string } | undefined>
  dryRun(payload: TransactionOrderPayload): Promise<CustodyTransactionDryRun>
  /** Proposes the payload as an Intent, whose id is the payload's `id`. */
  propose(payload: TransactionOrderPayload): Promise<{ intentId: string }>
  getMe(): Promise<Me>
  /** One page of a Domain's accounts. */
  getAccounts(options: { domainId: string; limit?: number; cursor?: string }): Promise<{
    accounts: { id: string; alias: string }[]
    nextCursor?: string
  }>
  /** Every ledger, with its type (`XRPL`, ...). */
  listLedgers(): Promise<{ id: string; type: string }[]>
  /** Every address of an account. */
  listAddresses(options: {
    domainId: string
    accountId: string
  }): Promise<{ address: string; ledgerId: string; scope: string }[]>
  /** The ids of the transactions an order produced. */
  listOrderTransactionIds(options: { domainId: string; orderId: string }): Promise<string[]>
  getTransaction(options: { domainId: string; transactionId: string }): Promise<CustodyTransaction>
  waitForIntent(intentId: string, options: { timeoutMs?: number }): Promise<IntentOutcome>
}

/**
 * The MPT issuance ID created by an Intent, from the detailed transactions its order produced.
 * Pending until Custody has registered the transaction and filled in its ledger data; throws when it never will.
 */
const mptIssuanceIdOf = (intentId: string, transactions: CustodyTransaction[]): Attempt<string> => {
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

/** The Ripple Custody Backend over the Custody API calls it makes. */
export const rippleCustodyBackend = (api: CustodyApi, { domainId }: { domainId?: string }): CustodyBackend => {
  // Built once for both, so the Dry run checks exactly the order that would be proposed. Same defaults as simplexrpl.
  const payloadOf = async (order: NativeOrder): Promise<TransactionOrderPayload | undefined> => {
    const reference = await api.findAccount(order.account, order.ledgerId)
    if (!reference) return undefined
    return {
      id: uuidV7(),
      accountId: reference.accountId,
      ledgerId: reference.ledgerId,
      parameters: {
        feeStrategy: order.feeStrategy ?? { priority: 'Low', type: 'Priority' },
        maximumFee: order.maximumFee,
        sourceTag: order.sourceTag,
        memos: [...(order.memos ?? [])],
        operation: order.operation,
        type: 'XRPL',
      },
      customProperties: {},
      type: 'v0_CreateTransactionOrder',
    }
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
    dryRun: async order => {
      const isBatch = order.operation.type === 'Batch'
      const payload = await payloadOf(order)
      if (!payload) return isBatch ? { ...noAccount(order.account), signers: [] } : noAccount(order.account)
      const dryRun = await api.dryRun(payload)
      if (!isBatch) return summarize(dryRun)
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
    propose: async order => {
      const payload = await payloadOf(order)
      if (!payload) throw new Error(`No account in the Domain holds ${order.account}`)
      return api.propose(payload)
    },
    domainId,
    listAccounts: async ({ domainId, limit, cursor }) => {
      const page = await api.getAccounts({ domainId, limit, cursor })
      // Only addresses on XRPL ledgers count as XRPL addresses.
      const xrplLedgers = new Set(
        (await api.listLedgers()).filter(ledger => ledger.type === 'XRPL').map(({ id }) => id),
      )
      const accounts: AccountSummary[] = []
      for (const { id, alias } of page.accounts) {
        const addresses = (await api.listAddresses({ domainId, accountId: id }))
          .filter(entry => entry.scope === 'External' && xrplLedgers.has(entry.ledgerId))
          .map(({ address, ledgerId }) => ({ address, ledgerId }))
        accounts.push({ id, alias, addresses })
      }
      return page.nextCursor ? { accounts, nextCursor: page.nextCursor } : { accounts }
    },
    getMptIssuanceId: async ({ intentId, domainId, timeoutMs = 30_000 }) => {
      const attempt = async () => {
        // The order id is the intentId. The list projection omits ledger data, so read each transaction in full.
        const ids = await api.listOrderTransactionIds({ domainId, orderId: intentId })
        const transactions = await Promise.all(
          ids.map(transactionId => api.getTransaction({ domainId, transactionId })),
        )
        return mptIssuanceIdOf(intentId, transactions)
      }
      const result = await pollUntil(attempt, { timeoutMs, intervalMs: 3000 })
      return 'value' in result ? { intentId, issuanceId: result.value } : { intentId, reason: result.pending }
    },
    getMe: () => api.getMe(),
    waitForIntent: (intentId, options) => api.waitForIntent(intentId, { timeoutMs: options?.timeoutMs }),
  }
}

/** The Custody API calls of a simplexrpl Ripple Custody session. Kept to plain mapping: the logic is above. */
const simplexrplCustodyApi = (custody: RippleCustody): CustodyApi => ({
  // The Domain the session proposes in, as simplexrpl's own sender lookup does.
  findAccount: (address, ledgerId) => custody.api.findByAddress(address, { ledgerId, domainId: custody.domainId }),
  dryRun: async payload => (await custody.api.dryRun(payload)) as CustodyTransactionDryRun,
  propose: async payload => {
    const { intentId } = await custody.api.propose(payload)
    return { intentId }
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
  getAccounts: async ({ domainId, limit, cursor }) => {
    const page = await custody.api.call('getAccounts', { path: { domainId }, query: { limit, startingAfter: cursor } })
    return {
      accounts: page.items.map(item => ({ id: item.data.id, alias: item.data.alias })),
      nextCursor: page.nextStartingAfter,
    }
  },
  // Custody's max page size is 100.
  listLedgers: async () => {
    const ledgers: { id: string; type: string }[] = []
    for await (const ledger of custody.api.paginate('getLedgers', { query: { limit: 100 } })) {
      ledgers.push({ id: ledger.data.id, type: ledger.data.parameters.type })
    }
    return ledgers
  },
  listAddresses: async ({ domainId, accountId }) => {
    const addresses: { address: string; ledgerId: string; scope: string }[] = []
    for await (const entry of custody.api.paginate('getAddresses', {
      path: { domainId, accountId },
      query: { limit: 100 },
    })) {
      addresses.push({ address: entry.data.address, ledgerId: entry.data.ledgerId, scope: entry.data.scope })
    }
    return addresses
  },
  listOrderTransactionIds: async ({ domainId, orderId }) => {
    const { items } = await custody.api.call('getTransactions', {
      path: { domainId },
      query: { 'orderReference.Id': orderId },
    })
    return items.map(item => item.id)
  },
  getTransaction: ({ domainId, transactionId }) =>
    custody.api.call('getTransaction', { path: { domainId, transactionId } }),
  waitForIntent: async (intentId, { timeoutMs }) => {
    const outcome = await custody.api.waitForIntent(intentId, { timeoutMs })
    return {
      intentId: outcome.intentId,
      status: outcome.status,
      isTerminal: outcome.isTerminal,
      isSuccess: outcome.isSuccess,
      reason: outcome.reason,
    }
  },
})

export const connectRippleCustody: Connect = async connection => {
  const custody = await RippleCustody.create({
    gatewayUrl: connection.rippleCustodyApiUrl,
    auth: { tokenUrl: connection.rippleCustodyTokenUrl, signingKey: connection.signingKey },
    domainId: connection.domainId,
    primary: connection.primary,
    allowRawSigning: connection.allowRawSigning,
  })
  return rippleCustodyBackend(simplexrplCustodyApi(custody), { domainId: connection.domainId })
}

export type { CustodyKeyAlgorithm }
export type Keypair = { privateKey: string; publicKey: string }
export type GenerateKeypair = (algorithm: CustodyKeyAlgorithm) => Promise<Keypair>

/** A new Ripple Custody API user key: a PKCS#8 PEM private key and the base64 public key Custody registers. */
export const generateKeypair: GenerateKeypair = async algorithm => {
  const { privateKey, publicKey } = await generateCustodyKeypair(algorithm)
  return { privateKey, publicKey }
}
