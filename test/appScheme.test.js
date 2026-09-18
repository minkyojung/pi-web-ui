import assert from "node:assert/strict";
import test from "node:test";

import { fileFor, pageUrl } from "../electron/appScheme.js";

test("a page of the build is served from the build", () => {
	assert.equal(pageUrl("start.html"), "octave://app/start.html");
	assert.equal(fileFor("/app/dist", pageUrl("start.html")), "/app/dist/start.html");
	assert.equal(fileFor("/app/dist", "octave://app/assets/start-1a2b.js?v=1"), "/app/dist/assets/start-1a2b.js");
});

test("nothing outside the build is served, however the path is spelled", () => {
	// The address parser takes `..` back no further than the top, so these stay inside.
	assert.equal(fileFor("/app/dist", "octave://app/../secret"), "/app/dist/secret");
	assert.equal(fileFor("/app/dist", "octave://app/%2e%2e/secret"), "/app/dist/secret");
	// A slash that is only a slash once decoded is past the parser, and is refused here.
	assert.equal(fileFor("/app/dist", "octave://app/assets/%2e%2e%2f%2e%2e%2fsecret"), null);
	assert.equal(fileFor("/app/dist", "octave://app/"), null, "the build's folder itself is not a file");
	assert.equal(fileFor("/app/dist", "octave://app/%E0%A4%A"), null);
});

test("another host or scheme is not the app's", () => {
	assert.equal(fileFor("/app/dist", "octave://evil/start.html"), null);
	assert.equal(fileFor("/app/dist", "file:///app/dist/start.html"), null);
	assert.equal(fileFor("/app/dist", "not a url"), null);
});
