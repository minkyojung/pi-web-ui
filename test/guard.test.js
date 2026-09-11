import assert from "node:assert/strict";
import test from "node:test";

import { VAULT_PROMPT, mentionsAppDir, underAppDir } from "../guard.ts";

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
