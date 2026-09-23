import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { gitEnvFor, token } from "../electron/credentials.js";

/** What git would send to `https://host`, under `env`, with a home whose global config names one helper for every host. */
function filled(host, env) {
	const home = mkdtempSync(join(tmpdir(), "octave-credentials-"));
	writeFileSync(join(home, ".gitconfig"), `[credential]\n\thelper = "!f() { test \\"$1\\" = get || exit 0; echo username=theirs; echo password=theirs; }; f"\n`);
	try {
		return execFileSync("git", ["credential", "fill"], { input: `protocol=https\nhost=${host}\n\n`, env: { PATH: process.env.PATH, HOME: home, ...env }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
	} catch (err) {
		return String(err.stderr);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

test("with no token git is only kept from prompting, and the person's helpers answer as before", () => {
	assert.deepEqual(gitEnvFor(null), { GIT_TERMINAL_PROMPT: "0" });
	assert.match(filled("github.com", gitEnvFor(null)), /username=theirs/);
});

test("with a token git answers github.com with it, and every other host with the person's helpers", () => {
	const env = gitEnvFor("gho_t");
	assert.equal(env.GH_TOKEN, "gho_t");
	assert.match(filled("github.com", env), /username=x-access-token\npassword=gho_t/);
	assert.match(filled("gitlab.com", env), /username=theirs/);
});

test("the token is the shell's GH_TOKEN when there is one, and nothing when there is no gh to ask", async () => {
	const { GH_TOKEN, PATH } = process.env;
	try {
		process.env.GH_TOKEN = "gho_shell";
		assert.equal(await token(), "gho_shell");
		delete process.env.GH_TOKEN;
		process.env.PATH = mkdtempSync(join(tmpdir(), "octave-no-gh-"));
		assert.equal(await token(), null);
	} finally {
		if (GH_TOKEN === undefined) delete process.env.GH_TOKEN;
		else process.env.GH_TOKEN = GH_TOKEN;
		process.env.PATH = PATH;
	}
});
