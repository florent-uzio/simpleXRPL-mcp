# @florent-uzio/simplexrpl-mcp

## 0.1.0

### Minor Changes

- c3c41f6: Add the `add-env <name>` setup command: it prompts for the Custody details and Access level, verifies them with `getMe`, stores the private key in the macOS Keychain and saves the Environment with a `keychain:` Key reference.
- ed167d6: First release (0.1.0): a stdio MCP server for Ripple Custody with Environments, Access levels, the `add-env` setup command and the `getMe`, `listEnvironments`, `listAccounts`, `waitForIntent` and `xrpTransfer` tools. The README documents setup, Access levels and Raw signing.
- d975d0b: Add the `listAccounts` read tool: browse a domain's accounts with their XRPL addresses, one page at a time with a cursor, defaulting to the Environment's domain or the user's only domain.
- 5e50e1b: Add Environments (config file plus zero-setup `env`), lazy `file:`/`env:` Key reference resolution, Access level enforcement, and the `listEnvironments` and `getMe` tools.
- 673bd4e: Add the `waitForIntent` tool: follows an Intent until it is executed, rejected, expired or failed, and reports an Intent still awaiting approval as an answer rather than an error.
- 25708fa: Add the `xrpTransfer` tool: a Dry run first (returning the fee estimate), then a Propose that returns the `intentId` at once. Needs the `propose` Access level and a named Environment.

### Patch Changes

- c9e9a88: Add `npm run smoke`, a live smoke script that runs `getMe`, `listAccounts` and an XRP transfer Dry run against a real Environment, and with `--propose` also a real Propose followed by `waitForIntent`.
