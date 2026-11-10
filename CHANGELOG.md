# @florent-uzio/simplexrpl-mcp

## 0.4.0

### Minor Changes

- c92fde9: Add the `getMptIssuanceId` tool: it returns the MPT issuance ID an executed `mptIssuanceCreate` Intent created, so the new token can be used with `mptAuthorize`, `mptIssuanceSet`, `mptIssuanceDestroy` and the confidential MPT tools. It waits up to `timeoutSeconds` (default 30, `0` looks once) for Custody to record the ID, and reports a wait that runs out as an answer with a `reason`, not an error.
- aebee16: Add a `payment` tool that sends XRP, an IOU, an MPT or a Custody ticker, to an r-address or a Custody account or endpoint, with an optional destination tag, source tag, fee strategy, maximum fee, `tfSponsorCreatedAccount` flag and memos. It runs a Dry run first and Proposes only with `dryRun: false`. An IOU amount is a decimal, scaled by 10^81 for Custody. `xrpTransfer` is unchanged.

## 0.3.0

### Minor Changes

- be69e40: Add the `dryRunBatch` and `proposeBatch` tools for XLS-56 Batches. `dryRunBatch` returns the fee estimate and the accounts that must sign. `proposeBatch` takes their `batchSigners`: this server cannot sign for them yet, since the pinned `simplexrpl` has no Batch signing. Inner transactions: `Payment` (XRP or MPT), `MPTokenAuthorize` and `TicketCreate`.
- aa1b081: Add the `confidentialMptConvert`, `confidentialMptConvertBack` and `confidentialMptMergeInbox` write tools. Each runs a Dry run first and Proposes only with `dryRun: false`. `ConfidentialMPTSend` and `ConfidentialMPTClawback` are not included: they need cryptographic proofs the tools do not yet compute.
- 6f05970: Add the `mptIssuanceCreate`, `mptAuthorize`, `mptIssuanceSet` and `mptIssuanceDestroy` write tools. Each runs a Dry run first and Proposes only with `dryRun: false`, accepts on-ledger memos, and `mptIssuanceCreate` takes XLS-89 token metadata and encodes it for you.
- 4a90a2c: Add the `sponsorshipSetAsSponsor` and `sponsorshipSetAsSponsee` write tools (XLS-68 SponsorshipSet). Each runs a Dry run first and Proposes only with `dryRun: false`. A `sponsorship` option on other tools is not included: the pinned `simplexrpl` does not carry it on a transaction order.

### Patch Changes

- 4a90a2c: Fix the `mpt*` tools sending the sending `account`, `ledgerId` and `memos` inside the native operation as well as at the order level.

## 0.2.0

### Minor Changes

- 6bf50bc: Rework `add-env`: it can generate a Ripple Custody key pair (ed25519, secp256k1 or secp256r1; it prints the public key to register), import a PEM file, or reuse a key already in the macOS Keychain (`--keychain-item <service>/<account>`) or an environment variable (`--env-var`). A new key is kept in the Keychain or in a `0600` file (`--store keychain|file`). Every prompt now has a flag (`--api-url`, `--token-url`, `--primary`, `--domain`, `--access`, `--allow-raw-signing`, `--force`), the default Domain is picked from the ones `getMe` returns, and Raw signing is only asked about above the `read` Access level.
  
  Breaking, config and tools: `gatewayUrl` and `tokenUrl` are now `rippleCustodyApiUrl` and `rippleCustodyTokenUrl`, `clientId` is gone (Custody always uses `customer_api`), and `RIPPLE_CUSTODY_GATEWAY_URL` / `RIPPLE_CUSTODY_AUTH_TOKEN_URL` are now `RIPPLE_CUSTODY_API_URL` / `RIPPLE_CUSTODY_TOKEN_URL` (`RIPPLE_CUSTODY_AUTH_CLIENT_ID` is gone). `primary` is no longer a default source: `xrpTransfer` now requires `from` (and the smoke script `--from`). Key references take the form `keychain:<service>/<account>`; a bare `keychain:<account>` still means service `simplexrpl-mcp`.

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
