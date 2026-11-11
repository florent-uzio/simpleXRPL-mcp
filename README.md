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
   claude mcp add --scope user simplexrpl -- npx -y @florent-uzio/simplexrpl-mcp@latest
   ```

   `--scope user` makes the server available in all your projects. Without it, Claude Code registers it for the current project only (`local` scope).

   or in a JSON client config:

   ```json
   {
     "mcpServers": {
       "simplexrpl": { "command": "npx", "args": ["-y", "@florent-uzio/simplexrpl-mcp@latest"] }
     }
   }
   ```

## Tools

| Tool                         | Access level | What it does                                                                                                                                                               |
| ---------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getMcpVersion`              | none         | Reports the server version.                                                                                                                                                |
| `listEnvironments`           | none         | Lists the Environments with their Access level and Raw signing setting.                                                                                                    |
| `getMe`                      | `read`       | Returns the Environment's own Custody user.                                                                                                                                |
| `listAccounts`               | `read`       | Browses a Domain's accounts and their XRPL addresses, one page at a time with a cursor.                                                                                    |
| `waitForIntent`              | `read`       | Follows an Intent until it is executed, rejected, expired or failed. "Awaiting approval" is not an error.                                                                  |
| `getMptIssuanceId`           | `read`       | Returns the MPT issuance ID an executed `mptIssuanceCreate` Intent created, waiting up to `timeoutSeconds` (default 30) for Custody to record it.                          |
| `payment`                    | `propose`    | Sends XRP, an IOU, an MPT or a Custody ticker, to an r-address or a Custody account or endpoint. Same Dry run / `dryRun: false` flow, with optional tags, fee and `memos`. |
| `xrpTransfer`                | `propose`    | Dry run (default, returns the fee estimate); with `dryRun: false` it then Proposes and returns the `intentId` at once.                                                     |
| `mptIssuanceCreate`          | `propose`    | Creates an MPT issuance, with XLS-89 `metadata` encoded for you. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                                     |
| `mptAuthorize`               | `propose`    | Authorizes (or, with `tfMPTUnauthorize`, deauthorizes) a holder for an MPT. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                          |
| `mptIssuanceSet`             | `propose`    | Locks or unlocks an MPT, or enables confidential balances. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                                           |
| `mptIssuanceDestroy`         | `propose`    | Destroys an MPT issuance. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                                                                            |
| `confidentialMptConvert`     | `propose`    | Converts public MPT into the confidential balance; a holder's first convert must be zero-amount. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.     |
| `confidentialMptConvertBack` | `propose`    | Converts confidential MPT back into the public balance. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                                              |
| `confidentialMptMergeInbox`  | `propose`    | Merges the confidential inbox into the confidential balance. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                                         |
| `sponsorshipSetAsSponsor`    | `propose`    | Sets up or changes an XLS-68 Sponsorship from the sponsor's side. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                                    |
| `sponsorshipSetAsSponsee`    | `propose`    | Sets the sponsor from the sponsee's side. Same Dry run / `dryRun: false` flow, with optional on-ledger `memos`.                                                            |
| `dryRunBatch`                | `read`       | Dry run of a Batch (XLS-56): the fee estimate and `signers`, one per account that must sign. Does not propose. Entries take their tools' input.                            |
| `proposeBatch`               | `propose`    | Proposes a Batch with the `batchSigners` you supply. Same Dry run / `dryRun: false` flow. This server does not sign for the signers yet.                                   |

Write tools must name their `environment`; they never use the default.

### Client verb tools

The `client*` tools call simpleXRPL's Client verbs, the way a customer's code would after `SimpleXRPL.init({ xrpldUrl, signers: [custody] })`, with the Environment's Ripple Custody session as signer. Use them to check how each verb routes through Custody; the tools above send a Native operation order through `custody.api` instead. They need the Environment's `xrpldUrl`.

