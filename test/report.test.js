import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { reportUrl } from "../electron/report.js";

test("the report opens the problem form with the app's own facts filled in", () => {
	const url = new URL(reportUrl({ version: "0.0.2", macos: "26.0.1", arch: "arm64" }));
	assert.equal(url.origin + url.pathname, "https://github.com/minkyojung/pi-web-ui/issues/new");
	assert.deepEqual(Object.fromEntries(url.searchParams), { template: "problem.yml", version: "0.0.2", macos: "26.0.1", mac: "Apple Silicon" });
	assert.equal(new URL(reportUrl({ version: "1", macos: "1", arch: "x64" })).searchParams.get("mac"), "Intel");
});

test("every box the app fills in is a box the form has", () => {
	const form = readFileSync(new URL("../.github/ISSUE_TEMPLATE/problem.yml", import.meta.url), "utf8");
	const ids = [...form.matchAll(/^\s+id: (\w+)$/gm)].map((m) => m[1]);
	const filled = [...new URL(reportUrl({ version: "1", macos: "1", arch: "arm64" })).searchParams.keys()].filter((k) => k !== "template");
	for (const key of filled) assert.ok(ids.includes(key), `the form has no box called ${key}`);
});
