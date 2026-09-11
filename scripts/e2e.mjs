/**
 * Drive the real app in a real browser, and check what a person would look at.
 *
 * Everything else in this repo tests a function or a protocol: the reducer
 * against recordings, the tree reading against sessions pi wrote, the socket
 * against a running server. None of it would notice a component that renders
 * nothing, a control that is never reachable, or a click that goes nowhere.
 *
 * No browser library is installed and none is wanted for this: it drives the
 * Chrome already on the machine over the DevTools protocol, which is a
 * WebSocket and some JSON. `npx playwright install` would download a second
 * browser to do the same thing.
 *
 * Everything it touches is its own: its own working folder, its own session,
 * its own ports, its own browser profile, all removed at the end. It will not
 * disturb a server or a session you have open.
 *
 *   node scripts/e2e.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = (name) => join(root, "node_modules", ".bin", name);

const CHROMES = [
	process.env.CHROME,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
];

/** A port nobody is on. Asking the OS beats guessing and racing. */
function freePort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}

/** Poll until it is true, rather than sleeping for as long as it might take. */
async function until(what, check, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	for (;;) {
		try {
			const value = await check();
			if (value) return value;
		} catch {
			// Not up yet, which is the usual reason.
		}
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 200));
	}
}

/**
 * A session that was asked the same thing three ways.
 *
 * Written with pi's own SessionManager rather than by hand: a branch is the
 * shape of a file, and a file this test wrote to its own idea of the shape
 * would prove only that it agrees with itself.
 */
function branchedSession(cwd) {
	const manager = SessionManager.create(cwd);
	const said = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
	const replied = (text) => ({
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		timestamp: Date.now(),
		usage: { totalTokens: 10, cost: { total: 0.001 } },
	});

	manager.appendMessage(said("what is this project"));
	manager.appendMessage(replied("a web UI over pi"));
	const asked = manager.appendMessage(said("rewrite the reducer"));
	manager.appendMessage(replied("ANSWER-ALPHA"));

	const parent = manager.getEntry(asked).parentId;
	for (const [question, answer] of [
		["rewrite the reducer, shorter", "ANSWER-BETA"],
		["rewrite the reducer, with tests", "ANSWER-GAMMA"],
	]) {
		// The first message of a session has no parent to go back to.
		if (parent === null) manager.resetLeaf();
		else manager.branch(parent);
		manager.appendMessage(said(question));
		manager.appendMessage(replied(answer));
	}
	return manager.getSessionFile();
}

/** One page, driven over the DevTools protocol. */
async function openPage(devtoolsPort, url) {
	const target = await until("a browser tab", async () => {
		const response = await fetch(`http://localhost:${devtoolsPort}/json/new?${url}`, { method: "PUT" });
		return response.ok ? await response.json() : null;
	});

	const socket = new WebSocket(target.webSocketDebuggerUrl);
	const pending = new Map();
	const errors = [];
	let id = 0;

	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
			return;
		}
		if (message.method === "Runtime.exceptionThrown") {
			errors.push(message.params.exceptionDetails.exception?.description ?? "exception");
		}
		if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
			errors.push(message.params.args.map((a) => a.value ?? a.description).join(" "));
		}
	});
	await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

	const call = (method, params = {}) =>
		new Promise((resolve) => {
			const n = ++id;
			pending.set(n, resolve);
			socket.send(JSON.stringify({ id: n, method, params }));
		});

	const evaluate = async (expression) => {
		const answer = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		const thrown = answer.result?.exceptionDetails;
		if (thrown) throw new Error(thrown.exception?.description ?? JSON.stringify(thrown));
		return answer.result?.result?.value;
	};

	await call("Runtime.enable");
	// Two tabs cannot both be the front one, and a tab that is not gets no
	// animation frames — which is how this store tells React that anything
	// arrived, so the conversation would be held and never drawn. The flag
	// exists for exactly this: it makes a page behave as though it is being
	// looked at. Worth knowing that it is needed, and not a bug being papered
	// over: a real background tab really does stop drawing, on purpose.
	await call("Emulation.setFocusEmulationEnabled", { enabled: true });
	/**
	 * A picture of the page, written where SHOTS points and nowhere otherwise.
	 *
	 * The checks below read the page as text, which is the right way to assert
	 * on it — but a section can be present, named and empty, and text cannot
	 * tell you the layout came out wrong. This is for looking, by hand.
	 */
	const shot = async (name) => {
		if (!process.env.SHOTS) return;
		const { result } = await call("Page.captureScreenshot", { format: "png" });
		mkdirSync(process.env.SHOTS, { recursive: true });
		writeFileSync(join(process.env.SHOTS, `${name}.png`), Buffer.from(result.data, "base64"));
	};
	/**
	 * Real input, through the protocol: a click lands where the browser lays
	 * the element out, and a key comes with its modifiers the way the keyboard
	 * sends them. A KeyboardEvent made in the page cannot stand in for either —
	 * the editor reads the caret from the DOM only after the browser says the
	 * selection changed, and an untrusted key event does not get there first.
	 */
	const click = async (selector, nth = 0, { meta = false } = {}) => {
		const box = await evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
		if (!box) return false;
		const [x, y] = box;
		const modifiers = meta ? 4 : 0;
		await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
		await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers });
		await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers });
		return true;
	};
	const CODES = { Enter: 13, Backspace: 8, Escape: 27, End: 35, f: 70, n: 78, p: 80, z: 90 };
	const press = async (key, { meta = false, shift = false } = {}) => {
		const modifiers = (meta ? 4 : 0) | (shift ? 8 : 0);
		const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
		const base = { key, code, windowsVirtualKeyCode: CODES[key], nativeVirtualKeyCode: CODES[key], modifiers };
		await call("Input.dispatchKeyEvent", { type: "keyDown", ...base });
		await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
	};
	/** Characters one key at a time, which is what an input handler such as bracket closing hears. */
	const keys = async (text) => {
		for (const ch of text) {
			await call("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
			await call("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
		}
	};
	return { evaluate, shot, errors, click, press, keys, close: () => socket.close() };
}

/**
 * Shut the browser down through the protocol, not with a signal.
 *
 * A headless Chrome does not stop when the process that started it is asked
 * to: it leaves helpers running and a profile directory open, which then
 * cannot be removed. Browser.close is how it is meant to be told.
 */
async function closeBrowser(devtoolsPort) {
	try {
		const version = await (await fetch(`http://localhost:${devtoolsPort}/json/version`)).json();
		const socket = new WebSocket(version.webSocketDebuggerUrl);
		await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
		socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
		await new Promise((resolve) => setTimeout(resolve, 500));
		socket.close();
	} catch {
		// Already gone, which is the outcome this wanted.
	}
}

/** Ask a child to stop, insist if it will not, and wait either way. */
function stop(child) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const insist = setTimeout(() => child.kill("SIGKILL"), 3000);
		child.once("exit", () => {
			clearTimeout(insist);
			resolve();
		});
		child.kill("SIGTERM");
	});
}

