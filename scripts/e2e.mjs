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
	/** Choosing words with the mouse: press at one end of an element and let go at the other. */
	const drag = async (selector, nth = 0) => {
		const box = await evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + 1, r.top + r.height / 2, r.right - 1]; })()`);
		if (!box) return false;
		const [x, y, end] = box;
		await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
		await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: (x + end) / 2, y, button: "left", buttons: 1 });
		await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: end, y, button: "left", buttons: 1 });
		await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: end, y, button: "left", buttons: 0, clickCount: 1 });
		return true;
	};
	const CODES = { Enter: 13, Backspace: 8, Escape: 27, End: 35, Tab: 9, b: 66, e: 69, f: 70, i: 73, k: 75, n: 78, p: 80, z: 90 };
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
	/** A syllable typed through an input method: composed as it is built, then committed as one. */
	const ime = async (composing, committed) => {
		for (let i = 1; i <= composing.length; i++) {
			const text = composing.slice(0, i);
			await call("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
		}
		await call("Input.insertText", { text: committed });
	};
	return { evaluate, shot, errors, click, drag, press, keys, ime, close: () => socket.close() };
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

/**
 * The note as the editor holds it. Not the DOM's text: live preview hides
 * markup, and only the visible lines are drawn. `cmTile.root.view` is what
 * EditorView.findFromDOM reads, without needing the class in the page.
 */
const editorText = (page) => page.evaluate("document.querySelector('#editor .cm-content')?.cmTile?.root?.view?.state.doc.toString() ?? ''");
/** What is drawn, as text: the doc less whatever live preview hides. */
const shownText = (page) => page.evaluate("document.querySelector('#editor .cm-content')?.textContent ?? ''");
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

check("a heading's marks are hidden until the cursor is on it, and ⌘E shows them all", async ({ app }) => {
	// The cursor is on the first line after opening; move it off the heading.
	await app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); const v = box.cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the # to be hidden", async () => !(await shownText(app)).includes("# first") && (await shownText(app)).includes("first"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 0 } }); })()`);
	await until("the # to be back under the cursor", async () => (await shownText(app)).includes("# first"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("hidden again", async () => !(await shownText(app)).includes("# first"));
	await app.press("e", { meta: true });
	await until("source mode", async () => (await shownText(app)).includes("# first"));
	await app.press("e", { meta: true });
	await until("live preview again", async () => !(await shownText(app)).includes("# first"));
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
	assert.equal(readFileSync(join(cwd, "first.md"), "utf8"), shown);
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

check("choosing words in a note shows them above the box, and the × takes them off", async ({ app }) => {
	await app.evaluate(`document.querySelector('#notes button[title="first.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved");
	// Chosen the way a person chooses: dragged across the line.
	assert.equal(await app.drag("#editor .cm-line", 0), true);
	const chip = await until("the chosen words above the box", async () => {
		const text = await app.evaluate("document.getElementById('chosen')?.textContent ?? ''");
		return text.trim() ? text : null;
	});
	assert.ok((await editorText(app)).includes(chip.trim()), `what is above the box is what is chosen in the note: ${chip}`);
	await app.shot("chosen");
	// Taking them off leaves the words chosen on screen and only stops them going.
	await app.evaluate(`document.querySelector('#chosen button').click()`);
	await until("the chip to go", async () => !(await app.evaluate("!!document.getElementById('chosen')")));
	assert.equal(await app.evaluate("!!document.querySelector('#editor .cm-selectionBackground, #editor .cm-selectionLayer > *')"), true, "the words are still chosen");
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

check("a slash in the title moves the note to that folder, and a leading one back to the top", async ({ app, cwd }) => {
	await retitle(app, "ideas/moved");
	await until("the new address", async () => (await app.evaluate("location.hash")) === "#ideas/moved.md");
	assert.equal(await app.evaluate("document.getElementById('title').value"), "moved");
	assert.equal(existsSync(join(cwd, "My note.md")), false);
	assert.ok(readFileSync(join(cwd, "ideas/moved.md"), "utf8").includes("MOVED"), "the text went with it");
	await until("the row to follow", async () => (await app.evaluate(`document.querySelector('#notes button[data-active="true"]')?.title`)) === "ideas/moved.md");
	// Back to the top, where the checks after this one look for it.
	await retitle(app, "/My note");
	await until("the old address", async () => (await app.evaluate("location.hash")) === "#My%20note.md");
	assert.ok(existsSync(join(cwd, "My note.md")) && !existsSync(join(cwd, "ideas/moved.md")));
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
	await until("the list and the pair", async () => /- one\n- two\n\n?after \(\)/.test(await editorText(app)));
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

check("a task is a box off the cursor's line, ticked by a click or ⌘Enter, and a rule is a line", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tasks.md"), "- [ ] one\n- [x] two\n\n---\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="tasks.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="tasks.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("- [ ] one"));
	// The cursor lands on the first line, so that task stays as text and the other is a box; the rule is a line.
	await until("one box and a rule", () => app.evaluate("document.querySelectorAll('#editor input.cm-task').length === 1 && document.querySelectorAll('#editor hr.cm-rule').length === 1"));
	assert.ok((await shownText(app)).includes("[ ] one"));
	assert.ok(!(await shownText(app)).includes("[x] two"));
	// Clicking the box ticks it off in the text.
	assert.equal(await app.click("#editor input.cm-task", 0), true);
	await until("two unticked", async () => (await editorText(app)).includes("- [ ] two"));
	// ⌘Enter on the cursor's line ticks that one.
	await app.press("Enter", { meta: true });
	await until("one ticked", async () => (await editorText(app)).includes("- [x] one"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.equal(readFileSync(join(cwd, "tasks.md"), "utf8"), "- [x] one\n- [ ] two\n\n---\n\nend\n");
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

check("a quote is one element around its lines; a quote in a quote is a bar in a bar; it wraps and takes Hangul", async ({ app, cwd }) => {
	const long = "word ".repeat(40).trim();
	// The bare `>` line: without it, "after" would be a lazy continuation of the inner quote, as CommonMark has it.
	writeFileSync(join(cwd, "quotes.md"), `> ${long}\n> > inner\n>\n> after\n\nend\n`);
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="quotes.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="quotes.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await until("the quote elements", () => app.evaluate("document.querySelectorAll('#editor .cm-quote').length === 2 && !!document.querySelector('#editor .cm-quote .cm-quote')"));
	const shape = await app.evaluate(`(() => {
		const outer = document.querySelector('#editor .cm-quote'); const inner = outer.querySelector('.cm-quote');
		const lines = [...outer.querySelectorAll(':scope > .cm-line')];
		const px = (el) => parseFloat(getComputedStyle(el).paddingLeft);
		return { outerLines: lines.length, innerLines: inner.querySelectorAll('.cm-line').length, wraps: lines[0].getBoundingClientRect().height > 2 * lines[2].getBoundingClientRect().height, innerLeft: inner.getBoundingClientRect().left - outer.getBoundingClientRect().left, room: px(outer) + parseFloat(getComputedStyle(outer).borderLeftWidth) };
	})()`);
	assert.equal(shape.outerLines, 3, `the outer quote's own lines — the long one, the bare >, "after": ${JSON.stringify(shape)}`);
	assert.equal(shape.innerLines, 1, `the inner quote's line: ${JSON.stringify(shape)}`);
	assert.ok(shape.wraps, `the long line wraps inside the element: ${JSON.stringify(shape)}`);
	assert.ok(Math.abs(shape.innerLeft - shape.room) < 1, `the inner bar stands just inside the outer's bar and room: ${JSON.stringify(shape)}`);
	// Hangul composed on a quote line, where the marks are drawn back under the cursor: lands whole, nothing torn.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; const line = v.state.doc.line(4); v.dispatch({ selection: { anchor: line.to } }); })()`);
	await app.ime("ㅎㅏㄴ", "한");
	await app.ime("ㄱㅡㄹ", "글");
	await until("the syllables", async () => (await editorText(app)).includes("> after한글"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.deepEqual(app.errors, [], "nothing thrown while composing");
	await app.shot("quotes");
});

check("a bullet is a dot off its line, and a task shows its box alone", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "bullets.md"), "- one\n- [ ] two\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="bullets.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="bullets.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("- [ ] two"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("a dot, and a box without a dash", async () => (await shownText(app)).includes("• one") && (await shownText(app)).includes("two") && !(await shownText(app)).includes("- "));
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-bullet').length"), 1);
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 2 } }); })()`);
	await until("the dash back under the cursor", async () => (await shownText(app)).includes("- one"));
});

check("Tab nests a numbered item and the numbers follow; Shift-Tab brings it back", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "numbered.md"), "1. a\n2. b\n3. c\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="numbered.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="numbered.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 6 } }); })()`);
	await app.press("Tab");
	await until("b nested under a, c renumbered", async () => (await editorText(app)) === "1. a\n    1. b\n2. c\n");
	await app.press("Tab", { shift: true });
	await until("back in one list", async () => (await editorText(app)) === "1. a\n2. b\n3. c\n");
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
});

