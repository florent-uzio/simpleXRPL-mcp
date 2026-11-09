import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const KEYCHAIN_SERVICE = 'simplexrpl-mcp'

/** Where a Key reference's `keychain:<account>` entries live. */
export interface Keychain {
  set(account: string, secret: string): Promise<void>
  /** Undefined when there is no such entry. */
  get(account: string): Promise<string | undefined>
}

// The secret is stored base64-encoded: `security` prints multi-line values as hex, which a plain key could be mistaken for.
const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`

/**
 * The macOS Keychain, through the `security` tool. The secret travels over stdin
 * (`security -i`), never argv, so it does not show up in the process list.
 */
export const macosKeychain: Keychain = {
  set: (account, secret) =>
    new Promise((resolve, reject) => {
      const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', chunk => (stderr += chunk))
      child.on('error', reject)
      child.on('close', code =>
        code === 0 ? resolve() : reject(new Error(`security exited with ${code}: ${stderr.trim()}`)),
      )
      const encoded = Buffer.from(secret, 'utf8').toString('base64')
      child.stdin.end(
        `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(account)} -w ${quote(encoded)}\n`,
      )
    }),

  get: async account => {
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'])
      return Buffer.from(stdout.trim(), 'base64').toString('utf8')
    } catch (cause) {
      // 44: the item could not be found.
      if ((cause as { code?: number }).code === 44) return undefined
      throw cause
    }
  },
}
