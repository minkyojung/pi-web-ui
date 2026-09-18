import assert from "node:assert/strict";
import test from "node:test";

import { alignmentsOf } from "../web/src/features/tables.ts";
import { numbering } from "../web/src/features/footnotes.ts";

test("a delimiter row says how each column sits", () => {
	assert.deepEqual(alignmentsOf("| --- | :-- | :-: | --: |"), [null, "left", "center", "right"]);
	assert.deepEqual(alignmentsOf("---|---"), [null, null]);
});

test("footnotes are numbered in the order they are first referred to; a note nobody refers to has no number", () => {
	const found = {
		refs: [{ id: "b", from: 0, to: 4 }, { id: "a", from: 10, to: 14 }, { id: "b", from: 20, to: 24 }],
		defs: [{ id: "a", from: 30, to: 35 }, { id: "b", from: 40, to: 45 }, { id: "c", from: 50, to: 55 }],
	};
	assert.deepEqual([...numbering(found)], [["b", 1], ["a", 2]]);
});
