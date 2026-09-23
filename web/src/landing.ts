/**
 * When this page was ready, told to the shell once — its half of the one
 * line the shell writes for a switch between workspaces (electron/switching.js).
 *
 * Three moments, as milliseconds after the page began: the socket opened,
 * the first state from the server landed, and that state was drawn — the
 * frame after the frame in which it was applied, which is the first a
 * person could have seen it in. With `origin`, the shell can set them
 * beside its own clock. A page with no shell keeps them to itself.
 */
const shell = (window as { pi?: { landed?: (marks: { origin: number; socket?: number; state?: number; painted?: number }) => void } }).pi?.landed;

let socket: number | undefined;
let state: number | undefined;
let reported = false;
/** When this landing began: the page's start, or the moment the window was moved to another workspace in place. */
let began = 0;

/** The window is moving to another workspace without the page being made again: the next three moments are that switch's. */
export function beginSwitch(): void {
	began = performance.now();
	socket = state = undefined;
	reported = false;
}

export function socketOpened(): void {
	if (socket === undefined) socket = performance.now() - began;
}

/** The first state landed; drawn is two frames on, and then the shell is told. */
export function stateLanded(): void {
	if (state !== undefined) return;
	state = performance.now() - began;
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			if (reported) return;
			reported = true;
			shell?.({ origin: performance.timeOrigin + began, socket, state, painted: performance.now() - began });
		}),
	);
}
