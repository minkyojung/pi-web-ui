import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import spec, { specPrompt, takenSpecs, unnamed } from "../spec.ts";

test("아직 도시 이름인 브랜치만 이름을 바꿀 자리다 — main이나 이미 이름이 있는 브랜치는 그대로", () => {
  assert.equal(unnamed("minkyojung/tokyo"), "minkyojung/", "소유자는 남기고 도시만 바꾼다");
  assert.equal(unnamed("tokyo"), "", "소유자가 없으면 이름만");
  assert.equal(unnamed("minkyojung/lisbon-v2"), "minkyojung/", "도시가 다 쓰인 뒤의 이름도 도시다");
  assert.equal(unnamed("main"), null);
  assert.equal(unnamed("minkyojung/email-auth"), null, "한 번 바뀐 브랜치는 다시 바꾸지 않는다");
  assert.equal(unnamed("feature/tokyo-trip"), null, "도시로 시작할 뿐인 이름");
  assert.equal(unnamed(null), null, "브랜치가 없는 곳(분리된 HEAD, git 아님)");
});

test("지시문은 한 줄을 인용하고, Kiro의 requirements 형식과 우리 단계(이름·폴더·브랜치·작성·멈춤)를 말한다", () => {
  const said = specPrompt({ line: "이메일 인증 추가", prefix: "minkyojung/", branch: "minkyojung/tokyo", taken: [] });
  assert.ok(said.includes('"이메일 인증 추가"'), "그 사람의 말 그대로");
  assert.match(said, /kebab-case/);
  assert.ok(said.includes(".octave/specs/{name}/"), "폴더");
  assert.ok(said.includes("git branch -m minkyojung/{name}"), "브랜치: 소유자 뒤에 이름");
  assert.ok(said.includes(".octave/specs/{name}/requirements.md"), "문서");
  assert.match(said, /with write/, "노트가 아니라 write로");
  for (const form of ["# Requirements Document", "## Introduction", "### Requirement 1", "**User Story:** As a [role], I want [feature], so that [benefit]", "#### Acceptance Criteria", "1. WHEN [event] THEN [system] SHALL [response]", "2. IF [precondition] THEN [system] SHALL [response]"]) {
    assert.ok(said.includes(form), `Kiro의 형식: ${form}`);
  }
  assert.match(said, /without asking questions first/i, "초안을 먼저, 묻는 것은 나중에");
  assert.match(said, /edge cases/);
  assert.match(said, /Do not go on to a design/, "쓰고 나면 멈춘다");
});

test("이미 있는 스펙 이름은 지시문이 피하라고 말하고, 바꿀 브랜치가 없으면 브랜치 단계가 없다", () => {
  const taken = specPrompt({ line: "x", prefix: "", branch: "tokyo", taken: ["email-auth", "sign-in"] });
  assert.ok(taken.includes("email-auth, sign-in"), taken);
  assert.ok(taken.includes("git branch -m {name}"), "소유자가 없는 브랜치");
  const named = specPrompt({ line: "x", prefix: null, branch: "main", taken: [] });
  assert.equal(named.includes("git branch"), false, "main은 건드리지 않는다");
  assert.ok(named.includes("Leave the branch as it is (main)"), named);
  const none = specPrompt({ line: "x", prefix: null, branch: null, taken: [] });
  assert.equal(none.includes("git branch"), false);
  assert.equal(none.includes("Leave the branch"), false, "브랜치가 없으면 말할 것도 없다");
});

test("이미 있는 스펙은 .octave/specs/ 아래의 폴더들이다", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "spec-taken-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(takenSpecs(dir), [], "폴더가 없으면 없다");
  mkdirSync(join(dir, ".octave/specs/sign-in"), { recursive: true });
  mkdirSync(join(dir, ".octave/specs/email-auth"));
  writeFileSync(join(dir, ".octave/specs/stray.md"), "x");
  assert.deepEqual(takenSpecs(dir), ["email-auth", "sign-in"]);
});

// --- the command, as pi would run it ---

/** A pi that records what the command does, on a branch of our choosing. */
function fakePi(branch) {
  const done = [];
  let command;
  const pi = {
    registerCommand: (name, options) => (command = { name, ...options }),
    exec: async () => (branch === undefined ? { code: 128, stdout: "", stderr: "fatal: not a git repository", killed: false } : { code: 0, stdout: `${branch}\n`, stderr: "", killed: false }),
    sendMessage: (message, options) => done.push({ sendMessage: message, options }),
    sendUserMessage: (content, options) => done.push({ sendUserMessage: content, options }),
  };
  spec(pi);
  const run = (args, { idle = true, cwd = tmpdir() } = {}) => {
    const notes = [];
    return command.handler(args, { cwd, isIdle: () => idle, ui: { notify: (text, type) => notes.push({ text, type }) } }).then(() => notes);
  };
  return { command: () => command, done, run };
}

