import { z } from 'zod'
import { encodeMptMetadata, mptMetadataSchema } from '../mpt-metadata'
import { defineOperation } from './operation'

export const issuanceId = z.string().describe('MPT issuance id (192-bit hex)')
const holder = z.string().describe('Holder r-address')
export const tokenIdentifier = (id: string) => ({ type: 'MPTokenIssuanceId' as const, issuanceId: id })
const holderAddress = (address: string) => ({ type: 'Address' as const, address })

export const mptIssuanceCreate = defineOperation({
  shape: {
    flags: z
      .array(
        z.enum([
          'tfMPTRequireAuth',
          'tfMPTCanClawback',
          'tfMPTCanTransfer',
          'tfMPTCanEscrow',
          'tfMPTCanLock',
          'tfMPTCanTrade',
          'tfMPTCanConfidentialAmount',
        ]),
      )
      .default([])
      .describe('Issuance flags'),
    assetScale: z.number().int().min(0).max(19).optional().describe('Decimal places of one unit'),
    transferFee: z
      .number()
      .int()
      .min(0)
      .max(50000)
      .optional()
      .describe('Transfer fee in 1/100,000ths; needs tfMPTCanTransfer'),
    maximumAmount: z
      .string()
      .regex(/^\d+$/, 'an unsigned integer string')
      .optional()
      .describe('Maximum supply, in the smallest unit'),
    metadata: mptMetadataSchema.optional().describe('XLS-89 token metadata, encoded for you'),
  },
  operation: ({ metadata, ...rest }) => ({
    type: 'MPTokenIssuanceCreate',
    ...rest,
    ...(metadata && { metadata: { type: 'HexEncodedMetadata' as const, value: encodeMptMetadata(metadata) } }),
  }),
})

export const mptAuthorize = defineOperation({
  shape: {
    issuanceId,
    holder: holder.optional().describe('Holder to authorize, when the sending account is the issuer'),
    flags: z.array(z.literal('tfMPTUnauthorize')).default([]),
  },
  operation: ({ issuanceId: id, holder: address, flags }) => ({
    type: 'MPTokenAuthorize',
    tokenIdentifier: tokenIdentifier(id),
    flags,
    ...(address && { holder: holderAddress(address) }),
  }),
})

export const mptIssuanceSet = defineOperation({
  shape: {
    issuanceId,
    holder: holder.optional().describe('Holder to lock or unlock; omit for the whole issuance'),
    flags: z.array(z.enum(['tfMPTLock', 'tfMPTUnlock'])).default([]),
    mutableFlags: z.array(z.literal('MPTSetCanConfidentialAmount')).default([]),
    issuerEncryptionKey: z.string().optional().describe("The issuer's base64 ElGamal public key"),
    auditorEncryptionKey: z.string().optional().describe("The auditor's base64 ElGamal public key"),
  },
  operation: ({ issuanceId: id, holder: address, ...rest }) => ({
    type: 'MPTokenIssuanceSet',
    tokenIdentifier: tokenIdentifier(id),
    ...rest,
    ...(address && { holder: holderAddress(address) }),
  }),
})

export const mptIssuanceDestroy = defineOperation({
  shape: { issuanceId },
  operation: ({ issuanceId: id }) => ({ type: 'MPTokenIssuanceDestroy', tokenIdentifier: tokenIdentifier(id) }),
})
