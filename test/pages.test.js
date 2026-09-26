import assert from "node:assert/strict";
import test from "node:test";

import { blocksOf, commitPath, isPage, pageOf, spansOf, taskPath, vaultUrl, whatsNewPath } from "../web/src/pages.ts";
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

test("a commit's page is its hash and a task's is its spec and number — the same address before and after the task is accepted", () => {
	assert.equal(commitPath("abc1234"), "octave://commit/abc1234");
	assert.deepEqual(pageOf("octave://commit/abc1234"), { kind: "commit", commit: "abc1234", title: "abc1234" });
	assert.equal(pageOf("octave://commit/HEAD~1"), null, "a hash and nothing git would take for a revision");
	assert.equal(taskPath("email-auth", "2.1"), "octave://task/email-auth/2.1");
	assert.deepEqual(pageOf("octave://task/email-auth/2.1"), { kind: "task", spec: "email-auth", task: "2.1", title: "Task 2.1" });
	assert.deepEqual(pageOf("octave://task/email-auth/2"), { kind: "task", spec: "email-auth", task: "2", title: "Task 2" });
	assert.equal(pageOf("octave://task/email-auth/"), null, "no number");
	assert.equal(pageOf("octave://task/email-auth/two"), null, "not a number");
	assert.equal(pageOf("octave://task/a/b/2"), null, "a spec is one folder's name");
	assert.equal(isPage("octave://task/email-auth/1"), true);
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

test("a file given in the message box opens as a page: a PDF as a document, anything else — markdown too — read as a file", () => {
	assert.equal(pageOf(".octave/attachments/ab12cd34/paper.pdf")?.kind, "document");
	assert.deepEqual(pageOf(".octave/attachments/ab12cd34/notes.md"), { kind: "code", path: ".octave/attachments/ab12cd34/notes.md", title: "notes.md" }, "not a note to edit: what was handed to the agent");
	assert.equal(pageOf(".octave/attachments/ab12cd34/run.log")?.kind, "code");
	assert.equal(pageOf("notes/a.md"), null, "a note of the folder is still the editor's");
});
