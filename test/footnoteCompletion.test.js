import assert from "node:assert/strict";
import test from "node:test";

import { nextId } from "../web/src/features/footnoteCompletion.ts";

test("a new footnote takes the smallest number not yet used, whatever the others are called", () => {
	assert.equal(nextId([]), "1");
	assert.equal(nextId(["1", "2"]), "3");
	assert.equal(nextId(["note", "2"]), "1");
	assert.equal(nextId(["1", "3"]), "2");
});
