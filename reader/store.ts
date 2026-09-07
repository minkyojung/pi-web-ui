import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The library is not a project's. pi keeps its sessions under ~/.pi/agent/, so
 * the reading library sits beside them; READER_DIR moves it for a test.
 */
export const READER_DIR = process.env.READER_DIR ?? join(homedir(), ".pi", "reader");
export const LIBRARY_DIR = join(READER_DIR, "library");
export const HTML_DIR = join(READER_DIR, "html");
export const INDEX_PATH = join(READER_DIR, "index.json");
export const SUBSCRIPTIONS_PATH = join(READER_DIR, "subscriptions.json");

export type Status =
  | "pending"      // 본문 아직 안 받음 (점수 미달 등)
  | "ok"
  | "excluded"     // 도메인 제외 목록
  | "blocked"
  | "no_transcript"
  | "failed";

/** What a source hands over: a title and whatever the feed knew about it. */
export type Item = {
  url: string;
  title: string;
  source: string;
  resolved_url?: string | null;
  external_id?: string | null;
  score?: number | null;
  comments?: number | null;
  comment_ids?: string | null;
  published_at?: number | null;
  html?: string | null;
  text?: string | null;
  kind?: string | null;
  status: Status;
};

/**
 * Everything about an item except its body. Dates are ISO strings, not epoch
 * milliseconds: this sits at the top of a file the agent reads, and a number
 * there says nothing. The API converts back to milliseconds for the browser.
 */
export type Meta = {
  id: number;
  url: string;
  title: string;
  source: string;
  /**
   * Where `url` ended up after redirects, when that is somewhere else. A short
   * link, a newsletter's tracking hop and the page itself are one piece, and
   * this is what lets a second copy of it be recognised as the first.
   */
  resolved_url?: string;
  published_at: string | null;
  score: number | null;
  comments: number | null;
  status: Status;
  kind: string | null;
  /**
   * 화면이 남기는 것. 셋 다 참일 때만 적힌다 — 서재의 대부분은 아무것도 아니고,
   * 매 파일에 false 세 줄을 얹으면 정작 읽을 게 밀린다.
   */
  read?: boolean;
  queued?: boolean;
  archived?: boolean;
  /** 5단계. 이 글과 부딪히는 서재의 글 id. */
  conflicts: number[];
  first_seen: string;
  fetched_at: string | null;
  external_id: string | null;
  /** HN 댓글 아이디 수백 개. 1KB짜리 한 줄이라 맨 끝에 둔다. */
  comment_ids: string | null;
};

/** A list row: Meta with the dates back in milliseconds, as the browser wants. */
export type Row = Omit<Meta, "published_at" | "first_seen" | "fetched_at"> & {
  published_at: number | null;
  first_seen: number;
  fetched_at: number | null;
  /** 3단계. 이 글이 무엇을 주장하는가, 한 줄. 사실만, 평가 없음. */
  gist: string | null;
  has_text: number;
};

const ms = (iso: string | null) => (iso ? Date.parse(iso) : null);

function toRow(meta: Meta, gist: string | null, hasText: boolean): Row {
  return {
    ...meta,
    published_at: ms(meta.published_at),
    first_seen: ms(meta.first_seen) ?? 0,
    fetched_at: ms(meta.fetched_at),
    gist,
    has_text: hasText ? 1 : 0,
  };
}

/**
 * The form two urls are compared in. Not the form they are kept in: `url` is
 * what was handed over and stays that way, so opening the original opens it
 * exactly as it was found. This only decides whether two of them are the same
 * piece — which they are across `www.`, a trailing slash, a fragment, and the
 * tracking a newsletter or a share button tacks on.
 */
const TRACKING = /^(utm_|fbclid$|gclid$|ref$|ref_src$|mc_cid$|mc_eid$)/;

export function normalize(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  // 같은 글이 http로도 https로도 온다. 어느 쪽이 먼저 왔는지는 글의 정체가 아니다.
  if (u.protocol === "http:") u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.toString().replace(/\/$/, "").replace(/\/\?/, "?");
}

// ---------------------------------------------------------------------------
// The file format
// ---------------------------------------------------------------------------

/**
 * `---` fences with JSON between them, not YAML. A title is arbitrary text
 * from someone else's feed — it has colons, quotes, newlines and emoji in it —
 * and hand-rolling the YAML that survives all of those is how a library
 * quietly corrupts itself. JSON.parse either reads it back exactly or throws.
 * It is still plain text at the top of the file, which is all the agent needs.
 */
const FENCE = "---";

/**
 * The gist is a quoted line under the frontmatter rather than a field inside
 * it. It is the one thing an agent writes, and a stray quote in a sentence
 * would break the JSON — which does not mangle a field, it makes the whole
 * item unparseable and drops it out of the library without a sound. Out here
 * the worst case is a line that reads oddly.
 */
