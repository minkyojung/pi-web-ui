/**
 * The files of the repository the folder is, as git lists them.
 *
 * `⌘P` opens a note by a few letters of its name, and notes were the whole
 * list while the folder was a folder of notes. A folder that is a repository
 * holds the code the agent writes, and reading that code is the reason the
 * window is open at all (docs/spec-mode), so the palette has to be able to
 * reach every file in it — not only the ones that are notes.
 *
 * git is asked rather than the folder walked (vault.ts), because git already
 * answers this exact question, and answers it the way the person's own tools
 * do: `.gitignore` is honoured, so `node_modules`, `dist` and whatever else
 * that file names stay out of the palette without a second list of names here
 * to keep in step with it.
 *
 * Untracked files are asked for beside the tracked ones, which is the whole
 * point of the flags: a file the agent wrote a minute ago is not committed
 * yet, and a spec's three documents are not committed until the first task's
 * commit carries them in. A list of tracked files alone would leave out
 * precisely the files somebody opened the window to read.
 *
 * `.pi/` is excluded here rather than left to `.gitignore`, which a
 * repository that is not a vault has no reason to name; `.git` git never
 * lists. Every other dot-folder — `.github`, `.octave` — is part of the
 * repository and is listed, which is why this is not vault.ts's walk, whose
 * job is to keep the notes' lists free of them.
 *
 * Read at the moments the notes are (fileIndex.ts): at startup, when a tab
 * connects, and after the agent settles. A turn ending is both when the
 * answer can have changed and when somebody is about to go looking.
 */
import { execFile } from "node:child_process";

import { APP_DIR_NAME } from "./documentKinds.ts";

/**
 * Where the list gives up, which is vault.ts's LIMIT for vault.ts's reason: a
 * number no folder anyone works in reaches, and a guard against a repository
 * that is not one — someone opens their home directory.
 */
export const LIMIT = 50_000;

export type Repo = {
	/** Every file, from the folder, with forward slashes, in git's own order. */
	files: string[];
	/** The repository held more files than the list would take. */
	truncated: boolean;
};

/**
 * The repository's files, or null for a folder that is in none — and null too
 * where git cannot be run at all, which is the same answer said the same way:
 * there is no list, and the palette has what it always had.
 *
 * `-z` because a path is bytes: a name with a newline or an accent in it comes
 * through as it is, where git's default would quote it and the window would
 * open a file by a name nothing on disk has.
 */
export function repoFiles(root: string): Promise<Repo | null> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".", `:(exclude)${APP_DIR_NAME}`],
			{ cwd: root, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
			(err, stdout) => {
				if (err) return resolve(null);
				// A path being merged is listed once per stage, so the same name
				// can come back three times; the list is a set of names.
				const all = [...new Set(String(stdout).split("\0").filter(Boolean))];
				resolve({ files: all.slice(0, LIMIT), truncated: all.length > LIMIT });
			},
		);
	});
}
