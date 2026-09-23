import assert from "node:assert/strict";
import test from "node:test";

import { shellEnvFor } from "../pty/env.ts";

test("the shell gets the server's environment less what is the server's alone, and is told what terminal it is in", () => {
	const env = shellEnvFor({
		PATH: "/bin", HOME: "/Users/a", SHELL: "/bin/zsh", GH_TOKEN: "t", GIT_CONFIG_COUNT: "2",
		ELECTRON_RUN_AS_NODE: "1", PORT: "3000", HOST: "127.0.0.1", CLIENT_DIR: "/x", WORKDIR: "/y", IDLE_MS: "1", APP_DIR: "/z", GIT_TERMINAL_PROMPT: "0",
		EMPTY: undefined,
	});
	assert.deepEqual(env, { PATH: "/bin", HOME: "/Users/a", SHELL: "/bin/zsh", GH_TOKEN: "t", GIT_CONFIG_COUNT: "2", TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8" });
});

test("a locale the login shell set is kept", () => {
	assert.equal(shellEnvFor({ LANG: "ko_KR.UTF-8" }).LANG, "ko_KR.UTF-8");
	assert.equal(shellEnvFor({ LC_ALL: "C.UTF-8" }).LANG, undefined);
});
