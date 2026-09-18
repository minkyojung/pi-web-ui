import assert from "node:assert/strict";
import test from "node:test";

import { pastedName } from "../web/src/attachments.ts";

test("a clipboard's nameless picture is named from the moment, and a named one keeps its name", () => {
	const at = new Date(2026, 8, 18, 4, 5, 6);
	assert.equal(pastedName("image.png", "image/png", at), "Pasted image 20260918040506.png");
	assert.equal(pastedName("", "image/jpeg", at), "Pasted image 20260918040506.jpg");
	assert.equal(pastedName("Screenshot.PNG", "image/png", at), "Pasted image 20260918040506.PNG");
	assert.equal(pastedName("My Diagram.PNG", "image/png", at), "My Diagram.PNG");
});
