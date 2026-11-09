import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Connect } from '../backend/adapter'
import { environmentSchema } from '../environments/config'
import { expandHome } from '../environments/key-reference'
import type { Keychain } from '../environments/keychain'
import { readConfigFile, stageConfigFile } from './config-file'

export type AddEnvOptions = {
  name: string
  configPath: string
  ask: (question: string) => Promise<string>
  keychain: Keychain
  connect: Connect
  log: (message: string) => void
}

const isYes = (answer: string) => /^y(es)?$/i.test(answer.trim())

/**
 * Prompts for a Ripple Custody Environment, verifies it with `getMe`, stores the
 * private key in the Keychain and saves the Environment with a `keychain:` Key
 * reference. Nothing is stored unless the credentials work.
 */
export const runAddEnv = async ({ name, configPath, ask, keychain, connect, log }: AddEnvOptions) => {
  const config = await readConfigFile(configPath)
  if (config.environments && name in config.environments) {
    if (!isYes(await ask(`Environment "${name}" already exists. Replace it and its Keychain key? (y/N)`))) {
      throw new Error(`Environment "${name}" already exists; nothing changed.`)
    }
  }

  const answers = {
    gatewayUrl: await ask('Gateway URL'),
    tokenUrl: await ask('Token URL'),
    clientId: await ask('Client ID (optional)'),
    domainId: await ask('Domain ID (optional)'),
    primary: await ask('Primary address'),
    access: (await ask('Access level (read, propose, approve)')) || 'read',
    allowRawSigning: isYes(await ask('Allow Raw signing, which Custody policies cannot inspect? (y/N)')),
  }
  const keyPath = expandHome(await ask('Private key file'))

  const parsed = environmentSchema.safeParse({
    backend: 'ripple-custody',
    ...answers,
    clientId: answers.clientId || undefined,
    domainId: answers.domainId || undefined,
    keyRef: `keychain:${name}`,
  })
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
  const settings = parsed.data

  let signingKey: string
  try {
    signingKey = (await readFile(keyPath, 'utf8')).trim()
  } catch (cause) {
    throw new Error(`Cannot read the private key file ${keyPath} (${(cause as Error).message})`)
  }
  if (!signingKey) throw new Error(`The private key file ${keyPath} is empty`)

  log('Verifying credentials with getMe...')
  const identity = await (await connect({ ...settings, signingKey })).getMe()

  const staged = await stageConfigFile(configPath, {
    ...config,
    environments: { ...config.environments, [name]: settings },
  })
  try {
    await keychain.set(name, signingKey)
    await staged.commit()
  } catch (cause) {
    await staged.discard()
    throw cause
  }

  const user = identity.domains[0]?.user.alias
  log(`Saved Environment "${name}" (${settings.access})${user ? ` as ${user}` : ''} in ${configPath}.`)
  log(`The private key is in the macOS Keychain (service simplexrpl-mcp, account ${name}).`)
}
