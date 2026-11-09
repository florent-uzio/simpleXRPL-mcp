import { createInterface } from 'node:readline/promises'
import { connectRippleCustody } from '../backend/adapter'
import { defaultConfigPath } from '../environments/config'
import { macosKeychain } from '../environments/keychain'
import { runAddEnv } from './add-env'

/** Runs `simplexrpl-mcp add-env <name>` and sets the exit code. */
export const runAddEnvCommand = async (args: string[]) => {
  const [name, ...extra] = args
  if (!name || extra.length > 0) {
    console.error('Usage: simplexrpl-mcp add-env <name>')
    process.exitCode = 1
    return
  }
  if (process.platform !== 'darwin') {
    console.error('add-env stores the key in the macOS Keychain, which is only available on macOS.')
    process.exitCode = 1
    return
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
}
