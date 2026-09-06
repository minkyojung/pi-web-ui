import assert from "node:assert/strict";
import test from "node:test";

import { activeModeId, describeMode, modeToolNames } from "../web/src/toolModes.ts";

/** What a mac session actually offers: pi's built-ins minus powershell, plus an extension tool. */
const MAC = ["read", "bash", "edit", "write", "grep", "find", "ls", "ask_user"];

test("each rung grants everything below it and names what is still out of reach", () => {
	assert.deepEqual(describeMode("read-only").can, ["Read, search and list files"]);
	assert.deepEqual(describeMode("read-only").cannot, ["Edit and create files", "Run shell commands"]);
	assert.deepEqual(describeMode("coding").can, ["Read, search and list files", "Edit and create files"]);
	assert.deepEqual(describeMode("coding").cannot, ["Run shell commands"]);
	assert.deepEqual(describeMode("full").cannot, []);
});

test("the ladder is strict supersets", () => {
	const readOnly = describeMode("read-only").tools;
	const coding = describeMode("coding").tools;
	const full = describeMode("full").tools;
	assert.ok(readOnly.every((t) => coding.includes(t)));
	assert.ok(coding.every((t) => full.includes(t)));
	assert.ok(coding.length > readOnly.length && full.length > coding.length);
});

test("a mode only turns on tools the session has", () => {
	// powershell is in the Full rung but not on this machine, and must not be sent.
	assert.deepEqual(modeToolNames("full", MAC), MAC);
	assert.deepEqual(modeToolNames("read-only", MAC), ["read", "grep", "find", "ls", "ask_user"]);
	assert.deepEqual(modeToolNames("coding", MAC), ["read", "edit", "write", "grep", "find", "ls", "ask_user"]);
});

test("extension tools stay on in every mode, including read-only", () => {
	for (const id of ["read-only", "coding", "full"]) {
		assert.ok(modeToolNames(id, MAC).includes("ask_user"), `${id} dropped ask_user`);
	}
});

test("what a mode turns on reads back as that mode", () => {
	for (const id of ["read-only", "coding", "full"]) {
		assert.equal(activeModeId(modeToolNames(id, MAC), MAC), id);
	}
});

test("Full still matches on a machine without powershell", () => {
	// The regression the intersection exists for: comparing against the literal
	// rung list would leave the button stuck on Custom forever.
	assert.equal(activeModeId(MAC, MAC), "full");
});

test("anything off the ladder is Custom", () => {
	assert.equal(activeModeId(["read", "bash"], MAC), null);
	assert.equal(activeModeId([], MAC), null);
	assert.equal(activeModeId(["read", "grep", "find"], MAC), null);
});

test("toggling an extension tool by hand does not rename the mode", () => {
	assert.equal(activeModeId(["read", "grep", "find", "ls"], MAC), "read-only");
	assert.equal(activeModeId(["read", "grep", "find", "ls", "ask_user"], MAC), "read-only");
});
