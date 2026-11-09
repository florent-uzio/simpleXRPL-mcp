import type { Keychain } from '../environments/keychain'

/** Fake Keychain: secrets live in a map the tests can inspect. */
export const createFakeKeychain = () => {
  const secrets = new Map<string, string>()
  const keychain: Keychain = {
    set: async (account, secret) => void secrets.set(account, secret),
    get: async account => secrets.get(account),
  }
  return Object.assign(keychain, { secrets })
}
