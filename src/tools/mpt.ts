import type { Runtime } from '../environments/runtime'
import { createNativeOperationTool } from './native-write'
import { mptAuthorize, mptIssuanceCreate, mptIssuanceDestroy, mptIssuanceSet } from './operations/mpt'

export const createMptIssuanceCreate = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'mptIssuanceCreate',
    description: 'Creates an MPT issuance (MPTokenIssuanceCreate) from the sending account, with XLS-89 metadata.',
    ...mptIssuanceCreate,
  })

export const createMptAuthorize = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'mptAuthorize',
    description:
      'Authorizes (MPTokenAuthorize) an MPT: a holder opts in to an issuance, or, with `holder`, the issuer authorizes that holder. `tfMPTUnauthorize` reverses it.',
    ...mptAuthorize,
  })

export const createMptIssuanceSet = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'mptIssuanceSet',
    description:
      'Updates an MPT issuance (MPTokenIssuanceSet): lock or unlock it or one holder, or enable confidential balances with encryption keys.',
    ...mptIssuanceSet,
  })

export const createMptIssuanceDestroy = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'mptIssuanceDestroy',
    description: 'Destroys an MPT issuance (MPTokenIssuanceDestroy); only possible with no tokens outstanding.',
    ...mptIssuanceDestroy,
  })
