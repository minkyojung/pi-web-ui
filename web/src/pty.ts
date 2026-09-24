/**
 * The window's end of a terminal: the socket to /pty (pty/terminal.ts),
 * opened again when it drops, and the four things said over it.
 *
 * Binary frames are the shell's bytes and are given to the terminal to
 * draw; what it has drawn is acknowledged back in bytes, which is what
 * keeps a shell that prints faster than the window draws from running
 * ahead of it (pty/flow.ts). Text frames are the terminal's JSON. A socket
 * that drops — the server restarted under a dev run, the network stack
 * blinked — is opened again with a growing wait, as ws.ts does; the shell
 * behind it is still there, and the server hands back its screen first.
 * A socket the server closed because another window took the terminal, or
 * because the shell exited, is not opened again: there is nothing to go
 * back to.
 */
import { forFolder } from "./workspace.ts";

export type Channel = {
	/** What was typed. */
	write(text: string): void;
	resize(cols: number, rows: number): void;
	/** These many bytes were drawn. */
	ack(bytes: number): void;
	/** This terminal is in front of the others now. */
	front(): void;
	/** End the shell. */
	close(): void;
	/** Let go of the socket; the shell lives on for the next one. */
	dispose(): void;
};

export type Handlers = {
	/** The socket is open: what comes next is the screen as it was, then the shell. */
	onOpen: () => void;
	onData: (bytes: Uint8Array) => void;
	onExit: (code: number) => void;
};

/** Said by the server when another socket took the terminal. */
const TAKEN = "another tab took the terminal";

export function openTerminal(id: string, { onOpen, onData, onExit }: Handlers): Channel {
	let socket: WebSocket | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let attempt = 0;
	let done = false;

	const backoff = () => Math.min(5000, 500 * 2 ** attempt);

	function connect(): void {
		timer = null;
		const ws = new WebSocket(forFolder(`/pty?id=${encodeURIComponent(id)}`).replace(/^/, `ws://${location.host}`));
		ws.binaryType = "arraybuffer";
		socket = ws;
		ws.onopen = () => {
			if (socket !== ws) return;
			onOpen();
		};
		ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
			if (socket !== ws) return;
			attempt = 0;
			if (typeof e.data !== "string") {
				onData(new Uint8Array(e.data));
				return;
			}
			const msg = JSON.parse(e.data) as { type?: string; code?: number };
			if (msg.type === "exit") {
				done = true;
				onExit(typeof msg.code === "number" ? msg.code : 0);
			}
		};
		ws.onclose = (e) => {
			if (socket !== ws) return;
			socket = null;
			if (done || e.reason === TAKEN) return;
			timer = setTimeout(connect, backoff());
			attempt++;
		};
		ws.onerror = () => {};
	}
	connect();

	const send = (data: string | ArrayBuffer) => {
		if (socket?.readyState === WebSocket.OPEN) socket.send(data);
	};
	const encoder = new TextEncoder();
	return {
		write: (text) => send(encoder.encode(text).buffer as ArrayBuffer),
		resize: (cols, rows) => send(JSON.stringify({ type: "resize", cols, rows })),
		ack: (bytes) => send(JSON.stringify({ type: "ack", bytes })),
		front: () => send(JSON.stringify({ type: "front" })),
		close: () => {
			done = true;
			send(JSON.stringify({ type: "close" }));
		},
		dispose: () => {
			done = true;
			if (timer !== null) clearTimeout(timer);
			const ws = socket;
			socket = null;
			ws?.close();
		},
	};
}
