import assert from "node:assert/strict";
import test from "node:test";

import { check, ladder } from "../scripts/contrast.mjs";

/**
 * styles.css claims of its palettes that every pair "clears AA". The claim is
 * worth no more than the last time somebody checked, so this is the checking:
 * the surfaces are about to be moved about, and a promise in a comment cannot
 * say when it has stopped being true.
 *
 * `npm run contrast` prints the whole table, including how far each surface
 * sits from the content, which is what to read when this fails.
 */
test("every pair clears AA in both themes", () => {
	assert.deepEqual(check(), []);
});

/**
 * And the ladder those colours stand on, which is not an AA matter and is the
 * one thing shadcn's tokens leave open: the frame below the content, nothing
 * sunk into it, and every rim one rim's distance from its own surface.
 */
test("every theme stands on the same ladder", () => {
	assert.deepEqual(ladder(), []);
});
