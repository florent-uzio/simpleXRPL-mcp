import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { CustodyBackend } from '../backend/adapter'
import { ToolFailure, type Runtime } from '../environments/runtime'

export const createGetMe = (runtime: Runtime) =>
  createTool({
    id: 'getMe',
    description: "Returns the Environment's own Custody user and the domains it belongs to.",
    inputSchema: z.object({
      environment: z.string().optional().describe('Environment name; the default when omitted'),
    }),
    execute: ({ environment }) => runtime.run({ environment, requires: 'read' }, backend => backend.getMe()),
  })

export const createWaitForIntent = (runtime: Runtime) =>
  createTool({
    id: 'waitForIntent',
    description:
      'Follows an Intent until it is executed, rejected, expired or failed. An Intent still awaiting approval when the wait ends is a normal answer (isTerminal false), not an error: check back later with the same intentId.',
    inputSchema: z.object({
      intentId: z.string().describe('The id returned when the Intent was proposed'),
      timeoutSeconds: z
        .number()
        .int()
        .positive()
        .max(300)
        .optional()
        .describe('How long to wait; the Backend default when omitted'),
      environment: z.string().optional().describe('Environment name; the default when omitted'),
    }),
    execute: ({ intentId, timeoutSeconds, environment }) =>
      runtime.run({ environment, requires: 'read' }, backend =>
        backend.waitForIntent(intentId, {
          timeoutMs: timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000,
        }),
      ),
  })

export const createGetMptIssuanceId = (runtime: Runtime) =>
  createTool({
    id: 'getMptIssuanceId',
    description:
      "Returns the MPT issuance ID an executed mptIssuanceCreate Intent created, for mptAuthorize, mptIssuanceSet, mptIssuanceDestroy and the confidential MPT tools. Custody records it a few seconds after the Intent executes, so this waits for it. If the wait ends first, the answer has a `reason` and no `issuanceId`: that is not an error, call again with the same intentId. Uses the Environment's default domain when `domainId` is omitted.",
    inputSchema: z.object({
      intentId: z.string().describe('The id returned when the mptIssuanceCreate Intent was proposed'),
      timeoutSeconds: z
        .number()
        .int()
        .min(0)
        .max(300)
        .optional()
        .describe('How long to wait for the ID (default 30); 0 looks once'),
      environment: z.string().optional().describe('Environment name; the default when omitted'),
      domainId: z.string().optional().describe("Domain id; the Environment's default domain when omitted"),
    }),
    execute: ({ intentId, timeoutSeconds, environment, domainId }) =>
      runtime.run({ environment, requires: 'read' }, async backend => {
        const domain = domainId ?? backend.domainId ?? (await onlyDomain(backend))
        return backend.getMptIssuanceId({
          intentId,
          domainId: domain,
          timeoutMs: timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000,
        })
      }),
  })

export const createListAccounts = (runtime: Runtime) =>
  createTool({
    id: 'listAccounts',
    description:
      "Lists the accounts of a domain with their XRPL addresses, one page at a time. Pass the returned `nextCursor` as `cursor` for the next page; it is absent on the last page. Uses the Environment's default domain when `domainId` is omitted.",
    inputSchema: z.object({
      environment: z.string().optional().describe('Environment name; the default when omitted'),
      domainId: z.string().optional().describe("Domain id; the Environment's default domain when omitted"),
      limit: z.number().int().min(1).max(100).optional().describe('Page size (default 100)'),
      cursor: z.string().optional().describe('`nextCursor` of the previous page'),
    }),
    execute: ({ environment, domainId, limit, cursor }) =>
      runtime.run({ environment, requires: 'read' }, async backend => {
        const domain = domainId ?? backend.domainId ?? (await onlyDomain(backend))
        return backend.listAccounts({ domainId: domain, limit, cursor })
      }),
  })

const onlyDomain = async (backend: CustodyBackend) => {
  const { domains } = await backend.getMe()
  if (domains.length === 1) return domains[0].id
  throw new ToolFailure(
    'domain-required',
    domains.length === 0
      ? 'The user belongs to no domain.'
      : `Several domains exist (${domains.map(domain => `${domain.alias}: ${domain.id}`).join(', ')}): pass \`domainId\`.`,
  )
}
