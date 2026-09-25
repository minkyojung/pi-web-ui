import { type BranchStatus, type GitStanding, pullRequestOf, workOf } from "../branchStanding";
import { ADDRESS_REVIEW, CREATE_PR, FIX_CHECKS, PUSH, RESOLVE_CONFLICTS } from "../pullRequestCommands";
import { CreatePullRequest } from "../components/CreatePullRequest";
import { PullRequestStanding } from "../components/PullRequestStanding";
import { WorkStanding } from "../components/WorkStanding";
import { commandsStore } from "../serverState";
import { getConnection, setConnection, subscribe } from "../store";

/**
 * A bench for the branch's two items at the foot of the window: every state
 * each can be in, side by side, drawn by the app's own components from the
 * app's own reading (branchStanding.ts) — so a change to the order, the
 * words or the look is seen in all of them at once, without a pull request
 * to put in each state.
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
	{ name: "Not pushed", git: git({ changes: 2 }), status: pr({ merge: "DIRTY", checks: { total: 4, pending: 0, failed: 1 } }) },
	{ name: "Conflicts", git: git(), status: pr({ merge: "DIRTY", checks: { total: 4, pending: 0, failed: 1 } }) },
	{ name: "A check failed", git: git(), status: pr({ merge: "UNSTABLE", checks: { total: 4, pending: 0, failed: 1 } }) },
	{ name: "Changes requested", git: git(), status: pr({ merge: "BLOCKED", review: "CHANGES_REQUESTED" }) },
	{ name: "Checks running", git: git(), status: pr({ merge: "UNKNOWN", checks: { total: 4, pending: 2, failed: 0 } }) },
	{ name: "Ready", git: git(), status: pr({ merge: "CLEAN", review: "APPROVED" }) },
	{ name: "Waiting on a review", git: git(), status: pr({ merge: "BLOCKED", review: "REVIEW_REQUIRED" }) },
	{ name: "Draft", git: git(), status: pr({ merge: "DRAFT", draft: true }) },
	{ name: "Merged", git: git(), status: pr({ state: "merged", merge: "UNKNOWN" }) },
	{ name: "Closed", git: git(), status: pr({ state: "closed", merge: "UNKNOWN" }) },
];

// The buttons are pressable only where pi has the commands and the window
// is connected; there is no server here, so the bench says both.
commandsStore.set([CREATE_PR, PUSH, RESOLVE_CONFLICTS, FIX_CHECKS, ADDRESS_REVIEW].map((name) => ({ name, source: "extension" as const })));
setConnection("open");
subscribe(() => {
	if (getConnection() !== "open") setConnection("open");
});

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
					<h2 className="text-sm font-medium">The pull request: at most one thing to do</h2>
					<div data-bench="No pull request yet" className="grid grid-cols-[12rem_24rem] items-start gap-4">
						<span className="pt-3.5 text-xs text-muted-foreground">No pull request yet</span>
						<Strip>
							<CreatePullRequest />
						</Strip>
					</div>
					{PULLS.map((row) => {
						const view = pullRequestOf(row.git, row.status);
						return (
							<div key={row.name} data-bench={row.name} className="grid grid-cols-[12rem_24rem] items-start gap-4">
								<span className="pt-3.5 text-xs text-muted-foreground">{row.name}</span>
								<Strip>{view && <PullRequestStanding view={view} onMerge={() => new Promise((resolve) => setTimeout(() => resolve({ error: "Required status check \"ci\" is expected." }), 1200))} />}</Strip>
							</div>
						);
					})}
				</section>
			</div>
		</div>
	);
}
