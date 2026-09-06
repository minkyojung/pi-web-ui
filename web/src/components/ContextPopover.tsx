import { useRef, useState, useSyncExternalStore } from "react";

import { breakdown, compact } from "../contextBreakdown";
import { configStore, contextSourcesStore, usageStore } from "../serverState";
import { ContextGauge } from "./ContextGauge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const Row = ({ label, value, muted = true }: { label: string; value: string; muted?: boolean }) => (
	<div className="flex items-baseline justify-between gap-4 text-xs">
		<span className={muted ? "text-muted-foreground" : ""}>{label}</span>
		<span className="tabular-nums">{value}</span>
	</div>
);

const Section = ({ title, children }: { title?: string; children: React.ReactNode }) => (
	<div className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
		{title && <div className="text-sm font-semibold">{title}</div>}
		{children}
	</div>
);

const pct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

/**
 * What the ring is showing, in full: how much of the window is used and by
 * what, what this session has cost, and which account is paying. Opens from
 * the ring itself.
 *
 * Only the total is counted, by the model; the fixed parts are estimated at
 * four characters a token, and say so with a ≈. Messages are the remainder.
 */
export function ContextPopover() {
	// Opens on hover and closes on leave; a click pins it until the next click,
	// Escape, or a click elsewhere. Everything shown is already in memory, so
	// there is nothing to wait for on open.
	const [open, setOpen] = useState(false);
	const [pinned, setPinned] = useState(false);
	const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const enter = () => {
		if (leaveTimer.current) clearTimeout(leaveTimer.current);
		setOpen(true);
	};
	const leave = () => {
		if (pinned) return;
		leaveTimer.current = setTimeout(() => setOpen(false), 150);
	};
	const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get);
	const sources = useSyncExternalStore(contextSourcesStore.subscribe, contextSourcesStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const b = breakdown(usage?.context, sources);
	const provider = config?.model?.split("/")[0] ?? "—";
	const login = !sources ? "—" : sources.login.subscription ? "Subscription (OAuth)" : sources.login.oauth ? "OAuth" : "API key";

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				// Escape and outside clicks: close and unpin. The trigger's own click
				// is handled below, since Radix would only toggle it.
				if (!next) {
					setOpen(false);
					setPinned(false);
				}
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					aria-label="Context usage"
					onPointerEnter={enter}
					onPointerLeave={leave}
					onClick={(e) => {
						// preventDefault keeps Radix from toggling; a click pins, a second unpins.
						e.preventDefault();
						setPinned(!pinned);
						setOpen(!pinned);
					}}
				>
					<ContextGauge />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				className="flex w-80 flex-col gap-3"
				onPointerEnter={enter}
				onPointerLeave={leave}
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<Section>
					<div className="flex items-baseline justify-between">
						<span className="text-sm font-semibold">Context</span>
						<span className="text-xs tabular-nums text-muted-foreground">
							{b ? `${compact(b.used)} / ${compact(b.window)}` : "unknown"}
						</span>
					</div>
					<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						<div
							className={`h-full rounded-full transition-[width] duration-500 ${!b ? "" : b.percent >= 90 ? "bg-red-500" : b.percent >= 70 ? "bg-amber-500" : "bg-foreground/70"}`}
							style={{ width: `${b ? Math.min(b.percent, 100) : 0}%` }}
						/>
					</div>
					{b ? (
						<>
							<Row label="Free space" value={pct(b.free)} />
							{b.rows.map((r) => (
								<Row key={r.label} label={r.label} value={`${r.estimated ? "≈ " : ""}${pct(r.percent)}`} />
							))}
						</>
					) : (
						<div className="text-xs text-muted-foreground">No estimate yet — pi counts after each response.</div>
					)}
				</Section>

				{usage && (
					<Section title="This session">
						<Row label="Cost" value={`$${usage.cost.toFixed(4)}`} />
						<Row label="Tokens in / out" value={`${compact(usage.tokens.input)} / ${compact(usage.tokens.output)}`} />
						<Row label="Cache read / write" value={`${compact(usage.tokens.cacheRead)} / ${compact(usage.tokens.cacheWrite)}`} />
						<Row label="Messages · tool calls" value={`${usage.messages} · ${usage.toolCalls}`} />
					</Section>
				)}

				<Section>
					<Row label="Provider" value={provider} />
					<Row label="Login" value={login} />
				</Section>
			</PopoverContent>
		</Popover>
	);
}
