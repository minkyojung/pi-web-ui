import { ClipboardListIcon, FilePenIcon, GlobeIcon, SlidersHorizontalIcon, TerminalIcon } from "lucide-react";

import { MODE_IDS, type ToolModeId, activeModeId, describeMode, isWebOn, isWebTool, modeToolNames, withWeb } from "../../../toolModes";
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
 *
 * `web` is the switch beside the ladder, given only where the tooltip is about
 * the state pi is actually in — the button. On a mode in the menu it is left
 * out, because the web is not that mode's to grant or withhold.
 */
function Grants({ id, web }: { id: ToolModeId | null; web?: boolean }) {
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
			{web !== undefined && (
				<span className={`flex gap-1.5 ${web ? "" : "text-background/60"}`}>
					<span className={web ? "text-emerald-400" : ""}>{web ? "✓" : "✗"}</span>
					{web ? "Search and read the web" : "Search or read the web"}
				</span>
			)}
			{mode.cannot.map((line) => (
				<span key={line} className="flex gap-1.5 text-background/60">
					<span>✗</span>
					{line}
				</span>
			))}
			{/* Nothing withheld — say so, rather than leaving an absence to read.
			    The web off is something withheld, whatever the rung says. */}
			{mode.cannot.length === 0 && web !== false && (
				<span className="pt-0.5 text-background/60">Every tool pi has.</span>
			)}
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
	const name = current ? describeMode(current).name : "Custom";
	// The switch beside the ladder — see WEB_TOOLS in toolModes.ts.
	const hasWeb = available.some(isWebTool);
	const webOn = isWebOn(active);

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
							aria-label={name}
						>
							<Icon id={current} />
							{/* The word goes before anything else in the row does. There
							    are three modes and each icon names the capability it
							    unlocks, so the icon can carry it alone — which is not
							    true of the model beside it, one of fifty names. The
							    tooltip says it either way, and aria-label above keeps
							    the button named when the word is gone. */}
							<span className="@max-[340px]/composer:hidden">{name}</span>
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">
					<Grants id={current} web={hasWeb ? webOn : undefined} />
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					value={current ?? ""}
					// A mode names rungs, not the web, so the switch survives the
					// change: modeToolNames turns every extension tool on, which
					// would quietly undo a web turned off.
					onValueChange={(id) => onSetTools(withWeb(modeToolNames(id as ToolModeId, available), available, webOn))}
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
				{/* Beside the modes rather than among them, and a checkbox rather
				    than one more radio: the shape says it is another question, not
				    a fourth answer to that one. Hidden when the tools are not
				    there, which is a pi without the extension. */}
				{hasWeb && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuCheckboxItem
							checked={webOn}
							onSelect={(e) => e.preventDefault()}
							onCheckedChange={(on) => onSetTools(withWeb(active, available, on))}
							className="gap-3"
						>
							<GlobeIcon className="size-3.5" aria-hidden />
							Web access
						</DropdownMenuCheckboxItem>
					</>
				)}
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
