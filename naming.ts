/**
 * A note's name, as the title field shows it and as a new name becomes a
 * path. Shared by both ends, like protocol.ts, and dependent on nothing, so
 * the server can use it without pulling the editor in.
 */
/** The name a note shows in its title field: the file's, without the folder and the extension. */
export function titleOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/**
 * Where a note goes when its title is changed to `name`: the same folder,
 * that name, `.md`. What is refused here is refused before a request is
 * made; the server checks again, and also for a name already taken.
 */
export function renameTarget(path: string, name: string): { to: string } | { error: string } {
	const title = name.trim();
	if (!title) return { error: "A note needs a name." };
	if (title.includes("/") || title.includes("\\")) return { error: "A name cannot contain a slash." };
	if (title.startsWith(".")) return { error: "A name cannot start with a dot." };
	if (title.endsWith(".md")) return { error: "The .md is added for you." };
	const folder = path.slice(0, path.lastIndexOf("/") + 1);
	return { to: `${folder}${title}.md` };
}
