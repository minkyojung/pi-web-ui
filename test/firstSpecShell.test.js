import assert from "node:assert/strict";
import test from "node:test";

import { firstFrom, firsts } from "../electron/firstSpec.js";

test("a first message is a line, with the model and effort chosen or neither", () => {
	assert.deepEqual(firstFrom({ line: "add sign-in with email" }), { line: "add sign-in with email", model: null, effort: null });
	assert.deepEqual(firstFrom({ line: "x", model: "anthropic/claude-opus-5", effort: "high" }), { line: "x", model: "anthropic/claude-opus-5", effort: "high" });
});

test("what was typed over several lines is sent as one", () => {
	assert.equal(firstFrom({ line: "  add sign-in\n\nwith email,\tand a way out " })?.line, "add sign-in with email, and a way out");
});

test("nothing to build is not a first message, and neither is anything that is not a line", () => {
	for (const value of [null, undefined, "add sign-in", {}, { line: "" }, { line: " \n " }, { line: 3 }, { line: "x".repeat(4001) }]) assert.equal(firstFrom(value), null);
});

test("a model or an effort that is not shaped like one is left out rather than passed on", () => {
	assert.deepEqual(firstFrom({ line: "x", model: "opus", effort: "very high" }), { line: "x", model: null, effort: null });
	assert.deepEqual(firstFrom({ line: "x", model: "a/b c", effort: 3 }), { line: "x", model: null, effort: null });
});

test("a first message is taken once, by the workspace it was kept for", () => {
	const waiting = firsts();
	const first = firstFrom({ line: "x" });
	waiting.keep("/w/tokyo", first);
	assert.equal(waiting.take("/w/lima"), null);
	assert.deepEqual(waiting.take("/w/tokyo"), first);
	assert.equal(waiting.take("/w/tokyo"), null, "a page loaded again does not start the spec twice");
});

test("a page asks for its own workspace by its folder, so one still up while the window moves on cannot take the next workspace's line", () => {
	const waiting = firsts();
	waiting.keep("/w/lima", firstFrom({ line: "y" }));
	assert.equal(waiting.take("/w/tokyo"), null, "the page of tokyo, asking while lima is where the window is going, gets nothing");
	assert.deepEqual(waiting.take("/w/lima"), { line: "y", model: null, effort: null });
});
