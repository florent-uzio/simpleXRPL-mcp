import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type {
  ClientReadParams,
  ClientReadVerb,
  ClientVerbs,
  ClientWriteParams,
  ClientWriteVerb,
  CustodyBackend,
} from '../backend/adapter'
import { ToolFailure, type Runtime } from '../environments/runtime'

export const CLIENT_WRITE =
  "Calls the simpleXRPL client verb, which picks the signing path itself: a Native operation Intent on Ripple Custody (`source: custody`) or, for other transaction types, Raw signing when the Environment allows it (`source: xrpld`). Custody runs a Dry run first and nothing is submitted if it fails; there is no Dry-run-only mode. Waits for the outcome: if the Intent is still awaiting approval when the wait ends, returns `pending: true` with its `intentId`, to follow with waitForIntent. Pass a result's `idempotencyKey` back to retry without a duplicate. Needs the `propose` Access level, a named Environment and its `xrpldUrl`."

const CLIENT_READ = "Reads through the simpleXRPL client, from the Environment's `xrpldUrl`."

const clientOf = (backend: CustodyBackend): Promise<ClientVerbs> => {
  if (!backend.client) {
    throw new ToolFailure(
      'xrpld-url-required',
      "The client verb tools need the Environment's `xrpldUrl` (a wss:// XRPL node URL): add it to the Environment in the config file, or re-run add-env with --xrpld-url.",
    )
  }
  return backend.client()
}

const ROUTES: Record<string, string> = { custody: 'native-operation', xrpld: 'raw-signing' }

const writeShape = {
  environment: z.string().describe('Environment name; required, a write never uses the default'),
  from: z
    .string()
    .optional()
    .describe("Acting r-address, an account held in the Environment; the Environment's primary when omitted"),
  idempotencyKey: z
    .string()
    .optional()
    .describe('The `idempotencyKey` of an earlier result, to retry it without creating a duplicate'),
}

/** A tool calling one client verb that writes. Always pre-flights; a pending Intent is an outcome, not an error. */
const clientWriteTool = <Verb extends ClientWriteVerb, Shape extends z.ZodRawShape>(
  runtime: Runtime,
  options: {
    id: string
    verb: Verb
    description: string
    shape: Shape
    params: (input: z.infer<z.ZodObject<Shape>>) => ClientWriteParams<Verb>
  },
) =>
  createTool({
    id: options.id,
    description: `Calls client.${options.verb}. ${options.description} ${CLIENT_WRITE}`,
    inputSchema: z.object({ ...writeShape, ...options.shape }),
    execute: raw => {
      const input = raw as { environment: string; from?: string; idempotencyKey?: string } & z.infer<z.ZodObject<Shape>>
      const { environment, from, idempotencyKey, ...rest } = input
      return runtime.run({ environment, requires: 'propose' }, async backend => {
        const client = await clientOf(backend)
        const params = options.params(rest as unknown as z.infer<z.ZodObject<Shape>>)
        const outcome = await client.write(options.verb, params, { from, idempotencyKey, dryRun: true })
        const verb = `client.${options.verb}`
        if (outcome.status === 'failed') throw new ToolFailure(outcome.code, outcome.message)
        if (outcome.status === 'pending') {
          return { verb, pending: true, intentId: outcome.intentId, lastState: outcome.lastState }
        }
        const { status: _status, ...done } = outcome
        return { verb, pending: false, route: ROUTES[done.source] ?? done.source, ...done }
      })
    },
  })

/** A tool calling one client verb that reads. */
const clientReadTool = <Verb extends ClientReadVerb, Shape extends z.ZodRawShape>(
  runtime: Runtime,
  options: {
    id: string
    verb: Verb
    description: string
    shape: Shape
    params: (input: z.infer<z.ZodObject<Shape>>) => ClientReadParams<Verb>
  },
) =>
  createTool({
    id: options.id,
    description: `Calls client.${options.verb}. ${options.description} ${CLIENT_READ}`,
    inputSchema: z.object({
      environment: z.string().optional().describe('Environment name; the default when omitted'),
      ...options.shape,
    }),
    execute: raw => {
      const { environment, ...rest } = raw as { environment?: string } & z.infer<z.ZodObject<Shape>>
      return runtime.run({ environment, requires: 'read' }, async backend => {
        const client = await clientOf(backend)
        const result = await client.read(options.verb, options.params(rest as unknown as z.infer<z.ZodObject<Shape>>))
        return { verb: `client.${options.verb}`, result }
      })
    },
  })

const address = (what: string) => z.string().describe(what)
const xrpAmount = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'a non-negative decimal XRP amount with at most 6 decimal places')
  .describe("Amount in XRP, as a decimal string, e.g. '10' or '0.25'")
const decimal = (what: string) =>
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'a non-negative decimal string')
    .describe(what)
