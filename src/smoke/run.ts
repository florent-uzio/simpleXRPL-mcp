export type SmokeArgs = {
  environment: string
  from: string
  to: string
  amount: string
  propose: boolean
  timeoutSeconds: number
}

export const SMOKE_USAGE =
  'Usage: npm run smoke -- --env <name> --from <rAddress> --to <rAddress> [--amount <xrp, default 1>] [--propose] [--timeout <seconds, default 60>]'

export const parseSmokeArgs = (argv: string[]): SmokeArgs => {
  const values = new Map<string, string>()
  let propose = false
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--propose') propose = true
    else if (['--env', '--from', '--to', '--amount', '--timeout'].includes(flag)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value. ${SMOKE_USAGE}`)
      values.set(flag, value)
    } else throw new Error(`Unknown argument "${flag}". ${SMOKE_USAGE}`)
  }
  const environment = values.get('--env')
  if (!environment) throw new Error(`--env is required. ${SMOKE_USAGE}`)
  const from = values.get('--from')
  if (!from) throw new Error(`--from is required for the transfer steps. ${SMOKE_USAGE}`)
  const to = values.get('--to')
  if (!to) throw new Error(`--to is required for the transfer steps. ${SMOKE_USAGE}`)
  // Checked before any call, so a bad value can never surface after a real Propose.
  const amount = values.get('--amount') ?? '1'
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new Error(`--amount must be a decimal XRP amount. ${SMOKE_USAGE}`)
  const timeoutSeconds = Number(values.get('--timeout') ?? 60)
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300) {
    throw new Error(`--timeout must be a whole number of seconds from 1 to 300. ${SMOKE_USAGE}`)
  }
  return { environment, from, to, amount, propose, timeoutSeconds }
}

type Call = (tool: string, args?: Record<string, unknown>) => Promise<unknown>

/**
 * Calls the server's tools in order and prints one line per step. Only chosen fields are printed,
 * never a raw result, so no key material or token can reach the output.
 */
export const runSmoke = async ({
  call,
  args,
  log,
}: {
  call: Call
  args: SmokeArgs
  log: (line: string) => void
}): Promise<boolean> => {
  let allPassed = true
  let pending = false
  const step = async (name: string, action: () => Promise<string>) => {
    try {
      log(`PASS  ${name}: ${await action()}`)
      return true
    } catch (cause) {
      allPassed = false
      log(`FAIL  ${name}: ${(cause as Error).message}`)
      return false
    }
  }
  /** Tools shape failures as `{ error }`: turn them into a thrown message naming the code. */
  const ok = async <T extends object>(tool: string, input: Record<string, unknown>) => {
    const result = (await call(tool, { environment: args.environment, ...input })) as T & {
      error?: { code: string; message: string } | boolean
      message?: string
    }
    if (result.error) {
      const failure = result.error
      throw new Error(
        typeof failure === 'object' ? `${failure.code}: ${failure.message}` : (result.message ?? 'invalid input'),
      )
    }
    return result
  }

  log(`Live smoke against Environment "${args.environment}"`)

  await step('getMe', async () => {
    const me = await ok<{ domains: { alias: string; user: { alias: string } }[] }>('getMe', {})
    return `user ${me.domains.map(domain => `${domain.user.alias}@${domain.alias}`).join(', ') || '(no domain)'}`
  })

  await step('listAccounts', async () => {
    const page = await ok<{ accounts: { addresses: unknown[] }[]; nextCursor?: string }>('listAccounts', { limit: 10 })
    const addresses = page.accounts.reduce((total, account) => total + account.addresses.length, 0)
    return `${page.accounts.length} accounts, ${addresses} XRPL addresses${page.nextCursor ? ' (more pages)' : ''}`
  })

  const transfer = { from: args.from, to: args.to, amount: args.amount }
  const dryRunPassed = await step('xrpTransfer dry run', async () => {
    const result = await ok<{ success: boolean; errors?: string[]; estimatedFeeDrops?: string }>('xrpTransfer', {
      ...transfer,
      dryRun: true,
    })
    if (!result.success) throw new Error(`Dry run rejected: ${(result.errors ?? []).join('; ')}`)
    return `fee ${result.estimatedFeeDrops ?? 'unknown'} drops`
  })

  if (!args.propose) {
    log('SKIP  xrpTransfer propose: pass --propose to send a real Intent')
  } else if (!dryRunPassed) {
    log('SKIP  xrpTransfer propose: the Dry run did not pass')
  } else {
    let intentId: string | undefined
    await step('xrpTransfer propose', async () => {
      const result = await ok<{ intentId: string }>('xrpTransfer', { ...transfer, dryRun: false })
      intentId = result.intentId
      return `intentId ${intentId}`
    })
    if (intentId) {
      await step(`waitForIntent (intentId ${intentId}; check it with getIntent, do not propose again)`, async () => {
        const outcome = await ok<{ status?: string; isTerminal: boolean; isSuccess: boolean; reason?: string }>(
          'waitForIntent',
          { intentId, timeoutSeconds: args.timeoutSeconds },
        )
        if (!outcome.isTerminal) {
          pending = true
          return `still awaiting approval (status ${outcome.status ?? 'unknown'})`
        }
        if (!outcome.isSuccess) throw new Error(`${outcome.status}${outcome.reason ? `: ${outcome.reason}` : ''}`)
        return `status ${outcome.status}`
      })
    }
  }

  log(
    !allPassed
      ? 'Some steps failed.'
      : pending
        ? 'All steps passed, but the Intent has not executed yet.'
        : 'All steps passed.',
  )
  return allPassed
}
