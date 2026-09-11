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
 * Where a note goes when its title is changed to `name`: that name, `.md`, in
 * the same folder. A name with slashes is a path, as in Obsidian — from the
 * note's folder, or from the top of the vault when it starts with one — so a
 * note moves between folders by the field that names it, and a folder that
 * is not there is made. What is refused here is refused before a request is
 * made; the server checks again, and also for a name already taken.
 */
export function renameTarget(path: string, name: string): { to: string } | { error: string } {
	const title = name.trim();
	if (!title) return { error: "A note needs a name." };
	if (title.includes("\\")) return { error: "A name cannot contain a backslash." };
	const fromTop = title.startsWith("/");
	// Each part trimmed, so "ideas / moved" is the folder a person meant and not "ideas ".
	const parts = (fromTop ? title.slice(1) : title).split("/").map((part) => part.trim());
	if (parts.some((part) => !part)) return { error: "A folder or a name cannot be empty." };
	if (parts.includes("..")) return { error: "A name cannot go up a folder; start it with / to go to the top." };
	if (parts.some((part) => part.startsWith("."))) return { error: "A folder or a name cannot start with a dot." };
	if (title.endsWith(".md")) return { error: "The .md is added for you." };
	const folder = fromTop ? "" : path.slice(0, path.lastIndexOf("/") + 1);
	return { to: `${folder}${parts.join("/")}.md` };
}
