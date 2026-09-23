/**
 * The screen a terminal has when nobody is looking at it.
 *
 * The bytes a shell prints are a stream, and a socket that was not there
 * for them has no way back to what they drew — so the server keeps a
 * terminal of its own, xterm without a DOM, fed every byte, and hands a
 * socket that attaches what that terminal shows: the rows, their colours,
 * the scrollback, the cursor, as one escape string (addon-serialize) that
 * the real terminal draws in one write. A reload or a move to another
 * workspace and back finds the screen it left. Conductor keeps
 * alacritty_terminal in its core for the same reason.
 *
 * xterm's packages are CommonJS bundles whose named exports Node does not
 * see, so they are taken off the default.
 */
import * as headlessNs from "@xterm/headless";
import * as serializeNs from "@xterm/addon-serialize";

const { Terminal } = (headlessNs as unknown as { default?: typeof headlessNs }).default ?? headlessNs;
const { SerializeAddon } = (serializeNs as unknown as { default?: typeof serializeNs }).default ?? serializeNs;

/** Lines kept above the screen — the same number here and in the window, so what is handed over is what would have been there. */
export const SCROLLBACK = 5000;

export type Screen = {
	/** These bytes were printed. */
	write(bytes: Uint8Array): void;
	resize(cols: number, rows: number): void;
	/** What is on the screen now, as the bytes that would draw it on an empty terminal of the same size. */
	snapshot(): Buffer;
	dispose(): void;
};

export function createScreen({ cols, rows }: { cols: number; rows: number }): Screen {
	const term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
	const serializer = new SerializeAddon();
	term.loadAddon(serializer);
	return {
		write: (bytes) => term.write(bytes),
		resize: (cols, rows) => term.resize(cols, rows),
		snapshot: () => Buffer.from(serializer.serialize(), "utf8"),
		dispose: () => term.dispose(),
	};
}
