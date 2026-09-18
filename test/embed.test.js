import assert from "node:assert/strict";
import test from "node:test";

import { sectionOf } from "../web/src/features/embed.ts";

const note = "# Title\n\nintro\n\n## One\n\nfirst\n\n### Deeper\n\nnested\n\n## Two\n\nsecond\n\nA block here. ^abc\n\n```\n## not a heading\n```\n";

test("the whole note, a section under a heading, or the block with an id", () => {
	assert.equal(sectionOf(note, null, null), note);
	assert.equal(sectionOf(note, "one", null), "## One\n\nfirst\n\n### Deeper\n\nnested", "to the next heading of its level, the deeper one inside");
	assert.equal(sectionOf(note, "Two", null), "## Two\n\nsecond\n\nA block here. ^abc\n\n```\n## not a heading\n```", "a # in code is not a heading");
	assert.equal(sectionOf(note, null, "abc"), "A block here.", "the block, without its id");
	assert.equal(sectionOf(note, "missing", null), null);
	assert.equal(sectionOf(note, null, "nope"), null);
});
