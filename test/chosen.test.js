import assert from "node:assert/strict";
import test from "node:test";

import { choose, chosenStore, LIMIT } from "../web/src/chosen.ts";

test("what is chosen is kept trimmed, and nothing but space is nothing chosen", () => {
	choose("a.md", "  words  ");
	assert.deepEqual(chosenStore.get(), { path: "a.md", text: "words" });
	choose("a.md", "   ");
	assert.equal(chosenStore.get(), null);
});

test("words chosen in a PDF carry their page, and the same words on another page are news", () => {
	choose("a.pdf", "words", "3");
	const first = chosenStore.get();
	assert.deepEqual(first, { path: "a.pdf", text: "words", page: "3" });
	choose("a.pdf", "words", "3");
	assert.equal(chosenStore.get(), first, "the same again is not set again");
	choose("a.pdf", "words", "4");
	assert.deepEqual(chosenStore.get(), { path: "a.pdf", text: "words", page: "4" });
	choose("a.pdf", "");
	assert.equal(chosenStore.get(), null);
});

test("a long choice is cut, since a whole document chosen is one pi can read itself", () => {
	choose("a.pdf", "x".repeat(LIMIT + 50), "1");
	assert.equal(chosenStore.get().text.length, LIMIT + 1);
	choose("a.pdf", "");
});
