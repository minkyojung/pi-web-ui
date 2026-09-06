import assert from "node:assert/strict";
import test from "node:test";

import { breakdown, compact, tokensOf } from "../web/src/contextBreakdown.ts";

const sources = {
	type: "context_sources",
	systemPromptChars: 8000, // ≈ 2000 tokens
	tools: [
		{ name: "read", chars: 400, active: true },
		{ name: "bash", chars: 400, active: true },
		{ name: "grep", chars: 4000, active: false }, // inactive: not sent to the model
	],
	skills: 4,
	memoryFiles: { count: 1, chars: 2000 }, // ≈ 500 tokens
	login: { oauth: false, subscription: false },
};

test("nothing to show until pi has counted", () => {
	assert.equal(breakdown(undefined, sources), null);
	assert.equal(breakdown({ tokens: null, window: 272000, percent: null }, sources), null);
});

test("fixed parts are estimated at four characters a token, and only active tools count", () => {
	const b = breakdown({ tokens: 10000, window: 100000, percent: 10 }, sources);
	const byLabel = Object.fromEntries(b.rows.map((r) => [r.label, r]));
	assert.equal(byLabel["System prompt"].tokens, 2000);
	assert.equal(byLabel["Tools (2 active)"].tokens, 200);
	assert.equal(byLabel["Memory files (1)"].tokens, 500);
	assert.equal(byLabel["Skills (4)"].tokens, 0);
	assert.ok(byLabel["System prompt"].estimated);
});

test("messages are what is left, as a real count, with percentages of the window", () => {
	const b = breakdown({ tokens: 10000, window: 100000, percent: 10 }, sources);
	const messages = b.rows.find((r) => r.label === "Messages");
	assert.equal(messages.tokens, 10000 - 2000 - 200 - 500);
	assert.equal(messages.estimated, false);
	assert.equal(messages.percent, 7.3);
	assert.equal(b.free, 90);
});

test("right after a compaction the remainder cannot go negative", () => {
	const b = breakdown({ tokens: 1500, window: 100000, percent: 1.5 }, sources);
	assert.equal(b.rows.find((r) => r.label === "Messages").tokens, 0);
});

test("without sources the whole count is messages", () => {
	const b = breakdown({ tokens: 4200, window: 100000, percent: 4.2 }, null);
	assert.deepEqual(
		b.rows.map((r) => [r.label, r.tokens]),
		[["Messages", 4200]],
	);
});

test("compact numbers", () => {
	assert.equal(tokensOf(7107), 1777);
	assert.equal(compact(512), "512");
	assert.equal(compact(33400), "33.4k");
	assert.equal(compact(272000), "272k");
	assert.equal(compact(1000000), "1000k");
});
