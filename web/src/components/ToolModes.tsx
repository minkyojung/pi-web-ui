import { ClipboardListIcon, FilePenIcon, SlidersHorizontalIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

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
 * One icon per mode, each naming the capability that mode unlocks: a checklist
 * for planning, a pen on a file for editing, a terminal for the shell. Custom
 * gets sliders, since that is what it is.
 */
const ICONS: Record<ToolModeId, typeof TerminalIcon> = {
	plan: ClipboardListIcon,
	coding: FilePenIcon,
	full: TerminalIcon,
};

const Icon = ({ id }: { id: ToolModeId | null }) => {
	const Glyph = id ? ICONS[id] : SlidersHorizontalIcon;
	return <Glyph className="size-3.5" aria-hidden />;
};

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
	// The grants shown are the hovered mode's, falling back to the current one,
	// so reading down the list explains each mode without a line of its own.
	const [preview, setPreview] = useState<ToolModeId | null>(null);
	const shown = preview ? describeMode(preview) : current ? describeMode(current) : null;

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
							<Icon id={current} />
							{current ? describeMode(current).name : "Custom"}
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Which tools pi may call</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" onPointerLeave={() => setPreview(null)}>
				<DropdownMenuRadioGroup
					value={current ?? ""}
					onValueChange={(id) => onSetTools(modeToolNames(id as ToolModeId, available))}
				>
					{MODE_IDS.map((id) => (
						<DropdownMenuRadioItem
							key={id}
							value={id}
							className="gap-3"
							// Radix focuses an item on hover, so this covers pointer and keyboard.
							onFocus={() => setPreview(id)}
						>
							<Icon id={id} />
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
							{/* Nothing withheld — say so, rather than leaving an absence to read. */}
							{shown.cannot.length === 0 && (
								<div className="pt-0.5 text-muted-foreground">Every tool pi has.</div>
							)}
						</>
					) : (
						<span className="text-muted-foreground">A hand-picked set of tools.</span>
					)}
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="text-xs" onFocus={() => setPreview(null)}>
						Individual tools
					</DropdownMenuSubTrigger>
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
