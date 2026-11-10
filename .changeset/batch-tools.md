---
'@florent-uzio/simplexrpl-mcp': minor
---

Add the `dryRunBatch` and `proposeBatch` tools for XLS-56 Batches. `dryRunBatch` returns the fee estimate and the accounts that must sign. `proposeBatch` takes their `batchSigners`: this server cannot sign for them yet, since the pinned `simplexrpl` has no Batch signing. Inner transactions: `Payment` (XRP or MPT), `MPTokenAuthorize` and `TicketCreate`.
