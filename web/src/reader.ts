export type Status =
  | "ok" | "pending" | "blocked" | "no_transcript" | "excluded" | "failed";

export type ListItem = {
  id: number;
  url: string;
  title: string;
  source: string;
  score: number | null;
  comments: number | null;
  published_at: number | null;
  first_seen: number;
  status: Status;
  kind: string | null;
  /** 이 글이 무엇을 주장하는가, 한 줄. pi가 set_gist로 남긴다. 아직 없으면 null. */
  gist: string | null;
  /** 화면이 남기는 표시. 참일 때만 온다 — 서재 대부분은 셋 다 없다. */
  read?: boolean;
  queued?: boolean;
  archived?: boolean;
  has_text: number;
};

export type FullItem = ListItem & { html: string | null; text: string | null };

export const when = (it: ListItem) => it.published_at ?? it.first_seen;

export const host = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

/** Today · Yesterday · Fri, Sep 4 */
export function dayLabel(ms: number) {
  const d = new Date(ms);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(new Date()) - midnight(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export const STATUS_LABEL: Partial<Record<Status, string>> = {
  blocked: "막힘",   // 페이월인지 봇 차단인지 구분이 안 되므로 단정하지 않는다
  failed: "본문 없음",
  no_transcript: "자막 없음",
  excluded: "본문 안 받음",
};
