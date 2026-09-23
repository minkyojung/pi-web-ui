import assert from "node:assert/strict";
import test from "node:test";

import { HIGH, LOW, acked, idle, sent } from "../pty/flow.ts";

test("the pty is paused once past HIGH, not before, and not twice", () => {
	let { flow, pause } = sent(idle, HIGH);
	assert.equal(pause, false, "at the mark is not past it");
	({ flow, pause } = sent(flow, 1));
	assert.equal(pause, true);
	assert.equal(flow.paused, true);
	({ flow, pause } = sent(flow, 10_000));
	assert.equal(pause, false, "already paused: nothing more to say");
	assert.equal(flow.unacked, HIGH + 1 + 10_000, "what is sent while paused is still counted");
});

test("a paused pty is resumed once under LOW, not in the gap between, and not twice", () => {
	let { flow } = sent(idle, HIGH + 1);
	let resume;
	({ flow, resume } = acked(flow, HIGH + 1 - LOW));
	assert.equal(resume, false, "at LOW is not under it");
	assert.equal(flow.paused, true);
	({ flow, resume } = acked(flow, 1));
	assert.equal(resume, true);
	assert.equal(flow.paused, false);
	({ flow, resume } = acked(flow, 1));
	assert.equal(resume, false, "already resumed");
});

test("acks never take the count below nothing, and a pty never paused is never resumed", () => {
	const { flow, resume } = acked(sent(idle, 10).flow, 1000);
	assert.equal(flow.unacked, 0);
	assert.equal(resume, false);
	assert.equal(flow.paused, false);
});

test("a burst under HIGH, drawn as it comes, pauses nothing", () => {
	let flow = idle;
	for (let i = 0; i < 100; i++) {
		const s = sent(flow, 4096);
		assert.equal(s.pause, false);
		flow = acked(s.flow, 4096).flow;
	}
	assert.deepEqual(flow, idle);
});
