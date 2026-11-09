## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (florent-uzio/simpleXRPL-mcp) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Conventions

- Single npm package, MCP server only (stdio), bundled with esbuild into one bin. No Mastra agent or Studio.
- Tools live in `src/tools/<domain>/`; Mastra provides `createTool` and `MCPServer`; schemas are Zod 4.
- `simplexrpl` is pinned to an exact version (no `^`) and used only through a thin adapter module, because it is pre-1.0.
- Every user-facing change comes with a changeset (`npx changeset`). Bumping the `simplexrpl` pin is a changeset naming the upstream version.
- Write tools run a Dry run first, return the `intentId` at once, and need the `propose` Access level. Raw signing is a per-Environment opt-in (ADR-0001). Never store private keys in config (ADR-0002).
- Checks before a PR: `npm run format:check && npm run typecheck && npm test`.
