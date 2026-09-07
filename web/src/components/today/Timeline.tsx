import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { hoursAndMinutes, type Usage } from "@/today";

/**
 * The day as hours, stacked by app.
 *
 * Horizontal, so the hours read down the side the way a calendar does and an
 * app's name has room to sit beside its band. The five colours are the five
 * the stylesheet defines; a sixth app would be a colour invented here, so the
 * server folds everything past the fifth into one band instead.
 */
export function Timeline({ usage }: { usage: Usage | null }) {
  if (!usage) return <Skeleton className="h-64 w-full" />;
  if (!usage.ok) return <NoAccess reason={usage.reason} />;
  if (usage.totals.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing yet today.</p>;
  }

  const colour = (i: number) => `var(--chart-${(i % 5) + 1})`;
  const config: ChartConfig = Object.fromEntries(
    usage.apps.map((app, i) => [app.key, { label: app.name, color: colour(i) }]),
  );

  return (
    <>
      {/* A row per hour, at a fixed height each: a morning and a whole day are
          the same page, and one of them should not be drawn on stilts. */}
      <ChartContainer
        config={config}
        className="w-full"
        style={{ height: usage.hours.length * 26 + 8 }}
      >
        <BarChart accessibilityLayer data={usage.hours} layout="vertical" margin={{ left: 4, right: 8 }}>
          <CartesianGrid horizontal={false} />
          <YAxis
            dataKey="hour"
            type="category"
            tickLine={false}
            axisLine={false}
            width={28}
            tickMargin={4}
            className="text-xs"
          />
          {/* An hour is sixty minutes whether or not any of them were spent, so
              the axis is fixed rather than scaled to the busiest hour — a bar
              half across the page means half an hour, on every day. */}
          <XAxis type="number" domain={[0, 60]} hide />
          <ChartTooltip content={<ChartTooltipContent />} />
          {usage.apps.map((app, i) => (
            <Bar
              key={app.key}
              dataKey={app.key}
              stackId="hour"
              fill={`var(--color-${app.key})`}
              radius={i === usage.apps.length - 1 ? [0, 2, 2, 0] : 0}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {/* The legend and the totals are one line, not two: a swatch beside a name
          says which band it is, and the number beside it is what anyone came to
          the chart for anyway. */}
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {usage.totals.map((t, i) => (
          <li key={t.key} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: colour(i) }} />
            {t.name} <span className="tabular-nums text-foreground">{hoursAndMinutes(t.minutes)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The one thing that can go wrong here, said plainly.
 *
 * macOS keeps this record for every app and hands it to none of them without
 * being told to, so an empty page would be the wrong answer: nothing is broken
 * and there is one thing to do about it.
 */
function NoAccess({ reason }: { reason: "permission" | "missing" }) {
  if (reason === "missing") {
    return (
      <Alert>
        <AlertTitle>No record to read</AlertTitle>
        <AlertDescription>
          macOS keeps app usage in Screen Time, and this Mac has none written yet.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>Full Disk Access needed</AlertTitle>
      <AlertDescription>
        <span>
          The record is on this Mac and stays on it. System Settings → Privacy &amp; Security → Full Disk
          Access, then add pi and reopen it.
        </span>
      </AlertDescription>
    </Alert>
  );
}
