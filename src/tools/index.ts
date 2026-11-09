import type { Runtime } from '../environments/runtime'
import { createGetMe, createWaitForIntent } from './custody'
import { createListEnvironments } from './environments'
import { getMcpVersion } from './server-info'

export const createTools = (runtime: Runtime) => ({
  getMcpVersion,
  listEnvironments: createListEnvironments(runtime),
  getMe: createGetMe(runtime),
  waitForIntent: createWaitForIntent(runtime),
})
