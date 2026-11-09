import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connect, GenerateKeypair } from '../backend/adapter'
import { decodeSecret } from '../environments/keychain'
import { createRuntime } from '../environments/runtime'
import { createFakeAdapter } from '../testing/fake-adapter'
import { createFakeKeychain } from '../testing/fake-keychain'
import { runAddEnv, type AddEnvFlags } from './add-env'

const dirs: string[] = []
afterEach(() => Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))))

const PEM = '-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----\n'
const GENERATED = '-----BEGIN PRIVATE KEY-----\ngenerated\n-----END PRIVATE KEY-----\n'

const Q = {
  apiUrl: 'API URL',
  tokenUrl: 'Token URL',
  primary: 'Primary address (an XRPL address in your Custody domain)',
  access: 'Access level (read, propose, approve)',
  raw: 'Allow Raw signing, which Custody policies cannot inspect? (y/N)',
  source: 'Private key: generate, import, keychain-item or env [generate]',
  store: 'Store the key in (keychain, file) [keychain]',
  keyFile: 'Private key file (PEM)',
  registered: 'Press Enter once it is registered',
  domain: 'Default domain ID (Enter for none)',
  envVar: 'Environment variable holding the private key',
  replace: 'Environment "prod" already exists. Replace it? (y/N)',
}

const setup = async ({ connect, env = {} }: { connect?: Connect; env?: Record<string, string> } = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'simplexrpl-add-env-'))
  dirs.push(dir)
  const keyPath = join(dir, 'key.pem')
  await writeFile(keyPath, PEM)
  const configPath = join(dir, 'config.json')
  const keychain = createFakeKeychain()
  const adapter = createFakeAdapter()
  const answers: Record<string, string> = {
    [Q.apiUrl]: 'https://custody.example.com',
    [Q.tokenUrl]: 'https://custody.example.com/token',
    [Q.primary]: 'rPrimary',
    [Q.access]: 'propose',
    [Q.source]: 'import',
    [Q.keyFile]: keyPath,
  }
  const asked: string[] = []
  const logs: string[] = []
  const generated: string[] = []
  const generateKeypair: GenerateKeypair = async algorithm => {
    generated.push(algorithm)
    return { privateKey: GENERATED, publicKey: 'cHVibGljLWtleQ==' }
  }
  const ask = async (question: string) => {
    asked.push(question)
    return answers[question] ?? ''
  }
  const run = (flags: AddEnvFlags = {}, name = 'prod', keychainAvailable = true) =>
    runAddEnv({
      name,
      configPath,
      env,
      flags,
      ask,
      keychain,
      keychainAvailable,
      connect: connect ?? adapter.connect,
      generateKeypair,
      log: message => logs.push(message),
    })
  const config = async () => JSON.parse(await readFile(configPath, 'utf8'))
  return { dir, keyPath, configPath, keychain, adapter, answers, asked, logs, generated, run, config }
}

