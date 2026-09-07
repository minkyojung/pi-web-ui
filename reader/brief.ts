import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { open, READER_DIR, type Row } from "./store.ts";
import { readSubscriptions } from "./fetch.ts";

export const BRIEFS_DIR = join(READER_DIR, "briefs");

/**
 * 한 글이 브리핑에 실려 갈 때의 모습. 본문 전체가 아니라 읽을 거리 한 토막인데,
 * 그 토막이 피드가 준 소개글일 수도 본문의 첫머리일 수도 있다. 어느 쪽이었는지를
 * 남기는 건 취향이 아니라 측정이다 — 소개글만으로 되는지가 이번에 볼 것이다.
 */
type Piece = { id: number; title: string; host: string; score: number | null; blurb: string; from: "summary" | "text" | "none" };

const host = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

/**
 * 하루치를 모은다. 장부와 파일 양쪽에서 오고, 같은 글이 둘 다에 있을 수 있어서
 * (서버가 옆에서 돌면 그렇게 된다) 아이디로 한 번 접는다. 본문이 있는 쪽을 남긴다.
 */
export function gather(hours: number, chars: number): Piece[] {
  const lib = open();
  const since = Date.now() - hours * 3600000;
  // 구독을 끊은 곳의 글은 서재에 남아 있어도 브리핑에 오르지 않는다. 끊는다는
  // 것은 "더는 안 가져온다"가 아니라 "더는 안 본다"는 뜻이라, 어제 받아둔 것에도
  // 걸려야 한다. 안 그러면 소스를 뺀 효과가 하루 늦게 나타난다.
  const subscribed = new Set(readSubscriptions().map((s) => (s.kind === "hn" ? "hn" : s.url)));
  const rows = lib
    .all()
    .filter((r) => (r.published_at ?? r.first_seen) >= since)
    .filter((r) => subscribed.has(r.source) || r.source === "saved");

  const byId = new Map<number, Row>();
  for (const r of rows) {
    const had = byId.get(r.id);
    if (!had || (!had.has_text && r.has_text)) byId.set(r.id, r);
  }

  return [...byId.values()].map((r) => {
    // 소개글이 먼저다. 본문이 있어도 그렇다 — 이번에 재려는 것이 "소개글만으로
    // 브리핑이 되는가"이므로, 본문이 있다고 슬쩍 좋은 재료를 쓰면 답이 흐려진다.
    const summary = (r as Row & { summary?: string }).summary;
    if (summary) return piece(r, clip(summary, chars), "summary");
    const text = r.has_text ? lib.get(r.id)?.text : null;
    if (text) return piece(r, clip(text.replace(/\s+/g, " ").trim(), chars), "text");
    return piece(r, "", "none");
  });
}

const piece = (r: Row, blurb: string, from: Piece["from"]): Piece =>
  ({ id: r.id, title: r.title, host: host(r.url), score: r.score, blurb, from });

/** 모델에게 건네는 재료. 한 글이 한 줄이고, 아이디가 인용의 유일한 열쇠다. */
function sheet(pieces: Piece[]): string {
  return pieces
    .map((p) => `[${p.id}] (${p.host}${p.score ? `, HN ${p.score}` : ""}) ${p.title}${p.blurb ? `\n    ${p.blurb}` : ""}`)
    .join("\n");
}

const PROMPT = `아래는 지난 하루 동안 HN·기술 매체·회사 블로그에서 들어온 글 목록입니다.
각 줄은 [아이디] (출처, 있으면 HN 점수) 제목 이고, 그 아래 들여쓴 줄이 소개글이나 본문 첫머리입니다.

이걸로 **아침 브리핑 한 장**을 마크다운으로 쓰세요.

## 칸을 셋으로 나눕니다

\`## 기술\` — 6~8개. 만들어진 것, 발표된 것, 밝혀진 것, 바뀐 규칙.
\`## 세상\` — **최대 3줄.** 기술이 아닌 큰 사건. HN에 올라올 만큼 컸던 것만.
\`## 그 밖에\` — 5줄. 위에 안 들어갔지만 눈에 띄는 것.

칸을 나누는 기준은 **출처가 아니라 글의 내용**입니다. HN에는 둘 다 올라오고,
기술 매체도 정치를 씁니다. 어느 칸인지는 그 글이 무엇에 대한 것인지가 정합니다.

## 항목 쓰는 법

- **굵은 한 줄** — 무슨 일이 있었는지. 사실만. "~에 대한 논의가 있었다"는 쓰지 마세요.
- 두세 문장 — 왜 중요한지. 매체마다 말이 다르면 그 지점.
- 끝에 근거를 아이디로: \`[12] [45] [88]\`

## 규칙

1. **글 단위가 아니라 사건 단위.** 여러 곳이 같은 일을 다뤘으면 한 항목입니다.
   글이 150개여도 항목은 15줄 안쪽이어야 합니다. 목록을 옮겨 적지 마세요.
2. **한 글은 한 항목에만.** 같은 아이디가 두 곳에 나오면 안 됩니다.
3. **아이디는 위 목록에 있는 것만.** 지어내지 마세요.
4. **재료가 제목뿐인 글은, 제목이 분명할 때만.** 추측해서 채우지 마세요.
   무슨 글인지 모르겠으면 쓰지 말고 넘어가세요 — 틀린 한 줄이 빠진 한 줄보다 나쁩니다.

머리말·맺음말·사과 없이 브리핑만 출력하세요.`;

