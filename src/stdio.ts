import { runAddEnvCommand } from './cli/main'
import { createSimpleXrplMcpServer } from './server'

if (process.argv[2] === 'add-env') {
  await runAddEnvCommand(process.argv.slice(3))
} else {
  await createSimpleXrplMcpServer().startStdio()
}
