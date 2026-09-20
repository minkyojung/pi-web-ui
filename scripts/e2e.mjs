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
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { approve } from "../specApproval.ts";

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

	// A browser that stops answering is said so, by name, after a minute. The
	// suite once sat on GitHub's runner for six hours at a time — a different
	// check each run — because a call that is never answered is a promise that
	// is never settled, and nothing here was counting.
	const call = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const n = ++id;
			const late = setTimeout(() => {
				pending.delete(n);
				const asked = method === "Runtime.evaluate" ? `: ${String(params.expression).replace(/\s+/g, " ").slice(0, 160)}` : "";
				reject(new Error(`the browser did not answer ${method} within a minute${asked}`));
			}, 60_000);
			pending.set(n, (message) => {
				clearTimeout(late);
				resolve(message);
			});
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
		const where = () =>
			evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
		// Measured, then sent three round trips later, so a box that is still
		// moving is a box the pointer misses — and it misses silently, since
		// something else is under it and takes the press instead. Two readings
		// that agree mean the layout has settled. On an idle machine the first
		// two agree; on a loaded one this is the difference between a check
		// that tests the app and a check that tests the weather.
		let box = await where();
		for (let i = 0; i < 20 && box; i++) {
			const again = await where();
			if (again && again[0] === box[0] && again[1] === box[1]) break;
			box = again;
		}
		if (!box) return false;
		const [x, y] = box;
		const modifiers = meta ? 4 : 0;
		await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
		await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1, modifiers });
		await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1, modifiers });
		return true;
	};
	/**
	 * A click at a place rather than on a thing — for asking what is at a
	 * point, when the answer being tested is which element is there at all.
	 */
	const clickAt = async (x, y) => {
		await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
		await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
		await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
	};
	/** The pointer over a place and nothing pressed: for what opens on being pointed at. */
	const moveTo = (x, y) => call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
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
	const CODES = { 1: 49, Enter: 13, Backspace: 8, Delete: 46, Escape: 27, End: 35, Tab: 9, "[": 219, "]": 221, b: 66, d: 68, e: 69, f: 70, i: 73, k: 75, n: 78, p: 80, t: 84, z: 90 };
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
	/**
	 * A script run in every document this page loads from now on, before the
	 * page's own — what a preload would have given it. Returns the way to stop.
	 * For standing in for the shell: a browser has no window.pi.
	 */
	const onNewDocument = async (source) => {
		// The Page domain has to be on for the script to be run.
		await call("Page.enable");
		const { identifier } = await call("Page.addScriptToEvaluateOnNewDocument", { source });
		return () => call("Page.removeScriptToEvaluateOnNewDocument", { identifier });
	};
	return { evaluate, shot, errors, click, clickAt, moveTo, drag, dragTo, press, keys, ime, compose, onNewDocument, close: () => socket.close() };
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
 * While working on one thing: `node scripts/e2e.mjs "at the foot"` runs the
 * checks whose names hold that, and the rest are not run at all.
 *
 * This is for the loop from red to green, not for a verdict. The checks share
 * one browser and one folder in the order they are written, so a check run on
 * its own starts from somewhere the full run never puts it. What was left
 * behind — source mode, a panel's width, where the page was scrolled — is part
 * of what a check is run against. Nothing is called done until `npm run e2e`
 * says so with nothing skipped.
 */
const only = process.argv[2] ?? "";
const chosen = () => {
	if (!only) return checks;
	const some = checks.filter(({ name }) => name.includes(only));
	if (some.length === 0) throw new Error(`no check's name holds ${JSON.stringify(only)}`);
	return some;
};

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
/** The choice of the open question that reads `choice`, as an expression for the page. */
const choiceOf = (choice) =>
	`[...document.querySelectorAll('#question [data-slot=questionnaire-choice]')].find((c) => c.querySelector('[data-slot=questionnaire-choice-label]').textContent.trim() === ${JSON.stringify(choice)})`;
/** Answer the question that is where the message box was: take the choice, send, and see it go. */
const answer = async (page, choice) => {
	await until("the question", () => page.evaluate(`!!${choiceOf(choice)}`));
	await page.evaluate(`${choiceOf(choice)}.querySelector('input').click()`);
	await page.evaluate("document.querySelector('#question [data-slot=questionnaire-submit]').click()");
	await until("the question answered", () => page.evaluate("!document.getElementById('question')"));
};
/**
 * Step to another answer with an arrow, and answer the question that comes
 * first: before the arrows leave a branch, the server asks — as pi's /tree
 * does — whether to summarise it, and "No summary" is the move without one.
 */
const step = async (page, title) => {
	if (!(await press(page, title))) return false;
	await answer(page, "No summary");
	return true;
};
const allDisabled = (page, title) =>
	page.evaluate(
		`[...document.querySelectorAll('#chat button[aria-label=${JSON.stringify(title)}]')].every((b) => b.disabled)`,
	);

check("the app renders a conversation", async ({ app }) => {
	await until("the conversation", () => app.evaluate("!!document.getElementById('chat')"));
});

// Before anything has been opened, which is where the window starts and where
// a new workspace leaves you: the middle column is the commands, not a note.
check("with nothing open, the middle column says what there is to do", async ({ app }) => {
	const commands = await until("the watermark", () =>
		app.evaluate("document.getElementById('watermark') && [...document.querySelectorAll('#watermark kbd')].map((k) => k.textContent).join(',')"));
	assert.equal(commands, "/spec,/spec-approve,/spec-run");
	// And nothing about a spec anywhere: the folder has none yet, and the
	// control that names one is absent rather than empty.
	assert.equal(await app.evaluate("!!document.getElementById('spec')"), false, "no spec, no spec button");
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
	assert.equal(await step(app, "Previous answer"), true);
	await until("the previous branch", async () => (await marks(app)).includes("ANSWER-BETA"));
	assert.equal(await marks(app), "ANSWER-BETA 2/3");
});

check("the first branch offers no previous", async ({ app }) => {
	assert.equal(await step(app, "Previous answer"), true);
	await until("the first branch", async () => (await marks(app)).includes("ANSWER-ALPHA"));
	assert.equal(await marks(app), "ANSWER-ALPHA 1/3");
	assert.equal(await allDisabled(app, "Previous answer"), true);
});

check("and forward again", async ({ app }) => {
	assert.equal(await step(app, "Next answer"), true);
	await until("the second branch", async () => (await marks(app)).includes("ANSWER-BETA"));
});

