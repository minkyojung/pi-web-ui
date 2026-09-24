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
	/** The pull request's own title, or "" when not said. */
	title?: string;
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

/** Which of GitHub's pull request marks, and so which colour: open, draft, merged, closed (Primer's own four). */
export type PullGlyph = "open" | "draft" | "merged" | "closed";

/** A mark before a word: a check that passed, failed or is running; a thing still wanted; or none. */
export type Mark = "passed" | "failed" | "running" | "waiting" | null;

/** One thing said, with a mark or a word or both, and how loud: red wants doing, grey is waiting. */
export interface Said {
	mark: Mark;
	text: string | null;
	tone: "destructive" | "muted";
	/** The sentence for a screen reader and the pointer, where the mark stands alone. */
	label: string;
}

/** The pull request as the second item draws it: its mark and number, the one thing after them, and the card behind them. */
export interface PullRequestView {
	number: number;
	title: string;
	url: string | null;
	glyph: PullGlyph;
	/** The one thing said after the number — what stands most in the way — or null. */
	said: Said | null;
	/** Nothing stands in the way: GitHub says it can be merged. */
	ready: boolean;
	/** The card's lines, in the order GitHub's merge box has them: checks, conflicts, review, the base, draft. */
	lines: Said[];
	size: { added: number; deleted: number; commits: number | null } | null;
	/** How the repository merges by default — MERGE, SQUASH or REBASE — or "" when not said. */
	method: string;
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * The one thing said after the number: what stands most in the way of the
 * merge, in the order a person would have to deal with it. What wants
 * doing first, in red — conflicts, a check that failed, changes asked
 * for — then what is only waiting, in grey — checks running, the base to be
 * merged in, a review, a draft. The order is ours; what is in the way is
 * GitHub's word (merge: mergeStateStatus), which knows which checks and
 * reviews the repository requires.
 */
function mostInTheWay(status: BranchStatus, behind: string): Said | null {
	const checks = status.checks ?? { total: 0, pending: 0, failed: 0 };
	if (status.merge === "DIRTY") return { mark: null, text: "Conflicts", tone: "destructive", label: "Conflicts with the base" };
	if (checks.failed > 0) return { mark: "failed", text: null, tone: "destructive", label: `${n(checks.failed, "check")} failed` };
	if (status.review === "CHANGES_REQUESTED") return { mark: null, text: "Changes requested", tone: "destructive", label: "Changes requested" };
	if (checks.pending > 0) return { mark: "running", text: null, tone: "muted", label: `${n(checks.pending, "check")} running` };
	if (status.merge === "BEHIND") return { mark: null, text: behind, tone: "muted", label: behind };
	if (status.merge === "BLOCKED") return status.review === "REVIEW_REQUIRED" ? { mark: null, text: "Needs review", tone: "muted", label: "Needs review" } : { mark: null, text: "Blocked", tone: "muted", label: "Blocked by the repository's rules" };
	if (status.draft || status.merge === "DRAFT") return { mark: null, text: "Draft", tone: "muted", label: "Draft" };
	if (checks.total > 0) return { mark: "passed", text: null, tone: "muted", label: `${n(checks.total, "check")} passed` };
	return null;
}

/** What GitHub's merge box would list: each check, conflict, review and the base, as far as they are known. */
function linesOf(status: BranchStatus, behind: number, base: string): Said[] {
	const checks = status.checks ?? { total: 0, pending: 0, failed: 0 };
	const lines: Said[] = [];
	const line = (mark: Mark, text: string, tone: Said["tone"] = "muted") => lines.push({ mark, text, tone, label: text });
	if (checks.failed > 0) line("failed", `${n(checks.failed, "check")} failed`, "destructive");
	else if (checks.pending > 0) line("running", `${n(checks.pending, "check")} running`);
	else if (checks.total > 0) line("passed", `${n(checks.total, "check")} passed`);
	// Only when GitHub has worked it out: UNKNOWN is not an answer either way.
	if (status.merge === "DIRTY") line("failed", "Conflicts", "destructive");
	else if (status.merge && status.merge !== "UNKNOWN") line("passed", "No conflicts");
	if (status.review === "CHANGES_REQUESTED") line("failed", "Changes requested", "destructive");
	else if (status.review === "APPROVED") line("passed", "Approved");
	else if (status.review === "REVIEW_REQUIRED") line("waiting", "Needs review");
	if (behind > 0) line(null, `${behind} behind ${base}`);
	if (status.draft) line("waiting", "Draft");
	return lines;
}

/**
 * The pull request's item, or null where there is none: before one is
 * opened, what there is to say is the first item's (workOf). Merged and
 * closed say so and nothing else; an open one says the one thing most in
 * the way, and its card says all of them.
 */
export function pullRequestOf(git: GitStanding | null, status: BranchStatus | undefined): PullRequestView | null {
	if (!git || status?.number === undefined || !(status.state === "open" || status.state === "merged" || status.state === "closed")) return null;
	const base = git.base ?? "the base";
	const head = { number: status.number, title: status.title ?? "", url: status.url ?? null, method: status.method ?? "" };
	const size = status.added != null && status.deleted != null ? { added: status.added, deleted: status.deleted, commits: status.commits ?? null } : null;
	if (status.state === "merged") return { ...head, glyph: "merged", said: { mark: null, text: "Merged", tone: "muted", label: "Merged" }, ready: false, lines: [], size };
	if (status.state === "closed") return { ...head, glyph: "closed", said: { mark: null, text: "Closed", tone: "muted", label: "Closed without merging" }, ready: false, lines: [], size };
	const behind = git.behind ?? 0;
	const said = mostInTheWay(status, behind > 0 ? `${behind} behind ${base}` : `Behind ${base}`);
	const ready = status.merge === "CLEAN" || status.merge === "UNSTABLE" || status.merge === "HAS_HOOKS";
	// A check that failed and is not required does not stand in the way (UNSTABLE), but it is still said first.
	return { ...head, glyph: status.draft ? "draft" : "open", said, ready: ready && said?.tone !== "destructive", lines: linesOf(status, behind, base), size };
}
