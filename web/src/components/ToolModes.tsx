import { MODE_IDS, type ToolModeId, activeModeId, describeMode, modeToolNames } from "../toolModes";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface ToolInfo {
	name: string;
	description?: string;
}

/**
 * Rungs of the ladder, lit up to this mode — the same idiom as the thinking
 * bars beside it, because it is the same kind of thing: a level, not a choice.
 */
function Rungs({ at }: { at: number }) {
	return (
		<span className="flex items-end gap-px" aria-hidden>
			{MODE_IDS.map((id, i) => (
				<span
					key={id}
					className={`w-[2px] rounded-[1px] ${i <= at ? "bg-current" : "bg-current/25"}`}
					style={{ height: 4 + (8 * (i + 1)) / MODE_IDS.length }}
				/>
			))}
		</span>
	);
}

/**
 * What the agent is allowed to do, as a mode rather than eight checkboxes.
 * Picking a mode is the common case; the per-tool list stays a submenu for the
 * times it isn't. See toolModes.ts for why the ladder is what it is.
 */
export function ToolModes({
	tools,
	active,
	disabled,
	onSetTools,
}: {
	tools: ToolInfo[];
	active: string[];
	disabled: boolean;
	onSetTools: (names: string[]) => void;
}) {
	const available = tools.map((t) => t.name);
	// Custom is not a mode you can pick — it is what the checkboxes leave behind.
	const current = activeModeId(active, available);
	const shown = current ? describeMode(current) : null;

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							id="tools"
							className="h-7 gap-1.5 px-2 text-xs"
							disabled={disabled}
						>
							<Rungs at={current ? MODE_IDS.indexOf(current) : -1} />
							{shown?.name ?? "Custom"}
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Which tools pi may call</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={current ?? ""}
					onValueChange={(id) => onSetTools(modeToolNames(id as ToolModeId, available))}
				>
					{MODE_IDS.map((id, i) => (
						<DropdownMenuRadioItem key={id} value={id} className="gap-3">
							<Rungs at={i} />
							{describeMode(id).name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<div className="px-2 py-0.5 text-[11px]">
					{shown ? (
						<>
							{shown.can.map((line) => (
								<div key={line} className="flex gap-1.5">
									<span className="text-emerald-600 dark:text-emerald-500">✓</span>
									{line}
								</div>
							))}
							{shown.cannot.map((line) => (
								<div key={line} className="flex gap-1.5 text-muted-foreground">
									<span>✗</span>
									{line}
								</div>
							))}
						</>
					) : (
						<span className="text-muted-foreground">A hand-picked set of tools.</span>
					)}
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="text-xs">Individual tools</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-80 overflow-auto">
						{tools.map((tool) => (
							<DropdownMenuCheckboxItem
								key={tool.name}
								checked={active.includes(tool.name)}
								// Staying open: picking tools one by one is a several-click job.
								onSelect={(e) => e.preventDefault()}
								onCheckedChange={(on) =>
									onSetTools(on ? [...active, tool.name] : active.filter((n) => n !== tool.name))
								}
								className="font-mono text-xs"
							>
								{tool.name}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
