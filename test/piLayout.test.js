import assert from "node:assert/strict";
import test from "node:test";

import { inRow, layoutOf, shown } from "../web/src/piLayout.ts";

test("저장된 것이 dock일 때만 dock이고, 없거나 낯선 값이면 컬럼이다", () => {
	assert.equal(layoutOf("dock"), "dock");
	assert.equal(layoutOf("column"), "column");
	assert.equal(layoutOf(null), "column");
	assert.equal(layoutOf("sidebar"), "column", "예전 값이나 오타는 컬럼으로");
	assert.equal(layoutOf(""), "column");
});

test("dock에서 ⌘\\는 창을 여닫고, 줄의 탭을 고르거나 dock에 막 도착하면 창이 열린다", () => {
	assert.equal(shown(true, "toggle"), false);
	assert.equal(shown(false, "toggle"), true);
	assert.equal(shown(false, "pick"), true);
	assert.equal(shown(true, "pick"), true, "이미 열려 있으면 그대로 열려 있다");
	assert.equal(shown(false, "arrive"), true);
	assert.equal(shown(true, "arrive"), true);
});

test("dock의 줄에는 최신 몇 개만 보이고, 현재 세션은 오래됐어도 끝에 보인다", () => {
	const s = (id, current = false) => ({ id, current });
	assert.deepEqual(inRow([s("a"), s("b", true), s("c")], 5).map((x) => x.id), ["a", "b", "c"], "다 들어가면 그대로");
	assert.deepEqual(inRow([s("a"), s("b"), s("c"), s("d", true)], 2).map((x) => x.id), ["a", "b", "d"], "잘린 뒤라도 현재 것은 붙는다");
	assert.deepEqual(inRow([s("a", true), s("b"), s("c")], 2).map((x) => x.id), ["a", "b"], "이미 있으면 두 번 넣지 않는다");
	assert.deepEqual(inRow([], 5), []);
});
