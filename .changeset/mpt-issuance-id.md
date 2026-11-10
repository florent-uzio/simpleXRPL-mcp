---
'@florent-uzio/simplexrpl-mcp': minor
---

Add the `getMptIssuanceId` tool: it returns the MPT issuance ID an executed `mptIssuanceCreate` Intent created, so the new token can be used with `mptAuthorize`, `mptIssuanceSet`, `mptIssuanceDestroy` and the confidential MPT tools. It waits up to `timeoutSeconds` (default 30, `0` looks once) for Custody to record the ID, and reports a wait that runs out as an answer with a `reason`, not an error.
