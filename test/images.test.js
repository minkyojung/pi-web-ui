import assert from "node:assert/strict";
import test from "node:test";

import { imageSrc, sizeOf } from "../web/src/features/images.ts";

test("a picture in the folder is fetched from /vault for the note that shows it; one on the web from the web", () => {
	assert.equal(imageSrc("diagram.png", "book/ch 1/notes.md"), "/vault/diagram.png?from=book%2Fch%201%2Fnotes.md");
	assert.equal(imageSrc("images/a b.png", "n.md"), "/vault/images/a%20b.png?from=n.md");
	assert.equal(imageSrc("https://example.com/a.png", "n.md"), "https://example.com/a.png");
	assert.equal(imageSrc("data:image/png;base64,AAAA", "n.md"), "data:image/png;base64,AAAA");
});

test("the words after | are a size when they are a size, and otherwise what to say instead", () => {
	assert.deepEqual(sizeOf(null), {});
	assert.deepEqual(sizeOf("300"), { width: 300 });
	assert.deepEqual(sizeOf("300x200"), { width: 300, height: 200 });
	assert.deepEqual(sizeOf("the diagram"), { alt: "the diagram" });
});
