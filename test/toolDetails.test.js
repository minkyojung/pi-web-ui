import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyEvent, createConversation, itemsFromMessages } from "../conversation.js";
import { detailNotes, diffStat } from "../web/src/toolDetails.ts";

/**
 * A recording of a run that edits a file and truncates a command's output.
 * turn-with-tools has neither, so nothing there carries details at all.
 */
const EVENTS = JSON.parse(readFileSync(new URL("fixtures/tool-details.json", import.meta.url), "utf8"));

function live(events) {
	const state = createConversation();
	for (const event of events) applyEvent(state, event);
	return state.items;
}

const resumed = (events) => itemsFromMessages(events.findLast((e) => e.type === "agent_end").messages);

const tools = (items) => items.filter((item) => item.kind === "tool");

test("an edit carries the diff pi computed for it", () => {
	const edit = tools(live(EVENTS)).find((item) => item.name === "edit");
	assert.ok(edit, "the recording should contain an edit");
	// pi's display diff: a line number per line, changed ones marked.
	assert.match(edit.details.diff, /^-\s*3 The alpha stage/m);
	assert.match(edit.details.diff, /^\+\s*3 The beta stage/m);
	// The unified patch says the same thing a second time, and is not kept.
	assert.equal(edit.details.patch, undefined);
});

test("a truncated command says how much is missing and where the rest went", () => {
	const bash = tools(live(EVENTS)).find((item) => item.name === "bash");
	assert.equal(bash.details.omittedLines, 3000);
	assert.match(bash.details.fullOutputPath, /pi-bash-.*\.log$/);
});

test("the copy of the output inside pi's details is not carried", () => {
	const bash = tools(live(EVENTS)).find((item) => item.name === "bash");
	// pi repeats the kept output inside details.truncation.content — ten
	// kilobytes next to the twelve the result already has — and every snapshot
	// would carry it again.
	assert.deepEqual(Object.keys(bash.details).sort(), ["fullOutputPath", "omittedLines"]);
	assert.ok(JSON.stringify(bash.details).length < 200);
});

test("live and resumed carry the same details", () => {
	assert.deepEqual(
		tools(resumed(EVENTS)).map((item) => item.details),
		tools(live(EVENTS)).map((item) => item.details),
	);
});

test("a result with nothing to add carries nothing", () => {
	const turn = JSON.parse(readFileSync(new URL("fixtures/turn-with-tools.json", import.meta.url), "utf8"));
	for (const item of tools(live(turn))) assert.equal(item.details, undefined, item.name);
	for (const item of tools(resumed(turn))) assert.equal(item.details, undefined, item.name);
});

test("a shape that is not what it should be is dropped, not guessed at", () => {
	const end = (details) => [
		{ type: "tool_execution_start", toolCallId: "t1", toolName: "grep", args: {} },
		{ type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "x" }], details }, isError: false },
	];
	for (const details of [undefined, null, "a string", 42, {}, { diff: "" }, { diff: 12 }, { truncation: {} }]) {
		assert.equal(live(end(details))[0].details, undefined, JSON.stringify(details));
	}
	// Truncation that kept everything is not truncation.
	assert.equal(live(end({ truncation: { truncated: false, totalLines: 10, outputLines: 10 } }))[0].details, undefined);
});

test("the three tools that stop at a limit all say so the same way", () => {
	const end = (name, details) => [
		{ type: "tool_execution_start", toolCallId: "t1", toolName: name, args: {} },
		{ type: "tool_execution_end", toolCallId: "t1", result: { content: [], details }, isError: false },
	];
	assert.equal(live(end("grep", { matchLimitReached: 100 }))[0].details.limit, 100);
	assert.equal(live(end("ls", { entryLimitReached: 500 }))[0].details.limit, 500);
	assert.equal(live(end("find", { resultLimitReached: 1000 }))[0].details.limit, 1000);
});

// ---------------------------------------------------------------------------
// What the row makes of them.

test("an edit is counted off the diff pi wrote", () => {
	const edit = tools(live(EVENTS)).find((item) => item.name === "edit");
	// The recorded edit rewrites one line: one out, one in.
	assert.deepEqual(diffStat(edit.details.diff), { added: 1, removed: 1 });
});

test("counting a diff counts its marks, not its context", () => {
	const diff = [" 1 kept", "-2 gone", "-3 gone too", "+2 new", " 4 kept"].join("\n");
	assert.deepEqual(diffStat(diff), { added: 1, removed: 2 });
	assert.deepEqual(diffStat(""), { added: 0, removed: 0 });
});

test("a row says what it is not showing", () => {
	const bash = tools(live(EVENTS)).find((item) => item.name === "bash");
	assert.deepEqual(detailNotes(bash.details), ["3,000 more lines"]);
	assert.deepEqual(detailNotes({ limit: 100 }), ["limit 100"]);
	// A search can both stop at its limit and be cut short; it says both.
	assert.deepEqual(detailNotes({ omittedLines: 12, limit: 100 }), ["12 more lines", "limit 100"]);
	assert.deepEqual(detailNotes(undefined), []);
	assert.deepEqual(detailNotes({ diff: "x" }), []);
});
