import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { YoutubeTranscript } from "youtube-transcript";
import type { Status } from "./db.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** 본문을 가져올 가치가 없는 곳. 기사가 아니거나(코드) 가져올 수 없는 곳(X). */
export const EXCLUDED = [
  "github.com", "gitlab.com",
  "twitter.com", "x.com",
  "news.ycombinator.com", // 본문은 HN API에서 이미 받아둠
];

export type Extracted = {
  status: Status;
  html: string | null;   // 화면용. 소제목·코드·표가 살아있다
  text: string | null;   // 2단계 모델 입력용
  kind: string | null;
};

const empty = (status: Status, kind: string | null = null): Extracted =>
  ({ status, html: null, text: null, kind });

/** HTML 조각에서 순수 텍스트만 뽑는다 (HN 본문처럼 이미 HTML인 것들용). */
export function toText(html: string): string {
  return new JSDOM(`<body>${html}</body>`, { virtualConsole: new VirtualConsole() })
    .window.document.body.textContent?.trim() ?? "";
}

export async function extract(url: string): Promise<Extracted> {
  let host: string;
  try { host = new URL(url).hostname.replace(/^www\./, ""); }
  catch { return empty("failed"); }

  if (EXCLUDED.some((d) => host === d || host.endsWith("." + d)))
    return empty("excluded");

  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com"))
    return youtube(url);

  return html(url);
}

async function youtube(url: string): Promise<Extracted> {
  try {
    const parts = await YoutubeTranscript.fetchTranscript(url);
    if (!parts?.length) return empty("no_transcript", "youtube");
    // 자막에는 문단이 없다. 대신 시각을 남겨야 "40분 중 12~19분"이 가능해진다.
    const text = parts
      .map((p) => `[${fmt(p.offset)}] ${p.text}`)
      .join("\n");
    // 자막은 원래 구조가 없으므로 html도 같은 텍스트다.
    return { status: "ok", html: null, text, kind: "youtube" };
  } catch {
    return empty("no_transcript", "youtube");
  }
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

async function html(url: string): Promise<Extracted> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return empty("failed");
  }

  // 401/402/403. 페이월인지 봇 차단인지는 구분이 안 되므로 뭉뚱그린다.
  // 제목은 이미 있으니 표시만 남기고 넘어간다.
  if (res.status === 401 || res.status === 402 || res.status === 403)
    return empty("blocked", "html");
  if (!res.ok) return empty("failed", "html");

  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) return empty("failed", type.split(";")[0]);

  const body = await res.text();
  try {
    // jsdom이 CSS 파싱 경고를 쏟아내는데, 본문만 쓸 거라 무시한다.
    const dom = new JSDOM(body, { url, virtualConsole: new VirtualConsole() });
    const article = new Readability(dom.window.document).parse();
    const html = article?.content?.trim() ?? "";
    const text = article?.textContent?.trim() ?? "";
    // 길이로 성공/실패를 가르지 않는다. 짧은 글도 있고, 자바스크립트로 그리는
    // 페이지도 있다. 구분이 안 되므로 판단은 나중으로 미루고 있는 그대로 저장한다.
    if (!text) return empty("failed", "html");
    return { status: "ok", html: html || null, text, kind: "html" };
  } catch {
    return empty("failed", "html");
  }
}