check("the smaller marks hide too, and a done task reads as done", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "small.md"), "- [x] done ~~gone~~ `code`\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="small.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="small.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("~~gone~~"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the marks hidden", async () => (await shownText(app)).includes("done gone code"));
	assert.equal(await app.evaluate("getComputedStyle(document.querySelector('#editor .cm-task-done')).textDecorationLine"), "line-through");
	assert.notEqual(await app.evaluate("[...document.querySelectorAll('#editor .cm-task-done span')].map((s) => getComputedStyle(s).backgroundColor).find((c) => c !== 'rgba(0, 0, 0, 0)')"), undefined, "inline code sits in a box");
	await app.shot("small-marks");
});

check("a %% line opens a comment that runs over blank lines to the next", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "block-comment.md"), "kept\n\n%%\nnot [[this]]\n\n# nor this\n%%\n\nkept too\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="block-comment.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="block-comment.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("kept too"));
	// Everything between the fences is one comment: no link drawn, no heading style. The fences are marks, drawn as marks are.
	await until("the comment", () => app.evaluate("[...document.querySelectorAll('#editor .cm-comment')].map((s) => s.textContent).join('')").then((t) => t.includes("not [[this]]") && t.includes("# nor this")));
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-wikilink').length"), 0);
});

check("under a note, the notes that share its tags", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "shared-a.md"), "#team notes\n");
	writeFileSync(join(cwd, "shared-b.md"), "more #Team and #other\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="shared-a.md"]') && !!document.querySelector('#notes button[title="shared-b.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="shared-a.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("#team"));
	await until("the tagged strip", () => app.evaluate("document.querySelector('#tagged')?.textContent ?? ''").then((t) => t.includes("shared-b") && t.includes("#team") && !t.includes("#other")));
	// The other note loses the tag: the strip goes.
	writeFileSync(join(cwd, "shared-b.md"), "no more\n");
	await until("the strip to go", () => app.evaluate("!document.querySelector('#tagged')"));
});

