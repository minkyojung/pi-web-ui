import assert from "node:assert/strict";
import test from "node:test";

import { blocksOf, isPage, pageOf, spansOf, whatsNewPath } from "../web/src/pages.ts";

test("a page's address is under a scheme no note has, and only a version makes one", () => {
	assert.equal(whatsNewPath("0.0.4"), "octave://whats-new/0.0.4");
	assert.deepEqual(pageOf("octave://whats-new/0.0.4"), { kind: "whats-new", version: "0.0.4", title: "What's new in 0.0.4" });
	assert.equal(pageOf("octave://whats-new/latest"), null, "not a version");
	assert.equal(pageOf("ideas/second.md"), null, "a note");
	assert.equal(pageOf(null), null);
	assert.equal(isPage("octave://whats-new/1.2.3"), true);
});

test("a changelog section is headings, lists and paragraphs, with code set apart", () => {
	const notes = "The first release.\n\n### Added\n- One thing, with `code` in it.\n- Another\n\n### Fixed\n- A fix";
	assert.deepEqual(blocksOf(notes), [
		{ kind: "paragraph", text: "The first release." },
		{ kind: "heading", text: "Added" },
		{ kind: "list", items: ["One thing, with `code` in it.", "Another"] },
		{ kind: "heading", text: "Fixed" },
		{ kind: "list", items: ["A fix"] },
	]);
	assert.deepEqual(spansOf("with `code` in it"), [{ code: false, text: "with " }, { code: true, text: "code" }, { code: false, text: " in it" }]);
	assert.deepEqual(spansOf("no code"), [{ code: false, text: "no code" }]);
	assert.deepEqual(blocksOf("a line\nthat wraps\n\nnext"), [{ kind: "paragraph", text: "a line that wraps" }, { kind: "paragraph", text: "next" }]);
});
