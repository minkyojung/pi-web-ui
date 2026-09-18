import assert from "node:assert/strict";
import test from "node:test";

import { parser as markdown } from "@lezer/markdown";

import { math } from "../math.ts";

const parser = markdown.configure([math]);
const nodes = (text) => {
	const out = [];
	parser.parse(text).iterate({
		enter: (n) => {
			if (n.name === "Document" || n.name === "Paragraph") return;
			out.push([n.name, text.slice(n.from, n.to)]);
		},
	});
	return out;
};

test("$…$ in a line is math with a mark at each end", () => {
	assert.deepEqual(nodes("so $E = mc^2$ then"), [["InlineMath", "$E = mc^2$"], ["MathMark", "$"], ["MathMark", "$"]]);
});

test("money is not math, and neither is a $ with a space after it", () => {
	assert.deepEqual(nodes("$5 and $6"), []);
	assert.deepEqual(nodes("a $ b $ c"), []);
	assert.deepEqual(nodes("no $close on this line\nbut $here$"), [["InlineMath", "$here$"], ["MathMark", "$"], ["MathMark", "$"]]);
});

test("$$ on lines of their own is a block, one line or many", () => {
	assert.deepEqual(nodes("$$\n\\int_0^1 x^2 dx\n$$\n\nafter"), [["MathBlock", "$$\n\\int_0^1 x^2 dx\n$$"]]);
	assert.deepEqual(nodes("$$a+b$$"), [["MathBlock", "$$a+b$$"]]);
	assert.deepEqual(nodes("$$\nnever closed")[0], ["MathBlock", "$$\nnever closed"]);
	assert.deepEqual(nodes("a line of prose:\n$$\nx\n$$"), [["MathBlock", "$$\nx\n$$"]], "straight under a line of prose, with no blank line");
});
