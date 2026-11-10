---
'@florent-uzio/simplexrpl-mcp': minor
---

Add the `sponsorshipSetAsSponsor` and `sponsorshipSetAsSponsee` write tools (XLS-68 SponsorshipSet). Each runs a Dry run first and Proposes only with `dryRun: false`. A `sponsorship` option on other tools is not included: the pinned `simplexrpl` does not carry it on a transaction order.
