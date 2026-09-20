import { Fragment } from "react";

import { Kbd } from "./ui/kbd";

/**
 * The middle column with nothing open.
 *
 * VS Code and Cursor put a list of commands here — the editor's watermark —
 * and it is the one empty state nobody has to be taught, because it does not
 * say the column is empty. It says what there is to do.
 *
 * The three rows are the whole of spec mode, in the order they happen: a line
 * about what to build, an approval of what came back, a task run. None of
 * them is a key, so the row carries the command itself where the key would
 * be, and a line underneath says where it is typed — the commands live in the
 * message box, not in the window.
 *
 * It is left behind by the first line: the agent writes `requirements.md`,
 * that opens in front, and the column is the document's from then on.
 */
const ROWS = [
	["Describe what to build", "/spec"],
	["Approve a document", "/spec-approve"],
	["Run the next task", "/spec-run"],
] as const;

export function Watermark() {
	return (
		<div id="watermark" className="flex flex-1 select-none items-center justify-center">
			<div className="grid grid-cols-[1fr_auto] items-center gap-x-10 gap-y-3">
				{ROWS.map(([what, command]) => (
					<Fragment key={command}>
						<span className="text-sm text-muted-foreground">{what}</span>
						<Kbd className="justify-self-end">{command}</Kbd>
					</Fragment>
				))}
				<p className="col-span-2 mt-2 text-xs text-muted-foreground/70">Typed in the message box.</p>
			</div>
		</div>
	);
}