check("%%a comment%% is set apart, its marks hidden off the cursor", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "comment.md"), "say %%to self%% now\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="comment.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="comment.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("%%to self%%"));
	await until("the comment, as one span", () => app.evaluate("[...document.querySelectorAll('#editor .cm-comment')].map((s) => s.textContent).join('')").then((t) => t.includes("to self")));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the marks to be hidden", async () => (await shownText(app)).includes("say to self now"));
});

check("a quote opening with [!note] is a callout, named by its type", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "callout.md"), "> [!note] Keep\n> the body\n\nafter\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="callout.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="callout.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("[!note]"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("one callout element around two lines, the first a title", () => app.evaluate("document.querySelectorAll('#editor .cm-callout').length === 1 && document.querySelectorAll('#editor .cm-callout .cm-line').length === 2 && document.querySelector('#editor .cm-callout-title')?.dataset.callout === 'note'"));
	await until("the marker hidden", async () => !(await shownText(app)).includes("[!note]"));
	// The type is drawn before the title by CSS, from the attribute.
	assert.equal(await app.evaluate("getComputedStyle(document.querySelector('#editor .cm-callout-title'), '::before').content"), '"note"');
	await app.shot("callout");
});

check("a #tag is set off from the prose, and a # in a URL or a heading is not", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tags.md"), "# top\n\nsee #one and https://x.y/p#frag\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="tags.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="tags.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("#one"));
	await until("one tag", () => app.evaluate("[...document.querySelectorAll('#editor .cm-tag')].map((s) => s.textContent).join('|')").then((t) => t === "#one"));
});

