import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import { createTools } from './tools'

describe('getMcpVersion', () => {
  it('returns the package version', async () => {
    const result = await createTools().getMcpVersion.execute!({}, {} as never)
    expect(result).toEqual({ mcpVersion: packageJson.version })
  })
})
