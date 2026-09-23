import { useEffect, useRef, useSyncExternalStore } from "react";
import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";

import { titleOf, wholePath } from "../noteSync";
import { pageOf } from "../pages";
import { commitTabTitle, taskOfCommit } from "../resultsList.ts";
import { configStore, specsStore } from "../serverState";
import { others, toTheRight } from "../tabs";
import { TabChip } from "./TabChip";
import { Button } from "./ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "./ui/context-menu";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The row of open notes above the one in front.
 *
 * The middle column's header is the window's title bar — the traffic lights'
 * row — so the tabs sit in it, as in Obsidian, and the note's own title moves
 * down to the top of its text. One editor is mounted below, for the note in
 * front; a tab is a way to say which, not a place its editor lives, so there
 * is no TabsContent. The row only orders and names; what is open is the
 * address, as it was.
 *
 * A tab is a div, not the button Radix would draw: the close mark inside it
 * would otherwise be a button in a button. The mark stays out of the tab
 * order — ⌘W closes the tab in front — and stops the click from also picking
 * the tab it is on. A middle click closes too, as in every browser, and so
 * does Delete on a focused tab, which the ARIA tabs pattern allows for and
 * which then puts the focus on the neighbour that took its place.
 *
 * The tabs can be dragged along the row, with dnd-kit as shadcn's own blocks
 * do it. Radix picks a tab on mousedown and dnd-kit starts on pointerdown, so
 * a drag only begins once the pointer has moved a few pixels: a click stays a
 * click, and a drag is a click and then a move, as in a browser. No keyboard
 * sensor — the arrows are the tabs' own.
 *
 * A right click on a tab is a menu, with the closings a browser offers there.
 * The menu's trigger sits inside the tab's, not around it: each writes its
 * own data-state and then whatever it was handed from outside, so the
 * outermost one's is what stands, and it is the tab's active/inactive that
 * the styles and the tests read. The tooltip, for a note in a folder, sits
 * inside for the same reason.
 *
 * At the row's end, past the tabs: every open tab as a list, for when the row
 * is longer than the column — Chrome's ∨ — and a + for a new note, which is
 * ⌘N for the mouse. At its start, before them, whatever is handed in: the way
 * back and forward, which the row itself knows nothing about.
 */
export function NoteTabs({
	tabs,
	open,
	onOpen,
	onClose,
	onCloseMany,
	onReorder,
	onNew,
}: {
	tabs: string[];
	open: string | null;
	onOpen: (path: string) => void;
	onClose: (path: string) => void;
	onCloseMany: (paths: string[]) => void;
	onReorder: (from: number, to: number) => void;
	/** Asks for a new note; absent while there is no server to ask. */
	onNew?: () => void;
}) {
	// More tabs than fit scroll, and the one just opened may be off the end:
	// it is brought in as it comes to the front, the way a browser's is.
	const row = useRef<HTMLDivElement>(null);
	// Set when a tab was closed from the keyboard: the focus was on it, and
	// should be on whichever is in front now, not lost to the body. A mouse
	// close leaves the focus where it was, which is usually the editor's.
	const refocus = useRef(false);
	useEffect(() => {
		const active = row.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
		active?.scrollIntoView({ block: "nearest", inline: "nearest" });
		// The row loses the tab at once; the address moves a beat later. Wait
		// for the tab that is in front by then, unless there is none to be.
		// The editor for that note mounts in this same commit and takes the
		// focus for itself, so the tab is focused after the commit, not in it.
		if (refocus.current && (active || tabs.length === 0)) {
			refocus.current = false;
			if (active) queueMicrotask(() => active.focus());
		}
	}, [open, tabs]);

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		onReorder(tabs.indexOf(String(active.id)), tabs.indexOf(String(over.id)));
	};

	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={onDragEnd}>
			<SortableContext items={tabs} strategy={horizontalListSortingStrategy}>
				<Tabs value={open ?? ""} onValueChange={onOpen} className="h-full min-w-0 flex-1 items-center gap-0 data-[orientation=horizontal]:flex-row">
					<TabsList ref={row} className="group-data-[orientation=horizontal]/tabs:h-8 no-scrollbar min-w-0 shrink justify-start gap-0.5 overflow-x-auto bg-transparent p-0">
						{tabs.map((path) => (
							<NoteTab
								key={path}
								path={path}
								others={others(tabs, path)}
								right={toTheRight(tabs, path)}
								onClose={() => onClose(path)}
								onCloseByKey={() => {
									refocus.current = true;
									onClose(path);
								}}
								onCloseMany={onCloseMany}
							/>
						))}
					</TabsList>
					<Button variant="ghost" size="icon-xs" aria-label="New note" className="shrink-0 text-muted-foreground" disabled={!onNew} onClick={onNew}>
						<Plus />
					</Button>
					{/* What is left of the row, so the list of tabs is at the far end of it. */}
					<div className="min-w-0 flex-1" />
				</Tabs>
			</SortableContext>
		</DndContext>
	);
}