check("==words== are washed with colour, their marks hidden off the cursor", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "hl.md"), "say ==hi== now\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="hl.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="hl.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("==hi=="));
	await until("the highlight, as one span", () => app.evaluate("[...document.querySelectorAll('#editor .cm-highlight')].map((s) => s.textContent).join('|')").then((t) => t.includes("hi")));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the marks to be hidden", async () => (await shownText(app)).includes("say hi now"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 6 } }); })()`);
	await until("the marks back under the cursor", async () => (await shownText(app)).includes("==hi=="));
});

check("a note's front matter is one muted block, not a rule and a paragraph", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "props.md"), "---\ntags: [x]\n---\n\n# body\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="props.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="props.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("# body"));
	// Off the cursor's line a rule would be drawn as one; front matter's dashes are not rules.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the heading's mark to be hidden", async () => !(await shownText(app)).includes("# body"));
	assert.equal(await app.evaluate("document.querySelectorAll('#editor hr.cm-rule').length"), 0);
	assert.ok((await shownText(app)).includes("---tags: [x]---"), "the block is shown as written");
});

check("a note opens again where it was left", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "left.md"), "one\ntwo\nthree\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="left.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="left.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("three"));
	const head = () => app.evaluate("document.querySelector('#editor .cm-content')?.cmTile?.root?.view?.state.selection.main.head");
	assert.equal(await head(), 0, "a note never left opens at the top");
	const end = (await editorText(app)).length;
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: ${end} } }); })()`);
	await app.evaluate(`document.querySelector('#notes button[title="ideas/second.md"]').click()`);
	await until("the other note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("second"));
	await app.evaluate(`document.querySelector('#notes button[title="left.md"]').click()`);
	await until("back at the end", async () => (await editorStatus(app)) === "saved" && (await head()) === end);
});

check("a list item's wrapped lines start where its words do", async ({ app, cwd }) => {
	const long = "word ".repeat(40).trim();
	writeFileSync(join(cwd, "list.md"), `- ${long}\n  - inner ${long}\n\n> - quoted\n`);
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="list.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="list.md"]').click()`);
	await until("the list lines", () => app.evaluate("document.querySelectorAll('#editor .cm-list-line').length === 3"));
	// The second row of the outer item sits under its words, not under the bullet; the inner item's, one unit further.
	const rows = await app.evaluate(`(() => {
		const px = (el) => parseFloat(getComputedStyle(el).paddingLeft);
		const lines = [...document.querySelectorAll('#editor .cm-list-line')];
		const [outer, inner, quoted] = lines;
		const prefix = outer.querySelector('.cm-list-prefix').getBoundingClientRect();
		return { outer: px(outer), inner: px(inner), quoted: quoted.getBoundingClientRect().left - outer.getBoundingClientRect().left, prefixWidth: prefix.width, prefixLeft: prefix.left - outer.getBoundingClientRect().left, tall: outer.getBoundingClientRect().height > 2 * inner.querySelector('.cm-list-prefix').getBoundingClientRect().height };
	})()`);
	assert.ok(rows.tall, "the item wraps");
	assert.ok(rows.outer > 0 && Math.abs(rows.inner - 2 * rows.outer) < 1, `inner is one unit further: ${JSON.stringify(rows)}`);
	assert.ok(Math.abs(rows.prefixWidth - rows.outer) < 1, `the marker's box is one unit wide: ${JSON.stringify(rows)}`);
	assert.ok(Math.abs(rows.prefixLeft) < 1, `the marker starts at the line's edge: ${JSON.stringify(rows)}`);
	assert.ok(rows.quoted > 0, `a quoted item sits inside the quote's room, past the bar: ${JSON.stringify(rows)}`);
	await app.shot("list-indent");
});

