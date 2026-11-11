import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSimpleXrplMcpServer } from '../server'
import { createFakeAdapter } from './fake-adapter'

/** Seam 1: a real temp config file, the fake adapter, tools called by name on the real MCP server. */
export const createHarness = async (env: Record<string, string | undefined> = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'simplexrpl-mcp-'))
  const configPath = join(dir, 'config.json')
  const adapter = createFakeAdapter()
  const server = createSimpleXrplMcpServer({ configPath, env, connect: adapter.connect })
  return {
    dir,
    adapter,
    writeConfig: (config: unknown) => writeFile(configPath, JSON.stringify(config)),
    call: async (tool: string, args: Record<string, unknown> = {}) => {
      const result = await server.executeTool(tool, args)
      return (result as { output: unknown }).output
    },
    closeBackends: () => server.closeBackends(),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

export const custodyEnvironment = (overrides: Record<string, unknown> = {}) => ({
  backend: 'ripple-custody',
  rippleCustodyApiUrl: 'https://custody.example.com',
  rippleCustodyTokenUrl: 'https://custody.example.com/token',
  primary: 'rPrimary',
  keyRef: 'env:TEST_KEY',
  ...overrides,
})
