import { useState, useSyncExternalStore } from "react";

import { breakdown, compact } from "../contextBreakdown";
import { commandsStore, configStore, contextSourcesStore, usageStore } from "../serverState";
import { send } from "../ws";
import type { Glyph } from "../working";
import { ContextGauge, SAYS } from "./ContextGauge";
import { Button } from "./ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

const Row = ({ label, value, muted = true }: { label: string; value: string; muted?: boolean }) => (
	<div className="flex items-baseline justify-between gap-4 text-xs">
		<span className={muted ? "text-muted-foreground" : ""}>{label}</span>
		<span className="tabular-nums">{value}</span>
	</div>
);

const Section = ({ title, children }: { title?: string; children: React.ReactNode }) => (
	<div className="flex flex-col gap-1.5">
		{title && <div className="text-sm font-semibold">{title}</div>}
		{children}
	</div>
);

const pct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

/**
 * What the ring is showing, in full: how much of the window is used and by
 * what, what this session has cost, and which account is paying. It comes up
 * from the ring itself, under the pointer — a card and not a popover, which
 * is a difference in how it is opened and so in what it may hold: there is
 * nothing in here to click.
 *
 * Only the total is counted, by the model; the fixed parts are estimated at
 * four characters a token, and say so with a ≈. Messages are the remainder.
 */
export function ContextCard({
	status = "idle",
	quiet = false,
	onOpenChange,
	onClick,
}: {
	/** What the agent's state is, when the ring is all of the agent the window shows. See ContextGauge. */
	status?: Glyph;
	/**
	 * Not to open on this pointer. The folded ring is first a thing to open into
	 * words, and a card coming up on the same hover would be two answers to one
	 * gesture; once opened, a fresh hover on the ring brings the card as always.
	 */
	quiet?: boolean;
	onOpenChange?: (open: boolean) => void;
	onClick?: () => void;
} = {}) {
	const [open, setOpen] = useState(false);
	const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get);
	const sources = useSyncExternalStore(contextSourcesStore.subscribe, contextSourcesStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const prompts = useSyncExternalStore(commandsStore.subscribe, commandsStore.get).filter((c) => c.source === "prompt").length;
	const b = breakdown(usage?.context, sources);
	const provider = config?.model?.split("/")[0] ?? "—";
	const login = !sources ? "—" : sources.login.subscription ? "Subscription (OAuth)" : sources.login.oauth ? "OAuth" : "API key";

	return (
		// Everything shown is already in memory, so there is nothing to wait for:
		// it comes up with the pointer and takes a moment to go, which is enough
		// to cross the gap between the ring and the card.
		<HoverCard
			openDelay={0}
			closeDelay={150}
			open={open}
			onOpenChange={(want) => {
				const next = want && !quiet;
				setOpen(next);
				onOpenChange?.(next);
			}}
		>
			<HoverCardTrigger asChild>
				{/* No height of its own: it sits in the strip at the foot of the
				    window, where what a thing is cut to is what says how tall it is
				    — see the Item in StatusBar.tsx. */}
				<Button variant="ghost" size="icon-sm" className="cursor-default" aria-label={SAYS[status] ?? "Context usage"} onClick={onClick}>
					<ContextGauge status={status} />
				</Button>
			</HoverCardTrigger>
			<HoverCardContent align="end" side="top" className="flex w-80 flex-col gap-4">
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
						<div className="text-xs text-muted-foreground">No estimate yet — the agent counts after each response.</div>
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
					{sources?.untrusted && <Row label="This folder's .pi" value="Not read — not trusted" />}
					{/* What pi read in when the session began, and pi's /reload to read
					    it again for what was added since. */}
					{sources && (
						<div className="flex items-center justify-between gap-2 text-xs">
							<span className="text-muted-foreground">
								Skills {sources.skills} · prompts {prompts} · context files {sources.memoryFiles.count}
							</span>
							<Button variant="ghost" size="xs" onClick={() => send({ type: "reload" })}>
								Reload
							</Button>
						</div>
					)}
				</Section>

				{/* pi's /compact by hand: the conversation so far summarised into
				    less, before the window fills and pi does it unasked. Not while
				    a reply is being written, since that is what would be cut. */}
				<Section>
					{config?.isCompacting ? (
						<Button variant="outline" size="sm" onClick={() => send({ type: "abort_compaction" })}>
							Stop compacting
						</Button>
					) : (
						<Button variant="outline" size="sm" disabled={config?.isStreaming ?? true} onClick={() => send({ type: "compact" })}>
							Compact the conversation
						</Button>
					)}
				</Section>
			</HoverCardContent>
		</HoverCard>
	);
}
