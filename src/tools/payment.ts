import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { Runtime } from '../environments/runtime'
import { DRY_RUN_THEN_PROPOSE, dryRunThenPropose, memoSchema, toMemos } from './native-write'
import { PAYMENT_AMOUNT_UNITS, checkPaymentAmount, payment } from './operations/payment'

export const createPayment = (runtime: Runtime) =>
  createTool({
    id: 'payment',
    description:
      'Proposes a Payment of XRP, an IOU, an MPT or a Custody ticker. ' +
      PAYMENT_AMOUNT_UNITS +
      ' For an IOU the destination must hold a trust line to the issuer; for an MPT it must have run `mptAuthorize` (and be authorized by the issuer, when the issuance requires auth); the Dry run may not catch a missing one. The issuer paying out mints; a holder paying the issuer burns. ' +
      DRY_RUN_THEN_PROPOSE,
    inputSchema: z
      .object({
        environment: z.string().describe('Environment name; required, a write never uses the default'),
        account: z.string().describe('Sending r-address, an account held in the Environment'),
        ...payment.shape,
        memos: z.array(memoSchema).optional().describe('On-ledger memos, as plain text'),
        sourceTag: z.number().int().min(0).max(4294967295).optional().describe('XRPL SourceTag'),
        ledgerId: z.string().optional().describe('Ledger id, only when the address is on several ledgers'),
        maximumFee: z
          .string()
          .regex(/^\d+$/, 'an unsigned integer string')
          .optional()
          .describe('Highest fee, in drops'),
        feeStrategy: z
          .discriminatedUnion('type', [
            z.object({ type: z.literal('Priority'), priority: z.enum(['Low', 'Medium', 'High']) }),
            z.object({
              type: z.literal('SpecifiedAdditionalFee'),
              drops: z.string().regex(/^\d+$/, 'an unsigned integer string'),
            }),
          ])
          .optional()
          .describe("How Custody sets the fee; Priority 'Low' when omitted"),
        dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
      })
      .superRefine(checkPaymentAmount),
    execute: input =>
      dryRunThenPropose(runtime, input, () => ({
        account: input.account,
        ledgerId: input.ledgerId,
        memos: toMemos(input.memos),
        sourceTag: input.sourceTag,
        maximumFee: input.maximumFee,
        feeStrategy: input.feeStrategy,
        operation: payment.operation(input),
      })),
  })
