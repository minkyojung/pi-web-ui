import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open, READER_DIR, SUBSCRIPTIONS_PATH } from "./store.ts";
import { fromHn, fromRss, pool, type Subscription } from "./sources.ts";
import { extract, toText } from "./extract.ts";

/** A first run has nothing to read from; start it on HN so the screen is not empty. */
const DEFAULT_SUBSCRIPTIONS: Subscription[] = [{ kind: "hn" }];

export function readSubscriptions(): Subscription[] {
  if (!existsSync(SUBSCRIPTIONS_PATH)) {
    mkdirSync(READER_DIR, { recursive: true });
    writeSubscriptions(DEFAULT_SUBSCRIPTIONS);
  }
  return JSON.parse(readFileSync(SUBSCRIPTIONS_PATH, "utf8"));
}

/**
 * 구독 목록을 통째로 갈아 끼운다. 손으로 고치던 파일이 그대로 남는 것이
 * 중요해서, 들여쓰기까지 첫 실행이 써 두는 모양과 맞춘다 — UI로 한 줄
 * 더했다고 파일 전체가 한 줄로 뭉개지면 다음에 열어볼 수가 없다.
 */
export function writeSubscriptions(subs: Subscription[]): void {
  mkdirSync(READER_DIR, { recursive: true });
  writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify(subs, null, 2) + "\n");
}

/**
 * 한 구독을 가리키는 열쇠. 장부의 `source` 칸에 적히는 것과 같은 값이라,
 * 브리핑이 "아직 구독 중인가"를 이것으로 물어본다 (brief.ts의 subscribed).
 */
export const subKey = (s: Subscription): string => (s.kind === "hn" ? "hn" : s.url);

export type FetchReport = {
  sources: { label: string; count: number | null; error?: string }[];
  added: number;
  fetched: Record<string, number>;
  total: number;
  withText: number;
};

/**
 * One pass over every subscription. Safe to run again: a url is seen once, and
 * a story already in the library only has its score refreshed.
 *
 * `subs` is what to walk, and defaults to all of them. A caller passes one when
 * it has just been handed a single feed and wants that feed's pieces now rather
 * than at the next full pass.
 */
export async function fetchFeed(
  log: (line: string) => void = () => {},
  subs: Subscription[] = readSubscriptions(),
): Promise<FetchReport> {
const lib = open();
const report: FetchReport = { sources: [], added: 0, fetched: {}, total: 0, withText: 0 };

// 1. 구독마다 항목을 긁어온다
const collected = [];
for (const sub of subs) {
  try {
    const items = sub.kind === "hn" ? await fromHn() : await fromRss(sub);
    collected.push({ sub, items });
    report.sources.push({ label: label(sub), count: items.length });
    log(`  ${label(sub)} → ${items.length}`);
  } catch (e) {
    report.sources.push({ label: label(sub), count: null, error: (e as Error).message });
    log(`  ${label(sub)} → failed: ${(e as Error).message}`);
  }
}

// 2. 서재에 넣는다. 이미 있으면 점수만 갱신 (HN 점수는 계속 오른다)
let added = 0;
const needText: { id: number; url: string }[] = [];
for (const { items } of collected) {
  for (const it of items) {
    const { id, isNew, status } = lib.see(it);
    if (isNew) added++;

    // HN API가 본문을 직접 준 것(Ask HN 등)은 바로 확정
    // HN API가 준 본문은 이미 HTML 조각이다.
    if (isNew && it.text) { lib.save(id, "ok", it.text, toText(it.text), "hn_text"); continue; }

    if (status === "pending") needText.push({ id, url: it.url });
  }
}

// 아이디는 여기서만 나눠준다. 본문을 받다 죽어도 아이디가 겹치지 않도록,
// 3단계로 넘어가기 전에 장부를 먼저 적어둔다.
lib.flush();

report.added = added;
log(`\nnew ${added} · to fetch ${needText.length}\n`);

// 3. 본문을 받는다
const tally: Record<string, number> = {};
await pool(needText, 8, async ({ id, url }) => {
  const r = await extract(url);
  lib.save(id, r.status, r.html, r.text, r.kind, r.resolved);
  tally[r.status] = (tally[r.status] ?? 0) + 1;
});

for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
  log(`  ${k.padEnd(14)} ${v}`);
report.fetched = tally;

lib.flush();
const { total, withText } = lib.counts();
report.total = total;
report.withText = withText;
log(`\nlibrary ${total} · with text ${withText}`);
return report;
}

export function label(s: Subscription) {
  return s.kind === "hn" ? "hn(best)" : s.url;
}
