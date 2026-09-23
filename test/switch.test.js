import assert from "node:assert/strict";
import test from "node:test";

import { createStore, resetAll } from "../web/src/serverState.ts";
import { draftStore, switchDraft } from "../web/src/draft.ts";

test("a store of the folder's is cleared to how it began when the window moves, and the window's own is not", () => {
	const folder = createStore("first");
	const window = createStore("kept", { window: true });
	folder.set("second");
	window.set("changed");
	let heard = 0;
	folder.subscribe(() => heard++);
	resetAll();
	assert.equal(folder.get(), "first");
	assert.equal(window.get(), "changed");
	assert.equal(heard, 1, "whoever reads it is told");
});

test("a draft stays with the folder it was typed for, and the other folder's comes back", () => {
	draftStore.set("for lima");
	switchDraft("/w/lima", "/w/oslo");
	assert.equal(draftStore.get(), "", "oslo has no draft yet");
	draftStore.set("for oslo");
	switchDraft("/w/oslo", "/w/lima");
	assert.equal(draftStore.get(), "for lima");
	switchDraft("/w/lima", "/w/oslo");
	assert.equal(draftStore.get(), "for oslo");
	switchDraft(null, "/w/nowhere");
	assert.equal(draftStore.get(), "", "a page with no folder before leaves nothing behind");
});
