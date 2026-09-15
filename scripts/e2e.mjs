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
import { basename, join } from "node:path";
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
	let last;
	for (;;) {
		try {
			const value = await check();
			if (value) return value;
			last = value;
		} catch (error) {
			// Not up yet, which is the usual reason — but say so if it is the reason it ends on.
			last = error;
		}
		// What it last saw, since a timeout on its own says only that something did not happen. A
		// check that reads a number reports the number; one that returns false has nothing to add.
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}${last === false || last === undefined ? "" : ` (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`}`);
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
	const click = async (selector, nth = 0, { meta = false, button = "left" } = {}) => {
		const box = await evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
		if (!box) return false;
		const [x, y] = box;
		const modifiers = meta ? 4 : 0;
		await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
		await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1, modifiers });
		await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1, modifiers });
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
	/** Carrying one element onto another: press on the first, move over in steps, let go on the second. */
	const dragTo = async (from, to) => {
		const at = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
		const a = await at(from);
		const b = await at(to);
		if (!a || !b) return false;
		await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: a[0], y: a[1] });
		await call("Input.dispatchMouseEvent", { type: "mousePressed", x: a[0], y: a[1], button: "left", buttons: 1, clickCount: 1 });
		for (let i = 1; i <= 8; i++) {
			await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: a[0] + ((b[0] - a[0]) * i) / 8, y: a[1] + ((b[1] - a[1]) * i) / 8, button: "left", buttons: 1 });
		}
		await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: b[0], y: b[1], button: "left", buttons: 0, clickCount: 1 });
		return true;
	};
	const CODES = { Enter: 13, Backspace: 8, Delete: 46, Escape: 27, End: 35, Tab: 9, "[": 219, "]": 221, b: 66, e: 69, f: 70, i: 73, k: 75, n: 78, p: 80, t: 84, z: 90 };
	const NAMES = { "[": "BracketLeft", "]": "BracketRight" };
	const press = async (key, { meta = false, shift = false, alt = false } = {}) => {
		const modifiers = (meta ? 4 : 0) | (shift ? 8 : 0) | (alt ? 1 : 0);
		const code = key.length === 1 ? (NAMES[key] ?? `Key${key.toUpperCase()}`) : key;
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
	/** A syllable half typed and left so: the composition is open, nothing committed. */
	const compose = (text) => call("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
	return { evaluate, shot, errors, click, drag, dragTo, press, keys, ime, compose, close: () => socket.close() };
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
		`(() => { const b = [...document.querySelectorAll('#chat button[aria-label=${JSON.stringify(title)}]')].find((x) => !x.disabled); if (!b) return false; b.click(); return true; })()`,
	);
const allDisabled = (page, title) =>
	page.evaluate(
		`[...document.querySelectorAll('#chat button[aria-label=${JSON.stringify(title)}]')].every((b) => b.disabled)`,
	);

check("the app renders a conversation", async ({ app }) => {
	await until("the conversation", () => app.evaluate("!!document.getElementById('chat')"));
});

check("the sidebar's foot names the folder the notes are in", async ({ app, cwd }) => {
	// The name only; the full path is the tooltip. Without the desktop shell
	// there is nowhere else to go, so it is a label rather than a menu.
	await until("the folder's name", async () => (await app.evaluate("document.querySelector('#folder')?.textContent ?? ''")) === basename(cwd));
	assert.equal(await app.evaluate("document.querySelector('#folder').tagName"), "DIV");
});

check("the sidebar is the folder's tree: its notes and folders, a folder's notes once it is opened, and nothing else", async ({ app }) => {
	const rows = () => app.evaluate("[...document.querySelectorAll('#notes button')].map((b) => b.dataset.folder ?? b.dataset.path).join(',')");
	const listed = await until("the notes", rows);
	assert.deepEqual(listed.split(",").sort(), ["first.md", "ideas"]);
	await app.evaluate(`document.querySelector('#notes button[data-folder="ideas"]').click()`);
	await until("the folder's notes", async () => (await rows()).includes("ideas/second.md"));
	assert.deepEqual((await rows()).split(",").sort(), ["first.md", "ideas", "ideas/second.md"]);
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
		const b = [...document.querySelectorAll('#chat button[aria-label="Ask this again, differently"]')].pop();
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
 * A note picked from the sidebar's tree: the folders around it opened first,
 * as a person would, then its row clicked once it is there.
 */
const pickNote = async (page, path) => {
	const folders = path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));
	for (const folder of folders) {
		await page.evaluate(`(() => { const b = document.querySelector('#notes button[data-folder="${folder}"]'); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); })()`);
	}
	await until(`the row for ${path}`, () => page.evaluate(`!!document.querySelector('#notes button[data-path="${path}"]')`));
	await page.evaluate(`document.querySelector('#notes button[data-path="${path}"]').click()`);
};
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
		await app.evaluate(`(() => { const b = document.querySelector('#notes button[data-path="first.md"]'); if (!b) return false; b.click(); return true; })()`),
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

check("a selection is drawn as wide as the words, and shows marks only while the editor has focus", async ({ app }) => {
	// Everything selected: the band is the text column, not the margin around it.
	await app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); const v = box.cmTile.root.view; v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); })()`);
	await until("the # to show under the selection", async () => (await shownText(app)).includes("# first"));
	await until("the band to be drawn", () => app.evaluate("document.querySelectorAll('#editor .cm-selectionBackground').length > 0"));
	const band = await app.evaluate(`(() => {
		const content = document.querySelector('#editor .cm-content').getBoundingClientRect();
		const pieces = [...document.querySelectorAll('#editor .cm-selectionBackground')].map((el) => el.getBoundingClientRect());
		return { pad: getComputedStyle(document.querySelector('#editor .cm-content')).paddingLeft, count: pieces.length,
			within: pieces.every((r) => r.left >= content.left - 1 && r.right <= content.right + 1) };
	})()`);
	assert.equal(band.pad, "0px", "the content has no padding for the band to paint");
	assert.ok(band.count > 0 && band.within, "every piece of the band lies within the text column");
	// The focus goes to the composer: the selection stays, the marks go.
	await app.evaluate("document.querySelector('textarea').focus()");
	await until("the # to hide with the focus gone", async () => !(await shownText(app)).includes("# first") && (await shownText(app)).includes("first"));
	// And back: the same selection shows them again.
	await app.evaluate("document.querySelector('#editor .cm-content').focus()");
	await until("the # to be back with the focus", async () => (await shownText(app)).includes("# first"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("hidden again off the heading", async () => !(await shownText(app)).includes("# first"));
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

/** The chunks of the diff being decided about: one row of buttons each. */
const chunks = (page) => page.evaluate("document.querySelectorAll('#editor .cm-chunkButtons').length");
/** What the diff says pi took away, as drawn above the chunks. */
const takenAway = (page) => page.evaluate("[...document.querySelectorAll('#editor .cm-deletedChunk .cm-deletedText')].map((e) => e.textContent).join('|')");
/** Press the button on the last chunk. */
const onLastChunk = (page, label) =>
	page.evaluate(`[...document.querySelectorAll('#editor .cm-chunkButtons button')].filter((b) => b.textContent === ${JSON.stringify(label)}).at(-1)?.click()`);

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
		await app.evaluate(`document.querySelector('#notes button[data-path="first.md"]').click()`);
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

check("a write from outside mid-syllable waits for the syllable, then lands", async ({ app, cwd }) => {
	await until("a clean editor", async () => (await editorStatus(app)) === "saved");
	await app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); const v = box.cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await app.compose("ㅎ");
	await until("the composition to be open", () => app.evaluate("document.querySelector('#editor .cm-content').cmTile.root.view.composing"));
	const before = readFileSync(join(cwd, "first.md"), "utf8");
	writeFileSync(join(cwd, "first.md"), "MID-SYLLABLE\n" + before);
	// The change is at the server and on the socket; the editor holds it while the syllable is open.
	await new Promise((r) => setTimeout(r, 700));
	assert.ok(!(await editorText(app)).includes("MID-SYLLABLE"), "held while composing");
	await app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); })()`);
	await app.ime("ㅎㅏ", "하");
	await until("the change to land once the syllable is done", async () => (await editorText(app)).includes("MID-SYLLABLE"));
	assert.ok((await editorText(app)).includes("하"), "and the syllable is there");
	assert.deepEqual(app.errors, [], "nothing thrown");
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
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

check("what pi changed is a diff to decide about, and ⌘Z takes a decision back", async ({ app, cwd }) => {
	const log = () => readFileSync(join(cwd, ".pi/history/ideas/second.md.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
	await pickNote(app, "ideas/second.md");
	// The note opens with its diff. pi changed a word and added a line two
	// lines down, which the merge view shows as one chunk — the blank line
	// between is too short to keep them apart — and the word pi replaced is
	// drawn above it, though it is in no file.
	await until("the diff", async () => (await chunks(app)) === 1);
	assert.ok((await takenAway(app)).includes("second"), "what pi replaced is shown");
	await app.shot("diff");
	// Typing outside the chunk is the person's and not for a moment pi's:
	// "before" is kept up with it in the same transaction, so no chunk appears
	// while the autosave is still on its way, and none after it lands either.
	await app.click("#editor .cm-line", 3);
	assert.equal(await type(app, "mine"), true);
	assert.equal(await chunks(app), 1, "still one chunk, before any save");
	await until("the typing to be noticed", async () => (await editorStatus(app)) !== "saved");
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.equal(await chunks(app), 1, "and one after it");
	// Keeping: the chunk goes, the words stay, and the record hears it.
	await onLastChunk(app, "Keep");
	await until("no chunk", async () => (await chunks(app)) === 0);
	await until("the record", () => log().at(-1)?.kept === true);
	assert.ok((await editorText(app)).includes("pi wrote this"));
	// ⌘Z takes the keeping back — the chunk is there again, and the record is
	// told the other way round rather than having a line rubbed out.
	await app.click("#editor .cm-line", 0);
	await app.press("z", { meta: true });
	await until("the chunk again", async () => (await chunks(app)) === 1);
	await until("the record, the other way", () => log().at(-1)?.kept === false);
	// Undoing: what pi did is put back — the word, and the line it added —
	// which is an edit of the person's and saved as one. Nothing is left to
	// decide about, so the diff is gone.
	await app.click("#editor .cm-changedLine", 0);
	await new Promise((r) => setTimeout(r, 100));
	await app.press("Backspace", { meta: true });
	await until("the old word", async () => (await editorText(app)).includes("# second") && !(await editorText(app)).includes("pi wrote this"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "ideas/second.md"), "utf8").startsWith("# second"));
	await until("no diff", async () => (await chunks(app)) === 0);
});

check("choosing words in a note shows them above the box, and the × takes them off", async ({ app }) => {
	await app.evaluate(`document.querySelector('#notes button[data-path="first.md"]').click()`);
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

/** The line a note made here opens with, saying when it was made — see withCreated in vault.ts. */
const MADE = /^---\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}\n---\n/;
/** A note's own text, without that line. */
const written = (text) => {
	assert.match(text, MADE, "a note made here says when it was made");
	return text.replace(MADE, "");
};

check("⌘N makes an untitled note and opens it", async ({ app, cwd }) => {
	await app.evaluate("document.body.focus()");
	await app.press("n", { meta: true });
	await until("the new note", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("location.hash")) === "#Untitled.md");
	const path = decodeURIComponent((await app.evaluate("location.hash")).slice(1));
	assert.equal(written(readFileSync(join(cwd, path), "utf8")), "", "and nothing else");
	assert.equal(await app.evaluate(`document.querySelector('#notes button[data-active="true"]')?.dataset.path`), path);
	assert.equal(await type(app, "# today"), true);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.equal(written(readFileSync(join(cwd, path), "utf8")), "# today");
});

/** Open the conversation's name from the pencil, type, and commit. */
const rename = async (page, name) => {
	await page.click('#settings [aria-label="Rename"]');
	await until("the name field", () => page.evaluate("document.activeElement?.id === 'sessionTitle'"));
	// The name opens chosen, so what is typed replaces it; insertText with
	// nothing to insert does nothing, and taking the choice out is a Backspace.
	if (name) await page.evaluate(`document.execCommand("insertText", false, ${JSON.stringify(name)})`);
	else await page.press("Backspace");
	await page.press("Enter");
};

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
	assert.equal(written(readFileSync(join(cwd, "My note.md"), "utf8")), "# today", "the text went with it");
	assert.ok((await editorText(app)).includes("# today"), "and stayed on screen");
	assert.equal(await app.evaluate(`document.querySelector('#notes button[data-active="true"]')?.dataset.path`), "My note.md");
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
	await until("the row to follow", async () => (await app.evaluate(`document.querySelector('#notes button[data-active="true"]')?.dataset.path`)) === "ideas/moved.md");
	// Back to the top, where the checks after this one look for it.
	await retitle(app, "/My note");
	await until("the old address", async () => (await app.evaluate("location.hash")) === "#My%20note.md");
	assert.ok(existsSync(join(cwd, "My note.md")) && !existsSync(join(cwd, "ideas/moved.md")));
});

check("a list item continues on Enter and ends on a second, and a bracket closes as it opens", async ({ app, cwd }) => {
	await pickNote(app, "ideas/second.md");
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
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="code.md"]') && !!document.querySelector('#notes button[data-path="empty.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="empty.md"]').click()`);
	await until("the placeholder", () => app.evaluate("document.querySelector('#editor .cm-placeholder')?.textContent === 'Write here'"));
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-content')?.getAttribute('aria-label')"), "Note");
	await app.evaluate(`document.querySelector('#notes button[data-path="code.md"]').click()`);
	// The cursor lands on "text": the box holds the block's three lines — the code and both fences, which
	// stay dimmed rather than going, since the fence names the language and a line that comes back under
	// the cursor would move the page.
	await until("the code box, its three lines, two of them fences", () =>
		app.evaluate("document.querySelectorAll('#editor .cm-code .cm-line').length === 3 && document.querySelectorAll('#editor .cm-code .cm-code-fence').length === 2"),
	);
	assert.ok((await shownText(app)).includes("```js"), "the fence is drawn, cursor or not");
	// "text", the blank under it, and the empty last line after the closing fence.
	assert.equal(await app.evaluate("[...document.querySelectorAll('#editor .cm-line')].filter((l) => !l.classList.contains('cm-code-line')).length"), 3, "the prose lines are not");
	// Arriving on a line of the block changes nothing — the same lines, and the box the same height,
	// which is the whole point of leaving the fences in.
	const boxHeight = await app.evaluate("document.querySelector('#editor .cm-code').getBoundingClientRect().height");
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.line(4).from } }); })()`);
	await until("the cursor on the block", () =>
		app.evaluate("(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; return v.state.selection.main.head === v.state.doc.line(4).from; })()"),
	);
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-code .cm-line').length"), 3, "the same three lines");
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-code').getBoundingClientRect().height"), boxHeight, "and the same height, so nothing moved under it");
	await app.shot("code-box");
});

check("a task is a box, cursor or not, ticked by a click or ⌘Enter, and a rule is a line", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tasks.md"), "- [ ] one\n- [x] two\n\n---\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="tasks.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="tasks.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("- [ ] one"));
	// The cursor lands on the first line; its task is a box all the same, as the other is; the rule is a line.
	await until("two boxes and a rule", () => app.evaluate("document.querySelectorAll('#editor input.cm-task').length === 2 && document.querySelectorAll('#editor hr.cm-rule').length === 1"));
	assert.ok(!(await shownText(app)).includes("[ ] one"));
	assert.ok(!(await shownText(app)).includes("[x] two"));
	// Clicking the second box ticks it off in the text.
	assert.equal(await app.click("#editor input.cm-task", 1), true);
	await until("two unticked", async () => (await editorText(app)).includes("- [ ] two"));
	// ⌘Enter on the cursor's line ticks that one.
	await app.press("Enter", { meta: true });
	await until("one ticked", async () => (await editorText(app)).includes("- [x] one"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.equal(readFileSync(join(cwd, "tasks.md"), "utf8"), "- [x] one\n- [ ] two\n\n---\n\nend\n");
});

check("deleting a note closes it and offers it back, and Restore brings it back open", async ({ app, cwd }) => {
	await app.evaluate(`document.querySelector('#notes button[data-path="code.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved");
	await app.evaluate(`document.querySelector('button[aria-label="Delete note"]').click()`);
	await until("the column to empty", () => app.evaluate("!document.getElementById('editor') && document.body.textContent.includes('Deleted code')"));
	assert.equal(existsSync(join(cwd, "code.md")), false);
	assert.equal(existsSync(join(cwd, ".pi/trash/notes/code.md")), true);
	assert.equal(await app.evaluate(`!!document.querySelector('#notes button[data-path="code.md"]')`), false, "off the list");
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
	await pickNote(app, "ideas/second.md");
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
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="hub.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="hub.md"]').click()`);
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
	await app.evaluate(`[...document.querySelectorAll('#backlinks button')].find((b) => b.dataset.path === "hub.md").click()`);
	await until("hub again", async () => (await app.evaluate("location.hash")) === "#hub.md" && (await app.evaluate("document.querySelectorAll('#editor .cm-wikilink').length")) === 2);
	await app.click("#editor .cm-wikilink", 1, { meta: true });
	await until("the new note", async () => (await app.evaluate("location.hash")) === "#nowhere%20yet.md" && (await editorStatus(app)) === "saved");
	assert.equal(existsSync(join(cwd, "nowhere yet.md")), true);
	// And back in hub the link is no longer missing.
	await app.evaluate(`document.querySelector('#notes button[data-path="hub.md"]').click()`);
	await until("no missing link", async () => (await app.evaluate("document.querySelectorAll('#editor .cm-wikilink-missing').length")) === 0);
});

