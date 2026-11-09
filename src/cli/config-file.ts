import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type ConfigFile = { environments?: Record<string, unknown> }

export const readConfigFile = async (configPath: string): Promise<ConfigFile> => {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw cause
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (cause) {
    throw new Error(
      `Config file ${configPath} is not valid JSON (${(cause as Error).message}): fix or remove it, then run add-env again.`,
    )
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) return json
  throw new Error(`Config file ${configPath} is not a JSON object: fix or remove it, then run add-env again.`)
}

/**
 * Stages the new config next to the real one and returns a commit step. Staging
 * first lets the caller store the key in between, so a failed write leaves no orphaned key.
 */
export const stageConfigFile = async (configPath: string, config: ConfigFile) => {
  await mkdir(dirname(configPath), { recursive: true })
  const staged = `${configPath}.tmp`
  await writeFile(staged, JSON.stringify(config, null, 2) + '\n')
  return {
    commit: () => rename(staged, configPath),
    discard: () => rm(staged, { force: true }),
  }
}
