import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WORKSPACE_PROMPT, guard, looking, mentionsAppDir, underAppDir } from "../guard.ts";

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

test("pi의 프롬프트 뒤에 붙는 말은 되묻는 도구를 이름으로 부른다", () => {
  assert.match(WORKSPACE_PROMPT, /\bask_user\b/);
});

test("그 말은 저장소의 워크스페이스임과 .pi 금지와 경로로 가리키기를 말하고, 누구인지는 pi에게 맡긴다", () => {
  assert.match(WORKSPACE_PROMPT, /workspace of a git repository/);
  assert.match(WORKSPACE_PROMPT, /\.pi\//);
  assert.match(WORKSPACE_PROMPT, /relative to this folder/);
  assert.equal(/not their programmer|folder of a person's notes/.test(WORKSPACE_PROMPT), false);
});

test("고른 글이 없으면 열어 둔 노트만 말한다", () => {
  assert.equal(looking({ path: "a.md", chosen: null }), "When they sent this message, the person had this note open in their editor: a.md");
});

// --- what the guard tells pi beside the message ---

/** The before_agent_start handler pi would call, from a guard whose open note is `note`. */
const beside = (note) => {
  let handler;
  guard("/v", () => note)({ on: (event, fn) => { if (event === "before_agent_start") handler = fn; } });
  return handler({ type: "before_agent_start", prompt: "왜", systemPrompt: "BASE" });
};

test("열어 둔 노트는 시스템 프롬프트를 건드리지 않고, 화면에 안 보이는 메시지로 간다", async () => {
  const result = await beside({ path: "a.md", chosen: "첫 줄" });
  assert.equal(result.systemPrompt, undefined, "시스템 프롬프트가 턴마다 바뀌면 대화 전체의 캐시가 버려진다");
  assert.equal(result.message.display, false);
  assert.equal(result.message.content, looking({ path: "a.md", chosen: "첫 줄" }));
});

test("열어 둔 노트가 없으면 아무것도 보태지 않는다", async () => {
  assert.equal(await beside(null), undefined);
});

test("고른 글이 있으면 인용으로 붙고, 그게 무엇에 대한 물음인지 말한다", () => {
  const said = looking({ path: "a.md", chosen: "첫 줄\n둘째 줄" });
  assert.match(said, /had this note open in their editor: a\.md/);
  assert.match(said, /what their message is about/);
  assert.ok(said.endsWith("> 첫 줄\n> 둘째 줄"), "고른 글은 인용된 채 마지막에 온다");
});

test("PDF를 열어 두었으면 문서라고 말하고, 고른 글에는 쪽이 붙는다", () => {
  assert.equal(
    looking({ path: "papers/a.pdf", chosen: null }),
    "When they sent this message, the person had this document open beside the conversation: papers/a.pdf (read it with read; it comes back page by page)",
  );
  const said = looking({ path: "papers/a.pdf", chosen: "첫 줄\n둘째 줄", page: "3" });
  assert.match(said, /They have chosen these words in it on page 3, which is what their message is about/);
  assert.ok(said.endsWith("> 첫 줄\n> 둘째 줄"));
  assert.match(looking({ path: "a.pdf", chosen: "x", page: "3-4" }), /on page 3 to 4,/);
  assert.match(looking({ path: "a.pdf", chosen: "x" }), /chosen these words in it, which/, "쪽을 모르면 말하지 않는다");
  assert.doesNotMatch(looking({ path: "a.md", chosen: "x", page: "3" }), /on page/, "노트에는 쪽이 없다");
});

test("스펙을 열어 두었으면 노트가 아니라 스펙이라고, 무엇으로 고치는지와 함께 말한다", () => {
  assert.equal(
    looking({ path: ".octave/specs/email-auth/requirements.md", chosen: null }),
    "When they sent this message, the person had this spec open in their editor: .octave/specs/email-auth/requirements.md (a spec is not a note: change it with edit or write, not note_edit)",
  );
  const said = looking({ path: ".octave/specs/email-auth/requirements.md", chosen: "첫 줄" });
  assert.match(said, /They have chosen these words in it, which is what their message is about/);
  assert.ok(said.endsWith("> 첫 줄"));
});

test("저장소의 파일을 읽고 있었으면 노트가 아니라 파일이라고 말한다", () => {
  assert.equal(
    looking({ path: "web/src/App.tsx", chosen: null }),
    "When they sent this message, the person was reading this file of the repository: web/src/App.tsx",
  );
  const said = looking({ path: "server.ts", chosen: "const a = 1;" });
  assert.match(said, /was reading this file of the repository: server\.ts/);
  assert.match(said, /They have chosen these words in it, which is what their message is about/);
  assert.ok(said.endsWith("> const a = 1;"));
});

// --- what the guard refuses, as pi's runner would ask it ---

/** The handler pi would call, from a guard bound to `root`. */
const refusing = (root) => {
  let handler;
  guard(root, () => null)({ on: (event, fn) => { if (event === "tool_call") handler = fn; } });
  return (toolName, input) => handler({ type: "tool_call", toolCallId: "c1", toolName, input });
};

test("노트도 다른 파일과 같이 edit·write로 쓴다 — 파일 종류로 막지 않는다", async () => {
  const ask = refusing("/v");
  for (const tool of ["edit", "write"]) {
    for (const path of ["a.md", "ideas/b.md", "/v/a.md"]) {
      assert.equal(await ask(tool, { path }), undefined, `${tool} ${path}`);
    }
  }
});

test("다른 파일도 그대로 고친다", async () => {
  const ask = refusing("/v");
  assert.equal(await ask("edit", { path: "server.ts" }), undefined);
  assert.equal(await ask("write", { path: "sub/script.py" }), undefined);
  assert.equal(await ask("write", { path: "../outside.md" }), undefined);
  assert.equal(await ask("read", { path: "a.md" }), undefined, "읽기는 막지 않는다");
});

test("스펙 폴더(.octave) 아래의 .md는 노트가 아니라, edit·write·bash가 그대로 쓴다", async () => {
  const ask = refusing("/v");
  for (const tool of ["edit", "write"]) {
    for (const path of [".octave/specs/email-auth/requirements.md", "/v/.octave/specs/email-auth/design.md"]) {
      assert.equal(await ask(tool, { path }), undefined, `${tool} ${path}`);
    }
  }
  assert.equal(await ask("bash", { command: "mkdir -p .octave/specs/email-auth && cat > .octave/specs/email-auth/requirements.md" }), undefined);
});

test("git의 파일은 edit·write로 쓰지 못하고 git으로 바꾸라고 듣는다 — 워크트리의 .git 파일과 원본 저장소의 것까지", async () => {
  const ask = refusing("/v");
  for (const tool of ["edit", "write"]) {
    for (const path of [".git/HEAD", ".git/refs/heads/minkyojung/email-auth", "/v/.git/config", ".git", "/repos/tiny-notes/.git/refs/heads/a", "vendor/lib/.git/index"]) {
      const answer = await ask(tool, { path });
      assert.equal(answer?.block, true, `${tool} ${path}`);
      assert.match(answer.reason, /git command/, `${tool} ${path}`);
    }
  }
  for (const path of [".gitignore", "src/.gitattributes", ".github/workflows/ci.yml", "notes/git.md.txt"]) {
    assert.equal(await ask("write", { path }), undefined, `${path}는 git의 것이 아니다`);
  }
  assert.equal(await ask("read", { path: ".git/HEAD" }), undefined, "읽기는 막지 않는다");
  assert.equal(await ask("bash", { command: "git branch -m minkyojung/email-auth" }), undefined, "git 명령은 그대로");
});

test("앱의 폴더는 여전히 먼저 막히고, 그 이유로 막힌다", async () => {
  const answer = await refusing("/v")("write", { path: ".pi/history/a.md.jsonl" });
  assert.equal(answer?.block, true);
  assert.match(answer.reason, /belongs to the app/);
});

test("프롬프트는 노트도 edit·write로 쓴다고 말하고, 막는다는 말은 더 없다", () => {
  assert.match(WORKSPACE_PROMPT, /edit and write/);
  assert.equal(/refused on a note/.test(WORKSPACE_PROMPT), false);
  assert.equal(/cannot write a note/.test(WORKSPACE_PROMPT), false);
});
