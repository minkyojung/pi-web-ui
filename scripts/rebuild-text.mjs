/**
 * Rebuild every stored body from the html kept beside it.
 *
 * The first pass took its text with `textContent`, which drops paragraph
 * breaks; a quarter of the library arrived as one run-on block. The html is
 * still here, so this needs no network — and nothing else in the file is
 * touched, so read marks, gists and archive flags come through unchanged.
 *
 *   node --experimental-strip-types scripts/rebuild-text.mjs [--dry]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { open, HTML_DIR } from "../reader/store.ts";
import { toMarkdown } from "../reader/markdown.ts";

const dry = process.argv.includes("--dry");
const lib = open();
const rows = lib.list(100000).filter((r) => r.has_text);

let rebuilt = 0, skipped = 0, before = 0, after = 0;
const runOn = (body) => body.length / body.split(/\n\s*\n/).length;

for (const row of rows) {
  const html = join(HTML_DIR, `${row.id}.html`);
  if (!existsSync(html)) { skipped++; continue; }
  const old = lib.get(row.id);
  const next = toMarkdown(readFileSync(html, "utf8"));
  if (!next.trim() || next === old.text) { skipped++; continue; }
  before += runOn(old.text);
  after += runOn(next);
  if (!dry) lib.save(row.id, row.status, readFileSync(html, "utf8"), next, row.kind);
  rebuilt++;
}

console.log(`${dry ? "[미리보기] " : ""}다시 만든 것 ${rebuilt}개 · 건너뜀 ${skipped}개`);
if (rebuilt) console.log(`문단당 평균 ${Math.round(before / rebuilt)}자 → ${Math.round(after / rebuilt)}자`);