const checks = [];
const check = (name, run) => checks.push({ name, run });

/**
 * The conversation as text, which is what the arrows are read against.
 *
 * textContent rather than innerText: innerText is what is laid out, and pi's
 * column is a resizable panel that a narrow window collapses to nothing. The
 * window is sized for this below, but a check that reads the same either way
 * is one less thing that can pass or fail for the wrong reason.
 */
const chat = (page) => page.evaluate("document.getElementById('chat')?.textContent ?? ''");
/**
 * The two things a branch check is about: which answer is on screen, and what
 * the arrows say. Matched exactly rather than loosely, because textContent runs
 * neighbouring elements together — the answer and the duration under it come
 * out as one word.
 */
const marks = async (page) => {
	const text = await chat(page);
	const answers = text.match(/ANSWER-(?:ALPHA|BETA|GAMMA)/g) ?? [];
	const counts = text.match(/[1-9]\/[1-9]/g) ?? [];
	return [...answers, ...counts].join(" ");
};
const press = (page, title) =>
	page.evaluate(
		`(() => { const b = [...document.querySelectorAll('#chat button[title=${JSON.stringify(title)}]')].find((x) => !x.disabled); if (!b) return false; b.click(); return true; })()`,
	);
const allDisabled = (page, title) =>
	page.evaluate(
		`[...document.querySelectorAll('#chat button[title=${JSON.stringify(title)}]')].every((b) => b.disabled)`,
	);

check("the app renders a conversation", async ({ app }) => {
	await until("the conversation", () => app.evaluate("!!document.getElementById('chat')"));
});

check("the sidebar lists the folder's notes and nothing else", async ({ app }) => {
	const listed = await until("the notes", () =>
		app.evaluate("[...document.querySelectorAll('#notes button')].map((b) => b.title).join(',')"),
	);
	assert.deepEqual(listed.split(",").sort(), ["first.md", "ideas/second.md"]);
});

check("a branched session opens on its newest branch", async ({ app }) => {
	await until("the resumed session", async () => (await marks(app)).includes("ANSWER-GAMMA"));
	assert.equal(await marks(app), "ANSWER-GAMMA 3/3");
});

check("the newest branch offers no next", async ({ app }) => {
	assert.equal(await allDisabled(app, "Next answer"), true);
});

check("going back shows the answer that was there before", async ({ app }) => {
	assert.equal(await press(app, "Previous answer"), true);
	await until("the previous branch", async () => (await marks(app)).includes("ANSWER-BETA"));
	assert.equal(await marks(app), "ANSWER-BETA 2/3");
});

check("the first branch offers no previous", async ({ app }) => {
	assert.equal(await press(app, "Previous answer"), true);
	await until("the first branch", async () => (await marks(app)).includes("ANSWER-ALPHA"));
	assert.equal(await marks(app), "ANSWER-ALPHA 1/3");
	assert.equal(await allDisabled(app, "Previous answer"), true);
});

