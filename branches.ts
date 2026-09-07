/**
 * Where a conversation has alternatives, and how to reach them.
 *
 * A pi session is a tree, not a list. Asking something again does not overwrite
 * the first answer: it grows a second branch beside it and moves a leaf pointer.
 * What a client is shown is the path from the root to that leaf, and every other
 * branch is invisible from there — present in the file, unreachable from the
 * screen. This is what makes them reachable.
 *
 * At the repo root, like conversation.js and toolModes.ts, because the server is
 * the only thing that can read a session tree and the tests are the only thing
 * that can build one on purpose. Importing server.ts would open a pi session.
 */

/** The part of pi's SessionManager this needs. A real one satisfies it. */
export interface SessionTree {
	getTree(): { entry: { id: string; parentId: string | null } }[];
	getChildren(parentId: string): Entry[];
	buildContextEntries(): Entry[];
}

/** The part of pi's SessionEntry this looks at. */
interface Entry {
	id: string;
	parentId: string | null;
	type: string;
	message?: { role?: string };
}

export interface BranchPoint {
	/** The user message on the current path that has alternatives. */
	entryId: string;
	/** Which alternative is being shown, and how many there are. */
	index: number;
	total: number;
	/** What to navigate to for each alternative, in the same order. */
	targets: string[];
}

/**
 * Where a branch was left off: its newest child, all the way down.
 *
 * The target of an arrow is not the sibling itself. `navigateTree` on a user
 * message moves the leaf to its *parent* and hands the text back to be edited,
 * which is how pi models asking something differently — and is not what an
 * arrow means. An arrow means show me that one, so it has to point at the end
 * of that branch rather than its beginning.
 */
function tipOf(tree: SessionTree, entry: Entry): string {
	let at = entry;
	for (;;) {
		const children = tree.getChildren(at.id);
		if (children.length === 0) return at.id;
		at = children[children.length - 1];
	}
}

/**
 * The fork points on the path currently being shown.
 *
 * Only user messages: a sibling that is not one was never an alternative way of
 * asking, and navigating to it would mean something else entirely. A message
 * with no sibling is not a fork point and says nothing.
 */
export function branchPoints(tree: SessionTree): BranchPoint[] {
	const roots = () => tree.getTree().map((node) => node.entry as Entry);
	const points: BranchPoint[] = [];

	for (const entry of tree.buildContextEntries()) {
		if (entry.type !== "message" || entry.message?.role !== "user") continue;

		const siblings = (entry.parentId === null ? roots() : tree.getChildren(entry.parentId)).filter(
			(sibling) => sibling.type === "message" && sibling.message?.role === "user",
		);
		if (siblings.length < 2) continue;

		points.push({
			entryId: entry.id,
			index: siblings.findIndex((sibling) => sibling.id === entry.id),
			total: siblings.length,
			targets: siblings.map((sibling) => tipOf(tree, sibling)),
		});
	}
	return points;
}
