import assert from "node:assert/strict";
import test from "node:test";

import { bucket } from "../today/usage.ts";

/** 2026-09-08, local, so the hour labels are the ones a person would read. */
const day = new Date(2026, 8, 8).getTime();
const at = (h, m = 0) => day + h * 3_600_000 + m * 60_000;

test("a stretch inside one hour lands in that hour", () => {
  const { apps, hours, totals } = bucket([{ app: "Cursor", start: at(9, 10), end: at(9, 50) }], day, at(11));
  assert.deepEqual(apps, [{ key: "cursor", name: "Cursor" }]);
  assert.deepEqual(totals, [{ key: "cursor", name: "Cursor", minutes: 40 }]);
  assert.deepEqual(hours, [{ hour: "09", cursor: 40 }, { hour: "10", cursor: 0 }]);
});

test("a stretch across the hour is cut at it, not filed under where it began", () => {
  const { hours } = bucket([{ app: "Cursor", start: at(9, 50), end: at(10, 20) }], day, at(11));
  assert.deepEqual(hours, [{ hour: "09", cursor: 10 }, { hour: "10", cursor: 20 }]);
});

test("hours before the first thing that happened are dropped", () => {
  const { hours } = bucket([{ app: "Cursor", start: at(9), end: at(9, 30) }], day, at(10));
  assert.deepEqual(hours.map((h) => h.hour), ["09"]);
});

test("an idle hour in the middle stays, because that is the point of the bar", () => {
  const { hours } = bucket(
    [
      { app: "Cursor", start: at(9), end: at(9, 30) },
      { app: "Cursor", start: at(11), end: at(11, 30) },
    ],
    day,
    at(12),
  );
  assert.deepEqual(hours.map((h) => h.hour), ["09", "10", "11"]);
  assert.equal(hours[1].cursor, 0);
});

test("what is outside the day is clipped rather than counted", () => {
  const { totals } = bucket([{ app: "Slack", start: day - 3_600_000, end: at(0, 30) }], day, at(1));
  assert.deepEqual(totals, [{ key: "slack", name: "Slack", minutes: 30 }]);
});

// The chart hands a series its colour through --color-<key>, so a name with a
// space in it cannot be the key. This is the reason keys exist at all.
test("a name a CSS property could not carry becomes one that can", () => {
  const { apps } = bucket([{ app: "Google Chrome", start: at(9), end: at(9, 30) }], day, at(10));
  assert.deepEqual(apps, [{ key: "google-chrome", name: "Google Chrome" }]);
});

test("two apps that slug the same still get a key each", () => {
  const { apps } = bucket(
    [
      { app: "Pi!", start: at(9), end: at(9, 30) },
      { app: "pi", start: at(9), end: at(9, 20) },
    ],
    day,
    at(10),
  );
  assert.deepEqual(apps.map((a) => a.key), ["pi", "pi-2"]);
});

test("past the fifth app the rest of the day is one band", () => {
  const spans = ["a", "b", "c", "d", "e", "f", "g"].map((app, i) => ({
    app,
    start: at(9),
    end: at(9, 60 - i * 5),
  }));
  const { apps, totals, hours } = bucket(spans, day, at(10));
  assert.deepEqual(apps.map((a) => a.name), ["a", "b", "c", "d", "e", "Other"]);
  // f took 35 minutes and g took 30, and the band is the two of them.
  assert.deepEqual(totals.at(-1), { key: "other", name: "Other", minutes: 65 });
  assert.equal(hours[0].other, 65);
});
