import type { Runtime } from '../environments/runtime'
import { createGetMe, createListAccounts } from './custody'
import { createListEnvironments } from './environments'
import { getMcpVersion } from './server-info'

export const createTools = (runtime: Runtime) => ({
  getMcpVersion,
  listEnvironments: createListEnvironments(runtime),
  getMe: createGetMe(runtime),
  listAccounts: createListAccounts(runtime),
})
