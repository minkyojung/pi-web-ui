import { useSyncExternalStore } from "react";

import { describeContext, type Tone } from "../contextGauge";
import { usageStore } from "../serverState";
import type { Glyph } from "../working";

const R = 8;
const C = 2 * Math.PI * R;

const TONE: Record<Tone, string> = {
  unknown: "text-muted-foreground/60",
  ok: "text-muted-foreground",
  warn: "text-warning",
  danger: "text-destructive",
};

/** What each mark says to somebody who cannot see it. The ring's own words follow. */
export const SAYS: Record<Glyph, string | null> = {
  offline: "Offline",
  waiting: "The agent is waiting for your answer",
  working: "The agent is working",
  unseen: "The agent finished while its column was folded",
  idle: null,
};

/**
 * How full the context window is, as a ring. The server sends usage after
 * every completed message, so this moves at the end of each turn rather than
 * during it. Thresholds and wording live in contextGauge.ts, where they are
 * tested.
 *
 * With the agent's column folded away the ring is all of the agent there is
 * in the window, so it carries the rest of the agent's state too — which of
 * the five, and why that order, is working.ts. Each is drawn so it cannot be
 * taken for how full the context is, since that is what the ring already
 * means:
 *
 * - offline: the track goes to dashes, and the fill with it. A window that
 *   cannot be reached has no reading to give.
 * - working: a short arc travels round the track. Travelling, not filling —
 *   the fill stays where it is under it, a different length and a different
 *   weight of colour.
 * - waiting, unseen: a dot on the ring's shoulder, where every unread mark on
 *   every icon has been since there were icons. Amber for waiting, which is
 *   the colour this window already says it in; blue for a run nobody saw end,
 *   which is the colour of unread.
 *
 * The dot is cut out of whatever is behind it by a ring of the strip's own
 * floor, so it reads the same over an amber or a red ring.
 */
export function ContextGauge({ status = "idle" }: { status?: Glyph }) {
  const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get);
  const { fraction, tone, label } = describeContext(usage?.context);
  const percent = usage?.context?.percent ?? null;
  const offline = status === "offline";

  return (
    <span
      id="context-gauge"
      className={`relative inline-flex size-7 cursor-default items-center justify-center ${offline ? TONE.unknown : TONE[tone]}`}
      data-percent={percent ?? ""}
      data-glyph={status}
      aria-label={[SAYS[status], label].filter(Boolean).join(" · ")}
      role="img"
    >
      <svg viewBox="0 0 20 20" className="size-5 -rotate-90">
        <circle
          cx="10"
          cy="10"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeOpacity={offline ? "0.6" : "0.25"}
          strokeWidth="1.75"
          strokeDasharray={offline ? "2 2.2" : undefined}
        />
        {!offline && (
          <circle
            cx="10"
            cy="10"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - fraction)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        )}
        {status === "working" && (
          <g className="agent-orbit text-foreground">
            <circle
              cx="10"
              cy="10"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeDasharray={`${C * 0.22} ${C}`}
            />
          </g>
        )}
      </svg>
      {(status === "waiting" || status === "unseen") && (
        <span
          aria-hidden
          data-dot={status}
          className={`absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-sidebar ${status === "waiting" ? "bg-warning" : "bg-primary"}`}
        />
      )}
    </span>
  );
}
