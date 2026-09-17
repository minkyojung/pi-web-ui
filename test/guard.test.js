import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { VAULT_PROMPT, guard, looking, mentionsAppDir, underAppDir } from "../guard.ts";

test("앱 폴더 아래의 경로는 상대든 절대든 잡힌다", () => {
  assert.equal(underAppDir("/v", ".pi/history/a.md.jsonl"), true);
  assert.equal(underAppDir("/v", "/v/.pi/history/a.md.jsonl"), true);
  assert.equal(underAppDir("/v", ".pi"), true);
  assert.equal(underAppDir("/v", "notes/.pi/x"), false, "노트 폴더 안의 .pi는 앱 폴더가 아니다");
  assert.equal(underAppDir("/v", "a.md"), false);
  assert.equal(underAppDir("/v", ".pixel.md"), false);
  assert.equal(underAppDir("/v", "/v/a.md"), false);
});

test("셸 명령에서 .pi를 건드리는 것은 잡히고, 닮은 것은 안 잡힌다", () => {
  assert.equal(mentionsAppDir("rm -rf .pi/history"), true);
  assert.equal(mentionsAppDir("cat .pi/history/a.md.jsonl"), true);
  assert.equal(mentionsAppDir("ls .pi"), true);
  assert.equal(mentionsAppDir('echo "x" > ".pi/x"'), true);
  assert.equal(mentionsAppDir("cd .pi && ls"), true);
  assert.equal(mentionsAppDir("grep -r todo *.md"), false);
  assert.equal(mentionsAppDir("cat .pixel.md"), false);
  assert.equal(mentionsAppDir("pip install x"), false);
  assert.equal(mentionsAppDir("echo api"), false);
});

test("프롬프트는 노트 폴더임과 .pi 금지와 경로로 가리키기를 말한다", () => {
  assert.match(VAULT_PROMPT, /markdown files/);
  assert.match(VAULT_PROMPT, /\.pi\//);
  assert.match(VAULT_PROMPT, /relative to this folder/);
});

test("고른 글이 없으면 열어 둔 노트만 말한다", () => {
  assert.equal(looking({ path: "a.md", chosen: null }), "The person has this note open in their editor right now: a.md");
});

test("고른 글이 있으면 인용으로 붙고, 그게 무엇에 대한 물음인지 말한다", () => {
  const said = looking({ path: "a.md", chosen: "첫 줄\n둘째 줄" });
  assert.match(said, /open in their editor right now: a\.md/);
  assert.match(said, /what their message is about/);
  assert.ok(said.endsWith("> 첫 줄\n> 둘째 줄"), "고른 글은 인용된 채 마지막에 온다");
});

// --- what the guard refuses, as pi's runner would ask it ---

/** The handler pi would call, from a guard bound to `root`. */
const refusing = (root) => {
  let handler;
  guard(root, () => null)({ on: (event, fn) => { if (event === "tool_call") handler = fn; } });
  return (toolName, input) => handler({ type: "tool_call", toolCallId: "c1", toolName, input });
};

test("노트를 edit이나 write로 쓰려 하면 막고, 무엇을 쓰라고 알려 준다", async () => {
  const ask = refusing("/v");
  for (const tool of ["edit", "write"]) {
    for (const path of ["a.md", "ideas/b.md", "/v/a.md"]) {
      const answer = await ask(tool, { path });
      assert.equal(answer?.block, true, `${tool} ${path}`);
      assert.match(answer.reason, /note_edit/);
      assert.match(answer.reason, /note_write/);
    }
  }
});

test("노트가 아닌 파일은 pi가 그대로 고친다", async () => {
  const ask = refusing("/v");
  assert.equal(await ask("edit", { path: "server.ts" }), undefined);
  assert.equal(await ask("write", { path: "sub/script.py" }), undefined);
  assert.equal(await ask("write", { path: "../outside.md" }), undefined, "폴더 밖은 노트가 아니다");
  assert.equal(await ask("read", { path: "a.md" }), undefined, "읽기는 막지 않는다");
});

test("앱의 폴더는 여전히 먼저 막히고, 그 이유로 막힌다", async () => {
  const answer = await refusing("/v")("write", { path: ".pi/history/a.md.jsonl" });
  assert.equal(answer?.block, true);
  assert.match(answer.reason, /belongs to the app/);
});

test("대문자로 쓴 확장자도 노트로 알아본다 — 파일시스템이 같은 파일을 열어 준다면", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.md"), "mine\n");
  try {
    readFileSync(join(dir, "a.MD"));
  } catch {
    return t.skip("대소문자를 구분하는 파일시스템");
  }
  const answer = await refusing(dir)("write", { path: "a.MD" });
  assert.equal(answer?.block, true, "글자만 봐서는 노트가 아니지만, 쓰면 노트가 바뀐다");
  assert.match(answer.reason, /note_write/);
});

test("프롬프트는 노트를 쓰는 도구가 무엇인지 말한다", () => {
  assert.match(VAULT_PROMPT, /note_edit/);
  assert.match(VAULT_PROMPT, /note_write/);
});
