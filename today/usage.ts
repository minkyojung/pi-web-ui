import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * What the machine was doing today, from the record macOS already keeps.
 *
 * Screen Time writes every app's foreground stretch to knowledgeC.db with its
 * start and end, which is the same thing a tracker polling every ten seconds
 * would produce and less of a liberty than one. So nothing here watches: it
 * reads a file, read-only, and only the part of it that is today.
 */

const KNOWLEDGE = join(homedir(), "Library", "Application Support", "Knowledge", "knowledgeC.db");

/** Core Data counts seconds from 2001, not 1970. */
const EPOCH = 978_307_200;

/** Five, because the chart has five colours; the rest of the day is one band. */
const KEEP = 5;
const OTHER = "Other";

export type Span = { app: string; start: number; end: number };
/**
 * An app twice over: the name to print, and a key safe to put in a CSS custom
 * property, since that is how the chart hands a series its colour. "Google
 * Chrome" cannot be one and `--color-Google Chrome` is not a thing.
 */
export type App = { key: string; name: string };
/** One row per hour of the day, in the shape recharts stacks: minutes per key. */
export type Hour = { hour: string } & Record<string, string | number>;
export type Total = App & { minutes: number };

export type Usage =
  | { ok: true; apps: App[]; hours: Hour[]; totals: Total[] }
  | { ok: false; reason: "permission" | "missing" };

/** Local midnight. The day is the one the reader is in, not UTC's. */
export function dayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Spans into hours.
 *
 * A stretch that runs from 09:50 to 10:20 belongs to both, so it is cut at the
 * hour rather than filed under the one it started in — otherwise a long
 * afternoon in one app draws as a single tall bar at the hour it began.
 */
export function bucket(spans: Span[], from: number, to: number): { apps: App[]; hours: Hour[]; totals: Total[] } {
  const minutes = new Map<string, number[]>();
  const hourOf = (t: number) => Math.floor((t - from) / 3_600_000);
  const hours = Math.max(1, Math.ceil((to - from) / 3_600_000));

  for (const span of spans) {
    const start = Math.max(span.start, from);
    const end = Math.min(span.end, to);
    if (!(end > start)) continue;
    if (!minutes.has(span.app)) minutes.set(span.app, new Array(hours).fill(0));
    const row = minutes.get(span.app)!;
    for (let h = hourOf(start); h <= hourOf(end - 1); h++) {
      if (h < 0 || h >= hours) continue;
      const edge = from + h * 3_600_000;
      const overlap = Math.min(end, edge + 3_600_000) - Math.max(start, edge);
      row[h] += overlap / 60_000;
    }
  }

  const ranked = [...minutes]
    .map(([app, row]) => ({ app, minutes: Math.round(row.reduce((a, b) => a + b, 0)) }))
    .filter((t) => t.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  // Everything past the fifth app is one band. Named apps stay named — the
  // point of the bar is to recognise the day, and a legend of twenty entries
  // for four minutes each is not recognisable.
  const named = ranked.slice(0, KEEP).map((t) => t.app);
  const taken = new Set<string>();
  const apps: App[] = named.map((name) => ({ key: slug(name, taken), name }));
  if (ranked.length > KEEP) apps.push({ key: slug(OTHER, taken), name: OTHER });
  const keyOf = new Map(named.map((name, i) => [name, apps[i].key]));
  const other = ranked.length > KEEP ? apps.at(-1)!.key : null;

  const rows: Hour[] = [];
  for (let h = 0; h < hours; h++) {
    const at = new Date(from + h * 3_600_000);
    const row: Hour = { hour: String(at.getHours()).padStart(2, "0") };
    for (const app of apps) row[app.key] = 0;
    for (const [name, per] of minutes) {
      const key = keyOf.get(name) ?? other;
      if (key) row[key] = (row[key] as number) + per[h];
    }
    for (const app of apps) row[app.key] = Math.round(row[app.key] as number);
    rows.push(row);
  }

  // The hours before the day started are not part of it. Trimmed from the front
  // only: an idle hour in the middle is something the bar is meant to show, and
  // so is the one happening now.
  while (rows.length > 1 && apps.every((app) => rows[0][app.key] === 0)) rows.shift();

  const shown: Total[] = apps.map((app) => ({
    ...app,
    minutes: app.key === other
      ? ranked.slice(KEEP).reduce((a, t) => a + t.minutes, 0)
      : ranked.find((t) => t.app === app.name)!.minutes,
  }));
  return { apps, hours: rows, totals: shown };
}

/** A name a CSS custom property can carry, and no two the same. */
function slug(name: string, taken: Set<string>) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

/** Today's foreground stretches, or the reason there are none. */
export function readUsage(now = new Date()): Usage {
  if (!existsSync(KNOWLEDGE)) return { ok: false, reason: "missing" };
  const from = dayStart(now);
  const to = now.getTime();

  let rows: { app: string; s: number; e: number }[];
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(KNOWLEDGE, { readOnly: true });
  } catch {
    // The file is there and cannot be opened, which on this machine means one
    // thing: the app has not been given Full Disk Access.
    return { ok: false, reason: "permission" };
  }
  try {
    rows = db.prepare(
      `SELECT ZVALUESTRING AS app, ZSTARTDATE AS s, ZENDDATE AS e
         FROM ZOBJECT
        WHERE ZSTREAMNAME = '/app/usage' AND ZENDDATE > ? AND ZSTARTDATE < ?
        ORDER BY s`,
    ).all(from / 1000 - EPOCH, to / 1000 - EPOCH) as typeof rows;
  } catch {
    // Not a second guess at the same thing: SQLite does not touch the file
    // until it is asked something, so a refused read arrives here rather than
    // at the open above.
    return { ok: false, reason: "permission" };
  } finally {
    db.close();
  }

  const names = appNames(new Set(rows.map((r) => r.app)));
  const spans = rows.map((r) => ({
    app: names.get(r.app) ?? r.app,
    start: (r.s + EPOCH) * 1000,
    end: (r.e + EPOCH) * 1000,
  }));
  return { ok: true, ...bucket(spans, from, to) };
}

