import assert from "node:assert/strict";
import test from "node:test";

import { frontAfter, nameOf, nextId } from "../web/src/terminals.ts";

test("the next id is past every one there is, so a closed number is not reused while older ones are open", () => {
	assert.equal(nextId([]), "1");
	assert.equal(nextId(["1"]), "2");
	assert.equal(nextId(["1", "3"]), "4", "2 was closed; the new one is not 2");
	assert.equal(nextId(["3"]), "4");
	assert.equal(nextId(["x", "2"]), "3", "an id that is not a number does not count");
});

test("a tab is called by its shell and its number", () => {
	assert.equal(nameOf({ id: "2", shell: "zsh" }), "zsh 2");
});

test("what is in front once one is gone: the one that was, else the right neighbour, else the left", () => {
	assert.equal(frontAfter(["1", "2", "3"], "3", "1"), "1", "the front stays");
	assert.equal(frontAfter(["1", "2", "3"], "2", "2"), "3", "the right neighbour");
	assert.equal(frontAfter(["1", "2", "3"], "3", "3"), "2", "the last: the left");
	assert.equal(frontAfter(["1"], "1", "1"), null, "the only one: nothing");
	assert.equal(frontAfter(["1", "2"], "2", "9"), null, "a front that is not there is nothing");
});
