import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { recorder } from "../recorder.ts";
import { readHistory, reconcile, record } from "../history.ts";

const me = { author: "me", at: 1 };

/**
 * pi's extension API, only as much of it as recorder.ts uses: somewhere to put
 * handlers and a way to call them. The recorder watches a shell call from
 * tool_call to tool_execution_end, and those are what these tests send — the
 * pair pi emits whether a call ran, was refused, or was stopped.
 */
const ctx = { sessionManager: { getSessionId: () => "s1", getLeafId: () => "e1" } };

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), "recorder-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const written = [];
  const handlers = new Map();
  const { factory, claim } = recorder(dir, (path, base, changes) => written.push({ path, base, changes }));
  factory({
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  });
  const emit = async (event, payload) => {
    for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
  };
  const note = (name, text, mtime) => {
    writeFileSync(join(dir, name), text);
    if (mtime !== undefined) utimesSync(join(dir, name), new Date(), new Date(mtime));
    return statSync(join(dir, name)).mtimeMs;
  };
  return { dir, written, claim, emit, note };
}

const call = (id = "c1") => ({ type: "tool_call", toolCallId: id, toolName: "bash", input: { command: "true" } });

const ended = (id = "c1") => ({ type: "tool_execution_end", toolCallId: id, toolName: "bash", isError: false, result: {} });

test("bash가 노트를 바꾸면 pi가 쓴 것으로 기록된다", async (t) => {
  const { dir, written, emit, note } = vault(t);
  const before = note("a.md", "mine\n");
  record(dir, "a.md", "", "mine\n", me);
  await emit("tool_call", call());
  note("a.md", "mine, pi's\n", before + 1000);
  await emit("tool_execution_end", ended());
  const last = readHistory(dir, "a.md").at(-1);
  assert.equal(last.author, "pi");
  assert.equal(last.sessionId, "s1");
  assert.equal(last.entryId, "e1");
  assert.deepEqual(written.map((w) => [w.path, w.base]), [["a.md", before]], "호출 전의 판본 위에 얹힌다");
});

test("감시기가 먼저 물으면 pi라고 답하고, 명령이 끝나도 되풀이하지 않는다", async (t) => {
  const { dir, written, claim, emit, note } = vault(t);
  const before = note("a.md", "mine\n");
  record(dir, "a.md", "", "mine\n", me);
  await emit("tool_call", call());
  const mtime = note("a.md", "mine, pi's\n", before + 1000);

  // What noticed() does: ask whose it is, then log it.
  const origin = claim("a.md", mtime);
  assert.equal(origin?.author, "pi");
  reconcile(dir, "a.md", "mine, pi's\n", Date.now(), origin);
  const logged = readHistory(dir, "a.md").length;

  await emit("tool_execution_end", ended());
  assert.equal(readHistory(dir, "a.md").length, logged, "그물에 걸릴 것이 남아 있지 않다");
  assert.deepEqual(written, []);
});

test("호출보다 오래된 파일은 그 호출의 것이 아니다", async (t) => {
  const { dir, claim, emit, note } = vault(t);
  note("a.md", "mine\n");
  record(dir, "a.md", "", "mine\n", me);
  const started = Date.now();
  await emit("tool_call", call());
  assert.equal(claim("a.md", started - 5000), null);
  assert.equal(claim("a.md", started + 5000)?.author, "pi");
});

test("오래 도는 명령은 한동안이 지나면 더는 claim하지 않는다", async (t) => {
  const { dir, claim, emit, note } = vault(t);
  note("a.md", "mine\n");
  record(dir, "a.md", "", "mine\n", me);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const started = Date.now();
  await emit("tool_call", call());
  assert.equal(claim("a.md", started + 1)?.author, "pi");
  t.mock.timers.tick(11_000);
  assert.equal(claim("a.md", started + 1), null, "다섯 번째 분에 바뀐 노트는 사람의 것이다");
});

test("오래 도는 명령이 끝날 때도 그물이 사람의 글을 가져가지 않는다", async (t) => {
  const { dir, emit, note } = vault(t);
  const before = note("a.md", "mine\n");
  record(dir, "a.md", "", "mine\n", me);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  await emit("tool_call", call());
  t.mock.timers.tick(11_000);
  note("a.md", "mine, and what I typed meanwhile\n", before + 1000);
  await emit("tool_execution_end", ended());
  assert.equal(readHistory(dir, "a.md").at(-1).author, "outside", "로그는 따라잡되 이름은 pi가 아니다");
});

test("호출 전부터 있던, 로그 없는 노트는 통째로 pi의 것이 되지 않는다", async (t) => {
  const { dir, emit, note } = vault(t);
  const before = note("old.md", "글쓴이의 문장\n");
  await emit("tool_call", call());
  note("old.md", "글쓴이의 문장\npi가 붙인 줄\n", before + 1000);
  await emit("tool_execution_end", ended());
  assert.deepEqual(readHistory(dir, "old.md").map((c) => c.author), ["outside"]);
});

test("호출 중에 생긴 노트는 통째로 pi의 것이 맞다", async (t) => {
  const { dir, emit, note } = vault(t);
  await emit("tool_call", call());
  note("new.md", "pi가 만든 노트\n");
  await emit("tool_execution_end", ended());
  const log = readHistory(dir, "new.md");
  assert.deepEqual(log.map((c) => c.author), ["pi"]);
  assert.equal(log[0].sessionId, "s1");
});

test("배치가 끊겨도 turn_end가 남은 것을 치운다", async (t) => {
  const { dir, claim, emit, note } = vault(t);
  note("a.md", "mine\n");
  record(dir, "a.md", "", "mine\n", me);
  const started = Date.now();
  await emit("tool_call", call());
  assert.equal(claim("a.md", started + 1)?.author, "pi");
  await emit("turn_end", { type: "turn_end" });
  assert.equal(claim("a.md", started + 1), null);
});

test("나란히 도는 두 명령 중 먼저 끝난 쪽이 기록하고, 나중 쪽은 되풀이하지 않는다", async (t) => {
  const { dir, written, emit, note } = vault(t);
  const before = note("a.md", "mine\n");
  record(dir, "a.md", "", "mine\n", me);
  await emit("tool_call", call("c1"));
  await emit("tool_call", call("c2"));
  note("a.md", "mine, pi's\n", before + 1000);
  await emit("tool_execution_end", ended("c1"));
  await emit("tool_execution_end", ended("c2"));
  assert.equal(readHistory(dir, "a.md").filter((c) => c.author === "pi").length, 1);
  assert.equal(written.length, 1);
});