check("typing [[ offers the notes, and Enter takes one", async ({ app, cwd }) => {
	await app.evaluate(`document.querySelector('#notes button[data-path="hub.md"]').click()`);
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
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="quotes.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="quotes.md"]').click()`);
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

check("a bullet is a dot, cursor or not, and a task shows its box alone", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "bullets.md"), "- one\n- [ ] two\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="bullets.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="bullets.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("- [ ] two"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("a dot, and a box without a dash", async () => (await shownText(app)).includes("•one") && (await shownText(app)).includes("two") && !(await shownText(app)).includes("- "));
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-bullet').length"), 1);
	// Under the cursor the dot stays: the list's shape is not text to edit, and the caret steps over it.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 2 } }); })()`);
	await new Promise((r) => setTimeout(r, 100));
	assert.ok((await shownText(app)).includes("•one"), "the dot under the cursor");
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-bullet').length"), 1);
	await app.press("ArrowLeft");
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-content').cmTile.root.view.state.selection.main.head"), 0, "the caret steps over the dot to the line's start");
});

check("every list line's padding and text-indent cancel, so the selection band never moves with the first line on screen", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "hang.md"), "- one\n  - two\n    - three\n    still two\n- [ ] task\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="hang.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="hang.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("still two"));
	await until("the list lines", () => app.evaluate("document.querySelectorAll('#editor .cm-list-line').length === 5"));
	const lines = await app.evaluate(`[...document.querySelectorAll('#editor .cm-list-line')].map((el) => { const s = getComputedStyle(el); return [parseFloat(s.paddingLeft), parseFloat(s.textIndent)]; })`);
	assert.equal(lines.length, 5);
	for (const [pad, indent] of lines) {
		assert.ok(pad > 0, "each list line is padded");
		assert.ok(Math.abs(pad + indent) < 0.5, `padding ${pad} and text-indent ${indent} cancel`);
	}
	// The nested lines are padded more than the outer, and the continuation line as its item.
	assert.ok(lines[1][0] > lines[0][0] && lines[2][0] > lines[1][0] && lines[3][0] === lines[1][0]);
	// Everything selected, with the nested item scrolled to be the first line on screen or not: the band stays in the column.
	await app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); const v = box.cmTile.root.view; v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); })()`);
	await until("the band to be drawn", () => app.evaluate("document.querySelectorAll('#editor .cm-selectionBackground').length > 0"));
	const within = await app.evaluate(`(() => {
		const content = document.querySelector('#editor .cm-content').getBoundingClientRect();
		return [...document.querySelectorAll('#editor .cm-selectionBackground')].every((el) => { const r = el.getBoundingClientRect(); return r.left >= content.left - 1 && r.right <= content.right + 1; });
	})()`);
	assert.ok(within, "every piece of the band lies within the text column");
});

check("Tab nests a numbered item and the numbers follow; Shift-Tab brings it back", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "numbered.md"), "1. a\n2. b\n3. c\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="numbered.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="numbered.md"]').click()`);
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
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="small.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="small.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("~~gone~~"));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the marks hidden", async () => (await shownText(app)).includes("done gone code"));
	assert.equal(await app.evaluate("getComputedStyle(document.querySelector('#editor .cm-task-done')).textDecorationLine"), "line-through");
	assert.notEqual(await app.evaluate("[...document.querySelectorAll('#editor .cm-task-done span')].map((s) => getComputedStyle(s).backgroundColor).find((c) => c !== 'rgba(0, 0, 0, 0)')"), undefined, "inline code sits in a box");
	await app.shot("small-marks");
});

