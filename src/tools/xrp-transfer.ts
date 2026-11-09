import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { ToolFailure, type Runtime } from '../environments/runtime'

export const createXrpTransfer = (runtime: Runtime) =>
  createTool({
    id: 'xrpTransfer',
    description:
      'Sends XRP. Runs a Dry run first and, by default, stops there, returning the fee estimate. With `dryRun: false` it Proposes after a successful Dry run and returns the `intentId` at once; approvers act later. Needs the `propose` Access level and a named Environment.',
    inputSchema: z.object({
      environment: z.string().describe('Environment name; required, a write never uses the default'),
      to: z.string().describe('Destination r-address'),
      amount: z
        .string()
        .regex(/^\d+(\.\d{1,6})?$/, 'a non-negative decimal XRP amount with at most 6 decimal places')
        .describe("Amount in XRP, as a decimal string, e.g. '10' or '0.25'"),
      from: z.string().optional().describe("Source r-address; the Environment's primary account when omitted"),
      dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
    }),
    execute: ({ environment, to, amount, from, dryRun }) =>
      runtime.run({ environment, requires: 'propose' }, async backend => {
        const transfer = { to, amount, ...(from ? { from } : {}) }
        const check = await backend.dryRunXrpTransfer(transfer)
        if (dryRun) return { dryRun: true as const, ...check }
        if (!check.success) {
          throw new ToolFailure(
            'dry-run-failed',
            `The Dry run failed, nothing was proposed: ${check.errors.join('; ')}`,
          )
        }
        const { intentId } = await backend.proposeXrpTransfer(transfer)
        return { dryRun: false as const, intentId, estimatedFeeDrops: check.estimatedFeeDrops }
      }),
  })
