/**
 * The bridge between pi's login() and the tabs — login.ts — with a stand-in
 * for pi: what pi asks reaches the tabs, the first answer settles it, a
 * cancel reaches pi as its signal, and a question pi withdraws is withdrawn.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createLoginBridge } from "../login.ts";

const harness = () => {
  const out = [];
  const opened = [];
  let interaction;
  let finish;
  const bridge = createLoginBridge(
    (m) => out.push(m),
    (_provider, _method, i) => {
      interaction = i;
      return new Promise((resolve, reject) => {
        finish = { resolve, reject };
        i.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
    (url) => opened.push(url),
  );
  return { out, opened, bridge, pi: () => interaction, finish: () => finish };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

test("pi가 묻는 것은 login_prompt로 나가고, 답이 오면 pi에게 돌아가며, 끝나면 login_done", async () => {
  const h = harness();
  const started = h.bridge.start("openai", "api_key");
  await tick();
  assert.equal(h.bridge.busy(), "openai");
  const answer = h.pi().prompt({ type: "secret", message: "API key" });
  const asked = h.out.find((m) => m.type === "login_prompt");
  assert.deepEqual({ ...asked.prompt, id: undefined }, { id: undefined, provider: "openai", type: "secret", message: "API key" });
  assert.equal(h.bridge.open().id, asked.prompt.id, "접속하는 탭에게 다시 보여줄 질문");
  h.bridge.answer(asked.prompt.id, "sk-x", false);
  assert.equal(await answer, "sk-x");
  assert.equal(h.bridge.open(), null);
  h.finish().resolve({ type: "api_key", key: "sk-x" });
  assert.equal(await started, true);
  assert.deepEqual(h.out.at(-1), { type: "login_done", provider: "openai", ok: true });
  assert.equal(h.bridge.busy(), null);
});

test("pi가 말하는 것은 login_event로 나가고, 열 URL은 열어주는 손에도 간다", async () => {
  const h = harness();
  const started = h.bridge.start("anthropic", "oauth");
  await tick();
  h.pi().notify({ type: "auth_url", url: "https://example.test/auth" });
  h.pi().notify({ type: "progress", message: "waiting" });
  assert.deepEqual(h.opened, ["https://example.test/auth"]);
  assert.deepEqual(h.out.filter((m) => m.type === "login_event").map((m) => m.event.type), ["auth_url", "progress"]);
  h.finish().resolve({});
  await started;
});

test("취소하면 pi의 signal이 끊기고 기다리던 질문은 거절되며, login_done은 ok도 error도 아니다", async () => {
  const h = harness();
  const started = h.bridge.start("openai", "api_key");
  await tick();
  const answer = h.pi().prompt({ type: "secret", message: "API key" });
  const asked = h.out.find((m) => m.type === "login_prompt");
  h.bridge.answer(asked.prompt.id, undefined, true);
  await assert.rejects(answer, { name: "LoginCancelled" });
  assert.equal(await started, false);
  assert.deepEqual(h.out.at(-1), { type: "login_done", provider: "openai", ok: false, error: undefined });
  assert.equal(h.bridge.busy(), null, "다음 로그인을 받을 수 있다");
});

test("pi가 실패하면 그 말이 login_done에 실리고, 던지지 않는다", async () => {
  const h = harness();
  const started = h.bridge.start("openai", "api_key");
  await tick();
  h.finish().reject(new Error("Invalid API key"));
  assert.equal(await started, false);
  assert.deepEqual(h.out.at(-1), { type: "login_done", provider: "openai", ok: false, error: "Invalid API key" });
});

test("pi가 질문을 거두면 login_prompt_dismiss가 나가고 그 질문은 끝난다", async () => {
  const h = harness();
  const started = h.bridge.start("anthropic", "oauth");
  await tick();
  const ctl = new AbortController();
  const answer = h.pi().prompt({ type: "manual_code", message: "Paste the code", signal: ctl.signal });
  const asked = h.out.find((m) => m.type === "login_prompt");
  assert.equal("signal" in asked.prompt, false, "signal은 선을 타지 않는다");
  ctl.abort();
  await assert.rejects(answer, { name: "LoginCancelled" });
  assert.deepEqual(h.out.at(-1), { type: "login_prompt_dismiss", id: asked.prompt.id });
  assert.equal(h.bridge.open(), null);
  h.finish().resolve({});
  await started;
});

test("한 번에 하나: 진행 중에 또 시작하면 거절된다", async () => {
  const h = harness();
  const started = h.bridge.start("openai", "api_key");
  await tick();
  await assert.rejects(h.bridge.start("anthropic", "oauth"), /Already signing in to openai/);
  h.finish().resolve({});
  await started;
});
