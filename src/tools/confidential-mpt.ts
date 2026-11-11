import { z } from 'zod'
import type { Runtime } from '../environments/runtime'
import { issuanceId, tokenIdentifier } from './operations/mpt'
import { createNativeOperationTool } from './native-write'

const amount = z
  .string()
  .regex(/^\d+$/, 'an unsigned integer string')
  .describe('Amount in the smallest unit of the MPT')

export const createConfidentialMptConvert = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'confidentialMptConvert',
    description:
      "Converts public MPT into the sending account's confidential balance (ConfidentialMPTConvert). A holder's first convert must be a zero-amount one: it registers the holder's ElGamal key, and a non-zero first convert may fail on chain with `tecNO_PERMISSION` after costing a fee, which the Dry run does not catch. MPT transfers a holder received are quarantined and must be released before a convert can spend them.",
    shape: { issuanceId, amount },
    operation: ({ issuanceId: id, amount }) => ({
      type: 'ConfidentialMPTConvert',
      tokenIdentifier: tokenIdentifier(id),
      amount,
    }),
  })

export const createConfidentialMptConvertBack = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'confidentialMptConvertBack',
    description:
      "Converts confidential MPT back into the sending account's public balance (ConfidentialMPTConvertBack).",
    shape: { issuanceId, amount },
    operation: ({ issuanceId: id, amount }) => ({
      type: 'ConfidentialMPTConvertBack',
      tokenIdentifier: tokenIdentifier(id),
      amount,
    }),
  })

export const createConfidentialMptMergeInbox = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'confidentialMptMergeInbox',
    description:
      "Merges the sending account's confidential inbox into its confidential balance (ConfidentialMPTMergeInbox).",
    shape: { issuanceId },
    operation: ({ issuanceId: id }) => ({ type: 'ConfidentialMPTMergeInbox', tokenIdentifier: tokenIdentifier(id) }),
  })