check("a question takes the message box's place, is answered from the keys, and gives the box back with what was in it", async ({ app }) => {
	const boxShown = () => app.evaluate("document.querySelector('textarea[placeholder=\"Message the agent\"]').offsetParent !== null");
	const asked = () => app.evaluate("!!document.getElementById('question')");
	const before = await marks(app);
	await app.click('textarea[placeholder="Message the agent"]');
	await app.keys("DRAFT");

	// The server's own question, which no model has to be called for.
	assert.equal(await press(app, "Previous answer"), true);
	await until("the question", asked);
	assert.equal(await boxShown(), false, "the box is out of sight while there is a question");
	assert.equal(await app.evaluate("!!document.querySelector('#chat #question')"), false, "and the question is not in the conversation");
	assert.equal(await app.evaluate("!!document.querySelector('#question [data-slot=questionnaire-input]')"), false, "a question that is not ask_user's has no line to write in");
	assert.equal(await app.evaluate("!!document.querySelector('#question [aria-label=Stop]')"), false, "and nothing to stop when no run is going");
	await until("the keys on the question", () => app.evaluate("document.getElementById('question').contains(document.activeElement)"));

	// The raw view has no conversation, and used to have no question either.
	await app.press("d", { meta: true, shift: true });
	await until("the raw view", () => app.evaluate("!!document.getElementById('raw')"));
	assert.equal(await asked(), true, "the question is under the raw view too");
	await app.press("d", { meta: true, shift: true });
	await until("the conversation again", () => app.evaluate("!!document.getElementById('chat')"));

	// Closed without an answer: nothing moves, and the box is back as it was left.
	await app.evaluate("document.querySelector('#question input').focus()");
	await app.press("Escape");
	await until("the question closed", async () => !(await asked()));
	assert.equal(await boxShown(), true);
	assert.equal(await app.evaluate("document.querySelector('textarea[placeholder=\"Message the agent\"]').value"), "DRAFT");
	await until("the keys back on the box", () => app.evaluate("document.activeElement?.placeholder === 'Message the agent'"));
	assert.equal(await marks(app), before);

	// Answered from the keys: a number takes a choice, and nothing is sent until Enter.
	assert.equal(await press(app, "Previous answer"), true);
	await until("the question again", asked);
	await until("the keys on the question", () => app.evaluate("document.getElementById('question').contains(document.activeElement)"));
	await app.press("1");
	await until("the first choice taken", () => app.evaluate("document.querySelector('#question input:checked')?.value === '0'"));
	assert.equal(await asked(), true, "taking a choice does not send it");
	await app.press("Enter");
	await until("the move", async () => (await marks(app)).includes("ANSWER-ALPHA"));
	assert.equal(await asked(), false);

	// Back where the checks after this one expect to be, with an empty box.
	assert.equal(await step(app, "Next answer"), true);
	await until("the second branch", async () => (await marks(app)) === before);
	await app.click('textarea[placeholder="Message the agent"]');
	for (const _ of "DRAFT") await app.press("Backspace");
	assert.equal(await app.evaluate("document.querySelector('textarea[placeholder=\"Message the agent\"]').value"), "");
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
		// One at a time, and waited for: a folder inside another is not drawn
		// until the one above it stands open, and a click at nothing is silent.
		await until(`the row for ${folder}`, () => page.evaluate(`!!document.querySelector('#notes button[data-folder="${folder}"]')`));
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

/**
 * A drag region swallows every click inside it, and the stylesheet punches a
 * hole for each control so they stay pressable. Chromium builds those regions
 * by walking the document in order, so a drag region that comes later fills in
 * the holes an earlier one made for its buttons — and a control under it is
 * dead to the mouse while the keyboard still reaches it.
 *
 * Nothing else here would catch that. A browser ignores app-region entirely,
 * and the clicks this file sends are put into the page underneath the shell
 * that reads it, so every one of them lands whatever the regions say. It went
 * unnoticed once already: folding the list let the tab row's box reach the
 * window's edge and cover the fold button, which then could not be pressed to
 * bring the list back. So it is checked as geometry, which needs no mouse.
 */
check("no drag region covers a control of one drawn before it, with the list of notes open or folded", async ({ app }) => {
	const covered = () => app.evaluate(`(() => {
		const regions = [...document.querySelectorAll(".drag-region")];
		const holds = (over, el) => {
			const a = over.getBoundingClientRect(), b = el.getBoundingClientRect();
			return b.width > 0 && b.height > 0 && a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom;
		};
		const buried = [];
		regions.forEach((region, i) => {
			for (const control of region.querySelectorAll("a, button, input, select, textarea, label, [role=button], [role=tab]")) {
				for (const later of regions.slice(i + 1)) {
					if (holds(later, control)) buried.push(control.id || control.getAttribute("aria-label") || control.tagName);
				}
			}
		});
		return [...new Set(buried)].join(", ");
	})()`);

	assert.equal(await covered(), "", "buried while the list of notes is open");
	const folded = (want) => until(`the list ${want ? "folded away" : "back"}`, async () =>
		(await app.evaluate(`document.getElementById("toggleSidebar").getAttribute("aria-pressed")`)) === (want ? "false" : "true"));
	await app.click("#toggleSidebar");
	await folded(true);
	assert.equal(await covered(), "", "buried while the list of notes is folded away");
	// Put back: the checks after this one share the window with it.
	await app.click("#toggleSidebar");
	await folded(false);
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

check("a decision made in the moment after typing still lands", async ({ app, cwd }) => {
	// The second the autosave waits in is where this went wrong. The places a
	// decision names are in the text on screen; the record holds the text on
	// disk. Type anything above a chunk and press Keep before the save lands,
	// and every offset is out by the length of what was typed — the touch lands
	// beside the words it is about, covers nothing, and the diff comes straight
	// back. On screen that is a Keep that did nothing and said nothing.
	//
	// The check above types and waits for the save before deciding, which is why
	// it never saw this. This one does not wait, and asserts that it did not.
	const NOTE = "in-the-moment.md";
	const mine = "# in the moment\n\nwhat I wrote.\n";
	// A pure insertion, which is what a change of pi's is once it is written
	// down: the run the log calls pi's is exactly the run the diff draws.
	writeFileSync(join(cwd, NOTE), `${mine}\npi added a line of its own.\n`);
	mkdirSync(join(cwd, ".pi/history"), { recursive: true });
	writeFileSync(
		join(cwd, `.pi/history/${NOTE}.jsonl`),
		[
			{ author: "me", at: Date.now() - 600_000, from: 0, to: 0, inserted: mine, removed: "" },
			{ author: "pi", at: Date.now() - 60_000, sessionId: "s", entryId: "e", from: mine.length, to: mine.length, inserted: "\npi added a line of its own.\n", removed: "" },
		]
			.map((c) => JSON.stringify(c))
			.join("\n") + "\n",
	);
	await pickNote(app, NOTE);
	await until("the diff", async () => (await chunks(app)) === 1);

	await app.click("#editor .cm-line", 0);
	assert.equal(await type(app, "X"), true);
	// The file, not the editor's status: the status is React's and arrives a
	// render later, while what this is about is whether the record has heard of
	// the typing yet. It has not, which is the whole point.
	assert.equal(readFileSync(join(cwd, NOTE), "utf8").includes("X"), false, "inside the window the autosave waits in");
	await onLastChunk(app, "Keep");
	await until("no chunk", async () => (await chunks(app)) === 0);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.equal(await chunks(app), 0, "and it stays gone once everything has been written down");
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

/**
 * Delete is behind the note header's menu now, so it takes opening that first.
 * The opening is a real click: Radix opens a menu on pointerdown, which a
 * synthetic .click() never sends. Choosing inside it is synthetic, as the tab
 * menu's check does.
 */
async function deleteNote(app) {
	await app.click("#noteMenu");
	await until("the note's menu", () => app.evaluate("!!document.querySelector('[role=menu] [role=menuitem]')"));
	await app.evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((i) => i.textContent.trim() === "Delete").click()`);
}

check("pointing at the agent's share offers who wrote what, and the marks ride the words under typing", async ({ app, cwd }) => {
	// A note with a past: the person wrote the first half and pi the second. Written
	// straight to disk with its log beside it, which is the state a note is in when
	// it is opened days later — the only way to have pi's words here without pi.
	writeFileSync(join(cwd, "whose.md"), "mine and then pi's\n");
	mkdirSync(join(cwd, ".pi/history"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi/history/whose.md.jsonl"),
		[
			{ author: "me", at: Date.now() - 60_000, from: 0, to: 0, inserted: "mine and then ours\n", removed: "" },
			// A replacement rather than an insertion, so there is something it stands in place of.
			{ author: "pi", at: Date.now() - 30_000, sessionId: "s", entryId: "e", from: 14, to: 18, inserted: "pi's", removed: "ours" },
		]
			.map((c) => JSON.stringify(c))
			.join("\n") + "\n",
	);
	await pickNote(app, "whose.md");
	await until("the note", async () => (await editorText(app)).includes("mine and then"));
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-by-pi').length"), 0, "off is the ordinary state");

	// The switch is behind the share in the strip: pointed at, a card comes up
	// with it. A real pointer, since a hover card opens on pointer movement, and
	// taken away again after so the card is not left over the page.
	await until("the share", () => app.evaluate("!!document.getElementById('authored')"));
	const whoWrote = async () => {
		const at = await app.evaluate("(() => { const b = document.getElementById('authored').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
		await app.moveTo(at.x, at.y);
		await until("the card with the switch", () => app.evaluate("!!document.getElementById('whoWrote')"));
		const was = await app.evaluate("document.getElementById('whoWrote').getAttribute('aria-checked')");
		assert.equal(await app.click("#whoWrote"), true);
		await until("the switch moved", async () => (await app.evaluate("document.getElementById('whoWrote').getAttribute('aria-checked')")) !== was);
		await app.moveTo(1, 1);
		await until("the card gone", async () => !(await app.evaluate("!!document.getElementById('whoWrote')")));
	};
	assert.equal(await app.evaluate("getComputedStyle(document.getElementById('authored')).backgroundColor").then((c) => /(\/ 0\)|, 0\))$/.test(c)), true, "nothing drawn on the share before it is pointed at");
	await whoWrote();
	await until("pi's words, marked", () =>
		app.evaluate("[...document.querySelectorAll('#editor .cm-by-pi')].map((el) => el.textContent).join('')"),
	).then((marked) => assert.equal(marked.trim(), "pi's", "what pi wrote, and nothing the person wrote"));

	// A click on one of them says how it got there: who, when, and what it stands
	// in place of. The conversation it names is not on this machine, so the model
	// and the question are left out rather than guessed at — the card is what the
	// record has, and no more.
	await app.click("#editor .cm-by-pi");
	await until("the card", () => app.evaluate("!!document.querySelector('[data-slot=popover-content]')"));
	const card = await app.evaluate("document.querySelector('[data-slot=popover-content]').textContent");
	assert.match(card, /^The agent/, "who wrote it — in the word the window uses for it");
	assert.ok(card.includes("−ours") && card.includes("+pi's"), `the old over the new: ${card}`);
	assert.equal(card.includes("Undo"), false, "it says, and does not do: deciding is the diff's");
	await app.press("Escape");
	await until("the card gone", async () => !(await app.evaluate("!!document.querySelector('[data-slot=popover-content]')")));

	// The note changing under the marks is not the marks going. What pi writes —
	// or, here, what something outside the app writes, which arrives by the same
	// road — is exactly when who wrote what is worth having, so the marks stay
	// and the question is put again: the new words come back marked as well.
	writeFileSync(join(cwd, "whose.md"), `${readFileSync(join(cwd, "whose.md"), "utf8").trimEnd()} and vim.\n`);
	await until("the write from outside", async () => (await editorText(app)).includes("and vim"));
	await until("the marks still there, and the new words among them", async () =>
		(await app.evaluate("document.querySelectorAll('#editor .cm-by-pi').length")) > 0 &&
		(await app.evaluate("document.querySelectorAll('#editor .cm-by-outside').length")) > 0,
	);

	// Typing is the person's own words, which carry no mark, and it changes
	// nothing about who wrote the words already there — so the marks stay on
	// their words and move with them, the way a mark in an editor does. Typed at
	// the very front, so that every marked word has to move to still be right.
	const marked = () => app.evaluate("[...document.querySelectorAll('#editor .cm-by-pi')].map((el) => el.textContent).join('')");
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.focus(); v.dispatch({ selection: { anchor: 0 } }); })()`);
	assert.equal(await type(app, "X "), true);
	assert.equal((await marked()).trim(), "pi's", "still pi's words, two characters along");
	assert.ok((await editorText(app)).startsWith("X "), "and the typed words are there, unmarked");
	// The save brings the answer again, about the note as it now is on disk: the same marks, from the record this time.
	await until("saved", async () => (await editorStatus(app)) === "saved");
	await until("the answer again", async () => (await marked()).trim() === "pi's" && (await app.evaluate("document.querySelectorAll('#editor .cm-by-outside').length")) > 0);
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-line').textContent.startsWith('X ')"), true);
	assert.equal(await app.evaluate("!!document.querySelector('#editor .cm-by-pi, #editor .cm-by-outside')?.textContent.includes('X')"), false, "what was typed is nobody else's");

	// Cut pi's words and paste them at the very front: to a diff of two texts
	// that is pi's words gone and the person's written, and the underline
	// would go with them. The editor saw the cut, so they stay pi's where
	// they land. Done as the editor's own cut and paste transactions — what a
	// ⌘X and a ⌘V come to inside it — rather than through the machine's
	// clipboard, which a check has no business writing to.
	await until("saved before the move", async () => (await editorStatus(app)) === "saved");
	await app.evaluate(`(() => {
		const v = document.querySelector('#editor .cm-content').cmTile.root.view;
		const text = v.state.doc.toString();
		const from = text.indexOf("pi's"), to = from + 4;
		v.dispatch({ changes: { from, to, insert: "" }, selection: { anchor: from }, userEvent: "delete.cut" });
		v.dispatch({ changes: { from: 0, to: 0, insert: "pi's" }, selection: { anchor: 4 }, userEvent: "input.paste" });
	})()`);
	await until("saved after the move", async () => (await editorStatus(app)) === "saved");
	assert.ok((await editorText(app)).startsWith("pi's"), "the words moved to the front");
	// Two lines for one save, in the order of the text: the paste at the front, then the cut behind it.
	const tail = readFileSync(join(cwd, ".pi/history/whose.md.jsonl"), "utf8").trim().split("\n").slice(-2).map((l) => JSON.parse(l));
	const pasted = tail.find((c) => c.inserted === "pi's");
	assert.ok(pasted && Array.isArray(pasted.spans) && pasted.spans[0].author === "pi", `the record says the moved words are pi's: ${JSON.stringify(tail)}`);
	await until("pi's words still marked, at the front", async () => {
		const runs = await app.evaluate("[...document.querySelectorAll('#editor .cm-by-pi')].map((el) => el.textContent)");
		return runs.length > 0 && runs.join("") === "pi's" && (await app.evaluate("document.querySelector('#editor .cm-line').textContent.startsWith(\"pi's\")"));
	});

	// Off again. This is a view of the window rather than of the note, so
	// leaving it on would leave every check after this one asking the same
	// question of whatever note it opens.
	await whoWrote();
	await until("the marks gone", async () => (await app.evaluate("document.querySelectorAll('#editor .cm-by-pi, #editor .cm-by-outside').length")) === 0);
});

check("a right click in the list acts on that note, open or not", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "list-a.md"), "A\n");
	writeFileSync(join(cwd, "list-b.md"), "B\n");
	await until("both listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="list-a.md"]') && !!document.querySelector('#notes button[data-path="list-b.md"]')`));
	// Open one, then act on the other: the menu is about the row, not about
	// whatever happens to be in front.
	await app.evaluate(`document.querySelector('#notes button[data-path="list-a.md"]').click()`);
	await until("a in front", async () => (await editorText(app)) === "A\n");

	await app.click(`#notes button[data-path="list-b.md"]`, 0, { button: "right" });
	await until("the menu", () => app.evaluate("!!document.querySelector('[role=menu] [role=menuitem]')"));
	const items = await app.evaluate("[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((i) => i.textContent.trim())");
	assert.ok(items.includes("Rename") && items.includes("Copy path") && items.includes("Delete"), `the header's items, got ${items.join()}`);

	await app.evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((i) => i.textContent.trim() === "Delete").click()`);
	await until("b gone from the list", () => app.evaluate(`!document.querySelector('#notes button[data-path="list-b.md"]')`));
	assert.equal(existsSync(join(cwd, "list-b.md")), false, "the one right-clicked went");
	assert.equal(existsSync(join(cwd, "list-a.md")), true, "the one in front stayed");
	assert.equal(await app.evaluate("location.hash"), "#list-a.md", "and is still in front");
});

check("deleting a note closes it and offers it back, and Restore brings it back open", async ({ app, cwd }) => {
	await app.evaluate(`document.querySelector('#notes button[data-path="code.md"]').click()`);
	await until("the note", async () => (await editorStatus(app)) === "saved");
	await deleteNote(app);
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

check("⌘P offers the rest of the repository, and a file that is not a note opens as one to read", async ({ app, cwd }) => {
	await app.press("p", { meta: true });
	await until("the palette", () => app.evaluate("document.activeElement?.dataset.slot === 'command-input'"));
	await app.keys("tool");
	await until("the file, under its own heading", () =>
		app.evaluate(`[...document.querySelectorAll('[data-slot=command-list] [cmdk-group]')].some((g) => g.querySelector('[cmdk-group-heading]')?.textContent === 'Files' && g.textContent.includes('tool.ts'))`),
	);
	await app.evaluate(`[...document.querySelectorAll('[data-slot=command-list] [cmdk-item]')].find((i) => i.textContent.includes('tool.ts')).click()`);
	await until("the file in front", async () => (await app.evaluate("location.hash")) === "#tool.ts" && (await app.evaluate(`!!document.querySelector('#page[data-code="tool.ts"]')`)));
	const text = () => app.evaluate("document.querySelector('#page .cm-content')?.textContent ?? ''");
	await until("its text", async () => (await text()).includes("export const answer = 42;"));
	// A file, not a note: no title to rename it by and no properties above it.
	assert.equal(await app.evaluate("!!document.getElementById('note')"), false);
	assert.equal(await app.evaluate("document.querySelectorAll('#page .cm-lineNumbers .cm-gutterElement').length > 1"), true, "lines are numbered");
	await app.shot("code");
	// Read, not written: the keys reach it and change nothing.
	await app.click("#page .cm-content");
	await app.keys("XXX");
	assert.equal((await text()).includes("XXX"), false, "a file here is read-only");
	assert.equal(readFileSync(join(cwd, "tool.ts"), "utf8"), "// what it answers\nexport const answer = 42;\n");
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

check("a picture pasted into a note is kept in the folder and named where the cursor was, and then drawn", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "paste.md"), "# paste\n\nbefore \n\nafter\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="paste.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="paste.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	// The cursor at the end of "before ", then a paste of a 2×2 PNG, as the clipboard would hand it over.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf("before ") + 7 } }); })()`);
	await app.evaluate(`(() => {
		const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mNk+M9QDwADhQGA6UhwXAAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
		const dt = new DataTransfer();
		dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
		document.querySelector('#editor .cm-content').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
	})()`);
	await until("the note naming the picture", async () => /before !\[\[Pasted image \d{14}\.png\]\]/.test(await editorText(app)));
	const name = (await editorText(app)).match(/Pasted image \d{14}\.png/)[0];
	await until("the file in the folder", () => existsSync(join(cwd, "attachments", name)));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	// Off the line, it is a picture.
	await app.press("End", { meta: true });
	await until("drawn", () => app.evaluate("document.querySelector('#editor img.cm-image')?.naturalWidth === 2"));
});

check("pictures are drawn where the note says there are pictures, and as written on the cursor's line", async ({ app, cwd }) => {
	// A 2×2 PNG, so what the browser draws has a size of its own to be measured.
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mNk+M9QDwADhQGA6UhwXAAAAABJRU5ErkJggg==", "base64");
	mkdirSync(join(cwd, "images"), { recursive: true });
	writeFileSync(join(cwd, "images", "shot.png"), png);
	writeFileSync(join(cwd, "pictures.md"), "# pictures\n\nObsidian: ![[shot.png]]\n\nSized: ![[shot.png|40]]\n\nMarkdown: ![a shot](images/shot.png)\n\nWeb: ![w](https://example.com/w.png)\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="pictures.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="pictures.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	// The cursor at the end: off every picture's line.
	await app.press("End", { meta: true });
	const drawn = () => app.evaluate("[...document.querySelectorAll('#editor img.cm-image')].map((i) => [i.getAttribute('src'), i.getAttribute('width'), i.alt])");
	await until("four pictures", async () => (await drawn()).length === 4);
	assert.deepEqual(await drawn(), [
		["/vault/shot.png?from=pictures.md", null, ""],
		["/vault/shot.png?from=pictures.md", "40", ""],
		["/vault/images/shot.png?from=pictures.md", null, "a shot"],
		["https://example.com/w.png", null, "w"],
	]);
	// The ones in the folder were found and fetched: a real picture has a size.
	await until("the first picture loaded", () => app.evaluate("document.querySelector('#editor img.cm-image').naturalWidth === 2"));
	assert.ok(!(await shownText(app)).includes("![["), "the markup is gone from the text");
	// The cursor in the markup: the picture gone for that line and the markup
	// back, marks and all, until the cursor leaves.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; const at = v.state.doc.toString().indexOf("![[shot.png|40]]") + 3; v.dispatch({ selection: { anchor: at } }); })()`);
	await until("that line as written", async () => (await shownText(app)).includes("![[shot.png|40]]") && (await drawn()).length === 3);
	await app.press("End", { meta: true });
	await until("drawn again", async () => (await drawn()).length === 4);
});

check("a table is drawn as a table off the cursor and as pipes on it, and footnotes are numbers that go to each other", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "table.md"), "# table\n\n| Name | Amount |\n| :-- | --: |\n| **Apples** | 3 |\n| Pears [[first]] | 12 |\n\nA claim.[^note] Another.[^2] And the first again.[^note]\n\n[^note]: What the note says.\n[^2]: The second.\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="table.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="table.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("End", { meta: true });
	const table = () => app.evaluate(`(() => { const t = document.querySelector('#editor table.cm-table'); if (!t) return null; return { header: [...t.tHead.rows[0].cells].map((c) => c.textContent), rows: [...t.tBodies[0].rows].map((r) => [...r.cells].map((c) => c.innerHTML)), align: [...t.tBodies[0].rows[0].cells].map((c) => c.style.textAlign) }; })()`);
	await until("the table drawn", async () => (await table()) !== null);
	assert.deepEqual(await table(), {
		header: ["Name", "Amount"],
		rows: [["<strong>Apples</strong>", "3"], ['Pears <span class="cm-wikilink">first</span>', "12"]],
		align: ["left", "right"],
	});
	assert.ok(!(await shownText(app)).includes("| Name"), "the pipes are gone from the text");

	// The footnotes: numbers in the order first referred to, the notes labelled the same.
	const sups = () => app.evaluate("[...document.querySelectorAll('#editor sup.cm-footnote')].map((s) => s.className.replace('cm-footnote cm-footnote-', '') + ':' + s.textContent)");
	await until("the numbers", async () => (await sups()).length === 5);
	assert.deepEqual(await sups(), ["ref:1", "ref:2", "ref:1", "def:1", "def:2"]);
	// A click on the first number goes to its note; on the note's number, back to the text.
	await app.click("#editor sup.cm-footnote-ref", 0);
	await until("at the note", async () => (await shownText(app)).includes("[^note]: What the note says."));
	// Off the note's line again, so its number is drawn to be clicked.
	await app.press("End", { meta: true });
	await until("the note's number back", async () => (await sups()).filter((s) => s === "def:1").length === 1);
	await app.click("#editor sup.cm-footnote-def", 0);
	await until("back at the text", async () => (await shownText(app)).includes("A claim.[^note]"));

	// A click on the drawn table brings the pipes back under the cursor.
	await app.press("End", { meta: true });
	await until("the table drawn again", async () => (await table()) !== null);
	assert.ok(await app.click("#editor table.cm-table td"), "a cell to click");
	await until("the pipes back", async () => (await shownText(app)).includes("| Name | Amount |") && (await table()) === null);
});

