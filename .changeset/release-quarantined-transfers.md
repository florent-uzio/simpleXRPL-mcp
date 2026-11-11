---
'@florent-uzio/simplexrpl-mcp': minor
---

Add `listQuarantinedTransfers` and `releaseQuarantinedTransfers`. Transfers an account received can sit in quarantine, where a Dry run counts them as unavailable; the release tool proposes a `v0_ReleaseQuarantinedTransfers` Intent for the named transfers, with a Dry run first and the `propose` Access level.
