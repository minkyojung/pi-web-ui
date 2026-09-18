import assert from "node:assert/strict";
import test from "node:test";

import { parser as markdown } from "@lezer/markdown";

import { footnote } from "../footnote.ts";
import { wikiLink } from "../wikilink.ts";

const parser = markdown.configure([wikiLink, footnote]);
/** The inline nodes of `text`, as [name, text], paragraphs and the document left out. */
const inline = (text) => {
	const out = [];
	parser.parse(text).iterate({
		enter: (n) => {
			if (n.name === "Document" || n.name === "Paragraph" || n.name === "FootnoteDefinition") return;
			out.push([n.name, text.slice(n.from, n.to)]);
		},
	});
	return out;
};

test("[^id] in the text is a reference, with its marks and its id", () => {
	assert.deepEqual(inline("a claim.[^1] more"), [["FootnoteRef", "[^1]"], ["FootnoteMark", "[^"], ["FootnoteId", "1"], ["FootnoteMark", "]"]]);
	assert.deepEqual(inline("see[^long-note_2]"), [["FootnoteRef", "[^long-note_2]"], ["FootnoteMark", "[^"], ["FootnoteId", "long-note_2"], ["FootnoteMark", "]"]]);
});

test("[^id]: opening a line is a definition; the words after it are the note's", () => {
	assert.deepEqual(inline("[^1]: The note's text."), [["FootnoteDef", "[^1]:"], ["FootnoteMark", "[^"], ["FootnoteId", "1"], ["FootnoteMark", "]:"]]);
	assert.deepEqual(inline("mid-line [^1]: is a reference and a colon")[0], ["FootnoteRef", "[^1]"]);
	assert.deepEqual(inline("[^1]: one\n[^2]: two").filter(([n]) => n === "FootnoteDef"), [["FootnoteDef", "[^1]:"], ["FootnoteDef", "[^2]:"]], "one under another, no blank line between");
});

test("what is not a footnote is left to the rest of the parser", () => {
	const names = (text) => inline(text).map(([n]) => n);
	for (const text of ["[^] empty", "[^a b] spaced", "[^1 unclosed"]) {
		assert.ok(!names(text).some((n) => n.startsWith("Footnote")), `${text}: not a footnote`);
	}
	assert.equal(names("a [[link]] stays a link")[0], "WikiLink");
});
