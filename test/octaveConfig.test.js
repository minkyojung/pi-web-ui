import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { configFrom, DEFAULT_TIMEOUT, EMPTY, isConfig, readConfig } from "../electron/octaveConfig.js";

test("the whole shape reads back, with defaults where a field is left out", () => {
	const got = configFrom(`
[scripts]
setup = "npm ci"
archive = "docker compose down"

[scripts.run.dev]
command = "PORT=$OCTAVE_PORT npm run dev"
default = true

[scripts.run.storybook]
command = "npm run storybook"

[[scripts.check]]
name = "unit"
command = "npm test"
description = "node --test, the repository's own suite"

[[scripts.check]]
command = "npm run typecheck"
on = "approve"
timeout = 120
`);
	assert.deepEqual(got, {
		setup: "npm ci",
		archive: "docker compose down",
		run: [
			{ id: "dev", command: "PORT=$OCTAVE_PORT npm run dev", default: true },
			{ id: "storybook", command: "npm run storybook", default: false },
		],
		check: [
			{ name: "unit", command: "npm test", description: "node --test, the repository's own suite", on: "task", timeout: DEFAULT_TIMEOUT },
			{ name: "npm run typecheck", command: "npm run typecheck", description: "", on: "approve", timeout: 120 },
		],
	});
});

test("no file, an empty file, and a file with no [scripts] all come to nothing to run", () => {
	const dir = mkdtempSync(join(tmpdir(), "octave-config-"));
	assert.deepEqual(readConfig(dir), EMPTY);
	assert.deepEqual(configFrom(""), EMPTY);
	assert.deepEqual(configFrom("# just a comment\n[other]\nx = 1\n"), EMPTY);
	assert.deepEqual(configFrom('[scripts]\nsetup = ""\n'), EMPTY, "an empty command is no command");
});

test("one run with no default is the default; several without one make the first it", () => {
	assert.equal(configFrom('[scripts.run.a]\ncommand = "x"\n').run[0].default, true);
	const two = configFrom('[scripts.run.a]\ncommand = "x"\n[scripts.run.b]\ncommand = "y"\n').run;
	assert.deepEqual(two.map((r) => r.default), [true, false]);
});

test("what is wrong is said by name, and nothing of the file is used", () => {
	const wrong = [
		["[scripts]\nsetup = 3\n", /scripts\.setup must be a command/],
		['[scripts]\nsetup = "x"\n[scripts.run]\ndev = "npm run dev"\n', /\[scripts\.run\.dev\] must be a table/],
		['[scripts.run.dev]\ndefault = true\n', /needs a command/],
		['[scripts.check]\ncommand = "x"\n', /two brackets/],
		['[[scripts.check]]\nname = "x"\n', /needs a command/],
		['[[scripts.check]]\ncommand = "x"\non = "merge"\n', /\.on must be one of task, approve/],
		['[[scripts.check]]\ncommand = "x"\ntimeout = "long"\n', /timeout must be a number/],
		['[[scripts.check]]\ncommand = "x"\ntimeout = 0\n', /timeout must be a number/],
		["[scripts\nsetup = 1", /config\.toml: /],
	];
	for (const [text, why] of wrong) {
		const got = configFrom(text);
		assert.equal(isConfig(got), false, text);
		assert.match(got.error, why, text);
		assert.match(got.error, /^\.octave\/config\.toml: /);
	}
});

test("read from a folder: the file where it is, and a wrong one said so", () => {
	const dir = mkdtempSync(join(tmpdir(), "octave-config-"));
	mkdirSync(join(dir, ".octave"));
	writeFileSync(join(dir, ".octave", "config.toml"), '[scripts]\nsetup = "uv sync"\n');
	assert.deepEqual(readConfig(dir), { setup: "uv sync", archive: null, run: [], check: [] });
	writeFileSync(join(dir, ".octave", "config.toml"), "not = [toml");
	assert.equal(isConfig(readConfig(dir)), false);
});
