/**
 * The write barrier: whatever is typed and not yet written goes down before
 * anything that reads the disk.
 *
 * The editor saves when typing pauses, which is right for typing and wrong
 * for the moment just after it — a prompt sent inside that pause would have
 * pi read the note as it was, and a window closed inside it would lose the
 * words. So the editor registers its save here, and the places that need the
 * disk current call it first. The socket delivers in order and the server
 * writes a save before it reads the next message, so "first" is enough.
 *
 * One editor at a time; a second registration replaces the first.
 */
let flush: (() => void) | null = null;

export function registerSave(fn: () => void): () => void {
	flush = fn;
	return () => {
		if (flush === fn) flush = null;
	};
}

/** Write down what is unsaved, if anything is. Safe to call with no editor open. */
export function flushSaves(): void {
	flush?.();
}
