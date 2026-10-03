import test from "node:test";
import assert from "node:assert/strict";
import { createOrderMutationGuard } from "../src/order-mutations.js";

test("repeated clicks share one mutation until authoritative refresh finishes", async () => {
  const guard = createOrderMutationGuard();
  let calls = 0;
  let finishRequest;
  let finishRefresh;
  const request = new Promise(resolve => { finishRequest = resolve; });
  const refreshed = new Promise(resolve => { finishRefresh = resolve; });
  const mutate = async () => { calls++; await request; };
  const first = guard.run(mutate, () => refreshed);
  assert.equal(guard.pending, true);
  assert.equal(await guard.run(mutate, () => refreshed), false);
  finishRequest();
  await Promise.resolve();
  assert.equal(await guard.run(mutate, () => refreshed), false);
  finishRefresh();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(guard.pending, false);
  assert.equal(guard.needsRefresh, false);
});

test("a definite backend rejection preserves the error and allows corrected retry", async () => {
  const guard = createOrderMutationGuard();
  const rejected = Object.assign(new Error("Only 2 units remain"), { status: 400 });
  await assert.rejects(guard.run(() => Promise.reject(rejected), () => assert.fail("must not refresh")), /Only 2 units remain/);
  assert.equal(guard.needsRefresh, false);
  assert.equal(await guard.run(async () => {}, async () => {}), true);
});

test("an uncertain receipt is never replayed before authoritative reload", async () => {
  for (const status of [undefined, 409, 500, 503]) {
    const guard = createOrderMutationGuard();
    const error = Object.assign(new Error("Could not verify receipt"), { status });
    await assert.rejects(guard.run(() => Promise.reject(error), async () => {}), /verify receipt/);
    assert.equal(guard.needsRefresh, true);
    await assert.rejects(guard.run(() => assert.fail("must not replay"), async () => {}), /Reload order data/);
    await assert.rejects(guard.refresh(() => Promise.reject(new Error("still offline"))), /offline/);
    assert.equal(guard.needsRefresh, true);
    assert.equal(await guard.refresh(async () => {}), true);
    assert.equal(guard.needsRefresh, false);
  }
});

test("a saved change followed by failed refresh stays locked and is not reported as unsaved", async () => {
  const guard = createOrderMutationGuard();
  await assert.rejects(guard.run(async () => {}, () => Promise.reject(Object.assign(new Error("failed refresh"), { status: 401 }))), /change was saved/);
  assert.equal(guard.needsRefresh, true);
  await assert.rejects(guard.run(() => assert.fail("must not replay"), async () => {}), /Reload order data/);
  assert.equal(await guard.refresh(async () => {}), true);
});
