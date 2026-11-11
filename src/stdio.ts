import { runAddEnvCommand } from './cli/main'
import { createSimpleXrplMcpServer } from './server'

if (process.argv[2] === 'add-env') {
  await runAddEnvCommand(process.argv.slice(3))
} else {
  const server = createSimpleXrplMcpServer()
  await server.startStdio()
  // The simpleXRPL client keeps a WebSocket open: close it when the MCP client goes away.
  const shutdown = () => void server.closeBackends().finally(() => process.exit(0))
  process.stdin.on('end', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