test("/spec 한 줄은 그 줄만 대화에 남기고, 지시문은 같은 턴에 모델에게만 간다 — 기다림 없이", async () => {
  const pi = fakePi("minkyojung/tokyo");
  assert.equal(pi.command().name, "spec");
  assert.ok(pi.command().description);
  const notes = await pi.run("  이메일 인증 추가  ");
  assert.deepEqual(notes, []);
  assert.equal(pi.done.length, 2);
  const [hidden, shown] = pi.done;
  assert.equal(hidden.sendMessage.customType, "spec");
  assert.equal(hidden.sendMessage.display, false, "화면에는 안 보인다");
  assert.equal(hidden.options.deliverAs, "nextTurn", "다음 턴, 곧 아래 한 줄의 턴에 붙는다 — 그래서 먼저 보낸다");
  assert.ok(hidden.sendMessage.content.includes("git branch -m minkyojung/{name}"));
  assert.ok(hidden.sendMessage.content.includes('"이메일 인증 추가"'));
  assert.equal(shown.sendUserMessage, "/spec 이메일 인증 추가", "보이는 것은 친 한 줄");
  assert.equal(shown.options, undefined, "명령으로 다시 읽히지 않는 보통 메시지로");
});

test("할 말이 없거나 에이전트가 일하는 중이면 알리기만 하고 턴을 시작하지 않는다", async () => {
  const pi = fakePi("minkyojung/tokyo");
  const empty = await pi.run("   ");
  assert.equal(empty.length, 1);
  assert.match(empty[0].text, /\/spec/);
  const busy = await pi.run("이메일 인증 추가", { idle: false });
  assert.equal(busy.length, 1);
  assert.equal(busy[0].type, "warning");
  assert.deepEqual(pi.done, []);
});

test("git이 아닌 곳에서도 스펙은 쓰고, 브랜치 단계만 빠진다", async () => {
  const pi = fakePi(undefined);
  await pi.run("이메일 인증 추가");
  assert.equal(pi.done[0].sendMessage.content.includes("git branch"), false);
  assert.equal(pi.done[1].sendUserMessage, "/spec 이메일 인증 추가");
});

// --- the command in a real pi session, on a model that is not one ---

test("실제 pi 세션에서: /spec 한 줄은 사람의 메시지로 남고, 지시문은 그 턴에 모델에게만 간다", async (t) => {
  const { InMemoryCredentialStore, fauxAssistantMessage, fauxProvider } = await import("@earendil-works/pi-ai");
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const { execFileSync } = await import("node:child_process");
  const cwd = mkdtempSync(join(tmpdir(), "spec-session-"));
  const agentDir = mkdtempSync(join(tmpdir(), "spec-agent-"));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  });
  // A workspace as Octave makes one: a repository on a city's branch.
  execFileSync("git", ["init", "-q", "-b", "minkyojung/tokyo"], { cwd });

  const faux = fauxProvider();
  let asked = null;
  faux.setResponses([(context) => ((asked = context.messages), fauxAssistantMessage("I wrote the requirements."))]);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: [
      { name: "faux", factory: (pi) => pi.registerProvider(faux.provider) },
      { name: "spec", factory: spec },
    ],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  const { session } = await createAgentSession({ cwd, agentDir, model: faux.getModel(), thinkingLevel: "off", modelRuntime, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
  t.after(() => session.dispose?.());

  await session.prompt("/spec 이메일 인증 추가");
  const deadline = Date.now() + 10_000;
  while ((asked === null || session.isStreaming) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.ok(asked, "모델이 불렸다 — 기다림 없이");

  // What the model was sent: the line, then the instructions beside it, in the same turn.
  const texts = asked.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join("")));
  const line = texts.findIndex((text) => text === "/spec 이메일 인증 추가");
  const told = texts.findIndex((text) => text.includes("git branch -m minkyojung/{name}"));
  assert.ok(line >= 0, `the line among ${JSON.stringify(texts)}`);
  assert.ok(told > line, "지시문은 그 줄 뒤, 같은 턴에");
  assert.ok(texts[told].includes('"이메일 인증 추가"'));

  // What the conversation keeps: the line as the person's, the instructions not shown.
  const kept = session.messages.filter((m) => m.role === "user" || m.role === "custom");
  assert.deepEqual(kept.map((m) => m.role), ["user", "custom"]);
  assert.equal(kept[1].customType, "spec");
  assert.equal(kept[1].display, false);
});
