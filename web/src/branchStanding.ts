/**
 * Where a workspace's branch stands, as one item for the foot of the window.
 *
 * The question the item answers is "how far has this branch got, and what do
 * I do next?" — so it is one thing at a time, the way Conductor's line is
 * (`#29 ↗ 1 check pending…`), and not a row of counts. What git knows of the
 * folder comes from the server (StandingMsg); what GitHub knows of the branch
 * comes from the shell's list, which asks gh (electron/workspaces.js). Merged
 * is the pull request's word alone: to git a branch with no commit of its
 * own looks exactly like one whose commits were all taken in.
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
 * The one item, or null where there is nothing to say: no repository, or a
 * branch with nothing on it and no pull request.
 */
export function standingOf(git: GitStanding | null, status: BranchStatus | undefined): Standing | null {
	if (!git) return null;
	const behind = git.behind ? ` · ${n(git.behind, "behind", "behind")}` : "";
	if (status?.number !== undefined && (status.state === "open" || status.state === "merged" || status.state === "closed")) {
		const chip = { number: status.number, url: status.url ?? null };
		if (status.state === "merged") return { chip, text: "merged", tone: "muted", title: `Pull request #${status.number} was merged` };
		if (status.state === "closed") return { chip, text: "closed", tone: "muted", title: `Pull request #${status.number} was closed without merging` };
		const { text, tone } = said(status);
		return { chip, text: `${text}${behind}`, tone, title: `Pull request #${status.number} is open` };
	}
	if (git.changes > 0) return { chip: null, text: `${n(git.changes, "change")}${behind}`, tone: "muted", title: "Changed and not committed" };
	if (git.ahead) {
		const pushed = status?.state === "pushed";
		return { chip: null, text: `↑ ${git.ahead} ${pushed ? "pushed" : "not pushed"}${behind}`, tone: "muted", title: `${n(git.ahead, "commit")} the base does not have${pushed ? ", on the remote" : ""}` };
	}
	if (git.behind) return { chip: null, text: `${n(git.behind, "behind", "behind")}`, tone: "muted", title: `The base has ${n(git.behind, "commit")} this branch does not` };
	return null;
}
