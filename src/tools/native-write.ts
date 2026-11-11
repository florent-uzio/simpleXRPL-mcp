import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { NativeOrder } from '../backend/adapter'
import { ToolFailure, type Runtime } from '../environments/runtime'

const hex = (text: string) => Buffer.from(text, 'utf8').toString('hex').toUpperCase()

export const memoSchema = z.object({
  data: z.string().optional().describe('Memo text'),
  format: z.string().optional().describe('Memo format, e.g. text/plain'),
  type: z.string().optional().describe('Memo type, e.g. test'),
})

export const toMemos = (memos?: z.infer<typeof memoSchema>[]) =>
  memos?.map(memo => ({
    memoData: memo.data === undefined ? undefined : hex(memo.data),
    memoFormat: memo.format === undefined ? undefined : hex(memo.format),
    memoType: memo.type === undefined ? undefined : hex(memo.type),
  }))

export const DRY_RUN_THEN_PROPOSE =
  'Sent through custody.api as a Native operation order (for the simpleXRPL client verbs, use the client* tools). Runs a Dry run first and, by default, stops there, returning the fee estimate. With `dryRun: false` it Proposes after a successful Dry run and returns the `intentId` at once; approvers act later. Needs the `propose` Access level and a named Environment.'

/**
 * Every write: Dry-runs the order, stops there when `dryRun` is set, and otherwise Proposes the same order only if
 * the Dry run succeeded, returning the `intentId` at once. `toOrder` runs inside, so a failure to build is shaped too.
 */
export const dryRunThenPropose = (
  runtime: Runtime,
  input: { environment: string; dryRun: boolean },
  toOrder: () => NativeOrder,
) =>
  runtime.run({ environment: input.environment, requires: 'propose' }, async backend => {
    const order = toOrder()
    const check = await backend.dryRun(order)
    if (input.dryRun) return { dryRun: true as const, ...check }
    if (!check.success) {
      throw new ToolFailure('dry-run-failed', `The Dry run failed, nothing was proposed: ${check.errors.join('; ')}`)
    }
    const { intentId } = await backend.propose(order)
    return { dryRun: false as const, intentId, estimatedFeeDrops: check.estimatedFeeDrops }
  })

const common = {
  environment: z.string().describe('Environment name; required, a write never uses the default'),
  account: z.string().describe('Sending r-address, an account held in the Environment'),
  ledgerId: z.string().optional().describe('Ledger id, only when the address is on several ledgers'),
  memos: z.array(memoSchema).optional().describe('On-ledger memos, as plain text'),
  dryRun: z.boolean().default(true).describe('Only run the Dry run (default); false also Proposes'),
}

type CommonInput = {
  environment: string
  account: string
  ledgerId?: string
  memos?: z.infer<typeof memoSchema>[]
  dryRun: boolean
}

/** A write tool for one Native operation: the common write fields plus `shape`, mapped by `operation`. */
export const createNativeOperationTool = <Shape extends z.ZodRawShape>(
  runtime: Runtime,
  options: {
    id: string
    description: string
    shape: Shape
    operation: (input: z.infer<z.ZodObject<Shape>>) => NativeOrder['operation']
  },
) =>
  createTool({
    id: options.id,
    description: `${options.description} ${DRY_RUN_THEN_PROPOSE}`,
    inputSchema: z.object({ ...common, ...options.shape }),
    execute: raw => {
      const input = raw as CommonInput & z.infer<z.ZodObject<Shape>>
      const {
        environment: _environment,
        account: _account,
        ledgerId: _ledgerId,
        memos: _memos,
        dryRun: _dryRun,
        ...rest
      } = input
      return dryRunThenPropose(runtime, input, () => ({
        account: input.account,
        ledgerId: input.ledgerId,
        memos: toMemos(input.memos),
        operation: options.operation(rest as unknown as z.infer<z.ZodObject<Shape>>),
      }))
    },
  })
