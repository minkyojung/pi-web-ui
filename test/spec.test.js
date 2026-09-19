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

test("지시문은 한 줄을 인용하고, Kiro의 requirements 형식과 우리 단계(이름·폴더·작성·멈춤)를 말한다 — 브랜치는 코드의 일", () => {
  const said = specPrompt({ line: "이메일 인증 추가", prefix: "minkyojung/", branch: "minkyojung/tokyo", taken: [] });
  assert.ok(said.includes('"이메일 인증 추가"'), "그 사람의 말 그대로");
  assert.match(said, /kebab-case/);
  assert.ok(said.includes(".octave/specs/{name}/"), "폴더");
  assert.equal(said.includes("git branch"), false, "브랜치는 모델이 아니라 코드가 바꾼다");
  assert.match(said, /Do not rename the branch or write anything under \.git/);
  assert.match(said, /named after the spec for you/);
  assert.ok(said.includes(".octave/specs/{name}/requirements.md"), "문서");
  assert.match(said, /with write/, "노트가 아니라 write로");
  for (const form of ["# Requirements Document", "## Introduction", "### Requirement 1", "**User Story:** As a [role], I want [feature], so that [benefit]", "#### Acceptance Criteria", "1. WHEN [event] THEN [system] SHALL [response]", "2. IF [precondition] THEN [system] SHALL [response]"]) {
    assert.ok(said.includes(form), `Kiro의 형식: ${form}`);
  }
  assert.match(said, /without asking questions first/i, "초안을 먼저, 묻는 것은 나중에");
  assert.match(said, /SHALL stay as they are, where the form puts them/, "키워드는 영어로, 양식의 자리에 — SHALL이 한국어 어순을 따라 문장 끝으로 가지 않게");
  assert.match(said, /edge cases/);
  assert.match(said, /Do not go on to a design/, "쓰고 나면 멈춘다");
});

