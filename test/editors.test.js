/**
 * 메뉴에 무엇이 오르고, 고르면 무슨 일이 벌어지는가.
 *
 * 이 기계에서 확인한 두 가지가 여기 박혀 있다: Cursor는 `vscode://`에도 답하므로
 * 한 앱이 두 번 오를 수 있고, Zed에는 파일을 여는 URL이 아예 없다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { editorsOn, openingOf } from "../electron/editors.js";

/** macOS 대신 답하는 것: 등록된 스킴만 앱을 돌려준다. */
const macOS = (registered) => async (scheme) => registered[scheme] ?? null;

test("등록된 스킴만 오르고, 이름과 경로는 macOS가 말한 그대로다", async () => {
  const found = await editorsOn(
    macOS({
      "cursor://": { name: "Cursor", path: "/Applications/Cursor.app" },
      "zed://": { name: "Zed", path: "/Applications/Zed.app" },
    }),
  );
  assert.deepEqual(
    found.map((e) => [e.scheme, e.name]),
    [
      ["cursor://", "Cursor"],
      ["zed://", "Zed"],
    ],
  );
});

test("이름의 .app은 뗀다 — 파일 시스템의 말이지 앱의 이름이 아니다", async () => {
  const found = await editorsOn(
    macOS({
      "cursor://": { name: "Cursor.app", path: "/Applications/Cursor.app" },
      "zed://": { name: "", path: "/Applications/Zed.app" },
    }),
  );
  assert.deepEqual(found.map((e) => e.name), ["Cursor", "Zed"], "이름이 비면 번들 이름에서 가져온다");
});

test("한 앱이 여러 스킴에 답해도 한 번만 오른다 — Cursor는 vscode://에도 답한다", async () => {
  const cursor = { name: "Cursor", path: "/Applications/Cursor.app" };
  const found = await editorsOn(macOS({ "cursor://": cursor, "vscode://": cursor }));
  assert.equal(found.length, 1, "두 줄이면 편집기가 둘이라고 말하는 것이다");
  assert.equal(found[0].scheme, "cursor://", "먼저 닿은 스킴으로 연다");
});

test("아무것도 등록돼 있지 않으면 빈 목록이고, 물어보다 터져도 마찬가지다", async () => {
  assert.deepEqual(await editorsOn(macOS({})), []);
  assert.deepEqual(await editorsOn(async () => { throw new Error("no handler"); }), []);
});

test("VS Code 계열은 URL로, 그 줄까지", () => {
  assert.deepEqual(openingOf("cursor://", "/Applications/Cursor.app", "/repo/web/App.tsx", 140), {
    url: "cursor://file/repo/web/App.tsx:140",
  });
  assert.deepEqual(openingOf("vscode://", "/x.app", "/repo/a b#1.ts", 3), {
    url: "vscode://file/repo/a%20b%231.ts:3",
    // 공백과 #을 그대로 두면 URL이 거기서 끝나 버린다.
  });
});

test("Zed는 자기 번들 안의 명령으로 — 파일을 여는 URL이 없다", () => {
  assert.deepEqual(openingOf("zed://", "/Applications/Zed.app", "/repo/server.ts", 12), {
    command: "/Applications/Zed.app/Contents/MacOS/cli",
    args: ["/repo/server.ts:12"],
  });
});

test("줄 번호가 없거나 말이 안 되면 첫 줄", () => {
  assert.match(openingOf("cursor://", "/x.app", "/a.ts", 0).url, /:1$/);
  assert.match(openingOf("cursor://", "/x.app", "/a.ts", -5).url, /:1$/);
  assert.match(openingOf("cursor://", "/x.app", "/a.ts", undefined).url, /:1$/);
  assert.match(openingOf("cursor://", "/x.app", "/a.ts", 2.7).url, /:2$/);
});

test("모르는 스킴에는 아무 일도 없다", () => {
  assert.equal(openingOf("emacs://", "/x.app", "/a.ts", 1), null);
});
