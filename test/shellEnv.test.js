import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { envFrom, shellEnv } from "../electron/shellEnv.js";

const MARK = "__OCTAVE_SHELL_ENV__";

test("the environment is read from between the marks, whatever the profile printed around it", () => {
	const out = `Last login: today\nwelcome!\n${MARK}${JSON.stringify({ PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/Users/me" })}${MARK}\nbye\n`;
	assert.deepEqual(envFrom(out), { PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/Users/me" });
});

test("what the app sets to run as node is not handed on", () => {
	const out = `${MARK}${JSON.stringify({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" })}${MARK}`;
	assert.deepEqual(envFrom(out), { PATH: "/bin" });
});

test("output with no environment in it is none", () => {
	assert.equal(envFrom(""), null);
	assert.equal(envFrom(`${MARK}not json${MARK}`), null);
	assert.equal(envFrom(`${MARK}[1,2]${MARK}`), null);
	assert.equal(envFrom(`${MARK}{"PATH":"/bin"}`), null);
});

test("a real login shell hands over the environment it was given, with what the profile added", async () => {
	const home = mkdtempSync(join(tmpdir(), "octave-shell-"));
	// sh reads $HOME/.profile as a login shell; what it exports stands for Homebrew's PATH line.
	writeFileSync(join(home, ".profile"), 'echo "a profile that talks"\nexport OCTAVE_PROFILE_SAID=yes\n');
	const was = { HOME: process.env.HOME, ENV: process.env.ENV };
	process.env.HOME = home;
	delete process.env.ENV;
	try {
		const env = await shellEnv({ shell: "/bin/sh", node: process.execPath });
		assert.ok(env, "the shell should have printed an environment");
		assert.equal(env.OCTAVE_PROFILE_SAID, "yes");
		assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
		assert.ok(env.PATH);
	} finally {
		process.env.HOME = was.HOME;
		if (was.ENV !== undefined) process.env.ENV = was.ENV;
	}
});

test("a shell that hangs is given up on, and leaves nothing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "octave-shell-"));
	const shell = join(dir, "slow-shell");
	writeFileSync(shell, "#!/bin/sh\nsleep 5\n");
	chmodSync(shell, 0o755);
	const started = Date.now();
	assert.equal(await shellEnv({ shell, node: process.execPath, timeoutMs: 200 }), null);
	assert.ok(Date.now() - started < 2000);
});

test("a shell that is not there leaves nothing", async () => {
	assert.equal(await shellEnv({ shell: "/no/such/shell", node: process.execPath }), null);
});
