/**
 * How a difference is drawn, in one place.
 *
 * Two things in this window draw the same difference. The note's own diff,
 * where pi's undecided words wait to be decided about, is drawn by a
 * CodeMirror theme; the card that says what a run stands in place of is drawn
 * by a React element. They have to agree — the same green has to mean the same
 * thing in both, or a person learns the colours twice — and the only thing two
 * such different machineries can share is the value itself.
 *
 * Plain CSS values rather than utility classes, since one side is a theme
 * object and a class name cannot be handed to it. `--destructive` is the app's
 * own token for something being taken away, which is what a removal is; the
 * green has none, because the app's primary colour is neutral and a difference
 * needs its own.
 */

/** Words that are there now and were not. */
export const added = "rgba(80, 200, 120, 0.28)";
/** The line they sit on, where a whole line of them is drawn. */
export const addedLine = "rgba(80, 200, 120, 0.07)";
/** Words that were there and are not. */
export const removed = "color-mix(in oklab, var(--destructive) 30%, transparent)";
/** The line they sit on. */
export const removedLine = "color-mix(in oklab, var(--destructive) 10%, transparent)";
/** The rule drawn through them, so they read as taken away rather than merely coloured. */
export const removedRule = "var(--destructive)";
