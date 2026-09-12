import assert from "node:assert/strict";
import test from "node:test";

import { VAULT_PROMPT, looking, mentionsAppDir, underAppDir } from "../guard.ts";

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
