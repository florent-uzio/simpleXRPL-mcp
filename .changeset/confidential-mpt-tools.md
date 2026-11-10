---
'@florent-uzio/simplexrpl-mcp': minor
---

Add the `confidentialMptConvert`, `confidentialMptConvertBack` and `confidentialMptMergeInbox` write tools. Each runs a Dry run first and Proposes only with `dryRun: false`. `ConfidentialMPTSend` and `ConfidentialMPTClawback` are not included: they need cryptographic proofs the tools do not yet compute.
