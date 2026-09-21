import assert from "node:assert/strict";
import test from "node:test";

import { chooseRunOn, runOnOf, runOnStore } from "../web/src/runOn.ts";

test("스펙마다 하나 — 고르면 그 스펙만, 비우면 세션의 모델", () => {
  assert.equal(runOnOf(runOnStore.get(), "email-auth"), null, "처음엔 아무것도 없다");
  let heard = 0;
  const off = runOnStore.subscribe(() => heard++);
  chooseRunOn("email-auth", { model: "faux/cheap", level: "low" });
  assert.deepEqual(runOnOf(runOnStore.get(), "email-auth"), { model: "faux/cheap", level: "low" });
  assert.equal(runOnOf(runOnStore.get(), "sign-in"), null, "다른 스펙은 그대로");
  chooseRunOn("email-auth", null);
  assert.equal(runOnOf(runOnStore.get(), "email-auth"), null);
  assert.equal(heard, 2, "바뀔 때마다 듣는다");
  off();
});
