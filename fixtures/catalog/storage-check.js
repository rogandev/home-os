import { createCatalogAdapter, createIndexedDBCatalogJournal } from "../../src/catalog-adapter.js";
import { createCatalogTransport } from "./model.js";

// Browser-only disposable check: journal persistence, competing tabs, exact
// replay, then cleanup. Never uses a live API or production journal scope.
export async function checkRecoveryStorage() {
  const scope = `fixture-check:${crypto.randomUUID()}`;
  const firstJournal = createIndexedDBCatalogJournal(scope);
  const secondJournal = createIndexedDBCatalogJournal(scope);
  const transport = createCatalogTransport();
  const first = createCatalogAdapter({ request: transport.request, journal: firstJournal, enabled: true });
  transport.configure({ failure: "lost-response" });
  try { await first.mutate({ kind: "categories", action: "rename", id: "skin", version: 1, name: "Face Care" }); } catch { /* expected lost response */ }
  const retained = await secondJournal.read();
  if (!retained) throw new Error("Request was not durably retained.");
  let reservationBlocked = false;
  try { await secondJournal.write({ ...retained, body: "different request" }); } catch { reservationBlocked = true; }
  if (!reservationBlocked) throw new Error("A pending request could be overwritten.");
  const reopened = createCatalogAdapter({ request: transport.request, journal: secondJournal, enabled: true });
  let pendingFound = false;
  try { await reopened.load(); } catch { pendingFound = true; }
  if (!pendingFound) throw new Error("Reopened adapter did not find pending change.");
  await reopened.retryPending();
  if (JSON.stringify(transport.writes[0]) !== JSON.stringify(transport.writes[1])) throw new Error("Retry envelope changed.");
  if (await firstJournal.read()) throw new Error("Resolved journal was not cleared.");
  const current = await reopened.load();
  if (current.categories.find(row => row.id === "skin").version !== 2) throw new Error("Mutation was applied more than once.");
  return "Recovery storage passed: retained across clients, competing reservation blocked, exact replay applied once, journal cleared.";
}