check("and forward again", async ({ app }) => {
	assert.equal(await press(app, "Next answer"), true);
	await until("the second branch", async () => (await marks(app)).includes("ANSWER-BETA"));
});

check("asking a question again fills the box without moving anything", async ({ app }) => {
	const before = await marks(app);
	assert.equal(await app.evaluate(`(() => {
		const b = [...document.querySelectorAll('#chat button[title="Ask this again, differently"]')].pop();
		if (!b) return false;
		b.click();
		return true;
	})()`), true);
	await until("the question in the box", () =>
		app.evaluate(`document.querySelector('textarea')?.value?.includes("rewrite the reducer")`),
	);
	// Nothing was sent, so the conversation is exactly where it was: this is
	// the difference between copying a question and navigating to it.
	assert.equal(await marks(app), before);
	assert.ok((await app.evaluate("document.body.textContent")).includes("Asking again:"));
});

check("changing your mind about it costs nothing", async ({ app }) => {
	assert.equal(await app.evaluate(`(() => {
		const b = document.querySelector('button[aria-label="Send as a new question instead"]');
		if (!b) return false;
		b.click();
		return true;
	})()`), true);
	await until("the note to go", async () => !(await app.evaluate("document.body.textContent")).includes("Asking again:"));
	// The text stays in the box: it was copied in, and cancelling is about
	// where it will be sent, not about what was typed.
	assert.ok(await app.evaluate(`document.querySelector('textarea')?.value?.includes("rewrite the reducer")`));
});

/** What the editor shows, as text. CodeMirror draws only the visible lines, but these notes are short. */
const editorText = (page) => page.evaluate("document.querySelector('#editor .cm-content')?.textContent ?? ''");
const editorStatus = (page) => page.evaluate("document.getElementById('editor')?.dataset.status ?? ''");
/**
 * Typing, as the browser sees it: focus the box and insert text the way an
 * input method does, so it goes through CodeMirror's DOM observer rather than
 * being handed to it as a transaction the way the server's text is.
 */
const type = (page, text) =>
	page.evaluate(`(() => {
		const box = document.querySelector('#editor .cm-content');
		if (!box) return false;
		box.focus();
		return document.execCommand("insertText", false, ${JSON.stringify(text)});
	})()`);

check("a row in the sidebar opens its note in the middle", async ({ app }) => {
	assert.equal(
		await app.evaluate(`(() => { const b = document.querySelector('#notes button[title="first.md"]'); if (!b) return false; b.click(); return true; })()`),
		true,
	);
	await until("the note to load", async () => (await editorStatus(app)) === "saved");
	assert.ok((await editorText(app)).includes("# first"));
	assert.equal(await app.evaluate("location.hash"), "#first.md");
	await app.shot("editor");
});

check("typing is written down on its own, and a reload finds it", async ({ app, cwd }) => {
	assert.equal(await type(app, "TYPED "), true);
	await until("the typing to be marked", async () => (await editorStatus(app)) === "unsaved");
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "first.md"), "utf8").includes("TYPED"), "the file has what was typed");
	await app.evaluate("location.reload()");
	await until("the same note after a reload", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("TYPED"));
});

check("typing just before the page goes is not lost", async ({ app, cwd }) => {
	// No pause for the autosave: the reload comes inside it.
	assert.equal(await type(app, "LATE "), true);
	await app.evaluate("location.reload()");
	await until("the note after the reload", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "first.md"), "utf8").includes("LATE"), "the last keystrokes reached the disk");
	assert.ok((await editorText(app)).includes("LATE"));
});

check("a write from elsewhere under unsaved typing is put to the person", async ({ app, cwd }) => {
	// Someone — pi, another editor — writes the file while a keystroke is pending.
	writeFileSync(join(cwd, "first.md"), "# first\n\nfrom outside\n");
	assert.equal(await type(app, "MORE "), true);
	await until("the refusal", async () => (await editorStatus(app)) === "conflict");
	assert.ok((await app.evaluate("document.querySelector('#editor [role=alert]')?.textContent ?? ''")).includes("changed on disk"));
	assert.ok(!readFileSync(join(cwd, "first.md"), "utf8").includes("MORE"), "nothing was written over it");
	// Reload takes the disk's version.
	await app.evaluate(`[...document.querySelectorAll('#editor [role=alert] button')].find((b) => b.textContent === "Reload").click()`);
	await until("the disk's text", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("from outside"));
	assert.equal(await app.evaluate("!!document.querySelector('#editor [role=alert]')"), false);
});

/** Click into the nth of pi's marks, then press a chord on it. */
const chordOnMark = async (page, n, key) => {
	if (!(await page.click("#editor .cm-pi", n))) return "no mark";
	await new Promise((r) => setTimeout(r, 100));
	await page.press(key, { meta: true });
	return "pressed";
};
const piMarks = (page) => page.evaluate("[...document.querySelectorAll('#editor .cm-pi')].map((m) => m.textContent)");

/**
 * Another tab, without a browser: a socket to the same server that opens a
 * note and saves it, the way the editor does. What it writes reaches the
 * editor as a change, which is the thing under test.
 */
