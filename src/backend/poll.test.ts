import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollUntil, type Attempt } from './poll'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** An attempt that answers with each of `results` in turn, counting its calls. */
const attempts = (...results: Attempt<string>[]) => {
  const attempt = vi.fn(async () => results[Math.min(attempt.mock.calls.length - 1, results.length - 1)])
  return attempt
}

describe('pollUntil', () => {
  it('returns the first value without waiting', async () => {
    const attempt = attempts({ value: 'ready' })
    expect(await pollUntil(attempt, { timeoutMs: 10_000, intervalMs: 1000 })).toEqual({ value: 'ready' })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('retries a pending attempt every interval until it has a value', async () => {
    const attempt = attempts({ pending: 'not yet' }, { pending: 'not yet' }, { value: 'ready' })
    const result = pollUntil(attempt, { timeoutMs: 10_000, intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toEqual({ value: 'ready' })
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('gives up at the deadline with the last pending reason', async () => {
    const attempt = attempts({ pending: 'first' }, { pending: 'last' })
    const result = pollUntil(attempt, { timeoutMs: 2500, intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toEqual({ pending: 'last' })
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('tries once when the timeout is 0', async () => {
    const attempt = attempts({ pending: 'not yet' })
    expect(await pollUntil(attempt, { timeoutMs: 0, intervalMs: 1000 })).toEqual({ pending: 'not yet' })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('stops at the first failure', async () => {
    const attempt = vi.fn(async (): Promise<Attempt<string>> => {
      throw new Error('boom')
    })
    await expect(pollUntil(attempt, { timeoutMs: 10_000, intervalMs: 1000 })).rejects.toThrow('boom')
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
