import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { Runtime } from '../environments/runtime'

export const createListEnvironments = (runtime: Runtime) =>
  createTool({
    id: 'listEnvironments',
    description:
      'Lists the configured Environments with their Backend, Access level and whether raw signing is allowed. Never reads a Key reference.',
    inputSchema: z.object({}),
    execute: async () => {
      const { defaultEnvironment, entries, configError } = await runtime.list()
      return {
        defaultEnvironment: defaultEnvironment ?? null,
        configError: configError ?? null,
        environments: entries.map(entry =>
          'error' in entry
            ? { name: entry.name, error: entry.error }
            : {
                name: entry.name,
                backend: entry.settings.backend,
                access: entry.settings.access,
                allowRawSigning: entry.settings.allowRawSigning,
              },
        ),
      }
    },
  })
