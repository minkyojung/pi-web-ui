import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// READER_DIR is read when the module loads, so the directory has to exist first.
const DIR = mkdtempSync(join(tmpdir(), "reader-"));
process.env.READER_DIR = DIR;
const store = await import("../reader/store.ts");

test.after(() => rmSync(DIR, { recursive: true, force: true }));

const item = (over = {}) => ({
	url: "https://example.com/a",
	title: "A Lean proof of Fermat's Last Theorem",
	source: "hn",
	score: 412,
	comments: 137,
	published_at: Date.parse("2026-09-05T11:20:00Z"),
	status: "pending",
	...over,
});

const libraryFiles = () => readdirSync(join(DIR, "library")).filter((n) => n.endsWith(".md"));

test("frontmatter survives the titles a feed actually hands over", () => {
	const meta = {
		id: 1,
		url: "https://example.com/a",
		title: 'Rust: "zero-cost"? — 한글, emoji 🎯\nand a newline',
		source: "hn",
		external_id: null,
		score: 1,
		comments: null,
		comment_ids: null,
		published_at: null,
		first_seen: "2026-09-05T00:00:00.000Z",
		fetched_at: null,
		kind: null,
		status: "ok",
		conflicts: [],
	};
	// A body that opens with the fence must not be mistaken for the end of it.
	const parsed = store.parse(store.serialize(meta, null, "---\nnot the header\n---\nbody"));
	assert.deepEqual(parsed.meta, meta);
	assert.equal(parsed.gist, null);
	assert.equal(parsed.body, "---\nnot the header\n---\nbody");
});

test("a gist with quotes in it cannot break the item, because it is outside the JSON", () => {
	const meta = { id: 2, url: "u", title: "t", conflicts: [] };
	const gist = 'Rust "zero-cost"라 주장했지만, 컴파일 시간이 3배가 됐다';
	const parsed = store.parse(store.serialize(meta, gist, "body\n> not a gist"));
	assert.equal(parsed.gist, gist);
	assert.equal(parsed.body, "body\n> not a gist");
	assert.equal(parsed.meta.id, 2);
});

test("a torn or foreign file is skipped, not guessed at", () => {
	assert.equal(store.parse("no fence at all"), null);
	assert.equal(store.parse("---\n{ half"), null);
	assert.equal(store.parse("---\n{}\n---\n\nbody"), null); // id 없음
});

test("the file name leads with the day, so the directory reads chronologically", () => {
	const name = store.fileName({
		id: 421,
		title: "A Lean proof of Fermat's Last Theorem",
		published_at: "2026-09-05T11:20:00Z",
		first_seen: "2026-09-06T00:00:00Z",
	});
	assert.match(name, /^2026-09-05-421-a-lean-proof-of-fermat-s-last-theorem\.md$/);
});

test("an item with no body stays out of library/, so ls and grep only hit readable things", () => {
	const lib = store.open();
	const { id, isNew } = lib.see(item({ url: "https://example.com/pending" }));
	assert.equal(isNew, true);
	assert.deepEqual(libraryFiles(), []);

	// 페이월이라 본문이 없는 것도 파일이 되지 않는다 — 목록에는 나오지만.
	lib.save(id, "blocked", null, null, "html");
	assert.deepEqual(libraryFiles(), []);
	assert.equal(lib.list(10).find((r) => r.id === id).status, "blocked");
	assert.equal(lib.list(10).find((r) => r.id === id).has_text, 0);
});

test("text promotes an item out of the index and into a file it can be read from", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/ok" }));
	lib.save(id, "ok", "<p>hello</p>", "hello", "html");

	const file = libraryFiles().find((n) => n.includes(`-${id}-`));
	assert.ok(file, "본문이 있으면 파일이 생긴다");
	assert.match(readFileSync(join(DIR, "library", file), "utf8"), /\nhello\n$/);

	const got = lib.get(id);
	assert.equal(got.html, "<p>hello</p>"); // 화면용
	assert.equal(got.text, "hello");        // 모델용
	assert.equal(got.has_text, 1);
	assert.equal(got.gist, null);
	// The browser wants milliseconds back, whatever the file says.
	assert.equal(got.published_at, Date.parse("2026-09-05T11:20:00Z"));
});

