import { useEffect, useState } from "react";

export type App = { key: string; name: string };
export type Hour = { hour: string } & Record<string, string | number>;
export type Total = App & { minutes: number };

export type Usage =
  | { ok: true; apps: App[]; hours: Hour[]; totals: Total[] }
  | { ok: false; reason: "permission" | "missing" };

export type Day = { usage: Usage };

/**
 * The day, asked for once.
 *
 * Not refreshed on a timer: the numbers move by a minute a minute, which is
 * not worth a page that changes while it is being read. Reopening the page
 * asks again, and that is the moment someone wants it current.
 */
export function useDay() {
  const [day, setDay] = useState<Day | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/today")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Day | null) => {
        if (live) setDay(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return day;
}

/** 4h 12m, and just 8m under the hour: the hour is noise when there isn't one. */
export function hoursAndMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
