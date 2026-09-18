import assert from "node:assert/strict";
import test from "node:test";

import { filesToAttach, imagesOf } from "../web/src/attachments.ts";

test("an image data URL becomes base64 and a media type; anything else is left out", () => {
	const files = [
		{ url: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png" },
		{ url: "data:text/plain;base64,aGVsbG8=", mediaType: "text/plain" },
		{ url: "blob:http://x/1", mediaType: "image/png" },
		{},
	];
	assert.deepEqual(imagesOf(files), [{ mimeType: "image/png", data: "iVBORw0KGgo=" }]);
});

test("what is not an image goes to the folder, and which of those it takes is the server's to say", () => {
	const files = [{ name: "a.png", type: "image/png" }, { name: "paper.pdf", type: "application/pdf" }, { name: "odd", type: "" }];
	assert.deepEqual(filesToAttach(files).map((f) => f.name), ["paper.pdf", "odd"]);
	assert.deepEqual(filesToAttach([]), []);
});
