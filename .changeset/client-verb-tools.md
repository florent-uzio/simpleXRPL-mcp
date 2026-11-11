---
'@florent-uzio/simplexrpl-mcp': minor
---

Add client verb tools (`clientXrpTransfer`, `clientIouIssue`, `clientIouAuthorize`, `clientIouTransfer`, `clientIouClawback`, `clientTokenIssue`, `clientTokenAuthorize`, `clientTokenTransfer`, `clientTokenLock`, `clientTokenUnlock`, `clientTokenDestroy`, `clientAccountSet`, `clientAccountDepositPreauth`, and the reads `clientTokenRetrieve`, `clientTokenList`, `clientIouRetrieve`, `clientAccountRetrieve`). They call simpleXRPL's client verbs with the Environment's Ripple Custody session as signer, and report the route each write took (`native-operation` or `raw-signing`). They need the new optional Environment setting `xrpldUrl` (`add-env --xrpld-url`), shown by `listEnvironments`. Client writes always Dry-run before submitting and wait for the outcome; an Intent still awaiting approval comes back as `pending` (ADR-0003).
