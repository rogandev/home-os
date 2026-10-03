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

## Due-delivery check-ins

- With the delivery flag enabled, Orders starts with a compact **Did this
  arrive?** list for open orders due today or overdue. Oldest expected dates come
  first; equal dates retain the API order. These orders are not duplicated in
  **Already coming** below. Upcoming, undated, and legacy incoming items remain
  in that section.
- **Yes · record arrival** opens the existing quantity/container/arrival-date
  confirmation. Opening the prompt never receives stock.
- **Not yet** opens an optional expected-date editor, from both the compact list
  and inventory cards. **Keep waiting**, closing, or Escape does not send a
  request. Saving sends only `PATCH /home-os/orders/:id` with
  `{ expectedDeliveryDate: "YYYY-MM-DD" }` (or `null` when cleared). It never
  changes the order quantity, recorded order date, status, or stock allocations.
- A saved future date or cleared date moves the order out of the due list after
  authoritative reload. A date still due remains in the list. Expected dates
  remain optional, including for legacy orders with unknown order dates.
- The new section and both check-in buttons are hidden when the flag is off.

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

DOM interaction coverage (jsdom, a development-only dependency) also verifies
the prioritized compact list, no duplicate due cards, opening receipt without
receiving stock, Not yet cancellation/dismissal with zero writes, date-only PATCH
and optional clearing, repeated-save/dismissal protection, editable validation
and server rejections, recovery-required failures, and flag-off compatibility.
These interaction tests do not claim a visual browser or real-API end-to-end pass.

Before rollout, verify in a browser against a disposable compatible API:

- Flag off: the current create/correct/receive workflow sends no new date fields.
- Flag on: create with order date and optional expected date; edit/clear expected
  date; show due/overdue prompts without any stock mutation on page load.
- Confirm full and partial arrival into the selected container; verify stock,
  remaining quantity, and final receipt metadata after reload.
- Exercise validation and backend errors, double clicks, lost receipt responses,
  failed refresh, dismissal/reopening, midnight rollover, and mobile layout.

Implementation-time checks: 39 tests/subtests and both builds passed
after the check-in follow-up. The existing cloud-browser route was blocked before
page load by `net::ERR_BLOCKED_BY_CLIENT` for the local preview; it was not bypassed
or retried. Visual/browser end-to-end QA remains unverified.