const GIST = "> ";

export function serialize(meta: Meta, gist: string | null, body: string): string {
  const head = `${FENCE}\n${JSON.stringify(meta, null, 2)}\n${FENCE}\n`;
  const line = gist ? `\n${GIST}${gist.replace(/\s+/g, " ").trim()}\n` : "";
  return `${head}${line}\n${body.trim()}\n`;
}

export function parse(file: string): { meta: Meta; gist: string | null; body: string } | null {
  if (!file.startsWith(FENCE + "\n")) return null;
  const end = file.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (end < 0) return null;
  let meta: Meta;
  try {
    meta = JSON.parse(file.slice(FENCE.length + 1, end + 1));
  } catch {
    return null;
  }
  if (typeof meta?.id !== "number" || typeof meta?.url !== "string") return null;

  const rest = file.slice(end + FENCE.length + 2).replace(/^\n+/, "");
  if (!rest.startsWith(GIST)) return { meta, gist: null, body: rest.trim() };
  const eol = rest.indexOf("\n");
  const cut = eol < 0 ? rest.length : eol;
  return {
    meta,
    gist: rest.slice(GIST.length, cut).trim() || null,
    body: rest.slice(cut).trim(),
  };
}

/**
 * `2026-09-05-421-a-lean-proof.md`. The date leads so `ls` is chronological —
 * "오늘 것" is a listing, not a query. The id follows because it is the only
 * part that has to be unique, and the slug is there for whoever is reading the
 * directory.
 */
