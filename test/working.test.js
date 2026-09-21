import assert from "node:assert/strict";
import test from "node:test";

import { agentLine, currentStep, glyphOf, lastRun, nextUnseen, resultSeen } from "../web/src/working.ts";

const line = (over = {}) => agentLine({ connection: "open", asking: 0, streaming: false, queued: 0, items: [], ...over });
const done = (over = {}) => ({ kind: "done", endedAt: Date.parse("2026-09-16T13:38:00Z"), ...over });
const clock = new Date(Date.parse("2026-09-16T13:38:00Z")).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

test("a tool call is the tool's own name and what it touched", () => {
	assert.deepEqual(currentStep([{ kind: "tool", name: "read", args: { path: "notes/plan.md" } }]), {
		what: "read",
		detail: "notes/plan.md",
	});
});

test("a thought and an answer are what the rows in the column call them", () => {
	assert.deepEqual(currentStep([{ kind: "thinking", text: "weighing it up" }]), { what: "Thinking", detail: null });
	assert.deepEqual(currentStep([{ kind: "assistant", text: "Here is" }]), { what: "Answering", detail: null });
});

test("a tool that has come back is still what pi did last", () => {
	// The gap between a result and the next step is a second long, and a line
	// that emptied for it would blink once per call.
	const step = currentStep([{ kind: "tool", name: "grep", args: { pattern: "tags" }, result: "3 matches" }]);
	assert.deepEqual(step, { what: "grep", detail: '"tags"' });
});

test("a run only just asked for says nothing about the one before it", () => {
	const items = [{ kind: "tool", name: "read", args: { path: "old.md" } }, done(), { kind: "user", text: "and again" }];
	assert.deepEqual(currentStep(items), { what: "Working", detail: null });
});

test("what a finished run came to is the note it wrote, by name", () => {
	const items = [
		{ kind: "user", text: "write it up" },
		{ kind: "tool", name: "note_write", args: { path: "daily/2026-09-16.md", content: "…" } },
		done(),
	];
	assert.equal(lastRun(items), "Wrote 2026-09-16");
});

test("several notes are counted, and one note written twice is one note", () => {
	const twice = [
		{ kind: "user", text: "go" },
		{ kind: "tool", name: "note_edit", args: { path: "plan.md" } },
		{ kind: "tool", name: "note_properties", args: { path: "plan.md" } },
		done(),
	];
	assert.equal(lastRun(twice), "Wrote plan");
	const two = [...twice.slice(0, 3), { kind: "tool", name: "note_write", args: { path: "ideas/next.md" } }, done()];
	assert.equal(lastRun(two), "Wrote 2 notes");
});

test("a write that came back an error wrote nothing", () => {
	const items = [
		{ kind: "user", text: "go" },
		{ kind: "tool", name: "note_edit", args: { path: "plan.md" }, isError: true },
		done(),
	];
	assert.equal(lastRun(items), `Answered ${clock}`);
});

test("how a run ended outranks what it wrote on the way", () => {
	const items = [
		{ kind: "user", text: "go" },
		{ kind: "tool", name: "note_write", args: { path: "plan.md" } },
		done({ stopReason: "aborted" }),
	];
	assert.equal(lastRun(items), `Stopped ${clock}`);
});

test("a run that only talked says when it answered, and a session with none says nothing", () => {
	assert.equal(lastRun([{ kind: "user", text: "hello" }, { kind: "assistant", text: "hi" }, done()]), `Answered ${clock}`);
	assert.equal(lastRun([{ kind: "user", text: "hello" }]), null);
});

test("the socket outranks everything, including a run in flight", () => {
	const items = [{ kind: "tool", name: "read", args: { path: "a.md" } }];
	assert.deepEqual(line({ connection: "reconnecting", streaming: true, asking: 1, items }), {
		kind: "trouble",
		why: "offline",
		text: "Offline — reconnecting",
	});
	assert.deepEqual(line({ connection: "connecting" }), { kind: "trouble", why: "offline", text: "Connecting…" });
});

test("a question of pi's outranks the step it asked it from", () => {
	const items = [{ kind: "tool", name: "ask_user", args: {} }];
	assert.deepEqual(line({ asking: 1, streaming: true, items }), { kind: "trouble", why: "waiting", text: "Waiting for your answer" });
});

test("a run in flight is the step, with what is queued behind it", () => {
	const items = [{ kind: "user", text: "go" }, { kind: "tool", name: "read", args: { path: "plan.md" } }];
	assert.deepEqual(line({ streaming: true, queued: 2, items }), { kind: "step", what: "read", detail: "plan.md", queued: 2, task: null });
});

test("at rest it is the last run, and nothing at all before the first one", () => {
	const items = [{ kind: "user", text: "go" }, { kind: "tool", name: "note_write", args: { path: "plan.md" } }, done()];
	assert.deepEqual(line({ items }), { kind: "last", text: "Wrote plan" });
	assert.equal(line({ items: [] }), null);
});

test("the mark folds the line into one shape, in the line's own order", () => {
	const step = { kind: "step", what: "read", detail: null, queued: 0 };
	assert.equal(glyphOf({ kind: "trouble", why: "offline", text: "Offline — reconnecting" }, true), "offline");
	assert.equal(glyphOf({ kind: "trouble", why: "waiting", text: "Waiting for your answer" }, true), "waiting");
	// A run going outranks the one before it having gone unseen.
	assert.equal(glyphOf(step, true), "working");
	assert.equal(glyphOf({ kind: "last", text: "Wrote plan" }, true), "unseen");
	assert.equal(glyphOf({ kind: "last", text: "Wrote plan" }, false), "idle");
	assert.equal(glyphOf(null, false), "idle");
});

test("a run that ends out of sight is unread until it is looked at", () => {
	assert.equal(nextUnseen(false, { type: "ended", seen: false }), true);
	// Ending in plain view is ending seen.
	assert.equal(nextUnseen(false, { type: "ended", seen: true }), false);
	assert.equal(nextUnseen(true, { type: "looked" }), false);
	// Another run ending in plain view is the newest thing, and it was seen.
	assert.equal(nextUnseen(true, { type: "ended", seen: true }), false);
});

test("a result is seen only when the column is open, at its end, in a window in front", () => {
	assert.equal(resultSeen({ folded: false, atEnd: true, shown: true }), true);
	assert.equal(resultSeen({ folded: true, atEnd: true, shown: true }), false, "the column is away");
	assert.equal(resultSeen({ folded: false, atEnd: false, shown: true }), false, "open, but scrolled up past it");
	assert.equal(resultSeen({ folded: false, atEnd: true, shown: false }), false, "open, behind another window");
});

test("작업의 실행이면 줄이 어느 작업인지, 뒤에 무엇이 남았는지 들고 간다 — 단계는 그대로", () => {
  const task = { task: "2.2", title: "Paint it", then: ["3"] };
  const step = line({ streaming: true, task });
  assert.equal(step.kind, "step");
  assert.deepEqual(step.task, task);
  assert.equal(step.what, "Working", "단계는 항목에서, 작업은 서버에서 — 서로 상관없다");
  assert.equal(line({ streaming: true }).task, null, "대화의 턴이면 작업이 없다");
  assert.notEqual(line({ streaming: false, task })?.kind, "step", "쉬는 동안엔 단계가 아니다 — 서버가 null을 보내지만, 보내더라도");
});
