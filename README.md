# simpleXRPL MCP

An MCP server that lets you read from and act on Ripple Custody (and later the XRP Ledger) from an AI client, through [simpleXRPL](https://github.com/ripple/simpleXRPL). It runs over stdio. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for the decisions.

Requires Node.js 22.13 or later.

## Quick start

1. Create an Environment (`add-env` needs macOS; on other systems use the config file or [zero setup](#zero-setup) below; see [Setting up an Environment](#setting-up-an-environment-macos)):

   ```bash
   npx @florent-uzio/simplexrpl-mcp add-env <name>
   ```

2. Add the server to your MCP client, for example in Claude Code:

   ```bash
   claude mcp add simplexrpl -- npx -y @florent-uzio/simplexrpl-mcp
   ```

   or in a JSON client config:

   ```json
   {
     "mcpServers": {
       "simplexrpl": { "command": "npx", "args": ["-y", "@florent-uzio/simplexrpl-mcp"] }
     }
   }
   ```

## Tools

| Tool               | Access level | What it does                                                                                                           |
| ------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `getMcpVersion`    | none         | Reports the server version.                                                                                            |
| `listEnvironments` | none         | Lists the Environments with their Access level and Raw signing setting.                                                |
| `getMe`            | `read`       | Returns the Environment's own Custody user.                                                                            |
| `listAccounts`     | `read`       | Browses a Domain's accounts and their XRPL addresses, one page at a time with a cursor.                                |
| `waitForIntent`    | `read`       | Follows an Intent until it is executed, rejected, expired or failed. "Awaiting approval" is not an error.              |
| `xrpTransfer`      | `propose`    | Dry run (default, returns the fee estimate); with `dryRun: false` it then Proposes and returns the `intentId` at once. |

Write tools must name their `environment`; they never use the default.

## Environments

An **Environment** is a named signing setup: one Backend (today only Ripple Custody) with its credentials and settings. Environments live in `~/.config/simplexrpl-mcp/config.json` (override the path with `SIMPLEXRPL_MCP_CONFIG`). The file is read on every use, so edits apply without a restart, and one invalid entry never hides the others.

```json
{
  "defaultEnvironment": "prod",
  "environments": {
    "prod": {
      "backend": "ripple-custody",
      "gatewayUrl": "https://custody.example.com",
      "tokenUrl": "https://custody.example.com/token",
      "clientId": "client-1",
      "domainId": "optional-domain-id",
      "primary": "rPrimaryAddress",
      "keyRef": "keychain:prod",
      "access": "propose",
      "allowRawSigning": false
    }
  }
}
```

The config never holds a private key, only a **Key reference** (`keychain:`, `file:` or `env:` are resolved today; `aws-sm:` and `aws-kms:` are accepted by the config but reserved; see [ADR-0002](docs/adr/0002-config-stores-key-references-per-backend.md)).

### Zero setup

Instead of (or alongside) a config file you can set `RIPPLE_CUSTODY_GATEWAY_URL`, `RIPPLE_CUSTODY_AUTH_TOKEN_URL`, `RIPPLE_CUSTODY_AUTH_CLIENT_ID` (optional), `RIPPLE_CUSTODY_DOMAIN_ID` (optional), `RIPPLE_CUSTODY_PRIMARY` and `RIPPLE_CUSTODY_AUTH_SIGNING_KEY`. They define a read-only Environment named `env`.

### Setting up an Environment (macOS)

```bash
npx @florent-uzio/simplexrpl-mcp add-env <name>
```

Prompts for the Custody details, Access level and Raw signing opt-in, then reads the private key from a file you name. It checks the credentials with `getMe`, stores the key in the macOS Keychain (service `simplexrpl-mcp`, account `<name>`) and saves the Environment with a `keychain:<name>` Key reference. Nothing is saved if the check fails. The key is stored as `b64:<base64>`; an entry without that prefix is read as plain text.

## Access levels

What an Environment permits through this server:

- `read`: read tools only (the default).
- `propose`: read, plus Propose (write tools such as `xrpTransfer`).
- `approve`: propose, plus Approve and Reject.

Write tools run a Dry run first and propose nothing if it fails. `xrpTransfer` only runs the Dry run unless you pass `dryRun: false`; then it returns the `intentId` at once. Approvers act later, so use `waitForIntent` to follow it.

> In 0.1.0 no tool needs `approve` yet (there are no Approve or Reject tools), and no tool uses Raw signing yet. Both settings are accepted and reserved for later releases.

## Raw signing

Raw signing has the Backend sign an opaque, already-built transaction, which its policies cannot inspect. It is for transaction types that are not Native operations on Custody.

It is **off by default** and is a per-Environment opt-in (`allowRawSigning`), chosen at `add-env` time and shown by `listEnvironments`. It is never a per-call option, so the model cannot enable it for itself. A write through Raw signing needs the `propose` Access level, and its result says the Backend's policies could not inspect it. See [ADR-0001](docs/adr/0001-raw-signing-is-a-per-environment-opt-in.md).

## Development

```bash
npm install
npm run format:check && npm run typecheck && npm test
npm run mcp      # run the server over stdio
npm run build    # bundle to dist/simplexrpl-mcp.js
```

Versioning uses [Changesets](https://github.com/changesets/changesets): run `npx changeset` with each user-facing change. Merging to `main` opens a "Version Packages" PR; merging that publishes to npm through trusted publishing.
