/**
 * The terminal under the note: xterm drawing the shell the server keeps
 * for this workspace (pty/terminal.ts), over the socket in pty.ts.
 *
 * Mounted once and kept: folding the panel leaves it at no height rather
 * than unmounting it, so the scrollback and the shell's screen are there
 * when it opens again, and xterm is only ever made once for the page —
 * React's development double-mount included, which the ref guards. It is
 * fitted to its box only once the box has a size: fitting at no height
 * gives xterm no columns to speak of, and the first fit is also what
 * tells the shell its size before its first prompt. What the shell prints
 * is drawn and then acknowledged, in bytes, which is what paces a shell
 * that prints faster than the window draws (pty/flow.ts).
 *
 * Keys with ⌘ on them are the window's, not the shell's: ⌘K, ⌘P, ⌘E, ⌘W,
 * ⌘\, ⌘B and the rest keep doing what they do with the cursor in here,
 * and ⌘C and ⌘V are the browser's copy and paste, which xterm's own paste
 * handling takes from there. ⌃Tab is the tab row's and ⌃` is this panel's.
 * Everything else is the shell's, ⌃C first among them.
 *
 * Colours are the page's: the background and the text the note's own, the
 * sixteen a shell chooses among from the --term-* tokens (styles.css),
 * read again whenever the theme turns.
 */
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { type Channel, openTerminal } from "../pty.ts";

/** Lines kept above the screen: the same number the server's screen keeps (pty/screen.ts). */
const SCROLLBACK = 5000;

/** The page's colours for xterm, from the tokens as they are now. */
function themeNow(): ITheme {
	const style = getComputedStyle(document.documentElement);
	const v = (name: string) => style.getPropertyValue(name).trim();
	return {
		background: v("--background"),
		foreground: v("--foreground"),
		cursor: v("--foreground"),
		cursorAccent: v("--background"),
		selectionBackground: v("--term-selection"),
		black: v("--term-black"),
		red: v("--term-red"),
		green: v("--term-green"),
		yellow: v("--term-yellow"),
		blue: v("--term-blue"),
		magenta: v("--term-magenta"),
		cyan: v("--term-cyan"),
		white: v("--term-white"),
		brightBlack: v("--term-bright-black"),
		brightRed: v("--term-bright-red"),
		brightGreen: v("--term-bright-green"),
		brightYellow: v("--term-bright-yellow"),
		brightBlue: v("--term-bright-blue"),
		brightMagenta: v("--term-bright-magenta"),
		brightCyan: v("--term-bright-cyan"),
		brightWhite: v("--term-bright-white"),
	};
}

/** Whether a key is the window's rather than the shell's. */
function windowsKey(e: KeyboardEvent): boolean {
	if (e.metaKey) return true;
	if (e.ctrlKey && e.key === "Tab") return true;
	if (e.ctrlKey && e.key === "`") return true;
	return false;
}

export function Terminal({ id = "1", open }: { id?: string; open: boolean }) {
	const box = useRef<HTMLDivElement>(null);
	const term = useRef<Xterm | null>(null);

	useEffect(() => {
		const el = box.current;
		if (!el || term.current) return;
		const xterm = new Xterm({
			scrollback: SCROLLBACK,
			fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
			fontSize: 12,
			lineHeight: 1.2,
			cursorBlink: false,
			allowProposedApi: true,
			theme: themeNow(),
		});
		term.current = xterm;
		const fit = new FitAddon();
		xterm.loadAddon(fit);
		xterm.attachCustomKeyEventHandler((e) => !windowsKey(e));
		xterm.open(el);
		try {
			const webgl = new WebglAddon();
			webgl.onContextLoss(() => webgl.dispose());
			xterm.loadAddon(webgl);
		} catch {
			// The DOM renderer, then: slower, and the same on screen.
		}

		let channel: Channel | null = null;
		let exited = false;
		const start = () => {
			exited = false;
			channel = openTerminal(id, {
				// What comes first is the screen as the server kept it, drawn on
				// a clean one; then the shell is told the size this box is.
				onOpen: () => {
					xterm.reset();
					channel?.resize(xterm.cols, xterm.rows);
				},
				onData: (bytes) => xterm.write(bytes, () => channel?.ack(bytes.length)),
				onExit: (code) => {
					exited = true;
					xterm.write(`\r\n\x1b[2m[the shell exited with ${code} — press a key for a new one]\x1b[0m\r\n`);
				},
			});
		};
		start();
		const typed = xterm.onData((text) => {
			if (exited) {
				channel?.dispose();
				start();
				return;
			}
			channel?.write(text);
		});
		const resized = xterm.onResize(({ cols, rows }) => channel?.resize(cols, rows));

		// Fitted when the box has a size, and again whenever it changes — which
		// is the panel being dragged, the window resized, or the panel opening.
		const sized = new ResizeObserver(() => {
			if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
		});
		sized.observe(el);

		// The theme turns on the root element's data-theme (theme.ts).
		const themed = new MutationObserver(() => {
			xterm.options.theme = themeNow();
		});
		themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

		return () => {
			themed.disconnect();
			sized.disconnect();
			typed.dispose();
			resized.dispose();
			channel?.dispose();
			xterm.dispose();
			term.current = null;
		};
	}, [id]);

	// Opened: the cursor goes to it, as it does to a terminal pulled up in
	// VS Code. The fit follows on its own, from the box having a size.
	useEffect(() => {
		if (open) term.current?.focus();
	}, [open]);

	return <div id="terminal" ref={box} className="min-h-0 flex-1 overflow-hidden bg-background px-2 pt-1" />;
}
