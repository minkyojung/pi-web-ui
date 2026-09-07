import { JSDOM, VirtualConsole } from "jsdom";

/**
 * An article's HTML as markdown.
 *
 * The obvious way to get text out of a document is `textContent`, and it is
 * wrong: it concatenates every text node with nothing between them, so
 * `<p>One.</p><p>Two.</p>` comes back as `One.Two.`. What made most of the
 * library look fine anyway was the whitespace sites leave between their tags —
 * indentation, not structure. Minified pages arrived as one 5,000-character
 * paragraph, and no error was raised because nothing had failed.
 *
 * So the structure is walked rather than the characters scraped. Once you are
 * walking it, a heading costs one line to keep, and a heading is what tells
 * whoever reads a twenty-minute piece where they are in it.
 */

/** Elements that end the line they are on. Everything else runs inline. */
const BLOCK = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
  "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3",
  "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
  "SECTION", "TABLE", "TD", "TH", "TR", "UL",
]);

/** Carries no prose. `figure` is kept — its caption often does. */
const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "CANVAS", "FORM", "BUTTON"]);

/**
 * Runs inside a line. Emphasis and links only survive if the walk hands these
 * to `inline` — recursing into them instead drops the markers, which is what
 * made the first pass return bare prose.
 */
const INLINE = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DATA", "DEL", "DFN", "EM",
  "I", "IMG", "INS", "KBD", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG",
  "SUB", "SUP", "TIME", "U", "VAR", "WBR",
]);

const HEADING = /^H([1-6])$/;

/** A span can be wrapped around a paragraph; then it is not a run inside a line. */
const runsInline = (el: Element) => INLINE.has(el.tagName) && !el.querySelector([...BLOCK].join(","));

type Ctx = { out: string[]; list: ("ul" | "ol")[]; index: number[] };

/** Collapse a run of text the way a browser does when it lays it out. */
const flat = (s: string) => s.replace(/\s+/g, " ");

function inline(node: Node): string {
  if (node.nodeType === 3) return flat(node.nodeValue ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  if (DROP.has(el.tagName)) return "";
  if (el.tagName === "BR") return "\n";
  const inner = [...el.childNodes].map(inline).join("");
  switch (el.tagName) {
    case "CODE":
      // 이미 코드 블록 안이면 겹쳐 감싸지 않는다.
      return el.closest("pre") ? inner : `\`${inner}\``;
    case "STRONG":
    case "B":
      return inner.trim() ? `**${inner}**` : "";
    case "EM":
    case "I":
      return inner.trim() ? `*${inner}*` : "";
    case "A": {
      const href = el.getAttribute("href") ?? "";
      // 주소 없는 앵커와 자기 자신을 가리키는 링크는 글에 아무것도 안 보탠다.
      return href && !href.startsWith("#") && inner.trim() ? `[${inner}](${href})` : inner;
    }
    case "IMG": {
      const alt = flat(el.getAttribute("alt") ?? "").trim();
      return alt ? `![${alt}]` : "";
    }
    default:
      return inner;
  }
}

function walk(node: Node, ctx: Ctx): void {
  if (node.nodeType === 3) {
    const text = flat(node.nodeValue ?? "");
    if (text.trim()) ctx.out.push(text);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (DROP.has(el.tagName)) return;

  const tag = el.tagName;
  const heading = HEADING.exec(tag);

  if (tag === "PRE") {
    const code = (el.textContent ?? "").replace(/\n+$/, "");
    if (code.trim()) ctx.out.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
    return;
  }
  if (tag === "HR") {
    ctx.out.push("\n\n---\n\n");
    return;
  }
  if (heading) {
    const text = inline(el).trim();
    if (text) ctx.out.push(`\n\n${"#".repeat(Number(heading[1]))} ${text}\n\n`);
    return;
  }
  if (tag === "BLOCKQUOTE") {
    const text = block(el).trim();
    if (text) ctx.out.push(`\n\n${text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}\n\n`);
    return;
  }
  if (tag === "UL" || tag === "OL") {
    // 항목 안에 들어앉은 목록은 빈 줄로 떼어놓지 않는다. 그러면 한 항목이
    // 둘로 갈라져 보인다.
    const gap = el.parentElement?.tagName === "LI" ? "" : "\n\n";
    ctx.list.push(tag === "OL" ? "ol" : "ul");
    ctx.index.push(0);
    ctx.out.push(gap);
    for (const child of el.childNodes) walk(child, ctx);
    ctx.list.pop();
    ctx.index.pop();
    ctx.out.push(gap);
    return;
  }
  if (tag === "LI") {
    const ordered = ctx.list.at(-1) === "ol";
    const n = ordered ? ++ctx.index[ctx.index.length - 1] : 0;
    const text = block(el, ctx.list, ctx.index).trim();
    if (text) {
      // 이어지는 줄을 글머리 폭만큼 들여쓴다. 안에 든 목록도 그 줄들이므로,
      // 깊이는 여기서 한 번만 세면 바깥 항목이 다시 들여쓰며 쌓인다.
      const bullet = ordered ? `${n}. ` : "- ";
      ctx.out.push(`\n${bullet}${text.split("\n").join("\n  ")}`);
    }
    return;
  }

  if (runsInline(el)) {
    const text = inline(el);
    if (text.trim()) ctx.out.push(text);
    return;
  }

  const isBlock = BLOCK.has(tag);
  if (isBlock) ctx.out.push("\n\n");
  for (const child of el.childNodes) walk(child, ctx);
  if (isBlock) ctx.out.push("\n\n");
}

/**
 * The children of one element, as markdown. The list stack is threaded through
 * rather than started fresh, so a list nested inside an item knows its depth.
 */
function block(el: Element, list: ("ul" | "ol")[] = [], index: number[] = []): string {
  const ctx: Ctx = { out: [], list, index };
  for (const child of el.childNodes) walk(child, ctx);
  return tidy(ctx.out.join(""));
}

/** Collapse the runs of blank lines the walk leaves behind, and trim the edges. */
const tidy = (s: string) =>
  s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();

/** An article's HTML — Readability's output, or any fragment — as markdown. */
export function toMarkdown(html: string): string {
  const dom = new JSDOM(`<body>${html}</body>`, { virtualConsole: new VirtualConsole() });
  return block(dom.window.document.body);
}
