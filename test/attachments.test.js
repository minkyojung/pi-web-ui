import assert from "node:assert/strict";
import test from "node:test";

import { filesToAttach, imagesOf } from "../web/src/attachments.ts";

test("an image data URL becomes base64 and a media type, named as it is kept; anything else is left out", () => {
	const now = new Date(2026, 8, 26, 15, 30, 12);
	const files = [
		{ url: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png", filename: "image.png" },
		{ url: "data:image/jpeg;base64,/9j/", mediaType: "image/jpeg", filename: "diagram.jpeg" },
		{ url: "data:text/plain;base64,aGVsbG8=", mediaType: "text/plain" },
		{ url: "blob:http://x/1", mediaType: "image/png" },
		{},
	];
	assert.deepEqual(imagesOf(files, now), [
		{ mimeType: "image/png", data: "iVBORw0KGgo=", name: "Pasted image 20260926153012.png" },
		{ mimeType: "image/jpeg", data: "/9j/", name: "diagram.jpeg" },
	]);
});

test("what is not an image goes to the folder, and which of those it takes is the server's to say", () => {
	const files = [{ name: "a.png", type: "image/png" }, { name: "paper.pdf", type: "application/pdf" }, { name: "odd", type: "" }];
	assert.deepEqual(filesToAttach(files).map((f) => f.name), ["paper.pdf", "odd"]);
	assert.deepEqual(filesToAttach([]), []);
});
