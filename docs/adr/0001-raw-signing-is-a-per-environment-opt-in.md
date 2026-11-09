# Raw signing is a per-Environment opt-in

Raw signing is off by default and is switched on per Environment (`allowRawSigning`), set explicitly at `add-env` time and shown by `listEnvironments`. It is never a per-call option, so the model cannot enable it for itself. A write that goes through Raw signing needs the `propose` Access level, and its result says the Backend's policies could not inspect it. We need it because several simpleXRPL operations (Credential, Permissioned domain, `SetRegularKey`, `OfferCancel`, and later Batch) have no Native operation on Ripple Custody.

## Considered Options

- **Never enable Raw signing** — safest, but blocks the `credential` and `domain` verticals and Batch on Custody.
- **Per-call flag** — rejected: the model could turn off the Backend's inspection by itself.
- **Global server flag** — rejected: too coarse; a test Environment should not widen a production one.
