import assert from "node:assert/strict";
import test from "node:test";

import { blocksOf, isPage, pageOf, spansOf, vaultUrl, whatsNewPath } from "../web/src/pages.ts";
import { noteFromHash } from "../web/src/noteSync.ts";

test("a page's address is under a scheme no note has, and only a version makes one", () => {
	assert.equal(whatsNewPath("0.0.4"), "octave://whats-new/0.0.4");
	assert.deepEqual(pageOf("octave://whats-new/0.0.4"), { kind: "whats-new", version: "0.0.4", title: "What's new in 0.0.4" });
	assert.equal(pageOf("octave://whats-new/latest"), null, "not a version");
	assert.equal(pageOf("ideas/second.md"), null, "a note");
	assert.equal(pageOf(null), null);
	assert.equal(isPage("octave://whats-new/1.2.3"), true);
});

test("a document's address is its path, and it is a page and not a note", () => {
	assert.deepEqual(pageOf("papers/Attention is all.pdf"), { kind: "document", path: "papers/Attention is all.pdf", title: "Attention is all.pdf" });
	assert.deepEqual(pageOf("A.PDF"), { kind: "document", path: "A.PDF", title: "A.PDF" });
	assert.equal(pageOf("about pdf.md"), null, "a note about one is a note");
	assert.equal(isPage("a.pdf"), true);
	assert.equal(noteFromHash("#papers/a%20b.pdf"), "papers/a b.pdf", "and the address bar may hold it");
	assert.equal(vaultUrl("papers/a b#1.pdf"), "/vault/papers/a%20b%231.pdf");
});

test("anything else in the folder is a file to read, and markdown never is", () => {
	assert.deepEqual(pageOf("web/src/App.tsx"), { kind: "code", path: "web/src/App.tsx", title: "App.tsx" });
	assert.deepEqual(pageOf("LICENSE"), { kind: "code", path: "LICENSE", title: "LICENSE" });
	assert.deepEqual(pageOf(".github/workflows/ci.yml"), { kind: "code", path: ".github/workflows/ci.yml", title: "ci.yml" });
	assert.equal(pageOf("ideas/second.md"), null, "a note is the editor's");
	assert.equal(pageOf(".octave/specs/a/tasks.md"), null, "and so is a spec");
	assert.equal(pageOf("octave://whats-new/latest"), null, "the app's own scheme is never a file");
	// The address bar carries one, so a window reopens on the file it was reading.
	assert.equal(noteFromHash("#run.sh"), "run.sh");
	assert.equal(noteFromHash("#web/src/App.tsx"), "web/src/App.tsx");
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
