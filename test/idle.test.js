import assert from "node:assert/strict";
import test from "node:test";

import { idleFolders } from "../idle.ts";

test("what is let go of for being idle: not one a tab is on, not one mid-turn, and not one looked at lately", () => {
	const minute = 60_000;
	const folders = new Map([
		["/front", { busy: false, watched: 1, since: 0 }],
		["/running", { busy: true, watched: 0, since: 0 }],
		["/recent", { busy: false, watched: 0, since: 55 * minute }],
		["/old", { busy: false, watched: 0, since: 20 * minute }],
		["/warmed-and-left", { busy: false, watched: 0, since: 0 }],
	]);
	assert.deepEqual(idleFolders(folders, { now: 60 * minute, idleMs: 30 * minute }), ["/old", "/warmed-and-left"]);
	assert.deepEqual(idleFolders(folders, { now: 60 * minute, idleMs: 61 * minute }), [], "nothing is old enough yet");
	assert.deepEqual(idleFolders([], { now: 0, idleMs: 1 }), []);
});
