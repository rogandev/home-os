# Home OS combined release candidate

This draft reconciles inventory copy (#12), configurable categories/locations (#13),
and supply forecasting (#14) on main `3d889808831fe219e3f6ec02320d351ac1ca9cbf`.
That main already contains the delivery follow-up actions from #11. All six original
frontend/backend draft branches remain intact. Do not merge duplicated implementations;
use this consolidated frontend with the consolidated API candidate #86 after review.

## Combined behavior

- Copy retains canonical category/location IDs when catalogs are enabled. New
  copies must choose active values, even if an unchanged source value is inactive.
  Physical allocations remain independent of the preferred room. Copy preserves
  editable product fields but never transfers orders, subscriptions, estimates or
  usage history. Lost-response retry retains the exact IDs, allocations and UUID.
- Catalog-enabled refresh also loads supply tracking, so forecasting and safe
  open/finish actions remain available with configurable categories and locations.
- Delivery dates, due-delivery actions, partial/final receipts and confirmed
  stock increases retain the shipped behavior. Scheduled subscriptions add no stock.
- Supply still uses an active unit plus one spare, a default seven-day warning,
  explicit replacement confirmation and advisory-only skip suggestions.

## Flags and dependency order

All new features remain off in `.env.example`; existing delivery configuration is
unchanged. `VITE_HOME_INVENTORY_COPY`, `VITE_HOME_CATALOGS` and
`VITE_HOME_SUPPLY_TRACKING` require the deployed, verified consolidated API contract.
`VITE_HOME_CATALOG_MANAGEMENT=false` disables catalog edits while retaining canonical
forms and filters when `VITE_HOME_CATALOGS=true`.

The parent owns release order: Flowboard restore gate, Dashboard, then Home OS.
No shared API merge/deploy may precede the parent's handoff. Reconcile newer main
changes and repeat checks before release. Production verification must be read-only.
Device/UI focus belongs to the separate device task; combined real-device visual
acceptance remains a gate. These component tests are not a browser screenshot pass.

## Verification

- All 107 frontend tests pass, including the delivered order/receipt regressions
  and the new combined fixture's copy/catalog/usage/receipt sequence.
- New all-flags UI regression covers canonical copy, stock allocation preservation,
  supply loading, inactive-reference rejection and safe lost-response retry.
- Default, all-enabled and catalog-management-disabled production builds pass with
  the already approved WASM runtime. No dependency versions or lockfile changed.
- API #86 runs the existing disposable PostgreSQL and real Care UI CI workflow plus
  the original Home suites and a new copy/catalog/supply/delivery integration test.
  Check its exact current head rather than relying on old draft checks.

The combined disposable fixture and device acceptance sequence are in
[`fixtures/integration/README.md`](../fixtures/integration/README.md). It renders the
real combined App with all flags enabled; all writes end in memory and reload resets
sample data. It requires no PostgreSQL executable or credentials. Its build and
model smoke test pass; combined browser screenshots and actual-device acceptance
remain outstanding. The original catalog/supply fixtures remain available too.

Backend verification provenance: GitHub Actions run `37812517778`, exact API head
`c1261fe8ce0bf3464e39d00e6b424c98782fbf76`, passed the protected
`startup-migrations-and-contract-smoke` job, including the real Care UI step. It
created a fresh PostgreSQL 16 service container on the hosted Ubuntu runner, started
the API with a synthetic CI token, applied all migrations and ran the full aggregate.
No blocked local `psql`/`pg_isready` tool or production database was used.

## Rollback and limits

Disable copy/supply flags to withdraw those features. After live custom catalog
values exist, keep the catalog-aware frontend/API and set management false; never
return to hard-coded pickers. Retain usage/history tables, never restore opened
stock automatically, and never repeat receipts. The API release plan requires a
verified restorable snapshot and quiesced old writers before catalog migration.

V1 limits remain: one active unit/one spare, day-level observed durations, manual
subscription schedule advancement, no history correction UI or push alerts, and
withheld delivery comparison for ambiguous unlinked incoming orders.
