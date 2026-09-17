import { useEffect, useRef } from "react";
import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X } from "lucide-react";

import { titleOf, wholePath } from "../noteSync";
import { configStore } from "../serverState";
import { others, toTheRight } from "../tabs";
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
	// The tab shows the title; a note in a folder says where, on hover. The
	// rest have nothing to add, so they get no tooltip and no title either.
	const inFolder = path.includes("/");
	const tab = (
		<div
			ref={setNodeRef}
			data-path={path}
			data-dragging={isDragging || undefined}
			// Translate, not Transform: tabs differ in width, and a scale would
			// show the one being moved stretched to the one it passes.
			style={{ transform: CSS.Translate.toString(transform), transition, touchAction: "none" }}
			className="group/tab max-w-48 flex-none justify-start pr-1 pl-3 select-none data-[dragging]:z-10 data-[dragging]:opacity-60"
			{...attributes}
			{...listeners}
			// The wheel button: Radix already stops its default on mousedown.
			onAuxClick={(e) => {
				if (e.button !== 1) return;
				e.preventDefault();
				onClose();
			}}
			onKeyDown={(e) => {
				if (e.key !== "Delete" && e.key !== "Backspace") return;
				e.preventDefault();
				onCloseByKey();
			}}
		>
			<span className="truncate">{titleOf(path)}</span>
			<span
				role="button"
				tabIndex={-1}
				aria-label={`Close ${titleOf(path)}`}
				className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100 hover:bg-accent hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				// Radix picks a tab on mousedown and on focus, and the sortable
				// would start a drag on pointerdown; the close mark is none of
				// these. Stopping the pointerdown's default keeps the mouse events
				// and the focus from happening at all; the click still comes.
				onPointerDown={(e) => {
					e.stopPropagation();
					e.preventDefault();
				}}
			>
				<X className="size-3" />
			</span>
		</div>
	);
	// The roots — the menu's, the tooltip's — draw nothing and can sit anywhere
	// outside; the triggers must be nested, and only DOM-drawing ones, or the
	// props handed down from the tab's trigger fall through a component that
	// does not render them.
	return (
		<ContextMenu>
			<Tooltip>
				<TabsTrigger value={path} asChild>
					<ContextMenuTrigger asChild>{inFolder ? <TooltipTrigger asChild>{tab}</TooltipTrigger> : tab}</ContextMenuTrigger>
				</TabsTrigger>
				{inFolder && <TooltipContent side="bottom">{path}</TooltipContent>}
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