const ticker = z.string().min(1).describe("Currency code, e.g. 'USD'; longer codes are hex-encoded")
const mptIssuanceId = z.string().min(1).describe('MPT issuance ID')

export const createClientVerbTools = (runtime: Runtime) => ({
  clientXrpTransfer: clientWriteTool(runtime, {
    id: 'clientXrpTransfer',
    verb: 'xrp.transfer',
    description: 'Sends XRP from `from`.',
    shape: { to: address('Destination r-address'), amount: xrpAmount },
    params: ({ to, amount }) => ({ to, amount }),
  }),
  clientIouIssue: clientWriteTool(runtime, {
    id: 'clientIouIssue',
    verb: 'iou.issue',
    description:
      'Sets up an IOU issued by `from`: `holder` opens a trust line to the issuer and, with `amount`, the issuer pays that amount to it. Both accounts must be held by the Environment. Several transactions: a failure names the steps already committed.',
    shape: {
      ticker,
      holder: address('Holder r-address that opens the trust line, an account held in the Environment'),
      amount: decimal('Amount to pay to the holder once the trust line exists; omit to only open it').optional(),
    },
    params: ({ ticker, holder, amount }) => ({ ticker, holder, amount }),
  }),
  clientIouAuthorize: clientWriteTool(runtime, {
    id: 'clientIouAuthorize',
    verb: 'iou.authorize',
    description:
      "The issuer (`from`) authorizes `holder`'s trust line for its IOU. Only meaningful when the issuer has `requireAuth` set; cannot be undone.",
    shape: { ticker, holder: address('Holder r-address to authorize') },
    params: ({ ticker, holder }) => ({ ticker, holder }),
  }),
  clientIouTransfer: clientWriteTool(runtime, {
    id: 'clientIouTransfer',
    verb: 'iou.transfer',
    description: 'The issuer (`from`) sends its IOU to `to`, which must hold a trust line to it.',
    shape: { ticker, to: address('Destination r-address'), amount: decimal('Amount, as a decimal string') },
    params: ({ ticker, to, amount }) => ({ ticker, to, amount }),
  }),
  clientIouClawback: clientWriteTool(runtime, {
    id: 'clientIouClawback',
    verb: 'iou.clawback',
    description: 'The issuer (`from`) claws back its IOU from `holder`. The issuer must have `clawbackEnabled` set.',
    shape: { ticker, holder: address('Holder r-address'), amount: decimal('Amount, as a decimal string') },
    params: ({ ticker, holder, amount }) => ({ ticker, holder, amount }),
  }),
  clientTokenIssue: clientWriteTool(runtime, {
    id: 'clientTokenIssue',
    verb: 'token.issue',
    description:
      "Creates an MPT issuance from `from`; the result's `intent.mptIssuanceId` is the new token. Flags are permanent; each omitted flag takes the simpleXRPL default (canLock, canEscrow, canTrade, canTransfer, canClawback true; requireAuth false).",
    shape: {
      metadata: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .describe('XLS-89 metadata, as an object (e.g. { ticker, name, issuer_name }) or a string'),
      assetScale: z.number().int().min(0).max(19).optional().describe('Decimal places (default 2)'),
      maximumAmount: z
        .string()
        .regex(/^\d+$/, 'an unsigned integer string')
        .optional()
        .describe('Maximum amount, in base units; uncapped when omitted'),
      transferFee: z.number().min(0).max(50).optional().describe('Transfer fee, as a percentage (0.5 = 0.5%)'),
      flags: z
        .object({
          canLock: z.boolean().optional(),
          requireAuth: z.boolean().optional(),
          canEscrow: z.boolean().optional(),
          canTrade: z.boolean().optional(),
          canTransfer: z.boolean().optional(),
          canClawback: z.boolean().optional(),
        })
        .optional()
        .describe('Capability flags'),
    },
    params: ({ metadata, assetScale, maximumAmount, transferFee, flags }) => ({
      metadata: metadata as ClientWriteParams<'token.issue'>['metadata'],
      assetScale,
      maximumAmount,
      transferFee,
      flags,
    }),
  }),
  clientTokenAuthorize: clientWriteTool(runtime, {
    id: 'clientTokenAuthorize',
    verb: 'token.authorize',
    description: 'The holder (`from`) opts in to hold an MPT.',
    shape: { mptIssuanceId },
    params: ({ mptIssuanceId }) => ({ mptIssuanceId }),
  }),
  clientTokenTransfer: clientWriteTool(runtime, {
    id: 'clientTokenTransfer',
    verb: 'token.transfer',
    description: 'Sends an MPT from `from` to `to`, which must have authorized it.',
    shape: {
      to: address('Destination r-address'),
      mptIssuanceId,
      value: decimal('Amount in display units, e.g. 10.5 with assetScale 2 is 1050 base units'),
      assetScale: z
        .number()
        .int()
        .min(0)
        .max(19)
        .default(0)
        .describe("The issuance's assetScale (default 0, so `value` is in base units)"),
    },
    params: ({ to, mptIssuanceId, value, assetScale }) => ({
      to,
      amount: { asset: { kind: 'mpt', mptIssuanceId, scale: assetScale }, value },
    }),
  }),
  clientTokenLock: clientWriteTool(runtime, {
    id: 'clientTokenLock',
    verb: 'token.lock',
    description: 'The issuer (`from`) locks an MPT, for one holder or the whole issuance.',
    shape: { mptIssuanceId, holder: address('Holder r-address; the whole issuance when omitted').optional() },
    params: ({ mptIssuanceId, holder }) => ({ mptIssuanceId, holder }),
  }),
  clientTokenUnlock: clientWriteTool(runtime, {
    id: 'clientTokenUnlock',
    verb: 'token.unlock',
    description: 'The issuer (`from`) unlocks an MPT, for one holder or the whole issuance.',
    shape: { mptIssuanceId, holder: address('Holder r-address; the whole issuance when omitted').optional() },
    params: ({ mptIssuanceId, holder }) => ({ mptIssuanceId, holder }),
  }),
  clientTokenDestroy: clientWriteTool(runtime, {
    id: 'clientTokenDestroy',
    verb: 'token.destroy',
    description: 'The issuer (`from`) destroys an MPT issuance that has none outstanding.',
    shape: { mptIssuanceId },
    params: ({ mptIssuanceId }) => ({ mptIssuanceId }),
  }),
  clientAccountSet: clientWriteTool(runtime, {
    id: 'clientAccountSet',
    verb: 'account.set',
    description:
      'Changes settings of `from` (AccountSet). Omitted fields stay unchanged. At most one flag can be turned on and one turned off per call. noFreeze, clawbackEnabled, trustLineLocking and disableMaster are permanent.',
    shape: {
      noFreeze: z.boolean().optional(),
      clawbackEnabled: z.boolean().optional(),
      trustLineLocking: z.boolean().optional(),
      disableMaster: z.boolean().optional(),
      requireAuth: z.boolean().optional(),
      requireDest: z.boolean().optional(),
      defaultRipple: z.boolean().optional(),
      globalFreeze: z.boolean().optional(),
      disallowXRP: z.boolean().optional(),
      transferRate: z.number().min(0).max(100).optional().describe('IOU transfer fee, as a percentage (0.5 = 0.5%)'),
      tickSize: z.number().int().min(0).max(15).optional().describe('Offer tick size, 3 to 15, or 0 to disable'),
      domain: z.string().optional().describe('Account domain, as plain text'),
    },
    params: settings => settings,
  }),
  clientAccountDepositPreauth: clientWriteTool(runtime, {
    id: 'clientAccountDepositPreauth',
    verb: 'account.depositPreauth',
    description: 'Preauthorizes, or removes the preauthorization of, an account to deposit to `from`.',
    shape: {
      authorize: address('r-address to preauthorize').optional(),
      unauthorize: address('r-address to remove').optional(),
    },
    params: ({ authorize, unauthorize }) => ({ authorize, unauthorize }),
  }),
  clientTokenRetrieve: clientReadTool(runtime, {
    id: 'clientTokenRetrieve',
    verb: 'token.retrieve',
    description: 'Returns an MPT issuance: issuer, assetScale, outstanding amount, flags and metadata.',
    shape: { mptIssuanceId },
    params: ({ mptIssuanceId }) => ({ mptIssuanceId }),
  }),
  clientTokenList: clientReadTool(runtime, {
    id: 'clientTokenList',
    verb: 'token.list',
    description: 'Lists the MPTs an account holds (`role: holder`) or issued (`role: issuer`).',
    shape: {
      role: z.enum(['holder', 'issuer']).optional().describe('Default holder'),
      account: address("r-address; the Environment's primary when omitted").optional(),
    },
    params: ({ role, account }) => ({ role, account }),
  }),
  clientIouRetrieve: clientReadTool(runtime, {
    id: 'clientIouRetrieve',
    verb: 'iou.retrieve',
    description: "Returns an account's trust line for an IOU.",
    shape: {
      ticker,
      issuer: address('Issuer r-address'),
      account: address("r-address; the Environment's primary when omitted").optional(),
    },
    params: ({ ticker, issuer, account }) => ({ ticker, issuer, account }),
  }),
  clientAccountRetrieve: clientReadTool(runtime, {
    id: 'clientAccountRetrieve',
    verb: 'account.retrieve',
    description: "Returns an account's XRP balance, sequence, owner count and flags.",
    shape: { account: address("r-address; the Environment's primary when omitted").optional() },
    params: ({ account }) => ({ account }),
  }),
})
