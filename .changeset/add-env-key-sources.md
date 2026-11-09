---
'@florent-uzio/simplexrpl-mcp': minor
---

Rework `add-env`: it can generate a Ripple Custody key pair (ed25519, secp256k1 or secp256r1; it prints the public key to register), import a PEM file, or reuse a key already in the macOS Keychain (`--keychain-item <service>/<account>`) or an environment variable (`--env-var`). A new key is kept in the Keychain or in a `0600` file (`--store keychain|file`). Every prompt now has a flag (`--api-url`, `--token-url`, `--primary`, `--domain`, `--access`, `--allow-raw-signing`, `--force`), the default Domain is picked from the ones `getMe` returns, and Raw signing is only asked about above the `read` Access level.

Breaking, config and tools: `gatewayUrl` and `tokenUrl` are now `rippleCustodyApiUrl` and `rippleCustodyTokenUrl`, `clientId` is gone (Custody always uses `customer_api`), and `RIPPLE_CUSTODY_GATEWAY_URL` / `RIPPLE_CUSTODY_AUTH_TOKEN_URL` are now `RIPPLE_CUSTODY_API_URL` / `RIPPLE_CUSTODY_TOKEN_URL` (`RIPPLE_CUSTODY_AUTH_CLIENT_ID` is gone). `primary` is no longer a default source: `xrpTransfer` now requires `from` (and the smoke script `--from`). Key references take the form `keychain:<service>/<account>`; a bare `keychain:<account>` still means service `simplexrpl-mcp`.
