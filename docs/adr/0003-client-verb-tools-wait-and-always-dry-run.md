# Client verb tools wait for the outcome and always Dry-run first

The `client*` tools call simpleXRPL's Client verbs exactly as a customer's code would (`SimpleXRPL.init({ xrpldUrl, signers: [custody] })`), so we can check how each verb routes through Ripple Custody and show customers how to move from custody.js to simpleXRPL. Two of this server's write rules cannot hold for them, and we accept that:

- **They wait for the outcome** instead of returning the `intentId` at once: a Client verb resolves only when its Intent ends. The wait is simpleXRPL's default (60 s); an Intent still awaiting approval then comes back as `pending: true` with its `intentId`, to follow with `waitForIntent`, not as an error.
- **They always Dry-run, then submit.** A Client verb's `dryRun: true` checks before submitting and cannot stop there, so these tools have no Dry-run-only mode. For a fee estimate without proposing, use the Native operation tools.

Everything else is unchanged: the `propose` Access level, a named `environment`, and Raw signing only when the Environment allows it (ADR-0001). The Environment needs an `xrpldUrl`, with no default, because Custody may submit Native operations to a different ledger than one we would guess. The Native operation tools stay, so either path can be named.

## Considered Options

- **`submitTransactionAsync` with raw transaction JSON** — returns at once, but does not exercise the Client verbs, which is the point.
- **One generic `clientCall` tool** — covers every verb at once, but without typed inputs the model guesses arguments.
- **A per-Environment switch between the two paths** — hides which path a call took, and you could not compare both on one Environment.
