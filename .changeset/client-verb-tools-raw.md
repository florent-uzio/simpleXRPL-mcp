---
'@florent-uzio/simplexrpl-mcp': minor
---

Add the remaining client verb tools: DEX offers (`clientXrpBuyOffer`, `clientXrpSellOffer`, `clientXrpCancelOffer`, `clientIouBuyOffer`, `clientIouSellOffer`, `clientIouCancelOffer`), credentials (`clientCredentialIssue`, `clientCredentialAccept`, `clientCredentialDelete`), permissioned domains (`clientDomainCreate`, `clientDomainSetCredentials`, `clientDomainDelete`) and `clientAccountSetRegularKey`, with the reads `clientAccountListOffers`, `clientIouListOffers`, `clientCredentialRetrieve`, `clientCredentialList`, `clientDomainRetrieve` and `clientDomainList`. Cancelling an offer, credentials, domains and `setRegularKey` go through Raw signing on Ripple Custody, so they need an Environment with `allowRawSigning`.
