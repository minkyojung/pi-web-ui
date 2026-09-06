import { useEffect } from "react";

import { send } from "../ws";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const MOD = navigator.userAgent.includes("Mac") ? "⌘⇧/" : "Ctrl+Shift+/";

const LABELS: Record<string, string> = { xhigh: "Extra high" };
const label = (level: string) => LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);

/**
 * Signal bars for the level: one bar per level the model offers above "off",
 * lit up to the current one. Drawn rather than an icon because the count is
 * the model's — gpt offers four steps above off, claude six and no off at all.
 */
function Bars({ levels, current }: { levels: string[]; current: string }) {
	const steps = levels.filter((l) => l !== "off");
	const lit = current === "off" ? 0 : steps.indexOf(current) + 1;
	return (
		<span className="flex items-end gap-px" aria-hidden>
			{steps.map((step, i) => (
				<span
					key={step}
					className={`w-[2px] rounded-[1px] ${i < lit ? "bg-current" : "bg-current/25"}`}
					style={{ height: 4 + (8 * (i + 1)) / steps.length }}
				/>
			))}
		</span>
	);
}

/**
 * The thinking level, next to the model it applies to. The list is whatever pi
 * says the current model supports, so it changes with the model. The shortcut
 * steps to the next level and wraps.
 */
export function ThinkingSelect({ level, levels, disabled }: { level: string; levels: string[]; disabled: boolean }) {
	const unsupported = levels.length === 0;
	const choose = (next: string) => send({ type: "set_thinking", level: next });

	useEffect(() => {
		if (unsupported || disabled) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "/" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				choose(levels[(levels.indexOf(level) + 1) % levels.length]);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [level, levels, unsupported, disabled]);

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							id="thinking"
							className="h-7 gap-1.5 px-2 text-xs"
							disabled={disabled || unsupported}
						>
							{unsupported ? (
								"No thinking"
							) : (
								<>
									<Bars levels={levels} current={level} />
									{label(level)}
								</>
							)}
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">
					{unsupported ? "This model has no thinking levels" : `Adjust thinking level  ${MOD}`}
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup value={level} onValueChange={choose}>
					{levels.map((l) => (
						<DropdownMenuRadioItem key={l} value={l} className="gap-3">
							<Bars levels={levels} current={l} />
							{label(l)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<div className="px-2 pt-1 text-[10px] text-muted-foreground">
					Next level <DropdownMenuShortcut className="ml-1">{MOD}</DropdownMenuShortcut>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
