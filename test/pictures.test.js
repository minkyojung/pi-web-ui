import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { attachmentAt, imageType } from "../pictures.ts";

const ROOT = mkdtempSync(join(tmpdir(), "attach-"));
const OUTSIDE = mkdtempSync(join(tmpdir(), "attach-outside-"));
test.after(() => {
	rmSync(ROOT, { recursive: true, force: true });
	rmSync(OUTSIDE, { recursive: true, force: true });
});

const png = Buffer.from("89504e470d0a1a0a", "hex");
for (const dir of ["images", "book/ch1", "book/ch2", ".obsidian", ".pi/history"]) mkdirSync(join(ROOT, dir), { recursive: true });
writeFileSync(join(ROOT, "images", "diagram.png"), png);
writeFileSync(join(ROOT, "book", "ch1", "diagram.png"), png);
writeFileSync(join(ROOT, "book", "ch2", "cover.JPG"), png);
writeFileSync(join(ROOT, "notes.md"), "# notes");
writeFileSync(join(ROOT, ".obsidian", "hidden.png"), png);
writeFileSync(join(OUTSIDE, "secret.png"), png);
symlinkSync(join(OUTSIDE, "secret.png"), join(ROOT, "images", "link.png"));

test("a picture is found as the folder names it, then as the note's folder names it", () => {
	assert.equal(attachmentAt(ROOT, "images/diagram.png")?.path, "images/diagram.png");
	assert.equal(attachmentAt(ROOT, "diagram.png", "book/ch1/notes.md")?.path, "book/ch1/diagram.png", "the note's own folder");
	assert.equal(attachmentAt(ROOT, "../ch1/diagram.png", "book/ch2/notes.md")?.path, "book/ch1/diagram.png", "relative to the note, inside the folder");
	assert.equal(attachmentAt(ROOT, "images/diagram.png")?.type, "image/png");
});

test("a name alone is found anywhere, nearest the note first, then shallowest", () => {
	assert.equal(attachmentAt(ROOT, "diagram.png", "book/ch1/notes.md")?.path, "book/ch1/diagram.png");
	assert.equal(attachmentAt(ROOT, "diagram.png", "notes.md")?.path, "images/diagram.png", "the shallower of two");
	assert.equal(attachmentAt(ROOT, "cover.jpg", "notes.md")?.path, "book/ch2/cover.JPG", "by name, whatever the case");
	assert.equal(attachmentAt(ROOT, "nowhere.png", "notes.md"), null);
	assert.equal(attachmentAt(ROOT, "ch1/diagram.png", "notes.md"), null, "a path is a path, not a name to search for");
});

test("only images, only inside the folder, never under a dot-folder", () => {
	assert.equal(attachmentAt(ROOT, "notes.md"), null, "a note is not a picture");
	assert.equal(attachmentAt(ROOT, "../" + OUTSIDE.split("/").pop() + "/secret.png"), null, "outside by ..");
	assert.equal(attachmentAt(ROOT, "images/link.png"), null, "outside by symlink");
	assert.equal(attachmentAt(ROOT, ".obsidian/hidden.png"), null, "a dot-folder");
	assert.equal(attachmentAt(ROOT, "hidden.png"), null, "not by name either");
	assert.equal(imageType("a.PNG"), "image/png");
	assert.equal(imageType("a.md"), null);
});

import { attachmentFolder } from "../pictures.ts";

test("a pasted picture goes where Obsidian was told to keep them, else in attachments/", () => {
	assert.equal(attachmentFolder(ROOT, "notes.md"), "attachments", "not told: attachments/");
	mkdirSync(join(ROOT, ".obsidian"), { recursive: true });
	const told = (value) => writeFileSync(join(ROOT, ".obsidian", "app.json"), JSON.stringify({ attachmentFolderPath: value }));
	told("assets/pics");
	assert.equal(attachmentFolder(ROOT, "book/ch1/notes.md"), "assets/pics", "a folder of the vault's");
	told("/");
	assert.equal(attachmentFolder(ROOT, "book/ch1/notes.md"), "", "the root");
	told("./");
	assert.equal(attachmentFolder(ROOT, "book/ch1/notes.md"), "book/ch1", "beside the note");
	told("./img");
	assert.equal(attachmentFolder(ROOT, "book/ch1/notes.md"), "book/ch1/img", "under the note's folder");
	rmSync(join(ROOT, ".obsidian", "app.json"));
});