describe('add-env settings', () => {
  it('saves the Environment with the Ripple Custody URLs, primary, access and a Key reference, never the key', async () => {
    const t = await setup()
    await t.run()
    const raw = await readFile(t.configPath, 'utf8')
    expect(raw).not.toContain('abc')
    expect(JSON.parse(raw).environments.prod).toEqual({
      backend: 'ripple-custody',
      rippleCustodyApiUrl: 'https://custody.example.com',
      rippleCustodyTokenUrl: 'https://custody.example.com/token',
      primary: 'rPrimary',
      keyRef: 'keychain:simplexrpl-mcp/prod',
      access: 'propose',
      allowRawSigning: false,
    })
  })

  it('takes every setting from flags without asking', async () => {
    const t = await setup()
    await t.run({
      apiUrl: 'https://api.example.com',
      tokenUrl: 'https://api.example.com/token',
      primary: 'rFlag',
      access: 'approve',
      allowRawSigning: true,
      domain: 'd-1',
      import: t.keyPath,
    })
    expect(t.asked).toEqual([])
    expect((await t.config()).environments.prod).toMatchObject({
      rippleCustodyApiUrl: 'https://api.example.com',
      primary: 'rFlag',
      access: 'approve',
      allowRawSigning: true,
      domainId: 'd-1',
    })
  })

  it('asks about Raw signing only above the read Access level', async () => {
    const t = await setup()
    t.answers[Q.access] = 'read'
    await t.run()
    expect(t.asked).not.toContain(Q.raw)
    expect((await t.config()).environments.prod.allowRawSigning).toBe(false)

    t.answers[Q.access] = 'propose'
    t.answers[Q.raw] = 'y'
    await t.run({ force: true })
    expect(t.asked).toContain(Q.raw)
    expect((await t.config()).environments.prod.allowRawSigning).toBe(true)
  })

  it('rejects a bad URL or Access level before generating a key or connecting', async () => {
    const t = await setup()
    t.answers[Q.apiUrl] = 'not a url'
    await expect(t.run({ algorithm: 'ed25519' })).rejects.toThrow(/URL/i)
    t.answers[Q.apiUrl] = 'https://custody.example.com'
    t.answers[Q.access] = 'root'
    await expect(t.run({ algorithm: 'ed25519' })).rejects.toThrow(/Access level must be one of/)
    expect(t.generated).toEqual([])
    expect(t.adapter.connections).toEqual([])
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('rejects an Environment name that could escape the keys folder', async () => {
    const t = await setup()
    await expect(t.run({}, '../evil')).rejects.toThrow(/Environment name/)
  })

  it('verifies with getMe on a connection without the domain, then lets you pick a domain', async () => {
    const t = await setup()
    t.answers[Q.domain] = 'd-1'
    await t.run()
    expect(t.adapter.connections[0]?.domainId).toBeUndefined()
    expect((await t.config()).environments.prod.domainId).toBe('d-1')
  })

  it('keeps the domain optional and rejects one the user does not belong to', async () => {
    const t = await setup()
    await t.run()
    expect((await t.config()).environments.prod).not.toHaveProperty('domainId')
    await expect(t.run({ domain: 'd-9', force: true })).rejects.toThrow(/not one of your domains/)
  })
})

describe('add-env key sources', () => {
  it('imports a PEM file into the Keychain', async () => {
    const t = await setup()
    await t.run({ import: t.keyPath })
    expect(t.keychain.secrets.get('simplexrpl-mcp/prod')).toBe(PEM.trim())
    expect(t.adapter.connections[0]?.signingKey).toBe(PEM.trim())
    expect(t.generated).toEqual([])
  })

  it('generates a key, keeps it, shows only the public key and waits for registration', async () => {
    const t = await setup()
    await t.run({ algorithm: 'secp256k1' })
    expect(t.generated).toEqual(['secp256k1'])
    expect(t.keychain.secrets.get('simplexrpl-mcp/prod')).toBe(GENERATED.trim())
    expect(t.adapter.connections[0]?.signingKey).toBe(GENERATED.trim())
    expect(t.asked).toContain(Q.registered)
    const output = t.logs.join('\n')
    expect(output).toContain('cHVibGljLWtleQ==')
    expect(output).not.toContain('generated')
  })

  it('generates ed25519 by default and stores it in a 0600 file with --store file', async () => {
    const t = await setup()
    await t.run({ store: 'file' })
    expect(t.generated).toEqual(['ed25519'])
    const keyPath = join(t.dir, 'keys', 'prod.pem')
    expect(await readFile(keyPath, 'utf8')).toBe(GENERATED)
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
    expect((await t.config()).environments.prod.keyRef).toBe(`file:${keyPath}`)
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('reuses a key already in the Keychain without copying it', async () => {
    const t = await setup()
    t.keychain.secrets.set('custody-mcp/dev', PEM.trim())
    await t.run({ keychainItem: 'custody-mcp/dev' })
    expect((await t.config()).environments.prod.keyRef).toBe('keychain:custody-mcp/dev')
    expect([...t.keychain.secrets.keys()]).toEqual(['custody-mcp/dev'])
    expect(t.adapter.connections[0]?.signingKey).toBe(PEM.trim())
    expect(t.asked).not.toContain(Q.registered)
  })

  it('reports a missing Keychain item without saving anything', async () => {
    const t = await setup()
    await expect(t.run({ keychainItem: 'custody-mcp/nope' })).rejects.toThrow(/no Keychain entry/)
    await expect(readFile(t.configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('points at a key already in an environment variable', async () => {
    const t = await setup({ env: { MY_KEY: PEM } })
    await t.run({ envVar: 'MY_KEY' })
    expect((await t.config()).environments.prod.keyRef).toBe('env:MY_KEY')
    expect(t.adapter.connections[0]?.signingKey).toBe(PEM.trim())
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('treats --store env like an environment variable and asks for its name', async () => {
    const t = await setup({ env: { MY_KEY: PEM } })
    t.answers[Q.envVar] = 'MY_KEY'
    await t.run({ store: 'env' })
    expect((await t.config()).environments.prod.keyRef).toBe('env:MY_KEY')
  })

  it('reports an unset environment variable', async () => {
    const t = await setup()
    await expect(t.run({ envVar: 'NOPE' })).rejects.toThrow(/NOPE is not set/)
  })

  it('asks which key to use when no key flag is given', async () => {
    const t = await setup()
    t.answers[Q.source] = 'generate'
    await t.run()
    expect(t.asked).toEqual(expect.arrayContaining([Q.source, Q.store]))
    expect(t.generated).toEqual(['ed25519'])
  })

  it('refuses conflicting key flags', async () => {
    const t = await setup()
    await expect(t.run({ import: t.keyPath, keychainItem: 'a/b' })).rejects.toThrow(/only one of/)
    await expect(t.run({ import: t.keyPath, algorithm: 'ed25519' })).rejects.toThrow(/--algorithm/)
    await expect(t.run({ keychainItem: 'a/b', store: 'file' })).rejects.toThrow(/--store does not apply/)
    await expect(t.run({ import: t.keyPath, store: 'env' })).rejects.toThrow(/--store env/)
    expect(t.adapter.connections).toEqual([])
  })

  it('rejects an unsupported algorithm and a Keychain item without a service', async () => {
    const t = await setup()
    await expect(t.run({ algorithm: 'rsa' })).rejects.toThrow(/Algorithm must be one of/)
    await expect(t.run({ keychainItem: 'justanaccount' })).rejects.toThrow(/<service>\/<account>/)
  })

  it('refuses the Keychain stores off macOS, before generating a key', async () => {
    const t = await setup()
    await expect(t.run({ algorithm: 'ed25519' }, 'prod', false)).rejects.toThrow(/only available on macOS/)
    await expect(t.run({ keychainItem: 'a/b' }, 'prod', false)).rejects.toThrow(/only available on macOS/)
    expect(t.generated).toEqual([])
    await t.run({ store: 'file' }, 'prod', false)
    expect(t.generated).toEqual(['ed25519'])
  })
})

describe('add-env failures', () => {
  it('saves nothing when getMe fails for an imported key', async () => {
    const t = await setup({
      connect: async () => {
        throw new Error('401 unauthorized')
      },
    })
    await expect(t.run({ import: t.keyPath })).rejects.toThrow('401 unauthorized')
    expect(t.keychain.secrets.size).toBe(0)
    await expect(readFile(t.configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a generated key when getMe fails, and says how to retry with it', async () => {
    const t = await setup({
      connect: async () => {
        throw new Error('401 unauthorized')
      },
    })
    await expect(t.run({ algorithm: 'ed25519' })).rejects.toThrow(
      /401 unauthorized.*--keychain-item simplexrpl-mcp\/prod/,
    )
    expect(t.keychain.secrets.get('simplexrpl-mcp/prod')).toBe(GENERATED.trim())
    await expect(readFile(t.configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('saves nothing when getMe itself rejects', async () => {
    const t = await setup({
      connect: async connection => ({
        ...(await createFakeAdapter().connect(connection)),
        getMe: async () => {
          throw new Error('forbidden')
        },
      }),
    })
    await expect(t.run({ import: t.keyPath })).rejects.toThrow('forbidden')
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('removes a key file it wrote when the config cannot be written', async () => {
    const t = await setup()
    // A directory at the staged path makes writing the config fail.
    await mkdir(`${t.configPath}.tmp`)
    await expect(t.run({ import: t.keyPath, store: 'file' })).rejects.toThrow()
    await expect(stat(join(t.dir, 'keys', 'prod.pem'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to overwrite a config file that is not valid JSON', async () => {
    const t = await setup()
    await writeFile(t.configPath, '{ not json')
    await expect(t.run({ import: t.keyPath })).rejects.toThrow(/not valid JSON/)
    expect(t.keychain.secrets.size).toBe(0)
  })
})

describe('add-env existing config', () => {
  it('keeps other Environments and the default when adding one', async () => {
    const t = await setup()
    await writeFile(
      t.configPath,
      JSON.stringify({ defaultEnvironment: 'old', environments: { old: { backend: 'ripple-custody' } } }),
    )
    await t.run({ import: t.keyPath })
    const config = await t.config()
    expect(config.defaultEnvironment).toBe('old')
    expect(Object.keys(config.environments)).toEqual(['old', 'prod'])
  })

  it('does not replace an existing Environment unless confirmed or forced', async () => {
    const t = await setup()
    await t.run({ import: t.keyPath })
    t.keychain.secrets.set('simplexrpl-mcp/prod', 'original')
    await expect(t.run({ import: t.keyPath })).rejects.toThrow(/already exists/)
    expect(t.keychain.secrets.get('simplexrpl-mcp/prod')).toBe('original')
    t.answers[Q.replace] = 'y'
    await t.run({ import: t.keyPath })
    expect(t.keychain.secrets.get('simplexrpl-mcp/prod')).toBe(PEM.trim())
    t.keychain.secrets.set('simplexrpl-mcp/prod', 'original')
    t.answers[Q.replace] = ''
    await t.run({ import: t.keyPath, force: true })
    expect(t.keychain.secrets.get('simplexrpl-mcp/prod')).toBe(PEM.trim())
  })
})

describe('add-env and the runtime', () => {
  it('writes a Key reference the runtime can resolve from the Keychain', async () => {
    const t = await setup()
    await t.run({ import: t.keyPath })
    const adapter = createFakeAdapter()
    const runtime = createRuntime({ configPath: t.configPath, env: {}, connect: adapter.connect, keychain: t.keychain })
    const result = await runtime.run({ environment: 'prod', requires: 'read' }, async backend => backend.getMe())
    expect(result).toMatchObject({ environment: 'prod', publicKey: expect.any(String) })
    expect(adapter.connections[0]?.signingKey).toBe(PEM.trim())
  })

  it('resolves a Keychain item of another service and a bare keychain: account', async () => {
    const t = await setup()
    t.keychain.secrets.set('custody-mcp/dev', PEM.trim())
    t.keychain.secrets.set('simplexrpl-mcp/legacy', 'legacy-key')
    await t.run({ keychainItem: 'custody-mcp/dev' })
    const config = await t.config()
    config.environments.legacy = { ...config.environments.prod, keyRef: 'keychain:legacy' }
    await writeFile(t.configPath, JSON.stringify(config))
    const adapter = createFakeAdapter()
    const runtime = createRuntime({ configPath: t.configPath, env: {}, connect: adapter.connect, keychain: t.keychain })
    await runtime.run({ environment: 'prod', requires: 'read' }, async backend => backend.getMe())
    await runtime.run({ environment: 'legacy', requires: 'read' }, async backend => backend.getMe())
    expect(adapter.connections.map(c => c.signingKey)).toEqual([PEM.trim(), 'legacy-key'])
  })

  it('reports a missing Keychain entry as a key-reference error', async () => {
    const t = await setup()
    await t.run({ import: t.keyPath })
    t.keychain.secrets.clear()
    const runtime = createRuntime({
      configPath: t.configPath,
      env: {},
      connect: t.adapter.connect,
      keychain: t.keychain,
    })
    const result = await runtime.run({ environment: 'prod', requires: 'read' }, async backend => backend.getMe())
    expect(result).toMatchObject({ error: { code: 'key-reference' } })
  })
})

describe('Keychain secrets', () => {
  it('decodes b64: entries and a PEM that security printed as hex, and leaves other values alone', () => {
    expect(decodeSecret(`b64:${Buffer.from(PEM).toString('base64')}`)).toBe(PEM)
    expect(decodeSecret(Buffer.from(PEM).toString('hex'))).toBe(PEM)
    expect(decodeSecret('deadbeef')).toBe('deadbeef')
    expect(decodeSecret('plain-key')).toBe('plain-key')
  })
})
