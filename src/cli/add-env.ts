import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { Connect, CustodyKeyAlgorithm, GenerateKeypair } from '../backend/adapter'
import { ACCESS_LEVELS, environmentSchema } from '../environments/config'
import { expandHome, resolveKeyReference } from '../environments/key-reference'
import { KEYCHAIN_SERVICE, type Keychain } from '../environments/keychain'
import { readConfigFile, stageConfigFile } from './config-file'

export const KEY_ALGORITHMS = ['ed25519', 'secp256k1', 'secp256r1'] as const satisfies readonly CustodyKeyAlgorithm[]
export const KEY_STORES = ['keychain', 'file', 'env'] as const

/** Every prompt has a flag; a flag skips its prompt. */
export type AddEnvFlags = {
  apiUrl?: string
  tokenUrl?: string
  primary?: string
  domain?: string
  access?: string
  allowRawSigning?: boolean
  /** WebSocket URL of an XRPL node, for the client verb tools. */
  xrpldUrl?: string
  /** Algorithm of a generated key. */
  algorithm?: string
  /** Use this PEM file's key instead of generating one. */
  import?: string
  /** Where a generated or imported key is kept: `keychain`, `file`, or `env` (a key already in an environment variable). */
  store?: string
  /** Use a key already in the Keychain, as `<service>/<account>`. Nothing is copied. */
  keychainItem?: string
  /** Use a key already in this environment variable. */
  envVar?: string
  /** Replace an existing Environment without asking. */
  force?: boolean
}

export type AddEnvOptions = {
  name: string
  configPath: string
  env: Readonly<Record<string, string | undefined>>
  flags?: AddEnvFlags
  ask: (question: string) => Promise<string>
  keychain: Keychain
  /** False off macOS: the Keychain stores are then refused up front. */
  keychainAvailable?: boolean
  connect: Connect
  generateKeypair: GenerateKeypair
  log: (message: string) => void
}

const isYes = (answer: string) => /^y(es)?$/i.test(answer.trim())
const oneOf = <T extends string>(label: string, allowed: readonly T[], value: string): T => {
  if ((allowed as readonly string[]).includes(value)) return value as T
  throw new Error(`${label} must be one of ${allowed.join(', ')} (got "${value}").`)
}

type KeySource = 'generate' | 'import' | 'keychain-item' | 'env'
type KeyStore = 'keychain' | 'file'

const checkKeyFlags = (flags: AddEnvFlags) => {
  const reused = [flags.import, flags.keychainItem, flags.envVar].filter(Boolean)
  if (reused.length > 1) throw new Error('Use only one of --import, --keychain-item and --env-var.')
  if (flags.store === 'env' && (flags.import || flags.keychainItem)) {
    throw new Error(
      '--store env points at a key already in an environment variable: use --env-var, not --import or --keychain-item.',
    )
  }
  if ((flags.keychainItem || flags.envVar) && flags.store && !(flags.envVar && flags.store === 'env')) {
    throw new Error(
      '--keychain-item and --env-var use a key where it already is: nothing is stored, so --store does not apply.',
    )
  }
  if ((flags.keychainItem || flags.envVar || flags.import) && flags.algorithm) {
    throw new Error('--algorithm only applies to a generated key.')
  }
}

/**
 * Sets up a Ripple Custody Environment, verifies it with `getMe` and saves it with a Key reference.
 * The key is generated, imported from a PEM file, or already in the Keychain or an environment variable.
 * The config is saved only once the credentials work.
 */
