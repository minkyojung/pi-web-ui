/**
 * What a switch between workspaces cost, written down as one line.
 *
 * A switch is the shell's until the page is loaded and the page's after:
 * the shell knows when it was asked, when the server was spawned, when it
 * answered and when the page had loaded; the page knows when its socket
 * opened, when the first state landed and when that was drawn. Neither half
 * says how long a person waited; together they do, and this is where they
 * are put together. Pure, so the arithmetic is tested without a window.
 *
 * @typedef {{ asked: number, server?: number, answered?: number, loaded?: number }} ShellMarks
 *   Absolute times (Date.now()) at each step of main.js show().
 * @typedef {{ origin: number, socket?: number, state?: number, painted?: number }} PageMarks
 *   `origin` is the page's performance.timeOrigin, absolute; the rest are
 *   milliseconds after it (performance.now()).
 */

const ms = (n) => `${Math.max(0, Math.round(n))}ms`;
const name = (folder) => (folder ? folder.split("/").filter(Boolean).pop() ?? folder : "start");

/**
 * The line for a switch from `from` to `to`, given both halves — or the
 * shell's alone, when the page never reported, which is itself worth a line.
 *
 * @param {{ from: string | null, to: string, shell: ShellMarks, page: PageMarks | null }} of
 */
export function switchLine({ from, to, shell, page }) {
	const steps = [];
	if (shell.server !== undefined) steps.push(`spawned ${ms(shell.server - shell.asked)}`);
	if (shell.answered !== undefined && shell.server !== undefined) steps.push(`answered ${ms(shell.answered - shell.server)}`);
	if (shell.loaded !== undefined && shell.answered !== undefined) steps.push(`page ${ms(shell.loaded - shell.answered)}`);
	let total = shell.loaded !== undefined ? shell.loaded - shell.asked : null;
	let until = "loaded";
	if (page) {
		if (page.socket !== undefined) steps.push(`socket ${ms(page.socket)}`);
		if (page.state !== undefined && page.socket !== undefined) steps.push(`state ${ms(page.state - page.socket)}`);
		if (page.painted !== undefined && page.state !== undefined) steps.push(`painted ${ms(page.painted - page.state)}`);
		const last = page.painted ?? page.state ?? page.socket;
		if (last !== undefined) {
			total = page.origin + last - shell.asked;
			until = page.painted !== undefined ? "painted" : page.state !== undefined ? "state" : "socket";
		}
	}
	const sum = total === null ? "" : ` — ${ms(total)} from the click to ${until}`;
	const note = page ? "" : " (the page did not report)";
	return `[switch] ${name(from)} → ${name(to)}: ${steps.join(", ")}${sum}${note}`;
}
