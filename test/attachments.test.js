import assert from "node:assert/strict";
import test from "node:test";

import { imagesOf } from "../web/src/attachments.ts";

test("an image data URL becomes base64 and a media type; anything else is left out", () => {
	const files = [
		{ url: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png" },
		{ url: "data:text/plain;base64,aGVsbG8=", mediaType: "text/plain" },
		{ url: "blob:http://x/1", mediaType: "image/png" },
		{},
	];
	assert.deepEqual(imagesOf(files), [{ mimeType: "image/png", data: "iVBORw0KGgo=" }]);
});
