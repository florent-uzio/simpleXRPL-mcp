# simpleXRPL MCP

An MCP server that lets a person read from and act on the XRP Ledger, through the signing backends simpleXRPL supports, from an AI client.

## Language

**Environment**:
A named signing setup: one Backend together with the credentials and settings needed to reach it.
_Avoid_: Profile, instance, config

**Backend**:
The kind of system that holds keys and signs for an Environment: Ripple Custody, Palisade, an external signer (KMS/HSM) or a local wallet.
_Avoid_: Custodian, connector, provider

**Key reference**:
A pointer to where an Environment's private key is stored (Keychain entry, file, environment variable, secrets manager, KMS key), never the key itself.
_Avoid_: Secret, key path

**Access level**:
What an Environment permits through this server: `read`, `propose` (read + Propose), or `approve` (propose + Approve/Reject).
_Avoid_: Permission, role, mode

**Domain**:
A Ripple Custody partition that owns accounts, users and policies. An Environment may name a default Domain; without one, a user who belongs to a single Domain gets that one.
_Avoid_: Tenant, workspace

**Account**:
A Custody account within a Domain, holding one or more addresses. Listed page by page with a cursor.
_Avoid_: Wallet

**Intent**:
A signed proposal to change state in Ripple Custody, which takes effect only once the domain's policies are satisfied by approvals.
_Avoid_: Transaction, order, request

**Propose**:
Submit a new Intent to a Backend on behalf of the Environment's user.
_Avoid_: Submit, send, create

**Approve** / **Reject**:
The Environment's user casting their decision on a pending Intent.
_Avoid_: Sign, accept, decline

**Native operation**:
An XRPL transaction type the Backend models as a structured operation, so its own policies and approvals can inspect what they approve.
_Avoid_: Typed operation

**Raw signing**:
Having a Backend sign an opaque, already-built transaction, which its policies cannot inspect. Used for transaction types that are not Native operations on that Backend.
_Avoid_: Unsafe mode, passthrough

**Dry run**:
A Backend's evaluation of an Intent without proposing it, used to catch errors before a Propose.
_Avoid_: Simulation, validation, preview

**Client verb**:
A business-intent method of the simpleXRPL client (`client.xrp.transfer`, `client.token.issue`, ...), which builds the transaction and picks the signing path itself: a Native operation where the Backend has one, Raw signing otherwise. The `client*` tools call them; the other write tools send a Native operation order directly.
_Avoid_: SDK call, client method
