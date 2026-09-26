import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execFileSync } from "node:child_process";

import { cleanName, keepPictures, MAX_BYTES, numbered, saveAttachment, saveMessageAttachment, takes } from "../attach.ts";
import { excludeFromGit } from "../gitExclude.ts";

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

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("입력창에 붙인 것은 .octave/attachments/<ID>/에 원래 이름대로, 같은 이름도 제 폴더에 따로", () => {
	const root = mkdtempSync(join(tmpdir(), "attach-"));
	try {
		const one = saveMessageAttachment(root, "Screenshot 1.png", bytes("one"));
		const two = saveMessageAttachment(root, "Screenshot 1.png", bytes("two"));
		assert.match(one.path, /^\.octave\/attachments\/[0-9a-f]{8}\/Screenshot 1\.png$/);
		assert.match(two.path, /^\.octave\/attachments\/[0-9a-f]{8}\/Screenshot 1\.png$/);
		assert.notEqual(one.path, two.path, "같은 이름은 다른 폴더");
		assert.equal(readFileSync(join(root, one.path), "utf8"), "one");
		assert.equal(readFileSync(join(root, two.path), "utf8"), "two");
		assert.ok(!readdirSync(root).includes("attachments"), "노트의 첨부 폴더는 건드리지 않는다");
		assert.equal(saveMessageAttachment(root, "run.sh", bytes("x")).ok, true, "입력창은 어떤 종류든 받는다");
		assert.match(saveMessageAttachment(root, "Makefile", bytes("all:")).path, /\/Makefile$/, "확장자가 없어도");
		assert.match(saveMessageAttachment(root, 'a "quoted" #1.log', bytes("x")).path, /\/a quoted #1\.log$/, "따옴표만 빠진다 — @\"…\"와 부딪히지 않게");
		assert.deepEqual(saveMessageAttachment(root, ".env", bytes("x")), { ok: false, reason: "name" }, "숨은 이름은 아니다");
		assert.deepEqual(saveAttachment(root, "run.sh", bytes("x")), { ok: false, reason: "kind" }, "노트에는 여전히 그림과 문서만");
		assert.deepEqual(saveMessageAttachment(root, "a.pdf", bytes("")), { ok: false, reason: "size" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("입력창 첨부는 git에서 빠진다 — 저장소의 .gitignore가 아니라 이 클론의 info/exclude로, 한 번만, 모든 워크트리에", () => {
	const root = mkdtempSync(join(tmpdir(), "exclude-"));
	try {
		const repo = join(root, "repo");
		mkdirSync(repo);
		git(repo, "init", "-q", "-b", "main");
		writeFileSync(join(repo, "a.md"), "a\n");
		git(repo, "add", ".");
		git(repo, "commit", "-q", "-m", "a");
		const tree = join(root, "tree");
		git(repo, "worktree", "add", "-q", "-b", "me/tree", tree);
		// Saved in the worktree: the line goes in the repository's one exclude file.
		saveMessageAttachment(tree, "shot.png", bytes("png"));
		saveMessageAttachment(tree, "shot.png", bytes("png"));
		const exclude = readFileSync(join(repo, ".git/info/exclude"), "utf8");
		assert.equal(exclude.split("\n").filter((line) => line === "/.octave/attachments/").length, 1, "두 번 저장해도 한 줄");
		assert.equal(git(tree, "status", "--porcelain"), "", "워크트리에서 보이지 않는다");
		assert.ok(!readdirSync(tree).includes(".gitignore"), "저장소의 .gitignore는 건드리지 않는다");
		// The other checkout of the same repository hears it too.
		mkdirSync(join(repo, ".octave/attachments/x"), { recursive: true });
		writeFileSync(join(repo, ".octave/attachments/x/b.png"), "png");
		assert.equal(git(repo, "status", "--porcelain"), "");
		// A line already there, written by hand without a newline at the end, is kept and not repeated.
		writeFileSync(join(repo, ".git/info/exclude"), "node_modules\n/.octave/attachments/");
		excludeFromGit(repo, "/.octave/attachments/");
		assert.equal(readFileSync(join(repo, ".git/info/exclude"), "utf8"), "node_modules\n/.octave/attachments/");
		excludeFromGit(repo, "/.other/");
		assert.equal(readFileSync(join(repo, ".git/info/exclude"), "utf8"), "node_modules\n/.octave/attachments/\n/.other/\n", "끝에 줄바꿈이 없던 파일에도 제 줄로");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("저장소가 아닌 폴더에서는 git에 아무것도 하지 않고 저장만 한다", () => {
	const root = mkdtempSync(join(tmpdir(), "attach-"));
	try {
		assert.equal(saveMessageAttachment(root, "a.pdf", bytes("%PDF")).ok, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("메시지와 함께 간 그림은 사본이 입력창 첨부 자리에 남는다 — 쓸 수 없는 이름이면 종류로 짓고, 남기지 못한 것은 건너뛴다", () => {
	const root = mkdtempSync(join(tmpdir(), "attach-"));
	try {
		const png = Buffer.from("png bytes").toString("base64");
		const kept = keepPictures(root, [
			{ data: png, mimeType: "image/png", name: "Pasted image 20260926153012.png" },
			{ data: png, mimeType: "image/jpeg", name: "../../evil.sh" },
			{ data: png, mimeType: "image/jpeg" },
			{ data: "", mimeType: "image/png", name: "empty.png" },
		]);
		assert.equal(kept.length, 3, "빈 것은 남지 않는다");
		assert.match(kept[0], /^\.octave\/attachments\/[0-9a-f]{8}\/Pasted image 20260926153012\.png$/);
		assert.match(kept[1], /\/Pasted image\.jpg$/, "받지 않는 이름은 종류로");
		assert.match(kept[2], /\/Pasted image\.jpg$/, "이름이 없으면 종류로");
		assert.equal(readFileSync(join(root, kept[0]), "utf8"), "png bytes", "보낸 바이트 그대로");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
