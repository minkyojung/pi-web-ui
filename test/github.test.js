import assert from "node:assert/strict";
import test from "node:test";

import { mergeArgs, pullRequestsFromGraph, pullRequestsQuery } from "../electron/github.js";

/** GitHub's answer for three branches, as gh gave it on 2026-09-23: one open with a failed check, one merged, one it does not have. */
const answer = JSON.stringify({
	data: {
		repository: {
			viewerDefaultMergeMethod: "SQUASH",
			b0: { associatedPullRequests: { nodes: [{ number: 31, state: "OPEN", url: "https://github.com/x/y/pull/31", isDraft: false, reviewDecision: null, headRefName: "me/scripts", mergeStateStatus: "BLOCKED", commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "FAILURE" }] } } } }] } }] } },
			b1: { associatedPullRequests: { nodes: [{ number: 26, state: "MERGED", url: "https://github.com/x/y/pull/26", isDraft: true, reviewDecision: "APPROVED", headRefName: "me/spec", commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }] } },
			b2: null,
		},
	},
});

test("the query asks for exactly these branches, each aliased in order, with the branch name quoted as GraphQL wants it", () => {
	const query = pullRequestsQuery(["me/scripts", 'odd"name']);
	assert.match(query, /b0: ref\(qualifiedName: "refs\/heads\/me\/scripts"\)/);
	assert.match(query, /b1: ref\(qualifiedName: "refs\/heads\/odd\\"name"\)/);
	assert.match(query, /associatedPullRequests\(first: 1/);
	assert.doesNotMatch(query, /b2:/);
	assert.match(query, /viewerDefaultMergeMethod/, "how the repository merges, once for all of them");
	assert.match(query, /mergeStateStatus\n/, "what stands in the way of the merge");
	assert.doesNotMatch(query, /title|additions|deletions|totalCount/, "nothing the window does not say");
});

test("GitHub's answer is read by branch: the latest pull request, its checks counted, a branch without one left out", () => {
	const prs = pullRequestsFromGraph(answer, ["me/scripts", "me/spec", "me/nowhere"]);
	assert.deepEqual(prs.get("me/scripts"), { number: 31, state: "OPEN", url: "https://github.com/x/y/pull/31", draft: false, review: "", checks: { total: 2, pending: 0, failed: 1 }, merge: "BLOCKED", method: "SQUASH" });
	assert.deepEqual(prs.get("me/spec"), { number: 26, state: "MERGED", url: "https://github.com/x/y/pull/26", draft: true, review: "APPROVED", checks: { total: 0, pending: 0, failed: 0 }, merge: "", method: "SQUASH" }, "what GitHub did not say is said to be unknown");
	assert.equal(prs.has("me/nowhere"), false);
});

test("a check still running is pending, and anything that is not GitHub's answer is null", () => {
	const running = JSON.stringify({ data: { repository: { b0: { associatedPullRequests: { nodes: [{ number: 1, state: "OPEN", commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ status: "IN_PROGRESS", conclusion: null }, { state: "PENDING" }] } } } }] } }] } } } } });
	assert.deepEqual(pullRequestsFromGraph(running, ["a"]).get("a").checks, { total: 2, pending: 2, failed: 0 });
	assert.equal(pullRequestsFromGraph("not json", ["a"]), null);
	assert.equal(pullRequestsFromGraph(JSON.stringify({ errors: [{ message: "bad" }] }), ["a"]), null);
});

test("Merge asks gh the repository's own way, and nothing that is not a number and a way", () => {
	assert.deepEqual(mergeArgs(29, "MERGE"), ["pr", "merge", "29", "--merge"]);
	assert.deepEqual(mergeArgs(29, "SQUASH"), ["pr", "merge", "29", "--squash"]);
	assert.deepEqual(mergeArgs(29, "REBASE"), ["pr", "merge", "29", "--rebase"]);
	assert.equal(mergeArgs(29, ""), null, "not said: not guessed");
	assert.equal(mergeArgs("29", "MERGE"), null);
	assert.equal(mergeArgs(0, "MERGE"), null);
	assert.equal(mergeArgs(29, "--admin"), null);
	assert.ok(!mergeArgs(29, "MERGE").includes("--delete-branch"), "the branch is the repository's setting to delete, and gh would move this folder off it");
});
