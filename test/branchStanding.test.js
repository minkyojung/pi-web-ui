import assert from "node:assert/strict";
import test from "node:test";

import { standingOf } from "../web/src/branchStanding.ts";

const git = (over = {}) => ({ branch: "me/x", base: "main", changes: 0, ahead: 0, behind: 0, ...over });
const pr = (over = {}) => ({ state: "open", number: 29, url: "https://github.com/o/r/pull/29", review: "", checks: { total: 2, pending: 0, failed: 0 }, ...over });

test("no repository, or a fresh branch with nothing on it and no pull request, says nothing", () => {
	assert.equal(standingOf(null, undefined), null);
	assert.equal(standingOf(git(), { state: "local" }), null);
	assert.equal(standingOf(git(), { state: "pushed" }), null);
});

test("before a pull request: changes, then commits not pushed, then pushed — one at a time", () => {
	assert.equal(standingOf(git({ changes: 3 }), { state: "local" }).text, "3 changes");
	assert.equal(standingOf(git({ changes: 1, ahead: 2 }), { state: "local" }).text, "1 change", "changes first: they are what to do next");
	assert.equal(standingOf(git({ ahead: 2 }), { state: "local" }).text, "↑ 2 not pushed");
	assert.equal(standingOf(git({ ahead: 2 }), { state: "pushed" }).text, "↑ 2 pushed");
	assert.equal(standingOf(git({ ahead: 2 }), undefined).text, "↑ 2 not pushed", "no word from the shell reads as not pushed");
});

test("a pull request: the chip, and what its checks and reviews come to", () => {
	const open = standingOf(git(), pr());
	assert.deepEqual(open.chip, { number: 29, url: "https://github.com/o/r/pull/29" });
	assert.equal(open.text, "checks passed");
	assert.equal(standingOf(git(), pr({ checks: { total: 2, pending: 1, failed: 0 } })).text, "1 check pending…");
	const failed = standingOf(git(), pr({ checks: { total: 2, pending: 0, failed: 1 } }));
	assert.equal(failed.text, "✗ 1 check failed");
	assert.equal(failed.tone, "destructive");
	assert.equal(standingOf(git(), pr({ review: "APPROVED" })).text, "approved");
	const changes = standingOf(git(), pr({ review: "CHANGES_REQUESTED", checks: { total: 2, pending: 1, failed: 0 } }));
	assert.equal(changes.text, "changes requested", "a person's word outranks a machine's");
	assert.equal(changes.tone, "destructive");
	assert.equal(standingOf(git(), pr({ checks: { total: 0, pending: 0, failed: 0 } })).text, "open");
	assert.equal(standingOf(git(), pr({ draft: true, checks: undefined })).text, "draft");
	assert.equal(standingOf(git(), pr({ state: "merged" })).text, "merged");
	assert.equal(standingOf(git(), pr({ state: "closed" })).text, "closed");
});

test("the base having moved on is said after the item, and alone when there is nothing else", () => {
	assert.equal(standingOf(git({ behind: 5 }), pr()).text, "checks passed · 5 behind");
	assert.equal(standingOf(git({ changes: 2, behind: 1 }), { state: "local" }).text, "2 changes · 1 behind");
	assert.equal(standingOf(git({ behind: 5 }), { state: "local" }).text, "5 behind");
	assert.equal(standingOf(git({ behind: 5 }), pr({ state: "merged" })).text, "merged", "not for a branch that is done");
});
