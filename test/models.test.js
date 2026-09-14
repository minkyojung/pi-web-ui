import assert from "node:assert/strict";
import test from "node:test";

import { clampLevel, loadoutOf, lostProviders, modelsNotice, providersOf, supportedLevels } from "../models.ts";

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

test("생각 단계는 모델이 내주는 지도를 따른다 — null은 못 하는 것, 빠진 xhigh/max도 못 하는 것", () => {
  assert.deepEqual(supportedLevels({ reasoning: false }), ["off"], "생각하지 않는 모델은 단계가 하나뿐이다");
  assert.deepEqual(
    supportedLevels({
      reasoning: true,
      thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
    }),
    ["off", "low", "medium", "high", "xhigh", "max"],
    "gpt-5.6-sol: minimal만 못 한다",
  );
  assert.deepEqual(
    supportedLevels({
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: null, max: null },
    }),
    ["minimal", "low", "medium", "high"],
    "gpt-5: 끌 수도 없고 xhigh 위로도 못 간다",
  );
  assert.deepEqual(
    supportedLevels({ reasoning: true }),
    ["off", "minimal", "low", "medium", "high"],
    "지도가 없으면 기본값이 서지만, xhigh와 max는 이름이 불려야만 선다",
  );
});

test("못 하는 단계를 시키면 더 센 쪽으로 올라가고, 위가 없을 때만 내려온다", () => {
  const levels = ["low", "medium", "high"];
  assert.equal(clampLevel(levels, "high"), "high", "할 수 있으면 그대로");
  assert.equal(clampLevel(levels, "off"), "low", "덜 생각하라고 해도 최소가 low면 low");
  assert.equal(clampLevel(levels, "max"), "high", "위가 없으면 그때 내려온다");
  assert.equal(clampLevel(levels, "그런 단계 없음"), "low");
  assert.equal(clampLevel([], "high"), "off", "단계가 아예 없으면 off");
});

test("고른 것이 없으면 씨앗 목록이 서고, 없는 모델은 빠진다", () => {
  const available = ["openai/gpt-5.6-sol", "openai/gpt-5.5", "anthropic/claude-opus-5"];
  assert.deepEqual(
    loadoutOf([], available, "openai/gpt-5.6-sol"),
    ["openai/gpt-5.6-sol", "openai/gpt-5.5"],
    "씨앗 중 pi가 내주는 것만, 씨앗의 순서대로",
  );
  assert.deepEqual(loadoutOf([], [], null), [], "내주는 모델이 없으면 빈 목록이지 씨앗이 아니다");
});

test("지금 쓰는 모델은 고르지 않았어도 목록에 있다 — 두 번은 아니고", () => {
  const available = ["openai/gpt-5.5", "anthropic/claude-opus-5"];
  assert.deepEqual(
    loadoutOf(["openai/gpt-5.5"], available, "anthropic/claude-opus-5"),
    ["openai/gpt-5.5", "anthropic/claude-opus-5"],
    "CLI가 남겨둔 모델이라도 목록에 선다",
  );
  assert.deepEqual(
    loadoutOf(["openai/gpt-5.5"], available, "openai/gpt-5.5"),
    ["openai/gpt-5.5"],
    "이미 있으면 다시 넣지 않는다",
  );
  assert.deepEqual(loadoutOf(["없는/모델"], available, null), [], "고른 것이 다 사라졌으면 빈 목록");
});
