import assert from "node:assert/strict";
import test from "node:test";

import { orderedBy, spent } from "../web/src/repoOrder.ts";

const of = (...paths) => paths.map((path) => ({ path }));

test("the list is drawn in the order that was dropped on it, until one in that order arrives", () => {
	const projects = of("/a", "/b", "/c");
	assert.deepEqual(orderedBy(projects, ["/c", "/a", "/b"]), of("/c", "/a", "/b"));
	assert.equal(orderedBy(projects, null), projects, "nothing held, the list as it came");
	assert.deepEqual(orderedBy(projects, ["/b"]), of("/b", "/a", "/c"), "the ones it does not name follow, in their own order");
	assert.deepEqual(orderedBy(of("/a", "/b", "/new"), ["/b", "/a"]), of("/b", "/a", "/new"), "a repository added since the drag stays at the end");
});

test("an order is spent by the list it asked for, and by news it did not have", () => {
	assert.equal(spent(["/b", "/a"], ["/b", "/a"]), true, "the shell now says the same thing");
	assert.equal(spent(["/a", "/b"], ["/b", "/a"]), false, "the old order is still arriving");
	assert.equal(spent(["/a", "/b", "/new"], ["/b", "/a"]), true, "a repository it never knew about");
	assert.equal(spent(["/b"], ["/b", "/a"]), true, "one it knew about is gone");
});
