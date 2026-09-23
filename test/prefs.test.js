import assert from "node:assert/strict";
import test from "node:test";

import { prefsOf, withPref } from "../electron/prefs.js";

test("the window's prefs are the strings the settings hold under strings, and nothing else", () => {
	assert.deepEqual(prefsOf({}), {});
	assert.deepEqual(prefsOf({ prefs: null }), {});
	assert.deepEqual(prefsOf({ prefs: [] }), {});
	assert.deepEqual(prefsOf({ prefs: { theme: "dark", "strip-width": "240", n: 3, o: {}, "": "x" } }), { theme: "dark", "strip-width": "240" });
});

test("a pref set is kept, one set to null is dropped, and one that is not a string is refused", () => {
	const was = { theme: "dark" };
	assert.deepEqual(withPref(was, "counting", "characters"), { theme: "dark", counting: "characters" });
	assert.deepEqual(withPref(was, "theme", null), {});
	assert.equal(withPref(was, "counting", null), was, "dropping what is not there changes nothing");
	assert.equal(withPref(was, "theme", "dark"), was, "the same value again changes nothing");
	assert.equal(withPref(was, "theme", 3), was);
	assert.equal(withPref(was, "theme", "x".repeat(4001)), was);
});
