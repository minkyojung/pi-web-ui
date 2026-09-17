import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { applyEdits, applyProperties, noteTools, prepareEdits } from "../noteEdit.ts";
import { readNote } from "../vault.ts";

// --- applying edits ---

const edit = (oldText, newText) => ({ oldText, newText });

test("고친 곳만 바뀌고 나머지는 그대로다", () => {
  const applied = applyEdits("첫 줄\n둘째 줄\n", [edit("둘째", "두 번째")]);
  assert.deepEqual(applied, { ok: true, text: "첫 줄\n두 번째 줄\n" });
});

test("떨어진 두 곳을 한 번에 고치고, 둘 다 원래 글에서 찾는다", () => {
  const applied = applyEdits("a b c\n", [edit("c", "C"), edit("a", "A")]);
  assert.deepEqual(applied, { ok: true, text: "A b C\n" });
});

test("찾을 수 없거나, 여러 번 나오거나, 서로 겹치면 아무것도 하지 않는다", () => {
  const text = "hello hello world\n";
  assert.match(applyEdits(text, [edit("goodbye", "x")]).reason, /not in the note/);
  assert.match(applyEdits(text, [edit("hello", "x")]).reason, /more than once/);
  assert.match(applyEdits(text, [edit("hello hello", "x"), edit("hello world", "y")]).reason, /same words/);
  assert.match(applyEdits(text, [edit("", "x")]).reason, /empty/);
  assert.match(applyEdits(text, []).reason, /at least one/);
});

test("몇 번째 edit이 문제인지 말해 준다 — pi가 고쳐 보낼 수 있도록", () => {
  const applied = applyEdits("a b\n", [edit("a", "A"), edit("zzz", "Z")]);
  assert.match(applied.reason, /edits\[1\]/);
});

// --- what a model actually sends ---

test("edits를 문자열로 보내도, 하나만 보내도, 맨 위에 붙여 보내도 받아 준다", () => {
  const one = [{ oldText: "a", newText: "b" }];
  assert.deepEqual(prepareEdits({ path: "n.md", edits: JSON.stringify(one) }), { path: "n.md", edits: one });
  assert.deepEqual(prepareEdits({ path: "n.md", edits: JSON.stringify(one[0]) }), { path: "n.md", edits: one });
  assert.deepEqual(prepareEdits({ path: "n.md", edits: one[0] }), { path: "n.md", edits: one });
  assert.deepEqual(prepareEdits({ path: "n.md", oldText: "a", newText: "b" }), { path: "n.md", edits: one });
});

test("제대로 보낸 것은 건드리지 않고, 알아볼 수 없는 것은 스키마에 맡긴다", () => {
  const right = { path: "n.md", edits: [{ oldText: "a", newText: "b" }] };
  assert.deepEqual(prepareEdits(right), right);
  assert.deepEqual(prepareEdits({ path: "n.md", edits: "not json" }), { path: "n.md", edits: "not json" });
  assert.equal(prepareEdits(null), null);
});

// --- the tools themselves ---

const ctx = { sessionManager: { getSessionId: () => "s1", getLeafId: () => "e1" } };