| Tool                                                                                                                            | Access level | Client verb                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `clientXrpTransfer`                                                                                                             | `propose`    | `client.xrp.transfer`                                                              |
| `clientIouIssue`, `clientIouAuthorize`, `clientIouTransfer`, `clientIouClawback`                                                | `propose`    | `client.iou.issue`, `.authorize`, `.transfer`, `.clawback`                         |
| `clientTokenIssue`, `clientTokenAuthorize`, `clientTokenTransfer`, `clientTokenLock`, `clientTokenUnlock`, `clientTokenDestroy` | `propose`    | `client.token.issue`, `.authorize`, `.transfer`, `.lock`, `.unlock`, `.destroy`    |
| `clientAccountSet`, `clientAccountDepositPreauth`                                                                               | `propose`    | `client.account.set`, `.depositPreauth`                                            |
| `clientTokenRetrieve`, `clientTokenList`, `clientIouRetrieve`, `clientAccountRetrieve`                                          | `read`       | `client.token.retrieve`, `.list`, `client.iou.retrieve`, `client.account.retrieve` |

A client write always runs Custody's Dry run and then submits (there is no Dry-run-only mode), and waits for the outcome. Its result names the `verb`, the `route` (`native-operation` or `raw-signing`), `intentId`, `txHash` and `idempotencyKey`; pass the `idempotencyKey` back to retry without a duplicate. An Intent still awaiting approval when the wait ends comes back as `pending: true`: follow it with `waitForIntent`. `from` defaults to the Environment's `primary`. See [ADR-0003](docs/adr/0003-client-verb-tools-wait-and-always-dry-run.md).

## Environments

An **Environment** is a named signing setup: one Backend (today only Ripple Custody) with its credentials and settings. Environments live in `~/.config/simplexrpl-mcp/config.json` (override the path with `SIMPLEXRPL_MCP_CONFIG`). The file is read on every use, so edits apply without a restart, and one invalid entry never hides the others.

```json
{
  "defaultEnvironment": "prod",
  "environments": {
    "prod": {
      "backend": "ripple-custody",
      "rippleCustodyApiUrl": "https://custody.example.com",
      "rippleCustodyTokenUrl": "https://custody.example.com/token",
      "domainId": "optional-domain-id",
      "primary": "rPrimaryAddress",
      "keyRef": "keychain:prod",
      "access": "propose",
      "allowRawSigning": false,
      "xrpldUrl": "wss://s.altnet.rippletest.net:51233"
    }
  }
}
```

The config never holds a private key, only a **Key reference** (`keychain:<service>/<account>`, `file:<path>` or `env:<VAR>` are resolved today; a bare `keychain:<account>` means service `simplexrpl-mcp`; `aws-sm:` and `aws-kms:` are accepted by the config but reserved; see [ADR-0002](docs/adr/0002-config-stores-key-references-per-backend.md)).

### Zero setup

Instead of (or alongside) a config file you can set `RIPPLE_CUSTODY_API_URL`, `RIPPLE_CUSTODY_TOKEN_URL`, `RIPPLE_CUSTODY_DOMAIN_ID` (optional), `RIPPLE_CUSTODY_PRIMARY` and `RIPPLE_CUSTODY_AUTH_SIGNING_KEY`. They define a read-only Environment named `env`.

### Setting up an Environment

```bash
npx @florent-uzio/simplexrpl-mcp add-env <name> [options]
```

Anything not given as an option is asked for. It checks the credentials with `getMe` and saves the Environment only if they work.

