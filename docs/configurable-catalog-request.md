# Home OS configurable categories and locations — capability request

Status: **historical proposal, superseded by API PR78 contract**. See
[catalog-integration.md](catalog-integration.md) for exact-commit integration preparation.
Backend remains undeployed; the original proposal below is retained as design history. No backend
or database change is included. The management component is fixture-only and is
not imported into the production application. No website release is appropriate
until the backend handoff and frontend integration pass verification.

## Requesting application and user need

- Application/repository: Home OS, `rogandev/home-os`.
- Task: [Trello 39](https://trello.com/c/6nccR2Dt).
- User decision: add/rename categories and locations in the app; every assigned
  item reflects a rename; deleting an in-use value requires a chosen replacement.
- Categories first. Subscription forecasting (card 92) is outside this scope.
- Need: support detailed bathroom categories, rooms/storage locations and future
  asset types without future code/schema edits for individual values.

## Confirmed current behavior

Inspected frontend main `3d889808831fe219e3f6ec02320d351ac1ca9cbf` and platform main
`89e31a2428df977892d82d810782ed4686fa8dd8` on 2026-10-03.

- Frontend `App.jsx` hard-codes four categories and three legacy item locations.
- `GET /home-os/locations` returns `{id,name,isActive}` broad storage locations.
  These differ from the legacy item strings. For example, Kiehl's Bag maps to a
  compatibility container within Bathroom; they cannot simply share one picker.
- No category catalog route or category mutations; locations are read-only.
- Item POST/PATCH still accepts string `category` and `location`. Database
  constraints restrict the values; location writes use the fixed
  `compatibilityContainerByLegacyLocation` map in `src/homeOsRoutes.js`.
- Stock allocations are authoritative. Containers belong to broad locations;
  compatibility containers are protected. Quantity, status, incoming orders and
  receipt history must remain intact.
- Shared bearer authentication and existing `/home-os` namespace remain unchanged.
- No offline/shared persistence fallback. Committed seed JSON is not live data.

Sources: platform `docs/home-os-operations.md`, `src/homeOsRoutes.js`,
`docs/application-developer-backend-workflow.md` and
`docs/backend-capability-request-template.md` (read directly from current main).

## Backend tasks requiring separate authorization

1. Define a persistent category catalog with immutable IDs, normalized unique
   names, and item references. Replace the four-value category constraint with
   catalog validation, preserving every current assignment on migration.
2. Define canonical location semantics across legacy item strings, broad storage
   locations and containers. Add configurable locations without requiring a
   hard-coded compatibility-container mapping for each new location.
3. Provide list/create/rename/delete-with-replacement operations. Renames and
   replacements must update all read projections consistently in one transaction.
   Do not implement as a browser loop of individual item PATCH requests.
4. Define concurrency and stale-write handling, normalized duplicate validation,
   usage counts and errors. Validate deletion's actual usage inside the transaction,
   even when the browser previously saw zero assignments.
5. Add safe, ledgered migration/backfill, compatibility tests, API documentation,
   required platform checks, approved deployment and read-only rollout evidence.

## Proposed contract (not an integration contract)

Keep existing routes additive and preserve old clients. Candidate endpoints:

| Method | Path | Proposed behavior |
| --- | --- | --- |
| GET | `/home-os/categories` | Catalog including stable IDs, name, usageCount, version |
| GET | `/home-os/locations` | Preserve current shape; add usageCount/version if approved |
| POST | `/home-os/categories` or `/home-os/locations` | Create `{name}`; server generates stable ID |
| PATCH | corresponding `/:id` | Rename `{name,version}` atomically |
| DELETE | corresponding `/:id` | `{replacementId,version}`; replacement mandatory when used |

Example record: `{ "id": "stable-id", "name": "Face Care", "usageCount": 2,
"version": 3 }`. Versions are opaque to the UI; final representation is platform-owned.
List/mutation response envelopes, DELETE body vs action route, version transport,
idempotency keys, active/deleted semantics and maximum name length require final
platform decisions. Fixture commands deliberately use an injected adapter rather
than assuming an HTTP shape. Proposed name limit is 100 trimmed characters and
case-insensitive uniqueness; the backend must define canonical normalization.

Errors should distinguish invalid names/replacements (400/422), normalized
name collision and stale version/in-use conflict (409), missing ID (404), auth
(401/403), and failures with uncertain commit outcome (network/5xx). Return stable
error codes. UI reloads after conflicts/uncertain outcomes rather than retrying.

Item writes should support immutable `categoryId` and a platform-defined location
reference while keeping existing string fields readable and legacy writes safe.
All filters, forms and cards must resolve names from the same catalog. Renames
must preserve IDs so selection/filter state follows the new name. A replaced or
deleted filter should explicitly reset or follow the replacement after reload.

## Data, compatibility and migration requirements

- Seed catalog records from authoritative existing DB values, never replace live
  data from repository JSON. Verify before/after item counts and assignments.
- Preserve quantities, stock allocations, container IDs, order/receipt/event
  history, status and replenishment policy. No item duplication or implicit stock
  movement during category rename/replacement.
- Location rename must update all displayed container/allocation location names.
  Location replacement must preserve each container and its allocations while
  reparenting or otherwise mapping locations according to the approved contract.
- Resolve duplicate container names at the replacement destination explicitly;
  never overwrite, discard, merge stock or guess a destination container.
- Define handling of protected compatibility containers and old three-string
  clients. Every old value must remain readable and safely writable or return a
  documented error; never silently redirect inventory to another room.
- Define usageCount for locations: item references plus container references,
  including zero-stock containers that still prevent deletion. The UI must not
  infer location usage from visible item counts.
- Preserve history for removed values (e.g. tombstones), exclude them from new
  assignment choices, and define treatment of existing inactive locations.
- Migration must be repeat-safe and transactional with a rollback/forward-fix plan.
  Platform owns schema, authentication, authorization and business rules.

## Frontend plan and verification

`src/CatalogManager.jsx` is an isolated presentation component with injected
`load/mutate` functions. `fixtures/catalog` supplies disposable memory-only data,
assigned-item previews, failure modes and delay controls. Production `src/main.jsx`
and `App.jsx` are unchanged; the default build cannot expose management controls
or make proposed requests. Fixtures never call a production API or localStorage.

After the approved backend deploys: implement the final adapter, fetch catalogs,
replace category/location constants in item forms/filters with canonical choices,
handle unknown/inactive values explicitly, integrate management into Settings,
and reload catalogs/items/containers/allocations together after each mutation.
Keep integration behind a rollout gate until verified with disposable fixtures
and the deployed read contract. Do not enable a frontend that requires missing
endpoints.

Required platform tests: add/rename/reassign with multiple items; blank/trimmed/
case-duplicate/long names; missing/same/deleted/inactive replacements; concurrent
renames/deletes/new assignments; transaction rollback; idempotent request handling;
stock/order/history invariance; zero-stock containers; location name collisions;
legacy client compatibility; migration replay; auth and required smoke checks.

Required frontend tests: category and location flows, stable-ID form/filter
consistency, cancellation/Escape with zero writes, no replacement preselection,
blank/duplicate validation, repeated submission, 400 correction, 409 reload,
network/lost response and saved-but-refresh-failed recovery. Verify desktop,
phone and iPad viewport layout and keyboard interaction; physical devices are
outside this task. Test only fixtures, never production category/item writes.

## Platform handoff required before integration/release

Final methods/routes/auth; example request/response and errors; location/legacy
compatibility decision; migration/backfill evidence; focused backend PR approved
by Timothy; required checks; Railway deployed commit and read-only verification;
frontend rollout instructions. No backend implementation is authorized by this
proposal itself.
