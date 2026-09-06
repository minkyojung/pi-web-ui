import { ClipboardListIcon, FilePenIcon, SlidersHorizontalIcon, TerminalIcon } from "lucide-react";

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
 * What a mode allows and withholds. Lives in a tooltip, so the colours are for
 * the inverted surface rather than the page.
 */
function Grants({ id }: { id: ToolModeId | null }) {
	if (!id) return <span className="text-background/60">A hand-picked set of tools.</span>;
	const mode = describeMode(id);
	return (
		<div className="flex flex-col text-left">
			{mode.can.map((line) => (
				<span key={line} className="flex gap-1.5">
					<span className="text-emerald-400">✓</span>
					{line}
				</span>
			))}
			{mode.cannot.map((line) => (
				<span key={line} className="flex gap-1.5 text-background/60">
					<span>✗</span>
					{line}
				</span>
			))}
			{/* Nothing withheld — say so, rather than leaving an absence to read. */}
			{mode.cannot.length === 0 && <span className="pt-0.5 text-background/60">Every tool pi has.</span>}
		</div>
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
				<TooltipContent side="top">
					<Grants id={current} />
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={current ?? ""}
					onValueChange={(id) => onSetTools(modeToolNames(id as ToolModeId, available))}
				>
					{MODE_IDS.map((id) => (
						// Beside the row rather than in a panel below it: the explanation of
						// what you are pointing at should not be somewhere else on screen.
						<Tooltip key={id}>
							<TooltipTrigger asChild>
								<DropdownMenuRadioItem value={id} className="gap-3">
									<Icon id={id} />
									{describeMode(id).name}
								</DropdownMenuRadioItem>
							</TooltipTrigger>
							<TooltipContent side="right" sideOffset={8}>
								<Grants id={id} />
							</TooltipContent>
						</Tooltip>
					))}
				</DropdownMenuRadioGroup>
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
