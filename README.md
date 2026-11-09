# simpleXRPL MCP

An MCP server that lets you read from and act on Ripple Custody (and later the XRP Ledger) from an AI client, through [simpleXRPL](https://github.com/ripple/simpleXRPL).

> **Status:** pre-release scaffold. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for the decisions.

## Development

```bash
npm install
npm run typecheck && npm test
npm run mcp      # run the server over stdio
npm run build    # bundle to dist/simplexrpl-mcp.js
```

Versioning uses [Changesets](https://github.com/changesets/changesets): run `npx changeset` with each change.

## Setting up an Environment (macOS)

```bash
npx @florent-uzio/simplexrpl-mcp add-env <name>
```

Prompts for the Custody details, Access level and Raw signing opt-in, then reads the private key from a file you name. It checks the credentials with `getMe`, stores the key in the macOS Keychain (service `simplexrpl-mcp`, account `<name>`) and saves the Environment with a `keychain:<name>` Key reference. Nothing is saved if the check fails. The key is stored as `b64:<base64>`; an entry without that prefix is read as plain text.
