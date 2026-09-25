/**
 * Where a workspace's branch stands, as two items for the foot of the window.
 *
 * The branch's work goes two ways, and each is its own question. The first
 * is what is on this machine and nowhere else: files changed and not
 * committed, commits a push would send, and commits a pull would bring —
 * what VS Code's branch and sync items say, in the same arrows (workOf). The
 * second is the pull request: its number, and at most one thing to do about
 * it, as Conductor has it — Create PR before there is one, then Push,
 * Resolve conflicts, Fix checks, Address review or Merge, and nothing at
 * all while nothing is to be done (pullRequestOf). Why is GitHub's to say,
 * a press away.
 *
 * What git knows of the folder comes from the server (StandingMsg); what
 * GitHub knows of the branch comes from the shell's list, which asks gh
 * (electron/workspaces.js). Merged is the pull request's word alone: to git
 * a branch with no commit of its own looks exactly like one whose commits
 * were all taken in.
 *
 * Pure. Drawn in BranchStanding.tsx.
 */

/** What the server read off git in the folder. Null where the folder is no repository or is on no branch. */
export interface GitStanding {
	branch: string;
	/** The remote's default branch, `main`, or null with no remote. */
	base: string | null;
	/** Files changed and not committed, the app's own folder left out. */
	changes: number;
	/** Commits here that the base does not have; null with no base. */
	ahead: number | null;
	/** Commits on the base that this branch does not have; null with no base. */
	behind: number | null;
	/** The same against origin's branch of this name; null where origin has none. */
	remote: { ahead: number; behind: number } | null;
}

/** What the shell's list says of the branch — see electron/workspaces.js `statusOf`. */
export interface BranchStatus {
	state: "local" | "pushed" | "open" | "merged" | "closed";
	number?: number;
	url?: string;
	draft?: boolean;
	/** GitHub's word on the reviews: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or "" for none. */
	review?: string;
	/** The checks, folded: how many, how many still running, how many failed. */
	checks?: { total: number; pending: number; failed: number };
	/** GitHub's word on whether it can be merged (electron/github.js): CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, DRAFT, HAS_HOOKS, UNKNOWN, or "" when not said. */
	merge?: string;
	/** How the repository merges by default — MERGE, SQUASH or REBASE — or "" when not said. */
	method?: string;
}

/** What is on this machine and not on origin, as the first item says it. Each is left out at 0. */
export interface Work {
	/** Files changed and not committed. */
	changes: number;
	/** Commits a push would send: for a branch origin does not have yet, every commit the base lacks. */
	push: number;
	/** Commits a pull would bring. */
	pull: number;
	/** Whether origin has this branch at all. */
	published: boolean;
}

/**
 * The first item, or null when everything here is also on origin — or there
 * is no origin to send it to, which leaves only what is not committed.
 */
export function workOf(git: GitStanding | null): Work | null {
	if (!git) return null;
	const published = git.remote !== null;
	// Nothing to push with no origin at all: a commit is as far as work goes.
	const push = git.remote ? git.remote.ahead : git.base !== null ? (git.ahead ?? 0) : 0;
	const pull = git.remote?.behind ?? 0;
	if (git.changes === 0 && push === 0 && pull === 0) return null;
	return { changes: git.changes, push, pull, published };
}

/**
 * Whether the second item offers to open a pull request: GitHub has been
 * asked and has none for the branch, there is an origin to open one on,
 * the branch is not the base itself, and there is something for one to hold
 * — files not committed, or commits the base lacks. Before GitHub has been
 * asked there is no knowing a pull request is not already open, so nothing
 * is offered.
 */
export function offersPullRequest(git: GitStanding | null, status: BranchStatus | undefined): boolean {
	if (!git || !git.base || git.branch === git.base) return false;
	if (status?.state !== "local" && status?.state !== "pushed") return false;
	return git.changes > 0 || (git.ahead ?? 0) > 0;
}

/** Which of GitHub's pull request marks, and so which colour: open, draft, merged, closed (Primer's own four). */
export type PullGlyph = "open" | "draft" | "merged" | "closed";

/** The one thing to do about a pull request, each a button: four are the agent's (pullRequest.ts), Merge the shell's. */
export type PullAction = "push" | "resolve-conflicts" | "fix-checks" | "address-review" | "merge";

/** The pull request as the second item draws it: its mark and number, and at most one thing to do. */
export interface PullRequestView {
	number: number;
	url: string | null;
	glyph: PullGlyph;
	/** What there is to do now, or null: nothing is, or it is somebody else's — a reviewer's, GitHub's. */
	action: PullAction | null;
	/** Checks are running, and there is nothing to do but wait. */
	running: boolean;
	/** How the repository merges by default — MERGE, SQUASH or REBASE — or "" when not said. */
	method: string;
	/** What it would be merged into, as `main`. */
	base: string;
}

/**
 * The one thing to do, in the order it has to be done. What is here and
 * not on origin first: until it is pushed, what GitHub says of the checks
 * and the conflicts is about the commit before. Then what stands in the
 * way — conflicts, a failed check, changes asked for — each the agent's to
 * deal with; then, with nothing in the way, the merge. What is in the way
 * is GitHub's word (merge: mergeStateStatus), which knows which checks and
 * reviews the repository requires. Waiting on a reviewer, or on a draft
 * being made ready, is nobody's here: nothing is offered.
 */
function actionOf(git: GitStanding, status: BranchStatus): { action: PullAction | null; running: boolean } {
	const checks = status.checks ?? { total: 0, pending: 0, failed: 0 };
	const unpushed = git.changes > 0 || (git.remote ? git.remote.ahead : (git.ahead ?? 0)) > 0;
	if (unpushed) return { action: "push", running: false };
	if (status.merge === "DIRTY") return { action: "resolve-conflicts", running: false };
	if (checks.failed > 0) return { action: "fix-checks", running: false };
	if (status.review === "CHANGES_REQUESTED") return { action: "address-review", running: false };
	if (checks.pending > 0) return { action: null, running: true };
	if (status.merge === "CLEAN" || status.merge === "UNSTABLE" || status.merge === "HAS_HOOKS") return { action: "merge", running: false };
	return { action: null, running: false };
}

/**
 * The pull request's item, or null where there is none: before one is
 * opened, what there is to say is the first item's (workOf), and what to do
 * is Create PR (offersPullRequest). Merged and closed are the mark alone.
 */
export function pullRequestOf(git: GitStanding | null, status: BranchStatus | undefined): PullRequestView | null {
	if (!git || status?.number === undefined || !(status.state === "open" || status.state === "merged" || status.state === "closed")) return null;
	const head = { number: status.number, url: status.url ?? null, method: status.method ?? "", base: git.base ?? "the base" };
	if (status.state !== "open") return { ...head, glyph: status.state, action: null, running: false };
	return { ...head, glyph: status.draft ? "draft" : "open", ...actionOf(git, status) };
}
