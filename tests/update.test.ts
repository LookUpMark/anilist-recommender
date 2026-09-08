import assert from "node:assert/strict";
import { test } from "node:test";
import { cmpVersion } from "../src/server/update.ts";

test("cmpVersion: three-part numeric compare, v-prefix tolerant", () => {
  assert.ok(cmpVersion("v0.4.1", "0.4.0") > 0);
  assert.ok(cmpVersion("0.10.0", "v0.9.9") > 0); // numeric, not lexicographic
  assert.equal(cmpVersion("v0.3.0", "0.3.0"), 0);
  assert.ok(cmpVersion("0.2.9", "0.3.0") < 0);
  assert.ok(cmpVersion("0.3.1", "0.3.1-beta") === 0, "suffix ignored — 4th segment treated as 0");
});
