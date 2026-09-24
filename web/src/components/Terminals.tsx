/**
 * The row of terminals under the note: a tab for each shell alive in the
 * workspace, a + for another, and the one in front drawn below.
 *
 * Which are there is the server's to say (/api/terminals): the shells live
 * there, and after a reload or a move to another workspace and back the
 * page asks rather than remembers. What the page keeps is which is in
 * front (terminals.ts). A terminal not in front is hidden, not unmounted,
 * so its screen is there when it is; closing a tab ends its shell, and a
 * shell that ends takes its tab with it. With the last tab gone the panel
 * folds; opened again with none, it makes one.
 *
 * The tabs are the note tabs' kit (ui/tabs) and not the note tabs
 * themselves: no dragging, no menu, no way back for a closed one — a shell
 * that has ended is ended. As VS Code's are, they are named by the shell
 * and a number.
 */
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { frontAfter, nameOf, nextId, readFront, writeFront, type TerminalInfo } from "../terminals.ts";
import { folderStore, forFolder } from "../workspace.ts";
import { TabChip } from "./TabChip";
import { Terminal, type TerminalHandle } from "./Terminal";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export function Terminals({ open, onEmpty }: { open: boolean; onEmpty: () => void }) {
	const folder = useSyncExternalStore(folderStore.subscribe, folderStore.get);
	/** Null until the folder has answered. */
	const [list, setList] = useState<TerminalInfo[] | null>(null);
	const [front, setFrontState] = useState<string | null>(null);
	const handles = useRef(new Map<string, TerminalHandle | null>());
	/** The list as it is, for what happens outside a render. */
	const listNow = useRef<TerminalInfo[] | null>(null);
	useEffect(() => {
		listNow.current = list;
	}, [list]);
	/** The last shell ended and the panel is on its way shut: not the moment to make another. */
	const folding = useRef(false);
	useEffect(() => {
		if (!open) folding.current = false;
	}, [open]);

	const setFront = useCallback((id: string | null) => {
		setFrontState(id);
		writeFront(id);
	}, []);

	// The folder's terminals, asked for when the folder is this one.
	const refresh = useCallback(async () => {
		try {
			const res = await fetch(forFolder("/api/terminals"));
			if (!res.ok) return;
			const { terminals } = (await res.json()) as { terminals: TerminalInfo[] };
			setList(terminals);
			setFrontState((was) => {
				const kept = was ?? readFront();
				return kept !== null && terminals.some((t) => t.id === kept) ? kept : (terminals[0]?.id ?? null);
			});
		} catch {
			// Asked again the next time the panel opens.
		}
	}, []);
	useEffect(() => {
		setList(null);
		setFrontState(null);
		void refresh();
	}, [folder, refresh]);

	const add = useCallback(() => {
		setList((was) => {
			const ids = (was ?? []).map((t) => t.id);
			const id = nextId(ids);
			// Named after the others' shell until the folder says; it is the
			// same shell.
			const shell = was?.[0]?.shell ?? "shell";
			setFront(id);
			return [...(was ?? []), { id, shell }];
		});
	}, [setFront]);

	// Opened with none: one is made. Not before the folder has answered,
	// or a reload would add to what is there; and not while the panel is
	// folding because the last shell ended, or it would come back at once.
	useEffect(() => {
		if (open && !folding.current && list !== null && list.length === 0) add();
	}, [open, list, add]);

	const gone = useCallback(
		(id: string) => {
			const was = listNow.current ?? [];
			const ids = was.map((t) => t.id);
			const left = was.filter((t) => t.id !== id);
			listNow.current = left;
			setList(left);
			setFrontState((f) => {
				const next = frontAfter(ids, id, f);
				writeFront(next);
				return next;
			});
			if (left.length === 0) {
				folding.current = true;
				onEmpty();
			}
		},
		[onEmpty],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* The same row as the note tabs over the column (NoteTabs.tsx), on
			    the panel's own top edge: the line over it is the handle's, and
			    a line of its own would draw that one twice. */}
			<div className="flex h-8 shrink-0 items-center gap-0.5 px-2 pt-1">
				<Tabs value={front ?? ""} onValueChange={setFront} className="h-full min-w-0 flex-1 items-center gap-0 data-[orientation=horizontal]:flex-row">
					<TabsList className="group-data-[orientation=horizontal]/tabs:h-7 no-scrollbar min-w-0 shrink justify-start gap-0.5 overflow-x-auto bg-transparent p-0">
						{(list ?? []).map((t) => (
							<TabsTrigger key={t.id} value={t.id} asChild>
								<TabChip size="sm" title={nameOf(t)} data-terminal-tab={t.id} onClose={() => handles.current.get(t.id)?.close()} />
							</TabsTrigger>
						))}
					</TabsList>
					<Button variant="ghost" size="icon-xs" aria-label="New terminal" className="shrink-0 text-muted-foreground" onClick={add}>
						<Plus />
					</Button>
				</Tabs>
			</div>
			{(list ?? []).map((t) => (
				<Terminal
					key={`${folder ?? ""}:${t.id}`}
					id={t.id}
					open={open && front === t.id}
					ref={(h) => {
						handles.current.set(t.id, h);
					}}
					onReady={() => void refresh()}
					onExit={() => gone(t.id)}
				/>
			))}
		</div>
	);
}
