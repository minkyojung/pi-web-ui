import { useState } from "react";

import { MODE_IDS, type ToolModeId, activeModeId, describeMode, isExtensionTool, modeToolNames } from "../toolModes";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface ToolInfo {
	name: string;
	description?: string;
}

/**
 * What the agent is allowed to do, as a mode rather than eight checkboxes.
 * Picking a mode is the common case; the per-tool list stays a disclosure below
 * it for the times it isn't. See toolModes.ts for why the ladder is what it is.
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
	const [showTools, setShowTools] = useState(false);
	const available = tools.map((t) => t.name);
	const current = activeModeId(active, available);
	// Custom is not a mode you can pick — it is what the checkboxes leave behind.
	const shown = current ? describeMode(current) : null;

	const toggle = (name: string, on: boolean) =>
		onSetTools(on ? [...active, name] : active.filter((n) => n !== name));

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button id="tools" variant="outline" size="sm" className="h-8 text-xs" disabled={disabled}>
					{shown?.name ?? "Custom"}
					<Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px] tabular-nums">
						{active.length}/{tools.length}
					</Badge>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="flex max-h-[32rem] w-72 flex-col gap-3 overflow-auto">
				<div className="flex flex-col gap-1">
					<div className="text-sm font-semibold">Tool mode</div>
					{MODE_IDS.map((id) => {
						const mode = describeMode(id);
						const selected = id === current;
						return (
							<button
								key={id}
								type="button"
								aria-pressed={selected}
								onClick={() => onSetTools(modeToolNames(id, available))}
								className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-accent ${
									selected ? "border-foreground/40 bg-accent" : "border-transparent"
								}`}
							>
								<span className="text-xs font-medium">{mode.name}</span>
								<span className="font-mono text-[10px] text-muted-foreground">
									{modeToolNames(id, available)
										.filter((n) => !isExtensionTool(n))
										.join(" · ")}
								</span>
							</button>
						);
					})}
				</div>

				<div className="flex flex-col gap-1 border-t pt-3">
					<div className="text-xs font-medium">{shown ? `${shown.name} can` : "This set can"}</div>
					{shown ? (
						<>
							{shown.can.map((line) => (
								<Permission key={line} allowed text={line} />
							))}
							{shown.cannot.map((line) => (
								<Permission key={line} allowed={false} text={line} />
							))}
						</>
					) : (
						<div className="text-[11px] text-muted-foreground">
							A hand-picked set — see the tools below, or pick a mode above.
						</div>
					)}
				</div>

				<Collapsible open={showTools} onOpenChange={setShowTools} className="border-t pt-3">
					<CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">
						{showTools ? "▾" : "▸"} Individual tools
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2 flex flex-col gap-2">
						{tools.map((tool) => (
							<Tooltip key={tool.name}>
								<TooltipTrigger asChild>
									<div className="flex items-center gap-2">
										<Checkbox
											id={`tool-${tool.name}`}
											checked={active.includes(tool.name)}
											onCheckedChange={(on) => toggle(tool.name, on === true)}
										/>
										<Label htmlFor={`tool-${tool.name}`} className="font-mono text-xs font-normal">
											{tool.name}
										</Label>
									</div>
								</TooltipTrigger>
								{tool.description && (
									<TooltipContent side="right" className="max-w-72">
										{tool.description}
									</TooltipContent>
								)}
							</Tooltip>
						))}
					</CollapsibleContent>
				</Collapsible>
			</PopoverContent>
		</Popover>
	);
}

const Permission = ({ allowed, text }: { allowed: boolean; text: string }) => (
	<div className={`flex items-baseline gap-1.5 text-xs ${allowed ? "" : "text-muted-foreground"}`}>
		<span aria-hidden className={allowed ? "text-emerald-600 dark:text-emerald-500" : ""}>
			{allowed ? "✓" : "✗"}
		</span>
		<span>{text}</span>
	</div>
);
