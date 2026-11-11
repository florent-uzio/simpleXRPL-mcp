import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { ToolFailure, type Runtime } from '../environments/runtime'
import { onlyDomain } from './custody'

export const createListQuarantinedTransfers = (runtime: Runtime) =>
  createTool({
    id: 'listQuarantinedTransfers',
    description:
      'Lists the transfers an account received that Custody still holds in quarantine: until released, they count as unavailable and cannot be spent. Pass the returned ids to releaseQuarantinedTransfers.',
    inputSchema: z.object({
      account: z.string().describe('r-address of the receiving account, held in the Environment'),
      ledgerId: z.string().optional().describe('Ledger id, only when the address is on several ledgers'),
      environment: z.string().optional().describe('Environment name; the default when omitted'),
    }),
    execute: ({ account, ledgerId, environment }) =>
      runtime.run({ environment, requires: 'read' }, async backend => ({
        transfers: await backend.listQuarantinedTransfers({
          account,
          ledgerId,
          domainId: backend.domainId ?? (await onlyDomain(backend)),
        }),
      })),
  })

export const createReleaseQuarantinedTransfers = (runtime: Runtime) =>
  createTool({
    id: 'releaseQuarantinedTransfers',
    description:
      "Releases named quarantined transfers (v0_ReleaseQuarantinedTransfers) so the account can spend them. Releasing skips Custody's compliance check on those transfers: list them with listQuarantinedTransfers first and release only the ones the user named. Runs a Dry run first and, by default, stops there; with `dryRun: false` it Proposes after a successful Dry run and returns the `intentId` at once, then follow it with waitForIntent. Needs the `propose` Access level and a named Environment.",
    inputSchema: z.object({
      environment: z.string().describe('Environment name; required, a write never uses the default'),
      account: z.string().describe('r-address of the receiving account, held in the Environment'),
      ledgerId: z.string().optional().describe('Ledger id, only when the address is on several ledgers'),
      transferIds: z.array(z.string()).min(1).describe('Ids of the quarantined transfers to release'),
      dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
    }),
    execute: input =>
      runtime.run({ environment: input.environment, requires: 'propose' }, async backend => {
        const { account, ledgerId, transferIds } = input
        const check = await backend.dryRunRelease({ account, ledgerId, transferIds })
        if (input.dryRun) return { dryRun: true as const, ...check }
        if (!check.success) {
          throw new ToolFailure(
            'dry-run-failed',
            `The Dry run failed, nothing was proposed: ${check.errors.join('; ')}`,
          )
        }
        const { intentId } = await backend.proposeRelease({ account, ledgerId, transferIds })
        return { dryRun: false as const, intentId }
      }),
  })