async function otherTab(api) {
	const socket = new WebSocket(`ws://127.0.0.1:${api}/ws`);
	const inbox = [];
	socket.onmessage = (e) => inbox.push(JSON.parse(e.data));
	await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
	const open = async (path) => {
		inbox.length = 0;
		socket.send(JSON.stringify({ type: "open_note", path }));
		return until("the other tab's note", () => inbox.find((m) => m.type === "note" && m.path === path));
	};
	const save = async (path, text) => {
		const { modified } = await open(path);
		inbox.length = 0;
		socket.send(JSON.stringify({ type: "save_note", path, text, base: modified }));
		await until("the other tab's save", () => inbox.find((m) => m.type === "note_changed" && m.path === path));
	};
	return { open, save, close: () => socket.close() };
}

check("a change from elsewhere lands in the editor as a change, not a reload", async ({ app, api, cwd }) => {
	const other = await otherTab(api);
	try {
		await app.evaluate(`document.querySelector('#notes button[title="first.md"]').click()`);
		await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("from outside"));
		const before = readFileSync(join(cwd, "first.md"), "utf8");
		// Put the cursor at the end of the first line, so it can be seen not to move.
		await app.click("#editor .cm-line", 0);
		await new Promise((r) => setTimeout(r, 100));
		await other.save("first.md", before + "SECOND TAB\n");
		await until("the other tab's line", async () => (await editorText(app)).includes("SECOND TAB"));
		assert.equal(await editorStatus(app), "saved");
		assert.equal(await app.evaluate("!!document.querySelector('#editor [role=alert]')"), false, "no conflict: nothing was typed");
	} finally {
		other.close();
	}
});

check("a change that does not touch unsaved typing is fitted around it", async ({ app, api, cwd }) => {
	const other = await otherTab(api);
	try {
		const before = readFileSync(join(cwd, "first.md"), "utf8");
		// Type at the start, then have the other tab append at the end inside the autosave pause.
		await app.click("#editor .cm-line", 0);
		await new Promise((r) => setTimeout(r, 100));
		assert.equal(await type(app, "MINE "), true);
		await other.save("first.md", before + "THIRD\n");
		await until("both", async () => { const t = await editorText(app); return t.includes("MINE") && t.includes("THIRD"); });
		assert.equal(await app.evaluate("!!document.querySelector('#editor [role=alert]')"), false, "no conflict: the two did not touch");
		await until("the save to land", async () => (await editorStatus(app)) === "saved");
		const disk = readFileSync(join(cwd, "first.md"), "utf8");
		assert.ok(disk.includes("MINE") && disk.includes("THIRD"), "both reached the disk");
	} finally {
		other.close();
	}
});

check("⌘Z undoes what was typed here, not what arrived from elsewhere", async ({ app, cwd }) => {
	await until("a clean editor", async () => (await editorStatus(app)) === "saved");
	assert.ok((await editorText(app)).includes("THIRD"), "the other tab's line is on screen");
	await app.click("#editor .cm-line", 0);
	await new Promise((r) => setTimeout(r, 100));
	await app.press("z", { meta: true });
	await app.press("z", { meta: true });
	await new Promise((r) => setTimeout(r, 200));
	const text = await editorText(app);
	assert.ok(text.includes("THIRD"), "undo did not reach the other tab's change");
	assert.ok(!text.includes("MINE"), "undo did take back the typing");
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "first.md"), "utf8").includes("THIRD"));
});

check("a change to the same words as unsaved typing is put to the person", async ({ app, api, cwd }) => {
	const other = await otherTab(api);
	try {
		const before = readFileSync(join(cwd, "first.md"), "utf8");
		await app.click("#editor .cm-line", 0);
		await new Promise((r) => setTimeout(r, 100));
		assert.equal(await type(app, "OVER "), true);
		// The other tab rewrites the first line, which is where the typing is.
		await other.save("first.md", before.replace(/^[^\n]*/, "# rewritten"));
		await until("the refusal", async () => (await editorStatus(app)) === "conflict");
		assert.ok((await app.evaluate("document.querySelector('#editor [role=alert]')?.textContent ?? ''")).includes("changed on disk"));
		await app.evaluate(`[...document.querySelectorAll('#editor [role=alert] button')].find((b) => b.textContent === "Reload").click()`);
		await until("their line", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("# rewritten"));
	} finally {
		other.close();
	}
});

check("a write that did not pass through the app arrives as outside's change", async ({ app, cwd }) => {
	// pi's bash, or another editor: straight to the disk, with the note open and clean.
	await until("a clean editor", async () => (await editorStatus(app)) === "saved");
	const before = readFileSync(join(cwd, "first.md"), "utf8");
	writeFileSync(join(cwd, "first.md"), before + "FROM BASH\n");
	await until("the line from outside", async () => (await editorText(app)).includes("FROM BASH"));
	assert.equal(await editorStatus(app), "saved");
	assert.equal(await app.evaluate("!!document.querySelector('#editor [role=alert]')"), false);
	const log = readFileSync(join(cwd, ".pi/history/first.md.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(log.at(-1).author, "outside");
	assert.ok(log.at(-1).inserted.includes("FROM BASH"));
	// And the version moved with it: typing now saves without a refusal.
	assert.equal(await type(app, "AFTER "), true);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "first.md"), "utf8").includes("AFTER"));
});

