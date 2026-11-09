import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { Runtime } from '../environments/runtime'

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