check("a %% line opens a comment that runs over blank lines to the next", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "block-comment.md"), "kept\n\n%%\nnot [[this]]\n\n# nor this\n%%\n\nkept too\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="block-comment.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="block-comment.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("kept too"));
	// Everything between the fences is one comment: no link drawn, no heading style. The fences are marks, drawn as marks are.
	await until("the comment", () => app.evaluate("[...document.querySelectorAll('#editor .cm-comment')].map((s) => s.textContent).join('')").then((t) => t.includes("not [[this]]") && t.includes("# nor this")));
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-wikilink').length"), 0);
});

check("under a note, the notes that share its tags", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "shared-a.md"), "#team notes\n");
	writeFileSync(join(cwd, "shared-b.md"), "more #Team and #other\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="shared-a.md"]') && !!document.querySelector('#notes button[data-path="shared-b.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="shared-a.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("#team"));
	await until("the tagged strip", () => app.evaluate("document.querySelector('#tagged')?.textContent ?? ''").then((t) => t.includes("shared-b") && t.includes("#team") && !t.includes("#other")));
	// The other note loses the tag: the strip goes.
	writeFileSync(join(cwd, "shared-b.md"), "no more\n");
	await until("the strip to go", () => app.evaluate("!document.querySelector('#tagged')"));
});

check("a tag and a link written in the properties count as much as ones written in the note", async ({ app, cwd }) => {
	// One note says its tag in the text, the other in its properties, and they share it.
	writeFileSync(join(cwd, "prop-tagged.md"), '---\ntags: [Crew]\nrelated: "[[prop-hub]]"\n---\n\nnothing in the text\n');
	writeFileSync(join(cwd, "prop-body.md"), "#crew in the text\n");
	writeFileSync(join(cwd, "prop-hub.md"), "the one linked to\n");
	await until("the notes to be listed", () => app.evaluate(`["prop-tagged.md", "prop-body.md", "prop-hub.md"].every((p) => document.querySelector('#notes button[data-path="' + p + '"]'))`));
	await app.evaluate(`document.querySelector('#notes button[data-path="prop-body.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("#crew"));
	await until("the note whose tag is only a property", () => app.evaluate("document.querySelector('#tagged')?.textContent ?? ''").then((t) => t.includes("prop-tagged") && t.includes("#crew")));
	// And the link written in a property is a backlink on the note it names.
	await app.evaluate(`document.querySelector('#notes button[data-path="prop-hub.md"]').click()`);
	await until("its backlinks", () => app.evaluate("document.querySelector('#backlinks')?.textContent ?? ''").then((t) => t.includes("prop-tagged")));
	// Renaming the note it names rewrites the property, not just the text: the backlink survives the move.
	await retitle(app, "prop-centre");
	await until("the note moved", () => existsSync(join(cwd, "prop-centre.md")));
	await until("the property rewritten", () => readFileSync(join(cwd, "prop-tagged.md"), "utf8").includes('"[[prop-centre]]"'));
	await until("its backlinks again", () => app.evaluate("document.querySelector('#backlinks')?.textContent ?? ''").then((t) => t.includes("prop-tagged")));
	// Taken out of the properties, both go.
	writeFileSync(join(cwd, "prop-tagged.md"), "---\nstatus: draft\n---\n\nnothing in the text\n");
	await until("the backlink to go", () => app.evaluate("!document.querySelector('#backlinks')"));
	await app.evaluate(`document.querySelector('#notes button[data-path="prop-body.md"]').click()`);
	await until("the tagged strip to go", () => app.evaluate("!document.querySelector('#tagged')"));
});

check("%%a comment%% is set apart, its marks hidden off the cursor", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "comment.md"), "say %%to self%% now\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="comment.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="comment.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("%%to self%%"));
	await until("the comment, as one span", () => app.evaluate("[...document.querySelectorAll('#editor .cm-comment')].map((s) => s.textContent).join('')").then((t) => t.includes("to self")));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the marks to be hidden", async () => (await shownText(app)).includes("say to self now"));
});

check("a quote opening with [!note] is a callout, named by its type", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "callout.md"), "> [!note] Keep\n> the body\n\nafter\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="callout.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="callout.md"]').click()`);
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
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="tags.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="tags.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("#one"));
	await until("one tag", () => app.evaluate("[...document.querySelectorAll('#editor .cm-tag')].map((s) => s.textContent).join('|')").then((t) => t === "#one"));
});