check("a note deleted on disk is put to the person, and can be put back from the screen", async ({ app, cwd }) => {
	await until("a clean editor", async () => (await editorStatus(app)) === "saved");
	const shown = await editorText(app);
	rmSync(join(cwd, "first.md"));
	await until("the notice", async () => (await editorStatus(app)) === "gone");
	assert.ok((await app.evaluate("document.querySelector('#editor [role=alert]')?.textContent ?? ''")).includes("no longer on disk"));
	await app.evaluate(`[...document.querySelectorAll('#editor [role=alert] button')].find((b) => b.textContent === "Put it back").click()`);
	await until("the note back", async () => (await editorStatus(app)) === "saved" && existsSync(join(cwd, "first.md")));
	// textContent runs the lines together; the file has its newlines.
	assert.equal(readFileSync(join(cwd, "first.md"), "utf8").replace(/\n/g, ""), shown);
	assert.equal(await app.evaluate("!!document.querySelector('#editor [role=alert]')"), false);
});

check("what pi wrote is marked, until it is accepted or put back", async ({ app, cwd }) => {
	await app.evaluate(`document.querySelector('#notes button[title="ideas/second.md"]').click()`);
	await until("pi's marks", async () => (await piMarks(app)).length === 2);
	assert.deepEqual(await piMarks(app), ["SECOND", "pi wrote this"]);
	await app.shot("pending");
	// Accepting: the words stay, the mark goes, and it is in the record.
	assert.equal(await chordOnMark(app, 1, "Enter"), "pressed");
	await until("the mark to go", async () => (await piMarks(app)).length === 1);
	assert.ok((await editorText(app)).includes("pi wrote this"));
	assert.ok(readFileSync(join(cwd, ".pi/history/ideas/second.md.jsonl"), "utf8").split("\n").filter(Boolean).length === 4);
	// Putting back: pi's word is replaced by the one it replaced, and that is saved as mine.
	assert.equal(await chordOnMark(app, 0, "Backspace"), "pressed");
	await until("the old word", async () => (await editorText(app)).includes("# second"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "ideas/second.md"), "utf8").startsWith("# second"));
	assert.deepEqual(await piMarks(app), []);
});

check("⌘N makes an untitled note and opens it", async ({ app, cwd }) => {
	await app.evaluate("document.body.focus()");
	await app.press("n", { meta: true });
	await until("the new note", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("location.hash")) === "#Untitled.md");
	const path = decodeURIComponent((await app.evaluate("location.hash")).slice(1));
	assert.equal(readFileSync(join(cwd, path), "utf8"), "");
	assert.equal(await app.evaluate(`document.querySelector('#notes button[data-active="true"]')?.title`), path);
	assert.equal(await type(app, "# today"), true);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.equal(readFileSync(join(cwd, path), "utf8"), "# today");
});

/** Type a name into the title field, the way a person would, and press a key. */
const retitle = async (page, name, key = "Enter") => {
	await page.click("#title");
	await page.evaluate(`(() => { const t = document.getElementById('title'); t.select(); document.execCommand("insertText", false, ${JSON.stringify(name)}); })()`);
	await page.press(key);
};

check("the title is the file's name, and changing it moves the note with its text", async ({ app, cwd }) => {
	assert.equal(await app.evaluate("document.getElementById('title').value"), "Untitled");
	await retitle(app, "My note");
	await until("the new address", async () => (await app.evaluate("location.hash")) === "#My%20note.md");
	assert.equal(await app.evaluate("document.getElementById('title').value"), "My note");
	assert.equal(existsSync(join(cwd, "Untitled.md")), false);
	assert.equal(readFileSync(join(cwd, "My note.md"), "utf8"), "# today", "the text went with it");
	assert.ok((await editorText(app)).includes("# today"), "and stayed on screen");
	assert.equal(await app.evaluate(`document.querySelector('#notes button[data-active="true"]')?.title`), "My note.md");
	// Typing after the move saves to the new path.
	await until("a clean editor", async () => (await editorStatus(app)) === "saved");
	assert.equal(await type(app, "MOVED "), true);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "My note.md"), "utf8").includes("MOVED"));
});

check("a name already taken is refused, and the old one comes back with Escape", async ({ app, cwd }) => {
	await retitle(app, "first");
	await until("the refusal", () => app.evaluate("document.querySelector('#title ~ [role=alert]')?.textContent ?? ''"));
	assert.equal(await app.evaluate("location.hash"), "#My%20note.md", "nothing moved");
	assert.ok(existsSync(join(cwd, "first.md")) && existsSync(join(cwd, "My note.md")));
	await app.press("Escape");
	assert.equal(await app.evaluate("document.getElementById('title').value"), "My note");
	assert.equal(await app.evaluate("!!document.querySelector('#title ~ [role=alert]')"), false);
});

