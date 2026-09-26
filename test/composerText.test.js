import assert from "node:assert/strict";
import test from "node:test";

import { getSchema, getText, getTextSerializersFromSchema } from "@tiptap/core";

import { extensions } from "../web/src/composer/schema.ts";
import { CHIP, docToText, textToDoc } from "../web/src/composer/text.ts";

const files = new Set(["notes/a.md", ".octave/attachments/ab12cd34/Screenshot 1.png", "src/app.ts"]);
const isFile = (path) => files.has(path);

test("@경로는 파일일 때만 칩이 되고, 나머지는 글자 그대로", () => {
  const doc = textToDoc("이거 봐 @notes/a.md 그리고 @someone 도", isFile);
  assert.deepEqual(doc.content[0].content, [
    { type: "text", text: "이거 봐 " },
    { type: CHIP, attrs: { path: "notes/a.md" } },
    { type: "text", text: " 그리고 @someone 도" },
  ]);
});

test("글과 문서는 왕복해도 같다 — 빈 줄, 줄 앞과 끝의 칩, 한글까지", () => {
  for (const text of [
    "",
    "한 줄",
    "@notes/a.md",
    "@notes/a.md 앞\n\n뒤 @src/app.ts",
    "첫 줄\n\n\n셋째 줄 뒤에 빈 줄\n",
    "메일@notes/a.md 는 멘션이 아니다",
  ]) {
    assert.equal(docToText(textToDoc(text, isFile)), text, JSON.stringify(text));
  }
});

test("공백이 든 경로는 따옴표로 쓰고 읽는다 — 스크린샷 이름도 한 칩으로 돌아온다", () => {
  const path = ".octave/attachments/ab12cd34/Screenshot 1.png";
  const text = `이것 @"${path}" 봐`;
  assert.deepEqual(textToDoc(text, isFile).content[0].content, [
    { type: "text", text: "이것 " },
    { type: CHIP, attrs: { path } },
    { type: "text", text: " 봐" },
  ]);
  assert.equal(docToText(textToDoc(text, isFile)), text);
  assert.equal(textToDoc(`@${path}`, isFile).content[0].content.some((n) => n.type === CHIP), false, "따옴표 없이는 한 단어가 아니다");
  assert.equal(docToText(textToDoc('@"no such file.md"', isFile)), '@"no such file.md"', "파일이 아니면 따옴표째 글자로");
});

test("스키마가 이 문서를 받아들이고, Tiptap이 읽는 글도 같다", () => {
  const schema = getSchema(extensions);
  const text = "보자 @notes/a.md\n\n그리고 @src/app.ts 끝";
  const node = schema.nodeFromJSON(textToDoc(text, isFile));
  node.check();
  assert.equal(getText(node, { blockSeparator: "\n", textSerializers: getTextSerializersFromSchema(schema) }), text);
  const chip = node.firstChild.child(1);
  assert.equal(chip.type.name, CHIP);
  assert.equal(chip.nodeSize, 1, "칩은 한 자리 — 글에서의 한 글자와 같다");
});
