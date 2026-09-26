import assert from "node:assert/strict";
import test from "node:test";

import { mergeStateOf, offersPullRequest, pullRequestOf, workOf } from "../web/src/branchStanding.ts";

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

const does = (view) => view.action ?? (view.running ? "running" : null);

/**
 * The table agreed on 2026-09-26, a row a state: what is at the foot of the
 * window for each, and nothing left to fall through to silence.
 */
const TABLE = [
	["files not committed", git({ changes: 1 }), pr({ merge: "CLEAN" }), "push", null],
	["a commit not pushed", git({ ahead: 3, remote: { ahead: 1, behind: 0 } }), pr({ merge: "CLEAN" }), "push", null],
	["conflicts (DIRTY)", git(), pr({ merge: "DIRTY" }), "resolve-conflicts", null],
	["the base to merge in first (BEHIND)", git({ behind: 3 }), pr({ merge: "BEHIND" }), "update-branch", null],
	["a check failed", git(), pr({ merge: "BLOCKED", checks: { total: 3, pending: 0, failed: 1 } }), "fix-checks", null],
	["a check failed that is not required (UNSTABLE)", git(), pr({ merge: "UNSTABLE", checks: { total: 3, pending: 0, failed: 1 } }), "fix-checks", null],
	["changes requested", git(), pr({ merge: "BLOCKED", review: "CHANGES_REQUESTED" }), "address-review", null],
	["checks running", git(), pr({ merge: "UNKNOWN", checks: { total: 3, pending: 2, failed: 0 } }), "running", null],
	["a draft (DRAFT)", git(), pr({ merge: "DRAFT", draft: true }), "ready", null],
	["waiting on a review (BLOCKED)", git(), pr({ merge: "BLOCKED", review: "REVIEW_REQUIRED" }), null, null],
	["blocked by another rule (BLOCKED)", git(), pr({ merge: "BLOCKED" }), null, "Blocked by a rule of the repository's"],
	["not worked out yet (UNKNOWN)", git(), pr({ merge: "UNKNOWN" }), null, null],
	["a word GitHub has not said before", git(), pr({ merge: "QUEUED" }), null, null],
	["nothing said", git(), pr({ merge: undefined }), null, null],
	["can be merged (CLEAN)", git(), pr({ merge: "CLEAN" }), "merge", null],
	["can be merged, with hooks (HAS_HOOKS)", git(), pr({ merge: "HAS_HOOKS" }), "merge", null],
	["UNSTABLE with nothing counted failed", git(), pr({ merge: "UNSTABLE" }), "merge", null],
];

for (const [name, here, status, action, waiting] of TABLE) {
	test(`the table: ${name} — ${action ?? "nothing to do"}`, () => {
		const view = pullRequestOf(here, status);
		assert.equal(does(view), action);
		assert.equal(view.waiting, waiting);
	});
}

test("the table covers every state GitHub documents", () => {
	const covered = new Set(TABLE.map(([, , status]) => mergeStateOf(status.merge)));
	assert.deepEqual([...covered].sort(), ["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"]);
	assert.equal(mergeStateOf("QUEUED"), "UNKNOWN", "a word not written in is not acted on");
	assert.equal(mergeStateOf(undefined), "UNKNOWN");
});

test("in the order things have to be done, when more than one stands in the way", () => {
	const everything = { merge: "DIRTY", draft: true, review: "CHANGES_REQUESTED", checks: { total: 3, pending: 1, failed: 1 } };
	assert.equal(does(pullRequestOf(git({ changes: 1 }), pr(everything))), "push", "what is not on origin first: GitHub's word is about the commit before");
	assert.equal(does(pullRequestOf(git({ ahead: 3, remote: { ahead: 0, behind: 0 } }), pr(everything))), "resolve-conflicts", "commits the base lacks are not what a push would send");
	assert.equal(does(pullRequestOf(git(), pr({ ...everything, merge: "BEHIND" }))), "update-branch", "the base in before the checks, which will run again");
	assert.equal(does(pullRequestOf(git(), pr({ ...everything, merge: "BLOCKED" }))), "fix-checks");
	assert.equal(does(pullRequestOf(git(), pr({ ...everything, merge: "BLOCKED", checks: { total: 3, pending: 1, failed: 0 } }))), "address-review", "a person's word outranks a machine still running");
	assert.equal(does(pullRequestOf(git(), pr({ ...everything, merge: "BLOCKED", review: "", checks: { total: 3, pending: 1, failed: 0 } }))), "running", "a draft is made ready once its checks have run");
	assert.equal(does(pullRequestOf(git(), pr({ merge: "CLEAN", draft: true }))), "ready", "a draft is never merged");
});

test("the view: its mark and number, what to do, and where it would go", () => {
	assert.deepEqual(pullRequestOf(git(), pr({ merge: "CLEAN", method: "SQUASH" })), { number: 29, url: "https://github.com/o/r/pull/29", glyph: "open", action: "merge", running: false, waiting: null, method: "SQUASH", base: "main" });
	assert.equal(pullRequestOf(git(), pr({ draft: true, merge: "DRAFT" })).glyph, "draft");
});

test("merged and closed are the mark alone, whatever is here", () => {
	const merged = pullRequestOf(git({ changes: 3 }), pr({ state: "merged", checks: { total: 2, pending: 0, failed: 1 } }));
	assert.deepEqual([merged.glyph, merged.action, merged.running], ["merged", null, false]);
	assert.deepEqual([pullRequestOf(git(), pr({ state: "closed" })).glyph, pullRequestOf(git(), pr({ state: "closed" })).action], ["closed", null]);
	assert.equal(pullRequestOf(git({ base: null, ahead: null, behind: null }), pr()).base, "the base");
});

test("Create PR is offered only once GitHub has said there is none, with an origin, off the base, and something to put in it", () => {
	assert.equal(offersPullRequest(git({ changes: 2 }), { state: "local" }), true);
	assert.equal(offersPullRequest(git({ ahead: 3, remote: { ahead: 0, behind: 0 } }), { state: "pushed" }), true, "everything pushed, still no pull request");
	assert.equal(offersPullRequest(git({ changes: 2 }), undefined), false, "GitHub not asked yet: one may be open");
	assert.equal(offersPullRequest(git({ changes: 2 }), pr()), false, "there is one");
	assert.equal(offersPullRequest(git({ changes: 2 }), pr({ state: "closed" })), false, "the closed one is what is said");
	assert.equal(offersPullRequest(git(), { state: "pushed" }), false, "nothing the base lacks");
	assert.equal(offersPullRequest(git({ changes: 2, base: null, ahead: null, behind: null }), { state: "local" }), false, "no origin");
	assert.equal(offersPullRequest(git({ branch: "main", changes: 2 }), { state: "pushed" }), false, "the base itself");
	assert.equal(offersPullRequest(null, { state: "local" }), false);
});
