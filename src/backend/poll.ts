/** One look at something the Backend records late: its value, or why it is not there yet. Throw when it never will be. */
export type Attempt<T> = { value: T } | { pending: string }

/**
 * Repeats `attempt` every `intervalMs` until it has a value or the next try would pass `timeoutMs`.
 * Running out of time is an answer (the last `pending` reason), not an error; a thrown attempt stops at once.
 */
export const pollUntil = async <T>(
  attempt: () => Promise<Attempt<T>>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<Attempt<T>> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await attempt()
    if ('value' in result || Date.now() + intervalMs > deadline) return result
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
