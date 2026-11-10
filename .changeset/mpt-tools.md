---
'@florent-uzio/simplexrpl-mcp': minor
---

Add the `mptIssuanceCreate`, `mptAuthorize`, `mptIssuanceSet` and `mptIssuanceDestroy` write tools. Each runs a Dry run first and Proposes only with `dryRun: false`, accepts on-ledger memos, and `mptIssuanceCreate` takes XLS-89 token metadata and encodes it for you.
