import { type BranchStatus, type GitStanding, pullRequestOf, workOf } from "../branchStanding";
import { PullRequestCard, PullRequestStanding } from "../components/PullRequestStanding";
import { WorkStanding } from "../components/WorkStanding";

/**
 * A bench for the branch's two items at the foot of the window: every state
 * each can be in, side by side, drawn by the app's own components from the
 * app's own reading (branchStanding.ts) — so a change to the order, the
 * words or the look is seen in all of them at once, without a pull request
 * to put in each state. The card behind the pull request's item is drawn
 * open beside it.
 */

const git = (over: Partial<GitStanding> = {}): GitStanding => ({ branch: "me/status-bar", base: "main", changes: 0, ahead: 0, behind: 0, remote: null, ...over });
const pr = (over: Partial<BranchStatus> = {}): BranchStatus => ({
	state: "open",
	number: 29,
	title: "The foot of the window says the branch in two items",
	url: "https://github.com/o/r/pull/29",
	review: "",
	checks: { total: 4, pending: 0, failed: 0 },
	merge: "CLEAN",
	added: 120,
	deleted: 30,
	commits: 5,
	method: "MERGE",
	...over,
});

const WORK: { name: string; git: GitStanding }[] = [
	{ name: "Files not committed", git: git({ changes: 5 }) },
	{ name: "Commits, never pushed", git: git({ ahead: 3 }) },
	{ name: "All three", git: git({ changes: 2, ahead: 4, remote: { ahead: 1, behind: 2 } }) },
];

const PULLS: { name: string; git: GitStanding; status: BranchStatus }[] = [
	{ name: "1 Conflicts", git: git({ behind: 3 }), status: pr({ merge: "DIRTY", checks: { total: 4, pending: 0, failed: 1 } }) },
	{ name: "2 A check failed", git: git(), status: pr({ merge: "UNSTABLE", checks: { total: 4, pending: 0, failed: 1 } }) },
	{ name: "3 Changes requested", git: git(), status: pr({ merge: "BLOCKED", review: "CHANGES_REQUESTED" }) },
	{ name: "4 Checks running", git: git(), status: pr({ merge: "UNKNOWN", checks: { total: 4, pending: 2, failed: 0 } }) },
	{ name: "5 Behind main", git: git({ behind: 2 }), status: pr({ merge: "BEHIND" }) },
	{ name: "6 Needs review", git: git(), status: pr({ merge: "BLOCKED", review: "REVIEW_REQUIRED" }) },
	{ name: "7 Draft", git: git(), status: pr({ merge: "DRAFT", draft: true }) },
	{ name: "8 Ready", git: git(), status: pr({ merge: "CLEAN", review: "APPROVED" }) },
	{ name: "Merged", git: git(), status: pr({ state: "merged", merge: "UNKNOWN" }) },
	{ name: "Closed", git: git(), status: pr({ state: "closed", merge: "UNKNOWN" }) },
];

/** A stretch of the strip, as tall and as quiet as the real one (StatusBar.tsx). */
function Strip({ children }: { children: React.ReactNode }) {
	return <div className="flex h-11 items-center gap-0.5 rounded-md border px-2 text-xs text-muted-foreground">{children}</div>;
}

export function StatusBench() {
	return (
		<div className="min-h-screen bg-background p-8 text-foreground">
			<div className="mx-auto flex max-w-4xl flex-col gap-8">
				<section className="flex flex-col gap-3">
					<h2 className="text-sm font-medium">What is on this machine</h2>
					{WORK.map((row) => {
						const work = workOf(row.git);
						return (
							<div key={row.name} data-bench={row.name} className="grid grid-cols-[12rem_1fr] items-center gap-4">
								<span className="text-xs text-muted-foreground">{row.name}</span>
								<Strip>{work && <WorkStanding work={work} onOpen={() => {}} />}</Strip>
							</div>
						);
					})}
				</section>
				<section className="flex flex-col gap-3">
					<h2 className="text-sm font-medium">The pull request, most in the way first</h2>
					{PULLS.map((row) => {
						const view = pullRequestOf(row.git, row.status);
						return (
							<div key={row.name} data-bench={row.name} className="grid grid-cols-[12rem_16rem_1fr] items-start gap-4">
								<span className="pt-3.5 text-xs text-muted-foreground">{row.name}</span>
								<Strip>{view && <PullRequestStanding view={view} />}</Strip>
								<div className="rounded-md border bg-popover p-3">{view && <PullRequestCard view={view} />}</div>
							</div>
						);
					})}
				</section>
			</div>
		</div>
	);
}
