import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { Connect } from '../backend/adapter'
import { environmentSchema } from '../environments/config'
import type { Keychain } from '../environments/keychain'

export type AddEnvOptions = {
  name: string
  configPath: string
  ask: (question: string) => Promise<string>
  keychain: Keychain
  connect: Connect
  log: (message: string) => void
}

const readConfigFile = async (configPath: string): Promise<{ environments?: Record<string, unknown> }> => {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw cause
  }
  try {
    const json = JSON.parse(raw)
    if (json && typeof json === 'object' && !Array.isArray(json)) return json
  } catch {}
  throw new Error(`Config file ${configPath} is not valid JSON: fix or remove it, then run add-env again.`)
}

/**
 * Prompts for a Ripple Custody Environment, verifies it with `getMe`, stores the
 * private key in the Keychain and saves the Environment with a `keychain:` Key
 * reference. Nothing is stored unless the credentials work.
 */
export const runAddEnv = async ({ name, configPath, ask, keychain, connect, log }: AddEnvOptions) => {
  const config = await readConfigFile(configPath)

  const gatewayUrl = await ask('Gateway URL')
  const tokenUrl = await ask('Token URL')
  const clientId = await ask('Client ID (optional)')
  const domainId = await ask('Domain ID (optional)')
  const primary = await ask('Primary address')
  const access = (await ask('Access level (read, propose, approve)')) || 'read'
  const keyPath = await ask('Private key file')

  const keyRef = `keychain:${name}`
  const parsed = environmentSchema.safeParse({
    backend: 'ripple-custody',
    gatewayUrl,
    tokenUrl,
    clientId: clientId || undefined,
    domainId: domainId || undefined,
    primary,
    keyRef,
    access,
  })
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
  const settings = parsed.data

  let signingKey: string
  try {
    signingKey = (await readFile(keyPath.replace(/^~(?=\/)/, process.env.HOME ?? '~'), 'utf8')).trim()
  } catch (cause) {
    throw new Error(`Cannot read the private key file ${keyPath} (${(cause as Error).message})`)
  }
  if (!signingKey) throw new Error(`The private key file ${keyPath} is empty`)

  log('Verifying credentials with getMe...')
  const me = await (await connect({ ...settings, signingKey })).getMe()

  await keychain.set(name, signingKey)
  const next = {
    ...config,
    environments: { ...config.environments, [name]: settings },
  }
  await mkdir(dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n')
  await rename(tmp, configPath)

  const user = me.domains[0]?.user.alias
  log(`Saved Environment "${name}" (${settings.access})${user ? ` as ${user}` : ''} in ${configPath}.`)
  log(`The private key is in the macOS Keychain (service simplexrpl-mcp, account ${name}).`)
}
