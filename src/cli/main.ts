import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { connectRippleCustody, generateKeypair } from '../backend/adapter'
import { defaultConfigPath } from '../environments/config'
import { macosKeychain } from '../environments/keychain'
import { runAddEnv } from './add-env'

export const ADD_ENV_USAGE = `Usage: simplexrpl-mcp add-env <name> [options]

Anything not given as an option is asked for.

  --api-url <url>              Ripple Custody API URL
  --token-url <url>            Ripple Custody token URL
  --primary <r-address>        an XRPL address in your Custody domain
  --domain <id>                default Domain
  --access read|propose|approve
  --allow-raw-signing          allow Raw signing (--no-allow-raw-signing to refuse)
  --xrpld-url <wss-url>        XRPL node for the client verb tools

Private key (one source):
  (default)                    generate a key; --algorithm ed25519|secp256k1|secp256r1
  --import <pem-file>          use the key in this PEM file
  --keychain-item <service>/<account>   use a key already in the macOS Keychain
  --env-var <NAME>             use a key already in this environment variable
  --store keychain|file        where a generated or imported key is kept (default keychain)

  --force                      replace an existing Environment without asking`

/** Runs `simplexrpl-mcp add-env <name> [options]` and sets the exit code. */
export const runAddEnvCommand = async (args: string[]) => {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      allowNegative: true,
      options: {
        'api-url': { type: 'string' },
        'token-url': { type: 'string' },
        primary: { type: 'string' },
        domain: { type: 'string' },
        access: { type: 'string' },
        'allow-raw-signing': { type: 'boolean' },
        'xrpld-url': { type: 'string' },
        algorithm: { type: 'string' },
        import: { type: 'string' },
        store: { type: 'string' },
        'keychain-item': { type: 'string' },
        'env-var': { type: 'string' },
        force: { type: 'boolean' },
      },
    })
  } catch (cause) {
    console.error(`${(cause as Error).message}\n\n${ADD_ENV_USAGE}`)
    process.exitCode = 1
    return
  }
  const {
    positionals: [name, ...extra],
    values,
  } = parsed
  if (!name || extra.length > 0) {
    console.error(ADD_ENV_USAGE)
    process.exitCode = 1
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await runAddEnv({
      name,
      configPath: defaultConfigPath(process.env),
      env: process.env,
      flags: {
        apiUrl: values['api-url'],
        tokenUrl: values['token-url'],
        primary: values.primary,
        domain: values.domain,
        access: values.access,
        allowRawSigning: values['allow-raw-signing'],
        xrpldUrl: values['xrpld-url'],
        algorithm: values.algorithm,
        import: values.import,
        store: values.store,
        keychainItem: values['keychain-item'],
        envVar: values['env-var'],
        force: values.force,
      },
      ask: question => rl.question(`${question}: `),
      keychain: macosKeychain,
      keychainAvailable: process.platform === 'darwin',
      connect: connectRippleCustody,
      generateKeypair,
      log: message => console.log(message),
    })
  } catch (cause) {
    console.error(`add-env failed: ${(cause as Error).message}`)
    process.exitCode = 1
  } finally {
    rl.close()
  }
}
