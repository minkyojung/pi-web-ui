import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The library is not a project's. pi keeps its sessions under ~/.pi/agent/, so
 * the reading library sits beside them; READER_DIR moves it for a test.
 */
export const READER_DIR = process.env.READER_DIR ?? join(homedir(), ".pi", "reader");
export const DB_PATH = join(READER_DIR, "reader.db");
export const SUBSCRIPTIONS_PATH = join(READER_DIR, "subscriptions.json");

export type Status =
  | "pending"      // 본문 아직 안 받음 (점수 미달 등)
  | "ok"
  | "excluded"     // 도메인 제외 목록
  | "blocked"
  | "no_transcript"
  | "failed";

export type Item = {
  url: string;
  title: string;
  source: string;
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

export function open(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id           INTEGER PRIMARY KEY,
      url          TEXT NOT NULL UNIQUE,
      title        TEXT NOT NULL,
      source       TEXT NOT NULL,
      external_id  TEXT,
      score        INTEGER,
      comments     INTEGER,
      comment_ids  TEXT,
      published_at INTEGER,
      first_seen   INTEGER NOT NULL,
      fetched_at   INTEGER,
      html         TEXT,
      text         TEXT,
      kind         TEXT,
      status       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS items_status ON items(status);
    CREATE INDEX IF NOT EXISTS items_published ON items(published_at DESC);
  `);
  // 예전 DB에는 html 칸이 없다.
  const cols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "html")) db.exec("ALTER TABLE items ADD COLUMN html TEXT");
  return db;
}

/** 새 항목이면 넣고, 이미 있으면 점수/댓글수만 갱신한다 (HN 점수는 계속 오른다). */
export function upsert(db: DatabaseSync, it: Item) {
  const now = Date.now();
  const existing = db.prepare("SELECT id, status FROM items WHERE url = ?").get(it.url) as
    | { id: number; status: string }
    | undefined;

  if (existing) {
    db.prepare(
      "UPDATE items SET score = ?, comments = ?, comment_ids = ? WHERE id = ?"
    ).run(it.score ?? null, it.comments ?? null, it.comment_ids ?? null, existing.id);
    return { id: existing.id, isNew: false, status: existing.status as Status };
  }

  db.prepare(
    `INSERT INTO items
       (url, title, source, external_id, score, comments, comment_ids,
        published_at, first_seen, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    it.url, it.title, it.source, it.external_id ?? null,
    it.score ?? null, it.comments ?? null, it.comment_ids ?? null,
    it.published_at ?? null, now, it.status
  );
  const id = Number(db.prepare("SELECT id FROM items WHERE url = ?").get(it.url)!.id);
  return { id, isNew: true, status: it.status };
}

/**
 * html은 화면에 보여줄 것(소제목·코드·표가 살아있다),
 * text는 2단계에서 모델에 넣을 것(토큰이 싸고 구조 노이즈가 없다).
 */
export function saveContent(
  db: DatabaseSync, id: number, status: Status,
  html: string | null, text: string | null, kind: string | null
) {
  db.prepare(
    "UPDATE items SET status = ?, html = ?, text = ?, kind = ?, fetched_at = ? WHERE id = ?"
  ).run(status, html, text, kind, Date.now(), id);
}