function vault(t, result = { ok: true, modified: 2 }) {
  const dir = mkdtempSync(join(tmpdir(), "notetools-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const writes = [];
  const tools = new Map();
  noteTools(dir, (path, had, text, sessionId, entryId) => {
    writes.push({ path, had, text, sessionId, entryId });
    return result;
  })({ registerTool: (tool) => tools.set(tool.name, tool), on: () => {} });
  const run = (name, params) => tools.get(name).execute("c1", params, undefined, undefined, ctx);
  const note = (name, text) => writeFileSync(join(dir, name), text);
  return { dir, writes, tools, run, note };
}

test("두 도구가 pi의 이름으로 등록된다", (t) => {
  const { tools } = vault(t);
  assert.deepEqual([...tools.keys()].sort(), ["note_edit", "note_properties", "note_write"]);
  assert.equal(tools.get("note_edit").parameters.properties.edits.type, "array", "pi의 edit과 같은 모양");
  assert.equal(tools.get("note_write").parameters.properties.content.type, "string", "pi의 write와 같은 모양");
});

test("note_write는 없던 노트를 만들고, 읽은 판본이 없다고 말한다", async (t) => {
  const { writes, run } = vault(t);
  await run("note_write", { path: "new.md", content: "made by pi\n" });
  assert.deepEqual(writes, [{ path: "new.md", had: null, text: "made by pi\n", sessionId: "s1", entryId: "e1" }]);
});

test("note_write는 있던 노트를 그것이 있던 판본 위에 덮어쓴다", async (t) => {
  const { dir, writes, run, note } = vault(t);
  note("a.md", "mine\n");
  await run("note_write", { path: "a.md", content: "pi's\n" });
  assert.equal(writes[0].text, "pi's\n");
  assert.equal(writes[0].had.modified, readNote(dir, "a.md").modified, "읽은 그 판본 위에");
  assert.equal(writes[0].had.text, "mine\n");
});

test("note_edit은 고친 글 전체를 한 번에 쓴다 — 고친 곳이 여럿이어도", async (t) => {
  const { writes, run, note } = vault(t);
  note("a.md", "a b c\n");
  await run("note_edit", { path: "a.md", edits: [edit("a", "A"), edit("c", "C")] });
  assert.equal(writes.length, 1, "고친 곳마다가 아니라 한 번");
  assert.equal(writes[0].text, "A b C\n");
});

test("없는 노트를 고치라면 만들라고 말하고, 아무것도 쓰지 않는다", async (t) => {
  const { writes, run } = vault(t);
  await assert.rejects(run("note_edit", { path: "gone.md", edits: [edit("x", "y")] }), /note_write/);
  assert.deepEqual(writes, []);
});

test("찾을 수 없는 글을 고치라면 다시 읽으라고 말하고, 파일은 그대로다", async (t) => {
  const { dir, writes, run, note } = vault(t);
  note("a.md", "mine\n");
  await assert.rejects(run("note_edit", { path: "a.md", edits: [edit("theirs", "x")] }), /not in the note/);
  assert.deepEqual(writes, []);
  assert.equal(readNote(dir, "a.md").text, "mine\n");
});

test("노트가 아닌 것은 이 도구로 쓸 수 없다 — 폴더 밖, 마크다운 아닌 것, 앱의 폴더", async (t) => {
  const { writes, run } = vault(t);
  for (const path of ["../escape.md", "script.py", ".pi/history/a.md", "/tmp/a.md"]) {
    await assert.rejects(run("note_write", { path, content: "x" }), /not a note/, path);
  }
  assert.deepEqual(writes, []);
});

test("사람이 그 사이 타이핑했으면 거절되고, 다시 읽으라고 말한다", async (t) => {
  const { run, note } = vault(t, { ok: false, reason: "conflict", modified: 9 });
  note("a.md", "mine\n");
  await assert.rejects(run("note_edit", { path: "a.md", edits: [edit("mine", "pi's")] }), /Read it again/);
});

// --- changing properties ---

const changed = (text, set = [], remove = []) => applyProperties(text, { set, remove });

test("바꾼 속성 줄만 다시 써지고, 나머지는 한 글자도 바뀌지 않는다", () => {
  const note = "---\n# why\ntitle: 'kept'   # here\nstatus: draft\n---\nbody\n";
  assert.deepEqual(changed(note, [{ name: "status", value: "done" }]), { ok: true, text: "---\n# why\ntitle: 'kept'   # here\nstatus: done\n---\nbody\n" });
});

test("여러 속성을 한 번에 바꾸고 지운다", () => {
  const out = changed("---\na: 1\nb: 2\nc: 3\n---\n", [{ name: "a", value: "one" }, { name: "d", value: true }], ["b"]);
  assert.equal(out.text, "---\na: one\nc: 3\nd: true\n---\n");
});

test("빈 값과 삭제는 다르다", () => {
  const note = "---\na: 1\nb: 2\n---\n";
  assert.equal(changed(note, [{ name: "b", value: null }]).text, "---\na: 1\nb:\n---\n");
  assert.equal(changed(note, [], ["b"]).text, "---\na: 1\n---\n");
});

test("목록은 쓰여 있던 모양을 지킨다", () => {
  assert.equal(changed("---\ntags: [a, b]\n---\n", [{ name: "tags", value: ["a", "b", "c"] }]).text, "---\ntags: [a, b, c]\n---\n");
  assert.equal(changed("---\ntags:\n  - a\n---\n", [{ name: "tags", value: ["a", "b"] }]).text, "---\ntags:\n  - a\n  - b\n---\n");
});

test("이름의 대소문자는 가리지 않는다 — 같은 속성이 둘이 되지 않는다", () => {
  assert.equal(changed("---\nStatus: draft\n---\nbody\n", [{ name: "status", value: "done" }]).text, "---\nStatus: done\n---\nbody\n");
  assert.equal(changed("---\nStatus: draft\n---\nbody\n", [], ["status"]).text, "body\n");
});

test("블록이 없으면 첫 줄에 만들고, 본문은 그대로다", () => {
  assert.equal(changed("# hi\n", [{ name: "status", value: "draft" }]).text, "---\nstatus: draft\n---\n# hi\n");
});

test("깨진 블록에는 쓰지 않고, 왜인지 말한다", () => {
  const out = changed("---\ntags: [x\n---\nbody\n", [{ name: "status", value: "draft" }]);
  assert.equal(out.ok, false);
  assert.match(out.reason, /could not be read/);
});

test("한 번의 호출에서 같은 이름을 두 번 말할 수 없다", () => {
  assert.match(changed("---\na: 1\n---\n", [{ name: "a", value: 2 }], ["a"]).reason, /both/);
  assert.match(changed("---\na: 1\n---\n", [{ name: "a", value: 2 }, { name: "A", value: 3 }]).reason, /more than once/);
});

test("중첩된 값과 빈 이름은 거절한다", () => {
  assert.match(changed("---\na: 1\n---\n", [{ name: "a", value: { b: 1 } }]).reason, /nested/);
  assert.match(changed("---\na: 1\n---\n", [{ name: " ", value: 1 }]).reason, /name/);
});

test("바꿀 것이 없으면 거절한다", () => {
  assert.match(changed("---\na: 1\n---\n").reason, /nothing/);
});

test("note_properties는 여러 속성을 한 번에, 한 번의 쓰기로", async (t) => {
  const { writes, run, note } = vault(t);
  note("a.md", "---\nstatus: draft\ntags: [x]\n---\nbody\n");
  await run("note_properties", { path: "a.md", set: [{ name: "status", value: "done" }, { name: "tags", value: ["x", "y"] }] });
  assert.equal(writes.length, 1, "속성마다가 아니라 한 번");
  assert.equal(writes[0].text, "---\nstatus: done\ntags: [x, y]\n---\nbody\n");
});

test("note_properties는 없는 노트를 거절하고 아무것도 쓰지 않는다", async (t) => {
  const { writes, run } = vault(t);
  await assert.rejects(run("note_properties", { path: "gone.md", set: [{ name: "a", value: 1 }] }), /note_write/);
  assert.deepEqual(writes, []);
});

test("note_properties는 깨진 블록을 거절하고 note_edit으로 보낸다", async (t) => {
  const { dir, writes, run, note } = vault(t);
  note("a.md", "---\ntags: [x\n---\nbody\n");
  await assert.rejects(run("note_properties", { path: "a.md", set: [{ name: "a", value: 1 }] }), /note_edit/);
  assert.deepEqual(writes, []);
  assert.equal(readNote(dir, "a.md").text, "---\ntags: [x\n---\nbody\n");
});

test("블록이 읽히는 동안 note_edit은 그 안에 닿지 못한다", async (t) => {
  const { writes, run, note } = vault(t);
  note("a.md", "---\nstatus: draft\n---\nbody\n");
  await assert.rejects(run("note_edit", { path: "a.md", edits: [edit("draft", "done")] }), /note_properties/);
  assert.deepEqual(writes, []);
  // 본문은 여전히 note_edit의 것이다.
  await run("note_edit", { path: "a.md", edits: [edit("body", "text")] });
  assert.equal(writes[0].text, "---\nstatus: draft\n---\ntext\n");
});

test("깨진 블록은 글이므로 note_edit으로 고친다", async (t) => {
  const { writes, run, note } = vault(t);
  note("a.md", "---\ntags: [x\n---\nbody\n");
  await run("note_edit", { path: "a.md", edits: [edit("[x", "[x]")] });
  assert.equal(writes[0].text, "---\ntags: [x]\n---\nbody\n");
});
