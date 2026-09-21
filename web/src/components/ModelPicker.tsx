import { useEffect } from "react";

import { ChevronDownIcon, KeyRoundIcon } from "lucide-react";

import { THINKING_LEVELS } from "../../../models";
import type { ModelInfo } from "../types";
import { openSettings } from "../settingsOpen";
import { send } from "../ws";
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
const heldForSlot = (e: KeyboardEvent) => (MAC ? e.ctrlKey && e.metaKey : e.ctrlKey && e.altKey);

const LABELS: Record<string, string> = { off: "Off", xhigh: "Extra high" };

/** pi's level names as they are written: "xhigh" is the only one that is not just itself. */
export const levelLabel = (level: string) => LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);

/**
 * The model and how hard it thinks, in one place, because they are one choice.
 *
 * They were two buttons and the thinking level was one value for the session,
 * so changing model silently re-used the last level. pi keeps a level per
 * model; this shows each model with its own beside it, and choosing one brings
 * its level with it.
 *
 * The list is the loadout rather than everything pi offers — fifty-odd entries
 * is a list you search, not one you pick from, and searching belongs in
 * settings. What is on the list, and in what order, is settings.json's
 * `loadout`; until something is there it is the newest GPT models. See
 * models.ts.
 *
 * Every level pi has is listed and the ones this model cannot do are greyed
 * rather than dropped, so a model that will not go to max is seen to refuse
 * rather than appearing to have a shorter ladder.
 */
export function ModelPicker({
	model,
	level,
	models,
	notice,
	disabled,
	id = "model",
	onChoose,
}: {
	model: string | null;
	/** The level to show with the model, when it is not the model's own — a choice made here, not pi's setting. */
	level?: string | null;
	models: ModelInfo[];
	notice?: string;
	disabled: boolean;
	id?: string;
	/**
	 * Given, the picker reports a choice instead of setting the session: what
	 * is chosen is the caller's to keep and to use, and nothing is sent to pi.
	 * The keys that set the session are off in this mode, since they would
	 * set it. Without it, the picker is the session's, as at the message box.
	 */
	onChoose?: (choice: { model: string; level: string }) => void;
}) {
	const found = models.find((m) => m.key === model) ?? null;
	const current = found && level ? { ...found, level } : found;
	const levels = current?.levels ?? [];
	// Nothing to reach by key when there is nothing on the list; the button
	// still opens, since the way to sign in is at the bottom of it.
	const idle = disabled || models.length === 0;
	const chooseModel = (key: string) => {
		if (key === model) return;
		if (onChoose) {
			const next = models.find((m) => m.key === key);
			if (next) onChoose({ model: key, level: next.level });
		} else send({ type: "set_model", model: key });
	};
	const chooseLevel = (next: string) => {
		if (onChoose) {
			if (current) onChoose({ model: current.key, level: next });
		} else send({ type: "set_thinking", level: next });
	};

	useEffect(() => {
		if (idle || onChoose) return;
		const onKey = (e: KeyboardEvent) => {
			if (heldForSlot(e) && e.code.startsWith("Digit")) {
				const slot = models[Number(e.code.slice(5)) - 1];
				if (!slot) return;
				e.preventDefault();
				if (slot.key !== model) send({ type: "set_model", model: slot.key });
				return;
			}
			// Round the model's own ladder, which is shorter for some models than
			// the one the menu draws.
			if (e.key === "/" && e.shiftKey && (e.metaKey || e.ctrlKey) && current && levels.length) {
				e.preventDefault();
				send({ type: "set_thinking", level: levels[(levels.indexOf(current.level) + 1) % levels.length] });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [idle, onChoose, models, model, current, levels]);

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
								{i < 9 && !onChoose && (
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
					{!onChoose && (
						<div className="px-2 pt-1 text-[10px] text-muted-foreground">
							Next effort <DropdownMenuShortcut className="ml-1">{CYCLE}</DropdownMenuShortcut>
						</div>
					)}
					<DropdownMenuSeparator />
					{/* Always here, not only when the list is empty: the same place
					    to add a second provider as to add the first. */}
					<DropdownMenuItem onSelect={() => openSettings("Accounts")}>
						<KeyRoundIcon className="size-3.5" />
						Sign in to a provider…
					</DropdownMenuItem>
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