check("==words== are washed with colour, their marks hidden off the cursor", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "hl.md"), "say ==hi== now\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="hl.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="hl.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("==hi=="));
	await until("the highlight, as one span", () => app.evaluate("[...document.querySelectorAll('#editor .cm-highlight')].map((s) => s.textContent).join('|')").then((t) => t.includes("hi")));
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the marks to be hidden", async () => (await shownText(app)).includes("say hi now"));
	// Under the cursor, with the focus: without it the marks stay hidden.
	await app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); const v = box.cmTile.root.view; v.dispatch({ selection: { anchor: 6 } }); })()`);
	await until("the marks back under the cursor", async () => (await shownText(app)).includes("==hi=="));
});

check("a note's front matter is hidden, out of the cursor's reach, shown by ⌘E, and the note opens under it", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "props.md"), "---\ntags: [x]\n---\n\n# body\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="props.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="props.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("# body"));
	const head = () => app.evaluate("document.querySelector('#editor .cm-content')?.cmTile?.root?.view?.state.selection.main.head");
	assert.equal(await head(), 18, "the note opens under its properties, where its text begins");
	// Off its lines the block is not there at all — no rule, no words — and the text begins the note.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the heading's mark to be hidden", async () => !(await shownText(app)).includes("# body"));
	assert.equal(await app.evaluate("document.querySelectorAll('#editor hr.cm-rule').length"), 0);
	assert.ok(!(await shownText(app)).includes("tags"), "the block is hidden off its lines");
	// The cursor cannot be put on its lines; ⌘E shows it, as text.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 0 } }); })()`);
	assert.equal(await head(), 18, "the cursor is kept under the block");
	assert.ok(!(await shownText(app)).includes("tags"), "still hidden");
	await app.press("e", { meta: true });
	await until("the source", async () => (await shownText(app)).includes("---tags: [x]---") && (await shownText(app)).includes("# body"));
	await app.press("e", { meta: true });
	assert.equal(readFileSync(join(cwd, "props.md"), "utf8"), "---\ntags: [x]\n---\n\n# body\n", "the file is untouched");
});

check("a note opens again where it was left", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "left.md"), "one\ntwo\nthree\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="left.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="left.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("three"));
	const head = () => app.evaluate("document.querySelector('#editor .cm-content')?.cmTile?.root?.view?.state.selection.main.head");
	assert.equal(await head(), 0, "a note never left opens at the top");
	const end = (await editorText(app)).length;
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: ${end} } }); })()`);
	await pickNote(app, "ideas/second.md");
	await until("the other note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("second"));
	await app.evaluate(`document.querySelector('#notes button[data-path="left.md"]').click()`);
	await until("back at the end", async () => (await editorStatus(app)) === "saved" && (await head()) === end);
});

check("the title scrolls away with the note, and the note comes back scrolled where it was left", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tall.md"), Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n\n") + "\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="tall.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="tall.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("line 119"));
	const titleTop = () => app.evaluate("document.querySelector('#title').getBoundingClientRect().top");
	const pageTop = await app.evaluate("document.querySelector('#note').getBoundingClientRect().top");
	assert.ok((await titleTop()) >= pageTop, "the title starts in view");
	await app.evaluate("document.querySelector('#note').scrollTop = 600");
	await until("the title to have gone up with the page", async () => (await titleTop()) < pageTop);
	// Leave and come back: the page is where it was.
	await pickNote(app, "ideas/second.md");
	await until("the other note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("second"));
	await app.evaluate(`document.querySelector('#notes button[data-path="tall.md"]').click()`);
	await until("back where it was", async () => {
		if ((await editorStatus(app)) !== "saved") return false;
		const top = await app.evaluate("document.querySelector('#note').scrollTop");
		if (top !== 600) throw new Error(`the page is at ${top}`);
		return true;
	});
});

check("a note stood in twice comes back to each step where that step was read", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "twice.md"), Array.from({ length: 120 }, (_, i) => `twice ${i}`).join("\n\n") + "\n");
	writeFileSync(join(cwd, "between.md"), "between\n");
	await until("both listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="twice.md"]') && !!document.querySelector('#notes button[data-path="between.md"]')`));
	const page = () => app.evaluate("document.querySelector('#note').scrollTop");
	const openNote = async (path, seen) => {
		await app.evaluate(`document.querySelector('#notes button[data-path="${path}"]').click()`);
		await until(path, async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes(seen));
	};
	const scrollTo = async (top) => {
		await app.evaluate(`(document.querySelector('#note').scrollTop = ${top})`);
		await until(`the page at ${top}`, async () => (await page()) === top);
	};
	// The note there, and the page where that step was read. A page somewhere else throws rather
	// than answering no, so the timeout says where it actually was — which is the whole difference
	// between "the step lost its place" and "the place was put back late".
	const atPage = async (seen, top) => {
		if (!(await editorText(app)).includes(seen)) return false;
		const now = await page();
		if (now !== top) throw new Error(`the page is at ${now}`);
		return true;
	};
	// Read near the top, left for another note, and read far down on the way back.
	await openNote("twice.md", "twice 119");
	await scrollTo(200);
	await openNote("between.md", "between");
	await openNote("twice.md", "twice 119");
	await until("open where it was last read", async () => atPage("twice 119", 200));
	await scrollTo(900);
	await pickNote(app, "ideas/second.md");
	await until("the other note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("second"));
	await app.press("[", { meta: true });
	await until("the step read far down", async () => atPage("twice 119", 900));
	await app.press("[", { meta: true });
	await until("the note between them", async () => (await editorText(app)).includes("between"));
	// The same note, the other step: where that one was read, not where the other was.
	await app.press("[", { meta: true });
	await until("the step read near the top", async () => atPage("twice 119", 200));
});

check("open notes are tabs in the title bar; a click picks one, its × closes it to the neighbour, and a reload keeps the row", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tab-a.md"), "A\n");
	writeFileSync(join(cwd, "tab-b.md"), "B\n");
	await until("both listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="tab-a.md"]') && !!document.querySelector('#notes button[data-path="tab-b.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-a.md"]').click()`);
	await until("a", async () => (await editorText(app)) === "A\n");
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-b.md"]').click()`);
	await until("b", async () => (await editorText(app)) === "B\n");
	const row = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.path)");
	const front = () => app.evaluate("document.querySelector('[role=tab][data-state=active]')?.dataset.path");
	assert.deepEqual((await row()).slice(-2), ["tab-a.md", "tab-b.md"], "in the order they were opened, once each");
	assert.equal(await front(), "tab-b.md");
	// A second opening is not a second tab.
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-a.md"]').click()`);
	await until("a again", async () => (await editorText(app)) === "A\n");
	assert.equal((await row()).filter((t) => t === "tab-a.md").length, 1);
	assert.equal(await front(), "tab-a.md");
	// The row is long by now; a person would scroll it, and so does this.
	await app.evaluate(`document.querySelector('[role=tab][data-path="tab-b.md"]').scrollIntoView({ inline: "nearest" })`);
	await app.click('[role=tab][data-path="tab-b.md"]');
	await until("b in front by the tab", async () => (await app.evaluate("location.hash")) === "#tab-b.md" && (await editorText(app)) === "B\n");
	await app.shot("tabs");
	// Closing the one in front, with nothing to its right, goes to its left.
	await app.click('[role=tab][data-path="tab-b.md"] [role=button]');
	await until("a after the close", async () => (await app.evaluate("location.hash")) === "#tab-a.md" && (await editorText(app)) === "A\n");
	assert.equal((await row()).includes("tab-b.md"), false);
	const before = await row();
	await app.evaluate("location.reload()");
	await until("the row after a reload", async () => (await editorStatus(app)) === "saved" && (await row()).join() === before.join());
	assert.equal(await front(), "tab-a.md");
});

