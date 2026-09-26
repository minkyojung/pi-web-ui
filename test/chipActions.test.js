import assert from "node:assert/strict";
import test from "node:test";

import { chipAction } from "../web/src/composer/chip.ts";

test("칩을 누르면: 입력창에 준 그림은 크게 보고, 나머지는 전부 탭으로", () => {
  assert.equal(chipAction(".octave/attachments/ab12cd34/Pasted image 20260926153012.png"), "picture");
  assert.equal(chipAction(".octave/attachments/ab12cd34/photo.JPG"), "picture");
  assert.equal(chipAction(".octave/attachments/ab12cd34/logo.svg"), "tab", "SVG는 그림으로 내보내지 않는다 — 글로 읽는다");
  assert.equal(chipAction(".octave/attachments/ab12cd34/paper.pdf"), "tab");
  assert.equal(chipAction(".octave/attachments/ab12cd34/archive.zip"), "tab", "글이 아닌 파일은 탭이 Finder를 권한다");
  assert.equal(chipAction("notes/a.md"), "tab");
});
