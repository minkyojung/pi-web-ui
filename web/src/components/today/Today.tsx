import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hoursAndMinutes, useDay } from "@/today";
import { Timeline } from "./Timeline";

/**
 * One page for one day.
 *
 * The order of the sections is fixed and nothing on it can be moved, which is
 * the point: a page whose shape is decided in advance can be filled a section
 * at a time without the ones already there shifting under it. Sections with no
 * data yet hold their space rather than collapsing, so the format is legible
 * before it is true.
 */
export function Today() {
  const day = useDay();
  const usage = day?.usage ?? null;
  // The one number here the day itself answers. The other three wait on the
  // sections below them, and say nothing rather than guessing.
  const focus = usage?.ok ? usage.totals.reduce((a, t) => a + t.minutes, 0) : null;

  return (
    <div id="today" className="flex h-full min-h-0 flex-col">
      {/* Level with the headers either side of it, the same eleven pixels the
          article's row takes, so the three columns start on one line. */}
      <div className="drag-region flex h-11 shrink-0 items-center gap-2 border-b px-4 text-xs text-muted-foreground">
        <span>Today</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain">
        <div className="mx-auto max-w-[56rem] px-8 py-8">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">{dateLine()}</p>

          <div className="mt-6 grid grid-cols-4 gap-3">
            <Tile label="Focus" value={focus === null ? undefined : hoursAndMinutes(focus)} />
            <Tile label="To read" />
            <Tile label="Threads" />
            <Tile label="Sources" />
          </div>

          <Section title="Time">
            <Timeline usage={usage} />
          </Section>
          <Section title="To do">
            <Skeleton className="h-24 w-full" />
          </Section>
          <Section title="Brief">
            <Skeleton className="h-32 w-full" />
          </Section>
          <Section title="Read today">
            <Skeleton className="h-20 w-full" />
          </Section>
          <Section title="Wrap up">
            <Skeleton className="h-20 w-full" />
          </Section>
        </div>
      </div>
    </div>
  );
}

/** Tue, Sep 8 — the page is a date, and the date is the only thing above it. */
function dateLine() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * A number about me, not about the world. "150 pieces fetched" is not news;
 * "three unread, the oldest five days old" changes what the morning looks like.
 */
function Tile({ label, value }: { label: string; value?: string }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        {value ? (
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        ) : (
          <Skeleton className="h-8 w-16" />
        )}
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-slot="today-section" data-title={title} className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}
