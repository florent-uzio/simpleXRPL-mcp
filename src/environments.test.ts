import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createRuntime } from './environments/runtime'
import { createFakeAdapter, fakeMe } from './testing/fake-adapter'
import { createHarness, custodyEnvironment } from './testing/harness'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (env: Record<string, string | undefined> = { TEST_KEY: 'pem' }) =>
  (harness = await createHarness(env))
afterEach(() => harness?.cleanup())

describe('listEnvironments', () => {
  it('shows Backend, Access level and allowRawSigning, never reading a key', async () => {
    await setup()
    await harness.writeConfig({
      environments: {
        prod: custodyEnvironment({ access: 'approve' }),
        test: custodyEnvironment({ allowRawSigning: true, keyRef: 'file:/nope' }),
      },
    })
    const result = await harness.call('listEnvironments')
    expect(result).toMatchObject({
      environments: [
        { name: 'prod', backend: 'ripple-custody', access: 'approve', allowRawSigning: false },
        { name: 'test', backend: 'ripple-custody', access: 'read', allowRawSigning: true },
      ],
    })
    expect(harness.adapter.connections).toEqual([])
  })

  it('includes the zero-setup env Environment from RIPPLE_CUSTODY_* variables', async () => {
    await setup({
      RIPPLE_CUSTODY_API_URL: 'https://c.example.com',
      RIPPLE_CUSTODY_TOKEN_URL: 'https://c.example.com/token',
      RIPPLE_CUSTODY_PRIMARY: 'rPrimary',
      RIPPLE_CUSTODY_AUTH_SIGNING_KEY: 'pem',
    })
    const result = await harness.call('listEnvironments')
    expect(result).toMatchObject({ environments: [{ name: 'env', access: 'read', allowRawSigning: false }] })
  })

  it('reports an invalid entry without hiding the others', async () => {
    await setup()
    await harness.writeConfig({ environments: { bad: { backend: 'nope' }, good: custodyEnvironment() } })
    const result = (await harness.call('listEnvironments')) as { environments: { name: string; error?: string }[] }
    expect(result.environments.find(e => e.name === 'bad')?.error).toBeTruthy()
    expect(result.environments.find(e => e.name === 'good')?.error).toBeUndefined()
  })
})

describe('config problems', () => {
  it('shapes an invalid config file and still lists the zero-setup Environment', async () => {
    await setup({
      RIPPLE_CUSTODY_API_URL: 'https://c.example.com',
      RIPPLE_CUSTODY_TOKEN_URL: 'https://c.example.com/token',
      RIPPLE_CUSTODY_PRIMARY: 'rPrimary',
      RIPPLE_CUSTODY_AUTH_SIGNING_KEY: 'pem',
    })
    await writeFile(`${harness.dir}/config.json`, '{ not json')
    expect(await harness.call('listEnvironments')).toMatchObject({
      configError: expect.stringContaining('not valid JSON'),
      environments: [{ name: 'env' }],
    })
    expect(await harness.call('getMe')).toMatchObject({ environment: 'env', publicKey: fakeMe.publicKey })
  })
})

describe('getMe', () => {
  it('trims a file: key and reports an unreadable one as a key-reference error', async () => {
    await setup()
    const keyPath = `${harness.dir}/key.pem`
    await writeFile(keyPath, 'pem-contents\n')
    await harness.writeConfig({
      environments: {
        ok: custodyEnvironment({ keyRef: `file:${keyPath}` }),
        broken: custodyEnvironment({ keyRef: `file:${harness.dir}/missing.pem` }),
      },
    })
    expect(await harness.call('getMe', { environment: 'broken' })).toMatchObject({
      environment: 'broken',
      error: { code: 'key-reference' },
    })
    await harness.call('getMe', { environment: 'ok' })
    expect(harness.adapter.connections[0].signingKey).toBe('pem-contents')
  })

  it('reconnects when the key changes under the same settings', async () => {
    await setup()
    const keyPath = `${harness.dir}/key.pem`
    await writeFile(keyPath, 'one')
    await harness.writeConfig({ environments: { prod: custodyEnvironment({ keyRef: `file:${keyPath}` }) } })
    await harness.call('getMe')
    await writeFile(keyPath, 'two')
    await harness.call('getMe')
    expect(harness.adapter.connections.map(c => c.signingKey)).toEqual(['one', 'two'])
  })

  it('returns the user and domains, naming the Environment', async () => {
    await setup()
    await harness.writeConfig({ environments: { prod: custodyEnvironment() } })
    expect(await harness.call('getMe')).toEqual({ environment: 'prod', ...fakeMe })
    expect(harness.adapter.connections[0]).toMatchObject({ signingKey: 'pem', primary: 'rPrimary' })
  })

  it('fails only the Environment whose Key reference is broken', async () => {
    await setup()
    await harness.writeConfig({
      environments: {
        broken: custodyEnvironment({ keyRef: 'env:MISSING' }),
        fine: custodyEnvironment(),
      },
    })
    expect(await harness.call('getMe', { environment: 'broken' })).toMatchObject({
      environment: 'broken',
      error: { code: 'key-reference', message: expect.stringContaining('MISSING') },
    })
    expect(await harness.call('getMe', { environment: 'fine' })).toMatchObject({
      environment: 'fine',
      publicKey: fakeMe.publicKey,
    })
  })

  it('asks for `environment` when several exist and none is the default', async () => {
    await setup()
    await harness.writeConfig({ environments: { a: custodyEnvironment(), b: custodyEnvironment() } })
    expect(await harness.call('getMe')).toMatchObject({ environment: null, error: { code: 'environment-required' } })
    await harness.writeConfig({
      defaultEnvironment: 'b',
      environments: { a: custodyEnvironment(), b: custodyEnvironment() },
    })
    expect(await harness.call('getMe')).toMatchObject({ environment: 'b' })
  })

  it('applies config edits without a restart', async () => {
    await setup()
    await harness.writeConfig({ environments: { prod: custodyEnvironment({ primary: 'rOld' }) } })
    await harness.call('getMe')
    await harness.writeConfig({ environments: { prod: custodyEnvironment({ primary: 'rNew' }) } })
    await harness.call('getMe')
    expect(harness.adapter.connections.map(c => c.primary)).toEqual(['rOld', 'rNew'])
  })
})

describe('Access level', () => {
  it('refuses a tool needing more than the Environment has, before reading the key', async () => {
    await setup()
    await harness.writeConfig({ environments: { prod: custodyEnvironment({ keyRef: 'env:MISSING' }) } })
    const adapter = createFakeAdapter()
    const runtime = createRuntime({
      configPath: `${harness.dir}/config.json`,
      env: {},
      connect: adapter.connect,
    })
    const result = await runtime.run({ requires: 'propose' }, async () => ({}))
    expect(result).toMatchObject({
      environment: 'prod',
      error: { code: 'access-denied', message: expect.stringContaining('"propose"') },
    })
    expect(adapter.connections).toEqual([])
  })
})
