import { FileCodeIcon, FileDiffIcon, FileTextIcon, FileTypeIcon, GitCommitHorizontalIcon } from "lucide-react";

import type { FrontLabel } from "../frontLabel";
import { TaskGlyph } from "./TaskGlyph";

/** What kind of thing the tab in front is: a task where it stands, as the plan draws it; the rest by what they are. */
export function FrontMark({ label }: { label: FrontLabel }) {
	const icon = "size-4 shrink-0 text-muted-foreground";
	switch (label.kind) {
		case "task":
			return <TaskGlyph standing={label.standing} />;
		case "commit":
			return <GitCommitHorizontalIcon className={icon} />;
		case "changes":
			return <FileDiffIcon className={icon} />;
		case "code":
			return <FileCodeIcon className={icon} />;
		case "document":
			return <FileTypeIcon className={icon} />;
		case "note":
			return <FileTextIcon className={icon} />;
	}
}
