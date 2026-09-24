import { useEffect, useSyncExternalStore } from "react";

import { changesTargetStore } from "../changesTarget";
import { changesStore, standingStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { counts, FileBlock } from "./Commit";
import { Size } from "./Size";

/**
 * What is changed and not committed, read in the middle column: every file,
 * one after another down the page, as a commit's page has them (Commit.tsx)
 * and a task in review has them (Task.tsx) — the same blocks over the same
 * reading of the folder (commitRead.ts readWorking), so a file looks the
 * same on all three. One page for all of them, as GitHub's Files changed
 * is: the list at the foot of the window opens it at the file chosen, and
 * the rest are a scroll away.
 *
 * Asked again whenever the standing moves — a turn ending, the window
 * coming back — which is when the strip's count moves too, so the page and
 * the count it was opened from do not disagree.
 */
export default function Changes({ onOpen }: { onOpen: (path: string) => void }) {
	const answer = useSyncExternalStore(changesStore.subscribe, changesStore.get);
	const standing = useSyncExternalStore(standingStore.subscribe, standingStore.get);
	const target = useSyncExternalStore(changesTargetStore.subscribe, changesTargetStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	// What was last read is from whenever the page was last open; it is not
	// drawn, since the file to scroll to would be found in a list about to change.
	useEffect(() => changesStore.set(null), []);
	useEffect(() => {
		if (online) send({ type: "open_changes" });
	}, [online, standing]);
	useEffect(() => {
		if (!answer || target === null) return;
		document.querySelector(`#page [data-file="${CSS.escape(target)}"]`)?.scrollIntoView({ block: "start" });
		changesTargetStore.set(null);
	}, [answer, target]);

	if (!answer) return <div id="page" className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Opening…</div>;
	const total = counts(answer.files);
	return (
		<div id="page" data-changes={answer.files.length} className="no-scrollbar edge-top min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-5">
				<header id="changesHead" className="flex min-w-0 items-center gap-2 pb-1">
					<h1 className="min-w-0 flex-1 truncate text-base font-medium">Changes</h1>
					<span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
						<span>
							{answer.files.length} {answer.files.length === 1 ? "file" : "files"}
						</span>
						<Size {...total} />
					</span>
				</header>
				{answer.files.map((file) => (
					<FileBlock key={file.path} file={file} onOpen={onOpen} />
				))}
				{answer.files.length === 0 && <p className="text-sm text-subtle-foreground">Nothing is changed that is not committed.</p>}
				{answer.truncated && <p className="text-xs text-muted-foreground">More files are changed than are shown here.</p>}
			</div>
		</div>
	);
}
