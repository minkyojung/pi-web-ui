import assert from "node:assert/strict";
import test from "node:test";

import { describeContext } from "../web/src/contextGauge.ts";

const ctx = (percent, tokens = Math.round((272000 * percent) / 100)) => ({ tokens, window: 272000, percent });

test("no usage, or no estimate after a compaction, is shown as unknown rather than empty", () => {
	assert.deepEqual(describeContext(undefined), { fraction: 0, tone: "unknown", label: "Context usage unknown" });
	assert.deepEqual(describeContext(null), { fraction: 0, tone: "unknown", label: "Context usage unknown" });
	assert.equal(describeContext({ tokens: null, window: 272000, percent: null }).tone, "unknown");
});

test("under ten percent keeps one decimal, above it rounds", () => {
	assert.equal(describeContext(ctx(1.26)).label, "Context 1.3% · 3k / 272k");
	assert.equal(describeContext(ctx(45.6)).label, "Context 46% · 124k / 272k");
});

test("the ring fills proportionally and clamps", () => {
	assert.equal(describeContext(ctx(25)).fraction, 0.25);
	assert.equal(describeContext(ctx(100)).fraction, 1);
	assert.equal(describeContext(ctx(140)).fraction, 1);
});

test("amber from seventy, red from ninety", () => {
	assert.equal(describeContext(ctx(69.9)).tone, "ok");
	assert.equal(describeContext(ctx(70)).tone, "warn");
	assert.equal(describeContext(ctx(89.9)).tone, "warn");
	assert.equal(describeContext(ctx(90)).tone, "danger");
});

test("small numbers are not turned into 0k", () => {
	assert.equal(describeContext({ tokens: 512, window: 8000, percent: 6.4 }).label, "Context 6.4% · 512 / 8k");
});
