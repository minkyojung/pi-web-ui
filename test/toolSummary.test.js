import assert from "node:assert/strict";
import test from "node:test";

import { toolDetail } from "../web/src/toolSummary.ts";

test("each built-in tool says what it touched", () => {
	assert.equal(toolDetail("read", { path: "web/src/components/Item.tsx" }), "components/Item.tsx");
	assert.equal(toolDetail("write", { path: "notes.md", content: "…" }), "notes.md");
	assert.equal(toolDetail("ls", { path: "web/src" }), "web/src");
	assert.equal(toolDetail("find", { pattern: "**/*.ts" }), "**/*.ts");
	assert.equal(toolDetail("grep", { pattern: "applyEvent" }), '"applyEvent"');
	assert.equal(toolDetail("bash", { command: "npm test" }), "npm test");
	assert.equal(toolDetail("powershell", { command: "Get-ChildItem" }), "Get-ChildItem");
	assert.equal(toolDetail("set_gist", { id: 12, gist: "…" }), "#12");
});

test("a path is shortened to its last two segments, and a short one is left alone", () => {
	assert.equal(toolDetail("read", { path: "/Users/w/code/pi/web/src/store.ts" }), "src/store.ts");
	assert.equal(toolDetail("read", { path: "server.ts" }), "server.ts");
	assert.equal(toolDetail("read", { path: "web/src" }), "web/src");
	// pi runs on Windows too, where the same argument arrives with backslashes.
	assert.equal(toolDetail("read", { path: "C:\\code\\pi\\web\\src\\store.ts" }), "src/store.ts");
});

test("ls without a path says where it actually looked", () => {
	assert.equal(toolDetail("ls", {}), ".");
});

test("edit counts its replacements only when there is more than one", () => {
	const edit = (n) => ({ path: "web/src/store.ts", edits: Array.from({ length: n }, () => ({ oldText: "a", newText: "b" })) });
	assert.equal(toolDetail("edit", edit(1)), "src/store.ts");
	assert.equal(toolDetail("edit", edit(3)), "src/store.ts · 3 edits");
});

test("a detail is one line, however the command was written", () => {
	// Not cut to a length: the row truncates to whatever width it has, and a cap
	// here would shorten a line that had room for the rest of itself.
	const long = toolDetail("bash", { command: `echo ${"x".repeat(200)}` });
	assert.equal(long.length, "echo ".length + 200);
	assert.equal(toolDetail("bash", { command: "npm test\n\n  && npm run build" }), "npm test && npm run build");
});

test("a tool with no rule is left as it is", () => {
	assert.equal(toolDetail("ask_user", { question: "which?" }), null);
	assert.equal(toolDetail(undefined, { path: "a.ts" }), null);
});

test("arguments that are not what the schema says fall back rather than throw", () => {
	for (const args of [undefined, null, "a string", 42, [], { path: 12 }, { path: "" }, { path: "   " }]) {
		assert.equal(toolDetail("read", args), null, `read ${JSON.stringify(args)}`);
	}
	assert.equal(toolDetail("grep", { pattern: null }), null);
	assert.equal(toolDetail("bash", {}), null);
	assert.equal(toolDetail("set_gist", { id: "12" }), null);
	// A path that is missing sinks the whole header, even when the rest is fine.
	assert.equal(toolDetail("edit", { edits: [{ oldText: "a", newText: "b" }] }), null);
});
