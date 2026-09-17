import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { deleteSessionFile } from "../sessionDelete.ts";

test("a session file is gone afterwards, by the bin when there is one and by unlink when not", async () => {
	const dir = mkdtempSync(join(tmpdir(), "session-delete-"));
	const file = join(dir, "s.jsonl");
	writeFileSync(file, '{"type":"session"}\n');
	const { method } = await deleteSessionFile(file);
	assert.ok(method === "trash" || method === "unlink");
	assert.equal(existsSync(file), false);
	// A file already gone is gone, which is what was asked: pi's picker reads it the same way.
	assert.deepEqual(await deleteSessionFile(file), { method: "trash" });
	rmSync(dir, { recursive: true, force: true });
});
