import assert from "node:assert/strict";
import test from "node:test";

import { checkLogPath } from "../web/src/checkLog.ts";

test("a check's log is under the task's number, named as spec.ts names it", () => {
	assert.equal(checkLogPath("3", "unit"), ".pi/runs/3/unit.log");
	assert.equal(checkLogPath("2.1", "npm test -- greet"), ".pi/runs/2.1/npm_test_--_greet.log");
});
