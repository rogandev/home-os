# Delivery dates and arrival confirmation

This slice adds order and expected-delivery dates, local-day due/overdue prompts,
and explicit arrival confirmation using the existing quantity/container receipt
workflow. It does not forecast subscriptions, purchase items, or receive orders
automatically.

## Rollout

1. Deploy and verify the backend contract in
   [flowboard-api #76](https://github.com/rogandev/flowboard-api/pull/76) first
   (implements [issue #74](https://github.com/rogandev/flowboard-api/issues/74)).
   The actual API namespace is `/home-os`, not `/api/home-os`.
2. Keep `VITE_HOME_DELIVERY_TRACKING=false` (or unset) until that backend is
   available. The default build hides date controls/prompts and sends the old
   date-free order/receipt payloads. The independent mutation-safety guard works
   in both modes.
3. Enable `VITE_HOME_DELIVERY_TRACKING=true` in a preview pointed at the compatible
   API, and rebuild. Vite flags are build-time values. Verify the checklist below
   before enabling it in production. This change does not alter deployment
   settings or enable the flag in production.

Configure `VITE_ROGAN_API_URL` to the API origin; the frontend appends `/home-os`.
For example, a local test API on port 3001 uses
`VITE_ROGAN_API_URL=http://localhost:3001`.

## Dates and compatibility

- New order dates and actual-arrival dates default to the browser's local day,
  and are sent explicitly as `YYYY-MM-DD`, without UTC conversion.
- Expected delivery is optional and can be cleared to `null`. If the order date
  is known, expected delivery cannot precede it.
- Existing orders without a recorded order date display that fact. Leaving the
  date blank on edit omits `orderedDate`, preserving unknown history.
- A due date only changes the prompt. Stock changes only after the user chooses
  a received quantity, a real container, and explicitly confirms arrival.
- Partial receipts preserve the remaining incoming quantity and container
  allocation behavior. The API stores `receivedAt`/`receivedDate` on final full
  receipt; these fields do not represent each partial arrival.
- Due state refreshes at local midnight and on window focus/visibility changes.
  Calendar-day differences remain correct over DST transitions.

## Mutation safety

All order mutations share a synchronous single-flight guard, so repeated clicks
or reopening a modal cannot replay an in-flight operation. Validation errors
leave fields editable. Network, 5xx, and 409 errors can mean the displayed order
is stale; they block further changes and offer **Reload data**. A successful
mutation followed by a failed reload is also locked. Reloading uses authoritative
items, orders, and stats before enabling another order mutation; the UI never
automatically retries a receipt. The order-list 404 compatibility fallback is
limited to initial loads with the feature disabled, never mutation recovery.

## Verification

Run `npm test`, `npm run build`, and
`VITE_HOME_DELIVERY_TRACKING=true npm run build`.

Unit coverage includes valid/invalid dates, leap years, positive and negative UTC
offsets, DST, due/overdue/unknown/completed orders, legacy unknown-date edits,
explicit receipt dates, repeated clicks, rejected requests, uncertain outcomes,
and saved-but-refresh-failed recovery.

Before rollout, verify in a browser against a disposable compatible API:

- Flag off: the current create/correct/receive workflow sends no new date fields.
- Flag on: create with order date and optional expected date; edit/clear expected
  date; show due/overdue prompts without any stock mutation on page load.
- Confirm full and partial arrival into the selected container; verify stock,
  remaining quantity, and final receipt metadata after reload.
- Exercise validation and backend errors, double clicks, lost receipt responses,
  failed refresh, dismissal/reopening, midnight rollover, and mobile layout.

Implementation-time checks: 24 unit tests and both builds passed. Cloud-browser
QA was blocked before page load by `net::ERR_BLOCKED_BY_CLIENT` for the local
preview, so no visual or browser end-to-end pass is claimed.