export const runAddEnv = async ({
  name,
  configPath,
  env,
  flags = {},
  ask,
  keychain,
  keychainAvailable = true,
  connect,
  generateKeypair,
  log,
}: AddEnvOptions) => {
  if (!/^[\w][\w.-]*$/.test(name)) {
    throw new Error(`Environment name "${name}" may only contain letters, digits, "_", "." and "-".`)
  }
  checkKeyFlags(flags)
  const config = await readConfigFile(configPath)
  if (config.environments && name in config.environments && !flags.force) {
    if (!isYes(await ask(`Environment "${name}" already exists. Replace it? (y/N)`))) {
      throw new Error(`Environment "${name}" already exists; nothing changed.`)
    }
  }

  const rippleCustodyApiUrl = flags.apiUrl ?? (await ask('API URL'))
  const rippleCustodyTokenUrl = flags.tokenUrl ?? (await ask('Token URL'))
  const primary = flags.primary ?? (await ask('Primary address (an XRPL address in your Custody domain)'))
  const access = oneOf(
    'Access level',
    ACCESS_LEVELS,
    flags.access ?? ((await ask('Access level (read, propose, approve)')).trim() || 'read'),
  )
  const allowRawSigning =
    access === 'read'
      ? false
      : (flags.allowRawSigning ?? isYes(await ask('Allow Raw signing, which Custody policies cannot inspect? (y/N)')))
  const xrpldUrl =
    (flags.xrpldUrl ?? (await ask('XRPL node WebSocket URL for the client verb tools (Enter for none)'))).trim() ||
    undefined

  const settingsFor = (keyRef: string, domainId?: string) => {
    const parsed = environmentSchema.safeParse({
      backend: 'ripple-custody',
      rippleCustodyApiUrl,
      rippleCustodyTokenUrl,
      domainId,
      primary,
      keyRef,
      access,
      allowRawSigning,
      xrpldUrl,
    })
    if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
    return parsed.data
  }
  settingsFor('env:CHECK') // fail on a bad answer before any key work

  // Which key? Asked only when no key flag says.
  const keyAsked = !(flags.import || flags.keychainItem || flags.envVar || flags.store || flags.algorithm)
  const source: KeySource = flags.import
    ? 'import'
    : flags.keychainItem
      ? 'keychain-item'
      : flags.envVar || flags.store === 'env'
        ? 'env'
        : keyAsked
          ? oneOf(
              'Private key',
              ['generate', 'import', 'keychain-item', 'env'] as const,
              (await ask('Private key: generate, import, keychain-item or env [generate]')).trim() || 'generate',
            )
          : 'generate'

  let store: KeyStore | undefined
  if (source === 'generate' || source === 'import') {
    const chosen =
      flags.store ??
      (keyAsked ? (await ask('Store the key in (keychain, file) [keychain]')).trim() || 'keychain' : 'keychain')
    if (chosen === 'env')
      throw new Error('Store the key in keychain or file; env is for a key already in an environment variable.')
    store = oneOf('Store', ['keychain', 'file'] as const, chosen)
  }
  if ((store === 'keychain' || source === 'keychain-item') && !keychainAvailable) {
    throw new Error(
      'The macOS Keychain is only available on macOS. Use --store file, or --env-var for a key already in an environment variable.',
    )
  }

  // Where the key lives, and a step that puts it there (for a generated or imported key).
  let keyRef: string
  let signingKey: string
  let persist: (() => Promise<{ undo: () => Promise<void> }>) | undefined
  let registerPublicKey: string | undefined

  if (source === 'generate' || source === 'import') {
    if (source === 'generate') {
      const algorithm = oneOf('Algorithm', KEY_ALGORITHMS, flags.algorithm ?? 'ed25519')
      const pair = await generateKeypair(algorithm)
      signingKey = pair.privateKey.trim()
      registerPublicKey = pair.publicKey
    } else {
      const path = expandHome(flags.import ?? (await ask('Private key file (PEM)')))
      try {
        signingKey = (await readFile(path, 'utf8')).trim()
      } catch (cause) {
        throw new Error(`Cannot read the private key file ${path} (${(cause as Error).message})`)
      }
      if (!signingKey) throw new Error(`The private key file ${path} is empty`)
    }
    if (store === 'keychain') {
      keyRef = `keychain:${KEYCHAIN_SERVICE}/${name}`
      persist = async () => {
        await keychain.set(KEYCHAIN_SERVICE, name, signingKey)
        return { undo: async () => {} }
      }
    } else {
      const keyPath = join(dirname(configPath), 'keys', `${name}.pem`)
      keyRef = `file:${keyPath}`
      persist = async () => {
        const existed = await stat(keyPath).then(
          () => true,
          () => false,
        )
        await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 })
        await writeFile(keyPath, signingKey + '\n', { mode: 0o600 })
        await chmod(keyPath, 0o600)
        return { undo: async () => void (!existed && (await rm(keyPath, { force: true }))) }
      }
    }
  } else if (source === 'keychain-item') {
    const item = flags.keychainItem ?? (await ask('Keychain item (<service>/<account>)'))
    if (!item.includes('/')) throw new Error(`Keychain item "${item}" must look like <service>/<account>.`)
    keyRef = `keychain:${item}`
    signingKey = await resolveKeyReference(keyRef, env, keychain)
  } else {
    const variable = flags.envVar ?? (await ask('Environment variable holding the private key'))
    keyRef = `env:${variable}`
    signingKey = await resolveKeyReference(keyRef, env, keychain)
  }

  let undoKey: (() => Promise<void>) | undefined
  if (registerPublicKey !== undefined) {
    // A generated key is kept before it is shown: it is useless to lose once the person registers its public key.
    await persist?.()
    persist = undefined
    log(`Register this public key for your Custody user:\n\n${registerPublicKey}\n`)
    await ask('Press Enter once it is registered')
  }

  log('Verifying credentials with getMe...')
  let identity
  try {
    identity = await (await connect({ ...settingsFor(keyRef), signingKey })).getMe()
  } catch (cause) {
    const kept =
      registerPublicKey !== undefined
        ? ` The generated key was kept at ${keyRef}: retry with ${keyRef.startsWith('file:') ? `--import ${keyRef.slice(5)}` : `--keychain-item ${keyRef.slice(9)}`}.`
        : ''
    throw new Error(`${(cause as Error).message}${kept}`)
  }

  const domains = identity.domains
  let domainId = flags.domain
  if (domainId === undefined && domains.length > 0) {
    log(`Domains: ${domains.map(domain => `${domain.alias} (${domain.id})`).join(', ')}`)
    domainId = (await ask('Default domain ID (Enter for none)')).trim() || undefined
  }
  if (domainId && !domains.some(domain => domain.id === domainId)) {
    throw new Error(
      `Domain ${domainId} is not one of your domains (${domains.map(domain => domain.id).join(', ') || 'none'}).`,
    )
  }

  const settings = settingsFor(keyRef, domainId)
  const staged = await stageConfigFile(configPath, {
    ...config,
    environments: { ...config.environments, [name]: settings },
  })
  try {
    if (persist) undoKey = (await persist()).undo
    await staged.commit()
  } catch (cause) {
    await staged.discard()
    await undoKey?.()
    throw cause
  }

  const user = domains[0]?.user.alias
  log(`Saved Environment "${name}" (${settings.access})${user ? ` as ${user}` : ''} in ${configPath}.`)
  log(
    store === 'keychain'
      ? `The private key is in the macOS Keychain (service ${KEYCHAIN_SERVICE}, account ${name}).`
      : store === 'file'
        ? `The private key is in ${keyRef.slice(5)} (readable only by you).`
        : `The private key stays at ${keyRef}; nothing was copied.`,
  )
}
