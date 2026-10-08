# Catalog management fixture

This is an isolated, disposable review surface for Trello 39. It is not a
production feature or a deployed API contract. `src/main.jsx` does not import it.

```sh
npm ci
npm test
npm run build
npx vite build --config fixtures/catalog/vite.config.js
npx vite --config fixtures/catalog/vite.config.js
```

Open `http://127.0.0.1:4176/fixtures/catalog/`. The server binds loopback only;
port 4173 is deliberately not used. Reload the page to reset all data. There is
no live fetch/proxy/API token/localStorage use. The separate storage-check button
uses a temporary IndexedDB journal scope and clears its disposable request after replay. Browser connections are restricted to
self by the fixture response CSP. A dedicated dependency cache prevents conflicts
with production builds and test module graphs; hot reload is disabled, so reload
after source edits.

Current adapter/contract preparation: [catalog integration](../../docs/catalog-integration.md).
The latest fixture adds tombstones, protected Kitchen, inactive room and all-container
usage. Office is an ordinary deletable fixture location. Resolve pending change
explicitly retries the same UUID/envelope after an uncertain response.

## Review steps

1. Add a category. Empty and trimmed/case-equivalent duplicate names must fail.
2. Rename Skin Care. Both fixture items, category filter and new-item choices
   show the new name with the same ID. Filtering continues across a rename.
3. Delete the in-use category. Save is disabled until an explicit replacement is
   selected. Cancel and reopen: no mutation, replacement returns to blank.
4. Confirm replacement: both assignments move together. A removed category
   filter resets to All categories. An unused category deletes without replacement.
5. Repeat for Locations. These are presentation-model assignments only; the
   platform must implement real containers/legacy-location handling first.
6. Failure controls: validation keeps the editor correctable; conflict/collision
   require Reload values. Offline/lost-response retain an exact request envelope;
   Resolve pending change explicitly retries it with the same UUID. Refresh
   simulates a committed write with failed reload. Switch failure to none and
   reload/resolve as shown. Definite conflicts are never replayed. Delay next operations applies 1.2 seconds until failure mode changes;
   double-click Save and try Escape: editor stays pending, then closes once.

## Verification on 2026-10-03

- 50 automated tests/subtests passed, including 11 catalog checks. Production
  builds with delivery tracking off/on and the separate fixture build passed.
- Real Codex in-app browser, hidden isolated tab: desktop 1280x900, phone 390x844,
  iPad-size 820x1180. No physical device install or update.
- Browser confirmed blank/duplicate rejection, successful category add, category
  and location rename with both item projections updated, required replacement,
  cancellation clearing replacement, and replacement deletion for both kinds.
- Browser confirmed delayed double-click disables input/Cancel/Save, successful
  completion, saved-but-refresh-failed lock and successful authoritative recovery.
- DOM tests additionally assert exact write counts, Escape cancellation, 400,
  409, network/lost-response recovery, failed reload retry and no automatic replay.
- Phone document width/scrollWidth both 375 (390 viewport minus scrollbar);
  iPad both 820. Dialogs fit, controls remain visible. Viewport override reset.
- A copied Vite dependency cache/HMR produced transient React warnings during
  editing. Fixture now has a separate cache and HMR off. Fresh browser tab loaded
  with no console warnings/errors after the fix.

Screenshots were captured locally as catalog-desktop.jpg, catalog-phone.jpg and
catalog-ipad.jpg in the task workspace. Browser-emulated sizes are not a claim of
physical iPad/Safari testing. These tests cannot prove backend atomicity,
compatibility or migration safety; those remain release prerequisites in
`docs/configurable-catalog-request.md`.
