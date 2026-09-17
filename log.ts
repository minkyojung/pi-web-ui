/**
 * What the server said, kept where it can be read afterwards.
 *
 * Until now it said everything to the terminal and nowhere else. In a terminal
 * that is enough — it is right there. In the desktop app there is no terminal:
 * the shell reads the pipe and keeps the last ten lines for the box it shows
 * when the server stops, and everything else is gone the moment it is printed.
 * So a person who says the app was strange yesterday leaves nothing to look
 * at, and a crash that does not happen again is never seen at all. The safety
 * net added for uncaught errors reports to a place nobody could read.
 *
 * Everything, rather than a chosen few lines: what is wanted afterwards is
 * what the terminal would have shown, and deciding in advance which line will
 * matter is how a log comes to be missing the one that does. So the console is
 * wrapped once, here, rather than every call site being changed into something
 * else — the intent is exactly "this process also writes down what it says",
 * and that is one thing in one place rather than three hundred.
 *
 * Bounded by rolling on size rather than by a line count or a day: one file
 * being written and one kept behind it, so the folder is never more than twice
 * the limit and a quiet week is still a week of history rather than seven
 * files of nothing. When the current file passes the limit it becomes the one
 * behind, and whatever was behind it goes.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { APP_DIR } from "./settings.ts";

/** Beside the app's settings, which is where everything this app keeps for itself lives. */
export const LOG_PATH = join(APP_DIR, "logs", "server.log");
/** Two megabytes is some tens of thousands of lines: more than a session says, less than a folder notices. */
export const LIMIT = 2_000_000;

/** A line as it is filed: when, and what was said. */
export const lineOf = (at: Date, args: unknown[]): string =>
	`${at.toISOString()} ${args.map((a) => (typeof a === "string" ? a : a instanceof Error ? (a.stack ?? a.message) : inspect(a))).join(" ")}\n`;

const inspect = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		// A cycle, or something that will not be stringified. Its shape is not
		// worth an exception in the logger of all places.
		return String(value);
	}
};

/**
 * Send what this process says to `file` as well as to where it already goes.
 *
 * Returns the path, so the caller can say it — a log nobody can find is not
 * one. Writing is synchronous, as every other write in this server is: it is a
 * line at a time, and a log that can arrive after the crash it is about is not
 * a log.
 */
export function startLogging(file = LOG_PATH, limit = LIMIT): string {
	mkdirSync(dirname(file), { recursive: true });
	let size = existsSync(file) ? statSync(file).size : 0;
	const write = (args: unknown[]) => {
		const line = lineOf(new Date(), args);
		if (size + line.length > limit) {
			renameSync(file, `${file}.1`);
			size = 0;
		}
		try {
			appendFileSync(file, line);
			size += line.length;
		} catch {
			// A full disk, a folder gone. The console still has it, and a server
			// that stops because it could not write down that it was running
			// would be the joke of this file.
		}
	};
	for (const kind of ["log", "warn", "error"] as const) {
		const said = console[kind].bind(console);
		console[kind] = (...args: unknown[]) => {
			said(...args);
			write(args);
		};
	}
	return file;
}
