/**
 * Where a workspace's branch stands, as two items for the foot of the window.
 *
 * The branch's work goes two ways, and each is its own question. The first
 * is what is on this machine and nowhere else: files changed and not
 * committed, commits a push would send, and commits a pull would bring —
 * what VS Code's branch and sync items say, in the same arrows (workOf). The
 * second is how far the pull request has got, one thing at a time, the way
 * Conductor's line is (`#29 ↗ 1 check pending…`) (pullRequestOf). The two
 * can both have something to say: a fix committed and not yet pushed is on
 * this machine only, and the pull request still stands where the last push
 * left it.
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
	/** Lines added and taken out across the pull request, and its commits; null when not said. */
	added?: number | null;
	deleted?: number | null;
	commits?: number | null;
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

export interface Standing {
	/** The pull request to open, when there is one. */
	chip: { number: number; url: string | null } | null;
	text: string;
	/** How it is coloured: the strip's own grey, or red for a check that failed or a request for changes. */
	tone: "muted" | "destructive";
	/** Said on pointing at it. */
	title: string;
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What the checks and the reviews of an open pull request come to, in a few words. */
function said(status: BranchStatus): { text: string; tone: Standing["tone"] } {
	if (status.review === "CHANGES_REQUESTED") return { text: "changes requested", tone: "destructive" };
	const checks = status.checks;
	if (checks && checks.failed > 0) return { text: `✗ ${n(checks.failed, "check")} failed`, tone: "destructive" };
	if (checks && checks.pending > 0) return { text: `${n(checks.pending, "check")} pending…`, tone: "muted" };
	if (status.review === "APPROVED") return { text: "approved", tone: "muted" };
	if (checks && checks.total > 0) return { text: "checks passed", tone: "muted" };
	return { text: status.draft ? "draft" : "open", tone: "muted" };
}

/**
 * The pull request's item, or null where there is none: before one is
 * opened, what there is to say is the first item's (workOf).
 */
export function pullRequestOf(git: GitStanding | null, status: BranchStatus | undefined): Standing | null {
	if (!git || status?.number === undefined || !(status.state === "open" || status.state === "merged" || status.state === "closed")) return null;
	const chip = { number: status.number, url: status.url ?? null };
	if (status.state === "merged") return { chip, text: "merged", tone: "muted", title: `Pull request #${status.number} was merged` };
	if (status.state === "closed") return { chip, text: "closed", tone: "muted", title: `Pull request #${status.number} was closed without merging` };
	const behind = git.behind ? ` · ${n(git.behind, "behind", "behind")}` : "";
	const { text, tone } = said(status);
	return { chip, text: `${text}${behind}`, tone, title: `Pull request #${status.number} is open` };
}