check("⌘B and ⌘I put a mark around the chosen words and take it off again", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "marks.md"), "say hi now\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="marks.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="marks.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.evaluate(`document.querySelector('#editor .cm-content').cmTile.root.view.dispatch({ selection: { anchor: 4, head: 6 } })`);
	await app.press("b", { meta: true });
	await until("bold", async () => (await editorText(app)) === "say **hi** now\n");
	await app.press("i", { meta: true });
	await until("bold italic", async () => (await editorText(app)) === "say ***hi*** now\n");
	await app.press("b", { meta: true });
	await until("italic alone", async () => (await editorText(app)) === "say *hi* now\n");
	await app.press("i", { meta: true });
	await until("plain", async () => (await editorText(app)) === "say hi now\n");
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
});

check("a < in prose offers no HTML tags", async ({ app }) => {
	await app.evaluate(`document.querySelector('#notes button[title="ideas/second.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("End", { meta: true });
	await app.keys(" <di");
	await until("the letters", async () => (await editorText(app)).includes(" <di"));
	// Completion opens a moment after typing; give it that moment, and see that it did not.
	await new Promise((r) => setTimeout(r, 400));
	assert.equal(await app.evaluate("!!document.querySelector('.cm-tooltip-autocomplete')"), false);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
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

/** The line the caret is on, and whether it is inside the editor's view — where a jump should leave both. */
const caretLine = (page) =>
	page.evaluate(`(() => {
		const n = getSelection().anchorNode;
		const line = (n?.nodeType === 1 ? n : n?.parentElement)?.closest('#editor .cm-line');
		if (!line) return null;
		const box = line.getBoundingClientRect();
		const view = document.querySelector('#editor .cm-scroller').getBoundingClientRect();
		return { text: line.textContent, seen: box.top >= view.top && box.bottom <= view.bottom };
	})()`);

check("⌘+click on a link to a heading or a block opens its note at that line", async ({ app, cwd }) => {
	// Far enough down that landing there has to scroll.
	const filler = Array.from({ length: 80 }, (_, i) => `filler ${i}`).join("\n\n");
	writeFileSync(join(cwd, "long.md"), `# long\n\n${filler}\n\nthe block ^far-block\n\n${filler}\n\n## Far down\n\nend\n`);
	writeFileSync(join(cwd, "jump.md"), "[[long#Far down]] and [[long#^far-block]]\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="jump.md"]') && !!document.querySelector('#notes button[title="long.md"]')`));
	for (const [n, line] of [[0, "## Far down"], [1, "the block ^far-block"]]) {
		await app.evaluate(`document.querySelector('#notes button[title="jump.md"]').click()`);
		await until("the links", async () => (await app.evaluate("location.hash")) === "#jump.md" && (await app.evaluate("document.querySelectorAll('#editor .cm-wikilink').length")) === 2);
		await app.click("#editor .cm-wikilink", n, { meta: true });
		await until(`the cursor on "${line}"`, async () => (await app.evaluate("location.hash")) === "#long.md" && (await caretLine(app))?.text === line);
		assert.equal((await caretLine(app)).seen, true, "and the line is in view");
	}
});

check("⌘+click on a markdown link opens the note at its path, and a web address in a new window", async ({ app, cwd, api, devtools }) => {
	const site = `http://127.0.0.1:${api}/?from=markdown-link`;
	writeFileSync(join(cwd, "ideas", "plain.md"), `[up to jump](../jump.md)\n\n[the site](${site})\n`);
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[title="ideas/plain.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[title="ideas/plain.md"]').click()`);
	await until("the note", async () => (await app.evaluate("location.hash")) === "#ideas/plain.md" && (await editorStatus(app)) === "saved");
	// A markdown link is drawn as `[`, the words, `](`, the address, `)`: the fourth is the address.
	const address = (line) => `#editor .cm-line:nth-child(${line}) > span:nth-child(4)`;
	await app.click(address(3), 0, { meta: true });
	const opened = await until("the new window", async () => (await (await fetch(`http://localhost:${devtools}/json/list`)).json()).find((t) => t.url === site));
	await fetch(`http://localhost:${devtools}/json/close/${opened.id}`);
	assert.equal(await app.evaluate("location.hash"), "#ideas/plain.md", "the note stayed where it was");
	await app.click(address(1), 0, { meta: true });
	await until("the note the path names", async () => (await app.evaluate("location.hash")) === "#jump.md" && (await editorStatus(app)) === "saved");
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
				await run({ app: page, bench, cwd, api, devtools });
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