/**
 * 밤마다 도는 일이라 모델을 정해둔다. 안 정하면 pi가 그때 쓸 수 있는 것 중
 * 첫 번째를 집는데, 그건 고른 것이 아니라 걸린 것이다 — 어느 날 목록이 바뀌면
 * 브리핑이 조용히 다른 모델로 갈아타고, 비용도 품질도 어제와 달라진다.
 */
export const MODEL = process.env.BRIEF_MODEL ?? "openai/gpt-5.4";

/** 한 번의 호출. 도구도 세션도 남기지 않는다 — 재료를 넣고 글 한 장을 받는다. */
async function ask(text: string): Promise<string> {
  const modelRuntime = await ModelRuntime.create();
  const [provider, ...rest] = MODEL.split("/");
  const id = rest.join("/");
  const model = modelRuntime
    .getAvailableSnapshot()
    .flat()
    .find((m) => m && m.provider === provider && m.id === id);
  if (!model) throw new Error(`쓸 수 없는 모델: ${MODEL}`);
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    model,
    tools: [],
  });
  let out = "";
  // 모델이 답을 안 주고 끝나는 길이 여럿이다 (한도 초과, 제공자 오류, 중단).
  // 그 셋이 다 "빈 파일"로 보이면 무엇을 고쳐야 할지 알 수가 없다.
  let failed: string | null = null;
  session.subscribe((e) => {
    if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta")
      out += e.assistantMessageEvent.delta;
    if (e.type === "message_end" && e.message.role === "assistant" && e.message.stopReason !== "stop")
      failed = `${e.message.stopReason}: ${e.message.errorMessage ?? ""}`;
  });
  await session.prompt(text);
  if (failed) throw new Error(failed);
  if (!out.trim()) throw new Error("모델이 빈 답을 돌려줬다");
  return out.trim();
}

/**
 * 인용을 링크로 바꾼다. 없는 아이디가 섞이면 조용히 지우지 않고 남겨서 세어둔다 —
 * 브리핑이 지어낸 문장을 쓰는지가 읽을 만한지보다 먼저 볼 것이다.
 */
export function link(md: string, pieces: Piece[]): { md: string; unknown: number[] } {
  const by = new Map(pieces.map((p) => [p.id, p]));
  const unknown: number[] = [];
  const out = md.replace(/\[(\d+)\]/g, (whole, n) => {
    const p = by.get(Number(n));
    if (!p) { unknown.push(Number(n)); return `${whole}⚠`; }
    // 앱 안에서의 이동이라 주소가 아니라 조각이다. 포트에도 안 매이고, 누르면
    // 앱의 hashchange가 그 글을 연다 — 브리핑에서 원문으로 내려가는 계단.
    return `[${p.host}](#${p.id})`;
  });
  return { md: out, unknown };
}

/**
 * 브리핑만을 위한 아주 좁은 변환. 프롬프트가 요구하는 모양(제목·목록·굵게·
 * 인라인 코드·링크)만 다룬다. 일반 마크다운 변환기가 아니고, 그럴 필요도 없다 —
 * 이 글을 쓰는 것도 우리고 읽는 것도 우리다.
 */