test("seeing a story again refreshes its score without touching the body", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/again" }));
	lib.save(id, "ok", null, "the body", "html");

	const second = lib.see(item({ url: "https://example.com/again", score: 900 }));
	assert.deepEqual(second, { id, isNew: false, status: "ok" });
	assert.equal(lib.get(id).score, 900);
	assert.equal(lib.get(id).text, "the body");
});

test("a retitled story leaves one file behind, not two", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/retitle", title: "First title" }));
	lib.save(id, "ok", null, "body", "html");
	assert.deepEqual(
		libraryFiles().filter((n) => n.includes(`-${id}-`)),
		[`2026-09-05-${id}-first-title.md`],
	);

	// 제목이 바뀌면 파일명이 바뀐다. 옛 이름이 남으면 같은 글이 두 번 잡힌다.
	lib.see(item({ url: "https://example.com/retitle", title: "Second title" }));
	assert.deepEqual(
		libraryFiles().filter((n) => n.includes(`-${id}-`)),
		[`2026-09-05-${id}-second-title.md`],
	);
	assert.equal(lib.get(id).text, "body", "이름만 바뀌고 본문은 그대로");
});

test("the list is newest first and leaves the ones below the score bar out", () => {
	const lib = store.open();
	lib.see(item({ url: "https://example.com/below", title: "below the bar" }));
	const rows = lib.list(100);
	assert.equal(rows.some((r) => r.title === "below the bar"), false);
	for (let i = 1; i < rows.length; i++) {
		const at = (r) => r.published_at ?? r.first_seen;
		assert.ok(at(rows[i - 1]) >= at(rows[i]), "내림차순");
	}
});

test("ids come from the files when the index was never written", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/crash" }));
	lib.save(id, "ok", null, "body", "html");
	// flush() 없이 죽은 것과 같은 상태: 파일은 있고 장부는 뒤처져 있다.
	writeFileSync(join(DIR, "index.json"), JSON.stringify({ nextId: 1, items: {} }));

	const reopened = store.open();
	const fresh = reopened.see(item({ url: "https://example.com/after-crash" }));
	assert.ok(fresh.id > id, `${fresh.id} > ${id} — 이미 쓴 아이디를 다시 주지 않는다`);
});

test("a fetch running beside the server is picked up, not cached over", () => {
	const server = store.open();
	const before = server.list(100).length;

	const fetcher = store.open();
	const { id } = fetcher.see(item({ url: "https://example.com/concurrent" }));
	fetcher.save(id, "ok", null, "written by the other process", "html");
	fetcher.flush();

	assert.equal(server.list(100).length, before + 1);
	assert.equal(server.get(id).text, "written by the other process");
});

test("a gist lands on the item and survives the next fetch pass", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/gist", title: "Off Kubernetes" }));
	lib.save(id, "ok", "<p>b</p>", "the body", "html");

	const wrote = lib.setGist(id, "  쿠버네티스에서 단일 서버로 되돌렸고,\n  비용이 1/8이 됐다  ");
	// 줄바꿈과 여백은 접는다 — 목록의 한 줄이고, 파일의 한 줄이다.
	assert.equal(wrote.gist, "쿠버네티스에서 단일 서버로 되돌렸고, 비용이 1/8이 됐다");
	assert.equal(lib.get(id).gist, wrote.gist);
	assert.equal(lib.list(100).find((r) => r.id === id).gist, wrote.gist);
	assert.equal(lib.get(id).text, "the body", "본문은 그대로");

	// 점수가 올라 파일이 다시 쓰여도 한 줄은 남는다.
	lib.see(item({ url: "https://example.com/gist", title: "Off Kubernetes", score: 999 }));
	assert.equal(lib.get(id).gist, wrote.gist);
	assert.equal(lib.get(id).score, 999);
});

test("a gist is refused where there is nothing to have read", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/nobody" }));
	lib.save(id, "blocked", null, null, "html");
	assert.throws(() => lib.setGist(id, "무언가"), /has no text/);
	assert.throws(() => lib.setGist(999999, "무언가"), /has no text/);

	const ok = lib.see(item({ url: "https://example.com/empty-gist" }));
	lib.save(ok.id, "ok", null, "body", "html");
	assert.throws(() => lib.setGist(ok.id, "   "), /the gist is empty/);
});