check("another note is shown in place — all of it, a section, a block — and a missing one says so", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "Source.md"), "# Source\n\nThe source's first words.\n\n## Part two\n\n- one **two**\n- three\n\n## Part three\n\nlast, with an id. ^p3\n");
	writeFileSync(join(cwd, "embeds.md"), "# embeds\n\nWhole: ![[Source]]\n\nSection: ![[Source#Part two]]\n\nBlock: ![[Source#^p3]]\n\nGone: ![[Nowhere]]\n\nend\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="embeds.md"]') && !!document.querySelector('#notes button[data-path="Source.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="embeds.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("End", { meta: true });
	const cards = () => app.evaluate("[...document.querySelectorAll('#editor .cm-embed')].map((c) => [c.querySelector('.cm-embed-title').textContent, c.querySelector('.cm-embed-body').innerText.replace(/\\s+/g, ' ').trim()])");
	await until("four cards, read", async () => {
		const seen = await cards();
		return seen.length === 4 && seen.every(([, body]) => body !== "…");
	});
	assert.deepEqual(await cards(), [
		["Source", "Source The source's first words. Part two one two three Part three last, with an id."],
		["Source › Part two", "Part two one two three"],
		["Source › ^p3", "last, with an id."],
		["Nowhere", "No note called Nowhere."],
	]);
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-embed li strong')?.textContent"), "two", "the words inside keep their marks");
	// The cursor in the markup: the card gone for that line, the markup back.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; const at = v.state.doc.toString().indexOf("![[Source#Part two]]") + 3; v.dispatch({ selection: { anchor: at } }); })()`);
	await until("that line as written", async () => (await shownText(app)).includes("![[Source#Part two]]") && (await cards()).length === 3);
	// The other note changes on disk: the card that shows it is read again.
	await app.press("End", { meta: true });
	await until("four cards again", async () => (await cards()).length === 4);
	writeFileSync(join(cwd, "Source.md"), "# Source\n\nThe source's NEW first words.\n\n## Part two\n\n- one **two**\n- three\n\n## Part three\n\nlast, with an id. ^p3\n");
	await until("the card read again", async () => (await cards())[0][1].includes("NEW first words"));
	// A click on a card's body: the cursor on its line, the markup back.
	await app.evaluate("document.querySelector('#editor .cm-embed-body').scrollIntoView({ block: 'center' })");
	assert.ok(await app.click("#editor .cm-embed-body", 0), "a body to click");
	await until("that line as written, from a click", async () => (await shownText(app)).includes("![[Source]]"));
	// The card's title opens the note.
	await app.press("End", { meta: true });
	// Read again, not only drawn: a card grows as its note arrives, and a title
	// measured before that is somewhere else by the time the press lands.
	await until("four cards again, read", async () => {
		const seen = await cards();
		return seen.length === 4 && seen.every(([, body]) => body !== "…");
	});
	// Pressed until it takes: the cards were just drawn again with their notes
	// in them, and a title measured before the layout has landed is somewhere
	// else by the time the press does. Pressing a title once the note is open
	// opens it again, which is nothing.
	// The cursor at the end has the page scrolled down and the first card off
	// the top: brought into view, then pressed until the note is open.
	await until("Source open", async () => {
		await app.evaluate("document.querySelector('#editor .cm-embed-title')?.scrollIntoView({ block: 'center' })");
		await app.click("#editor .cm-embed-title", 0);
		return (await app.evaluate("location.hash")) === "#Source.md";
	});
	await pickNote(app, "embeds.md");
});

check("math is set as math off the cursor, in a line and as a block, and is the source under it", async ({ app, cwd }) => {
	// The block straight under a line of prose, as Obsidian users write it.
	writeFileSync(join(cwd, "math.md"), "# math\n\nInline $E = mc^2$ here, and $5 is money.\n$$\n\\int_0^1 x^2\\,dx\n$$\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="math.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="math.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("End", { meta: true });
	const set = () => app.evaluate("[...document.querySelectorAll('#editor .cm-math')].map((m) => [m.classList.contains('cm-math-block'), m.querySelector('.katex') !== null, m.textContent.replace(/\\s+/g, '').slice(0, 12)])");
	await until("both set", async () => (await set()).length === 2);
	const drawn = await set();
	assert.deepEqual(drawn.map(([block, katex]) => [block, katex]), [[false, true], [true, true]], "an inline and a block, both by KaTeX");
	assert.ok(drawn[0][2].includes("E=mc"), `the inline one says E=mc², not ${drawn[0][2]}`);
	const text = await shownText(app);
	assert.ok(!text.includes("$E") && text.includes("$5 is money"), "the math's source is gone from the text; the money is not math");
	// The cursor in the inline math: its source back, the block still set.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; const at = v.state.doc.toString().indexOf("mc^2"); v.dispatch({ selection: { anchor: at } }); })()`);
	await until("the source under the cursor", async () => (await shownText(app)).includes("$E = mc^2$") && (await set()).length === 1);
});

check("the little HTML a note holds is drawn from a list, a script is not, and sub- and superscript sit off the line", async ({ app, cwd }) => {
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mNk+M9QDwADhQGA6UhwXAAAAABJRU5ErkJggg==", "base64");
	writeFileSync(join(cwd, "shot2.png"), png);
	writeFileSync(join(cwd, "html.md"), "# html\n\nSome <u>underlined</u> and <kbd>⌘K</kbd> words, a break<br>here, <img src=\"shot2.png\" width=\"30\"> and <script>alert(1)</script> stays.\n\nH~2~O and x^2^ are set.\n\n<details open>\n<summary>More</summary>\n<p>Hidden <b>words</b> <a href=\"javascript:alert(1)\">bad</a> <a href=\"https://octave.run\">good</a></p>\n</details>\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="html.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="html.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("End", { meta: true });
	await until("the underline", () => app.evaluate("document.querySelector('#editor .cm-html-u')?.textContent === 'underlined'"));
	assert.equal(await app.evaluate("document.querySelector('#editor .cm-html-kbd')?.textContent"), "⌘K");
	assert.equal(await app.evaluate("document.querySelectorAll('#editor br.cm-html-br').length"), 1, "a break drawn");
	assert.equal(await app.evaluate("document.querySelector('#editor img.cm-image')?.getAttribute('width')"), "30", "the picture, at its width");
	await until("the picture loaded", () => app.evaluate("document.querySelector('#editor img.cm-image')?.naturalWidth === 2"));
	const text = await shownText(app);
	assert.ok(!text.includes("<u>") && !text.includes("<kbd>") && !text.includes("<br>"), "the tags on the list are hidden");
	assert.ok(text.includes("<script>alert(1)</script>"), "a script is left as written, and does not run");
	// The block: its DOM, sanitized.
	const block = () => app.evaluate("(() => { const d = document.querySelector('#editor .cm-html-block details'); return d && { open: d.open, summary: d.querySelector('summary')?.textContent, bold: d.querySelector('b')?.textContent, links: [...d.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]) }; })()");
	await until("the details block", async () => (await block()) !== null);
	assert.deepEqual(await block(), { open: true, summary: "More", bold: "words", links: [["bad", null], ["good", "https://octave.run"]] });
	// Sub- and superscript: set off the line, marks hidden.
	assert.ok(!text.includes("~2~") && !text.includes("^2^"), "their marks are hidden");
	const styled = await app.evaluate("[...document.querySelectorAll('#editor .cm-line span')].filter((s) => /sub|super/.test(getComputedStyle(s).verticalAlign)).map((s) => [s.textContent, getComputedStyle(s).verticalAlign])");
	assert.deepEqual(styled, [["2", "sub"], ["2", "super"]]);
	// The cursor inside a pair: the tags back.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; const at = v.state.doc.toString().indexOf("underlined") + 2; v.dispatch({ selection: { anchor: at } }); })()`);
	await until("the tags back under the cursor", async () => (await shownText(app)).includes("<u>underlined</u>"));
});

check("in a table, a click lands in its cell, Tab walks the cells and makes a row, Enter adds one, and the pipes square up on leaving", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "edit-table.md"), "# edit\n\n| Name | Amount |\n|:--|--:|\n| Apples | 3 |\n|Pears|12|\n\nend\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="edit-table.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="edit-table.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	await app.press("End", { meta: true });
	await until("the table drawn", () => app.evaluate("!!document.querySelector('#editor table.cm-table')"));
	// A click on "Pears": the cursor in that cell, the pipes back.
	assert.ok(await app.click("#editor table.cm-table tbody tr:nth-child(2) td:first-child"), "the Pears cell");
	const sel = () => app.evaluate("(() => { const s = document.querySelector('#editor .cm-content').cmTile.root.view.state; const r = s.selection.main; return { from: r.from, to: r.to, at: s.doc.sliceString(Math.max(0, r.from - 6), r.to + 1) }; })()");
	await until("the cursor in the Pears cell", async () => (await sel()).at.includes("Pears|") && (await shownText(app)).includes("|Pears|12|"));
	// Tab: the next cell's words chosen; Shift-Tab: back.
	await app.press("Tab");
	await until("12 chosen", async () => {
		const s = await sel();
		if (s.to - s.from === 2 && s.at.endsWith("12|")) return true;
		throw new Error(JSON.stringify(s));
	});
	await app.press("Tab", { shift: true });
	await until("Pears chosen", async () => { const s = await sel(); return s.to - s.from === 5 && s.at.includes("Pears"); });
	// Tab from the last cell: a new row, the cursor in its first cell.
	await app.press("Tab");
	await app.press("Tab");
	await until("a new row", async () => (await editorText(app)).includes("|Pears|12|\n| | |"));
	// Enter: a row under this one.
	await app.press("Enter");
	await until("another row", async () => (await editorText(app)).includes("|Pears|12|\n| | |\n| | |"));
	// Off the table: squared.
	await app.press("End", { meta: true });
	await until("the pipes squared", async () => (await editorText(app)).includes("| Name   | Amount |\n| :----- | -----: |\n| Apples | 3      |\n| Pears  | 12     |\n|        |        |\n|        |        |"));
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.ok(readFileSync(join(cwd, "edit-table.md"), "utf8").includes("| Pears  | 12     |"), "squared on disk");
});

