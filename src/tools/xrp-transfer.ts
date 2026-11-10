import { createTool } from '@mastra/core/tools'
import { xrpToDrops } from 'xrpl'
import { z } from 'zod'
import type { Runtime } from '../environments/runtime'
import { DRY_RUN_THEN_PROPOSE, dryRunThenPropose } from './native-write'

export const createXrpTransfer = (runtime: Runtime) =>
  createTool({
    id: 'xrpTransfer',
    description: `Proposes an XRP transfer. ${DRY_RUN_THEN_PROPOSE}`,
    inputSchema: z.object({
      environment: z.string().describe('Environment name; required, a write never uses the default'),
      to: z.string().describe('Destination r-address'),
      amount: z
        .string()
        .regex(/^\d+(\.\d{1,6})?$/, 'a non-negative decimal XRP amount with at most 6 decimal places')
        .describe("Amount in XRP, as a decimal string, e.g. '10' or '0.25'"),
      from: z.string().describe('Source r-address, an account held in the Environment'),
      dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
    }),
    execute: input =>
      dryRunThenPropose(runtime, input, () => ({
        account: input.from,
        operation: {
          type: 'Payment',
          destination: { type: 'Address', address: input.to },
          amount: xrpToDrops(input.amount),
        },
      })),
  })
