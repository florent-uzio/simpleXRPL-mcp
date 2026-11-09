import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import { createRuntime } from './environments/runtime'
import { createFakeAdapter } from './testing/fake-adapter'
import { createTools } from './tools'

describe('getMcpVersion', () => {
  it('returns the package version', async () => {
    const result = await createTools(
      createRuntime({ configPath: '/none', env: {}, connect: createFakeAdapter().connect }),
    ).getMcpVersion.execute!({}, {} as never)
    expect(result).toEqual({ mcpVersion: packageJson.version })
  })
})
