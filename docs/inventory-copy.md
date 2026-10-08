# Copy an inventory item

Implementation for [Home OS Copy card](https://trello.com/c/KGnwFSe8/64-home-os-copy-an-inventory-item).

## Behavior

`VITE_HOME_INVENTORY_COPY=true` adds **Copy** to each inventory item's quick actions.
It opens a new, unsaved draft with every editable product value: name, brand,
category, description, size, form, notes, quantity, reorder threshold,
replenishment policy, legacy default location, and a deep copy of all container
allocations (including zero rows).

- Edit any product field before saving. Container quantities determine the copied
  total; the legacy location field stays distinct from physical stock locations.
- **Cancel**, Close, Escape, and backdrop dismissal before Save perform no writes.
- **Save Copy** creates a fresh server ID, calculated status, and new timestamps.
  Source identity, derived awaiting-shipment status, incoming orders, usage history,
  and order history are never sent or modified.
- Missing source storage data or inconsistent totals prevent copying rather than
  silently dropping allocations.
- The form keeps custom category/location values visible rather than substituting
  the first option in an existing selector.

## Atomic creation and retries

Copy depends on the additive `POST /home-os/items` contract documented by
`flowboard-api/docs/home-os-item-creation.md`:

- Send the allowed product fields, complete `{containerId, quantity}` allocations,
  and one `createRequestId` UUID.
- Receive the flat created item plus `allocations` in the same response. No
  post-create allocation write or allocation GET is required to recognize success.
- Concurrent clicks share one in-flight request. A confirmed result is cached.
- A lost, timed-out (30 seconds), malformed, or otherwise ambiguous response freezes
  the draft and UUID. **Retry Save Safely** sends that exact body to recover the
  original record. Cancel, Close, and editing stay disabled until it is settled.
- Initial 400/401/403/404/413/422 rejections allow correction. Once an earlier
  attempt is ambiguous, a later rejection cannot discard its original identity.
- A 409 identity conflict never silently mints another key.
- A before-unload warning protects a pending/uncertain save. The client intent is
  held in the current open draft, not restored after a forced tab/browser shutdown;
  check inventory before deliberately starting another copy after that interruption.

Legacy Add remains on its existing create contract. Its post-commit storage GET
now fails independently: the created record is kept, the form closes, and storage
is marked unavailable for reload rather than inviting a duplicate create.

## Rollout

Default is **off**. This flag is independent of `VITE_HOME_DELIVERY_TRACKING`.
No delivery flag/configuration is changed by this work.

1. Review and approve the focused backend capability request, migration, contract,
   and backend PR.
2. Deploy backend and verify its migration and additive contract through the
   approved platform workflow.
3. Validate the frontend against that contract in an authorized preview using
   disposable fixtures.
4. Complete browser/device QA, then explicitly approve enabling the Copy flag.

Do not enable Copy against the old server: it does not implement atomic
allocations/idempotency. A frontend-only deployment with the flag off preserves
existing functionality and is not completion of the feature rollout.

## Verification record

Passed locally on 2026-10-03:

- `npm test`: 45 passing tests, including real React component rendering with a
  jsdom document and mocked API. This is component verification, not visual QA.
- `npm run build`: production bundle, with Copy default off and separately enabled.
- Unit/component coverage: size-only edit preservation; deep and zero/multiple
  allocations; unchanged source/orders; Cancel/Close/Escape/backdrop zero writes;
  double clicks; busy dismissal; lost committed response recovery; 400/413
  correction; storage-load failures; legacy Add post-commit refresh failure;
  default-off rollout.
- Independent review found the 413 retry-lock edge case; it was fixed and covered.
- Backend companion: 31 full platform contract scripts passed on real disposable
  PostgreSQL 17.11, including concurrency, changed-payload conflicts, injected
  allocation failure rollback, exact replay, migration replay, zero rows, and
  unchanged orders/history.

Not completed:

- Real browser end-to-end, mobile, and iPad visual checks. This executor cannot
  launch Chromium because of its Unix-socket restriction; the escalation runtime
  also failed, and the cloud browser could not open the local preview. No device
  results or screenshots are claimed.
- Backend/frontend publication, merge, production deployment, or flag activation.

`tests/browser/inventory-copy.py` preserves the local-only Playwright acceptance
suite for a suitable preview/test environment. It requires a disposable local
backend with the new contract, Python Playwright, Chromium, and a Vite app with
Copy enabled. It rejects non-local targets. Run it with `API_BASE_URL`, `API_TOKEN`,
and optionally `UI_BASE_URL`, `CHROMIUM_PATH`, `QA_ARTIFACTS`. It creates disposable
fixtures and should never be aimed at a real inventory database.
