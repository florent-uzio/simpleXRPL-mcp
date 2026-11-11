---
'@florent-uzio/simplexrpl-mcp': minor
---

Batch entries now take the same input, in the same units, as the standalone tool for their operation.

- **Breaking:** a Batch `Payment` entry takes a decimal XRP amount, like `payment`, instead of drops, and must name its `currency` (`XRP`, `IOU`, `MPT` or `Ticker`) instead of passing an `issuanceId`. An entry in the old format is refused, not misread.
- A Batch `Payment` entry can now pay an IOU or a Custody ticker, and pay a Custody account or endpoint by its id.
- A Batch can now hold `MPTokenIssuanceCreate`, `MPTokenIssuanceSet` and `MPTokenIssuanceDestroy` entries, with the same input as their tools.
