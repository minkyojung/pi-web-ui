import assert from "node:assert/strict";
import test from "node:test";

import { chooseRunOn, pickTasks, pickedStore, runOnOf, runOnStore } from "../web/src/runOn.ts";

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

test("선택이 덮은 작업은 스펙과 번호로 놓이고, 같은 값이면 아무도 깨우지 않는다", () => {
  let heard = 0;
  const off = pickedStore.subscribe(() => heard++);
  pickTasks({ spec: "email-auth", numbers: ["2.1", "2.2"] });
  pickTasks({ spec: "email-auth", numbers: ["2.1", "2.2"] });
  assert.deepEqual(pickedStore.get(), { spec: "email-auth", numbers: ["2.1", "2.2"] });
  assert.equal(heard, 1, "같은 선택을 다시 말해도 한 번");
  pickTasks(null);
  pickTasks(null);
  assert.equal(pickedStore.get(), null);
  assert.equal(heard, 2);
  off();
});