test("이미 있는 스펙 이름은 지시문이 피하라고 말하고, 이름이 있는 브랜치는 그대로 두라고 한다", () => {
  const taken = specPrompt({ line: "x", prefix: "", branch: "tokyo", taken: ["email-auth", "sign-in"] });
  assert.ok(taken.includes("email-auth, sign-in"), taken);
  const named = specPrompt({ line: "x", prefix: null, branch: "main", taken: [] });
  assert.ok(named.includes("Leave the branch as it is (main)"), named);
  assert.match(named, /Do not write anything under \.git/);
  assert.equal(named.includes("named after the spec"), false, "main은 이름이 바뀌지 않는다");
  const none = specPrompt({ line: "x", prefix: null, branch: null, taken: [] });
  assert.equal(none.includes("branch"), false, "브랜치가 없으면 말할 것도 없다");
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

/**
 * A pi that records what the command does, in a folder of its own, on a
 * branch of our choosing — `undefined` for a folder that is not a repository.
 * git is answered as a repository would: `branches` are the ones there.
 */
function fakePi(branch, branches = []) {
  const done = [];
  const notes = [];
  const renamed = [];
  const handlers = {};
  const heads = new Set(branches);
  const cwd = mkdtempSync(join(tmpdir(), "spec-fake-"));
  let command;
  const answer = (code, stdout = "") => ({ code, stdout, stderr: "", killed: false });
  const pi = {
    registerCommand: (name, options) => (command = { name, ...options }),
    on: (event, fn) => (handlers[event] = fn),
    exec: async (_git, args) => {
      if (branch === undefined) return answer(128);
      if (args[0] === "branch" && args[1] === "--show-current") return answer(0, `${branch}\n`);
      if (args[0] === "show-ref") return answer(heads.has(args.at(-1).replace("refs/heads/", "")) ? 0 : 1);
      if (args[0] === "branch" && args[1] === "-m") {
        renamed.push(args[2]);
        branch = args[2];
        return answer(0);
      }
      throw new Error(`git ${args.join(" ")} was not expected`);
    },
    sendMessage: (message, options) => done.push({ sendMessage: message, options }),
    sendUserMessage: (content, options) => done.push({ sendUserMessage: content, options }),
  };
  spec(pi);
  const ctx = (idle) => ({ cwd, isIdle: () => idle, ui: { notify: (text, type) => notes.push({ text, type }) } });
  const run = (args, { idle = true } = {}) => command.handler(args, ctx(idle));
  /** The agent writing a spec's first document, as the model would. */
  const write = (name) => {
    mkdirSync(join(cwd, ".octave/specs", name), { recursive: true });
    writeFileSync(join(cwd, ".octave/specs", name, "requirements.md"), "# Requirements Document\n");
  };
  const settle = () => handlers.agent_settled?.({ type: "agent_settled" }, ctx(true));
  const cleanup = () => rmSync(cwd, { recursive: true, force: true });
  return { command: () => command, done, notes, renamed, run, write, settle, cleanup, cwd };
}

test("/spec 한 줄은 그 줄만 대화에 남기고, 지시문은 같은 턴에 모델에게만 간다 — 기다림 없이", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  assert.equal(pi.command().name, "spec");
  assert.ok(pi.command().description);
  await pi.run("  이메일 인증 추가  ");
  assert.deepEqual(pi.notes, []);
  assert.equal(pi.done.length, 2);
  const [hidden, shown] = pi.done;
  assert.equal(hidden.sendMessage.customType, "spec");
  assert.equal(hidden.sendMessage.display, false, "화면에는 안 보인다");
  assert.equal(hidden.options.deliverAs, "nextTurn", "다음 턴, 곧 아래 한 줄의 턴에 붙는다 — 그래서 먼저 보낸다");
  assert.match(hidden.sendMessage.content, /named after the spec for you/);
  assert.ok(hidden.sendMessage.content.includes('"이메일 인증 추가"'));
  assert.equal(shown.sendUserMessage, "/spec 이메일 인증 추가", "보이는 것은 친 한 줄");
  assert.equal(shown.options, undefined, "명령으로 다시 읽히지 않는 보통 메시지로");
  assert.deepEqual(pi.renamed, [], "이름은 턴이 끝난 뒤에");
});

test("할 말이 없거나 에이전트가 일하는 중이면 알리기만 하고 턴을 시작하지 않는다", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  await pi.run("   ");
  assert.equal(pi.notes.length, 1);
  assert.match(pi.notes[0].text, /\/spec/);
  await pi.run("이메일 인증 추가", { idle: false });
  assert.equal(pi.notes.length, 2);
  assert.equal(pi.notes[1].type, "warning");
  assert.deepEqual(pi.done, []);
});

test("git이 아닌 곳에서도 스펙은 쓰고, 브랜치는 말하지도 바꾸지도 않는다", async (t) => {
  const pi = fakePi(undefined);
  t.after(pi.cleanup);
  await pi.run("이메일 인증 추가");
  assert.equal(pi.done[0].sendMessage.content.includes("branch"), false);
  assert.equal(pi.done[1].sendUserMessage, "/spec 이메일 인증 추가");
  pi.write("email-auth");
  await pi.settle();
  assert.deepEqual(pi.renamed, []);
  assert.deepEqual(pi.notes, []);
});

// --- the branch, named by the code once the spec is written ---

test("스펙이 쓰인 턴이 끝나면 코드가 도시 브랜치를 그 이름으로 바꾸고 알린다 — 한 번만", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  await pi.run("이메일 인증 추가");
  pi.write("email-auth");
  await pi.settle();
  assert.deepEqual(pi.renamed, ["minkyojung/email-auth"]);
  assert.deepEqual(pi.notes, [{ text: "The branch is minkyojung/email-auth now.", type: "info" }]);
  // The next turn, a spec or not, is not this one's.
  pi.write("second");
  await pi.settle();
  assert.deepEqual(pi.renamed, ["minkyojung/email-auth"]);
});

test("그 이름의 브랜치가 이미 있으면 git처럼 -2, -3을 붙인다", async (t) => {
  const pi = fakePi("minkyojung/tokyo", ["minkyojung/email-auth", "minkyojung/email-auth-2"]);
  t.after(pi.cleanup);
  await pi.run("이메일 인증 추가");
  pi.write("email-auth");
  await pi.settle();
  assert.deepEqual(pi.renamed, ["minkyojung/email-auth-3"]);
});