/** One tab: a sortable item, a menu's trigger and a Radix tab on the same div. */
function NoteTab({
	path,
	others,
	right,
	onClose,
	onCloseByKey,
	onCloseMany,
}: {
	path: string;
	others: string[];
	right: string[];
	onClose: () => void;
	onCloseByKey: () => void;
	onCloseMany: (paths: string[]) => void;
}) {
	// The role and the tab index are the tabs pattern's, not the sortable's:
	// this is a tab that can be dragged, not a button that can be.
	const { attributes: { role: _role, tabIndex: _tabIndex, ...attributes }, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: path });
	// A commit's tab is called by the task it is the result of, read off the
	// results the window already has (resultsList.ts): a hash is an address
	// and not a name. One that is no task's keeps its hash.
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const page = pageOf(path);
	const ofTask = page?.kind === "commit" ? taskOfCommit(specs, page.commit) : null;
	const title = ofTask ? commitTabTitle(ofTask) : (page?.title ?? titleOf(path));
	// What the tab cannot say in its width, on hover: where a note in a folder
	// is, and for a commit its whole name with the hash it is known by. The
	// rest have nothing to add, so they get no tooltip.
	const more = ofTask ? `${title} · ${ofTask.short}` : page === null && path.includes("/") ? path : null;
	const tab = (
		<TabChip
			ref={setNodeRef}
			title={title}
			data-path={path}
			data-dragging={isDragging || undefined}
			// Translate, not Transform: a drag moves a tab and has no business
			// scaling it.
			style={{ transform: CSS.Translate.toString(transform), transition, touchAction: "none" }}
			className="data-[dragging]:z-10 data-[dragging]:opacity-60"
			onClose={onClose}
			onCloseByKey={onCloseByKey}
			{...attributes}
			{...listeners}
		/>
	);
	// The roots — the menu's, the tooltip's — draw nothing and can sit anywhere
	// outside; the triggers must be nested, and only DOM-drawing ones, or the
	// props handed down from the tab's trigger fall through a component that
	// does not render them.
	return (
		<ContextMenu>
			<Tooltip>
				<TabsTrigger value={path} asChild>
					<ContextMenuTrigger asChild>{more ? <TooltipTrigger asChild>{tab}</TooltipTrigger> : tab}</ContextMenuTrigger>
				</TabsTrigger>
				{more && <TooltipContent side="bottom">{more}</TooltipContent>}
			</Tooltip>
			<ContextMenuContent>
				<ContextMenuItem onSelect={onClose}>
					Close
					<ContextMenuShortcut>⌘W</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuItem disabled={others.length === 0} onSelect={() => onCloseMany(others)}>
					Close Others
				</ContextMenuItem>
				<ContextMenuItem disabled={right.length === 0} onSelect={() => onCloseMany(right)}>
					Close to the Right
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => onCloseMany([path, ...others])}>Close All</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={() => void navigator.clipboard.writeText(wholePath(configStore.get()?.folder, path))}>Copy Path</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