check("typing [^ offers the footnotes and a new one, and a footnote's number says its note on hover", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "fn.md"), "# fn\n\nA claim.[^note] More.\n\n[^note]: What the note says.\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="fn.md"]')`));
	await app.evaluate(`document.querySelector('#notes button[data-path="fn.md"]').click()`);
	await until("the note, with focus", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("document.activeElement?.classList.contains('cm-content')")));
	// After "More." type [^ : the note there is, with its words, and a new one.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; const at = v.state.doc.toString().indexOf("More.") + 5; v.dispatch({ selection: { anchor: at } }); })()`);
	await app.keys("[^");
	const offered = () => app.evaluate("[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((l) => l.textContent)");
	await until("the offers", async () => (await offered()).length === 2);
	const list = await offered();
	assert.ok(list[0].startsWith("note") && list[0].includes("What the note says"), `the footnote there is, with its words: ${list[0]}`);
	assert.ok(list[1].startsWith("New footnote") && list[1].includes("[^1]"), `a new one, numbered next: ${list[1]}`);
	// The new one: [^1] in the text, its note begun under the last, the cursor in it.
	await app.press("ArrowDown");
	await until("the new one chosen", () => app.evaluate(`document.querySelector('.cm-tooltip-autocomplete li[aria-selected="true"]')?.textContent.startsWith("New footnote")`));
	await app.press("Enter");
	await until("the reference and its note", async () => {
		const text = await editorText(app);
		if (text.includes("More.[^1]") && text.includes("[^note]: What the note says.\n[^1]: ")) return true;
		throw new Error(JSON.stringify(text.slice(-80)));
	});
	await app.keys("Written here.");
	await until("the note written", async () => (await editorText(app)).includes("[^1]: Written here."));
	// Off the line, the number; hovered, its note.
	await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; v.dispatch({ selection: { anchor: 0 } }); })()`);
	await until("the numbers", () => app.evaluate("document.querySelectorAll('#editor sup.cm-footnote-ref').length === 2"));
	const at = await app.evaluate("(() => { const r = document.querySelectorAll('#editor sup.cm-footnote-ref')[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
	await app.moveTo(at.x, at.y);
	await until("its note on hover", () => app.evaluate("document.querySelector('.cm-tooltip-footnote')?.textContent === 'Written here.'"));
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
	// Back by the list, then make the missing one. (It used to be by the
	// backlink in the strip, which the strip no longer carries.)
	await pickNote(app, "hub.md");
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
	// The one Enter will take, not merely the one on the list. Those are two
	// different things and they only coincide on a machine quick enough that
	// the list has settled by the time the key lands; on a loaded runner the
	// source can re-run between them and Enter goes into the note as a newline.
	await until("the offer, chosen", () =>
		app.evaluate(`document.querySelector('.cm-tooltip-autocomplete li[aria-selected="true"]')?.textContent ?? ""`).then((t) => t.includes("My note")),
	);
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

/**
 * A note is as tall as the page it is on, not as tall as its text.
 *
 * The editor used to end with the last line, and the space under it belonged
 * to the scroller, which is nobody: a click there put no cursor anywhere, and
 * the only way to move anything down the page was to hold Enter until the file
 * had the blank lines to push it — a note changed on disk to move something on
 * screen.
 */
check("a short note fills the page, and the space under its last line is the editor", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "short-a.md"), "one short line\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="short-a.md"]')`));
	await pickNote(app, "short-a.md");
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("one short line"));

	/**
	 * Where the last line ends is asked of the editor, not of the box around
	 * the text: once the editor fills the page, .cm-content reaches the foot
	 * whether or not there are words that far down, and the empty part of it
	 * is the whole point. `coordsAtPos` at the end of the doc is the only
	 * thing here that means "where the writing stops".
	 */
	const box = await app.evaluate(`(() => {
		const box = document.querySelector('#editor .cm-editor').getBoundingClientRect();
		const content = document.querySelector('#editor .cm-content').getBoundingClientRect();
		const view = document.querySelector('#editor .cm-content').cmTile.root.view;
		const last = view.coordsAtPos(view.state.doc.length);
		return { boxBottom: box.bottom, textBottom: last.bottom, textMid: (content.left + content.right) / 2 };
	})()`);

	const spot = (box.textBottom + box.boxBottom) / 2;
	assert.ok(spot > box.textBottom + 8, `there is room under the last line to click: ${Math.round(box.boxBottom - box.textBottom)}px`);
	await app.clickAt(box.textMid, spot);
	const caret = await app.evaluate(`(() => { const v = document.querySelector('#editor .cm-content').cmTile.root.view; return { head: v.state.selection.main.head, end: v.state.doc.length, focused: v.hasFocus }; })()`);
	assert.ok(caret.focused, "a click under the text gives the editor the focus");
	assert.equal(caret.head, caret.end, "and leaves the cursor at the end of the text");

	// Nothing was written to the file to make room to click in.
	assert.equal(readFileSync(join(cwd, "short-a.md"), "utf8"), "one short line\n");

	// A floor under the editor must not become a ceiling over it: a long note
	// is still the page scrolling, not a box of text scrolling inside a page
	// that stays put. This is what giving the editor a `height` would cost.
	writeFileSync(join(cwd, "long.md"), Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
	await until("the long note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="long.md"]')`));
	await pickNote(app, "long.md");
	await until("the long note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("line 200"));
	const scrolls = await app.evaluate(`(() => {
		const page = document.getElementById('note');
		const box = document.querySelector('#editor .cm-scroller');
		return { page: page.scrollHeight - page.clientHeight, editor: box.scrollHeight - box.clientHeight };
	})()`);
	assert.ok(scrolls.page > 0, "a long note gives the page something to scroll");
	assert.ok(scrolls.editor <= 1, `and the editor scrolls nothing of its own (${Math.round(scrolls.editor)}px)`);
});

check("the strip at the foot of the window keeps its height, and says whether the note has reached the disk", async ({ app, cwd }) => {
	const height = () => app.evaluate("document.getElementById('status')?.getBoundingClientRect().height ?? -1");
	const says = () => app.evaluate("document.getElementById('status')?.textContent ?? ''");

	writeFileSync(join(cwd, "strip-short.md"), "one line\n");
	writeFileSync(join(cwd, "strip-long.md"), Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
	await until("the notes to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="strip-short.md"]') && !!document.querySelector('#notes button[data-path="strip-long.md"]')`));

	await pickNote(app, "strip-short.md");
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("one line"));
	const was = await height();
	assert.ok(was > 0, "the strip is drawn");
	assert.ok(!(await says()).includes("Saving"), "a note that is on disk says nothing about the disk");

	// A long note, pi put away and brought back, and the window made smaller:
	// four things that move everything else in the window, and none of them is
	// the strip's business.
	await pickNote(app, "strip-long.md");
	await until("the long note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("line 200"));
	assert.equal(await height(), was, "a long note does not move the strip");

	// The button rather than the panel: pi's column is collapsed to nothing
	// rather than taken out of the page, so #chat is still there either way.
	// What the button says is the one thing that turns over.
	const pi = (label) => app.evaluate(`(() => { const b = document.querySelector('button[aria-label=${JSON.stringify(label)}]'); if (!b) return false; b.click(); return true; })()`);
	assert.equal(await pi("Hide the agent"), true);
	await until("pi to be away", () => app.evaluate(`!!document.querySelector('button[aria-label="Show the agent"]')`));
	assert.equal(await height(), was, "putting pi away does not move the strip");
	assert.equal(await pi("Show the agent"), true);
	await until("pi to be back", () => app.evaluate(`!!document.querySelector('button[aria-label="Hide the agent"]')`));
	assert.equal(await height(), was, "and bringing it back does not either");

	// Typed and not yet sent, then sent: the strip follows the note to the disk.
	assert.equal(await type(app, "MORE "), true);
	await until("the strip to say it is going", async () => (await says()).includes("Saving"));
	assert.equal(await height(), was, "and neither does a word being typed");
	await until("the strip to go quiet again", async () => !(await says()).includes("Saving"));
	assert.ok(readFileSync(join(cwd, "strip-long.md"), "utf8").includes("MORE"), "which it had");
});

/**
 * How much note there is, and the two ways of saying it.
 *
 * The count is of the body. A note's front matter is what it is filed under
 * rather than anything written in it, and six properties over two lines should
 * not read as eight.
 */
check("the strip counts the note's words, and says it in characters instead when asked", async ({ app, cwd }) => {
	const count = () => app.evaluate("document.getElementById('count')?.textContent ?? ''");

	writeFileSync(join(cwd, "count-me.md"), "---\ntags: [counted]\nstatus: draft\n---\n\none two three\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="count-me.md"]')`));
	await pickNote(app, "count-me.md");
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("one two three"));

	// Three words: the four lines of front matter are the file's and none of the note's.
	await until("the count", async () => (await count()).includes("3 words"));

	// Pressed, it says the same note the other way, and stays that way for the
	// next note: it is how you like to be told, not a fact about one note.
	assert.equal(await app.evaluate(`(() => { const b = document.getElementById('count')?.closest('button'); if (!b) return false; b.click(); return true; })()`), true);
	await until("characters", async () => (await count()).includes("13 characters"));

	// And it follows the typing rather than the saving. The cursor is put at the
	// end first: pressing the count took the focus out of the editor, and words
	// landing at position 0 would go in front of the `---` and break the block,
	// which moves what counts as the body and makes this check about that
	// instead.
	const toEnd = () => app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); const v = box.cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); return true; })()`);
	assert.equal(await toEnd(), true);
	assert.equal(await type(app, " four"), true);
	// 19, not 18: the cursor sat after the note's last newline, so what was
	// typed went on a line of its own and the break between them is a
	// character like any other.
	await until("the count to follow the typing", async () => (await count()) !== "13 characters");
	assert.ok((await count()).includes("19 characters"), `the count follows the typing, and saw: ${await count()}`);

	// A rename moves the path under a live editor. The strip is told about the
	// note that is open, so a count written under the name it used to have is a
	// strip that goes blank the moment a note is retitled.
	await retitle(app, "counted-again");
	await until("the new address", async () => (await app.evaluate("location.hash")) === "#counted-again.md");
	assert.equal(await toEnd(), true);
	assert.equal(await type(app, " five"), true);
	await until("the count under the new name", async () => (await count()) !== "19 characters");
	assert.ok((await count()).includes("24 characters"), `the count keeps up with a renamed note, and saw: ${await count()}`);

	// And the way you chose to be told outlives the window, the way the recent
	// list and the row of tabs do. A choice you would have to make again at
	// every launch is not a choice.
	await app.evaluate("location.reload()");
	await until("the note after the reload", async () => (await editorStatus(app)) === "saved");
	await until("characters still", async () => (await count()).includes("characters"));
});

/**
 * How much of the note is not the reader's own, along the foot of the window.
 *
 * A share and not the runs. Who wrote which words is a question somebody puts
 * (`who_wrote`), and an answer that followed every keystroke would be another
 * feature; one number rides in with the note and with every change to it.
 */
check("the strip says how much of the note the agent wrote, and nothing at all when it is all yours", async ({ app, cwd }) => {
	const share = () => app.evaluate("document.getElementById('authored')?.textContent ?? ''");

	// All the person's own — and made through the app, which is the only way to
	// have that. A file that appears in the folder while the app is running was
	// written by somebody, just now, and not through here: the app calls that
	// hand `outside` and is right to (server.ts). Every note these checks write
	// straight to disk is somebody else's by that reckoning.
	await app.click('[aria-label="New note"]');
	await until("the new note", async () => (await editorStatus(app)) === "saved" && (await app.evaluate("location.hash")) === "#Untitled.md");
	assert.equal(await type(app, "every word of this is mine"), true);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	assert.equal(await share(), "", "a note nobody else touched says nothing about who wrote it");
	const was = await app.evaluate("document.getElementById('status').getBoundingClientRect().height");

	// Half the person's, half pi's — written to disk with its log beside it, the
	// state a note is in when it is opened days later (see the check that presses the share).
	writeFileSync(join(cwd, "share-pi.md"), "mine and then pi's\n");
	mkdirSync(join(cwd, ".pi/history"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi/history/share-pi.md.jsonl"),
		[
			{ author: "me", at: Date.now() - 60_000, from: 0, to: 0, inserted: "mine and then ours\n", removed: "" },
			{ author: "pi", at: Date.now() - 30_000, sessionId: "s", entryId: "e", from: 14, to: 18, inserted: "pi's", removed: "ours" },
		]
			.map((c) => JSON.stringify(c))
			.join("\n") + "\n",
	);
	await pickNote(app, "share-pi.md");
	await until("the note", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("mine and then"));

	// 4 of 19 characters are pi's, which is 21%.
	await until("the agent's share", async () => (await share()).includes("agent "));
	assert.match(await share(), /agent 21%/, `a share in whole points, and it said: ${await share()}`);
	assert.equal(await app.evaluate("document.getElementById('status').getBoundingClientRect().height"), was, "and the strip does not move for it");

	// Typing is the person's own by definition, so their part of it grows: the
	// share is worked out again when the note reaches the disk, not on a reopen.
	await app.evaluate(`(() => { const box = document.querySelector('#editor .cm-content'); box.focus(); const v = box.cmTile.root.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); return true; })()`);
	assert.equal(await type(app, "and a good deal more of my own besides\n"), true);
	await until("the save to land", async () => (await editorStatus(app)) === "saved");
	await until("the agent's share to fall", async () => {
		const m = (await share()).match(/agent (\d+)%/);
		return m !== null && Number(m[1]) < 21;
	});
});

/**
 * The strip reaches the foot of the window, and what is in it is centred there.
 *
 * It used to stop eight pixels short: the card's wrapper laid its bottom margin
 * under the strip rather than under the card, so what looked like the foot of
 * the window was a strip with a band of nothing beneath it. Everything in it
 * was centred in the strip and high in the foot, which is a thing you can see
 * without being able to say what it is.
 *
 * The inset is held against the tabs' at the top, not the height. A status bar
 * is shorter than a row of tabs everywhere it exists — VS Code's is 22px to its
 * tabs' 35 — but the gap between a pressable thing and the edge of the strip it
 * sits in is the rhythm of the window, and that should be the same at both ends.
 */
check("the strip reaches the foot of the window, and sits in it the way the tabs sit in theirs", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "foot-strip.md"), "#foot a note with something to say\n");
	writeFileSync(join(cwd, "foot-strip-mate.md"), "also #foot\n");
	await until("listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="foot-strip.md"]')`));
	await pickNote(app, "foot-strip.md");
	await until("the note", async () => (await editorStatus(app)) === "saved");
	await until("something pressable in the strip", () => app.evaluate(`!!document.querySelector('#status button')`));

	const laid = await app.evaluate(`(() => {
		const box = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height }; };
		return {
			bar: box(document.getElementById('status')),
			item: box(document.querySelector('#status button')),
			topStrip: box(document.querySelector('.drag-region')),
			card: box(document.querySelector('#status').previousElementSibling),
			tab: box(document.querySelector('#tabs button, [role=tab]')),
			windowFoot: innerHeight,
		};
	})()`);

	// Nothing under it: the strip is the foot of the window.
	assert.ok(
		Math.abs(laid.bar.bottom - laid.windowFoot) <= 1,
		`the strip reaches the window's foot, and stopped ${Math.round(laid.windowFoot - laid.bar.bottom)}px short`,
	);

	// And centred in it, which only means anything now that the strip is the foot.
	const above = laid.item.top - laid.bar.top;
	const below = laid.bar.bottom - laid.item.bottom;
	assert.ok(Math.abs(above - below) <= 1, `centred in the strip: ${Math.round(above)}px above, ${Math.round(below)}px below`);

	// Centred in the strip is not the same as looking centred. What is over the
	// strip is the card, and a margin under the card lands above the strip and
	// under nothing — so the eye measures from the card's edge and finds more
	// room above than below. Twice now. The gap the card leaves is held to the
	// gap the strip keeps.
	const underCard = laid.item.top - laid.card.bottom;
	assert.ok(
		Math.abs(underCard - below) <= 1,
		`what is over the strip leaves no gap of its own: ${Math.round(underCard)}px between the card and the item, against ${Math.round(below)}px under it`,
	);

	// The same gap the tabs keep at the top, whatever the two strips' heights are.
	if (laid.tab) {
		const tabInset = (laid.topStrip.height - laid.tab.height) / 2;
		assert.ok(
			Math.abs(above - tabInset) <= 1.5,
			`the same inset as a tab: ${Math.round(above)}px here against ${Math.round(tabInset)}px up there`,
		);
	}

	// The strip is one of the window's chrome rows and is built the way they
	// are: the row says how tall the row is, and what sits in it says nothing
	// about its own height — the size it is cut to does. So the strip and the
	// row of tabs come out the same height without either being told about the
	// other, and if somebody writes a height onto an item again this is what
	// notices.
	assert.equal(Math.round(laid.bar.height), Math.round(laid.topStrip.height), "the strip is a chrome row like the one the tabs sit in");

	// The window's bottom edge carries two rows — this one, and the one the
	// folder's name and the settings button sit in down the side. They are told
	// nothing about each other and must still come out alike, because they are
	// built the same way. Two rows along one edge that disagree read as one row
	// that is crooked.
	const feet = await app.evaluate(`(() => {
		const of = (el) => { const b = el.getBoundingClientRect(); return { height: b.height, middle: (b.top + b.bottom) / 2 }; };
		return { side: of(document.getElementById('foot')), gear: of(document.querySelector('#foot button:last-of-type')), item: of(document.querySelector('#status button')) };
	})()`);
	assert.equal(Math.round(feet.side.height), Math.round(laid.bar.height), "both rows along the window's foot are the same height");
	assert.ok(
		Math.abs(feet.item.middle - feet.gear.middle) <= 1,
		`and what is in them sits on one line: ${Math.round(feet.item.middle - feet.gear.middle)}px between the strip's item and the settings button`,
	);
});

