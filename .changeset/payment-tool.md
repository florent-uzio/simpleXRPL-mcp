---
'@florent-uzio/simplexrpl-mcp': minor
---

Add a `payment` tool that sends XRP, an IOU, an MPT or a Custody ticker, to an r-address or a Custody account or endpoint, with an optional destination tag, source tag, fee strategy, maximum fee, `tfSponsorCreatedAccount` flag and memos. It runs a Dry run first and Proposes only with `dryRun: false`. An IOU amount is a decimal, scaled by 10^81 for Custody. `xrpTransfer` is unchanged.
