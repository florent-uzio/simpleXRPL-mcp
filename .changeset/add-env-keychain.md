---
'@florent-uzio/simplexrpl-mcp': minor
---

Add the `add-env <name>` setup command: it prompts for the Custody details and Access level, verifies them with `getMe`, stores the private key in the macOS Keychain and saves the Environment with a `keychain:` Key reference.
