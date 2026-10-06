# Subscription and supply forecasting (V1 draft)

Product: https://trello.com/c/PAxSUbF1. Backend dependency: https://github.com/rogandev/flowboard-api/issues/75 and its draft supply contract in `docs/home-os-supply.md`. The Oct 5 active-unit-plus-one-spare rule supersedes the old two-delivery-cycle threshold.

## Release gate

`VITE_HOME_SUPPLY_TRACKING` defaults off. Off makes no new supply API calls and preserves existing Use 1/order/receipt behavior. Do not enable on production until the backend is approved, deployed and verified. `VITE_HOME_DELIVERY_TRACKING` stays independent; receipt confirmation behavior is unchanged.

Both changes are reviewable drafts. Existing Home #13/API #78 category/location drafts and Home #12/API #77 copy drafts remain separate and unmerged; this work is based on main. Reconcile their overlapping App/routes/index/OpenAPI edits before a coordinated release. Do not rewrite those PRs or merge this feature to bypass their holds.

## User flow

- Supply settings sets a global warning lead time, initially 7 days. Plan supply on an item stores the estimated days per container and an optional per-item warning (blank inherits, zero is valid).
- The same editor stores quantity/cadence/next date/retailer/notes and active/paused/cancelled subscription tracking. Save, pause, resume and cancel persist through the API. Activating uses Auto-replenish. Pause or cancel before Do Not Order; this only changes Home OS tracking.
- Tracked items show stored spares, active usage, actual incoming, physical run-out, warning date, and estimated supply before/after the next delivery. Scheduled units never become incoming by themselves. The legacy effective-stock calculation remains stored stock plus actual incoming.
- Opened a new one chooses an explicit storage allocation. With an active record, “No” cancels; only “Yes, replace and open” closes it and opens the spare atomically. Finished one closes usage without deducting stock again. The old Use 1 button is replaced on tracked items; general stock adjustments remain available.
- Link an actual open order to its subscription delivery. Forecasts then use its remaining quantity and expected date once. Partial receipts are reflected; closed linked orders require updating the next schedule. Receipt never happens automatically.

The batch reloads on focus/visibility changes and after successful edits; local calendar day updates at midnight. Settings edits carry the version from when the draft opened, rejecting stale changes instead of overwriting another device. Usage mutations retain one request UUID through failed-response retries and compare the expected current usage record.

## Forecast rules and limits

An explicit duration estimate seeds the rate. One or two completed durations refine it with the estimate weighted as one sample; three or more switch to the median of up to six recent valid completed cycles. Same-day completions are retained but excluded from daily rates. Without enough history or an estimate, show a request for an estimate, never an invented rate.

The model assumes one container consumed at a time, continuous use, and identical unit sizes. Remaining active duration is clamped at zero; running past an estimate never automatically closes the record. Stored supply run-out excludes unreceived deliveries. A separate date can include a dated actual order only if it is projected to arrive before stockout. Unknown/overdue orders are never treated as already available.

Immediately before the next delivery, remaining coverage strictly below the configured buffer warns, including projected stockout before arrival. Exactly the buffer does not warn. Immediately afterward, more than one spare gives “Consider skipping this delivery”; the user acts at the retailer. Timing and overstock warnings can coexist. Calendar-month cadence clamps to month-end. Quantity insufficient for a full interval also receives cadence guidance.

Unlinked actual orders are ambiguous; the next-delivery comparison is withheld until the user links the order or resolves it. V1 does not model an independently confirmed separate purchase alongside the same item's scheduled subscription. The schedule does not auto-advance after receipt. Multiple active containers, configurable spare targets, history correction/backdating UI, sub-day consumption, outlier review and push notifications are deferred. Existing stock is not guessed into historical usage. Paused/cancelled tracking suppresses active subscription advice but retains physical-supply information and history.

## Verification and fixtures

`npm test` covers forecast boundaries and component behavior, including feature-off compatibility, explicit replacement/cancel, finish without subtraction, retry after response loss, stale drafts, and tracking lifecycle. `npm run build` verifies the default path; repeat with both feature flags true. `npm run build:supply-fixture` produces `dist-supply/fixtures/supply.html` with synthetic inventory and an in-memory fetch adapter. Serving that directory locally never contacts production and reloading resets it. It includes shortage, overstock and estimate-needed examples.

On this Mac, tests/builds use the previously approved alternate dependencies: Vite 5.4.21, Rollup WebAssembly 4.62.2 and esbuild-wasm 0.21.5. Repository dependency manifests/lockfile do not adopt this local alternative. No native binary exception or new install was used. Native-toolchain CI and protected preview/device gates remain required.

## Rollback

Disable `VITE_HOME_SUPPLY_TRACKING` first and rebuild. Retain backend tables, versions and all usage/subscription records. An opened unit has already been removed from spare stock; never add it back automatically or repeat a receipt. If a record needs reconciliation, export the relevant history/allocation/order records and seek an explicit correction decision. Backend rollback retains the additive schema so the fixed UI can recover its active records. No production rollback/migration is part of this draft implementation.
