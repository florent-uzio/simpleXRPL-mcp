import { MCPServer } from '@mastra/mcp'
import packageJson from '../package.json'
import { connectRippleCustody } from './backend/adapter'
import { defaultConfigPath } from './environments/config'
import { createRuntime, type RuntimeOptions } from './environments/runtime'
import { createTools } from './tools'
import { INSTRUCTIONS } from './tools/instructions'

export const createSimpleXrplMcpServer = (options: Partial<RuntimeOptions> = {}) => {
  const env = options.env ?? process.env
  const runtime = createRuntime({
    configPath: options.configPath ?? defaultConfigPath(env),
    env,
    connect: options.connect ?? connectRippleCustody,
  })
  const server = new MCPServer({
    id: 'simplexrpl-mcp',
    name: 'simpleXRPL',
    version: packageJson.version,
    description: 'Read from and act on Ripple Custody and the XRP Ledger through simpleXRPL',
    instructions: INSTRUCTIONS,
    tools: createTools(runtime),
  })
  /** Closes the Backends' open connections, so the process can exit. */
  return Object.assign(server, { closeBackends: runtime.close })
}
