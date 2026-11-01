# Home OS MCP — activation pending

This standalone, stateless Streamable HTTP server exposes the existing Home OS
business operations through `/mcp`. The matched backend adapter lives in
`rogandev/flowboard-api/src/homeConnector.js`. No web UI changes are required.

## Contract

`src/operations.json` is the reviewed list of 39 tools and their input schemas.
Its byte-identical backend copy validates inputs before any database call.
Tools cover inventory lookup, create/copy, edits, quantity changes, containers,
allocation snapshots, canonical categories/locations, incoming orders and receipt
history, supply profiles/settings, subscription tracking, opening/finishing usage,
razor configuration/replacements/date corrections, and operation receipt lookup.

Permanent item deletion is deliberately unavailable. No recoverable item archive
exists in the API. `do_not_order` only changes replenishment policy; it is not an
archive substitute. Catalog retirement preserves tombstones and can explicitly
reassign references; order removal preserves audit history. Empty named containers
can be deactivated. No bulk import, automatic purchase, inventory merge, or guessed
allocation is introduced. Supply history remains the existing API's recent-six
completed-cycle projection, not a newly invented full-history endpoint.

Each read returns a coarse inventory-wide `revision`. A write requires that exact
revision and a UUID `operationId`; existing catalog/supply/razor version checks
remain required too. Read all relevant state, review changes, then write. An
unrelated Home edit may conservatively cause a 409. Refresh and reconcile on a
known conflict. After an uncertain response, reuse the same UUID and identical
arguments, or inspect `get_operation_receipt`. A replay returns the saved result,
not current inventory. Read again for current state. Never auto-retry writes.

The backend takes the existing shared catalog advisory lock, hashes complete Home
business tables, and runs the original REST handlers in nested savepoints. It
commits their result with an immutable request/response receipt in one transaction.
A failed receipt insertion rolls back the business change. All normal Home and
FORM razor writers use that same catalog lock. Direct database maintenance outside
this contract must not run concurrently with connector writes.

## Local verification

```
npm ci
npm test
npm run check
```

From the Home repository root, install both root and connector dependencies before
`npm test`; the root test discovery includes the connector tests. The CI workflow
also runs the existing application suite and production build. Synthetic tests use
in-memory MCP, generated ephemeral test signing keys, fake backend responses, and
localhost HTTP only. Never point tests at production.

## Activation plan — specific approval required

Code publication does not activate access. `HOME_MCP_ENABLED` is unset by default
and the host refuses to start without explicit activation. Do not reuse the app
bearer, browser session secret, FORM credentials or any Flowboard grant/token.

Before doing each of the following, obtain Timothy's specific approval naming the
actual target and values/permissions (never include secret values in chat):

1. Choose the dedicated Home MCP host/service and exact HTTPS resource ending in
   `/mcp`. Approve creating that service if needed; do not change the Home web host.
2. Register a dedicated resource/audience with the chosen identity provider and
   approve exactly `home:read` and `home:write` for the verified owner subject.
   Pin the exact issuer and same-origin JWKS URL. Do not expand a Flowboard audience
   or persistent grant. Approve any new OAuth client and its actual redirect URIs
   separately if the connecting client requires one.
3. Generate two independent random Home-only backend credentials (reader and
   writer). Approve storing them in this host and the shared API service, plus
   `HOME_MCP_OWNER_SUBJECT` and `HOME_MCP_ENABLED=true`. Neither credential grants
   access outside `/connector/home/execute`; the reader cannot invoke writes.
   The host also needs `HOME_MCP_API_ORIGIN`, `HOME_MCP_RESOURCE`, `HOME_MCP_ISSUER`,
   `HOME_MCP_JWKS`, and its platform `PORT`. No values have been configured here.
4. Approve connecting/registering the new Home MCP in ChatGPT and consenting to
   the exact Home scopes. Verify discovery and authenticated reads after connection.
   Do not perform a live write as a test; wait for a concrete user-requested Home
   action and retain its receipt.

Issuer validation requires RS256, matching audience/issuer/owner, exp/iat, and a
maximum 15-minute token age. Configure the dedicated issuer accordingly only after
approval. Every request is verified, including discovery. Reads require `home:read`;
write tool calls additionally require `home:write` and a configured writer token.
The backend fixes its principal from dedicated configuration, never a client header.
Metadata advertises only Home scopes. Backend redirects are forbidden; request and
response sizes and timeouts are bounded. Errors do not expose tokens or SQL.

## Release and rollback

Publish both changes as drafts. Require Home CI (app tests/build, MCP tests/check)
and the API `startup-migrations-and-contract-smoke` plus isolated Home MCP tests.
Reconcile both manifests and the latest API main before merge. Release API code
first with the new capability still disabled. Its additive receipt-table migration
never alters stock or existing history. Release connector code only to the approved
isolated service after the activation approvals above; keep writes off until the
read boundary is verified.

Rollback: disable the Home MCP host or its writer configuration first, then disable
`HOME_MCP_ENABLED` in the API. Preserve receipt tables and native histories; do not
undo inventory writes, drop tables, rotate unrelated credentials, or roll back old
Home catalog migrations. A known-good previous API release can run with the extra
receipt table present. Retrieve uncertain receipts before retrying any operation.

Current status: code and synthetic verification only; not connected or live-verified.