check("a middle click closes a tab without picking it, and Delete on a focused tab closes it and moves the focus along", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tab-c.md"), "C\n");
	writeFileSync(join(cwd, "tab-d.md"), "D\n");
	await until("both listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="tab-c.md"]') && !!document.querySelector('#notes button[data-path="tab-d.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-c.md"]').click()`);
	await until("c", async () => (await editorText(app)) === "C\n");
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-d.md"]').click()`);
	await until("d", async () => (await editorText(app)) === "D\n");
	const row = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.path)");
	const focused = () => app.evaluate("document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.dataset.path : null");
	// The wheel button on a tab that is not in front: it goes, the front one stays.
	await app.evaluate(`document.querySelector('[role=tab][data-path="tab-c.md"]').scrollIntoView({ inline: "nearest" })`);
	await app.click('[role=tab][data-path="tab-c.md"]', 0, { button: "middle" });
	await until("c gone", async () => !(await row()).includes("tab-c.md"));
	assert.equal(await app.evaluate("location.hash"), "#tab-d.md", "the front tab did not change");
	// Delete with the focus on the front tab: its left neighbour is in front, and has the focus.
	await app.click('[role=tab][data-path="tab-d.md"]');
	await until("the tab focused", async () => (await focused()) === "tab-d.md");
	await app.press("Delete");
	await until("d gone and the neighbour in front", async () => !(await row()).includes("tab-d.md") && (await app.evaluate("location.hash")) === "#tab-a.md");
	await until("the focus on the neighbour", async () => (await focused()) === "tab-a.md");
});

check("⌘⇧T puts a closed tab back where it was, and ⌘⇧] and ⌘⇧[ go along the row", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tab-e.md"), "E\n");
	writeFileSync(join(cwd, "tab-f.md"), "F\n");
	await until("both listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="tab-e.md"]') && !!document.querySelector('#notes button[data-path="tab-f.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-e.md"]').click()`);
	await until("e", async () => (await editorText(app)) === "E\n");
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-f.md"]').click()`);
	await until("f", async () => (await editorText(app)) === "F\n");
	const row = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.path)");
	const before = await row();
	// Close the one before last with its ×, then ask for it back: same place, in front.
	await app.evaluate(`document.querySelector('[role=tab][data-path="tab-e.md"]').scrollIntoView({ inline: "nearest" })`);
	await app.click('[role=tab][data-path="tab-e.md"] [role=button]');
	await until("e gone", async () => !(await row()).includes("tab-e.md"));
	assert.equal(await app.evaluate("location.hash"), "#tab-f.md", "closing a tab behind the front one did not pick it");
	await app.press("t", { meta: true, shift: true });
	// Its text on screen, not just its address: the app hears the address a beat after it is set.
	await until("e back in its place", async () => (await row()).join() === before.join() && (await editorText(app)) === "E\n");
	await app.press("]", { meta: true, shift: true });
	await until("f by ⌘⇧]", async () => (await editorText(app)) === "F\n");
	await app.press("]", { meta: true, shift: true });
	// The tab in front is the app's own state; the address runs ahead of it, and the old editor lingers a beat.
	await until("round to the first", () => app.evaluate(`document.querySelector('[role=tab][data-state=active]')?.dataset.path === ${JSON.stringify(before[0])}`));
	await app.press("[", { meta: true, shift: true });
	await until("and back to the last", async () => (await editorText(app)) === "F\n");
});

check("⌘[ goes back through the notes you have been in and ⌘] forward again, and opening one after going back throws away the way forward", async ({ app, cwd }) => {
	for (const [name, text] of [["back-a", "A\n"], ["back-b", "B\n"], ["back-c", "C\n"], ["back-d", "D\n"]]) writeFileSync(join(cwd, `${name}.md`), text);
	await until("all four listed", () => app.evaluate(`["back-a.md","back-b.md","back-c.md","back-d.md"].every((p) => !!document.querySelector('#notes button[data-path="' + p + '"]'))`));
	const open = async (path, text) => {
		await app.evaluate(`document.querySelector('#notes button[data-path="${path}"]').click()`);
		await until(path, async () => (await editorText(app)) === text);
	};
	await open("back-a.md", "A\n");
	await open("back-b.md", "B\n");
	await open("back-c.md", "C\n");
	await app.press("[", { meta: true });
	await until("back to b", async () => (await editorText(app)) === "B\n");
	// Where you are is the tab in front and the address, not only the text.
	await until("b's tab in front", () => app.evaluate(`document.querySelector('[role=tab][data-state=active]')?.dataset.path === "back-b.md"`));
	assert.equal(await app.evaluate("location.hash"), "#back-b.md");
	await app.press("[", { meta: true });
	await until("and back to a", async () => (await editorText(app)) === "A\n");
	await app.press("]", { meta: true });
	await until("forward to b again", async () => (await editorText(app)) === "B\n");
	// c was ahead; opening d from here throws it away, and forward has nowhere to go.
	await open("back-d.md", "D\n");
	assert.equal(await app.evaluate("document.querySelector('#forward').disabled"), true, "the forward arrow went out with the way forward");
	assert.equal(await app.evaluate("document.querySelector('#back').disabled"), false);
	await app.shot("back-forward");
	await app.press("]", { meta: true });
	await until("still d", async () => (await editorText(app)) === "D\n");
	assert.equal(await app.evaluate("location.hash"), "#back-d.md");
	// The arrows do what the keys do.
	await app.click("#back");
	await until("back past b", async () => (await editorText(app)) === "B\n");
	assert.equal(await app.evaluate("document.querySelector('#forward').disabled"), false, "d is ahead now");
	await app.press("[", { meta: true });
	await until("to a", async () => (await editorText(app)) === "A\n");
	assert.equal(await app.evaluate("location.hash"), "#back-a.md");
	await app.click("#forward");
	await until("and the forward arrow forward", async () => (await editorText(app)) === "B\n");
	// The way back outlives the window, as the row of tabs does.
	await app.evaluate("location.reload()");
	await until("b after a reload", async () => (await editorStatus(app)) === "saved" && (await editorText(app)) === "B\n");
	await app.press("[", { meta: true });
	await until("a step back still reaches a", async () => (await editorText(app)) === "A\n");
	await app.press("]", { meta: true });
	await until("and forward to b again", async () => (await editorText(app)) === "B\n");
});

check("a note in the trash keeps its step while it is in front, and is off the way back once it is not", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "gone-note.md"), "G\n");
	await until("it is listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="gone-note.md"]')`));
	const open = async (path, text) => {
		await app.evaluate(`document.querySelector('#notes button[data-path="${path}"]').click()`);
		await until(path, async () => (await editorText(app)) === text);
	};
	await open("back-a.md", "A\n");
	await open("gone-note.md", "G\n");
	await app.evaluate(`document.querySelector('button[aria-label="Delete note"]').click()`);
	await until("the offer to bring it back", () => app.evaluate("document.body.textContent.includes('Deleted gone-note')"));
	// It is still the step we stand on: there is nowhere else to offer it from.
	assert.equal(await app.evaluate("location.hash"), "#gone-note.md");
	await open("back-c.md", "C\n");
	await app.press("[", { meta: true });
	await until("straight past the trashed one to a", async () => (await editorText(app)) === "A\n");
	assert.equal(await app.evaluate("location.hash"), "#back-a.md");
});

check("a tab dragged onto another takes its place, and a press without a move is still a pick", async ({ app }) => {
	const row = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.path)");
	const before = await row();
	const [a, b] = before.slice(-2);
	await app.evaluate(`document.querySelector('[role=tab][data-path=${JSON.stringify(b)}]').scrollIntoView({ inline: "nearest" })`);
	await app.dragTo(`[role=tab][data-path=${JSON.stringify(b)}]`, `[role=tab][data-path=${JSON.stringify(a)}]`);
	await until("the last two swapped", async () => (await row()).slice(-2).join() === [b, a].join());
	assert.deepEqual((await row()).slice(0, -2), before.slice(0, -2), "the rest did not move");
	await app.evaluate("location.reload()");
	await until("the order after a reload", async () => (await editorStatus(app)) === "saved" && (await row()).slice(-2).join() === [b, a].join());
	// A plain click on a tab is still a pick, with the sortable listening on the same div.
	await app.evaluate(`document.querySelector('[role=tab][data-path=${JSON.stringify(b)}]').scrollIntoView({ inline: "nearest" })`);
	await app.click(`[role=tab][data-path=${JSON.stringify(b)}]`);
	await until("b picked", async () => (await app.evaluate("location.hash")) === "#" + encodeURIComponent(b).replace(/%2F/g, "/"));
});