/**
 * The strip is divided where the window is.
 *
 * What is in the strip is about two different things — the note on the left,
 * pi on the right — and a single row of items leaves the reader to find the
 * seam. The seam is the one already on screen: the divider between the two
 * columns. So pi's half of the strip is exactly as wide as pi's column, and
 * the note's half is whatever is left, which is the note's column.
 *
 * Nothing in either half is told where the divider is. The half is given the
 * column's width and the other takes the rest, so the two cannot drift apart —
 * which is what this check is for: it moves the divider (all the way to
 * nothing, and back) and asks whether the strip went with it.
 */
check("the strip's half for pi is as wide as pi's column, and goes where it goes", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "two-halves.md"), "a note with #halves\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="two-halves.md"]')`));
	await pickNote(app, "two-halves.md");
	await until("the note", async () => (await editorStatus(app)) === "saved");

	const laid = () => app.evaluate(`(() => {
		const of = (id) => { const el = document.getElementById(id); if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
		return { agent: of('agent'), note: of('note-status'), column: of('pi'), strip: of('status') };
	})()`);

	const first = await laid();
	assert.ok(first.agent, "the strip has a half for pi");
	// A pixel of tolerance, and it is spent on a real pixel: the columns are
	// laid inside the card's rim and the strip is not.
	assert.ok(
		Math.abs(first.agent.left - first.column.left) <= 1,
		`pi's half begins where pi's column does, and began ${Math.round(first.agent.left - first.column.left)}px off`,
	);
	assert.ok(
		Math.abs(first.note.right - first.agent.left) <= 1,
		`the note's half ends where pi's begins, and ended ${Math.round(first.note.right - first.agent.left)}px off`,
	);
	assert.ok(first.note.left < first.agent.left, "and it is the half on the left");

	// Folded away, pi's column has no width to be as wide as — and this is the
	// one thing in the strip that does not go with it. What the agent is doing
	// is exactly what there is no other way to see once the column is away, so
	// the half stays: folded into its ring, against the window's edge.
	const fold = (label) => app.evaluate(`(() => { const b = document.querySelector('button[aria-label=${JSON.stringify(label)}]'); if (!b) return false; b.click(); return true; })()`);
	const ring = () => app.evaluate(`(() => { const b = document.querySelector('#agent #context-gauge').closest('button').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, width: b.width }; })()`);
	// Somewhere in the note, so that wherever the last check left the pointer it
	// is not left over the ring by chance.
	const elsewhere = async () => {
		const at = await app.evaluate(`(() => { const b = document.getElementById('note').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
		await app.moveTo(at.x, at.y);
	};
	await elsewhere();
	assert.equal(await fold("Hide the agent"), true);
	await until("pi to be away", () => app.evaluate(`!!document.querySelector('button[aria-label="Show the agent"]')`));
	await until("the half to fold into its ring", async () => Math.abs((await laid()).agent.width - (await ring()).width) <= 1);
	const away = await laid();
	assert.ok(
		Math.abs(away.agent.right - first.agent.right) <= 1,
		`it keeps the window's edge, and moved ${Math.round(away.agent.right - first.agent.right)}px off it`,
	);
	assert.ok(away.note.width > first.note.width, "and the note's half has the rest of the strip");

	// Pointed at, the ring opens out into its words — leftwards, the ring staying
	// against the edge — and pointed away from, it folds again.
	const at = await ring();
	await app.moveTo(at.x, at.y);
	await until("the ring to open into its words", async () => (await laid()).agent.width > away.agent.width + 40);
	assert.ok(
		Math.abs((await laid()).agent.right - away.agent.right) <= 1,
		"it opens leftwards, and the ring stays where it was",
	);
	assert.notEqual(await app.evaluate(`document.getElementById('agentLine')?.textContent ?? ''`), "", "and what it opens into says something");
	await elsewhere();
	await until("the ring to fold again", async () => Math.abs((await laid()).agent.width - away.agent.width) <= 1);

	// Pressed, it opens the column: the one thing anybody pointing at the agent
	// with its column away is about to want.
	const pressed = await ring();
	await app.clickAt(pressed.x, pressed.y);
	await until("pi to be back", () => app.evaluate(`!!document.querySelector('button[aria-label="Hide the agent"]')`));
	await elsewhere();
	await until("the strip to follow it back", async () => (await laid()).agent.width > away.agent.width + 40);
	const again = await laid();
	assert.ok(
		Math.abs(again.agent.left - again.column.left) <= 1,
		`pi's half is back under pi's column, ${Math.round(again.agent.left - again.column.left)}px off`,
	);
	assert.ok(
		Math.abs(again.agent.width - first.agent.width) <= 1,
		`and is the width it was: ${Math.round(again.agent.width)}px against ${Math.round(first.agent.width)}px`,
	);
});

check("a link written in the properties is rewritten when the note it names is renamed", async ({ app, cwd }) => {
	// That a tag or a link in the properties is indexed like one in the text is
	// the indexes' own tests' to say (linkIndex, tag): the strip no longer shows
	// either, so there is nothing on screen to ask. What is left to see here is
	// the rename reaching into the property.
	writeFileSync(join(cwd, "prop-tagged.md"), '---\ntags: [Crew]\nrelated: "[[prop-hub]]"\n---\n\nnothing in the text\n');
	writeFileSync(join(cwd, "prop-hub.md"), "the one linked to\n");
	await until("the notes to be listed", () => app.evaluate(`["prop-tagged.md", "prop-hub.md"].every((p) => document.querySelector('#notes button[data-path="' + p + '"]'))`));
	await app.evaluate(`document.querySelector('#notes button[data-path="prop-hub.md"]').click()`);
	await until("the note it names", async () => (await app.evaluate("location.hash")) === "#prop-hub.md" && (await editorStatus(app)) === "saved");
	await retitle(app, "prop-centre");
	await until("the note moved", () => existsSync(join(cwd, "prop-centre.md")));
	await until("the property rewritten", () => readFileSync(join(cwd, "prop-tagged.md"), "utf8").includes('"[[prop-centre]]"'));
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
	await deleteNote(app);
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

check("the + at the row's end makes a new note", async ({ app, cwd }) => {
	// What used to be here as well — a menu at the row's end listing every open
	// tab — went out with f40280d7, and this check went red and stayed red
	// because it was not taken out with it. That is the second time a feature
	// has been removed without its check; the first cost forty-four commits of
	// a suite nobody could read. It is in CI now, which is the answer to it.
	const row = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.path)");
	const tabs = await row();
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

/**
 * The path above a note names the folders it is in, and is the way into them.
 *
 * Both halves are checked here because they are one line: what it shows when
 * the note is buried (the ends, and a "…" for the middle), and what pressing
 * a folder in it does (offers what is in that folder, and opens what is
 * picked — without a trip to the list on the left).
 */
check("the path above a note folds its middle away, and a folder in it opens what is inside", async ({ app, cwd }) => {
	const folder = "book/The Scaling Era/Chapter 1";
	mkdirSync(join(cwd, folder), { recursive: true });
	writeFileSync(join(cwd, `${folder}/translation.md`), "KR\n");
	writeFileSync(join(cwd, `${folder}/notes.md`), "notes\n");
	await pickNote(app, `${folder}/translation.md`);

	// Three folders deep: the outermost and the one it is in, with the one
	// between them behind the "…".
	const crumbs = () => app.evaluate(`[...document.querySelectorAll("[data-crumb]")].map((b) => b.textContent.trim()).join()`);
	await until("the crumbs", async () => (await crumbs()) === "book,Chapter 1");
	assert.ok(await app.evaluate(`!!document.querySelector('[aria-label="Folders in between"]')`), "the middle is folded away, not dropped");

	await app.click(`[data-crumb="${folder}"]`);
	await until("what is in the folder", () => app.evaluate(`!!document.querySelector("[data-slot=command-item]")`));
	await app.shot("crumbs");
	const items = () => app.evaluate(`[...document.querySelectorAll("[data-slot=command-item]")].map((i) => i.textContent.trim())`);
	assert.deepEqual(await items(), ["notes", "translation", "Show in sidebar"], "the folder's notes, and the old way kept");

	// Picking one opens it, which is the whole of the point.
	await app.click(`[data-slot=command-item]`, 0);
	await until("the other note in front", async () => (await app.evaluate(`document.querySelector('#notes button[data-active="true"]')?.dataset.path`)) === `${folder}/notes.md`);
	await until("the list put away", async () => !(await app.evaluate(`!!document.querySelector("[data-slot=command-item]")`)));
});

/**
 * Type "/" in the box and the commands are offered; the keys move through
 * them and take one. What is on the list is pi's — the web search extension
 * registers "curator" — so this runs against the real server, not a bench.
 */
check("typing / in the message box offers pi's commands, and Enter writes the chosen one in", async ({ app }) => {
	const box = () => app.evaluate("document.querySelector('textarea').value");
	const listed = () => app.evaluate("[...document.querySelectorAll('#commands [cmdk-item]')].map((i) => i.textContent)");
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.focus(); t.value = ''; })()");
	await app.keys("/cur");
	await until("the list to narrow to curator", async () => (await listed()).some((t) => t.startsWith("/curator")));
	// Being in the DOM is not being seen: the box clips what is inside it, and
	// a list drawn there once was. The list must be what is under its own middle.
	assert.equal(await app.evaluate(`(() => {
		const item = document.querySelector('#commands [cmdk-item]'); const r = item.getBoundingClientRect();
		return r.height > 0 && item.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
	})()`), true, "the list is on screen, not clipped by the box");
	// Enter takes it rather than sending: the box holds the command and a
	// space for its arguments, and nothing went to pi.
	await app.press("Enter");
	await until("the command written in", async () => (await box()) === "/curator ");
	assert.deepEqual(await listed(), [], "the list has done its part once the word is complete");
	// Escape puts the list away for the text as it stands; typing brings it back.
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.focus(); t.value = ''; })()");
	await app.keys("/");
	await until("every command offered", async () => (await listed()).length > 1);
	await app.press("Escape");
	await until("the list put away", async () => (await listed()).length === 0);
	await app.keys("c");
	await until("the list back", async () => (await listed()).length > 0);
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
});

