import assert from "node:assert/strict";
import test from "node:test";

import { lostProviders, modelsNotice, providersOf } from "../models.ts";

test("제공자는 모델 키의 앞부분이고, 하나씩, 정렬되어 나온다", () => {
  assert.deepEqual(providersOf(["openai/gpt-5", "anthropic/claude-opus-4-8", "openai/o3"]), ["anthropic", "openai"]);
  assert.deepEqual(providersOf([]), []);
});

test("있다가 없어진 제공자만 잃은 것이다 — 새로 생긴 것은 아니다", () => {
  const before = ["anthropic/a", "openai/b"];
  assert.deepEqual(lostProviders(before, ["anthropic/a"]), ["openai"]);
  assert.deepEqual(lostProviders(before, ["anthropic/a", "openai/c", "google/g"]), []);
  assert.deepEqual(lostProviders([], ["anthropic/a"]), [], "처음부터 없던 것은 잃은 것이 아니다");
});

test("알릴 말: pi의 오류가 먼저, 다음이 사라진 제공자, 아니면 아무 말도 없다", () => {
  assert.equal(modelsNotice([], undefined), undefined);
  assert.match(modelsNotice(["openai"], undefined), /openai.*could not be read/);
  assert.equal(modelsNotice(["openai"], "Availability refresh: boom"), "Availability refresh: boom", "pi가 말한 것이 우선");
});