test("read, queued and archived are only written when true", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/flags", title: "Flags" }));
	lib.save(id, "ok", null, "body", "html");

	const file = () => readFileSync(join(DIR, "library", libraryFiles().find((n) => n.includes(`-${id}-`))), "utf8");
	assert.equal(/"read"|"queued"|"archived"/.test(file()), false, "기본은 아무것도 안 적힌다");

	const after = lib.setFlags(id, { read: true, archived: true });
	assert.equal(after.read, true);
	assert.equal(after.archived, true);
	assert.equal(after.queued, undefined);
	assert.match(file(), /"read": true/);
	assert.equal(/"queued"/.test(file()), false);

	// 끄면 필드가 false로 남는 게 아니라 사라진다.
	lib.setFlags(id, { archived: false });
	assert.equal(/"archived"/.test(file()), false);
	assert.equal(lib.get(id).read, true, "건드리지 않은 것은 그대로");
});

test("a bodyless item can be archived too", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/flagless" }));
	lib.save(id, "blocked", null, null, "html");
	assert.equal(lib.setFlags(id, { archived: true }).archived, true);
	assert.equal(lib.list(300).find((r) => r.id === id).archived, true);
	assert.throws(() => lib.setFlags(999999, { read: true }), /No item/);
});

test("flags survive the next fetch pass and do not disturb the gist", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/flags2", title: "Keep" }));
	lib.save(id, "ok", null, "body", "html");
	lib.setGist(id, "a line");
	lib.setFlags(id, { queued: true });

	lib.see(item({ url: "https://example.com/flags2", title: "Keep", score: 777 }));
	const row = lib.get(id);
	assert.equal(row.queued, true);
	assert.equal(row.gist, "a line");
	assert.equal(row.score, 777);
});

// ---------------------------------------------------------------------------
// A url handed over on its own, rather than by a feed
// ---------------------------------------------------------------------------

test("the same piece under www, a slash, a fragment or tracking is one key", () => {
	const key = store.normalize("https://example.com/post");
	for (const url of [
		"https://www.example.com/post/",
		"https://EXAMPLE.com/post#section-2",
		"https://example.com/post?utm_source=newsletter&utm_medium=email",
		"https://example.com/post/?fbclid=abc",
		"http://example.com/post",
	]) assert.equal(store.normalize(url), key, url);
});

test("normalize keeps the parameters that pick the page", () => {
	assert.notEqual(store.normalize("https://example.com/?p=1"), store.normalize("https://example.com/?p=2"));
	assert.equal(store.normalize("https://example.com/?b=2&a=1"), store.normalize("https://example.com/?a=1&b=2"));
	assert.equal(store.normalize("not a url"), "not a url");
});

test("find answers by the given url and by where it resolved to, and touches nothing", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://t.co/short", title: "Short", score: 10 }));
	lib.save(id, "ok", "<p>x</p>", "x", "html", "https://example.com/long?utm_source=x");
	lib.flush();

	const byGiven = lib.find("https://T.CO/short/");
	const byLanding = lib.find("https://www.example.com/long");
	assert.equal(byGiven?.id, id);
	assert.equal(byLanding?.id, id);
	assert.equal(byGiven?.score, 10, "find does not refresh a score");
	assert.equal(byGiven?.resolved_url, "https://example.com/long?utm_source=x", "kept as it arrived");
	assert.equal(lib.find("https://example.com/other"), null);
});

test("a resolved url that is the given url is not written down", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://example.com/same", title: "Same" }));
	lib.save(id, "ok", "<p>x</p>", "x", "html", "https://example.com/same");
	const file = libraryFiles().find((n) => n.includes(`-${id}-`));
	assert.ok(file);
	assert.ok(!readFileSync(join(DIR, "library", file), "utf8").includes("resolved_url"));
});

test("a bodyless item is found too, so a blocked page is not saved twice", () => {
	const lib = store.open();
	const { id } = lib.see(item({ url: "https://paywall.example/a", title: "Behind" }));
	lib.save(id, "blocked", null, null, "html");
	lib.flush();
	assert.equal(store.open().find("https://paywall.example/a?utm_campaign=c")?.id, id);
});
