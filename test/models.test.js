import assert from "node:assert/strict";
import test from "node:test";

import { clampLevel, isUnknownModel, loadoutOf, lostProviders, modelsNotice, placesOf, providerInfo, providersOf, supportedLevels } from "../models.ts";

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

test("unknown/unknown은 pi의 자리표시이고, 모델이 없다는 뜻이다", () => {
  assert.equal(isUnknownModel({ provider: "unknown", id: "unknown" }), true);
  assert.equal(isUnknownModel({ provider: "openai", id: "gpt-5" }), false);
  assert.equal(isUnknownModel(undefined), false);
});

test("제공자 한 줄: 로그인할 길이 oauth/api_key로 나뉘고, 물어볼 수 없는 api_key는 길이 아니며, 길도 없고 로그인도 안 됐으면 빠진다", () => {
  const both = { id: "anthropic", name: "Anthropic", auth: { oauth: {}, apiKey: { login() {} } } };
  const keyOnly = { id: "openai", name: "OpenAI", auth: { apiKey: { login() {} } } };
  const ambient = { id: "bedrock", name: "Bedrock", auth: { apiKey: {} } };
  assert.deepEqual(providerInfo(both, { configured: false }, false), { id: "anthropic", name: "Anthropic", methods: ["oauth", "api_key"], signedIn: null });
  assert.deepEqual(providerInfo(both, { configured: true, source: "stored" }, true, "sk-ant-oat-xyz").signedIn, { method: "oauth", source: "stored" }, "OAuth 토큰은 키가 아니니 꼬리가 없다");
  assert.deepEqual(providerInfo(keyOnly, { configured: true, source: "stored" }, false, "sk-proj-abcdef9f2a").signedIn, { method: "api_key", source: "stored", keyTail: "9f2a" });
  assert.deepEqual(providerInfo(keyOnly, { configured: true, source: "environment", label: "OPENAI_API_KEY" }, false), {
    id: "openai", name: "OpenAI", methods: ["api_key"], signedIn: { method: "api_key", source: "OPENAI_API_KEY" },
  }, "환경변수로 들어온 키는 그 변수 이름으로 말한다");
  assert.equal(providerInfo(ambient, { configured: false }, false), null, "여기서 할 수 있는 것도 없고 된 것도 없으면 줄이 없다");
  assert.deepEqual(providerInfo(ambient, { configured: true, source: "environment", label: "AWS_PROFILE" }, false).methods, [], "됐지만 여기서 한 것은 아니다");
});

test("알릴 말: pi의 오류가 먼저, 다음이 빈 목록, 다음이 사라진 제공자, 아니면 아무 말도 없다", () => {
  const some = ["openai/gpt-5"];
  assert.equal(modelsNotice([], undefined, some), undefined);
  assert.match(modelsNotice(["openai"], undefined, some), /openai.*could not be read/);
  assert.equal(modelsNotice(["openai"], "Availability refresh: boom", some), "Availability refresh: boom", "pi가 말한 것이 우선");
  assert.match(modelsNotice([], undefined, []), /No provider is signed in/, "첫 실행: 아무 제공자도 없다");
  assert.match(modelsNotice(["openai"], undefined, []), /No provider is signed in/, "전부 사라진 것은 '없다'로 말한다");
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

test("로드아웃 화면이 고치는 목록은 고른 것 전부다 — 지금 pi가 내주지 않는 모델도", () => {
  const available = ["openai/gpt-5.5"];
  const chosen = ["anthropic/claude-fable-5", "openai/gpt-5.5"];
  assert.deepEqual(placesOf(chosen, available), chosen, "로그아웃한 제공자의 모델도 자리를 지킨다");
  assert.notEqual(placesOf(chosen, available), chosen, "받은 배열을 그대로 내주지 않는다");
  assert.deepEqual(placesOf([], ["openai/gpt-5.5", "openai/gpt-5.6-sol"]), ["openai/gpt-5.6-sol", "openai/gpt-5.5"], "고른 것이 없으면 씨앗 중 내주는 것만");
  assert.deepEqual(placesOf([], []), []);
});
