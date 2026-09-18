import assert from "node:assert/strict";
import test from "node:test";

import { formatTable } from "../web/src/features/tableEdit.ts";

test("a table typed ragged is read square: every column as wide as its widest cell, the delimiter to match", () => {
	const ragged = "| Name | Amount |\n|:--|--:|\n| Apples | 3 |\n|Pears|12|";
	assert.equal(formatTable(ragged), "| Name   | Amount |\n| :----- | -----: |\n| Apples | 3      |\n| Pears  | 12     |");
	assert.equal(formatTable(formatTable(ragged)), formatTable(ragged), "square already: unchanged");
});

test("a row short of cells is filled; wide characters count two", () => {
	assert.equal(formatTable("| a | b |\n|---|---|\n| 한글 |"), "| a    | b   |\n| ---- | --- |\n| 한글 |     |");
});
