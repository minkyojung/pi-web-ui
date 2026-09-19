import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OCTAVE_PROMPT, VAULT_PROMPT, guard, looking, mentionsAppDir, underAppDir } from "../guard.ts";

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

test("에이전트가 누구인지 말하는 프롬프트는 되묻는 도구를 이름으로 부른다", () => {
  assert.match(OCTAVE_PROMPT, /\bask_user\b/);
});

test("프롬프트는 노트 폴더임과 .pi 금지와 경로로 가리키기를 말한다", () => {
  assert.match(VAULT_PROMPT, /markdown files/);
  assert.match(VAULT_PROMPT, /\.pi\//);
  assert.match(VAULT_PROMPT, /relative to this folder/);
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
