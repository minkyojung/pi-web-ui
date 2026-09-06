import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open, READER_DIR, SUBSCRIPTIONS_PATH } from "./store.ts";
import { fromHn, fromRss, pool, type Subscription } from "./sources.ts";
import { extract, toText } from "./extract.ts";

/** A first run has nothing to read from; start it on HN so the screen is not empty. */
const DEFAULT_SUBSCRIPTIONS: Subscription[] = [{ kind: "hn", minScore: 50 }];

export function readSubscriptions(): Subscription[] {
  if (!existsSync(SUBSCRIPTIONS_PATH)) {
    mkdirSync(READER_DIR, { recursive: true });
    writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify(DEFAULT_SUBSCRIPTIONS, null, 2) + "\n");
  }
  return JSON.parse(readFileSync(SUBSCRIPTIONS_PATH, "utf8"));
}

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
 */
export async function fetchFeed(log: (line: string) => void = () => {}): Promise<FetchReport> {
const subs = readSubscriptions();
const lib = open();
const report: FetchReport = { sources: [], added: 0, fetched: {}, total: 0, withText: 0 };

// 1. 구독마다 항목을 긁어온다
const collected = [];
for (const sub of subs) {
  try {
    const items = sub.kind === "hn" ? await fromHn(sub) : await fromRss(sub);
    collected.push({ sub, items });
    report.sources.push({ label: label(sub), count: items.length });
    log(`  ${label(sub)} → ${items.length}개`);
  } catch (e) {
    report.sources.push({ label: label(sub), count: null, error: (e as Error).message });
    log(`  ${label(sub)} → 실패: ${(e as Error).message}`);
  }
}

// 2. 서재에 넣는다. 이미 있으면 점수만 갱신 (HN 점수는 계속 오른다)
let added = 0;
const needText: { id: number; url: string }[] = [];
for (const { sub, items } of collected) {
  const minScore = sub.kind === "hn" ? sub.minScore : 0;
  for (const it of items) {
    const { id, isNew, status } = lib.see(it);
    if (isNew) added++;

    // HN API가 본문을 직접 준 것(Ask HN 등)은 바로 확정
    // HN API가 준 본문은 이미 HTML 조각이다.
    if (isNew && it.text) { lib.save(id, "ok", it.text, toText(it.text), "hn_text"); continue; }

    // 점수가 기준에 못 미치면 본문을 안 받는다. 제목만 남겨두고,
    // 나중에 점수가 오르면 그때 받는다. 제목만 두는 건 거의 공짜다.
    if ((it.score ?? Infinity) < minScore) continue;

    if (status === "pending") needText.push({ id, url: it.url });
  }
}

// 아이디는 여기서만 나눠준다. 본문을 받다 죽어도 아이디가 겹치지 않도록,
// 3단계로 넘어가기 전에 장부를 먼저 적어둔다.
lib.flush();

report.added = added;
log(`\n새로 들어온 것 ${added}개 · 본문 받을 것 ${needText.length}개\n`);

// 3. 본문을 받는다
const tally: Record<string, number> = {};
await pool(needText, 8, async ({ id, url }) => {
  const r = await extract(url);
  lib.save(id, r.status, r.html, r.text, r.kind);
  tally[r.status] = (tally[r.status] ?? 0) + 1;
});

for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
  log(`  ${k.padEnd(14)} ${v}`);
report.fetched = tally;

lib.flush();
const { total, withText } = lib.counts();
report.total = total;
report.withText = withText;
log(`\n서재 전체 ${total}개 · 본문 있는 것 ${withText}개`);
return report;
}

function label(s: Subscription) {
  return s.kind === "hn" ? `hn(best, ${s.minScore}점+)` : s.url;
}