check("a right click on a tab is a menu; Close to the Right closes those, and ⌘⇧T brings them back one at a time", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "tab-g.md"), "G\n");
	writeFileSync(join(cwd, "tab-h.md"), "H\n");
	await until("both listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="tab-g.md"]') && !!document.querySelector('#notes button[data-path="tab-h.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-g.md"]').click()`);
	await until("g", async () => (await editorText(app)) === "G\n");
	await app.evaluate(`document.querySelector('#notes button[data-path="tab-h.md"]').click()`);
	await until("h", async () => (await editorText(app)) === "H\n");
	const row = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.path)");
	const before = await row();
	const third = before[before.length - 3];
	await app.evaluate(`document.querySelector('[role=tab][data-path=${JSON.stringify(third)}]').scrollIntoView({ inline: "nearest" })`);
	await app.click(`[role=tab][data-path=${JSON.stringify(third)}]`, 0, { button: "right" });
	await until("the menu", () => app.evaluate("!!document.querySelector('[role=menu]')"));
	assert.equal(await app.evaluate("location.hash"), "#tab-h.md", "a right click does not pick the tab");
	const items = await app.evaluate("[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((i) => i.textContent.replace('⌘W', '').trim())");
	assert.deepEqual(items, ["Close", "Close Others", "Close to the Right", "Close All", "Copy Path"]);
	await app.evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((i) => i.textContent.includes('Close to the Right')).click()`);
	await until("g and h gone, the third in front", async () => (await row()).join() === before.slice(0, -2).join() && (await app.evaluate("location.hash")) === "#" + encodeURIComponent(third).replace(/%2F/g, "/"));
	assert.equal(await app.evaluate("!!document.querySelector('[role=menu]')"), false, "the menu went with the choice");
	// Back, last closed first, each where it was.
	await until("the third's text", async () => (await editorStatus(app)) === "saved");
	await app.press("t", { meta: true, shift: true });
	await until("h back", async () => (await row()).join() === [...before.slice(0, -2), "tab-h.md"].join() && (await editorText(app)) === "H\n");
	await app.press("t", { meta: true, shift: true });
	await until("g back in its place", async () => (await row()).join() === before.join() && (await editorText(app)) === "G\n");
});

/**
 * The panel opened to its rows. A note shows its properties as one folded
 * line until it is asked; the line is clicked whenever it is there, since it
 * arrives with the note rather than with the click before it.
 */
const showProperties = async (page) => {
	await until("the property rows", async () => {
		if (await page.evaluate("!!document.querySelector('#properties-summary')")) await page.click("#properties-summary");
		return page.evaluate("!!document.querySelector('#properties [data-property], #add-property')");
	});
};

check("the properties are rows above the note: a chip added, a property added and filled, ⌘Z, a Backspace that cannot reach them, and a broken block said so", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "rows.md"), "---\ntags: [x]\n---\n\n# body\n");
	writeFileSync(join(cwd, "broken.md"), "---\ntags: [x\n---\nbody\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="rows.md"]') && !!document.querySelector('#notes button[data-path="broken.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="rows.md"]').click()`);
	await until("the folded line", () => app.evaluate(`document.querySelector('#properties-summary [data-said="tags"]')?.textContent.includes("x")`));
	await showProperties(app);
	await until("the row", () => app.evaluate(`!!document.querySelector('#properties [data-property="tags"] [data-chip="x"]')`));
	const file = () => readFileSync(join(cwd, "rows.md"), "utf8");
	// A chip added keeps the list's shape, and only that line changes.
	await app.click('#properties [aria-label="Add to tags"]');
	await app.keys("y");
	await app.press("Enter");
	await until("the chip", () => app.evaluate(`!!document.querySelector('#properties [data-chip="y"]')`));
	await until("the file", () => file() === "---\ntags: [x, y]\n---\n\n# body\n");
	// A property added is a line with no value, then the value typed in.
	await app.click("#add-property");
	await app.keys("status");
	await app.press("Enter");
	await until("the new row", () => app.evaluate(`!!document.querySelector('#properties [data-property="status"] input:not([data-name])')`));
	await until("its line", () => file() === "---\ntags: [x, y]\nstatus:\n---\n\n# body\n");
	await app.click('#properties [data-property="status"] input:not([data-name])');
	await app.keys("draft");
	await app.press("Enter");
	await until("the value", () => file() === "---\ntags: [x, y]\nstatus: draft\n---\n\n# body\n");
	// ⌘Z in the note takes the last of those back, as it would typing.
	await app.evaluate("document.querySelector('#editor .cm-content').focus()");
	await app.press("z", { meta: true });
	await until("the value undone", () => file() === "---\ntags: [x, y]\nstatus:\n---\n\n# body\n");
	// The cursor cannot go into the block, and a Backspace at the top of the text does not reach it.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 0 } }); })()`);
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-content').cmTile.root.view.state.selection.main.head"), "---\ntags: [x, y]\nstatus:\n---\n".length);
	await app.press("Backspace");
	await app.keys("z");
	await until("the letter, and the block whole", () => file() === "---\ntags: [x, y]\nstatus:\n---\nz\n# body\n");
	// A block that does not parse is said so, and offers the source.
	await app.evaluate(`document.querySelector('#notes button[data-path="broken.md"]').click()`);
	await until("the warning", () => app.evaluate(`document.querySelector('#properties [role=alert]')?.textContent.includes('could not be read')`));
	assert.equal(await app.evaluate("!!document.querySelector('#add-property')"), false);
	assert.equal(readFileSync(join(cwd, "broken.md"), "utf8"), "---\ntags: [x\n---\nbody\n", "left exactly as it was");
});

check("the row's end lists every open tab with the front one marked, picks one, and makes a new note", async ({ app, cwd }) => {
	const row = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.path)");
	const tabs = await row();
	await app.click('[aria-label="Open tabs"]');
	await until("the list", () => app.evaluate("!!document.querySelector('[role=menu]')"));
	const listed = await app.evaluate("[...document.querySelectorAll('[role=menu] [role=menuitemradio]')].map((i) => i.title)");
	assert.deepEqual(listed, tabs, "every open tab, in the row's order");
	assert.equal(await app.evaluate("document.querySelector('[role=menu] [role=menuitemradio][data-state=checked]')?.title"), await app.evaluate("document.querySelector('[role=tab][data-state=active]')?.dataset.path"), "the front one is marked");
	// A note in a folder says its folder beside the name.
	assert.ok(await app.evaluate(`document.querySelector('[role=menu] [role=menuitemradio][title="ideas/second.md"]')?.textContent.includes("ideas")`));
	await app.evaluate(`document.querySelector('[role=menu] [role=menuitemradio][title=${JSON.stringify(tabs[0])}]').click()`);
	await until("the first picked", () => app.evaluate(`document.querySelector('[role=tab][data-state=active]')?.dataset.path === ${JSON.stringify(tabs[0])}`));
	assert.equal(await app.evaluate("!!document.querySelector('[role=menu]')"), false, "the list went with the choice");
	// + is ⌘N for the mouse.
	await app.click('[aria-label="New note"]');
	await until("a new note in front", async () => (await editorStatus(app)) === "saved" && /Untitled/.test(await app.evaluate("location.hash")));
	assert.equal((await row()).length, tabs.length + 1, "one more tab");
	assert.ok(existsSync(join(cwd, decodeURIComponent((await app.evaluate("location.hash")).slice(1)))), "and its file");
});

check("a property box offers what the vault already says: the name, then the values that name holds, and Shift-Enter keeps what was typed", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "said-a.md"), "---\nstatus: draft\ntags: [reading]\n---\nbody\n");
	writeFileSync(join(cwd, "said-b.md"), "---\nstatus: shipped\n---\nbody\n");
	writeFileSync(join(cwd, "offered.md"), "---\ntags: []\n---\nbody\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="offered.md"]') && !!document.querySelector('#notes button[data-path="said-b.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="offered.md"]').click()`);
	await showProperties(app);
	await until("the rows", () => app.evaluate(`!!document.querySelector('#properties [data-property="tags"]')`));
	const file = () => readFileSync(join(cwd, "offered.md"), "utf8");
	const offering = () => app.evaluate(`[...document.querySelectorAll('[data-suggestion]')].map((i) => i.dataset.suggestion)`);
	// A name the vault already uses, narrowed by what is typed, and Enter takes it.
	await app.click("#add-property");
	await app.keys("st");
	await until("status offered", async () => (await offering()).join() === "status");
	await app.press("Enter");
	await until("the line", () => file() === "---\ntags: []\nstatus:\n---\nbody\n");
	// The value box offers what that name holds elsewhere, most used first, and nothing that does not answer.
	await app.click('#properties [data-property="status"] input:not([data-name])');
	assert.deepEqual(await offering(), [], "a box arrived at says nothing until it is asked");
	// ⌥↓ asks; a bare ↓ is the page's, and would carry the cursor to the next row.
	await app.press("ArrowDown", { alt: true });
	await until("both values", async () => (await offering()).join() === "draft,shipped");
	await app.keys("sh");
	await until("only the one", async () => (await offering()).join() === "shipped");
	await app.press("Enter");
	await until("the value taken", () => file() === "---\ntags: []\nstatus: shipped\n---\nbody\n");
	// Shift-Enter keeps what was typed, offer or no offer, as Obsidian has it.
	await app.click('#properties [aria-label="Add to tags"]');
	await app.keys("read");
	await until("the tag offered", async () => (await offering()).join() === "reading");
	await app.press("Enter", { shift: true });
	await until("what was typed", () => file() === "---\ntags: [read]\nstatus: shipped\n---\nbody\n");
});

