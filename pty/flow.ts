/**
 * Whether the shell is read or left waiting, by how much of what it printed
 * the window has yet to draw.
 *
 * A shell prints faster than a terminal draws — `cat` of a large file, a
 * build's log — and a server that read it all and sent it all would hold
 * the rest in the socket's buffer, growing, while the window fell behind
 * and the person could not so much as press ^C in time. So the window says
 * what it has drawn, in bytes, and the server keeps a count of what it has
 * sent and not heard back about. Past HIGH the pty is paused, which leaves
 * the shell blocked on its own write, the way a terminal too slow to draw
 * has always slowed the program behind it; back under LOW it is read again.
 * The gap between the two is what keeps a burst from flapping the pty on
 * and off with every ack. VS Code's terminal does the same.
 *
 * Pure: the count and the two decisions, with nothing of the socket or the
 * pty, so the rule is tested without either.
 */

/** Unacknowledged bytes past which the pty is paused. */
export const HIGH = 256 * 1024;
/** Unacknowledged bytes under which a paused pty is resumed. */
export const LOW = 64 * 1024;

export type Flow = { unacked: number; paused: boolean };

export const idle: Flow = { unacked: 0, paused: false };

/** These bytes went to the window. `pause` says to stop reading the pty, said once at the crossing. */
export function sent(flow: Flow, bytes: number): { flow: Flow; pause: boolean } {
	const unacked = flow.unacked + bytes;
	const pause = !flow.paused && unacked > HIGH;
	return { flow: { unacked, paused: flow.paused || pause }, pause };
}

/** The window drew these bytes. `resume` says to read the pty again, said once at the crossing. */
export function acked(flow: Flow, bytes: number): { flow: Flow; resume: boolean } {
	// A window that acknowledges more than it was sent — a reconnect that
	// counted the screen it was handed — cannot put the count below nothing.
	const unacked = Math.max(0, flow.unacked - bytes);
	const resume = flow.paused && unacked < LOW;
	return { flow: { unacked, paused: flow.paused && !resume }, resume };
}
