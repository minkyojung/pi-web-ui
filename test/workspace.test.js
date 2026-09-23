import assert from "node:assert/strict";
import test from "node:test";

import { keyed } from "../web/src/workspace.ts";
import { folderMeta } from "../folderMeta.ts";

test("페이지가 지키는 것은 워크스페이스 폴더로 나뉘고, 폴더가 없으면 키 그대로다", () => {
  assert.notEqual(keyed("open-tabs", "/a/bangkok"), keyed("open-tabs", "/a/lisbon"));
  assert.equal(keyed("open-tabs", "/a/bangkok"), keyed("open-tabs", "/a/bangkok"));
  assert.equal(keyed("open-tabs", null), "open-tabs");
});

test("서버는 폴더를 페이지의 head에 써 넣고, HTML로 읽힐 글자는 피한다", () => {
  const html = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>';
  const out = folderMeta(html, '/a/b"<c>&d');
  assert.match(out, /^<!doctype html>\n<html>\n<head>\n<meta name="octave-folder" content="\/a\/b&quot;&lt;c&gt;&amp;d">\n<meta charset/);
  assert.equal(folderMeta("<p>no head</p>", "/a"), "<p>no head</p>", "head가 없으면 그대로다");
});
