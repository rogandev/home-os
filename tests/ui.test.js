import test from "node:test";
import assert from "node:assert/strict";
import { anchoredMenuPosition } from "../src/ui.js";

test("anchors a dropdown immediately below its control when space is available", () => {
  const position = anchoredMenuPosition({ top: 100, bottom: 138, left: 40, width: 220 }, 768, 1024);

  assert.equal(position.top, 144);
  assert.equal(position.left, 40);
  assert.equal(position.width, 220);
});

test("keeps a dropdown visible by opening above a low control", () => {
  const position = anchoredMenuPosition({ top: 650, bottom: 688, left: 700, width: 220 }, 768, 720);

  assert.ok(position.top < 650);
  assert.equal(position.left, 536);
  assert.ok(position.maxHeight <= 260);
});
