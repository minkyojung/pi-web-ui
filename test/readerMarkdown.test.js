import assert from "node:assert/strict";
import test from "node:test";

import { toMarkdown } from "../reader/markdown.ts";

test("paragraphs survive a page that ships its html minified", () => {
	// textContent 로 뽑으면 "One.Two.Three." 가 되던 자리다. 사이트가 태그
	// 사이에 넣어준 들여쓰기에 기대고 있었을 뿐, 구조를 읽은 적이 없었다.
	assert.equal(toMarkdown("<div><p>One.</p><p>Two.</p><p>Three.</p></div>"), "One.\n\nTwo.\n\nThree.");
	assert.equal(toMarkdown("<p>One.</p>\n\n  <p>Two.</p>\n"), "One.\n\nTwo.");
});

test("a heading says where you are in a twenty-minute piece", () => {
	assert.equal(
		toMarkdown("<h1>Title</h1><p>Lede.</p><h2>Why</h2><p>Because.</p>"),
		"# Title\n\nLede.\n\n## Why\n\nBecause.",
	);
});

test("lists keep their shape, nested ones included", () => {
	assert.equal(
		toMarkdown("<ul><li>alpha</li><li>beta<ul><li>nested</li></ul></li></ul>"),
		"- alpha\n- beta\n  - nested",
	);
	assert.equal(toMarkdown("<ol><li>first</li><li>second</li></ol>"), "1. first\n2. second");
});

test("code is fenced and left alone inside", () => {
	assert.equal(
		toMarkdown("<p>Run:</p><pre><code>npm  run   fetch\nnpm test</code></pre>"),
		"Run:\n\n```\nnpm  run   fetch\nnpm test\n```",
	);
	// 줄 안의 코드는 백틱 하나로만 감싼다.
	assert.equal(toMarkdown("<p>Use <code>ls</code> here.</p>"), "Use `ls` here.");
});

test("emphasis and links are kept, and anchors to the page itself are not", () => {
	assert.equal(
		toMarkdown('<p>A <strong>bold</strong> and <em>italic</em> and <a href="https://x.com/a">link</a>.</p>'),
		"A **bold** and *italic* and [link](https://x.com/a).",
	);
	assert.equal(toMarkdown('<p>See <a href="#top">above</a>.</p>'), "See above.");
	// 강조 안이 비어 있으면 표시만 남는 일이 없도록 지운다.
	assert.equal(toMarkdown("<p>Text <strong> </strong>here.</p>"), "Text here.");
});

test("a span wrapped around blocks is not treated as a run inside a line", () => {
	assert.equal(toMarkdown("<span><p>One.</p><p>Two.</p></span>"), "One.\n\nTwo.");
});

test("blockquotes are quoted, blank lines and all", () => {
	assert.equal(
		toMarkdown("<blockquote><p>Quoted.</p><p>And more.</p></blockquote>"),
		"> Quoted.\n>\n> And more.",
	);
});

test("what carries no prose is dropped", () => {
	assert.equal(toMarkdown("<p>Keep.</p><script>bad()</script><style>.x{}</style>"), "Keep.");
	assert.equal(toMarkdown("<div><span>  </span></div>"), "");
	assert.equal(toMarkdown(""), "");
});

test("an image is worth its caption and nothing else", () => {
	assert.equal(toMarkdown('<p><img src="a.png" alt="A chart"> after</p>'), "![A chart] after");
	assert.equal(toMarkdown('<p><img src="a.png"> after</p>'), "after");
});
