import { z } from 'zod'
import type { Runtime } from '../environments/runtime'
import { createNativeOperationTool } from './native-write'

const address = (what: string) => z.string().describe(`${what} r-address`)
const drops = z.string().regex(/^-?\d+$/, 'an integer string in drops')

export const createSponsorshipSetAsSponsor = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'sponsorshipSetAsSponsor',
    description:
      "Sets up or changes an XLS-68 Sponsorship from the sending account, the sponsor, for a sponsee (SponsorshipSet): the sponsor pays the sponsee's fee and/or owner reserve.",
    shape: {
      sponsee: address('Sponsee'),
      flags: z
        .array(
          z.enum([
            'tfRequireSignForFee',
            'tfClearRequireSignForFee',
            'tfRequireSignForReserve',
            'tfClearRequireSignForReserve',
            'tfDeleteObject',
          ]),
        )
        .default([])
        .describe('Sponsorship flags'),
      feeAmountDelta: drops.optional().describe('Drops to add to the fee the sponsor has funded for the sponsee'),
      maxFee: z
        .string()
        .regex(/^\d+$/, 'an unsigned integer string in drops')
        .optional()
        .describe('The most, in drops, the sponsor pays for one transaction'),
      remainingOwnerCountDelta: z
        .number()
        .int()
        .optional()
        .describe('Owner reserves to add to what the sponsee has left'),
    },
    operation: ({ sponsee, ...rest }) => ({
      type: 'SponsorshipSetAsSponsor',
      sponsee: { type: 'Address', address: sponsee },
      ...rest,
    }),
  })

export const createSponsorshipSetAsSponsee = (runtime: Runtime) =>
  createNativeOperationTool(runtime, {
    id: 'sponsorshipSetAsSponsee',
    description: 'Accepts or sets the sponsor of the sending account, the sponsee (SponsorshipSet).',
    shape: { sponsor: address('Sponsor') },
    operation: ({ sponsor }) => ({ type: 'SponsorshipSetAsSponsee', sponsor: { type: 'Address', address: sponsor } }),
  })
