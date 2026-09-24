import assert from "node:assert/strict";
import test from "node:test";

import { pullRequestOf, workOf } from "../web/src/branchStanding.ts";

const git = (over = {}) => ({ branch: "me/x", base: "main", changes: 0, ahead: 0, behind: 0, remote: null, ...over });
const pr = (over = {}) => ({ state: "open", number: 29, url: "https://github.com/o/r/pull/29", review: "", checks: { total: 2, pending: 0, failed: 0 }, ...over });

test("no repository, or a branch with everything on origin, says nothing of the work", () => {
	assert.equal(workOf(null), null);
	assert.equal(workOf(git()), null);
	assert.equal(workOf(git({ ahead: 3, remote: { ahead: 0, behind: 0 } })), null, "pushed, every commit of it");
});

test("the work: files not committed, commits a push would send, commits a pull would bring — each beside the others", () => {
	assert.deepEqual(workOf(git({ changes: 5 })), { changes: 5, push: 0, pull: 0, published: false });
	assert.deepEqual(workOf(git({ changes: 1, ahead: 4, remote: { ahead: 1, behind: 2 } })), { changes: 1, push: 1, pull: 2, published: true }, "against origin's branch, not the base");
	assert.deepEqual(workOf(git({ ahead: 3 })), { changes: 0, push: 3, pull: 0, published: false }, "never pushed: every commit the base lacks");
});

test("with no origin at all, a commit is as far as work goes", () => {
	assert.equal(workOf(git({ base: null, ahead: null, behind: null })), null);
	assert.deepEqual(workOf(git({ base: null, ahead: null, behind: null, changes: 2 })), { changes: 2, push: 0, pull: 0, published: false });
});

test("the base having moved on is not the work's to say", () => {
	assert.equal(workOf(git({ behind: 5 })), null);
});

test("no pull request, however far the branch has got, is nothing for the pull request's item", () => {
	assert.equal(pullRequestOf(null, pr()), null);
	assert.equal(pullRequestOf(git({ ahead: 2 }), { state: "local" }), null);
	assert.equal(pullRequestOf(git({ ahead: 2, remote: { ahead: 0, behind: 0 } }), { state: "pushed" }), null);
	assert.equal(pullRequestOf(git({ changes: 3 }), undefined), null);
});

test("a pull request: the chip, and what its checks and reviews come to", () => {
	const open = pullRequestOf(git(), pr());
	assert.deepEqual(open.chip, { number: 29, url: "https://github.com/o/r/pull/29" });
	assert.equal(open.text, "checks passed");
	assert.equal(pullRequestOf(git(), pr({ checks: { total: 2, pending: 1, failed: 0 } })).text, "1 check pending…");
	const failed = pullRequestOf(git(), pr({ checks: { total: 2, pending: 0, failed: 1 } }));
	assert.equal(failed.text, "✗ 1 check failed");
	assert.equal(failed.tone, "destructive");
	assert.equal(pullRequestOf(git(), pr({ review: "APPROVED" })).text, "approved");
	const changes = pullRequestOf(git(), pr({ review: "CHANGES_REQUESTED", checks: { total: 2, pending: 1, failed: 0 } }));
	assert.equal(changes.text, "changes requested", "a person's word outranks a machine's");
	assert.equal(changes.tone, "destructive");
	assert.equal(pullRequestOf(git(), pr({ checks: { total: 0, pending: 0, failed: 0 } })).text, "open");
	assert.equal(pullRequestOf(git(), pr({ draft: true, checks: undefined })).text, "draft");
	assert.equal(pullRequestOf(git(), pr({ state: "merged" })).text, "merged");
	assert.equal(pullRequestOf(git(), pr({ state: "closed" })).text, "closed");
});

test("the base having moved on is said after an open pull request's item, and not for one that is done", () => {
	assert.equal(pullRequestOf(git({ behind: 5 }), pr()).text, "checks passed · 5 behind");
	assert.equal(pullRequestOf(git({ behind: 5 }), pr({ state: "merged" })).text, "merged");
});
