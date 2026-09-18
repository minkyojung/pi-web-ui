import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { createDocuments, documents, isDocument, pagesText, portion, readers, resolvePath } from "../documents.ts";
import { DOCUMENT_TYPES, documentType } from "../documentKinds.ts";

const FIXTURE = new URL("fixtures/three-pages.pdf", import.meta.url).pathname;

test("어떤 파일이 우리 것인지는 확장자로, 대소문자 없이", () => {
	assert.equal(isDocument("papers/a.pdf"), true);
	assert.equal(isDocument("A.PDF"), true);
	assert.equal(isDocument("a.md"), false);
	assert.equal(isDocument("a.pdf.txt"), false);
});

test("문서라고 부르는 것과 읽을 줄 아는 것은 같은 목록이다", () => {
	assert.deepEqual(Object.keys(DOCUMENT_TYPES).sort(), Object.keys(readers).sort(), "documentKinds.ts에 줄을 더하면 documents.ts에 읽는 법도");
	assert.equal(documentType("papers/a.PDF"), "application/pdf");
	assert.equal(documentType("a.md"), null);
	assert.equal(documentType("folder.pdf/note"), null, "폴더 이름의 점은 확장자가 아니다");
});

test("경로는 pi의 read가 받는 대로 — @를 떼고, ~는 집, 나머지는 폴더 기준", () => {
	assert.equal(resolvePath("@papers/a.pdf", "/v"), "/v/papers/a.pdf");
	assert.equal(resolvePath("/abs/a.pdf", "/v"), "/abs/a.pdf");
	assert.ok(resolvePath("~/a.pdf", "/v").endsWith("/a.pdf") && !resolvePath("~/a.pdf", "/v").startsWith("~"));
});

test("PDF는 페이지마다 한 문자열로, 글자 없는 페이지는 빈 문자열로", async () => {
	const { readFileSync } = await import("node:fs");
	const pages = await readers[".pdf"](readFileSync(FIXTURE));
	assert.deepEqual(pages, ["The first page.\nA second line on it.", "Page two says hello.", ""]);
});

test("페이지는 이름표 아래 놓이고, 빈 페이지는 빈 채로 두지 않고 말한다", () => {
	const text = pagesText(["one", "", "three"]);
	assert.equal(
		text,
		"--- page 1 of 3 ---\none\n\n--- page 2 of 3 ---\n[no text on this page: it may be a scanned image]\n\n--- page 3 of 3 ---\nthree",
	);
});

test("offset과 limit는 pi의 read와 같은 줄 번호, 같은 이어 읽기 문장", () => {
	const text = ["a", "b", "c", "d"].join("\n");
	assert.equal(portion(text), text);
	assert.equal(portion(text, 3), "c\nd");
	assert.equal(portion(text, 1, 2), "a\nb\n\n[Showing lines 1-2 of 4. Use offset=3 to continue.]");
	assert.throws(() => portion(text, 9), /Offset 9 is beyond end of file \(4 lines total\)/);
});

test("긴 글은 pi가 자르는 곳에서 잘리고, 다음 offset을 말한다", () => {
	const long = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");
	const cut = portion(long);
	assert.match(cut, /\n\n\[Showing lines 1-2000 of 3000\. Use offset=2001 to continue\.\]$/);
	const wide = Array.from({ length: 10 }, () => "x".repeat(DEFAULT_MAX_BYTES / 4)).join("\n");
	assert.match(portion(wide), /\(50\.0KB limit\)\. Use offset=4 to continue\.\]$/);
});

test("페이지는 파일이 바뀌기 전까지 한 번만 읽고, 몇 개만 기억한다", async () => {
	const dir = mkdtempSync(join(tmpdir(), "documents-"));
	try {
		const a = join(dir, "a.pdf");
		copyFileSync(FIXTURE, a);
		let reads = 0;
		const was = readers[".pdf"];
		readers[".pdf"] = async (bytes) => (reads++, was(bytes));
		try {
			const pagesOf = createDocuments(2);
			assert.equal((await pagesOf(a)).length, 3);
			await pagesOf(a);
			assert.equal(reads, 1, "두 번째는 기억에서");
			utimesSync(a, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
			await pagesOf(a);
			assert.equal(reads, 2, "파일이 바뀌면 다시");
			for (const name of ["b.pdf", "c.pdf"]) copyFileSync(FIXTURE, join(dir, name));
			await pagesOf(join(dir, "b.pdf"));
			await pagesOf(join(dir, "c.pdf"));
			await pagesOf(a);
			assert.equal(reads, 5, "셋째가 들어오면 첫째는 잊는다");
		} finally {
			readers[".pdf"] = was;
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** The extension bound to a fake pi that only remembers the tool_result handler. */
function bind(root) {
	let handler;
	documents(root)({ on: (event, h) => { if (event === "tool_result") handler = h; } });
	return (input, content = [{ type: "text", text: "garbage" }]) => handler({ type: "tool_result", toolName: "read", toolCallId: "t", input, content, isError: false, details: undefined });
}

test("read가 PDF를 읽으면 그 결과는 글자로 바뀌고, 다른 파일은 손대지 않는다", async () => {
	const dir = mkdtempSync(join(tmpdir(), "documents-"));
	try {
		copyFileSync(FIXTURE, join(dir, "paper.pdf"));
		writeFileSync(join(dir, "note.md"), "words");
		const read = bind(dir);
		const whole = await read({ path: "paper.pdf" });
		assert.equal(whole.isError, false);
		assert.equal(whole.content[0].text, pagesText(["The first page.\nA second line on it.", "Page two says hello.", ""]));
		const part = await read({ path: "@paper.pdf", offset: 6, limit: 1 });
		assert.equal(part.content[0].text, "Page two says hello.\n\n[Showing lines 6-6 of 9. Use offset=7 to continue.]");
		assert.equal(await read({ path: "note.md" }), undefined, "노트는 pi의 read가 돌려준 대로");
		assert.equal(await read({ command: "ls" }), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("없거나 깨진 PDF는 오류로 말한다", async () => {
	const dir = mkdtempSync(join(tmpdir(), "documents-"));
	try {
		writeFileSync(join(dir, "broken.pdf"), "not a pdf");
		const read = bind(dir);
		const missing = await read({ path: "gone.pdf" });
		assert.equal(missing.isError, true);
		assert.match(missing.content[0].text, /Could not read gone\.pdf as a document: ENOENT/);
		const broken = await read({ path: "broken.pdf" });
		assert.equal(broken.isError, true);
		assert.match(broken.content[0].text, /Could not read broken\.pdf as a document: /);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
