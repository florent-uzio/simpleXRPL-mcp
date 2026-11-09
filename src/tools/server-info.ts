import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import packageJson from '../../package.json'

export const getMcpVersion = createTool({
  id: 'getMcpVersion',
  description: 'Returns the version of this MCP server and of the simplexrpl package it is built on.',
  inputSchema: z.object({}),
  execute: async () => ({ mcpVersion: packageJson.version }),
})
