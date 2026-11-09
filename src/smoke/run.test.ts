import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, custodyEnvironment } from '../testing/harness'
import { parseSmokeArgs, runSmoke } from './run'

let harness: Awaited<ReturnType<typeof createHarness>>
const setup = async (access = 'propose') => {
  harness = await createHarness({ TEST_KEY: 'super-secret-key' })
  await harness.writeConfig({ environments: { dev: custodyEnvironment({ access }) } })
}
afterEach(() => harness?.cleanup())

const run = async (args: string[]) => {
  const lines: string[] = []
  const passed = await runSmoke({ call: harness.call, args: parseSmokeArgs(args), log: line => lines.push(line) })
  return { passed, output: lines.join('\n') }
}

describe('parseSmokeArgs', () => {
  it('requires an Environment name', () => {
    expect(() => parseSmokeArgs([])).toThrow(/--env/)
  })
  it('requires a destination for the transfer steps', () => {
    expect(() => parseSmokeArgs(['--env', 'dev'])).toThrow(/--to/)
  })
  it('does not propose unless asked', () => {
    expect(parseSmokeArgs(['--env', 'dev', '--to', 'rDest'])).toMatchObject({ propose: false, amount: '1' })
  })
})

describe('runSmoke', () => {
  it('passes every step and never proposes without --propose', async () => {
    await setup()
    const { passed, output } = await run(['--env', 'dev', '--to', 'rDest'])
    expect(passed).toBe(true)
    expect(output).toMatch(/PASS.*getMe/)
    expect(output).toMatch(/PASS.*listAccounts/)
    expect(output).toMatch(/PASS.*dry run/i)
    expect(output).toMatch(/SKIP.*propose/i)
    expect(harness.adapter.proposals).toHaveLength(0)
  })

  it('proposes and waits when asked', async () => {
    await setup()
    const { passed, output } = await run(['--env', 'dev', '--to', 'rDest', '--amount', '2', '--propose'])
    expect(passed).toBe(true)
    expect(harness.adapter.proposals).toEqual([{ to: 'rDest', amount: '2' }])
    expect(output).toMatch(/PASS.*propose/i)
    expect(output).toMatch(/intent-1/)
    expect(output).toMatch(/PASS.*waitForIntent/)
  })

  it('treats an Intent still awaiting approval as a pass', async () => {
    await setup()
    harness.adapter.state.outcome = {
      intentId: '',
      status: 'Open',
      isTerminal: false,
      isSuccess: false,
      reason: undefined,
    }
    const { passed, output } = await run(['--env', 'dev', '--to', 'rDest', '--propose'])
    expect(passed).toBe(true)
    expect(output).toMatch(/awaiting approval/i)
  })

  it('fails a step and the run when a tool errors, without leaking the key', async () => {
    await setup('read')
    const { passed, output } = await run(['--env', 'dev', '--to', 'rDest'])
    expect(passed).toBe(false)
    expect(output).toMatch(/FAIL.*dry run.*access-denied/i)
    expect(output).not.toContain('super-secret-key')
  })

  it('stops before proposing when the Dry run fails', async () => {
    await setup()
    harness.adapter.state.dryRunResult = { success: false, errors: ['insufficient funds'] }
    const { passed, output } = await run(['--env', 'dev', '--to', 'rDest', '--propose'])
    expect(passed).toBe(false)
    expect(output).toMatch(/FAIL.*dry run.*insufficient funds/i)
    expect(harness.adapter.proposals).toHaveLength(0)
  })
})