check("a list item continues on Enter and ends on a second, and a bracket closes as it opens", async ({ app, cwd }) => {
	await app.evaluate(`document.querySelector('#notes button[title="ideas/second.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	// Start a list at the end of the note.
	await app.press("End", { meta: true });
	await app.press("Enter");
	assert.equal(await type(app, "- one"), true);
	await app.press("Enter");
	assert.equal(await type(app, "two"), true);
	await app.press("Enter");
	await app.press("Enter");
	assert.equal(await type(app, "after "), true);
	await app.keys("(");
	await until("the list and the pair", async () => (await editorText(app)).includes("- one- twoafter ()"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	// The second Enter takes the empty marker away and leaves the cursor on that line.
	assert.match(readFileSync(join(cwd, "ideas/second.md"), "utf8"), /- one\n- two\n\n?after \(\)/);
});

check("an empty note says so, and a code block is drawn in a monospace", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "empty.md"), "");
	writeFileSync(join(cwd, "code.md"), "text\n\n```js\nconst a = 1;\n```\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="code.md"]') && !!document.querySelector('#notes button[title="empty.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="empty.md"]').click()`);
	await until("the placeholder", () => app.evaluate("document.querySelector('#editor .cm-placeholder')?.textContent === 'Write here'"));
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-content')?.getAttribute('aria-label')"), "Note");
	await app.evaluate(`document.querySelector('#notes button[title="code.md"]').click()`);
	await until("the code lines", async () => (await app.evaluate("document.querySelectorAll('#editor .cm-code-line').length")) === 3);
	// "text", the blank under it, and the empty last line after the closing fence.
	assert.equal(await app.evaluate("[...document.querySelectorAll('#editor .cm-line')].filter((l) => !l.classList.contains('cm-code-line')).length"), 3, "the prose lines are not");
});

check("deleting a note closes it and offers it back, and Restore brings it back open", async ({ app, cwd }) => {
	await app.evaluate(`document.querySelector('#notes button[title="code.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved");
	await app.evaluate(`document.querySelector('button[aria-label="Delete note"]').click()`);
	await until("the column to empty", () => app.evaluate("!document.getElementById('editor') && document.body.textContent.includes('Deleted code')"));
	assert.equal(existsSync(join(cwd, "code.md")), false);
	assert.equal(existsSync(join(cwd, ".pi/trash/notes/code.md")), true);
	assert.equal(await app.evaluate(`!!document.querySelector('#notes button[title="code.md"]')`), false, "off the list");
	await app.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === "Restore").click()`);
	await until("the note back", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("location.hash")) === "#code.md");
	assert.equal(existsSync(join(cwd, "code.md")), true);
	assert.ok((await editorText(app)).includes("const a = 1;"));
});

check("⌘P finds a note by a few letters, and makes one that is not there", async ({ app, cwd }) => {
	await app.press("p", { meta: true });
	await until("the palette", () => app.evaluate("document.activeElement?.dataset.slot === 'command-input'"));
	// Before typing: the notes opened most recently, newest first.
	const first = await app.evaluate(`document.querySelector('[data-slot=command-list] [cmdk-group-heading]')?.textContent`);
	assert.equal(first, "Recent");
	await app.keys("my no");
	await until("the match", () => app.evaluate(`[...document.querySelectorAll('[data-slot=command-list] [cmdk-item][data-selected="true"]')].map((i) => i.textContent).join(',')`).then((t) => t.includes("My note")));
	await app.press("Enter");
	await until("the note", async () => (await app.evaluate("location.hash")) === "#My%20note.md" && (await editorStatus(app)) === "saved");
	await app.press("p", { meta: true });
	await until("the palette", () => app.evaluate("document.activeElement?.dataset.slot === 'command-input'"));
	await app.keys("brand new");
	await until("the offer", () => app.evaluate(`[...document.querySelectorAll('[data-slot=command-list] [cmdk-item]')].some((i) => i.textContent.includes('Create "brand new"'))`));
	await app.press("Enter");
	await until("the new note", async () => (await app.evaluate("location.hash")) === "#brand%20new.md" && (await editorStatus(app)) === "saved");
	assert.equal(existsSync(join(cwd, "brand new.md")), true);
});

