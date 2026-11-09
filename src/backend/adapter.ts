// The only module that imports `simplexrpl` (pre-1.0, pinned): everything else uses this interface.
import { RippleCustody } from 'simplexrpl'

/** Whole XRP to drops, exact (no floating point). The tool schema has already validated the format. */
const xrpToDrops = (xrp: string) => {
  const [whole, fraction = ''] = xrp.split('.')
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString()
}

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

export interface CustodyBackend {
  getMe(): Promise<Me>
  dryRunXrpTransfer(transfer: XrpTransfer): Promise<DryRunResult>
  /** Proposes the Intent and returns as soon as the Backend accepted it, without waiting for approvals. */
  proposeXrpTransfer(transfer: XrpTransfer): Promise<{ intentId: string }>
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
