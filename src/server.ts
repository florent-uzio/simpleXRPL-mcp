import { MCPServer } from '@mastra/mcp'
import packageJson from '../package.json'
import { createTools } from './tools'
import { INSTRUCTIONS } from './tools/instructions'

export const createSimpleXrplMcpServer = () =>
  new MCPServer({
    id: 'simplexrpl-mcp',
    name: 'simpleXRPL',
    version: packageJson.version,
    description: 'Read from and act on Ripple Custody and the XRP Ledger through simpleXRPL',
    instructions: INSTRUCTIONS,
    tools: createTools(),
  })
