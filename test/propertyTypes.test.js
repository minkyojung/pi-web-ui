import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { coerceRegistry, fits, inferType, isReserved, typeOf } from "../propertyTypes.ts";
import { PropertyRegistry, REGISTRY_PATH } from "../propertyRegistry.ts";

test("값의 생김새로 짐작한다: 참거짓, 숫자, 목록, 날짜, 날짜와 시간, 나머지는 글자", () => {
  assert.equal(inferType(true), "checkbox");
  assert.equal(inferType(3), "number");
  assert.equal(inferType(["a"]), "list");
  assert.equal(inferType("2024-01-01"), "date");
  assert.equal(inferType("2024-01-01T10:30"), "datetime");
  assert.equal(inferType("2024-01-01T10:30:00"), "datetime");
  assert.equal(inferType("2024-1-1"), "text");
  assert.equal(inferType("hello"), "text");
  assert.equal(inferType(null), "text");
  assert.equal(inferType({ a: 1 }), "text");
});

test("이름이 먼저다: 예약된 이름, 고른 것, 그 다음이 짐작; 이름의 대소문자는 하나다", () => {
  const chosen = { pages: "number" };
  assert.equal(typeOf("tags", "a", chosen), "tags");
  assert.equal(typeOf("Aliases", "a", chosen), "list");
  assert.equal(typeOf("pages", "12", chosen), "number");
  assert.equal(typeOf("Pages", "12", chosen), "number");
  assert.equal(typeOf("other", "12", chosen), "text");
  assert.equal(typeOf("other", 12, chosen), "number");
  assert.ok(isReserved("Tags") && !isReserved("pages"));
});

test("값이 타입에 맞는지: 빈 값은 무엇에든 맞고, 글자는 하나짜리 목록까지", () => {
  assert.ok(fits("number", 1) && !fits("number", "1"));
  assert.ok(fits("checkbox", false) && !fits("checkbox", "false"));
  assert.ok(fits("date", "2024-01-01") && !fits("date", "yesterday"));
  assert.ok(fits("datetime", "2024-01-01T10:30") && fits("datetime", "2024-01-01"));
  assert.ok(fits("list", ["a", 1]) && fits("list", "a") && !fits("list", [{ a: 1 }]));
  assert.ok(fits("tags", ["a"]) && !fits("tags", { a: 1 }));
  assert.ok(fits("text", "a") && fits("text", 1) && fits("text", ["one"]) && !fits("text", ["a", "b"]) && !fits("text", { a: 1 }));
  for (const t of ["text", "list", "number", "checkbox", "date", "datetime", "tags"]) assert.ok(fits(t, null));
});

test("파일은 믿지 않는다: 항목마다 따로 읽고, 모르는 타입과 예약된 이름은 버린다", () => {
  assert.deepEqual(coerceRegistry({ types: { Pages: "number", when: "date", tags: "text", odd: "blob", "": "text" } }), { pages: "number", when: "date" });
  assert.deepEqual(coerceRegistry(null), {});
  assert.deepEqual(coerceRegistry({ types: "no" }), {});
});

test("등록부는 .pi/properties.json에 고른 것만 Obsidian의 모양으로; 예약된 이름은 거부; 깨진 파일은 빈 것", () => {
  const root = mkdtempSync(join(tmpdir(), "props-"));
  try {
    const reg = new PropertyRegistry(root);
    reg.load();
    assert.deepEqual(reg.all(), {});
    assert.equal(reg.set("Pages", "number"), true);
    assert.equal(reg.set("tags", "text"), false);
    assert.deepEqual(JSON.parse(readFileSync(join(root, REGISTRY_PATH), "utf8")), { types: { pages: "number" } });
    assert.equal(reg.set("pages", null), true);
    assert.deepEqual(reg.all(), {});
    const again = new PropertyRegistry(root);
    again.load();
    assert.deepEqual(again.all(), {});
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(join(root, REGISTRY_PATH), "{ not json");
    const broken = new PropertyRegistry(root);
    broken.load();
    assert.deepEqual(broken.all(), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
