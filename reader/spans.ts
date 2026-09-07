import { JSDOM, VirtualConsole } from "jsdom";

/**
 * 본문 폭을 넘길 "의도"를 가진 요소에 표시를 붙인다.
 *
 * 화면 쪽에서 매번 판단할 수도 있지만, 여기서 하면 한 번만 하고 저장된다.
 * 대신 여기에는 레이아웃 엔진이 없다 — jsdom은 그리지 않으므로 이미지의 실제
 * 크기는 알 수 없다. 그래서 이 파일은 HTML에 적혀 있는 것(width 속성, 인라인
 * 폭, viewBox, 코드의 줄 길이)만 본다. 적혀 있지 않은 것은 화면에서 잰다.
 */

/** 읽기 폭(68ch)에 해당하는 대략의 픽셀. 이보다 넓게 그려진 것은 도판으로 본다. */
const MEASURE = 640;

/** 이보다 긴 줄이 있는 코드는 읽기 폭 안에서 접히면 읽을 수가 없다. */
const LONG_LINE = 88;

export function markSpans(html: string): string {
  if (!html) return html;
  const doc = new JSDOM(`<body>${html}</body>`, { virtualConsole: new VirtualConsole() })
    .window.document;

  // 표는 스스로 스크롤 컨테이너가 되지 못한다 — display:table 상자에는 overflow가
  // 적용되지 않는다. 넘치는 표를 잘리지 않게 하려면 감싸는 상자가 있어야 한다.
  for (const table of doc.querySelectorAll("table")) {
    const box = doc.createElement("div");
    table.replaceWith(box);
    box.appendChild(table);
    box.setAttribute("data-span", "wide");
  }

  for (const svg of doc.querySelectorAll("svg")) fitSvg(svg);

  for (const el of doc.querySelectorAll("img, svg, canvas, pre")) {
    if (!isWide(el)) continue;
    // 그림만 넓히면 설명이 그림에서 떨어진다. 있으면 figure째로 내보낸다.
    (el.closest("figure") ?? el).setAttribute("data-span", "wide");
  }

  return doc.body.innerHTML;
}

/**
 * viewBox 없는 SVG는 줄일 수가 없다. 좌표계를 모르니 폭만 줄면 축소가 아니라
 * 잘림이 된다. width/height가 적혀 있으면 그게 곧 좌표계이므로 복원해준다.
 */
function fitSvg(el: Element) {
  if (el.hasAttribute("viewBox")) return;
  const w = px(el.getAttribute("width"));
  const h = px(el.getAttribute("height"));
  if (w > 0 && h > 0) el.setAttribute("viewBox", `0 0 ${w} ${h}`);
}

function isWide(el: Element): boolean {
  if (el.tagName === "PRE") return longestLine(el.textContent ?? "") > LONG_LINE;
  return declaredWidth(el) > MEASURE;
}

/** HTML이 스스로 말한 폭. 아무것도 말하지 않았으면 0이고, 그건 모른다는 뜻이다. */
function declaredWidth(el: Element): number {
  const attr = px(el.getAttribute("width"));
  if (attr > 0) return attr;

  const inline = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(el.getAttribute("style") ?? "");
  if (inline) return Number(inline[1]);

  const box = el.getAttribute("viewBox")?.trim().split(/[\s,]+/);
  if (box?.length === 4) return px(box[2]);

  return 0;
}

/** width="100%" 같은 것은 폭이 아니라 지시다. 숫자가 아니면 모르는 것으로 둔다. */
function px(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const longestLine = (s: string) =>
  s.split("\n").reduce((n, line) => Math.max(n, line.length), 0);
