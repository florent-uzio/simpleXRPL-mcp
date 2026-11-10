import type { Runtime } from '../environments/runtime'
import { createGetMe, createGetMptIssuanceId, createListAccounts, createWaitForIntent } from './custody'
import { createListEnvironments } from './environments'
import { createMptAuthorize, createMptIssuanceCreate, createMptIssuanceDestroy, createMptIssuanceSet } from './mpt'
import {
  createConfidentialMptConvert,
  createConfidentialMptConvertBack,
  createConfidentialMptMergeInbox,
} from './confidential-mpt'
import { createSponsorshipSetAsSponsee, createSponsorshipSetAsSponsor } from './sponsorship'
import { createDryRunBatch, createProposeBatch } from './batch'
import { getMcpVersion } from './server-info'
import { createXrpTransfer } from './xrp-transfer'

export const createTools = (runtime: Runtime) => ({
  getMcpVersion,
  listEnvironments: createListEnvironments(runtime),
  getMe: createGetMe(runtime),
  waitForIntent: createWaitForIntent(runtime),
  getMptIssuanceId: createGetMptIssuanceId(runtime),
  xrpTransfer: createXrpTransfer(runtime),
  listAccounts: createListAccounts(runtime),
  mptIssuanceCreate: createMptIssuanceCreate(runtime),
  mptAuthorize: createMptAuthorize(runtime),
  mptIssuanceSet: createMptIssuanceSet(runtime),
  mptIssuanceDestroy: createMptIssuanceDestroy(runtime),
  confidentialMptConvert: createConfidentialMptConvert(runtime),
  confidentialMptConvertBack: createConfidentialMptConvertBack(runtime),
  confidentialMptMergeInbox: createConfidentialMptMergeInbox(runtime),
  sponsorshipSetAsSponsor: createSponsorshipSetAsSponsor(runtime),
  sponsorshipSetAsSponsee: createSponsorshipSetAsSponsee(runtime),
  dryRunBatch: createDryRunBatch(runtime),
  proposeBatch: createProposeBatch(runtime),
})