/**
 * Type "@" anywhere in the box and the notes are offered; the word narrows
 * them and Enter writes the chosen note's path in. Octave's own — pi has this
 * only in its terminal — so what is checked is the whole of it.
 */
check("typing @ in the message box offers the notes, and Enter writes the chosen one's path in", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "mentionable.md"), "# mentionable\n");
	await until("the note to be listed", () => app.evaluate(`!!document.querySelector('#notes button[data-path="mentionable.md"]')`));
	const box = () => app.evaluate("document.querySelector('textarea').value");
	const listed = () => app.evaluate("[...document.querySelectorAll('#mentions [cmdk-item]')].map((i) => i.textContent)");
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.focus(); t.value = ''; })()");
	await app.keys("about @mentio");
	await until("the list to narrow to the note", async () => (await listed()).some((t) => t.startsWith("mentionable")));
	assert.equal(await app.evaluate(`(() => {
		const item = document.querySelector('#mentions [cmdk-item]'); const r = item.getBoundingClientRect();
		return r.height > 0 && item.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
	})()`), true, "the list is on screen, not clipped by the box");
	await app.press("Enter");
	await until("the path written in", async () => (await box()) === "about @mentionable.md ");
	assert.deepEqual(await listed(), [], "the list has done its part once the word is complete");
	// A mention is a word among words: what follows types on, and the list stays away.
	await app.keys("and more");
	assert.deepEqual(await listed(), []);
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
	// A PDF in the folder is offered too, after the notes, with its extension for a title.
	writeFileSync(join(cwd, "mentionable.pdf"), "%PDF-1.4\n");
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.focus(); t.value = ''; })()");
	await app.keys("see @mentionable.p");
	await until("the PDF to be listed", async () => (await listed()).some((t) => t.startsWith("mentionable.pdf")));
	await app.press("Enter");
	await until("the PDF's path written in", async () => (await box()) === "see @mentionable.pdf ");
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
});

/**
 * A PDF in the folder is a row of the tree, where it is on disk, and opens in
 * a tab of its own drawn by pdf.js — with a layer of real text over the page,
 * which is what makes its words choosable. The fixture's words are the check.
 */
check("a PDF in the folder is in the tree, and opens in a tab with its words on the page", async ({ app, cwd }) => {
	mkdirSync(join(cwd, "papers"), { recursive: true });
	writeFileSync(join(cwd, "papers/three pages.pdf"), readFileSync(join(root, "test/fixtures/three-pages.pdf")));
	await pickNote(app, "papers/three pages.pdf");
	await until("the first page's words in the text layer", () => app.evaluate("[...document.querySelectorAll('#page .textLayer')].some((l) => l.textContent.includes('The first page.'))"), 30000);
	assert.equal(await app.evaluate("document.querySelectorAll('#page .pdfViewer .page').length"), 3, "every page has its place");
	assert.equal(await app.evaluate("document.querySelector('#note')"), null, "no editor under it");
	assert.equal(await app.evaluate("document.querySelector('[role=tab][data-state=active]')?.textContent.trim()"), "three pages.pdf", "the tab says its name, extension and all");
	assert.equal(await app.evaluate("document.querySelector('#notes button[data-path=\"papers/three pages.pdf\"]').dataset.active"), "true", "its row is lit");
	assert.equal(await app.evaluate("decodeURIComponent(location.hash)"), "#papers/three pages.pdf", "the address is its path, as a note's is");
	// The page is fitted to the column rather than drawn at its own size.
	const widths = await app.evaluate("(() => { const p = document.querySelector('#page .pdfViewer .page').getBoundingClientRect().width; const c = document.querySelector('#page').getBoundingClientRect().width; return [p, c]; })()");
	assert.ok(widths[0] > widths[1] * 0.8 && widths[0] <= widths[1], `the page fits the column: ${widths}`);
	// Reloaded at that address, it comes back as it was.
	await app.evaluate("location.reload()");
	await until("the words again after a reload", () => app.evaluate("[...document.querySelectorAll('#page .textLayer')].some((l) => l.textContent.includes('The first page.'))"), 30000);
});

/**
 * `[[paper.pdf#page=2]]`, as Obsidian writes it: the link is a link to
 * something that is there, ⌘-click opens the document at that page, another
 * link to another page moves the document already open, and neither it nor a
 * link to a document that is not there makes a note called "….pdf". Embedded
 * with `!`, it is not drawn as a note that could not be found.
 */
check("a link to a page of a PDF opens it there, and never makes a note of its name", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "linked.pdf"), readFileSync(join(root, "test/fixtures/three-pages.pdf")));
	writeFileSync(join(cwd, "cites.md"), "See [[linked.pdf#page=2]] and [[linked.pdf#page=3]].\n\nNot here: [[gone.pdf]].\n\n![[linked.pdf#page=2]]\n\nThe end.\n");
	await pickNote(app, "cites.md");
	await until("the links drawn: two found, one missing, and the embed's", async () => (await app.evaluate("[...document.querySelectorAll('#editor .cm-wikilink')].map((l) => l.classList.contains('cm-wikilink-missing') ? 'x' : 'o').join('')")) === "ooxo");
	assert.equal(await app.evaluate("document.querySelectorAll('#editor .cm-embed').length"), 0, "no card for a document");
	const current = () => app.evaluate("(() => { const pages = [...document.querySelectorAll('#page .pdfViewer .page')]; const top = document.querySelector('#page > div')?.getBoundingClientRect().top ?? 0; const at = pages.find((p) => p.getBoundingClientRect().bottom > top + 40); return at ? Number(at.dataset.pageNumber) : 0; })()");
	await app.click("#editor .cm-wikilink", 0, { meta: true });
	await until("the document, at its second page", async () => (await app.evaluate("document.querySelector('#page')?.dataset.document ?? ''")) === "linked.pdf" && (await current()) === 2, 30000);
	// Back to the note, and the other link: the same tab, moved to the third page.
	await pickNote(app, "cites.md");
	await until("the note again", () => app.evaluate("!!document.querySelector('#editor .cm-wikilink')"));
	await app.click("#editor .cm-wikilink", 1, { meta: true });
	await until("the third page", async () => (await app.evaluate("document.querySelector('#page')?.dataset.document ?? ''")) === "linked.pdf" && (await current()) === 3, 30000);
	await pickNote(app, "cites.md");
	await until("the note once more", () => app.evaluate("!!document.querySelector('#editor .cm-wikilink-missing')"));
	await app.click("#editor .cm-wikilink-missing", 0, { meta: true });
	await new Promise((r) => setTimeout(r, 500));
	assert.deepEqual(readdirSync(cwd).filter((f) => /\.pdf\.md$|^gone/.test(f)), [], "no note made of a document's name");
	assert.equal(await app.evaluate("document.querySelector('[role=tab][data-state=active]')?.textContent.trim()"), "cites", "and the note is still what is open");
});

/**
 * Words dragged across in a PDF are chosen the way words in a note are: they
 * show above the box with their page, stay there when the box is clicked into
 * — which empties the browser's selection, the one thing a note's editor does
 * not do — and go beside the message, not in it.
 */
check("words dragged across in a PDF show above the box with their page, and go beside the message", async ({ app, cwd }) => {
	writeFileSync(join(cwd, "chosen from.pdf"), readFileSync(join(root, "test/fixtures/three-pages.pdf")));
	await pickNote(app, "chosen from.pdf");
	await until("the second page's words", () => app.evaluate("[...document.querySelectorAll('#page .textLayer span')].some((s) => s.textContent.includes('Page two'))"), 30000);
	await app.evaluate("[...document.querySelectorAll('#page .textLayer span')].find((s) => s.textContent.includes('Page two')).scrollIntoView({ block: 'center' })");
	await app.evaluate("[...document.querySelectorAll('#page .textLayer span')].find((s) => s.textContent.includes('Page two')).setAttribute('data-e2e', 'two')");
	assert.equal(await app.drag("#page .textLayer span[data-e2e=two]"), true);
	const chip = () => app.evaluate("document.getElementById('chosen')?.textContent ?? ''");
	// The whole of what was dragged across, under its page: the selection grows as the pointer moves, and the chip follows it.
	await until("the chip with the page and the words", async () => (await chip()) === "p. 2Page two says hello.");
	// Into the box to ask: the browser lets go of the selection, the words stay.
	await app.click("textarea");
	await new Promise((r) => setTimeout(r, 300));
	assert.match(await chip(), /^p\. 2/, "clicking into the box does not take them away");
	// What goes out: the words and the page beside the message, the PDF as what is in front.
	await app.evaluate("(() => { window.__sent = []; const send = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { window.__sent.push(d); return send.call(this, d); }; })()");
	await app.keys("what does this mean");
	await app.press("Enter");
	const prompt = await until("the prompt to go", async () => (await app.evaluate("window.__sent.map((d) => JSON.parse(d)).find((m) => m.type === 'prompt') ?? null")));
	assert.equal(prompt.text, "what does this mean", "the message is only what was typed");
	assert.equal(prompt.note, "chosen from.pdf");
	assert.equal(prompt.page, "2");
	assert.match(prompt.chosen, /Page two says hello/);
	// A click on the pages unchooses, as it does anywhere.
	const blank = await app.evaluate("(() => { const r = document.querySelector('#page .textLayer span[data-e2e=two]').getBoundingClientRect(); return [r.left + 20, r.bottom + 80]; })()");
	await app.clickAt(blank[0], blank[1]);
	await until("the chip to go", async () => (await chip()) === "");
});

/**
 * A PDF dropped on the message box goes into the folder and is named in the
 * message. The drop is a real DragEvent carrying a real File, so what is
 * checked is the whole path: the box, the door, the disk, the list.
 */
check("a PDF dropped on the message box is put in attachments/ and named in the message", async ({ app, cwd }) => {
	const box = () => app.evaluate("document.querySelector('textarea').value");
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.focus(); t.value = 'about'; t.setSelectionRange(5, 5); t.dispatchEvent(new Event('input', { bubbles: true })); })()");
	await app.evaluate(`(() => {
		const data = new DataTransfer();
		data.items.add(new File([new TextEncoder().encode("%PDF-1.4 dropped")], "dropped here.pdf", { type: "application/pdf" }));
		document.querySelector('textarea').dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
	})()`);
	await until("the path written in", async () => (await box()) === "about @attachments/dropped here.pdf ");
	assert.equal(readFileSync(join(cwd, "attachments/dropped here.pdf"), "utf8"), "%PDF-1.4 dropped", "the bytes are in the folder");
	assert.equal(await app.evaluate("document.querySelector('#adding') === null"), true, "the line saying so is gone once it is there");
	assert.equal(await app.evaluate("document.querySelector('#attached') === null"), true, "it is not an image riding with the message");
	// A kind the folder does not take is refused, in the conversation, and nothing is written in.
	await app.evaluate(`(() => {
		const data = new DataTransfer();
		data.items.add(new File(["x"], "script.sh", { type: "text/x-sh" }));
		document.querySelector('textarea').dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
	})()`);
	await until("the refusal said", () => app.evaluate("document.body.innerText.includes('Could not add script.sh')"));
	assert.equal(await box(), "about @attachments/dropped here.pdf ");
	await app.evaluate("(() => { const t = document.querySelector('textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
});

check("the loadout screen keeps a model pi does not offer, and shows a change another window made", async ({ app, api }) => {
	const url = `http://localhost:${api}/api/settings`;
	const post = (patch) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
	const stored = async () => (await (await fetch(url)).json()).loadout.join(",");
	const [a, b] = await (await fetch(`http://localhost:${api}/api/models`)).json();
	assert.ok(a && b, "pi offers two models to choose from");
	// A provider signed out since it was chosen: in the file, and not among what pi offers.
	const gone = "nobody/not-offered";
	assert.equal((await post({ loadout: [gone, a.key, b.key] })).status, 200);

	const places = () => app.evaluate("[...document.querySelectorAll('[role=dialog] ol li')].map((li) => li.textContent).join(' | ')");
	try {
		assert.ok(await app.click('button[aria-label="Settings"]'), "the settings button is there");
		const section = await until("the Loadout section", () =>
			app.evaluate("(() => { const i = [...document.querySelectorAll('[role=dialog] nav button')].findIndex((x) => x.textContent === 'Loadout'); return i < 0 ? null : String(i); })()"),
		);
		// Pressed until it takes. The dialog grows into place as it opens, and on a
		// slow machine a button measured partway there is somewhere else by the
		// time the press lands: twice today GitHub's runner left this on Accounts,
		// the section the dialog opens on, and the check waited for a list that
		// was never on screen. Pressing the section it is already on does nothing.
		await until("the Loadout section in front", async () => {
			await app.click("[role=dialog] nav button", Number(section));
			return app.evaluate("/Reading the models|could not read the models/.test(document.querySelector('[role=dialog]')?.innerText ?? '') || !!document.querySelector('[role=dialog] ol')");
		});
		// Says what the list held when it gives up: this one has failed on GitHub's
		// runner, one run in three, and "timed out" is all it had to say for itself.
		await until("the missing model in its place", async () => {
			const seen = await places();
			if (/^1nobody\/not-offeredNot available/.test(seen)) return true;
			throw new Error(`the places read ${JSON.stringify(seen)}, the file ${JSON.stringify(await stored())}, the dialog ${JSON.stringify(await app.evaluate("(document.querySelector('[role=dialog]')?.innerText ?? 'no dialog').slice(0, 300)"))}`);
		});
		await app.shot("loadout-missing");

		// An edit that has nothing to do with it leaves it where it was.
		assert.ok(await app.click(`button[aria-label=${JSON.stringify(`Take out ${b.name}`)}]`), "the second model can be taken out");
		await until("the file without the one taken out, and with the missing one", async () => (await stored()) === [gone, a.key].join(","));
		assert.equal((await places()).split(" | ").length, 2 + 3, "two places and three empty");

		// Another window changes the order; this one shows it without being reopened.
		assert.equal((await post({ loadout: [a.key, gone] })).status, 200);
		await until("the other window's order", async () => (await places()).startsWith(`1${a.name}`));
	} finally {
		await app.press("Escape");
		await post({ loadout: [] });
	}
});

