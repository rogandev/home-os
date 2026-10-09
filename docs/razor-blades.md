# Per-razor blade replacement contract

Trello: https://trello.com/c/HGto5zWa. Draft only; API merge and dependent production deployment remain held for shared-API coordination.

Home OS owns configuration, inventory and history. No razor, cadence, inventory mapping, or historical event is seeded. Two Venus razors may share one blade SKU while maintaining independent dates. Stock quantities must mean individual blades, not packs; the setup UI explains this unit requirement. Item and source selection are explicit and are not inferred from names.

All endpoints live under the existing protected `/home-os` namespace and require its existing bearer authorization. No anonymous FORM alias or new auth mode is introduced. The opt-in FORM client reuses an existing configured API token, or reports missing configuration before sending a request. Deployed FORM token configuration is unverified: the connected Vercel project metadata lookup returned 404. This does not establish that a token is absent. Verify the existing authorized connection before enabling FORM; this PR provisions no credential and changes no security configuration.

## API

- `GET /home-os/razors?today=YYYY-MM-DD`: consistent snapshot `{razors, history, items, sources, corrections}`. `today` is the device's current calendar date, accepted within one day of UTC to cover world time zones. Dates use calendar arithmetic, not elapsed local-midnight hours. Razors include `ageDays`, `dueOn`, `status` (`unknown`, `unscheduled`, `current`, `due`, `overdue`), `remind`, and `version`. Complete history is returned newest first. Sources include only positive stock in active containers/locations.
- `PUT /home-os/razors/:uuid`: `{name,itemId,intervalDays,reminderDays,expectedVersion}`. Use a client-generated UUID and version 0 to add a razor. Cadence is null or 1–3650 days; reminder is null (off) or 0–365 lead days and requires a cadence. Existing records require their current version. Changing mapping/cadence does not rewrite prior events. Config save with an uncertain response should be followed by reload; a duplicate create ID cannot create a second razor.
- `POST /home-os/razors/:uuid/changes`: `{requestId,expectedVersion,today,changedOn,itemId,containerId,confirmed:true}`. The source must belong to the razor's currently configured item, have positive stock, and remain active. Changes are dated on/before today and cannot precede the latest event. Backdating consumes one stored blade now; it does not infer a past stock balance. Every successful operation creates one durable event, decrements the selected allocation, recomputes total/status under existing order/policy rules, and increments the razor version in one transaction.
- `POST /home-os/razors/:uuid/corrections`: `{requestId,expectedVersion,today,changeId,changedOn,reason}`. Corrections apply only to dates, must preserve neighboring event order, append the original/new date and reason to the audit, and never touch inventory. Wrong razor/item/container and accidental duplicate events are deliberately not auto-reversed; that stock-accounting workflow needs a separate reviewed decision.

Mutations use the same catalog advisory lock as existing Home writes, lock the razor/item, enforce version checks, and persist replay records. Matching request IDs replay without consuming again; mismatched reuse returns 409. Stale versions, unavailable stock, changed mapping, and invalid history ordering return a conflict. Invalid fields/dates return 400. Reads never write data. FKs retain referenced inventory/containers/razors rather than deleting history when an item is removed.

## Product choices in this draft

- Per-razor cadence is optional and never guessed; no last change means unknown age and no due date.
- Reminders default off. Explicit lead days enable in-app advance/due/overdue reminders. No push, email, schedule, or background notifications.
- Missing/zero stock blocks recording. No negative quantities, shortage override, or silently chosen source.
- Explicit backdating and audited date-only correction are supported. No historical stock reconstruction, hard-delete, undo consumption, or replacement-source correction.
- Both apps show history; Home alone configures razors and corrects dates.

## Release and rollback

1. Reconcile this additive migration and index/routes/OpenAPI edits after the rule-engine owner's reserved shared-API merge. Do not take that slot.
2. Run tests against a disposable local PostgreSQL database. `API_TOKEN=local-fixture DATABASE_URL=postgresql://... node tests/home-os-razors.mjs` creates a private loopback HTTP server and synthetic records. Never point this script at production.
3. Deploy API through normal approval/coordination and verify migration `0030_home-os-razor-history` plus protected routes before enabling either client.
4. Client `VITE_RAZOR_TRACKING=true` is separately opt-in. Default builds make no razor calls. FORM additionally needs an approved authenticated Home connection; there is no anonymous fallback.
5. Roll back by disabling the client flag/redeploying the previous frontend, then reverting API code if needed. Keep the additive tables and migration ledger; do not drop history or auto-refund stock. Already recorded replacements remain real stock transactions and must not be undone merely because code rolled back.

## Verification

Local PostgreSQL/HTTP tests cover no seed history, migration replay, bearer requirement, independent razors sharing one SKU, wrong/missing/zero stock, malformed/future dates, duplicate retry, competing devices, stale updates, cadence/reminder boundaries, corrections without stock change, and future mapping changes preserving historical attribution. Frontend tests exercise explicit source selection, unknown history, zero stock, default configuration and a response lost after commit. Native CI previously passed. Synthetic macOS WebKit QA passed 85 checks at 320, 390 and 768 CSS-pixel widths in both panel modes, covering layout, 44px controls, cancellation, repeated submission, failures before/after commit, refresh recovery and zero stock. Open forms receive focus and scroll into view; failure messages remain beside the active form. Home and FORM panels/styles are identical. This is browser-engine fixture verification, not physical iPhone/iPad acceptance or a live production integration test. Local frontend builds used the already available WASM toolchain without dependency-manifest changes or installations.
