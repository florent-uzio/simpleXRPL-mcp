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
