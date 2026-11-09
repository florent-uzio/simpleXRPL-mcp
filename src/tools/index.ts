import type { Runtime } from '../environments/runtime'
import { createGetMe, createListAccounts, createWaitForIntent } from './custody'
import { createListEnvironments } from './environments'
import { getMcpVersion } from './server-info'
import { createXrpTransfer } from './xrp-transfer'

export const createTools = (runtime: Runtime) => ({
  getMcpVersion,
  listEnvironments: createListEnvironments(runtime),
  getMe: createGetMe(runtime),
  waitForIntent: createWaitForIntent(runtime),
  xrpTransfer: createXrpTransfer(runtime),
  listAccounts: createListAccounts(runtime),
})
