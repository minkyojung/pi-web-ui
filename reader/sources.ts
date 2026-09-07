import Parser from "rss-parser";
import type { Item } from "./store.ts";

export type Subscription =
  | { kind: "hn" }
  | { kind: "rss"; url: string; title?: string };

const HN = "https://hacker-news.firebaseio.com/v0";

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

type HnStory = {
  id: number; type: string; title?: string; url?: string; text?: string;
  score?: number; descendants?: number; kids?: number[]; time?: number;
};

/** beststories 200개를 전부 가져온다. */
export async function fromHn(): Promise<Item[]> {
  const ids = await json<number[]>(`${HN}/beststories.json`);
  const stories = await pool(ids, 20, (id) => json<HnStory>(`${HN}/item/${id}.json`));

  return stories
    .filter((s): s is HnStory => !!s && s.type === "story" && !!s.title)
    .map((s) => ({
      url: s.url ?? `https://news.ycombinator.com/item?id=${s.id}`,
      title: s.title!,
      source: "hn",
      external_id: String(s.id),
      score: s.score ?? 0,
      comments: s.descendants ?? 0,
      comment_ids: s.kids ? JSON.stringify(s.kids) : null,
      published_at: s.time ? s.time * 1000 : null,
      // 본문이 HN 안에 있는 글(Ask HN 등)은 바로 채워둔다
      text: s.url ? null : (s.text ?? null),
      status: "pending" as const,
    }));
}

const rss = new Parser({ timeout: 20000 });

export async function fromRss(sub: Extract<Subscription, { kind: "rss" }>): Promise<Item[]> {
  const feed = await rss.parseURL(sub.url);
  return (feed.items ?? [])
    .filter((e) => e.link && e.title)
    .map((e) => ({
      url: e.link!,
      title: e.title!,
      source: sub.url,
      published_at: e.isoDate ? Date.parse(e.isoDate) : null,
      status: "pending" as const,
    }));
}

/** 동시 실행 개수를 제한한 map. 실패한 건 undefined. */
export async function pool<T, R>(
  xs: T[], limit: number, fn: (x: T) => Promise<R>
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, xs.length) }, async () => {
      while (i < xs.length) {
        const n = i++;
        try { out[n] = await fn(xs[n]); } catch { out[n] = undefined; }
      }
    })
  );
  return out;
}
