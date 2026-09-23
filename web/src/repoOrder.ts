/**
 * The order of the repositories in the sidebar, while the shell is being told
 * about it.
 *
 * The list is the shell's, and it comes back asked of git and of GitHub for
 * every row — long enough to see. A row dropped in its new place would go
 * back to the old one and then forward again, at the one moment the person is
 * watching it. So the order dropped is held in the page and laid over the
 * list until the shell's own list says the same thing.
 *
 * The rule is the shell's (electron/workspaces.js `reordered`), said again
 * here for the page: what the drag named goes in the drag's order, and what
 * it did not name keeps its place after them.
 */

/** `projects` in the order `order` names, or as they are when nothing is held. */
export function orderedBy<T extends { path: string }>(projects: readonly T[], order: readonly string[] | null): readonly T[] {
	if (!order) return projects;
	const rank = (project: T) => {
		const at = order.indexOf(project.path);
		return at === -1 ? order.length : at;
	};
	// Sorting is stable, so the ones it does not name keep the order they came in.
	return [...projects].sort((a, b) => rank(a) - rank(b));
}

/**
 * Whether a list that has just arrived has spent the order held here: it is
 * in that order already, so there is nothing left to lay over it — or it
 * holds a repository the order does not name, which is news the drag did not
 * have, and an order that does not know about every row is out of date.
 */
export function spent(paths: readonly string[], order: readonly string[]): boolean {
	return paths.every((path, i) => path === order[i]) || paths.some((path) => !order.includes(path));
}