check("↑ and ↓ carry the cursor from the title down through the properties into the text, and back up again", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "steps.md"), "---\nowner: me\ndone: true\n---\n# body\nsecond line\n");
	writeFileSync(join(cwd, "bare.md"), "# nothing above\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="steps.md"]') && !!document.querySelector('#notes button[data-path="bare.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="steps.md"]').click()`);
	await until("the folded line", () => app.evaluate(`!!document.querySelector('#properties-summary')`));
	/** What has the cursor, named the way the page names it. */
	const where = () =>
		app.evaluate(`(() => {
			const a = document.activeElement;
			if (!a) return "nothing";
			if (a.classList.contains("cm-content")) return "text";
			// The row first: a box in one carries an id of the list's making.
			return a.closest("#properties [data-property]")?.dataset.property ?? (a.id ? "#" + a.id : a.tagName);
		})()`);
	const line = () => app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; return v.state.doc.lineAt(v.state.selection.main.head).text; })()`);

	// Folded, the panel is one line and one stop: ↓ reaches it and Enter opens it onto the first row.
	await app.evaluate(`document.getElementById("title").focus()`);
	await app.press("ArrowDown");
	await until("the folded line has the cursor", async () => (await where()) === "#properties-summary");
	await app.press("ArrowRight");
	await until("the first row has it", async () => (await where()) === "owner");
	// Down: each row, the button that ends them, then the text — at its first line, not where it was left.
	for (const stop of ["done", "#add-property", "text"]) {
		await app.press("ArrowDown");
		await until(`the cursor at ${stop}`, async () => (await where()) === stop);
	}
	assert.equal(await line(), "# body", "the text takes the cursor at its first line");
	// In the text ↑ is the text's own key until there is nothing above.
	await app.press("ArrowDown");
	assert.equal(await line(), "second line");
	await app.press("ArrowUp");
	assert.equal(await where(), "text", "it did not leave from the middle");
	assert.equal(await line(), "# body");
	// Up: the last property, not the button under it — there is nothing to add yet.
	for (const stop of ["done", "owner", "#title"]) {
		await app.press("ArrowUp");
		await until(`the cursor back at ${stop}`, async () => (await where()) === stop);
	}
	// Mid-syllable nothing moves: the arrow belongs to whoever is composing.
	await app.compose("ㅎ");
	await app.press("ArrowDown");
	assert.equal(await where(), "#title", "still in the title");
	// Finish the syllable and put the name back: a composition left open holds
	// the keyboard, and whatever runs next would type into nothing.
	await app.ime("ㅎㅏ", "하");
	await app.press("Escape");
	await until("the name as it was", () => app.evaluate(`document.getElementById("title").value === "steps"`));
	// A note with no properties: the title and the text are neighbours.
	await app.evaluate(`document.querySelector('#notes button[data-path="bare.md"]').click()`);
	await until("the other note", async () => (await editorText(app)) === "# nothing above\n");
	await app.evaluate(`document.getElementById("title").focus()`);
	await app.press("ArrowDown");
	await until("straight into the text", async () => (await where()) === "text");
});

check("a property is given another name from its row, keeping what it holds and where it sits", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "renamed.md"), "---\n# why\ntitle: 'kept'   # here\nstatus: draft\nother: 1\n---\nbody\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="renamed.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="renamed.md"]').click()`);
	await showProperties(app);
	await until("the rows", () => app.evaluate(`!!document.querySelector('#properties [data-property="status"]')`));
	const file = () => readFileSync(join(cwd, "renamed.md"), "utf8");
	// The name is a box: what is typed into it renames the property in place.
	await app.click('#properties [data-property="status"] [data-name]');
	await app.evaluate(`(() => { const b = document.activeElement; b.select(); document.execCommand("insertText", false, "state"); })()`);
	await app.press("Enter");
	await until("the note", () => file() === "---\n# why\ntitle: 'kept'   # here\nstate: draft\nother: 1\n---\nbody\n");
	// ← and → cross a row, but only from the edge of the box: in the middle of a value the arrow is the caret's.
	await app.click('#properties [data-property="state"] input:not([data-name])');
	await app.evaluate(`document.activeElement.setSelectionRange(2, 2)`);
	await app.press("ArrowLeft");
	assert.equal(await app.evaluate(`document.activeElement?.dataset.name`), undefined, "the caret moved and the cursor stayed");
	await app.evaluate(`document.activeElement.setSelectionRange(0, 0)`);
	await app.press("ArrowLeft");
	await until("the name has the cursor", () => app.evaluate(`document.activeElement?.dataset.name === ""`));
	await app.press("ArrowRight");
	await until("the value again", () => app.evaluate(`document.activeElement?.dataset.name === undefined && !!document.activeElement?.closest('[data-property="state"]')`));
	await app.press("ArrowDown");
	await until("the next property", () => app.evaluate(`!!document.activeElement?.closest('[data-property="other"]')`));
	// A name the note already has is refused, and the box puts back what was there.
	await app.click('#properties [data-property="state"] [data-name]');
	await app.evaluate(`(() => { const b = document.activeElement; b.select(); document.execCommand("insertText", false, "other"); })()`);
	await app.press("Enter");
	await until("nothing moved", () => file() === "---\n# why\ntitle: 'kept'   # here\nstate: draft\nother: 1\n---\nbody\n");
	assert.ok(await app.evaluate(`!!document.querySelector('#properties [data-property="state"]')`), "the property is still called what it was");
});

check("a row is drawn by its type — a box, a date, a number — the type is chosen for the name from the row's icon, and a value that does not fit is said so", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "typed.md"), "---\ndone: true\nwhen: 2024-01-01\ncount: 3\nodd: nope\n---\nbody\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="typed.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="typed.md"]').click()`);
	await showProperties(app);
	await until("the rows", () => app.evaluate(`!!document.querySelector('#properties [data-property="odd"]')`));
	const file = () => readFileSync(join(cwd, "typed.md"), "utf8");
	// Guessed from the values.
	assert.deepEqual(await app.evaluate(`[...document.querySelectorAll('#properties [data-property]')].map((r) => r.dataset.type)`), ["checkbox", "date", "number", "text"]);
	assert.equal(await app.evaluate(`document.querySelector('#properties [data-property="when"] input:not([data-name])').type`), "date");
	assert.equal(await app.evaluate(`document.querySelector('#properties [data-property="count"] input:not([data-name])').type`), "number");
	// The box is the value: unticked, the file says false.
	await app.click('#properties [data-property="done"] [role=checkbox]');
	await until("the file", () => file() === "---\ndone: false\nwhen: 2024-01-01\ncount: 3\nodd: nope\n---\nbody\n");
	// A type chosen for the name is kept beside the notes, and the row is drawn by it.
	await app.click('#properties [data-property="odd"] [aria-label="Type of odd"]');
	await until("the menu", () => app.evaluate(`document.querySelectorAll('[role=menuitemradio]').length > 0`));
	await app.evaluate(`[...document.querySelectorAll('[role=menuitemradio]')].find((i) => i.textContent.trim() === "Date").click()`);
	await until("the choice kept", () => existsSync(join(cwd, ".pi/properties.json")) && JSON.parse(readFileSync(join(cwd, ".pi/properties.json"), "utf8")).types.odd === "date");
	await until("the row a date, and the value not one", () => app.evaluate(`document.querySelector('#properties [data-property="odd"]')?.dataset.type === "date" && !!document.querySelector('#properties [data-property="odd"] [aria-label="Not a date"]')`));
	assert.equal(file(), "---\ndone: false\nwhen: 2024-01-01\ncount: 3\nodd: nope\n---\nbody\n", "the value is not corrected");
});

