import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { YoutubeTranscript } from "youtube-transcript";
import { toMarkdown } from "./markdown.ts";
import { markSpans } from "./spans.ts";
import type { Status } from "./store.ts";

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
  text: string | null;   // 모델 입력용. 마크다운이라 뼈대가 남는다
  kind: string | null;
  /** 페이지가 말하는 제목. 피드는 제목을 주지만 붙여넣은 주소는 이것뿐이다. */
  title: string | null;
  /** 리다이렉트를 다 따라간 끝의 주소. 출발한 곳과 같으면 null. */
  resolved: string | null;
};

const empty = (status: Status, kind: string | null = null): Extracted =>
  ({ status, html: null, text: null, kind, title: null, resolved: null });

/** HTML 조각을 읽을 수 있는 글로 바꾼다 (HN 본문처럼 이미 HTML인 것들용). */
export const toText = toMarkdown;

/**
 * `force` walks past EXCLUDED. That list is about not spending fetches on a
 * feed's two hundred links; a url someone handed over on its own is not spent
 * on, it is asked for.
 */
export async function extract(url: string, opts: { force?: boolean } = {}): Promise<Extracted> {
  let host: string;
  try { host = new URL(url).hostname.replace(/^www\./, ""); }
  catch { return empty("failed"); }

  if (!opts.force && EXCLUDED.some((d) => host === d || host.endsWith("." + d)))
    return empty("excluded");

  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com"))
    return youtube(url);

  return html(url);
}

async function youtube(url: string): Promise<Extracted> {
  // The transcript library has no title; oEmbed has, without a key, and its
  // failing is no reason to lose the transcript.
  const title = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
    signal: AbortSignal.timeout(10000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { title?: string } | null) => j?.title?.trim() || null)
    .catch(() => null);
  try {
    const parts = await YoutubeTranscript.fetchTranscript(url);
    if (!parts?.length) return { ...empty("no_transcript", "youtube"), title };
    // 자막에는 문단이 없다. 대신 시각을 남겨야 "40분 중 12~19분"이 가능해진다.
    const text = parts
      .map((p) => `[${fmt(p.offset)}] ${p.text}`)
      .join("\n");
    // 자막은 원래 구조가 없으므로 html도 같은 텍스트다.
    return { status: "ok", html: null, text, kind: "youtube", title, resolved: null };
  } catch {
    return { ...empty("no_transcript", "youtube"), title };
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

  // 도착한 주소. 막힌 페이지라도 어디서 막혔는지는 안다.
  const resolved = res.url && res.url !== url ? res.url : null;
  const at = (e: Extracted): Extracted => ({ ...e, resolved });

  // 401/402/403. 페이월인지 봇 차단인지는 구분이 안 되므로 뭉뚱그린다.
  // 제목은 이미 있으니 표시만 남기고 넘어간다.
  if (res.status === 401 || res.status === 402 || res.status === 403)
    return at(empty("blocked", "html"));
  if (!res.ok) return at(empty("failed", "html"));
  // 202 등 200이 아닌 2xx. 페이지가 아니라 "지금은 못 준다"는 대답이라, 파싱해
  // 봐야 본문이 없다. failed로 적으면 원인이 사라지므로 blocked로 둔다.
  if (res.status !== 200) return at(empty("blocked", "html"));

  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) return at(empty("failed", type.split(";")[0]));

  const body = await res.text();
  try {
    // jsdom이 CSS 파싱 경고를 쏟아내는데, 본문만 쓸 거라 무시한다.
    const dom = new JSDOM(body, { url, virtualConsole: new VirtualConsole() });
    // <title>은 Readability가 본문을 못 찾아도 있다. 막힌 글에도 이름은 붙는다.
    const title = dom.window.document.title?.trim() || null;
    const article = new Readability(dom.window.document).parse();
    // 표시를 여기서 붙여둔다. 화면은 저장된 것을 그대로 그리면 된다.
    const html = markSpans(article?.content?.trim() ?? "");
    // textContent는 글자만 이어붙여 문단을 잃는다. 구조를 걸어서 만든다.
    const text = html ? toMarkdown(html) : "";
    // 길이로 성공/실패를 가르지 않는다. 짧은 글도 있고, 자바스크립트로 그리는
    // 페이지도 있다. 구분이 안 되므로 판단은 나중으로 미루고 있는 그대로 저장한다.
    if (!text) return at({ ...empty("failed", "html"), title });
    return {
      status: "ok", html: html || null, text, kind: "html",
      title: article?.title?.trim() || title, resolved,
    };
  } catch {
    return at(empty("failed", "html"));
  }
}