check("a version ready to install is offered in the corner, × leaves a dot, About answers a check, and a new version opens What's new", async ({ app }) => {
	// The shell's bridge, stood in for: the page is served to a browser here,
	// where there is no window.pi. What the stub is told is what the page is
	// told, and what the page asks of it is written down.
	let bodyDone = false;
	// Installed only while sessionStorage says so: the checks after this one
	// are of a browser, and a script on new documents outlives its removal
	// through a reload.
	const stopStanding = await app.onNewDocument(`
		if (sessionStorage.getItem("stand-in-for-the-shell") === "1") {
		window.__update = { listeners: [], calls: [], opens: [], pages: [], state: { current: "0.0.3", phase: "idle", version: null, progress: null, error: null, justUpdated: null },
			say(patch) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(this.state); } };
		// The rest of the bridge too, as the shell has it: the page reads the folder off it when it is there.
		window.pi = { folders: async () => ({ current: null, recent: [] }), choose: async () => {}, open: async () => {}, reveal: async () => {}, update: {
			state: async () => window.__update.state,
			onState: (l) => { window.__update.listeners.push(l); return () => {}; },
			check: async () => window.__update.calls.push("check"),
			restart: async () => window.__update.calls.push("restart"),
			seen: async () => window.__update.calls.push("seen"),
		}, onOpenSettings: (l) => { window.__update.opens.push(l); return () => {}; }, onOpenPage: (l) => { window.__update.pages.push(l); return () => {}; } };
		}`);
	try {
		await app.evaluate(`sessionStorage.setItem("stand-in-for-the-shell", "1"); location.reload()`);
		// window.pi is an element of that id once the page has drawn (the agent's
		// column), so it is the stub itself that is looked for.
		await until("the page back, with the stub", async () => {
			const seen = await app.evaluate("JSON.stringify({ stub: !!window.__update, sidebar: !!document.querySelector('#notes button[data-path=\"first.md\"]'), body: document.body.innerText.slice(0, 80) })");
			if (seen.startsWith('{"stub":true,"sidebar":true')) return true;
			throw new Error(`${seen} errors=${JSON.stringify(app.errors.slice(-1))}`);
		});
		assert.equal(await app.evaluate("document.querySelectorAll('[data-sonner-toast]').length"), 0, "nothing offered while nothing is ready");

		await app.evaluate(`window.__update.say({ phase: "ready", version: "9.9.9", progress: 100 })`);
		const toast = () => app.evaluate("document.querySelector('[data-sonner-toast]')?.innerText ?? ''");
		await until("the offer", async () => (await toast()).includes("Octave 9.9.9 is ready"));
		assert.match(await toast(), /Restart/, "with a Restart");
		const laid = await app.evaluate(`(() => { const r = document.querySelector('[data-sonner-toast]').getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom }; })()`);
		assert.ok(laid.right < 60 && laid.bottom < 60, `in the bottom-right corner, not ${JSON.stringify(laid)}`);

		// Restart asks the shell, and the offer stays where it is meanwhile. The
		// toast slides in; a press before it has come to rest lands where it was.
		await until("the toast at rest", () => app.evaluate("document.querySelector('[data-sonner-toast]')?.getAttribute('data-mounted') === 'true'"));
		await new Promise((r) => setTimeout(r, 500));
		await app.shot("update-offer");
		assert.ok(await app.click("[data-sonner-toast] button[data-button]"), "the Restart button is there");
		await until("the restart asked of the shell", async () => {
			if (await app.evaluate("window.__update.calls.includes('restart')")) return true;
			throw new Error(await app.evaluate("JSON.stringify({ calls: window.__update.calls, buttons: [...document.querySelectorAll('[data-sonner-toast] button')].map((b) => b.outerHTML.slice(0, 160)) })"));
		});

		// Waved away: gone from the corner, a dot on the settings button, and not back for this version.
		assert.ok(await app.click("[data-sonner-toast] [data-close-button]"), "the × is there");
		await until("the corner empty", async () => (await toast()) === "");
		await until("the dot", () => app.evaluate("!!document.querySelector('button[aria-label=\"Settings\"] [aria-label=\"An update is ready\"]')"));
		await app.evaluate(`window.__update.say({ phase: "ready", version: "9.9.9", progress: 100 })`);
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await toast(), "", "the same version, said again, is not offered again");
		// A newer one is.
		await app.evaluate(`window.__update.say({ phase: "ready", version: "9.9.10", progress: 100 })`);
		await until("the newer offer", async () => (await toast()).includes("9.9.10"));
		await app.click("[data-sonner-toast] [data-close-button]");

		// Settings › About: the version this is, and the one place a check's
		// answer is given. The menu's Check for Updates… opens it.
		await app.evaluate(`window.__update.say({ phase: "idle", version: null, progress: null })`);
		await app.evaluate("window.__update.opens.forEach((l) => l('About'))");
		const about = () => app.evaluate("document.querySelector('[role=dialog]')?.innerText ?? ''");
		await until("About open, saying the version", async () => (await about()).includes("Octave 0.0.3"));
		await until("no answer before a check was asked for", async () => /looks for a new version/.test(await about()));
		assert.ok(await app.click("[role=dialog] button:not([data-close-button])", await app.evaluate("[...document.querySelectorAll('[role=dialog] button')].findIndex((b) => b.textContent === 'Check for Updates')")), "the Check button");
		await until("the check asked of the shell", () => app.evaluate("window.__update.calls.filter((c) => c === 'check').length === 1"));
		await app.evaluate(`window.__update.say({ phase: "checking" })`);
		await until("checking", async () => (await about()).includes("Checking…"));
		await app.evaluate(`window.__update.say({ phase: "idle" })`);
		await until("the latest", async () => (await about()).includes("0.0.3 is the latest"));
		await app.evaluate(`window.__update.say({ phase: "downloading", version: "9.9.11", progress: 40 })`);
		await until("the download's progress", async () => (await about()).includes("Downloading 9.9.11 — 40%"));
		await app.evaluate(`window.__update.say({ phase: "ready", version: "9.9.11", progress: 100 })`);
		await until("ready, with a Restart of its own", async () => /9\.9\.11 is ready\.\s*Restart/.test(await about()));
		await app.evaluate(`window.__update.say({ phase: "idle", version: null, progress: null, error: "boom" })`);
		await until("could not check", async () => (await about()).includes("Could not check right now"));
		await app.press("Escape");
		await until("Settings away", async () => (await about()) === "");

		// The first run of a new version: a tab with what is new, from the
		// changelog beside the server, and the shell told it has been seen.
		await app.evaluate(`window.__update.say({ justUpdated: { from: "0.0.2", to: "0.0.3" } })`);
		const tabs = () => app.evaluate("[...document.querySelectorAll('[role=tab]')].map((t) => t.textContent).join('|')");
		await until("the What's new tab, in front", async () => (await tabs()).includes("What's new in 0.0.3") && (await app.evaluate("document.querySelector('[role=tab][data-state=active]')?.textContent ?? ''")).includes("What's new"));
		const page = () => app.evaluate("document.getElementById('page')?.innerText ?? ''");
		await until("the notes, from the changelog", async () => /What's new in 0\.0\.3[\s\S]*CHANGED[\s\S]*PowerShell/.test(await page()));
		await until("the shell told it was seen", () => app.evaluate("window.__update.calls.includes('seen')"));
		assert.equal(await app.evaluate("!!document.querySelector('#editor .cm-content')"), false, "no editor under a page");
		await app.shot("whats-new");

		// Closed like any tab; asked for from Help, back again.
		await app.press("w", { meta: true });
		await until("the tab closed", async () => !(await tabs()).includes("What's new"));
		await app.evaluate("window.__update.pages.forEach((l) => l('whats-new'))");
		await until("the tab back, from Help", async () => (await tabs()).includes("What's new in 0.0.3"));
		await app.press("w", { meta: true });
		await until("the tab closed again", async () => !(await tabs()).includes("What's new"));

		bodyDone = true;
	} finally {
		await stopStanding();
		await app.evaluate(`sessionStorage.removeItem("stand-in-for-the-shell"); location.reload()`);
		await until("the page back as a browser", async () => {
			const seen = await app.evaluate("JSON.stringify({ stub: !!window.__update, bridge: !!window.pi?.update, sidebar: !!document.querySelector('#notes button[data-path=\"first.md\"]'), body: document.body.innerText.slice(0, 80) })");
			if (seen.startsWith('{"stub":false,"bridge":false,"sidebar":true')) return true;
			throw new Error(`${seen} bodyDone=${bodyDone} errors=${JSON.stringify(app.errors.slice(-1))}`);
		});
		// A reload comes back with no note open; the checks after this one expect one.
		await app.evaluate(`document.querySelector('#notes button[data-path="first.md"]').click()`);
		await until("a note open again", () => app.evaluate("!!document.querySelector('#editor .cm-content')"));
	}
});

check("a spec opens in the editor by its address, keeps no record of who wrote it, follows the agent's writes and does not write over them", async ({ app, cwd }) => {
	// Who wrote what, turned on over a note first: it stays on across notes, and
	// a spec has no one to ask about — asked as a note, the answer is "gone".
	writeFileSync(join(cwd, "beside-spec.md"), "mine and pi's\n");
	mkdirSync(join(cwd, ".pi/history"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi/history/beside-spec.md.jsonl"),
		[
			{ author: "me", at: Date.now() - 60_000, from: 0, to: 0, inserted: "mine and ", removed: "" },
			{ author: "pi", at: Date.now() - 30_000, sessionId: "s", entryId: "e", from: 9, to: 9, inserted: "pi's\n", removed: "" },
		]
			.map((c) => JSON.stringify(c))
			.join("\n") + "\n",
	);
	await app.evaluate(`location.hash = "#beside-spec.md"`);
	await until("the share", () => app.evaluate("!!document.getElementById('authored')"));
	const at = await app.evaluate("(() => { const b = document.getElementById('authored').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
	await app.moveTo(at.x, at.y);
	await until("the card with the switch", () => app.evaluate("!!document.getElementById('whoWrote')"));
	if ((await app.evaluate("document.getElementById('whoWrote').getAttribute('aria-checked')")) !== "true") assert.equal(await app.click("#whoWrote"), true);
	await until("the marks", () => app.evaluate("document.querySelectorAll('#editor .cm-by-pi').length > 0"));
	await app.moveTo(1, 1);
	await until("the card gone", async () => !(await app.evaluate("!!document.getElementById('whoWrote')")));

	// What a note carries at its head and at the foot of the window, for the
	// comparison below: a spec carries neither.
	assert.equal(await app.evaluate("!!document.getElementById('add-property')"), true, "a note is offered properties");
	assert.equal(await app.evaluate("!!document.getElementById('count')"), true, "and its length is in the strip");

	const path = ".octave/specs/e2e/requirements.md";
	mkdirSync(join(cwd, ".octave/specs/e2e"), { recursive: true });
	writeFileSync(join(cwd, path), "# Requirements\n\nfirst\n");
	await app.evaluate(`location.hash = ${JSON.stringify(`#${path}`)}`);
	await until("the spec's text", async () => (await editorText(app)).includes("first"));
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await editorStatus(app), "saved", "not taken for a note that is gone");
	assert.equal(await app.evaluate("!!document.getElementById('authored')"), false, "no share: nothing in a spec is counted as anyone's");

	// Its name is a place in the spec, not a title: shown, not changed — and
	// its menu has what points at it, and not the note's Rename or Delete.
	assert.equal(await app.evaluate("document.getElementById('title').value"), "requirements");
	assert.equal(await app.evaluate("document.getElementById('title').readOnly"), true);
	// And none of the note's own furniture: a spec is in none of the lists
	// properties are for, and how many words are in it says nothing about it.
	assert.equal(await app.evaluate("!!document.getElementById('add-property')"), false, "no properties on a spec");
	assert.equal(await app.evaluate("!!document.getElementById('count')"), false, "no word count on a spec");
	await app.click("#noteMenu");
	await until("the menu", () => app.evaluate("!!document.querySelector('[role=menu] [role=menuitem]')"));
	const items = await app.evaluate("[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((i) => i.textContent.trim())");
	assert.ok(items.includes("Copy path") && !items.includes("Rename") && !items.includes("Delete"), `the spec's items, got ${items.join()}`);
	await app.press("Escape");
	await until("the menu gone", async () => !(await app.evaluate("!!document.querySelector('[role=menu]')")));

	// Typed: down to the disk, and no log beside it.
	assert.equal(await type(app, "TYPED "), true);
	await until("the save to land", async () => (await editorStatus(app)) === "saved" && readFileSync(join(cwd, path), "utf8").includes("TYPED"));
	assert.equal(existsSync(join(cwd, ".pi/history", `${path}.jsonl`)), false, "who wrote it is not recorded");

	// The agent writes it: the tab follows, with nothing to decide.
	writeFileSync(join(cwd, path), "# Requirements\n\nthe agent's\n");
	await until("the agent's words", async () => (await editorText(app)).includes("the agent's") && (await editorStatus(app)) === "saved");
	assert.equal(await app.evaluate("!!document.querySelector('#editor [role=alert]')"), false, "nothing was typed, so nothing to put to anyone");

	// The agent writes under typing: put to the person, and nothing written over.
	writeFileSync(join(cwd, path), "# Requirements\n\nthe agent's again\n");
	assert.equal(await type(app, "MORE "), true);
	await until("the refusal", async () => (await editorStatus(app)) === "conflict");
	assert.ok((await app.evaluate("document.querySelector('#editor [role=alert]')?.textContent ?? ''")).includes("changed on disk"));
	assert.equal(readFileSync(join(cwd, path), "utf8"), "# Requirements\n\nthe agent's again\n", "the agent's words are still there");
	await app.evaluate(`[...document.querySelectorAll('#editor [role=alert] button')].find((b) => b.textContent === "Reload").click()`);
	await until("the disk's text", async () => (await editorStatus(app)) === "saved" && (await editorText(app)).includes("the agent's again"));
});

// What the person has to read before anything else can happen: written by the
// agent, waiting for their approval, and in front of them without being asked
// for. The state is the files, so this writes them as the agent would.
check("a spec's document comes to the front as it starts waiting, and stays closed once closed", async ({ app, cwd }) => {
	const dir = join(cwd, ".octave/specs/waiting");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "requirements.md"), "# Requirements\n\nWAITINGWORD\n");
	await until("the requirements in front", async () => (await editorText(app)).includes("WAITINGWORD"));

	// Closed, and written again while it is still the one waiting: it stays shut.
	await app.press("w", { meta: true });
	await until("the tab closed", async () => !(await editorText(app)).includes("WAITINGWORD"));
	writeFileSync(join(dir, "requirements.md"), "# Requirements\n\nWAITINGWORD, again\n");
	await new Promise((r) => setTimeout(r, 800));
	assert.equal((await editorText(app)).includes("WAITINGWORD"), false, "what was closed does not come back");

	// Approved — which writes the record beside the documents and nothing else
	// — and the design written on it: that one is waiting now, so it opens.
	approve(cwd, "waiting");
	writeFileSync(join(dir, "design.md"), "# Design\n\nDESIGNWORD\n");
	await until("the design in front", async () => (await editorText(app)).includes("DESIGNWORD"));
	await app.press("w", { meta: true });
	await until("the tab closed", async () => !(await editorText(app)).includes("DESIGNWORD"));
});

