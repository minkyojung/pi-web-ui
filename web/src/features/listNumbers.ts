/**
 * A numbered list's numbers put right on every edit of it.
 *
 * Typed under a list that ends at 10, `1. ` is the eleventh item and is
 * numbered so; an item taken out closes its gap; an item moved by Tab
 * opens a nested list at 1. Not computed from what happened — the block
 * around every change is numbered whole, the top list from its first
 * item's number and every nested one from 1 (listEdit.ts), which has no
 * cases.
 *
 * Done in a transaction filter, CodeMirror's hook for keeping a document
 * in shape: the numbers change in the same transaction as the keystroke,
 * so ⌘Z takes both back at once and nothing is ever saved between the
 * two. Not for a change from the server, which is the file as it is; and
 * not while a syllable is being composed, when the editor should not be
 * rewriting the line under the input method.
 */
import { ensureSyntaxTree } from "@codemirror/language";
import { type ChangeSpec, EditorState, type Extension, Transaction } from "@codemirror/state";

import { blockAt, renumbered } from "./listEdit.ts";
import { fromServer } from "./origin.ts";

export const listNumbers: Extension = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || tr.annotation(fromServer) || tr.isUserEvent("input.type.compose")) return tr;
	const { state } = tr;
	const seen = new Set<number>();
	const changes: ChangeSpec[] = [];
	tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
		for (const pos of [fromB, toB]) {
			if (!blockAt(state, pos)) continue;
			// The whole block has to be parsed for its numbers to be right, and
			// where it ends is not known until it is: the note is parsed through,
			// which costs once, the parse being kept and added to from then on.
			ensureSyntaxTree(state, state.doc.length, 50);
			const block = blockAt(state, pos);
			if (!block || seen.has(block.from)) continue;
			seen.add(block.from);
			changes.push(...renumbered(state, pos));
		}
	});
	return changes.length === 0 ? tr : [tr, { changes, sequential: true }];
});