/**
 * Bundle ids into the names on the Dock.
 *
 * knowledgeC records com.tinyspeck.slackmacgap, which is not what anyone calls
 * Slack, and the id alone cannot be turned into the name — the folder has to be
 * found. Spotlight would answer this in one question but is off in some places
 * and refused here, so the app folders are walked instead. The answer is kept,
 * since it changes about as often as an app is installed.
 */
const CACHE = join(homedir(), ".pi", "today", "apps.json");
const APP_DIRS = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", join(homedir(), "Applications")];

function appNames(ids: Set<string>): Map<string, string> {
  let known: Record<string, string> = {};
  try {
    known = JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string>;
  } catch {
    // No cache yet, or one written by an older shape of this.
  }
  if ([...ids].some((id) => !(id in known))) {
    known = { ...known, ...scanApps() };
    // An id no folder explains — an installer, a helper, something since
    // deleted — is written down as what it will be called, so that a single
    // stranger does not make every later request walk the folders again.
    for (const id of ids) known[id] ??= id.split(".").at(-1) ?? id;
    try {
      mkdirSync(join(CACHE, ".."), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(known));
    } catch {
      // A name that has to be worked out again next time is not worth failing over.
    }
  }
  return new Map([...ids].map((id) => [id, known[id] ?? id.split(".").at(-1) ?? id]));
}

function scanApps(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of APP_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".app")) continue;
      const plist = join(dir, entry, "Contents", "Info.plist");
      try {
        // plutil rather than a plist parser: most of these are binary, and the
        // tool that reads them is already on every Mac.
        const id = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (id) out[id] = entry.slice(0, -4);
      } catch {
        // Not an app bundle, or one without an identifier. Skipped, not fatal.
      }
    }
  }
  return out;
}