check("⌘F finds in the note, and Escape puts the panel away", async ({ app }) => {
	await app.evaluate(`document.querySelector('#notes button[title="ideas/second.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("f", { meta: true });
	await until("the panel", () => app.evaluate("document.activeElement?.name === 'search'"));
	await app.keys("two");
	await app.press("Enter");
	await until("the match", () => app.evaluate("document.querySelectorAll('#editor .cm-searchMatch').length > 0"));
	assert.equal(await app.evaluate("getSelection().toString()"), "two");
	await app.shot("search");
	await app.press("Escape");
	await until("the panel gone", () => app.evaluate("!document.querySelector('#editor .cm-panel.cm-search')"));
	assert.equal(await app.evaluate("document.activeElement?.classList.contains('cm-content')"), true, "focus goes back to the note");
});

check("links are drawn, a missing one differently; ⌘+click follows one and makes the other", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "hub.md"), "go to [[My note]] or [[nowhere yet]]\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="hub.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="hub.md"]').click()`);
	await until("the links", async () => (await app.evaluate("document.querySelectorAll('#editor .cm-wikilink').length")) === 2);
	assert.deepEqual(
		await app.evaluate("[...document.querySelectorAll('#editor .cm-wikilink')].map((l) => l.classList.contains('cm-wikilink-missing'))"),
		[false, true],
	);
	// Follow the one that exists.
	await app.click("#editor .cm-wikilink", 0, { meta: true });
	await until("My note", async () => (await app.evaluate("location.hash")) === "#My%20note.md");
	await until("its backlinks", () => app.evaluate("document.querySelector('#backlinks')?.textContent ?? ''").then((t) => t.includes("hub")));
	// Back by the backlink, then make the missing one.
	await app.evaluate(`[...document.querySelectorAll('#backlinks button')].find((b) => b.title === "hub.md").click()`);
	await until("hub again", async () => (await app.evaluate("location.hash")) === "#hub.md" && (await app.evaluate("document.querySelectorAll('#editor .cm-wikilink').length")) === 2);
	await app.click("#editor .cm-wikilink", 1, { meta: true });
	await until("the new note", async () => (await app.evaluate("location.hash")) === "#nowhere%20yet.md" && (await editorStatus(app)) === "saved");
	assert.equal(existsSync(join(cwd, "nowhere yet.md")), true);
	// And back in hub the link is no longer missing.
	await app.evaluate(`document.querySelector('#notes button[title="hub.md"]').click()`);
	await until("no missing link", async () => (await app.evaluate("document.querySelectorAll('#editor .cm-wikilink-missing').length")) === 0);
});

check("typing [[ offers the notes, and Enter takes one", async ({ app, cwd }) => {
	await app.evaluate(`document.querySelector('#notes button[title="hub.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("End", { meta: true });
	await app.press("Enter");
	await app.keys("[[my");
	await until("the offer", () => app.evaluate("[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((l) => l.textContent).join(',')").then((t) => t.includes("My note")));
	await app.press("Enter");
	await until("the link", async () => (await editorText(app)).endsWith("[[My note]]"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "hub.md"), "utf8").endsWith("[[My note]]"));
});

check("⌘⇧F finds words in any note, and Enter opens the note they are in", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "far.md"), "# far\n\nsomewhere a Haystack-Needle sits\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="far.md"]')`));
	await app.press("f", { meta: true, shift: true });
	await until("the palette", () => app.evaluate("document.activeElement?.dataset.slot === 'command-input'"));
	await app.keys("haystack-needle");
	await until("the hit", () => app.evaluate(`[...document.querySelectorAll('[data-slot=command-list] [cmdk-item][data-selected="true"]')].map((i) => i.textContent).join(',')`).then((t) => t === "far·somewhere a Haystack-Needle sits"));
	await app.shot("search-notes");
	await app.press("Enter");
	await until("the note", async () => (await app.evaluate("location.hash")) === "#far.md" && (await editorStatus(app)) === "saved");
	assert.equal(await app.evaluate("!!document.querySelector('[data-slot=command-input]')"), false, "the palette closed");
});

check("the bench renders every scenario it knows", async ({ bench }) => {
	const scenarios = await until("the gallery", () =>
		bench.evaluate("[...document.querySelectorAll('select option')].map((o) => o.value).join(',')"),
	);
	for (const id of ["tool-headers", "branches", "thinking", "recorded:turn-with-tools"]) {
		assert.ok(scenarios.includes(id), `the bench is missing ${id}`);
	}
});

check("nothing was written to the console", async ({ app, bench }) => {
	assert.deepEqual([...app.errors, ...bench.errors], []);
});

