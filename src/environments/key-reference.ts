import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Keychain } from './keychain'

/** Resolves a Key reference to the private key it points at. Called lazily, at first use. */
export const resolveKeyReference = async (
  keyRef: string,
  env: Readonly<Record<string, string | undefined>>,
  keychain: Keychain,
): Promise<string> => {
  const separator = keyRef.indexOf(':')
  const scheme = keyRef.slice(0, separator)
  const location = keyRef.slice(separator + 1)

  if (scheme === 'env') {
    const value = env[location]
    if (!value) throw new Error(`Key reference ${keyRef}: environment variable ${location} is not set`)
    return value.trim()
  }
  if (scheme === 'file') {
    const path = location.startsWith('~/') ? homedir() + location.slice(1) : location
    try {
      return (await readFile(path, 'utf8')).trim()
    } catch (cause) {
      throw new Error(`Key reference ${keyRef}: cannot read ${path} (${(cause as Error).message})`)
    }
  }
  if (scheme === 'keychain') {
    let value: string | undefined
    try {
      value = await keychain.get(location)
    } catch (cause) {
      throw new Error(`Key reference ${keyRef}: cannot read the Keychain (${(cause as Error).message})`)
    }
    if (!value) throw new Error(`Key reference ${keyRef}: no Keychain entry "${location}"`)
    return value.trim()
  }
  throw new Error(`Key reference ${keyRef}: the ${scheme}: scheme is not supported yet`)
}
