import assert from "node:assert/strict";
import test from "node:test";

import { approveCommand, approveMessage, blocked, why } from "../web/src/specApprove.ts";

const fine = { online: true, streaming: false, compacting: false, hasCommand: true, sent: false };

test("보내는 것은 사람이 치는 것과 같다 — 이름까지 붙여서", () => {
  assert.equal(approveCommand("email-auth"), "/spec-approve email-auth");
  assert.deepEqual(approveMessage("email-auth"), { type: "prompt", text: "/spec-approve email-auth", command: true, behavior: "followUp" });
});

test("막을 이유가 없으면 막지 않는다", () => {
  assert.equal(blocked(fine), null);
  assert.equal(why(null), null);
});

test("끊겼거나, 일하는 중이거나, 명령이 없거나, 이미 보냈으면 막는다", () => {
  assert.equal(blocked({ ...fine, online: false }), "offline");
  assert.equal(blocked({ ...fine, streaming: true }), "busy", "명령은 큐에 들어가지 않으므로 지금 눌러도 경고만 남는다");
  assert.equal(blocked({ ...fine, compacting: true }), "busy");
  assert.equal(blocked({ ...fine, hasCommand: false }), "no-command");
  assert.equal(blocked({ ...fine, sent: true }), "sent");
});

test("이유는 가까운 것부터", () => {
  assert.equal(blocked({ online: false, streaming: true, compacting: true, hasCommand: false, sent: true }), "offline");
  assert.equal(blocked({ ...fine, streaming: true, hasCommand: false }), "busy");
});

test("이유는 사람의 말로 나온다", () => {
  assert.equal(why("busy"), "The agent is working");
  assert.equal(why("offline"), "Not connected");
  assert.equal(why("no-command"), "Spec commands are not loaded here");
  assert.equal(why("sent"), "Approving…");
});
