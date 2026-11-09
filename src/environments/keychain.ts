import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const KEYCHAIN_SERVICE = 'simplexrpl-mcp'

/** Where a Key reference's `keychain:<service>/<account>` entries live. */
export interface Keychain {
  set(service: string, account: string, secret: string): Promise<void>
  /** Undefined when there is no such entry. */
  get(service: string, account: string): Promise<string | undefined>
}

// Secrets are stored as `b64:<base64>`: `security` prints multi-line values as hex, which a plain key could be mistaken for.
// An entry without the prefix (added by hand, or by another tool) is returned as is, except a PEM that `security`
// printed as hex, which is decoded.
const ENCODED_PREFIX = 'b64:'
const PEM_HEADER = '-----BEGIN'
export const decodeSecret = (value: string) => {
  if (value.startsWith(ENCODED_PREFIX))
    return Buffer.from(value.slice(ENCODED_PREFIX.length), 'base64').toString('utf8')
  if (/^([0-9a-f]{2})+$/i.test(value)) {
    const decoded = Buffer.from(value, 'hex').toString('utf8')
    if (decoded.startsWith(PEM_HEADER)) return decoded
  }
  return value
}
const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`

/**
 * The macOS Keychain, through the `security` tool. The secret travels over stdin
 * (`security -i`), never argv, so it does not show up in the process list.
 */
export const macosKeychain: Keychain = {
  set: (service, account, secret) =>
    new Promise((resolve, reject) => {
      const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', chunk => (stderr += chunk))
      child.on('error', reject)
      child.on('close', code =>
        code === 0 ? resolve() : reject(new Error(`security exited with ${code}: ${stderr.trim()}`)),
      )
      const encoded = ENCODED_PREFIX + Buffer.from(secret, 'utf8').toString('base64')
      child.stdin.end(`add-generic-password -U -s ${quote(service)} -a ${quote(account)} -w ${quote(encoded)}\n`)
    }),

  get: async (service, account) => {
    try {
      const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', service, '-a', account, '-w'])
      return decodeSecret(stdout.trim())
    } catch (cause) {
      // 44: the item could not be found.
      if ((cause as { code?: number }).code === 44) return undefined
      throw cause
    }
  },
}
