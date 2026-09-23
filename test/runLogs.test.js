import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runLogsIn } from "../electron/runLogs.js";

test("the logs the commands left, newest first, each with how it ended — and none where nothing ran", () => {
	const cwd = mkdtempSync(join(tmpdir(), "octave-runlogs-"));
	try {
		assert.deepEqual(runLogsIn(cwd), []);
		const dir = join(cwd, ".pi", "runs");
		mkdirSync(join(dir, "3"), { recursive: true });
		writeFileSync(join(dir, "setup.log"), "$ npm ci\nadded 12 packages\n(exit 0)\n");
		writeFileSync(join(dir, "dev.log"), `$ npm run dev\n${"x".repeat(2000)}\nlistening\n`);
		writeFileSync(join(dir, "archive.log"), "$ false\n(exit 1)\n");
		writeFileSync(join(dir, "3", "unit.log"), "$ npm test\n(exit 0)\n");
		writeFileSync(join(dir, "notes.txt"), "not a log\n");
		utimesSync(join(dir, "setup.log"), new Date(1000), new Date(1000));
		utimesSync(join(dir, "archive.log"), new Date(2000), new Date(2000));
		utimesSync(join(dir, "dev.log"), new Date(3000), new Date(3000));
		assert.deepEqual(
			runLogsIn(cwd).map(({ name, path, exit }) => ({ name, path, exit })),
			[
				{ name: "dev", path: ".pi/runs/dev.log", exit: null },
				{ name: "archive", path: ".pi/runs/archive.log", exit: 1 },
				{ name: "setup", path: ".pi/runs/setup.log", exit: 0 },
			],
			"a task's checks are a folder deeper and are the results list's",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
