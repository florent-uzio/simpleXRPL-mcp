import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Connect } from '../backend/adapter'
import { createFakeKeychain } from '../testing/fake-keychain'
import { createFakeAdapter } from '../testing/fake-adapter'
import { createRuntime } from '../environments/runtime'
import { runAddEnv } from './add-env'

const dirs: string[] = []
afterEach(() => Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))))

const PEM = '-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----\n'

const setup = async (connect?: Connect) => {
  const dir = await mkdtemp(join(tmpdir(), 'simplexrpl-add-env-'))
  dirs.push(dir)
  const keyPath = join(dir, 'key.pem')
  await writeFile(keyPath, PEM)
  const configPath = join(dir, 'config.json')
  const keychain = createFakeKeychain()
  const adapter = createFakeAdapter()
  const answers: Record<string, string> = {
    'Gateway URL': 'https://custody.example.com',
    'Token URL': 'https://custody.example.com/token',
    'Client ID (optional)': 'client-1',
    'Domain ID (optional)': '',
    'Primary address': 'rPrimary',
    'Access level (read, propose, approve)': 'propose',
    'Allow Raw signing, which Custody policies cannot inspect? (y/N)': '',
    'Private key file': keyPath,
  }
  const asked: string[] = []
  const ask = async (question: string) => {
    asked.push(question)
    return answers[question] ?? ''
  }
  const run = (name = 'prod') =>
    runAddEnv({ name, configPath, ask, keychain, connect: connect ?? adapter.connect, log: () => {} })
  return { dir, keyPath, configPath, keychain, adapter, answers, asked, run }
}

describe('add-env', () => {
  it('stores the key in the Keychain and saves a keychain: Key reference, never the key', async () => {
    const t = await setup()
    await t.run('prod')
    const raw = await readFile(t.configPath, 'utf8')
    expect(raw).not.toContain(PEM.trim())
    expect(raw).not.toContain('abc')
    expect(JSON.parse(raw).environments.prod).toMatchObject({
      backend: 'ripple-custody',
      gatewayUrl: 'https://custody.example.com',
      tokenUrl: 'https://custody.example.com/token',
      clientId: 'client-1',
      primary: 'rPrimary',
      keyRef: 'keychain:prod',
      access: 'propose',
      allowRawSigning: false,
    })
    expect(t.keychain.secrets.get('prod')).toBe(PEM.trim())
    expect(t.adapter.connections[0]?.signingKey).toBe(PEM.trim())
  })

  it('does not save anything when getMe fails', async () => {
    const t = await setup(async () => {
      throw new Error('401 unauthorized')
    })
    await expect(t.run('prod')).rejects.toThrow('401 unauthorized')
    expect(t.keychain.secrets.size).toBe(0)
    await expect(readFile(t.configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not save anything when getMe itself rejects', async () => {
    const t = await setup(async () => ({
      getMe: async () => {
        throw new Error('forbidden')
      },
    }))
    await expect(t.run('prod')).rejects.toThrow('forbidden')
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('rejects invalid answers before touching the Keychain or the network', async () => {
    const t = await setup()
    t.answers['Gateway URL'] = 'not a url'
    await expect(t.run('prod')).rejects.toThrow(/gatewayUrl|URL/i)
    t.answers['Gateway URL'] = 'https://custody.example.com'
    t.answers['Access level (read, propose, approve)'] = 'root'
    await expect(t.run('prod')).rejects.toThrow(/access/i)
    expect(t.adapter.connections).toEqual([])
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('keeps other Environments and the default when adding one', async () => {
    const t = await setup()
    await writeFile(
      t.configPath,
      JSON.stringify({ defaultEnvironment: 'old', environments: { old: { backend: 'ripple-custody' } } }),
    )
    await t.run('prod')
    const config = JSON.parse(await readFile(t.configPath, 'utf8'))
    expect(config.defaultEnvironment).toBe('old')
    expect(Object.keys(config.environments)).toEqual(['old', 'prod'])
  })

  it('asks about Raw signing and saves the answer', async () => {
    const t = await setup()
    t.answers['Allow Raw signing, which Custody policies cannot inspect? (y/N)'] = 'y'
    await t.run('prod')
    expect(JSON.parse(await readFile(t.configPath, 'utf8')).environments.prod.allowRawSigning).toBe(true)
  })

  it('does not replace an existing Environment unless confirmed', async () => {
    const t = await setup()
    await t.run('prod')
    t.keychain.secrets.set('prod', 'original')
    const replaceQuestion = 'Environment "prod" already exists. Replace it and its Keychain key? (y/N)'
    await expect(t.run('prod')).rejects.toThrow(/already exists/)
    expect(t.keychain.secrets.get('prod')).toBe('original')
    t.answers[replaceQuestion] = 'y'
    await t.run('prod')
    expect(t.keychain.secrets.get('prod')).toBe(PEM.trim())
  })

  it('leaves no key in the Keychain when the config cannot be written', async () => {
    const t = await setup()
    // A directory where the config file should go makes the final rename fail.
    await mkdir(t.configPath)
    await expect(t.run('prod')).rejects.toThrow()
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('refuses to overwrite a config file that is not valid JSON', async () => {
    const t = await setup()
    await writeFile(t.configPath, '{ not json')
    await expect(t.run('prod')).rejects.toThrow(/not valid JSON/)
    expect(t.keychain.secrets.size).toBe(0)
  })

  it('writes a Key reference the runtime can resolve from the Keychain', async () => {
    const t = await setup()
    await t.run('prod')
    const adapter = createFakeAdapter()
    const runtime = createRuntime({ configPath: t.configPath, env: {}, connect: adapter.connect, keychain: t.keychain })
    const result = await runtime.run({ environment: 'prod', requires: 'read' }, async backend => backend.getMe())
    expect(result).toMatchObject({ environment: 'prod', publicKey: expect.any(String) })
    expect(adapter.connections[0]?.signingKey).toBe(PEM.trim())
  })

  it('reports a missing Keychain entry as a key-reference error', async () => {
    const t = await setup()
    await t.run('prod')
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