export function fileName(meta: Meta): string {
  const day = new Date(meta.published_at ?? meta.first_seen);
  const date = [
    day.getFullYear(),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  ].join("-");
  const slug = meta.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${date}-${meta.id}${slug ? "-" + slug : ""}.md`;
}

/** Write through a temp file, so a crash mid-write leaves the old one intact. */
function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/**
 * Items with no body: below the score bar, paywalled, or an extraction that
 * failed. They keep their id and their metadata here rather than as an empty
 * file, so `library/` holds only things that can actually be read — `ls` and
 * `grep` over it never land on a stub.
 */
type Index = { nextId: number; items: Record<string, Meta> };

type Cached = { key: string; meta: Meta; gist: string | null };

export class Library {
  private index: Index;
  /** file name → last (mtime,size) seen and the meta parsed from it. */
  private cache = new Map<string, Cached>();
  /** id → file name, for the items that have a file. */
  private files = new Map<number, string>();
  /**
   * normalize(url) → item, bodied or not, under its given url and its resolved
   * one. Dedup asks here; anything it does not find is new.
   */
  private keys = new Map<string, Meta>();
  private dirty = false;

  constructor() {
    mkdirSync(LIBRARY_DIR, { recursive: true });
    mkdirSync(HTML_DIR, { recursive: true });
    this.index = existsSync(INDEX_PATH)
      ? (JSON.parse(readFileSync(INDEX_PATH, "utf8")) as Index)
      : { nextId: 1, items: {} };
    this.scan();
    // The files are the record, not index.json. If a pass died before flushing,
    // ids it handed out are only in the file names — taking the larger of the
    // two is what stops the next pass from handing the same id out twice.
    const highest = Math.max(0, ...[...this.files.keys()]);
    if (this.index.nextId <= highest) this.index.nextId = highest + 1;
  }

  /**
   * Re-read the frontmatter of whatever changed. `npm run fetch` is a separate
   * process from the server, so the server cannot cache this once and trust it;
   * stat'ing a few hundred files is cheap enough to do on every request, and
   * parsing only the changed ones keeps it that way.
   */
  private scan() {
    const names = readdirSync(LIBRARY_DIR).filter((n) => n.endsWith(".md"));
    const seen = new Set(names);
    this.files.clear();
    this.keys.clear();
    for (const name of names) {
      const path = join(LIBRARY_DIR, name);
      let key: string;
      try {
        const s = statSync(path);
        key = `${s.mtimeMs}:${s.size}`;
      } catch {
        continue; // 방금 사라졌다 (fetch가 이름을 바꾸는 중)
      }
      const hit = this.cache.get(name);
      if (hit?.key === key) {
        this.files.set(hit.meta.id, name);
        this.key(hit.meta);
        continue;
      }
      const parsed = parse(readFileSync(path, "utf8"));
      if (!parsed) continue;
      this.cache.set(name, { key, meta: parsed.meta, gist: parsed.gist });
      this.files.set(parsed.meta.id, name);
      this.key(parsed.meta);
    }
    for (const name of this.cache.keys()) if (!seen.has(name)) this.cache.delete(name);
    for (const meta of Object.values(this.index.items)) this.key(meta);
  }

  private key(meta: Meta) {
    this.keys.set(normalize(meta.url), meta);
    if (meta.resolved_url) this.keys.set(normalize(meta.resolved_url), meta);
  }

  private metaOf(id: number): Meta | null {
    const name = this.files.get(id);
    return name ? (this.cache.get(name)?.meta ?? null) : null;
  }

  /** Every item, bodied or not, keyed by url — what dedup needs. */
  private byUrl(url: string): Meta | null {
    return this.keys.get(normalize(url)) ?? null;
  }

  private rowOf(meta: Meta): Row {
    const name = this.files.get(meta.id);
    return toRow(meta, name ? (this.cache.get(name)?.gist ?? null) : null, !!name);
  }

  /**
   * The item a url already is, or null. Unlike `see`, this changes nothing: a
   * feed refreshing a score is one thing, someone asking "do I have this?"
   * is another.
   */
  find(url: string): Row | null {
    this.scan();
    const meta = this.byUrl(url);
    return meta ? this.rowOf(meta) : null;
  }

  /**
   * 새 항목이면 넣고, 이미 있으면 점수/댓글수만 갱신한다 (HN 점수는 계속 오른다).
   */
  see(it: Item): { id: number; isNew: boolean; status: Status } {
    const existing = this.byUrl(it.url);
    if (existing) {
      const next: Meta = {
        ...existing,
        // 제목은 고쳐진다 (RSS는 오타를 나중에 고쳐서 다시 준다). 파일명이 제목에서
        // 나오므로, 여기서 안 따라가면 서재에 옛 제목의 파일이 남는다.
        title: it.title || existing.title,
        score: it.score ?? existing.score,
        comments: it.comments ?? existing.comments,
        comment_ids: it.comment_ids ?? existing.comment_ids,
      };
      if (!next.resolved_url && it.resolved_url && it.resolved_url !== next.url)
        next.resolved_url = it.resolved_url;
      // 아무것도 안 바뀌었으면 안 쓴다. 안 그러면 한 번 돌 때마다
      // 서재의 모든 파일이 다시 쓰이고, 파일 시각이 전부 오늘이 된다.
      const changed = next.title !== existing.title
        || next.score !== existing.score
        || next.comments !== existing.comments
        || next.comment_ids !== existing.comment_ids
        || next.resolved_url !== existing.resolved_url;
      if (changed) this.put(next);
      return { id: existing.id, isNew: false, status: existing.status };
    }
    // 순서가 그대로 파일에 나온다. 사람이 훑을 것이 위, 배관이 아래.
    const meta: Meta = {
      id: this.index.nextId++,
      url: it.url,
      title: it.title,
      source: it.source,
      ...(it.resolved_url && it.resolved_url !== it.url ? { resolved_url: it.resolved_url } : {}),
      published_at: it.published_at ? new Date(it.published_at).toISOString() : null,
      score: it.score ?? null,
      comments: it.comments ?? null,
      status: it.status,
      kind: it.kind ?? null,
      conflicts: [],
      first_seen: new Date().toISOString(),
      fetched_at: null,
      external_id: it.external_id ?? null,
      comment_ids: it.comment_ids ?? null,
    };
    this.put(meta);
    return { id: meta.id, isNew: true, status: meta.status };
  }

  /**
   * html은 화면에 보여줄 것(소제목·코드·표가 살아있다),
   * text는 모델에 넣을 것(토큰이 싸고 구조 노이즈가 없다).
   */
  save(
    id: number, status: Status, html: string | null, text: string | null, kind: string | null,
    resolved: string | null = null,
  ) {
    const meta = this.metaOf(id) ?? Object.values(this.index.items).find((m) => m.id === id);
    if (!meta) throw new Error(`No item ${id}`);
    const next: Meta = { ...meta, status, kind, fetched_at: new Date().toISOString() };
    // 받는 동안 알게 된 최종 주소. 같은 글의 두 번째 주소는 여기서부터 잡힌다.
    if (resolved && resolved !== meta.url && !meta.resolved_url) next.resolved_url = resolved;
    this.put(next, text);
    const htmlPath = join(HTML_DIR, `${id}.html`);
    if (html) writeAtomic(htmlPath, html);
    else rmSync(htmlPath, { force: true });
  }

  /**
   * Put an item where its body says it belongs: a file if it has text, the
   * index if it does not. `text === undefined` means "leave the body alone".
   */
  private put(meta: Meta, text?: string | null, gist?: string | null) {
    const oldName = this.files.get(meta.id);
    const old = oldName ? parse(readFileSync(join(LIBRARY_DIR, oldName), "utf8")) : null;
    const body = text === undefined ? (old?.body ?? "") : (text ?? "");
    const line = gist === undefined ? (old?.gist ?? null) : gist;

    if (!body) {
      if (oldName) {
        rmSync(join(LIBRARY_DIR, oldName), { force: true });
        this.cache.delete(oldName);
        this.files.delete(meta.id);
      }
      this.index.items[meta.url] = meta;
      this.key(meta);
      this.dirty = true;
      return;
    }

    const name = fileName(meta);
    const path = join(LIBRARY_DIR, name);
    writeAtomic(path, serialize(meta, line, body));
    // 제목이 바뀌면 파일명도 바뀐다. 옛 이름을 남기면 같은 글이 두 번 잡힌다.
    if (oldName && oldName !== name) {
      rmSync(join(LIBRARY_DIR, oldName), { force: true });
      this.cache.delete(oldName);
    }
    const s = statSync(path);
    this.cache.set(name, { key: `${s.mtimeMs}:${s.size}`, meta, gist: line });
    this.files.set(meta.id, name);
    this.key(meta);
    if (this.index.items[meta.url]) {
      delete this.index.items[meta.url];
      this.dirty = true;
    }
  }

  /**
   * 읽음·큐·보관 표시. 서재에서 화면이 쓰는 유일한 자리.
   *
   * 브라우저에만 두지 않는 이유는 pi도 이 파일을 읽기 때문이다. 내가 무엇을
   * 치웠는지 pi가 모르면 "또 한 명의 유저"는 한쪽만 보는 사이가 된다.
   */
  setFlags(id: number, patch: Pick<Meta, "read" | "queued" | "archived">): Row {
    this.scan();
    const name = this.files.get(id);
    const meta = name
      ? this.cache.get(name)!.meta
      : Object.values(this.index.items).find((m) => m.id === id);
    if (!meta) throw new Error(`No item ${id}`);
    const next = { ...meta };
    for (const key of ["read", "queued", "archived"] as const) {
      if (patch[key] === undefined) continue;
      if (patch[key]) next[key] = true;
      else delete next[key];
    }
    this.put(next);
    this.flush();
    return toRow(next, name ? (this.cache.get(fileName(next))?.gist ?? null) : null, !!name);
  }

  /**
   * 한 줄을 남긴다. 서재에서 에이전트가 쓰는 유일한 자리.
   * 본문이 있는 글에만 붙는다 — 없는 글은 읽은 적이 없으니 주장할 것도 없다.
   */
  setGist(id: number, gist: string): { id: number; title: string; gist: string } {
    this.scan();
    const name = this.files.get(id);
    if (!name) throw new Error(`${id}번 글은 본문이 없어서 한 줄을 붙일 수 없다`);
    const meta = this.cache.get(name)!.meta;
    const line = gist.replace(/\s+/g, " ").trim();
    if (!line) throw new Error("한 줄이 비어 있다");
    this.put(meta, undefined, line);
    return { id, title: meta.title, gist: line };
  }

  /** 목록. 본문은 빼고, 아직 점수 미달인 것도 뺀다. */
  list(limit: number): Row[] {
    this.scan();
    const rows = [
      ...[...this.cache.values()].map(({ meta, gist }) => toRow(meta, gist, true)),
      ...Object.values(this.index.items)
        .filter((m) => m.status !== "pending")
        .map((m) => toRow(m, null, false)),
    ];
    rows.sort((a, b) => (b.published_at ?? b.first_seen) - (a.published_at ?? a.first_seen));
    return rows.slice(0, limit);
  }

  /**
   * 하나. 화면이 그릴 html과, 모델이 읽을 text를 함께.
   *
   * `path`는 pi에게 건네려고 있다. 화면이 열어둔 글을 pi가 알게 하는 방법은
   * 본문 4천 자를 프롬프트에 싣는 것이 아니라 이 한 줄을 주는 것이다 —
   * 서재가 파일이고 pi에게 read가 있으니, 필요하면 직접 읽는다.
   */
  get(id: number): (Row & { html: string | null; text: string | null; path: string | null }) | null {
    this.scan();
    const name = this.files.get(id);
    if (name) {
      const parsed = parse(readFileSync(join(LIBRARY_DIR, name), "utf8"));
      if (!parsed) return null;
      const htmlPath = join(HTML_DIR, `${id}.html`);
      return {
        ...toRow(parsed.meta, parsed.gist, true),
        html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : null,
        text: parsed.body,
        path: join(LIBRARY_DIR, name),
      };
    }
    const meta = Object.values(this.index.items).find((m) => m.id === id);
    return meta ? { ...toRow(meta, null, false), html: null, text: null, path: null } : null;
  }

  counts() {
    this.scan();
    return {
      total: this.cache.size + Object.keys(this.index.items).length,
      withText: this.cache.size,
    };
  }

  /** The index is only written here, so a fetch that dies mid-pass loses ids, not items. */
  flush() {
    if (!this.dirty) return;
    writeAtomic(INDEX_PATH, JSON.stringify(this.index, null, 2) + "\n");
    this.dirty = false;
  }
}

export const open = () => new Library();
