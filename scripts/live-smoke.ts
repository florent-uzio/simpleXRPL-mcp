// Runs the real server stack (config file, Keychain, simplexrpl) against a real Environment. See `npm run smoke`.
import { createSimpleXrplMcpServer } from '../src/server'
import { SMOKE_USAGE, parseSmokeArgs, runSmoke } from '../src/smoke/run'

let args
try {
  args = parseSmokeArgs(process.argv.slice(2))
} catch (cause) {
  console.error((cause as Error).message)
  process.exit(2)
}
const server = createSimpleXrplMcpServer()
const passed = await runSmoke({
  args,
  log: line => console.log(line),
  call: async (tool, input) => ((await server.executeTool(tool, input ?? {})) as { output: unknown }).output,
})
process.exit(passed ? 0 : 1)
