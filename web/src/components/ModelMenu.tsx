import { ChevronDownIcon, KeyRoundIcon } from "lucide-react";

import { THINKING_LEVELS } from "../../../models";
import type { ModelInfo } from "../types";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const MAC = navigator.userAgent.includes("Mac");
/** Held with a digit to reach a model by its place in the list. */
const SLOT = MAC ? "⌃⌘" : "Ctrl+Alt+";
const CYCLE = MAC ? "⌘⇧/" : "Ctrl+Shift+/";

const LABELS: Record<string, string> = { off: "Off", xhigh: "Extra high" };

/** pi's level names as they are written: "xhigh" is the only one that is not just itself. */
export const levelLabel = (level: string) => LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);

/**
 * The menu of the model and how hard it thinks, and nothing else: what it
 * shows is given, and what is chosen is reported. Whose choice it is — the
 * session's, sent to pi (ModelPicker), or a dialog's, kept until Create
 * (NewSpec) — is the caller's. Nothing of the socket is imported here, so
 * the first screen, which has no server, draws it too.
 *
 * Every level pi has is listed and the ones this model cannot do are greyed
 * rather than dropped, so a model that will not go to max is seen to refuse
 * rather than appearing to have a shorter ladder.
 */
export function ModelMenu({
	model,
	level,
	models,
	notice,
	disabled,
	id = "model",
	onChoose,
	shortcuts = false,
	onAccounts,
}: {
	model: string | null;
	/** The level to show with the model, when it is not the model's own — a choice made elsewhere, not pi's setting. */
	level?: string | null;
	models: ModelInfo[];
	notice?: string;
	disabled: boolean;
	id?: string;
	/** What was chosen, and which of the two changed. */
	onChoose: (choice: { model: string; level: string }, changed: "model" | "level") => void;
	/** Whether the keys that reach a model by its place are drawn beside the entries: only where they work. */
	shortcuts?: boolean;
	/** The way to sign in, when there is one to offer. */
	onAccounts?: () => void;
}) {
	const found = models.find((m) => m.key === model) ?? null;
	const current = found && level ? { ...found, level } : found;
	const levels = current?.levels ?? [];
	const chooseModel = (key: string) => {
		if (key === model) return;
		const next = models.find((m) => m.key === key);
		if (next) onChoose({ model: key, level: next.level }, "model");
	};
	const chooseLevel = (next: string) => {
		if (current) onChoose({ model: current.key, level: next }, "level");
	};

	return (
		<span className="inline-flex min-w-0 items-center">
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button type="button" variant="ghost" size="sm" id={id} className="h-7 min-w-0 shrink gap-1.5 px-2 text-xs shadow-none" disabled={disabled}>
								{current ? (
									<>
										{/* The last thing on the row to give anything up, and it
										    gives up letters rather than the whole word: a model
										    is one of fifty names and half of one still says
										    which. The level does not truncate — three letters
										    cut down is no level at all. */}
										<span className="min-w-0 truncate" title={current.name}>{current.name}</span>
										<span className="shrink-0 text-muted-foreground/80">{levelLabel(current.level)}</span>
									</>
								) : (
									<span className="text-muted-foreground">{models.length ? "model" : "No model"}</span>
								)}
								<ChevronDownIcon className="size-3 opacity-50" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="top">Model and how hard it thinks</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="start" className="min-w-56">
					<DropdownMenuRadioGroup value={model ?? ""} onValueChange={chooseModel}>
						{models.map((m, i) => (
							<DropdownMenuRadioItem key={m.key} value={m.key} className="gap-3">
								<span className="min-w-0 truncate">{m.name}</span>
								<span className="text-muted-foreground">{levelLabel(m.level)}</span>
								{i < 9 && shortcuts && (
									<DropdownMenuShortcut>
										{SLOT}
										{i + 1}
									</DropdownMenuShortcut>
								)}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger disabled={!current}>
							Effort
							<span className="ml-auto text-muted-foreground">{current ? levelLabel(current.level) : ""}</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup value={current?.level ?? ""} onValueChange={chooseLevel}>
								{THINKING_LEVELS.map((level) => (
									<DropdownMenuRadioItem key={level} value={level} disabled={!levels.includes(level)}>
										{levelLabel(level)}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					{shortcuts && (
						<div className="px-2 pt-1 text-[10px] text-muted-foreground">
							Next effort <DropdownMenuShortcut className="ml-1">{CYCLE}</DropdownMenuShortcut>
						</div>
					)}
					{/* Always here, not only when the list is empty: the same place
					    to add a second provider as to add the first — where there is a
					    Settings to open, which the first screen has not. */}
					{onAccounts && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={onAccounts}>
								<KeyRoundIcon className="size-3.5" />
								Sign in to a provider…
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{notice && (
				<span className="ml-1 text-xs text-destructive" title={notice} aria-label={notice} role="img">
					⚠
				</span>
			)}
		</span>
	);
}
