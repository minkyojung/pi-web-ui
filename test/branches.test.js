import assert from "node:assert/strict";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { branchPoints } from "../branches.ts";

/**
 * Sessions built with pi's own SessionManager rather than by hand.
 *
 * A branch is not an event — it is the shape of a file — so no recording can
 * show one. What can is pi's own writer: `appendMessage` grows the current
 * branch, `branch` moves the leaf back so the next message starts another.
 */
const said = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const replied = (text) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 2 });

function session() {
	return SessionManager.inMemory("/tmp");
}

/**
 * Put the leaf back to just before a message, so the next one asked is a
 * sibling of it rather than a reply to it. This is what navigateTree does to a
 * user message, including its split: the first message of a session has no
 * parent to go back to, so the leaf is reset instead.
 */
function reask(s, entryId) {
	const parent = s.getEntry(entryId).parentId;
	if (parent === null) s.resetLeaf();
	else s.branch(parent);
}

test("a conversation that never forked has no alternatives", () => {
	const s = session();
	s.appendMessage(said("one"));
	s.appendMessage(replied("first"));
	s.appendMessage(said("two"));
	s.appendMessage(replied("second"));
	assert.deepEqual(branchPoints(s), []);
});

test("asking the same thing again puts the second answer beside the first", () => {
	const s = session();
	const first = s.appendMessage(said("fix this"));
	s.appendMessage(replied("A"));

	// Ask it differently: the leaf goes back to before the question, so the new
	// question is a sibling of the old one rather than a reply to it.
	reask(s, first);
	s.appendMessage(said("fix this, but shorter"));
	const secondReply = s.appendMessage(replied("B"));

	const [point] = branchPoints(s);
	assert.equal(point.total, 2);
	// The path being shown is the second branch, so that is where we are.
	assert.equal(point.index, 1);
	// Going back means the end of the first branch, not its beginning: an arrow
	// means show me that one, and its beginning is a question, not an answer.
	assert.equal(point.targets[1], secondReply);
	assert.notEqual(point.targets[0], point.entryId);
	assert.equal(s.getEntry(point.targets[0]).message.content[0].text, "A");
});

test("a fork deeper in the conversation only marks the message that forked", () => {
	const s = session();
	s.appendMessage(said("one"));
	s.appendMessage(replied("first"));
	const second = s.appendMessage(said("two"));
	s.appendMessage(replied("A"));

	reask(s, second);
	s.appendMessage(said("two, differently"));
	s.appendMessage(replied("B"));

	const points = branchPoints(s);
	// The first question was asked once and has nothing to offer.
	assert.equal(points.length, 1);
	assert.equal(s.getEntry(points[0].entryId).message.content[0].text, "two, differently");
});

test("three ways of asking the same thing are all offered, in the order they were asked", () => {
	const s = session();
	const first = s.appendMessage(said("v1"));
	s.appendMessage(replied("A"));
	for (const text of ["v2", "v3"]) {
		reask(s, first);
		s.appendMessage(said(text));
		s.appendMessage(replied(text.toUpperCase()));
	}

	const [point] = branchPoints(s);
	assert.equal(point.total, 3);
	assert.equal(point.index, 2);
	assert.deepEqual(
		point.targets.map((id) => s.getEntry(id).message.content[0].text),
		["A", "V2", "V3"],
	);
});

test("a branch that was started and never answered points at itself", () => {
	const s = session();
	const first = s.appendMessage(said("v1"));
	s.appendMessage(replied("A"));
	reask(s, first);
	const abandoned = s.appendMessage(said("v2"));

	const [point] = branchPoints(s);
	assert.equal(point.targets[1], abandoned);
});

test("only the ways of asking count, not what came back", () => {
	const s = session();
	const first = s.appendMessage(said("v1"));
	// Two replies to the same question, which is not two ways of asking it.
	s.appendMessage(replied("A"));
	s.branch(first);
	s.appendMessage(replied("B"));

	assert.deepEqual(branchPoints(s), []);
});
