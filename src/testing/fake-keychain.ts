import type { Keychain } from '../environments/keychain'

/** Fake Keychain: secrets live in a map, keyed `<service>/<account>`, that the tests can inspect. */
export const createFakeKeychain = () => {
  const secrets = new Map<string, string>()
  const keychain: Keychain = {
    set: async (service, account, secret) => void secrets.set(`${service}/${account}`, secret),
    get: async (service, account) => secrets.get(`${service}/${account}`),
  }
  return Object.assign(keychain, { secrets })
}
