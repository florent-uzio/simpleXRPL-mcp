import { z } from 'zod'

// XLS-89 (https://xls.xrpl.org/xls/XLS-0089-multi-purpose-token-metadata-schema.html), long names here, short keys on the ledger.
const MAX_METADATA_BYTES = 1024

const ASSET_CLASSES = ['rwa', 'memes', 'wrapped', 'gaming', 'defi', 'other'] as const
const RWA_SUBCLASSES = [
  'stablecoin',
  'commodity',
  'real_estate',
  'private_credit',
  'equity',
  'treasury',
  'other',
] as const

export const mptMetadataSchema = z
  .object({
    ticker: z
      .string()
      .regex(/^[A-Z0-9]{1,6}$/, 'at most 6 characters, A-Z and 0-9 only')
      .describe('Token ticker, e.g. USDX'),
    name: z.string().min(1).describe('Token name'),
    desc: z.string().optional().describe('Short description'),
    icon: z.string().min(1).describe('Icon location: `hostname/path` (HTTPS assumed) or a full URI'),
    asset_class: z.enum(ASSET_CLASSES).describe('Asset class'),
    asset_subclass: z.enum(RWA_SUBCLASSES).optional().describe('Required when asset_class is `rwa`'),
    issuer_name: z.string().min(1).describe('Name of the issuer'),
    uris: z
      .array(
        z.object({
          uri: z.string().min(1).describe('`hostname/path` (HTTPS assumed) or a full URI'),
          category: z.enum(['website', 'social', 'docs', 'other']),
          title: z.string().min(1),
        }),
      )
      .optional()
      .describe('Related links'),
    additional_info: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe('Free-form JSON object or text'),
  })
  .refine(metadata => metadata.asset_class !== 'rwa' || metadata.asset_subclass !== undefined, {
    message: 'asset_subclass is required when asset_class is rwa',
    path: ['asset_subclass'],
  })

export type MptMetadata = z.infer<typeof mptMetadataSchema>

/** Encodes metadata as XLS-89 compact JSON, hex, as the `MPTokenMetadata` field carries it. */
export const encodeMptMetadata = (metadata: MptMetadata): string => {
  const compact = {
    t: metadata.ticker,
    n: metadata.name,
    d: metadata.desc,
    i: metadata.icon,
    ac: metadata.asset_class,
    as: metadata.asset_subclass,
    in: metadata.issuer_name,
    us: metadata.uris?.map(({ uri, category, title }) => ({ u: uri, c: category, t: title })),
    ai: metadata.additional_info,
  }
  const bytes = Buffer.from(JSON.stringify(compact), 'utf8')
  if (bytes.length > MAX_METADATA_BYTES) {
    throw new Error(`MPT metadata is ${bytes.length} bytes, over the ${MAX_METADATA_BYTES}-byte limit`)
  }
  return bytes.toString('hex').toUpperCase()
}
