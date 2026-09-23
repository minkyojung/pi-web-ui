/**
 * One tab's body, wherever a row of tabs is: its name, and a close mark
 * that comes up under the pointer and stays on the open one.
 *
 * The note tabs over the column and the terminals' tabs under the note
 * are one kind of thing and are drawn by this one component, so that they
 * cannot drift apart: what one row learns — the width, the mark, the
 * middle click and the Delete key that close — the other has. What each
 * row adds is its own: the note tabs wrap this in a sortable and a menu,
 * the terminals' in nothing.
 *
 * A div and not the button Radix would draw, since the close mark inside
 * would otherwise be a button in a button; the tab's trigger is given
 * this as its child (asChild) and hands it the role, the state and the
 * key handling of a tab. The mark stays out of the tab order — the row's
 * own key closes the tab in front — and stops the click from also picking
 * the tab it is on. A middle click closes too, as in every browser, and
 * so does Delete on a focused tab, which the ARIA tabs pattern allows for.
 *
 * One width for every tab, and a little generous: as wide as their words
 * they read as ragged and moved under the pointer as tabs opened and
 * closed; a browser's tabs are one width for the same reason. What does
 * not fit is cut with an ellipsis.
 */
import { X } from "lucide-react";
import type { ComponentProps, Ref } from "react";
import { cn } from "cn";

export function TabChip({
	title,
	onClose,
	onCloseByKey = onClose,
	className,
	ref,
	...rest
}: {
	title: string;
	onClose: () => void;
	/** Closed with Delete or Backspace on the focused tab: the row may want to keep the focus on the neighbour. */
	onCloseByKey?: () => void;
	ref?: Ref<HTMLDivElement>;
} & Omit<ComponentProps<"div">, "title" | "ref">) {
	return (
		<div
			ref={ref}
			className={cn("group/tab w-48 flex-none justify-start pr-1 pl-3 select-none", className)}
			{...rest}
			// The wheel button: Radix already stops its default on mousedown.
			onAuxClick={(e) => {
				rest.onAuxClick?.(e);
				if (e.button !== 1) return;
				e.preventDefault();
				onClose();
			}}
			onKeyDown={(e) => {
				rest.onKeyDown?.(e);
				if (e.key !== "Delete" && e.key !== "Backspace") return;
				e.preventDefault();
				onCloseByKey();
			}}
		>
			<span className="min-w-0 flex-1 truncate text-left">{title}</span>
			<span
				role="button"
				tabIndex={-1}
				aria-label={`Close ${title}`}
				className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100 hover:bg-accent hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				// Radix picks a tab on mousedown and on focus, and a sortable would
				// start a drag on pointerdown; the close mark is none of these.
				// Stopping the pointerdown's default keeps the mouse events and the
				// focus from happening at all; the click still comes.
				onPointerDown={(e) => {
					e.stopPropagation();
					e.preventDefault();
				}}
			>
				<X className="size-3" />
			</span>
		</div>
	);
}