| Option                            | What it does                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--api-url`, `--token-url`        | The Ripple Custody API and token URLs.                                                                            |
| `--primary <r-address>`           | An XRPL address in your Custody domain. `simplexrpl` needs one to connect; it is not a default source for writes. |
| `--domain <id>`                   | The default Domain. Optional: without it, the Domains from `getMe` are listed and you may pick one or skip.       |
| `--access read\|propose\|approve` | The Access level (default `read`).                                                                                |
| `--allow-raw-signing`             | Allow Raw signing. Only asked about above `read`; `--no-allow-raw-signing` refuses.                               |
| `--xrpld-url <wss-url>`           | XRPL node WebSocket URL for the client verb tools. Asked for; Enter for none.                                     |
| `--force`                         | Replace an existing Environment without asking.                                                                   |

The private key comes from one source:

| Option                                | What it does                                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (default)                             | Generates a key pair (`--algorithm ed25519\|secp256k1\|secp256r1`, default `ed25519`). It prints the public key to register for your Custody user, then waits.                         |
| `--import <pem-file>`                 | Uses the key in a PEM file.                                                                                                                                                            |
| `--keychain-item <service>/<account>` | Uses a key already in the macOS Keychain. Nothing is copied.                                                                                                                           |
| `--env-var <NAME>`                    | Uses a key already exported in an environment variable (it must also be set where the MCP server runs). `--store env` does the same.                                                   |
| `--store keychain\|file`              | Where a generated or imported key is kept: the macOS Keychain (service `simplexrpl-mcp`, account `<name>`; the default) or `keys/<name>.pem` next to the config, readable only by you. |

A generated key is kept before its public key is shown, so it is not lost if the check fails: the error says how to retry with it (`--keychain-item` or `--import`). A key you import is stored only after the check succeeds. The Keychain stores need macOS; on other systems use `--store file` or `--env-var`. The Keychain stores the key as `b64:<base64>`; an entry without that prefix, or a PEM another tool stored as hex, is read as is.

> `simplexrpl` requires a `primary` address that already exists in the Custody domain, so a brand-new instance needs one XRPL account created first (in the Custody UI) before `add-env` can verify anything.

`xrpldUrl` is optional: the WebSocket URL of the XRPL node the [client verb tools](#client-verb-tools) connect to. Set it with `add-env --xrpld-url`, or edit the config file.

## Access levels

What an Environment permits through this server:

- `read`: read tools only (the default).
- `propose`: read, plus Propose (write tools such as `xrpTransfer` and the `mpt*` tools).
- `approve`: propose, plus Approve and Reject.

Write tools run a Dry run first and propose nothing if it fails. `xrpTransfer` only runs the Dry run unless you pass `dryRun: false`; then it returns the `intentId` at once. Approvers act later, so use `waitForIntent` to follow it.

> In 0.1.0 no tool needs `approve` yet (there are no Approve or Reject tools), and no tool uses Raw signing yet. Both settings are accepted and reserved for later releases.

## Raw signing

Raw signing has the Backend sign an opaque, already-built transaction, which its policies cannot inspect. It is for transaction types that are not Native operations on Custody.

It is **off by default** and is a per-Environment opt-in (`allowRawSigning`), chosen at `add-env` time (`--allow-raw-signing`) and shown by `listEnvironments`. It is never a per-call option, so the model cannot enable it for itself. A write through Raw signing needs the `propose` Access level, and its result says the Backend's policies could not inspect it. See [ADR-0001](docs/adr/0001-raw-signing-is-a-per-environment-opt-in.md).

## Live smoke test

Checks the real stack (config, Keychain, `simplexrpl`, Custody) against a real Environment:

```bash
npm run smoke -- --env <name> --from <rSource> --to <rAddress> [--amount 1]            # getMe, listAccounts, Dry run
npm run smoke -- --env <name> --from <rSource> --to <rAddress> --amount 1 --propose    # also a real Propose + waitForIntent
```

A real Propose only happens with `--propose` and needs an Environment with the `propose` Access level. It prints one PASS/FAIL/SKIP line per step and exits non-zero on any failure; an Intent still awaiting approval counts as a pass.

## Development

```bash
npm install
npm run format:check && npm run typecheck && npm test
npm run mcp      # run the server over stdio
npm run build    # bundle to dist/simplexrpl-mcp.js
```

Registering the server while working in this repo? `npx @florent-uzio/simplexrpl-mcp` resolves to the local project (same package name) and fails with `command not found`, so the client reports `CONNECTION_CLOSED`. Register it with `@latest` instead (`claude mcp add simplexrpl -- npx -y @florent-uzio/simplexrpl-mcp@latest`), or run the local build with `node dist/simplexrpl-mcp.js`.

Versioning uses [Changesets](https://github.com/changesets/changesets): run `npx changeset` with each user-facing change. Merging to `main` opens a "Version Packages" PR; merging that publishes to npm through trusted publishing.