check("a list item's wrapped lines start where its words do", async ({ app, cwd }) => {
	const long = "word ".repeat(40).trim();
	// The continuation is indented to the inner item's words: short of that it would be drawn at the outer item's depth, as typed.
	writeFileSync(join(cwd, "list.md"), `- ${long}\n    - inner ${long}\n      continued\n- [ ] task ${long}\n\n> - quoted\n`);
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="list.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="list.md"]').click()`);
	await until("the list lines", () => app.evaluate("document.querySelectorAll('#editor .cm-list-line').length === 5"));
	// The cursor lands on the first line; the indented lines hold their spaces in a box, cursor or not.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
	await until("the indentation boxed", () => app.evaluate("[...document.querySelectorAll('#editor .cm-list-indent')].map((el) => el.textContent.length).join() === '4,6'"));
	// The second row of the outer item sits under its words, not under the bullet; the inner item's, one unit further.
	const rows = await app.evaluate(`(() => {
		const px = (el) => parseFloat(getComputedStyle(el).paddingLeft);
		const lines = [...document.querySelectorAll('#editor .cm-list-line')];
		const [outer, inner, continued, task, quoted] = lines;
		// Off the cursor, the marker is the dot, one unit wide, at the line's edge; a task's is its box and gap.
		const dot = outer.querySelector('.cm-bullet').getBoundingClientRect();
		const innerDot = inner.querySelector('.cm-bullet').getBoundingClientRect();
		// The glyph, not its box: an inherited text-indent once drew the dot a unit out of a box that measured fine.
		const glyphOf = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
		const glyph = glyphOf(outer.querySelector('.cm-bullet'));
		const box = task.querySelector('.cm-task-box');
		const taskPrefix = { width: box.getBoundingClientRect().width + parseFloat(getComputedStyle(box).marginRight) };
		const quotedDot = quoted.querySelector('.cm-bullet').getBoundingClientRect();
		return { outer: px(outer), inner: px(inner), continued: px(continued), quoted: quoted.getBoundingClientRect().left - outer.getBoundingClientRect().left, quotedDotLeft: quotedDot.left - quoted.getBoundingClientRect().left, quotedPad: px(quoted), prefixWidth: dot.width, innerPrefixWidth: innerDot.width, taskPrefixWidth: taskPrefix.width, prefixLeft: dot.left - outer.getBoundingClientRect().left, glyphIn: glyph.left - dot.left, tall: outer.getBoundingClientRect().height > 2 * innerDot.height };
	})()`);
	assert.ok(Math.abs(rows.innerPrefixWidth - rows.outer) < 1, `the nested marker is one unit too, its indentation hidden: ${JSON.stringify(rows)}`);
	assert.ok(Math.abs(rows.taskPrefixWidth - rows.outer) < 1.5, `the task's box and gap are one unit: ${JSON.stringify(rows)}`);
	assert.ok(Math.abs(rows.continued - rows.inner) < 1, `a continuation of the inner item has the inner padding alone: ${JSON.stringify(rows)}`);
	assert.ok(rows.tall, "the item wraps");
	assert.ok(rows.outer > 0 && Math.abs(rows.inner - 2 * rows.outer) < 1, `inner is one unit further: ${JSON.stringify(rows)}`);
	assert.ok(Math.abs(rows.prefixWidth - rows.outer) < 1, `the marker's box is one unit wide: ${JSON.stringify(rows)}`);
	assert.ok(Math.abs(rows.prefixLeft) < 1, `the marker starts at the line's edge: ${JSON.stringify(rows)}`);
	assert.ok(rows.glyphIn >= 0 && rows.glyphIn < rows.prefixWidth, `the dot is drawn inside its box: ${JSON.stringify(rows)}`);
	assert.ok(rows.quoted > 0, `a quoted item sits inside the quote's room, past the bar: ${JSON.stringify(rows)}`);
	assert.ok(Math.abs(rows.quotedDotLeft) < 1, `and its dot at its line's edge, not out over the bar: ${JSON.stringify(rows)}`);
	await app.shot("list-indent");
});

check("a mark typed over chosen words wraps them; typed alone it is a letter", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "wrap.md"), "say hi now\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="wrap.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="wrap.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.evaluate(`document.querySelector('#editor .cm-content').cmTile.root.view.dispatch({ selection: { anchor: 4, head: 6 } })`);
	await app.keys("*");
	await until("wrapped once", async () => (await editorText(app)) === "say *hi* now\n");
	await app.keys("*");
	await until("wrapped twice", async () => (await editorText(app)) === "say **hi** now\n");
	await app.keys("=");
	await until("highlighted", async () => (await editorText(app)) === "say **==hi==** now\n");
	// A bare cursor: the character is just typed.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length - 1 } }); })()`);
	await app.keys("*");
	await until("typed alone", async () => (await editorText(app)) === "say **==hi==** now*\n");
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
});

check("⌘B and ⌘I put a mark around the chosen words and take it off again", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "marks.md"), "say hi now\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="marks.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="marks.md"]').click()`);
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
	await pickNote(app, "ideas/second.md");
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
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="far.md"]')`));
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
		const view = document.querySelector('#note').getBoundingClientRect();
		return { text: line.textContent, seen: box.top >= view.top && box.bottom <= view.bottom };
	})()`);

check("⌘+click on a link to a heading or a block opens its note at that line", async ({ app, cwd }) => {
	// Far enough down that landing there has to scroll.
	const filler = Array.from({ length: 80 }, (_, i) => `filler ${i}`).join("\n\n");
	writeFileSync(join(cwd, "long.md"), `# long\n\n${filler}\n\nthe block ^far-block\n\n${filler}\n\n## Far down\n\nend\n`);
	writeFileSync(join(cwd, "jump.md"), "[[long#Far down]] and [[long#^far-block]]\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="jump.md"]') && !!document.querySelector('#notes button[data-path="long.md"]')`));
	for (const [n, line] of [[0, "## Far down"], [1, "the block ^far-block"]]) {
		await app.evaluate(`document.querySelector('#notes button[data-path="jump.md"]').click()`);
		await until("the links", async () => (await app.evaluate("location.hash")) === "#jump.md" && (await app.evaluate("document.querySelectorAll('#editor .cm-wikilink').length")) === 2);
		await app.click("#editor .cm-wikilink", n, { meta: true });
		await until(`the cursor on "${line}"`, async () => (await app.evaluate("location.hash")) === "#long.md" && (await caretLine(app))?.text === line);
		// The editor scrolls a frame after it moves the cursor, so the line is
		// waited for rather than asked about the moment the cursor arrives.
		await until(`"${line}" in view`, async () => (await caretLine(app))?.seen === true, 5_000);
	}
});

check("⌘+click on a markdown link opens the note at its path, and a web address in a new window", async ({ app, cwd, api, devtools }) => {
	const site = `http://127.0.0.1:${api}/?from=markdown-link`;
	writeFileSync(join(cwd, "ideas", "plain.md"), `[up to jump](../jump.md)\n\n[the site](${site})\n`);
	await pickNote(app, "ideas/plain.md");
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

check("the conversation is named from the pencil in its header, and emptying the name gives the first message back", async ({ app }) => {
	const shown = () => app.evaluate("document.getElementById('sessionTitle').textContent");
	// Unnamed, the header reads by its first message — shown, but not as the
	// value: the field opens on no name at all, so leaving it alone cannot
	// turn what stands in for a name into one.
	const first = await shown();
	assert.ok(first && first !== "New session", "the first message stands in for a name");
	await app.click('#settings [aria-label="Rename"]');
	await until("the field", () => app.evaluate("document.activeElement?.id === 'sessionTitle'"));
	assert.equal(await app.evaluate("document.getElementById('sessionTitle').value"), "", "opened on no name");
	await app.press("Escape");
	await until("the text back", async () => (await shown()) === first);

	// pi takes the spaces off, so what comes back is not what was typed.
	await rename(app, "  Reading list  ");
	await until("the name pi kept", async () => (await shown()) === "Reading list");
	// And the session list says the same thing the header does.
	await app.click("#sessionTitle");
	await until("the named session", () =>
		app.evaluate("[...document.querySelectorAll('[cmdk-item]')].some((i) => i.textContent.includes('Reading list'))"),
	);
	await app.press("Escape");

	// Emptied, the name is taken off rather than set to nothing.
	await rename(app, "");
	await until("the name to come off", async () => (await shown()) === first);
});

check("the bench renders every scenario it knows", async ({ bench }) => {
	// The list is drawn only while the picker is open, and each entry carries
	// its id: what is read is the scenario's name, and the name is not the id.
	await until("the gallery", () => bench.evaluate("!!document.getElementById('scenario')"));
	await bench.click("#scenario");
	const scenarios = await until("the scenarios", () =>
		bench.evaluate("[...document.querySelectorAll('[role=option]')].map((o) => o.dataset.scenario).join(',')"),
	);
	for (const id of ["tool-headers", "branches", "thinking", "recorded:turn-with-tools"]) {
		assert.ok(scenarios.includes(id), `the bench is missing ${id}`);
	}
	// Away again, so the check after this one does not read a page with a menu over it.
	await bench.press("Escape");
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