async function main() {
	const chrome = CHROMES.find((path) => path && existsSync(path));
	if (!chrome) {
		console.error("no Chrome found. Set CHROME to one, or install Google Chrome.");
		process.exit(1);
	}

	const cwd = mkdtempSync(join(tmpdir(), "pi-e2e-"));
	const profile = mkdtempSync(join(tmpdir(), "pi-e2e-chrome-"));
	const sessionFile = branchedSession(cwd);
	// Two notes and a file that is not one, for the sidebar to sort out.
	mkdirSync(join(cwd, "ideas"));
	writeFileSync(join(cwd, "ideas", "second.md"), "# second\n");
	writeFileSync(join(cwd, "first.md"), "# first\n");
	writeFileSync(join(cwd, "not-a-note.txt"), "no\n");
	// A note pi has written in, with the history that says so: the heading's
	// word replaced, and a line added. Replaying the log gives the file.
	writeFileSync(join(cwd, "ideas", "second.md"), "# SECOND\n\npi wrote this\n");
	mkdirSync(join(cwd, ".pi", "history", "ideas"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "history", "ideas", "second.md.jsonl"),
		[
			{ author: "outside", at: 1, from: 0, to: 0, inserted: "# second\n\n", removed: "" },
			{ author: "pi", at: 2, sessionId: "s", entryId: "e", from: 2, to: 8, inserted: "SECOND", removed: "second" },
			{ author: "pi", at: 3, sessionId: "s", entryId: "e", from: 10, to: 10, inserted: "pi wrote this\n", removed: "" },
		].map((c) => JSON.stringify(c)).join("\n") + "\n",
	);
	const [api, web, devtools] = await Promise.all([freePort(), freePort(), freePort()]);
	const children = [];
	const logs = new Map();

	const start = (name, command, args, env) => {
		const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env } });
		children.push(child);
		logs.set(name, []);
		for (const stream of [child.stdout, child.stderr]) {
			stream.on("data", (chunk) => logs.get(name).push(chunk.toString()));
		}
		return child;
	};

	const dump = () => {
		for (const [name, lines] of logs) {
			const tail = lines.join("").trim().split("\n").slice(-10).join("\n  ");
			if (tail) console.log(`\n--- ${name}\n  ${tail}`);
		}
	};

	let page;
	let bench;
	try {
		// The client's dev server reads PORT to know where to proxy the socket,
		// which is the same variable the server reads to listen on.
		// The binaries, not npx: npx is a wrapper that outlives nothing and takes
		// nothing with it, so a signal sent to it leaves the server running.
		start("server", bin("tsx"), ["server.ts"], { WORKDIR: cwd, PORT: String(api) });
		start("vite", bin("vite"), ["--port", String(web), "--strictPort"], { PORT: String(api) });
		start("chrome", chrome, [
			"--headless=new",
			"--disable-gpu",
			// pi's column is a share of the window, and a narrow one leaves it
			// too small to hold the controls this is here to press.
			"--window-size=1600,1000",
			// The store tells React about new items on an animation frame, and a
			// page the browser thinks nobody is looking at does not get any. It
			// would sit there holding a conversation it never drew.
			"--disable-renderer-backgrounding",
			"--disable-backgrounding-occluded-windows",
			"--disable-features=CalculateNativeWinOcclusion",
			"--no-first-run",
			"--no-default-browser-check",
			`--user-data-dir=${profile}`,
			`--remote-debugging-port=${devtools}`,
			"about:blank",
		]);

		await until("the api server", () => fetch(`http://localhost:${api}/`).then((r) => r.ok));
		await until("the dev server", () => fetch(`http://localhost:${web}/`).then((r) => r.ok));
		await until("the browser", () => fetch(`http://localhost:${devtools}/json/version`).then((r) => r.ok));

		page = await openPage(devtools, `http://localhost:${web}/`);
		bench = await openPage(devtools, `http://localhost:${web}/gallery.html`);

		// Open the branched session. The answer reaches the page's own socket,
		// because the server publishes a snapshot to everyone connected.
		await until("the conversation", () => page.evaluate("!!document.getElementById('chat')"));
		const opened = await page.evaluate(`new Promise((done) => {
			const seen = [];
			const socket = new WebSocket("ws://" + location.host + "/ws");
			socket.onmessage = (e) => { const m = JSON.parse(e.data); seen.push(m.type === "error" ? "error: " + m.message : m.type === "snapshot" ? "snapshot(" + m.items.length + ")" : m.type); };
			socket.onopen = () => socket.send(JSON.stringify({ type: "resume_session", path: ${JSON.stringify(sessionFile)} }));
			setTimeout(() => { socket.close(); done(seen.join(",")); }, 2500);
		})`);
		// What the server said back, so a failure here is about the session and
		// not about the browser. Everything after this is about the browser.
		if (!/snapshot\([1-9]/.test(opened)) {
			throw new Error(`the branched session did not open — the server answered: ${opened}`);
		}

		let failed = 0;
		for (const { name, run } of checks) {
			try {
				await run({ app: page, bench, cwd, api });
				console.log(`  ok  ${name}`);
			} catch (error) {
				failed++;
				console.log(`  FAIL ${name}`);
				console.log(`       ${(error.message ?? error).toString().split("\n").join("\n       ")}`);
			}
		}

		console.log(`\n${checks.length - failed}/${checks.length} passed`);
		if (failed) {
			dump();
			process.exitCode = 1;
		}
	} catch (error) {
		console.error(`\n${error.message ?? error}`);
		dump();
		process.exitCode = 1;
	} finally {
		page?.close();
		bench?.close();
		await closeBrowser(devtools);
		// Waited for, not just asked: a browser still writing to its profile
		// makes removing that profile fail, and a cleanup that throws replaces
		// whatever went wrong with something that did not.
		await Promise.all(children.map(stop));
		// The session pi wrote lives beside the working folder, not inside it.
		const sessionDir = sessionFile ? join(sessionFile, "..") : null;
		for (const path of [cwd, profile, sessionDir]) {
			if (!path) continue;
			try {
				rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
			} catch (error) {
				console.error(`could not remove ${path}: ${error.message}`);
			}
		}
	}
}

await main();
