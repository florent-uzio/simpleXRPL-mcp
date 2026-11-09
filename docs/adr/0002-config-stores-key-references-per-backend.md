# Config stores Key references, with Backend-discriminated Environments

Environments live in `~/.config/simplexrpl-mcp/config.json`. Each one has a `backend` (`ripple-custody` now; `local`, `palisade`, `external` later) that selects its settings, and points at its private key through a Key reference (`keychain:`, `file:`, `env:`, `aws-sm:`, `aws-kms:`), never the key itself. This follows custody-mcp's ADR-0002, widened because simpleXRPL spans several Backends with different credentials. Keys are resolved lazily on an Environment's first use. The `local` Backend is restricted to test networks; mainnet requires Custody, Palisade or an external signer.

## Considered Options

- **One config shape per MCP server** (the custody-mcp model) — rejected: each new Backend would need a new server or a breaking config change.
- **Keys inline or only in env vars** — rejected: turns a shareable config into a secret.
