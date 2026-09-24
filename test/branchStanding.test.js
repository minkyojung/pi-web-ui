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

const said = (view) => view.said && (view.said.text ?? view.said.mark);

test("a pull request: its mark, number and title, and what stands most in the way — in the order a person would deal with it", () => {
	const open = pullRequestOf(git(), pr({ title: "Two items at the foot", merge: "CLEAN" }));
	assert.deepEqual([open.number, open.title, open.url, open.glyph], [29, "Two items at the foot", "https://github.com/o/r/pull/29", "open"]);
	assert.equal(said(open), "passed");
	assert.equal(open.ready, true);
	const conflicts = pullRequestOf(git(), pr({ merge: "DIRTY", review: "CHANGES_REQUESTED", checks: { total: 2, pending: 0, failed: 1 } }));
	assert.deepEqual([said(conflicts), conflicts.said.tone, conflicts.ready], ["Conflicts", "destructive", false], "conflicts first: nothing else can be merged past");
	const failed = pullRequestOf(git(), pr({ merge: "UNSTABLE", review: "CHANGES_REQUESTED", checks: { total: 2, pending: 0, failed: 1 } }));
	assert.deepEqual([said(failed), failed.said.label, failed.ready], ["failed", "1 check failed", false], "a failed check that is not required is still said, and not merged past");
	assert.equal(said(pullRequestOf(git(), pr({ merge: "BLOCKED", review: "CHANGES_REQUESTED", checks: { total: 2, pending: 1, failed: 0 } }))), "Changes requested", "a person's word outranks a machine still running");
	const running = pullRequestOf(git(), pr({ merge: "BLOCKED", checks: { total: 3, pending: 2, failed: 0 } }));
	assert.deepEqual([said(running), running.said.label, running.said.tone], ["running", "2 checks running", "muted"]);
	assert.equal(said(pullRequestOf(git({ behind: 4 }), pr({ merge: "BEHIND" }))), "4 behind main");
	assert.equal(said(pullRequestOf(git({ behind: 0 }), pr({ merge: "BEHIND" }))), "Behind main", "not fetched yet: GitHub's word without the count");
	assert.equal(said(pullRequestOf(git(), pr({ merge: "BLOCKED", review: "REVIEW_REQUIRED" }))), "Needs review");
	assert.equal(said(pullRequestOf(git(), pr({ merge: "BLOCKED" }))), "Blocked");
	const draft = pullRequestOf(git(), pr({ draft: true, merge: "DRAFT" }));
	assert.deepEqual([draft.glyph, said(draft), draft.ready], ["draft", "Draft", false]);
	assert.equal(pullRequestOf(git(), pr({ merge: "UNKNOWN", checks: { total: 0, pending: 0, failed: 0 } })).said, null, "nothing known, nothing said");
	assert.equal(pullRequestOf(git(), pr({ merge: "UNKNOWN" })).ready, false, "not ready until GitHub says so");
});

test("merged and closed say so and nothing else", () => {
	const merged = pullRequestOf(git({ behind: 5 }), pr({ state: "merged", checks: { total: 2, pending: 0, failed: 1 } }));
	assert.deepEqual([merged.glyph, said(merged), merged.lines, merged.ready], ["merged", "Merged", [], false]);
	const closed = pullRequestOf(git(), pr({ state: "closed" }));
	assert.deepEqual([closed.glyph, said(closed)], ["closed", "Closed"]);
});

test("the card lists what GitHub's merge box would: checks, conflicts, review, the base, draft — only what is known", () => {
	const lines = (view) => view.lines.map((line) => `${line.mark ?? "-"} ${line.text}`);
	assert.deepEqual(lines(pullRequestOf(git({ behind: 2 }), pr({ merge: "CLEAN", review: "APPROVED", checks: { total: 4, pending: 0, failed: 0 } }))), ["passed 4 checks passed", "passed No conflicts", "passed Approved", "- 2 behind main"]);
	assert.deepEqual(lines(pullRequestOf(git(), pr({ merge: "DIRTY", review: "REVIEW_REQUIRED", draft: true, checks: { total: 3, pending: 1, failed: 1 } }))), ["failed 1 check failed", "failed Conflicts", "waiting Needs review", "waiting Draft"]);
	assert.deepEqual(lines(pullRequestOf(git(), pr({ merge: "UNKNOWN", checks: { total: 2, pending: 2, failed: 0 } }))), ["running 2 checks running"], "whether it conflicts is not known yet");
	const sized = pullRequestOf(git(), pr({ added: 120, deleted: 30, commits: 5 }));
	assert.deepEqual(sized.size, { added: 120, deleted: 30, commits: 5 });
	assert.equal(pullRequestOf(git(), pr()).size, null, "not said, not drawn");
	assert.equal(pullRequestOf(git(), pr({ method: "SQUASH" })).method, "SQUASH");
});
