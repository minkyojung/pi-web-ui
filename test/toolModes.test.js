import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MODE, activeModeId, describeMode, isWebOn, modeToolNames, withWeb } from "../toolModes.ts";

/** What a mac session actually offers: pi's built-ins minus powershell, plus an extension tool. */
const MAC = ["read", "bash", "edit", "write", "grep", "find", "ls", "ask_user"];

test("each rung grants everything below it and names what is still out of reach", () => {
	assert.deepEqual(describeMode("plan").can, ["Read, search and list files"]);
	assert.deepEqual(describeMode("plan").cannot, ["Edit and create files", "Run shell commands"]);
	assert.deepEqual(describeMode("coding").can, ["Read, search and list files", "Edit and create files"]);
	assert.deepEqual(describeMode("coding").cannot, ["Run shell commands"]);
	assert.deepEqual(describeMode("full").cannot, []);
});

test("the ladder is strict supersets", () => {
	const plan = describeMode("plan").tools;
	const coding = describeMode("coding").tools;
	const full = describeMode("full").tools;
	assert.ok(plan.every((t) => coding.includes(t)));
	assert.ok(coding.every((t) => full.includes(t)));
	assert.ok(coding.length > plan.length && full.length > coding.length);
});

test("a mode only turns on tools the session has", () => {
	// powershell is in the Full rung but not on this machine, and must not be sent.
	assert.deepEqual(modeToolNames("full", MAC), MAC);
	assert.deepEqual(modeToolNames("plan", MAC), ["read", "grep", "find", "ls", "ask_user"]);
	assert.deepEqual(modeToolNames("coding", MAC), ["read", "edit", "write", "grep", "find", "ls", "ask_user"]);
});

test("extension tools stay on in every mode, including Plan", () => {
	for (const id of ["plan", "coding", "full"]) {
		assert.ok(modeToolNames(id, MAC).includes("ask_user"), `${id} dropped ask_user`);
	}
});

test("what a mode turns on reads back as that mode", () => {
	for (const id of ["plan", "coding", "full"]) {
		assert.equal(activeModeId(modeToolNames(id, MAC), MAC), id);
	}
});

test("Full access is every tool the session has — there is no rung above it", () => {
	assert.deepEqual(modeToolNames("full", MAC).slice().sort(), MAC.slice().sort());
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
	assert.equal(activeModeId(["read", "grep", "find", "ls"], MAC), "plan");
	assert.equal(activeModeId(["read", "grep", "find", "ls", "ask_user"], MAC), "plan");
});

/** The same session, once the note tools are registered. */
const WITH_NOTES = ["read", "bash", "edit", "write", "note_edit", "note_write", "note_properties", "grep", "find", "ls", "ask_user"];

test("notes are written on the Coding rung, so Plan cannot rewrite one", () => {
	assert.deepEqual(modeToolNames("plan", WITH_NOTES), ["read", "grep", "find", "ls", "ask_user"]);
	assert.ok(modeToolNames("coding", WITH_NOTES).includes("note_edit"));
	assert.ok(modeToolNames("coding", WITH_NOTES).includes("note_write"));
	assert.ok(modeToolNames("coding", WITH_NOTES).includes("note_properties"), "a note's properties are a note's");
	assert.deepEqual(modeToolNames("full", WITH_NOTES), WITH_NOTES);
});

test("a mode with the note tools on still reads back as that mode", () => {
	for (const id of ["plan", "coding", "full"]) {
		assert.equal(activeModeId(modeToolNames(id, WITH_NOTES), WITH_NOTES), id);
	}
});

test("새 세션은 셸이 닫힌 채로 시작한다 — pi는 실행 전에 묻지 않으므로", () => {
	assert.equal(DEFAULT_MODE, "coding");
	assert.ok(!describeMode(DEFAULT_MODE).tools.includes("bash"));
	assert.ok(describeMode(DEFAULT_MODE).tools.includes("note_edit"));
});

/** A session with the web extension loaded, which is every session that has it. */
const WITH_WEB = [...WITH_NOTES, "web_search", "fetch_content", "source_check", "get_search_content"];

test("웹은 칸이 아니라 스위치다 — 모드는 셋 다 웹을 켠 채로 온다", () => {
	for (const id of ["plan", "coding", "full"]) {
		assert.ok(isWebOn(modeToolNames(id, WITH_WEB)), `${id} came without the web`);
	}
});

test("웹을 끄면 네 개가 함께 꺼지고, 나머지는 그대로다", () => {
	const off = withWeb(modeToolNames("coding", WITH_WEB), WITH_WEB, false);
	assert.equal(isWebOn(off), false);
	assert.deepEqual(off, modeToolNames("coding", WITH_NOTES));
	assert.deepEqual(withWeb(off, WITH_WEB, true).slice().sort(), modeToolNames("coding", WITH_WEB).slice().sort());
});

test("모드를 바꿔도 스위치는 그 자리에 있다 — 확장 도구를 다 켜는 modeToolNames 위에서도", () => {
	const off = withWeb(modeToolNames("coding", WITH_WEB), WITH_WEB, false);
	const stillOff = withWeb(modeToolNames("full", WITH_WEB), WITH_WEB, isWebOn(off));
	assert.equal(isWebOn(stillOff), false);
	assert.ok(stillOff.includes("bash"), "the rung still changed");
	assert.ok(stillOff.includes("ask_user"), "ask_user is not the web's to take");
});

test("웹을 껐다고 모드 이름이 Custom이 되지는 않는다", () => {
	const off = withWeb(modeToolNames("plan", WITH_WEB), WITH_WEB, false);
	assert.equal(activeModeId(off, WITH_WEB), "plan");
});

test("넷 중 하나만 켜져 있어도 스위치는 켜진 것이다", () => {
	assert.equal(isWebOn(["read", "source_check"]), true);
	assert.equal(isWebOn(["read", "ask_user"]), false);
});

test("웹 도구가 없는 세션에서는 스위치를 켜도 켤 것이 없다", () => {
	assert.deepEqual(withWeb(modeToolNames("plan", MAC), MAC, true), modeToolNames("plan", MAC));
});
