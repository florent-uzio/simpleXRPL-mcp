import type { Connect, CustodyBackend } from '../backend/adapter'
import {
  ACCESS_LEVELS,
  loadEnvironments,
  type AccessLevel,
  type EnvironmentSettings,
  type EnvironmentsConfig,
} from './config'
import { createHash } from 'node:crypto'
import { resolveKeyReference } from './key-reference'

export type ToolError = { code: string; message: string }
/** Every result names the Environment it came from. */
export type EnvResult<T> = ({ environment: string } & T) | { environment: string | null; error: ToolError }

export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type RuntimeOptions = {
  configPath: string
  env: Readonly<Record<string, string | undefined>>
  connect: Connect
}

export const createRuntime = ({ configPath, env, connect }: RuntimeOptions) => {
  const backends = new Map<string, { fingerprint: string; backend: Promise<CustodyBackend> }>()

  const connectLazily = async (name: string, settings: EnvironmentSettings) => {
    let signingKey: string
    try {
      signingKey = await resolveKeyReference(settings.keyRef, env)
    } catch (cause) {
      throw new ToolFailure('key-reference', (cause as Error).message)
    }
    // The key is part of the fingerprint, so a changed key file reconnects even when the settings are the same.
    const fingerprint = createHash('sha256').update(JSON.stringify({ settings, signingKey })).digest('hex')
    const cached = backends.get(name)
    if (cached?.fingerprint === fingerprint) return cached.backend
    const backend = connect({ ...settings, signingKey })
    backends.set(name, { fingerprint, backend })
    // A failed connection is not remembered: fixing the key or the config takes effect on the next call.
    backend.catch(() => backends.delete(name))
    return backend
  }

  const pick = (config: EnvironmentsConfig, requested: string | undefined) => {
    const names = config.entries.map(entry => entry.name)
    const name = requested ?? config.defaultEnvironment ?? (names.length === 1 ? names[0] : undefined)
    if (!name) {
      throw new ToolFailure(
        'environment-required',
        names.length === 0
          ? `${config.configError ? config.configError + '. ' : ''}No Environment is configured. Add one to the config file or set the RIPPLE_CUSTODY_* variables.`
          : `Several Environments exist (${names.join(', ')}): pass \`environment\`.`,
      )
    }
    const entry = config.entries.find(candidate => candidate.name === name)
    if (!entry)
      throw new ToolFailure('unknown-environment', `No Environment named "${name}" (have: ${names.join(', ')}).`)
    if ('error' in entry)
      throw new ToolFailure('invalid-environment', `Environment "${name}" is misconfigured: ${entry.error}`)
    return { name, settings: entry.settings }
  }

  return {
    /** Declared Environments. Never reads a Key reference. */
    list: () => loadEnvironments(configPath, env),

    /**
     * Runs `action` against an Environment's Backend. The Access level is checked
     * before the Key reference is read; failures are shaped, never thrown.
     */
    run: async <T>(
      options: { environment?: string; requires: AccessLevel },
      action: (backend: CustodyBackend) => Promise<T>,
    ): Promise<EnvResult<T extends object ? T : never>> => {
      let name: string | null = options.environment ?? null
      try {
        const picked = pick(await loadEnvironments(configPath, env), options.environment)
        name = picked.name
        if (ACCESS_LEVELS.indexOf(picked.settings.access) < ACCESS_LEVELS.indexOf(options.requires)) {
          throw new ToolFailure(
            'access-denied',
            `This needs the "${options.requires}" Access level; Environment "${name}" has "${picked.settings.access}".`,
          )
        }
        const result = await action(await connectLazily(name, picked.settings))
        return { environment: name, ...result } as EnvResult<T extends object ? T : never>
      } catch (cause) {
        const failure =
          cause instanceof ToolFailure
            ? cause
            : new ToolFailure('backend-error', (cause as Error).message ?? String(cause))
        return { environment: name, error: { code: failure.code, message: failure.message } }
      }
    },
  }
}

export type Runtime = ReturnType<typeof createRuntime>
