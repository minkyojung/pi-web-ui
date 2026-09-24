import assert from "node:assert/strict";
import test from "node:test";

import { createScreen } from "../pty/screen.ts";
import { pick } from "../terminalTool.ts";

test("the screen's words: the last lines, a wrapped line joined back, nothing after the last that says anything", async () => {
	const screen = createScreen({ cols: 10, rows: 4 });
	// xterm parses what it is written on its next turn.
	const wrote = async (s) => {
		screen.write(new Uint8Array(Buffer.from(s)));
		await new Promise((r) => setTimeout(r, 50));
	};
	await wrote("one\r\n\x1b[31mred two\x1b[0m\r\n" + "a".repeat(15) + "\r\n\r\n\r\n");
	assert.equal(screen.text(100), "one\nred two\n" + "a".repeat(15), "colours gone, the 15 a's one line again, the blank lines after not there");
	assert.equal(screen.text(1), "a".repeat(15), "the last line only");
	screen.dispose();
});

test("which terminal is read: the one named, else the front one, else the only one; and a sentence when none", () => {
	const t = (id) => ({ id, shell: "zsh", text: () => "" });
	assert.match(pick([], null, undefined).error, /no terminal open/);
	assert.equal(pick([t("1")], null, undefined).terminal.id, "1");
	assert.equal(pick([t("1"), t("2")], "2", undefined).terminal.id, "2");
	assert.equal(pick([t("1"), t("2")], "9", undefined).terminal.id, "1", "a front that is gone: the first");
	assert.equal(pick([t("1"), t("2")], "1", "2").terminal.id, "2", "named wins over front");
	assert.match(pick([t("1")], "1", "7").error, /no terminal "7".*zsh 1/);
});
