import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { KEYCHAIN_SERVICE, type Keychain } from './keychain'

/** `keychain:<service>/<account>`; a location without a slash is an account under this server's own service. */
export const parseKeychainLocation = (location: string) => {
  const slash = location.indexOf('/')
  return slash === -1
    ? { service: KEYCHAIN_SERVICE, account: location }
    : { service: location.slice(0, slash), account: location.slice(slash + 1) }
}

export const expandHome = (path: string) => (path.startsWith('~/') ? homedir() + path.slice(1) : path)

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
    const path = expandHome(location)
    try {
      return (await readFile(path, 'utf8')).trim()
    } catch (cause) {
      throw new Error(`Key reference ${keyRef}: cannot read ${path} (${(cause as Error).message})`)
    }
  }
  if (scheme === 'keychain') {
    const { service, account } = parseKeychainLocation(location)
    let value: string | undefined
    try {
      value = await keychain.get(service, account)
    } catch (cause) {
      throw new Error(`Key reference ${keyRef}: cannot read the Keychain (${(cause as Error).message})`)
    }
    if (!value) throw new Error(`Key reference ${keyRef}: no Keychain entry "${account}" for service "${service}"`)
    return value.trim()
  }
  throw new Error(`Key reference ${keyRef}: the ${scheme}: scheme is not supported yet`)
}
