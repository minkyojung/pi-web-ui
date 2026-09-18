import assert from "node:assert/strict";
import test from "node:test";

import { acceptMention, matchNotes, mentionQuery, insertMention } from "../web/src/noteMention.ts";

const paths = ["Reading list.md", "projects/Octave.md", "projects/notes on pi.md", "daily/2026-09-17.md"];

test("the word the cursor ends is a mention when it begins with @ after a space or the start", () => {
	assert.deepEqual(mentionQuery("@", 1), { from: 0, query: "" });
	assert.deepEqual(mentionQuery("see @rea", 8), { from: 4, query: "rea" });
	assert.deepEqual(mentionQuery("see @rea and", 8), { from: 4, query: "rea" });
	assert.equal(mentionQuery("see @rea and", 12), null);
	assert.equal(mentionQuery("mail me@home", 12), null);
	assert.equal(mentionQuery("/@x", 3), null);
	assert.equal(mentionQuery("@a @b", 5).from, 3);
});

test("the list narrows by title first, then by path, case aside", () => {
	assert.deepEqual(matchNotes(paths, ""), paths);
	assert.deepEqual(matchNotes(paths, "oct"), ["projects/Octave.md"]);
	assert.deepEqual(matchNotes(paths, "PI"), ["projects/notes on pi.md"]);
	assert.deepEqual(matchNotes(paths, "proj"), ["projects/Octave.md", "projects/notes on pi.md"]);
	assert.deepEqual(matchNotes(paths, "list"), ["Reading list.md"]);
	assert.deepEqual(matchNotes(paths, "zzz"), []);
});

test("a document is matched by its title like a note, and its title keeps its extension", () => {
	const paths = ["ideas.md", "papers/attention.pdf", "attention notes.md"];
	assert.deepEqual(matchNotes(paths, "att"), ["papers/attention.pdf", "attention notes.md"]);
	assert.deepEqual(matchNotes(paths, "pdf"), ["papers/attention.pdf"]);
});

test("accepting writes the path in for the word, with a space after, and puts the cursor after it", () => {
	assert.deepEqual(acceptMention("see @rea and", 4, 8, "Reading list.md"), { text: "see @Reading list.md  and", cursor: 21 });
	assert.deepEqual(acceptMention("@", 0, 1, "daily/2026-09-17.md"), { text: "@daily/2026-09-17.md ", cursor: 21 });
});

test("a dropped file's mention goes in at the cursor as a word of its own", () => {
	assert.deepEqual(insertMention("", 0, "attachments/a.pdf"), { text: "@attachments/a.pdf ", cursor: 19 });
	assert.deepEqual(insertMention("see", 3, "a.pdf"), { text: "see @a.pdf ", cursor: 11 });
	assert.deepEqual(insertMention("see ", 4, "a.pdf"), { text: "see @a.pdf ", cursor: 11 });
	assert.deepEqual(insertMention("see this", 3, "a.pdf"), { text: "see @a.pdf this", cursor: 10 });
});
