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
      RIPPLE_CUSTODY_GATEWAY_URL: 'https://c.example.com',
      RIPPLE_CUSTODY_AUTH_TOKEN_URL: 'https://c.example.com/token',
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

describe('getMe', () => {
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
      error: { code: 'backend-error', message: expect.stringContaining('MISSING') },
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
