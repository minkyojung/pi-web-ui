import assert from "node:assert/strict";
import test from "node:test";
import { toHtml } from "../reader/brief.ts";

/** 브리핑이 실제로 나오는 모양. 항목 사이가 한 줄 비어 있다. */
const MD = `## 기술

- **첫째 줄이 굵다.**
  이어지는 설명. \`코드\`도 있다. [openai.com](#253) [hn](#261)

- **둘째 항목.**
  설명.

## 세상

- **셋째.**
`;

test("항목이 빈 줄로 갈려도 목록은 하나다", () => {
  const html = toHtml(MD);
  // 빈 줄마다 목록이 새로 열리면 <ul>이 항목 수만큼 생긴다.
  assert.equal(html.match(/<ul>/g).length, 2, "칸마다 목록 하나");
  assert.equal(html.match(/<li>/g).length, 3);
  assert.equal(html.match(/<ul>/g).length, html.match(/<\/ul>/g).length);
  assert.equal(html.match(/<li>/g).length, html.match(/<\/li>/g).length);
});

test("이어지는 줄은 그 항목 안에 남는다", () => {
  const html = toHtml(MD);
  const first = html.slice(html.indexOf("<li>"), html.indexOf("</li>"));
  assert.match(first, /이어지는 설명/);
  assert.match(first, /<code>코드<\/code>/);
  assert.match(first, /<strong>첫째 줄이 굵다\.<\/strong>/);
});

test("인용은 앱 안에서 움직이는 조각이 된다", () => {
  const html = toHtml(MD);
  assert.match(html, /<a href="#253">openai\.com<\/a>/);
  assert.match(html, /<a href="#261">hn<\/a>/);
});

test("html은 글자로만 들어간다", () => {
  // 브리핑을 쓰는 것이 모델이므로, 그 글에 태그가 섞여 나올 수 있다.
  const html = toHtml("- <script>alert(1)</script> & <b>x</b>");
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
});