export function toHtml(md: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t: string) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((#\d+)\)/g, '<a href="$2">$1</a>');

  const out: string[] = [];
  let open_ = false;   // 열려 있는 <li>
  let list = false;    // 열려 있는 <ul>
  const endItem = () => { if (open_) { out.push("</li>"); open_ = false; } };
  const endList = () => { endItem(); if (list) { out.push("</ul>"); list = false; } };

  for (const raw of md.split("\n")) {
    const line = raw.trim();
    // 빈 줄은 항목을 끝내지만 목록을 끝내지는 않는다. 항목 사이가 한 줄 비어
    // 있는 글이라, 빈 줄에서 목록을 닫으면 항목마다 목록이 새로 열린다.
    if (!line) { endItem(); continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { endList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      endItem();
      if (!list) { out.push("<ul>"); list = true; }
      out.push(`<li>${inline(li[1])}`);
      open_ = true;
      continue;
    }
    // 이어지는 줄. 항목 안이면 그 항목에 붙고, 아니면 그냥 문단이다.
    if (open_) out.push(` ${inline(line)}`);
    else { endList(); out.push(`<p>${inline(line)}</p>`); }
  }
  endList();
  return out.join("\n");
}

/**
 * 인용이 진짜 그 글을 가리키는지 따로 한 번 더 묻는다.
 *
 * 낱말이 겹치는지로 재봤지만 안 됐다. 브리핑은 한국어로 쓰이고 원문은 영어라,
 * 맞는 인용에도 겹치는 글자가 없다 — 27개 중 6개를 틀렸다고 했고, 정작 지어낸
 * 인용 셋 중 둘은 통과시켰다. 뜻이 통하는지는 뜻을 읽는 쪽만 볼 수 있다.
 *
 * 쓴 것을 쓴 자리에서 검사하지 않는다. 호출을 나누면 브리핑을 쓰느라 세운 근거를
 * 다시 들고 오지 않고, 글과 제목만 놓고 본다.
 */
const CHECK = `아래는 아침 브리핑과, 거기 인용된 글들의 제목입니다.

각 인용 \`(#숫자)\`가 **그 문장의 근거가 되는지** 보세요.

근거가 안 되는 것만 한 줄씩 쓰세요:

    #숫자 | 왜 아닌지 (열 자 안팎)

판단 기준:
- 그 글이 그 문장이 말하는 사건과 **다른 사건**이면 근거가 아닙니다.
- 같은 사건을 다른 각도로 다뤘으면 근거가 **맞습니다**.
- 브리핑은 한국어, 제목은 영어입니다. **글자가 겹치지 않는 건 문제가 아닙니다.**

전부 근거가 되면 \`없음\` 한 줄만 쓰세요. 다른 말은 하지 마세요.`;

export type Doubt = { id: number; why: string };

export async function audit(md: string, pieces: Piece[]): Promise<Doubt[]> {
  const by = new Map(pieces.map((p) => [p.id, p]));
  const ids = [...new Set([...md.matchAll(/\(#(\d+)\)/g)].map((m) => Number(m[1])))];
  const cited = ids.map((id) => by.get(id)).filter((p): p is Piece => !!p);
  if (!cited.length) return [];

  const list = cited.map((p) => `#${p.id} (${p.host}) ${p.title}`).join("\n");
  const said = await ask(`${CHECK}\n\n--- 브리핑\n\n${md}\n\n--- 인용된 글\n\n${list}`);

  return [...said.matchAll(/#(\d+)\s*\|\s*(.+)/g)]
    .map((m) => ({ id: Number(m[1]), why: m[2].trim() }))
    .filter((d) => by.has(d.id));
}

const by = (pieces: Piece[], id: number) => pieces.find((p) => p.id === id)?.title.slice(0, 50) ?? "?";

export async function brief(hours: number, chars: number, log = console.log) {
  const pieces = gather(hours, chars);
  const from = { summary: 0, text: 0, none: 0 };
  for (const p of pieces) from[p.from]++;
  log(`지난 ${hours}시간: 글 ${pieces.length}개 (소개글 ${from.summary} · 본문머리 ${from.text} · 제목만 ${from.none})`);

  const material = sheet(pieces);
  log(`재료 ${Math.round(material.length / 1000)}k자 ≈ ${Math.round(material.length / 3000)}k 토큰 · ${MODEL}\n`);

  const md = await ask(`${PROMPT}\n\n---\n\n${material}`);
  const { md: linked, unknown } = link(md, pieces);
  if (unknown.length) log(`⚠ 목록에 없는 아이디 ${unknown.length}개: ${unknown.slice(0, 10).join(", ")}`);

  const doubts = await audit(linked, pieces);
  if (doubts.length) {
    log(`⚠ 근거가 그 글 같지 않은 인용 ${doubts.length}개:`);
    for (const d of doubts) log(`   #${d.id} ${by(pieces, d.id)} — ${d.why}`);
  } else log("근거 검사: 통과");

  const day = new Date().toISOString().slice(0, 10);
  mkdirSync(BRIEFS_DIR, { recursive: true });
  const path = join(BRIEFS_DIR, `${day}.md`);
  writeFileSync(path, `${linked}\n`);

  // 서재의 글로도 넣는다. 브리핑을 위한 화면을 따로 만들지 않아도 목록 맨 위에
  // 서고, 읽기 칸이 그대로 그리고, 인용을 누르면 그 글로 내려간다. 하루에 하나라
  // 주소를 날짜로 두면 다시 돌려도 덮어쓴다.
  const lib = open();
  const { id } = lib.see({
    url: `pi://brief/${day}`,
    title: `아침 브리핑 · ${day}`,
    source: "brief",
    published_at: Date.now(),
    status: "pending",
  });
  lib.save(id, "ok", toHtml(linked), linked, "brief");
  lib.flush();

  log(`\n${path}`);
  log(`앱에서: #${id}`);
  return path;
}
