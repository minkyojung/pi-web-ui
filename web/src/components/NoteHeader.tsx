import { ChevronRight } from "lucide-react";

import { titleOf } from "../noteSync";

/**
 * The note column's header: where the open note lives, and the one control
 * that is about the pair of columns rather than about either.
 *
 * Not the note's name. That is in the tab above and again at the top of the
 * page, where it is the field you rename by — a third copy would say nothing
 * the first two do not. What is not anywhere else is the folder: a tab has
 * room for the leaf only, and two notes called "Notes" in two folders are told
 * apart here. Linear's card carries a breadcrumb in the same place for the
 * same reason.
 *
 * One height with pi's header, so the two panes of the card start level.
 */
export function NoteHeader({ path, trailing }: { path: string | null; trailing?: React.ReactNode }) {
	const folders = path?.includes("/") ? path.slice(0, path.lastIndexOf("/")).split("/") : [];
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3 text-sm">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-muted-foreground">
				{folders.map((folder, i) => (
					<span key={i} className="flex shrink-0 items-center gap-0.5">
						{i > 0 && <ChevronRight className="size-3 shrink-0" />}
						{folder}
					</span>
				))}
				{path && (
					<>
						{folders.length > 0 && <ChevronRight className="size-3 shrink-0" />}
						<span className="min-w-0 truncate font-medium text-foreground">{titleOf(path)}</span>
					</>
				)}
			</div>
			{trailing}
		</div>
	);
}
