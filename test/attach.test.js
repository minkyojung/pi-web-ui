import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanName, MAX_BYTES, numbered, saveAttachment, takes } from "../attach.ts";

const bytes = (s) => new TextEncoder().encode(s);

test("받는 것은 pi가 읽는 문서와 이미지뿐", () => {
	for (const name of ["a.pdf", "A.PDF", "shot.png", "photo.JPG", "x.webp"]) assert.equal(takes(name), true, name);
	for (const name of ["run.sh", "a.md", "page.html", "app.exe", "noext"]) assert.equal(takes(name), false, name);
});

test("이름은 마지막 조각만, 파일 시스템과 링크가 못 싣는 글자는 빼고", () => {
	assert.equal(cleanName("paper.pdf"), "paper.pdf");
	assert.equal(cleanName("../../etc/paper.pdf"), "paper.pdf");
	assert.equal(cleanName("C:\\Users\\me\\paper.pdf"), "paper.pdf");
	assert.equal(cleanName("what? [draft] #2.pdf"), "what draft 2.pdf");
	assert.equal(cleanName("회의록 최종.pdf"), "회의록 최종.pdf");
	assert.equal(cleanName("회의록.pdf".normalize("NFD")), "회의록.pdf", "자모로 풀린 이름은 합쳐서");
	for (const bad of ["", ".hidden.pdf", ".pdf", "???.pdf", "noext", "  "]) assert.equal(cleanName(bad), null, JSON.stringify(bad));
});

test("이미 있는 이름에는 번호가 붙는다", () => {
	assert.equal(numbered("paper.pdf", 1), "paper.pdf");
	assert.equal(numbered("paper.pdf", 2), "paper 2.pdf");
	assert.equal(numbered("a.b.pdf", 3), "a.b 3.pdf");
});

test("attachments/에 쓰이고, 같은 이름은 덮지 않고 옆에 놓인다", () => {
	const root = mkdtempSync(join(tmpdir(), "attach-"));
	try {
		assert.deepEqual(saveAttachment(root, "paper.pdf", bytes("one")), { ok: true, path: "attachments/paper.pdf" });
		assert.deepEqual(saveAttachment(root, "paper.pdf", bytes("two")), { ok: true, path: "attachments/paper 2.pdf" });
		assert.deepEqual(saveAttachment(root, "PAPER.pdf", bytes("three")).ok, true);
		assert.equal(readFileSync(join(root, "attachments/paper.pdf"), "utf8"), "one", "먼저 온 것은 그대로");
		assert.equal(readFileSync(join(root, "attachments/paper 2.pdf"), "utf8"), "two");
		assert.ok(readdirSync(join(root, "attachments")).every((f) => !f.endsWith(".tmp")), "임시 파일은 남지 않는다");
		assert.equal(readdirSync(join(root, "attachments")).length, 3);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("쓸 수 없는 이름, 안 받는 종류, 빈 것과 너무 큰 것은 거절되고 아무것도 쓰이지 않는다", () => {
	const root = mkdtempSync(join(tmpdir(), "attach-"));
	try {
		assert.deepEqual(saveAttachment(root, ".pdf", bytes("x")), { ok: false, reason: "name" });
		assert.deepEqual(saveAttachment(root, "run.sh", bytes("x")), { ok: false, reason: "kind" });
		assert.deepEqual(saveAttachment(root, "a.pdf", bytes("")), { ok: false, reason: "size" });
		assert.deepEqual(saveAttachment(root, "a.pdf", { byteLength: MAX_BYTES + 1 }), { ok: false, reason: "size" });
		assert.deepEqual(readdirSync(root), [], "폴더조차 만들지 않는다");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("볼트가 첨부 폴더를 정해 두었으면 거기에, 노트 옆이라 했으면 그 노트 옆에, 밖이나 숨은 폴더는 따르지 않는다", () => {
	const root = mkdtempSync(join(tmpdir(), "attach-told-"));
	try {
		mkdirSync(join(root, ".obsidian"));
		const told = (value) => writeFileSync(join(root, ".obsidian", "app.json"), JSON.stringify({ attachmentFolderPath: value }));
		told("assets/pics");
		assert.deepEqual(saveAttachment(root, "a.png", bytes("x"), "book/ch1/notes.md"), { ok: true, path: "assets/pics/a.png" });
		told("/");
		assert.deepEqual(saveAttachment(root, "a.png", bytes("x"), "book/ch1/notes.md"), { ok: true, path: "a.png" });
		told("./");
		assert.deepEqual(saveAttachment(root, "a.png", bytes("x"), "book/ch1/notes.md"), { ok: true, path: "book/ch1/a.png" });
		assert.deepEqual(saveAttachment(root, "a.png", bytes("x")), { ok: true, path: "a 2.png" }, "노트 없이(메시지 상자) 노트 옆은 맨 위");
		told("./img");
		assert.deepEqual(saveAttachment(root, "a.png", bytes("x"), "book/ch1/notes.md"), { ok: true, path: "book/ch1/img/a.png" });
		told("../outside");
		assert.deepEqual(saveAttachment(root, "b.png", bytes("x"), "notes.md"), { ok: true, path: "attachments/b.png" }, "폴더 밖은 따르지 않는다");
		told(".hidden");
		assert.deepEqual(saveAttachment(root, "c.png", bytes("x"), "notes.md"), { ok: true, path: "attachments/c.png" }, "숨은 폴더도");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
