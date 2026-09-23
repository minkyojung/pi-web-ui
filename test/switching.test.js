import assert from "node:assert/strict";
import test from "node:test";

import { switchLine } from "../electron/switching.js";

const shell = { asked: 1000, server: 1612, answered: 1615, loaded: 1695 };

test("a switch is one line: the shell's steps, the page's steps, and the whole from the click to the paint", () => {
	const page = { origin: 1620, socket: 90, state: 104, painted: 120 };
	assert.equal(switchLine({ from: "/w/lima", to: "/w/oslo", shell, page }), "[switch] lima → oslo: spawned 612ms, answered 3ms, page 80ms, socket 90ms, state 14ms, painted 16ms — 740ms from the click to painted");
});

test("a page that never reported still leaves the shell's half, and says so", () => {
	assert.equal(switchLine({ from: "/w/lima", to: "/w/oslo", shell, page: null }), "[switch] lima → oslo: spawned 612ms, answered 3ms, page 80ms — 695ms from the click to loaded (the page did not report)");
});

test("the first workspace of a run comes from the start screen, and a switch cut short has only the steps it reached", () => {
	assert.equal(switchLine({ from: null, to: "/w/oslo", shell: { asked: 0, server: 500 }, page: null }), "[switch] start → oslo: spawned 500ms (the page did not report)");
	const page = { origin: 1620, socket: 90 };
	assert.equal(switchLine({ from: "/w/lima", to: "/w/oslo", shell, page }), "[switch] lima → oslo: spawned 612ms, answered 3ms, page 80ms, socket 90ms — 710ms from the click to socket");
});

test("a step that ran backwards reads as nothing rather than as a negative number", () => {
	assert.equal(switchLine({ from: "/a", to: "/b", shell: { asked: 10, server: 5 }, page: null }), "[switch] a → b: spawned 0ms (the page did not report)");
});
