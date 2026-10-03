# PR78 integration preparation — disabled in production

Authoritative contract/source: API commit
[`2322a7b5dc6bcb897385bb9c8ef88e16e0c855ab`](https://github.com/rogandev/flowboard-api/blob/2322a7b5dc6bcb897385bb9c8ef88e16e0c855ab/docs/home-os-catalogs.md).
Read `src/homeOsCatalogs.js` and catalog integration points in
`src/homeOsRoutes.js` at that exact commit. The contract supersedes the original
capability proposal. Backend PR78 is draft and **not deployed**.

## Prepared behavior

`catalog-adapter.js` maps injected JSON transport to list arrays and individual
mutation records. It sends a UUID requestId for every intent; PATCH includes source
version; DELETE includes replacementId and replacementVersion only when selected.
Unused deletion omits replacement fields rather than sending null (the server
rejects an explicitly null replacement). Opaque IDs are URL-encoded.

Uncertain network/5xx outcomes retain the exact method, URL suffix and serialized
body. No automatic retries occur. Resolve pending change explicitly resends the
original envelope. A successful replay is historical and followed by a full
catalog/items/containers/orders/stats/allocations reload. Definite 4xx failures
clear the pending envelope; the UI reloads after conflicts and requires a new
intent/UUID. Container-name collisions have an explicit message; no merge or stock
mutation is attempted.

The browser journal uses IndexedDB only for unresolved request envelopes. It is
not inventory persistence and never stores credentials. Production wiring must
scope it to the exact API origin and account context and must retain the same
scope after page reload. Atomic reservation prevents two tabs from overwriting a
pending request. Writes fail closed if recovery storage cannot commit. Fixtures
use an injected memory journal because the entire server fixture resets on reload;
adapter-recreation tests reuse the journal to verify recovery across a client restart.

Management hides inactive/tombstoned mutation targets and replacement choices.
Names still validate against returned tombstones. Historical aliases are not
returned by lists, so the server remains authoritative for reserved-name conflicts.
Client whitespace/case checks are advisory: JavaScript and PostgreSQL locale
normalization can differ. The server-returned spelling is displayed after reload.
Unicode length is checked by code points, not the HTML UTF-16 maxlength attribute.

Protected legacy locations can rename but expose no Delete button. Usage comes
from the server, showing item and container counts; inactive/zero-stock containers
count. New locations have a protected default container and start with usage one.
The mock retains tombstones and preserves stock allocations/container IDs/orders
while reparenting location containers. It cannot prove database atomicity.

`canonicalItemReferences` prepares only changed stable-ID assignment fields;
it never emits legacy category/location strings. Unchanged inactive references
are omitted on unrelated edits. Canonical location changes represent preferred
future destination, not movement of existing stock. Forms/cards/filters now have gated integration, enabled only by
VITE_HOME_CATALOGS=true after backend readiness; stock must still
be displayed through allocations rather than preferred location.

## Gates and remaining gaps

- `App.jsx` now includes gated catalog forms, stable-ID filters, preferred-room
  semantics and Settings. VITE_HOME_CATALOGS is false/unset in production until
  backend readiness. VITE_HOME_CATALOG_MANAGEMENT=false can hide mutations while
  preserving catalog-aware inventory. The adapter itself defaults disabled.
  Only disposable fixtures are enabled during preparation.
- No deployment, API credential, production write, backend or schema edit occurred.
- Backend reports its PostgreSQL16 required check passed; that does not establish
  a deployed contract. Separate approval, backend rollout and read-only verification
  are still required before actual production integration/activation.
- Real IndexedDB recovery passed in an isolated browser check: client recreation,
  competing reservation rejection, exact replay applied once, and journal cleanup.
  Durable journal browser storage must still be exercised with the final production
  account/origin scope during rollout QA; no real API calls are needed for that.
- The full multi-request reload is not a single transaction snapshot; backend
  explicitly provides no cross-request snapshot endpoint. Concurrent changes can
  yield a mixed read, and versions/usage must be revalidated server-side on writes.
- Inactive/tombstone selection handling, stable-ID filters and item editing are
  wired behind the disabled flag and covered by full-app DOM fixture tests.
- No full mock of historical alias reservation or database locale normalization
  is claimed. Backend contract tests own those rules; the UI handles 409 responses.

## Checks

Run `npm test`, default/delivery-on production builds, and the isolated fixture
build. Tests cover exact request bodies, UUID replay after lost response and client
recreation, historical replay versus current reload, no replay of definitive 409,
journal failure, omitted replacement fields, replacement version, tombstones,
protected rooms, container collision messaging, all-container usage, Unicode names,
canonical ID payloads and unchanged inactive references. Browser fixture remains
`http://127.0.0.1:4176/fixtures/catalog/`; reload after source changes (HMR is off).

Verification update: 59 automated tests pass; default/delivery-on production and
fixture builds pass. Hidden browser verified lost-response resolution, real IndexedDB
recovery, protected Kitchen with Rename only, inactive replacement exclusion,
container-collision409 blocking and reload recovery. Phone 390x844 and iPad-size
820x1180 layouts checked; iPad document/scrollWidth both 805 (scrollbar excluded).
No production API calls, device changes, merge or deployment.


## Gated app preparation and release checklist

The full app fixture is `fixtures/catalog/app.html`. Every fetch terminates in an
in-memory transport, with no network fallback. Tests verify flag-off legacy forms,
flag-on canonical create/edit payloads, unchanged stock on preferred-room edits,
rename retaining a selected category filter, replacement deletion resetting it,
and preventing inventory navigation while a catalog operation is unresolved.
The API origin plus fixed shared-account domain scopes the pending journal; a
future authentication/account migration must explicitly change/transfer that scope.

Preparation checks: 65 tests pass. Final integrated browser verification is still
pending: after restarting only port 4176, IAB reload returned a Browser Use URL
policy block for its data-URL ERR_CONNECTION_REFUSED page. No navigation bypass
was attempted. Host curl subsequently verified the actual fixture URL returns
HTTP200 and the node listener is healthy. Earlier isolated-manager responsive QA
remains valid but does not count as a pass for the new full-app integration.

Before release:
1. Receive backend-ready evidence: approved deployed commit, migration/snapshot/
   quiescence verification, healthy read-only catalog/item/stock checks.
2. Run final tests and both catalog flags in preview against disposable data;
   complete desktop/phone/iPad integrated browser QA. Verify pending journal
   recovery across reload and no production category/item writes during QA.
3. Check exact-commit required statuses and compare preview inventory reads without
   writes. Record currently deployed frontend artifact and flag values.
4. Publish only the approved frontend commit with VITE_HOME_CATALOGS=true and
   VITE_HOME_CATALOG_MANAGEMENT=true; verify live reads/rendering only.

Rollback: before any catalog mutation, the previous frontend artifact may be
restored if it remains compatible with the deployed backend. After custom values
or renames/replacements exist, do not roll back to hard-coded pickers. Instead
retain the catalog-aware build with VITE_HOME_CATALOGS=true and rebuild with
VITE_HOME_CATALOG_MANAGEMENT=false to disable management, or deploy a reviewed
forward fix. Never clear an unresolved journal merely to unblock the UI. Backend
rollback is owned by the API rollout plan; no schema/data rollback is performed
from this frontend task. No production flags, merge or deployment have occurred.
