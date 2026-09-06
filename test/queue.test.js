import assert from "node:assert/strict";
import test from "node:test";

import { appendRestored, clearedText, queuedInOrder } from "../web/src/queue.ts";

test("steering comes first, because that is the order pi delivers in", () => {
	const queued = { steering: ["stop"], followUp: ["then commit", "and push"] };
	assert.deepEqual(queuedInOrder(queued), [
		{ text: "stop", steer: true },
		{ text: "then commit", steer: false },
		{ text: "and push", steer: false },
	]);
});

test("no config yet is an empty list, not a crash", () => {
	assert.deepEqual(queuedInOrder(undefined), []);
	assert.deepEqual(queuedInOrder({ steering: [], followUp: [] }), []);
});

test("cleared messages come back as one block, in the same order", () => {
	assert.equal(clearedText({ steering: ["stop"], followUp: ["then commit"] }), "stop\n\nthen commit");
});

test("clearing an empty queue puts nothing in the box rather than blank lines", () => {
	assert.equal(clearedText({ steering: [], followUp: [] }), null);
	assert.equal(clearedText({ steering: ["  "], followUp: [""] }), null);
});

test("restoring does not throw away what is already typed", () => {
	assert.equal(appendRestored("half a thought", "stop"), "half a thought\n\nstop");
});

test("an empty box takes the restored text as it is", () => {
	assert.equal(appendRestored("", "stop"), "stop");
	assert.equal(appendRestored("   \n ", "stop"), "stop");
});
