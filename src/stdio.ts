import { createInterface } from 'node:readline/promises'
import { connectRippleCustody } from './backend/adapter'
import { runAddEnv } from './cli/add-env'
import { defaultConfigPath } from './environments/config'
import { macosKeychain } from './environments/keychain'
import { createSimpleXrplMcpServer } from './server'

if (process.argv[2] === 'add-env') {
  const name = process.argv[3]
  if (!name || process.argv.length > 4) {
    console.error('Usage: simplexrpl-mcp add-env <name>')
    process.exit(1)
  }
  if (process.platform !== 'darwin') {
    console.error('add-env stores the key in the macOS Keychain, which is only available on macOS.')
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await runAddEnv({
      name,
      configPath: defaultConfigPath(process.env),
      ask: question => rl.question(`${question}: `),
      keychain: macosKeychain,
      connect: connectRippleCustody,
      log: message => console.log(message),
    })
  } catch (cause) {
    console.error(`add-env failed: ${(cause as Error).message}`)
    process.exitCode = 1
  } finally {
    rl.close()
  }
} else {
  await createSimpleXrplMcpServer().startStdio()
}