// The control at the start of the row: what is waiting, from anywhere, and the
// approval that would otherwise be a command typed into the box. By now the
// folder holds other specs from the checks above, which is the case worth
// having — the one that is waiting and newest is the one it names.
check("the spec at the start of the row names what is waiting, opens its documents and approves them", async ({ app, cwd }) => {
	const dir = join(cwd, ".octave/specs/menu");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "requirements.md"), "# Requirements\n\nMENUWORD\n");
	const button = () => app.evaluate("document.getElementById('spec')?.textContent ?? ''");
	await until("the newest spec named", async () => (await button()).includes("menu") && (await button()).includes("Requirements waiting"));
	assert.equal(await app.evaluate("document.getElementById('spec').dataset.standing"), "waiting");

	// It opened by itself (specTabs.ts); closed, the menu is the way back.
	await app.press("w", { meta: true });
	await until("the tab closed", async () => !(await editorText(app)).includes("MENUWORD"));
	await app.click("#spec");
	await until("the menu", () => app.evaluate("!!document.querySelector('[role=menu] [role=menuitem]')"));
	const standings = () =>
		app.evaluate("[...document.querySelectorAll('[role=menu] [data-spec=\"menu\"]')].map((i) => i.dataset.doc + ':' + i.dataset.standing).join(',')");
	assert.equal(await standings(), "requirements.md:waiting,design.md:unwritten,tasks.md:unwritten");
	assert.equal(
		await app.evaluate("document.querySelector('[role=menu] [data-spec=\"menu\"][data-doc=\"design.md\"]').getAttribute('aria-disabled')"),
		"true",
		"a document the agent has not written cannot be opened",
	);
	await app.evaluate("document.querySelector('[role=menu] [data-spec=\"menu\"][data-doc=\"requirements.md\"]').click()");
	await until("the document back", async () => (await editorText(app)).includes("MENUWORD"));

	// Approved from the menu: the same command, and the record it writes.
	await app.click("#spec");
	await until("the approval offered", () =>
		app.evaluate("document.querySelector('[role=menu] [data-approve=\"menu\"]')?.getAttribute('aria-disabled') !== 'true'"));
	await app.evaluate("document.querySelector('[role=menu] [data-approve=\"menu\"]').click()");
	await until("the record on disk", () => {
		const file = join(dir, "approvals.json");
		return existsSync(file) && JSON.parse(readFileSync(file, "utf8"))["requirements.md"]?.length === 1;
	});
	// And the window hears it from the folder, as it heard the document: the
	// menu is open while it changes under the pointer.
	await app.click("#spec");
	await until("the menu again", () => app.evaluate("!!document.querySelector('[role=menu] [role=menuitem]')"));
	await until("the approval in the menu", async () => (await standings()) === "requirements.md:approved,design.md:unwritten,tasks.md:unwritten");
	assert.equal(await app.evaluate("!!document.querySelector('[role=menu] [data-approve=\"menu\"]')"), false, "nothing of this spec is waiting now");
	// Away, so the check after this one does not read a page with a menu over it.
	await app.press("Escape");
	await until("the menu gone", async () => !(await app.evaluate("!!document.querySelector('[role=menu]')")));
});

// The other place the answer can be given: over the document being read.
check("a document waiting for approval says so above itself, and the line goes once it is approved", async ({ app, cwd }) => {
	const dir = join(cwd, ".octave/specs/bar");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "requirements.md"), "# Requirements\n\nBARWORD\n");
	await until("the document in front with its line", async () => (await editorText(app)).includes("BARWORD") && (await app.evaluate("!!document.getElementById('specBar')")));
	assert.match(await app.evaluate("document.getElementById('specBar').textContent"), /Requirements waiting for your approval/);

	// About the document in front, not about the folder: on a note, nothing.
	await pickNote(app, "first.md");
	await until("the line gone", async () => !(await app.evaluate("!!document.getElementById('specBar')")));

	// Back to it, and answered from the line itself.
	await app.evaluate(`location.hash = ${JSON.stringify("#.octave/specs/bar/requirements.md")}`);
	await until("the button ready", () => app.evaluate("document.getElementById('approveSpec')?.disabled === false"));
	assert.equal(await app.click("#approveSpec"), true);
	await until("the record on disk", () => existsSync(join(dir, "approvals.json")));
	await until("the line gone once it is approved", async () => !(await app.evaluate("!!document.getElementById('specBar')")));
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

check("the bench draws a question where the app does, and says what it was answered with", async ({ bench }) => {
	await bench.click("#asking");
	const questions = await until("the questions", () =>
		bench.evaluate("[...document.querySelectorAll('[role=option]')].map((o) => o.dataset.question).join(',')"),
	);
	for (const id of ["confirm", "select", "multiselect", "input", "editor", "batch"]) {
		assert.ok(questions.split(",").includes(id), `the bench is missing the ${id} question`);
	}
	await bench.click('[data-question="confirm"]');
	// Not `answer`: the bench keeps the question up, having nothing to dismiss it.
	await until("the question", () => bench.evaluate(`!!${choiceOf("Yes")}`));
	await bench.evaluate(`${choiceOf("Yes")}.querySelector('input').click()`);
	await bench.evaluate("document.querySelector('#question [data-slot=questionnaire-submit]').click()");
	await until("what it was answered with", async () => (await bench.evaluate("document.getElementById('answered')?.textContent")) === "true");
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
	// Its own settings directory too, since the server writes a log into one and
	// a test run has no business in the log the person's own app keeps.
	const appDir = mkdtempSync(join(tmpdir(), "pi-e2e-app-"));
	// And its own pi: a folder with a key in it that is not a key. pi lists a
	// provider's models for a key it has not tried, which is all the suite
	// needs — no check spends a call. Without this the suite ran on whatever
	// the machine was signed in to, and on GitHub's runner that is nothing:
	// the app, rightly, opens Settings on Accounts when nobody is signed in,
	// and every click after that landed on the dialog. It passed on a laptop
	// and had not finished on the runner for a day. Set here, before a session
	// is written, so the session and the server agree on where pi lives.
	const agentDir = mkdtempSync(join(tmpdir(), "pi-e2e-agent-"));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "sk-e2e-not-a-key" } }));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const sessionFile = branchedSession(cwd);
	// Two notes and a file that is not one, for the sidebar to sort out.
	mkdirSync(join(cwd, "ideas"));
	writeFileSync(join(cwd, "ideas", "second.md"), "# second\n");
	writeFileSync(join(cwd, "first.md"), "# first\n");
	writeFileSync(join(cwd, "not-a-note.txt"), "no\n");
	// The folder Octave opens is a repository (docs/spec-mode), which is what
	// puts the rest of its files in ⌘P and lets a tab read one: repoFiles.ts
	// asks git, and a folder that is in none has nothing to offer.
	writeFileSync(join(cwd, "tool.ts"), "// what it answers\nexport const answer = 42;\n");
	execFileSync("git", ["init", "-q"], { cwd });
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
		start("server", bin("tsx"), ["server.ts"], { WORKDIR: cwd, PORT: String(api), APP_DIR: appDir });
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

		// Answering at all, not answering 200. The page comes from vite below; the
		// api server is here for its socket, and asking it for / asks whether the
		// client has been built — which is nothing to do with whether it is up, and
		// is false on a fresh checkout. That made this wait for thirty seconds and
		// then blame the server on a runner that had simply never run the bundler.
		await until("the api server", () => fetch(`http://localhost:${api}/`).then(() => true, () => false));
		await until("the dev server", () => fetch(`http://localhost:${web}/`).then((r) => r.ok));
		await until("the browser", () => fetch(`http://localhost:${devtools}/json/version`).then((r) => r.ok));

		page = await openPage(devtools, `http://localhost:${web}/`);
		bench = await openPage(devtools, `http://localhost:${web}/gallery.html`);

		// Open the branched session. The answer reaches the page's own socket,
		// because the server publishes a snapshot to everyone connected.
		//
		// Asked again until it answers, rather than once with two and a half
		// seconds to do it in. That window is plenty on a machine that has the
		// page warm and vite's dependencies already bundled, and it is not on a
		// cold runner, where the first load sets the optimiser going and the
		// page reloads out from under whatever was listening. One shot at the
		// setup is one shot at every check after it.
		await until("the conversation", () => page.evaluate("!!document.getElementById('chat')"));
		const ask = () => page.evaluate(`new Promise((done) => {
			const seen = [];
			const socket = new WebSocket("ws://" + location.host + "/ws");
			socket.onmessage = (e) => { const m = JSON.parse(e.data); seen.push(m.type === "error" ? "error: " + m.message : m.type === "snapshot" ? "snapshot(" + m.items.length + ")" : m.type); };
			socket.onopen = () => socket.send(JSON.stringify({ type: "resume_session", path: ${JSON.stringify(sessionFile)} }));
			setTimeout(() => { socket.close(); done(seen.join(",")); }, 2500);
		})`);
		// What the server said back, so a failure here is about the session and
		// not about the browser. Everything after this is about the browser.
		let opened = "";
		try {
			await until("the branched session", async () => /snapshot\([1-9]/.test((opened = await ask())));
		} catch {
			// Fall through to the message below, which says what it answered.
		}
		if (!/snapshot\([1-9]/.test(opened)) {
			throw new Error(`the branched session did not open — the server answered: ${opened}`);
		}

		let failed = 0;
		const running = chosen();
		if (only) console.log(`  (only the ${running.length} of ${checks.length} checks whose names hold ${JSON.stringify(only)})`);
		// A check that fails is run once more before it counts. The suite drives a
		// real browser with real presses, and on a shared runner a press now and
		// then lands a frame early — today a different check each run, one or two
		// in ninety, none of them twice. A second go is what Playwright's
		// `retries` is for and says the same thing here: red twice is the app or
		// the check; red then green is the weather, and is said so by name rather
		// than passed over, so a check that is always on its second try shows.
		const again = [];
		const said = (error) => `       ${(error.message ?? error).toString().split("\n").join("\n       ")}`;
		for (const { name, run } of running) {
			try {
				await run({ app: page, bench, cwd, api, devtools });
				console.log(`  ok  ${name}`);
			} catch (first) {
				try {
					await run({ app: page, bench, cwd, api, devtools });
					again.push(name);
					console.log(`  ok  ${name}  (on a second try)`);
					console.log(said(first));
				} catch (error) {
					failed++;
					console.log(`  FAIL ${name}`);
					console.log(said(error));
					// The first go's reason too: the second may only have found what the first left behind.
					console.log(`       (first try: ${(first.message ?? first).toString().split("\n")[0]})`);
				}
			}
		}

		console.log(`\n${running.length - failed}/${running.length} passed`);
		if (again.length) {
			console.log(`${again.length} of them on a second try:\n${again.map((name) => `  - ${name}`).join("\n")}`);
			// Seen on the run's summary page, not only by whoever opens the log.
			if (process.env.GITHUB_ACTIONS) for (const name of again) console.log(`::warning title=e2e passed on a second try::${name}`);
		}
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
		for (const path of [cwd, profile, appDir, agentDir, sessionDir]) {
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
