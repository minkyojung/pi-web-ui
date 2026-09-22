import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { copyInto } from "../electron/copies.js";

test("the files named are brought over, a pattern's last part matching many, a folder made for one deeper; what is there already stays", () => {
	const T = mkdtempSync(join(tmpdir(), "octave-copies-"));
	try {
		const root = join(T, "root");
		const ws = join(T, "ws");
		mkdirSync(join(root, "config"), { recursive: true });
		mkdirSync(join(root, ".envs"));
		mkdirSync(ws);
		writeFileSync(join(root, ".env"), "SECRET=1\n");
		writeFileSync(join(root, ".env.local"), "LOCAL=1\n");
		writeFileSync(join(root, ".env.example"), "SECRET=\n");
		writeFileSync(join(root, "config", "local.json"), "{}\n");
		writeFileSync(join(root, "other.txt"), "x\n");
		writeFileSync(join(ws, ".env.example"), "committed\n");
		const copied = copyInto(root, ws, [".env*", "config/local.json", "missing.txt", "config/*.yaml"]);
		assert.deepEqual(copied, [".env", ".env.local", "config/local.json"]);
		assert.equal(readFileSync(join(ws, ".env"), "utf8"), "SECRET=1\n");
		assert.equal(readFileSync(join(ws, ".env.example"), "utf8"), "committed\n", "what the workspace has is the branch's");
		assert.equal(readFileSync(join(ws, "config", "local.json"), "utf8"), "{}\n");
		assert.deepEqual(copyInto(root, ws, [".env*"]), [], "nothing to bring twice");
		assert.deepEqual(copyInto(root, ws, ["*/local.json", "config"]), [], "a folder is not a file, and the folder part takes no *");
	} finally {
		rmSync(T, { recursive: true, force: true });
	}
});
