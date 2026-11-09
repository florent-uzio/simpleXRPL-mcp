import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const ACCESS_LEVELS = ['read', 'propose', 'approve'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

export const KEY_REFERENCE_SCHEMES = ['keychain', 'file', 'env', 'aws-sm', 'aws-kms'] as const

export const environmentSchema = z.object({
  backend: z.literal('ripple-custody'),
  gatewayUrl: z.url(),
  tokenUrl: z.url(),
  clientId: z.string().optional(),
  domainId: z.string().optional(),
  primary: z.string().min(1),
  keyRef: z.string().regex(new RegExp(`^(${KEY_REFERENCE_SCHEMES.join('|')}):.+`), {
    error: 'Key reference must look like <scheme>:<location>',
  }),
  access: z.enum(ACCESS_LEVELS).default('read'),
  allowRawSigning: z.boolean().default(false),
})

export type EnvironmentSettings = z.infer<typeof environmentSchema>

/** An Environment as declared: valid settings, or the reason they are not. */
export type EnvironmentEntry = { name: string; settings: EnvironmentSettings } | { name: string; error: string }

export type EnvironmentsConfig = {
  defaultEnvironment?: string
  entries: EnvironmentEntry[]
  /** Set when the config file could not be read as a whole; zero-setup Environments still load. */
  configError?: string
}

type Env = Readonly<Record<string, string | undefined>>

export const ZERO_SETUP_ENVIRONMENT = 'env'

export const defaultConfigPath = (env: Env) =>
  env.SIMPLEXRPL_MCP_CONFIG ?? join(homedir(), '.config', 'simplexrpl-mcp', 'config.json')

const fileSchema = z.object({
  defaultEnvironment: z.string().optional(),
  environments: z.record(z.string(), z.unknown()).default({}),
})

/** The zero-setup Environment: built from RIPPLE_CUSTODY_* variables, read-only. */
const zeroSetupEntry = (env: Env): EnvironmentEntry | undefined => {
  if (!env.RIPPLE_CUSTODY_GATEWAY_URL) return undefined
  const parsed = environmentSchema.safeParse({
    backend: 'ripple-custody',
    gatewayUrl: env.RIPPLE_CUSTODY_GATEWAY_URL,
    tokenUrl: env.RIPPLE_CUSTODY_AUTH_TOKEN_URL,
    clientId: env.RIPPLE_CUSTODY_AUTH_CLIENT_ID,
    domainId: env.RIPPLE_CUSTODY_DOMAIN_ID || undefined,
    primary: env.RIPPLE_CUSTODY_PRIMARY,
    keyRef: 'env:RIPPLE_CUSTODY_AUTH_SIGNING_KEY',
    access: 'read',
  })
  return parsed.success
    ? { name: ZERO_SETUP_ENVIRONMENT, settings: parsed.data }
    : { name: ZERO_SETUP_ENVIRONMENT, error: z.prettifyError(parsed.error) }
}

/**
 * Loads Environments from the config file and the zero-setup `env` Environment.
 * Called on every use, so config edits apply without a restart. One invalid
 * entry never hides the others.
 */
export const loadEnvironments = async (configPath: string, env: Env): Promise<EnvironmentsConfig> => {
  let raw: string | undefined
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }

  const entries: EnvironmentEntry[] = []
  let defaultEnvironment: string | undefined
  let configError: string | undefined
  if (raw !== undefined) {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      configError = `Config file ${configPath} is not valid JSON`
    }
    if (!configError) {
      const file = fileSchema.safeParse(json)
      if (!file.success) {
        configError = `Config file ${configPath} is invalid: ${z.prettifyError(file.error)}`
      } else {
        defaultEnvironment = file.data.defaultEnvironment
        for (const [name, value] of Object.entries(file.data.environments)) {
          const parsed = environmentSchema.safeParse(value)
          entries.push(
            parsed.success ? { name, settings: parsed.data } : { name, error: z.prettifyError(parsed.error) },
          )
        }
      }
    }
  }

  const zeroSetup = zeroSetupEntry(env)
  if (zeroSetup && !entries.some(entry => entry.name === zeroSetup.name)) entries.push(zeroSetup)
  return { defaultEnvironment, entries, configError }
}
