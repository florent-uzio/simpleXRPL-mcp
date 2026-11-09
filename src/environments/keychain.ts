import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const KEYCHAIN_SERVICE = 'simplexrpl-mcp'

/** Where a Key reference's `keychain:<account>` entries live. */
export interface Keychain {
  set(account: string, secret: string): Promise<void>
  /** Undefined when there is no such entry. */
  get(account: string): Promise<string | undefined>
}

// Secrets are stored as `b64:<base64>`: `security` prints multi-line values as hex, which a plain key could be mistaken for.
// An entry without the prefix (added by hand) is returned as is.
const ENCODED_PREFIX = 'b64:'
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
      const encoded = ENCODED_PREFIX + Buffer.from(secret, 'utf8').toString('base64')
      child.stdin.end(
        `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(account)} -w ${quote(encoded)}\n`,
      )
    }),

  get: async account => {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        account,
        '-w',
      ])
      const value = stdout.trim()
      return value.startsWith(ENCODED_PREFIX)
        ? Buffer.from(value.slice(ENCODED_PREFIX.length), 'base64').toString('utf8')
        : value
    } catch (cause) {
      // 44: the item could not be found.
      if ((cause as { code?: number }).code === 44) return undefined
      throw cause
    }
  },
}
