import assert from "node:assert/strict";
import test from "node:test";

import { readSeen, sawResults, seenStore } from "../web/src/seenResults.ts";

test("저장된 것은 스펙 이름에서 커밋으로 가는 표다 — 다른 모양은 빈 것으로", () => {
  assert.deepEqual(readSeen('{"greeting":"abc1234","email-auth":"def5678"}'), { greeting: "abc1234", "email-auth": "def5678" });
  assert.deepEqual(readSeen(null), {});
  assert.deepEqual(readSeen("not json"), {});
  assert.deepEqual(readSeen("[1,2]"), {});
  assert.deepEqual(readSeen('{"greeting":42,"ok":"abc1234"}'), { ok: "abc1234" }, "글자가 아닌 값은 버린다");
});

test("본 데까지를 스펙별로 기억하고, 같은 말을 다시 해도 아무도 깨우지 않는다", () => {
  let heard = 0;
  const off = seenStore.subscribe(() => heard++);
  sawResults("greeting", "abc1234");
  sawResults("greeting", "abc1234");
  sawResults("email-auth", "def5678");
  assert.deepEqual(seenStore.get(), { greeting: "abc1234", "email-auth": "def5678" });
  assert.equal(heard, 2);
  off();
});
