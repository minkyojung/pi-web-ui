import { useEffect, useState } from "react";

import { ChevronDownIcon, FolderGit2Icon } from "lucide-react";

import type { ModelInfo } from "../../../protocol.ts";
import type { ModelPicker } from "./ModelPicker";
import { appendRestored } from "../queue";
import { FromIssue, type Issue, issueLine } from "./FromIssue";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Kbd } from "./ui/kbd";
import { type Branches, TargetBranch } from "./TargetBranch";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";

/** As long as the shell takes a line to be — electron/firstSpec.js. */
const LONGEST = 4000;

/** What is chosen beside the line: a model as the picker keys it, and its level. */
export interface SpecOn {
	model: string;
	level: string;
}

/**
 * The model picker and what it chooses among, from the page that has them.
 * The picker is not imported here, only its type: it is the session's too,
 * and what it is made of opens the socket as it loads — and this dialog is
 * also drawn on the first screen, which has no server (Start.tsx). There the
 * spec starts on the model its workspace opens on, and the dialog says so.
 */
export interface SpecOnChoices {
	Picker: typeof ModelPicker;
	/** The session's model, which is what is shown until another is chosen. */
	model: string | null;
	models: ModelInfo[];
}

/** A spec asked for: the repository it is of, and what the shell is told. `{ error }` when the workspace could not be made. */
type Create = (root: string, first: { line: string; model: string | null; effort: string | null }, from: string | null) => Promise<{ error?: string } | null>;

/**
 * The new spec dialog — the one way a workspace is made (spec-mode.md 6절),
 * in the shape of Conductor's new workspace box: the repository over the
 * top, what to build in the middle, the model and effort at the bottom left
 * and Create at the bottom right.
 *
 * Create makes the workspace and the window moves into it, where the line is
 * sent as `/spec` (firstSpec.ts). Making one fetches from the remote, so it
 * takes a moment: the dialog is not walked away from meanwhile, and when it
 * could not be made says why, with the line still there.
 */
export function NewSpec({
	repository,
	repositories,
	onRepository,
	onClose,
	create,
	branches,
	issues,
	choices,
}: {
	/** The repository the spec is of, or null when the dialog is shut. */
	repository: { path: string; name: string } | null;
	/** Every repository on the list, to change to. */
	repositories: readonly { path: string; name: string }[];
	onRepository: (repository: { path: string; name: string }) => void;
	onClose: () => void;
	create: Create;
	/** The branches a repository's workspace can start from — see TargetBranch.tsx. */
	branches: (root: string) => Promise<Branches | null>;
	/** The repository's open issues — see FromIssue.tsx. */
	issues: (root: string) => Promise<Issue[] | null>;
	choices?: SpecOnChoices;
}) {
	const [line, setLine] = useState("");
	const [chosen, setChosen] = useState<SpecOn | null>(null);
	/** The remote's branch to start from, or null for the default one. */
	const [from, setFrom] = useState<string | null>(null);
	const [making, setMaking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Each time it is opened it is for a new spec; the model chosen stays, as
	// it does in the box this one is shaped after. Opened, not pointed at
	// another repository: what was typed is kept through that.
	// A branch is one repository's: another repository starts from its own default.
	const root = repository?.path ?? null;
	useEffect(() => setFrom(null), [root]);

	const open = repository !== null;
	useEffect(() => {
		if (!open) return;
		setLine("");
		setError(null);
	}, [open]);

	// What is shown is what is asked for, chosen here or not: the session's
	// model at its own level until another is.
	const sessions = choices?.models.find((m) => m.key === choices.model) ?? null;
	const shown: SpecOn | null = chosen ?? (sessions ? { model: sessions.key, level: sessions.level } : null);
	const ready = line.trim() !== "" && !making;
	const run = () => {
		if (!repository || !ready) return;
		setMaking(true);
		setError(null);
		create(repository.path, { line, model: shown?.model ?? null, effort: shown?.level ?? null }, from)
			.then((result) => (result?.error ? setError(result.error) : onClose()))
			.catch((err: Error) => setError(err.message))
			.finally(() => setMaking(false));
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && !making && onClose()}>
			<DialogContent id="new-spec" className="gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
				<div className="flex h-11 items-center border-b px-2">
					{/* The repository, and the way to another: the dialog may have been
					    asked for from the menu, over whichever was in front. */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button id="new-spec-repository" variant="ghost" size="sm" disabled={making} className="min-w-0 gap-2 px-2">
								<FolderGit2Icon className="text-muted-foreground" />
								<DialogTitle className="truncate text-sm font-medium">{repository?.name}</DialogTitle>
								<ChevronDownIcon className="size-3 opacity-50" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="min-w-48">
							<DropdownMenuRadioGroup value={repository?.path ?? ""} onValueChange={(path) => { const next = repositories.find((r) => r.path === path); if (next) onRepository({ path: next.path, name: next.name }); }}>
								{repositories.map((r) => (
									<DropdownMenuRadioItem key={r.path} value={r.path}>
										<span className="truncate">{r.name}</span>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<TargetBranch root={root} value={from} onChange={setFrom} ask={branches} disabled={making} />
					{/* At the far end, as Conductor has it. What was typed is kept: the
					    issue goes under it. Cut to what the shell takes (firstSpec.js). */}
					<span className="ml-auto" />
					<FromIssue root={root} ask={issues} disabled={making} onPick={(issue) => setLine((was) => appendRestored(was, issueLine(issue)).slice(0, LONGEST))} />
				</div>
				<DialogDescription className="sr-only">Say what to build. A workspace is made for it, and the agent writes its requirements there.</DialogDescription>
				<Textarea
					id="new-spec-line"
					autoFocus
					value={line}
					disabled={making}
					maxLength={LONGEST}
					placeholder="What do you want to build?"
					onChange={(e) => setLine(e.target.value)}
					onKeyDown={(e) => {
						// Enter alone is a new line, as the box is for a paragraph; and a
						// syllable still being composed is not the end of anything.
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
							e.preventDefault();
							run();
						}
					}}
					className="max-h-80 min-h-40 resize-none rounded-none border-0 px-4 py-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
				/>
				{error && (
					<p id="new-spec-error" role="alert" className="border-t px-4 py-2 text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="flex items-center justify-between gap-2 px-2 pb-2">
					{choices ? (
						<choices.Picker id="specOn" model={shown?.model ?? null} level={shown?.level ?? null} models={choices.models} disabled={making} onChoose={setChosen} />
					) : (
						<span className="px-2 text-xs text-muted-foreground">Default model</span>
					)}
					<Button id="new-spec-create" size="sm" disabled={!ready} onClick={run}>
						{making && <Spinner />}
						Create
						<Kbd>⌘↵</Kbd>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
