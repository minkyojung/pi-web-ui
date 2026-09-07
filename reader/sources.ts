import Parser from "rss-parser";
import type { Item } from "./store.ts";
import { readSettings } from "../settings.ts";

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

/**
 * 며칠까지 거슬러 받을 것인가. 몇몇 피드는 최근 것이 아니라 과거 전체를 준다
 * (OpenAI 1172개, HuggingFace 859개). 처음 한 번만 쏟아지고 마는 게 아니라,
 * 그만큼이 장부에 그대로 남아 오늘 들어온 것을 덮는다. 그래서 이 숫자는
 * 취향이 아니라 손잡이다 — 설정에서 정하고, 피드마다 다시 읽는다.
 */
export async function fromRss(sub: Extract<Subscription, { kind: "rss" }>): Promise<Item[]> {
  const feed = await rss.parseURL(sub.url);
  const since = Date.now() - readSettings().feedDays * 86400000;
  return (feed.items ?? [])
    .filter((e) => e.link && e.title)
    // 날짜가 없는 피드도 있다. 모르는 것을 오래된 것으로 치지는 않는다.
    .filter((e) => !e.isoDate || Date.parse(e.isoDate) >= since)
    .map((e) => ({
      url: e.link!,
      title: e.title!,
      source: sub.url,
      published_at: e.isoDate ? Date.parse(e.isoDate) : null,
      // 피드가 링크와 함께 건네는 소개글. 본문을 받지 않기로 한 글에게는
      // 이것이 읽을 수 있는 전부라, 버리면 그 글은 제목뿐이 된다.
      summary: blurb(e),
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

/**
 * 피드마다 소개글을 두는 칸이 다르다. rss-parser가 태그를 벗겨 주는
 * contentSnippet을 먼저 쓰고, 없으면 남은 칸에서 직접 벗긴다.
 */
function blurb(e: { contentSnippet?: string; summary?: string; content?: string }): string | null {
  const raw = e.contentSnippet ?? e.summary ?? e.content ?? "";
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  // 전문을 통째로 싣는 피드가 있다. 소개글 자리에 기사 하나가 들어오면
  // 장부가 부풀고, 어차피 그만큼은 안 읽는다.
  return text.length > 1200 ? text.slice(0, 1200) + "…" : text;
}
