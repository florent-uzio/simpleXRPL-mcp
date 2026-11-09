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
