import assert from "node:assert/strict";
import test from "node:test";

import { isRunLog, stuckToEnd } from "../web/src/logTail.ts";

test("at the end, or within a line of it, the view follows what arrives; scrolled up, it stays", () => {
	assert.equal(stuckToEnd({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }), true);
	assert.equal(stuckToEnd({ scrollTop: 897, clientHeight: 100, scrollHeight: 1000 }), true, "rounding is not a choice");
	assert.equal(stuckToEnd({ scrollTop: 500, clientHeight: 100, scrollHeight: 1000 }), false);
	assert.equal(stuckToEnd({ scrollTop: 0, clientHeight: 100, scrollHeight: 80 }), true, "nothing to scroll is the end");
});

test("a log the commands printed is one; the repository's own files are not", () => {
	assert.equal(isRunLog(".pi/runs/dev.log"), true);
	assert.equal(isRunLog(".pi/runs/3/unit.log"), true);
	assert.equal(isRunLog("src/runs/dev.log"), false);
	assert.equal(isRunLog(".pi/settings.json"), false);
});
