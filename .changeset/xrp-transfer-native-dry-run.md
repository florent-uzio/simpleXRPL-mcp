---
'@florent-uzio/simplexrpl-mcp': patch
---

`xrpTransfer` now Dry-runs the same native Payment order it Proposes. A `from` address that no account in the Domain holds now fails the Dry run with "No account in the Domain holds …".