test("쓴 스펙이 없거나, 이름이 있는 브랜치거나, /spec의 턴이 아니면 바꾸지 않는다", async (t) => {
  const nothing = fakePi("minkyojung/tokyo");
  t.after(nothing.cleanup);
  await nothing.run("이메일 인증 추가");
  await nothing.settle();
  assert.deepEqual(nothing.renamed, [], "문서를 쓰지 않은 턴");

  const main = fakePi("main");
  t.after(main.cleanup);
  await main.run("이메일 인증 추가");
  main.write("email-auth");
  await main.settle();
  assert.deepEqual(main.renamed, [], "main");

  const unasked = fakePi("minkyojung/tokyo");
  t.after(unasked.cleanup);
  unasked.write("email-auth");
  await unasked.settle();
  assert.deepEqual(unasked.renamed, [], "/spec 없이 생긴 폴더");

  const before = fakePi("minkyojung/tokyo");
  t.after(before.cleanup);
  before.write("email-auth");
  await before.run("이메일 인증 추가");
  await before.settle();
  assert.deepEqual(before.renamed, [], "이미 있던 스펙은 이 턴이 쓴 것이 아니다");
});

// --- the command in a real pi session, on a model that is not one ---

test("실제 pi 세션에서: 한 줄은 사람의 메시지로, 지시문은 그 턴에 모델에게만 가고, 스펙이 쓰이면 git이 브랜치를 바꾼다", async (t) => {
  const { InMemoryCredentialStore, fauxAssistantMessage, fauxProvider, fauxToolCall } = await import("@earendil-works/pi-ai");
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const { execFileSync } = await import("node:child_process");
  const cwd = mkdtempSync(join(tmpdir(), "spec-session-"));
  const agentDir = mkdtempSync(join(tmpdir(), "spec-agent-"));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  });
  // A workspace as Octave makes one: a repository on a city's branch.
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "minkyojung/tokyo");
  writeFileSync(join(cwd, "README.md"), "# app\n");
  git("add", "-A");
  git("commit", "-q", "-m", "app");

  const faux = fauxProvider();
  let asked = null;
  // The model names it and writes it, and says so: the branch is none of its business.
  faux.setResponses([
    (context) => (
      (asked = context.messages),
      fauxAssistantMessage(fauxToolCall("write", { path: ".octave/specs/email-auth/requirements.md", content: "# Requirements Document\n" }), { stopReason: "toolUse" })
    ),
    fauxAssistantMessage("I wrote the requirements."),
  ]);
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

  // pi tells its subscribers the run has settled only once every extension's
  // own settling is done — the rename among them — so that is what to wait for.
  let settled = false;
  session.subscribe((event) => {
    if (event.type === "agent_settled") settled = true;
  });
  await session.prompt("/spec 이메일 인증 추가");
  const deadline = Date.now() + 20_000;
  while (!settled && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.ok(settled, "the run settled");
  assert.ok(asked, "모델이 불렸다 — 기다림 없이");

  // What the model was sent: the line, then the instructions beside it, in the same turn.
  const texts = asked.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join("")));
  const line = texts.findIndex((text) => text === "/spec 이메일 인증 추가");
  const told = texts.findIndex((text) => text.includes("named after the spec for you"));
  assert.ok(line >= 0, `the line among ${JSON.stringify(texts)}`);
  assert.ok(told > line, "지시문은 그 줄 뒤, 같은 턴에");
  assert.ok(texts[told].includes('"이메일 인증 추가"'));

  // What the conversation keeps: the line as the person's, the instructions not shown.
  const kept = session.messages.filter((m) => m.role === "user" || m.role === "custom");
  assert.deepEqual(kept.map((m) => m.role), ["user", "custom"]);
  assert.equal(kept[1].customType, "spec");
  assert.equal(kept[1].display, false);

  // And the branch, renamed by git itself: the city's is gone, not left beside it.
  assert.equal(git("branch", "--show-current"), "minkyojung/email-auth");
  assert.deepEqual(git("branch", "--format=%(refname:short)").split("\n"), ["minkyojung/email-auth"]);
  assert.match(git("reflog", "-1", "--format=%gs"), /renamed refs\/heads\/minkyojung\/tokyo to refs\/heads\/minkyojung\/email-auth/, "git's own record of it");
});
