import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface ToolInfo {
	name: string;
	description?: string;
}

/**
 * Which tools the agent may call. Behind a popover because a session can expose
 * a dozen or more, and inline they wrap the settings bar into three rows.
 */
export function ToolToggles({
	tools,
	active,
	disabled,
	onToggle,
}: {
	tools: ToolInfo[];
	active: string[];
	disabled: boolean;
	onToggle: (name: string, on: boolean) => void;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button id="tools" variant="outline" size="sm" className="h-8 text-xs" disabled={disabled}>
					Tools
					<Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px] tabular-nums">
						{active.length}/{tools.length}
					</Badge>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="max-h-96 w-64 overflow-auto">
				<div className="flex flex-col gap-2">
					{tools.map((tool) => (
						<Tooltip key={tool.name}>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-2">
									<Checkbox
										id={`tool-${tool.name}`}
										checked={active.includes(tool.name)}
										onCheckedChange={(on) => onToggle(tool.name, on === true)}
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
				</div>
			</PopoverContent>
		</Popover>
	);
}
