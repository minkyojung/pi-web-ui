import { CheckIcon, CircleDashedIcon, PlayIcon, XIcon } from "lucide-react";

import { cn } from "cn";
import { checkLogPath } from "../checkLog";
import { checkMark } from "../resultsList";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

/**
 * How a task's work was checked, as one mark with the words behind it on
 * hover: a tick or a cross where the app ran checks (a Verified trailer,
 * spec.ts), the dashed circle where there is only the agent's word or no
 * word at all (resultsList.ts checkMark). The plan's rows (TaskList.tsx)
 * and a task's page (Task.tsx) draw it, so it reads the same in both.
 *
 * The click opens what the check printed — the first that failed, else the
 * first — when the app ran one; with nothing run, what `otherwise` says, or
 * nothing.
 */
export function CheckMark({ task, checks, verified, foot, onOpen, otherwise }: { task: string; checks: string | null; verified: readonly { name: string; exit: number }[]; foot?: string; onOpen: (path: string) => void; otherwise?: () => void }) {
	const mark = checkMark({ checks, verified: [...verified] });
	const failed = verified.find((v) => v.exit !== 0) ?? null;
	return (
		<HoverCard openDelay={250} closeDelay={150}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					className="flex items-center"
					data-checks={mark}
					aria-label="how the check ended"
					onClick={(e) => {
						e.stopPropagation();
						const check = failed ?? verified[0];
						if (check) onOpen(checkLogPath(task, check.name));
						else otherwise?.();
					}}
				>
					{mark === "passed" && <CheckIcon className="size-3.5 text-muted-foreground/70" />}
					{mark === "failed" && <XIcon className="size-3.5 text-destructive/60" />}
					{(mark === "said" || mark === "none") && <CircleDashedIcon className="size-3.5 text-muted-foreground/50" />}
				</button>
			</HoverCardTrigger>
			<HoverCardContent side="bottom" align="end" className="w-96 p-0 text-left">
				<div className="space-y-1 px-3 py-2 font-mono text-[12px]">
					{verified.length === 0 && <div className="text-muted-foreground">{checks ? `The agent said: ${checks}` : "Nothing was checked."}</div>}
					{verified.map((v) => (
						<div key={v.name} className="flex items-center gap-2">
							<PlayIcon className="size-3 shrink-0 text-muted-foreground/60" />
							<span className="min-w-0 flex-1 truncate">{v.name}</span>
							<span className={cn("shrink-0 text-[11px]", v.exit === 0 ? "text-muted-foreground" : "text-destructive/80")}>exit {v.exit}</span>
						</div>
					))}
					{verified.length > 0 && checks && <div className="text-muted-foreground">The agent said: {checks}</div>}
				</div>
				{foot && <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground/70">{foot}</div>}
			</HoverCardContent>
		</HoverCard>
	);
}
