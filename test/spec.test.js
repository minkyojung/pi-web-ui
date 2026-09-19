import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

import spec, { nextPrompt, specPrompt, takenSpecs, unnamed } from "../spec.ts";
import { approve, specState } from "../specApproval.ts";

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
  assert.match(said, /Do not ask them to approve it/, "묻지 않는다 — 사람이 준비됐을 때 승인한다");
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

/** What the code says once a turn leaves the requirements waiting. */
const WAITING = { text: ".octave/specs/email-auth/requirements.md is waiting for you: read it, and when it is right, approve it with /spec-approve.", type: "info" };

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
  const commands = {};
  const answer = (code, stdout = "") => ({ code, stdout, stderr: "", killed: false });
  const pi = {
    registerCommand: (name, options) => (commands[name] = { name, ...options }),
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
  const run = (args, { idle = true } = {}) => commands.spec.handler(args, ctx(idle));
  const approveCommand = (args = "", { idle = true } = {}) => commands["spec-approve"].handler(args, ctx(idle));
  /** The agent writing a spec's first document, as the model would. */
  const write = (name) => {
    mkdirSync(join(cwd, ".octave/specs", name), { recursive: true });
    writeFileSync(join(cwd, ".octave/specs", name, "requirements.md"), "# Requirements Document\n");
  };
  const start = () => handlers.agent_start?.({ type: "agent_start" }, ctx(false));
  /** What the extension puts beside a message the person sends, before the model sees it. */
  const beside = () => handlers.before_agent_start?.({ type: "before_agent_start", prompt: "x", systemPrompt: "" }, ctx(false));
  const settle = () => handlers.agent_settled?.({ type: "agent_settled" }, ctx(true));
  /** A tool called with a path, as pi would put it to the extension before running it. */
  const call = (toolName, path) => handlers.tool_call?.({ type: "tool_call", toolCallId: "call-1", toolName, input: { path, content: "x" } }, ctx(true));
  const cleanup = () => rmSync(cwd, { recursive: true, force: true });
  return { command: () => commands.spec, commands, done, notes, renamed, run, approve: approveCommand, write, start, beside, settle, call, cleanup, cwd };
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
  assert.deepEqual(pi.notes, [WAITING], "브랜치 말은 없고, 기다리는 문서만");
});

// --- the branch, named by the code once the spec is written ---

test("스펙이 쓰인 턴이 끝나면 코드가 도시 브랜치를 그 이름으로 바꾸고 알린다 — 한 번만", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  await pi.run("이메일 인증 추가");
  pi.write("email-auth");
  await pi.settle();
  assert.deepEqual(pi.renamed, ["minkyojung/email-auth"]);
  assert.deepEqual(pi.notes, [{ text: "The branch is minkyojung/email-auth now.", type: "info" }, WAITING], "브랜치, 그리고 기다리는 문서");
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

// --- the order, kept by the code ---

/** A spec's document written into the fake's folder, as the agent or the person would. */
const put = (pi, doc, text = `# ${doc}\n`) => {
  mkdirSync(join(pi.cwd, ".octave/specs/email-auth"), { recursive: true });
  writeFileSync(join(pi.cwd, ".octave/specs/email-auth", doc), text);
};

test("승인 전에는 다음 문서를 쓸 수 없다 — 코드가 거절하고, 모델이 알아들을 이유를 준다", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  const design = ".octave/specs/email-auth/design.md";
  const tasks = ".octave/specs/email-auth/tasks.md";

  assert.equal(await pi.call("write", ".octave/specs/email-auth/requirements.md"), undefined, "첫 문서는 언제나");
  const early = await pi.call("write", design);
  assert.equal(early?.block, true, "요구사항도 없이 설계");
  assert.match(early.reason, /requirements\.md is not written yet/);

  put(pi, "requirements.md");
  for (const tool of ["write", "edit"]) {
    const refused = await pi.call(tool, design);
    assert.equal(refused?.block, true, tool);
    assert.match(refused.reason, /design\.md comes after requirements\.md, which the person has not approved/);
    assert.match(refused.reason, /\/spec-approve/, "무엇을 기다리는지");
    assert.match(refused.reason, /Do not ask them to approve it/, "묻지 않는다");
  }

  approve(pi.cwd, "email-auth");
  assert.equal(await pi.call("write", design), undefined, "승인하면 설계");
  assert.equal((await pi.call("write", tasks))?.block, true, "작업 목록은 아직 — 설계가 없다");
  put(pi, "design.md");
  assert.match((await pi.call("write", tasks)).reason, /tasks\.md comes after design\.md/);
  approve(pi.cwd, "email-auth");
  assert.equal(await pi.call("write", tasks), undefined);
});

test("모델이 적을 수 있는 경로의 모양은 전부 같은 파일이다", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  put(pi, "requirements.md");
  const shapes = [
    join(pi.cwd, ".octave/specs/email-auth/design.md"),
    "./.octave/specs/email-auth/design.md",
    "@.octave/specs/email-auth/design.md",
    ".octave/specs/other/../email-auth/design.md",
    ".octave/specs/email-auth/Design.md",
    ".Octave/Specs/email-auth/DESIGN.md",
  ];
  for (const path of shapes) assert.equal((await pi.call("write", path))?.block, true, path);
  // pi writes ~ as the home folder: only a folder under it can be named that way.
  if (pi.cwd.startsWith(`${homedir()}/`)) {
    assert.equal((await pi.call("write", `~${pi.cwd.slice(homedir().length)}/.octave/specs/email-auth/design.md`))?.block, true, "~");
  }
});

test("승인한 문서를 고치면 뒤 문서도 다시 막힌다 — 앞 문서를 고치는 것은 언제나 된다", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  for (const doc of ["requirements.md", "design.md", "tasks.md"]) {
    put(pi, doc);
    approve(pi.cwd, "email-auth");
  }
  assert.equal(await pi.call("edit", ".octave/specs/email-auth/tasks.md"), undefined, "다 승인됐을 때");

  put(pi, "requirements.md", "# requirements.md\n\nSign in with Google as well.\n");
  assert.equal(await pi.call("edit", ".octave/specs/email-auth/requirements.md"), undefined, "되돌아가 고치는 것");
  const refused = await pi.call("edit", ".octave/specs/email-auth/design.md");
  assert.equal(refused?.block, true, "설계는 새 요구사항이 승인될 때까지");
  assert.match(refused.reason, /design\.md comes after requirements\.md/);
  assert.equal((await pi.call("edit", ".octave/specs/email-auth/tasks.md"))?.block, true);

  approve(pi.cwd, "email-auth");
  assert.equal(await pi.call("edit", ".octave/specs/email-auth/design.md"), undefined, "다시 승인하면 설계를 맞춘다");
  assert.equal((await pi.call("edit", ".octave/specs/email-auth/tasks.md"))?.block, true, "작업 목록은 설계가 다시 승인될 때까지");
});

test("승인 기록은 모델이 쓸 수 없다 — 스스로 승인하지 못하게", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  for (const path of [".octave/specs/email-auth/approvals.json", ".octave/specs/email-auth/Approvals.JSON", "@.octave/specs/new/approvals.json"]) {
    for (const tool of ["write", "edit"]) {
      const refused = await pi.call(tool, path);
      assert.equal(refused?.block, true, `${tool} ${path}`);
      assert.match(refused.reason, /only \/spec-approve writes it/);
    }
  }
});

test("스펙 문서가 아닌 것과 쓰지 않는 도구에는 상관하지 않는다", async (t) => {
  const pi = fakePi("minkyojung/tokyo");
  t.after(pi.cleanup);
  for (const path of ["design.md", "src/design.md", ".octave/specs/design.md", ".octave/specs/email-auth/notes.md", ".octave/specs/email-auth/drafts/design.md", ".octave/design.md", "../elsewhere/.octave/specs/email-auth/design.md", "/tmp/.octave/specs/email-auth/design.md"]) {
    assert.equal(await pi.call("write", path), undefined, path);
  }
  assert.equal(await pi.call("read", ".octave/specs/email-auth/design.md"), undefined, "읽기는 언제나");
  assert.equal(await pi.call("write", undefined), undefined, "경로가 없는 호출은 pi가 거절한다");
});

// --- approving, one document at a time ---

/** The spec's folder in the fake, and a document put in it as the agent or the person would. */
const docs = (pi, name = "email-auth") => ({
  put: (doc, text = `# ${doc}\n`) => {
    mkdirSync(join(pi.cwd, ".octave/specs", name), { recursive: true });
    writeFileSync(join(pi.cwd, ".octave/specs", name, doc), text);
  },
  state: () => specState(pi.cwd, name),
});

test("/spec-approve는 기다리는 문서를 승인하고, 같은 턴에 다음 문서를 쓰게 한다 — 보이는 것은 친 명령뿐", async (t) => {
  const pi = fakePi("minkyojung/email-auth");
  t.after(pi.cleanup);
  const spec = docs(pi);
  assert.ok(pi.commands["spec-approve"].description);

  spec.put("requirements.md");
  await pi.approve("");
  assert.deepEqual(spec.state(), { approved: 1, waiting: null }, "승인은 코드가 적는다");
  assert.deepEqual(pi.notes, []);
  const [hidden, shown] = pi.done;
  assert.equal(hidden.sendMessage.customType, "spec");
  assert.equal(hidden.sendMessage.display, false);
  assert.equal(hidden.options.deliverAs, "nextTurn");
  assert.equal(hidden.sendMessage.content, nextPrompt({ name: "email-auth", next: "design.md", redo: false }));
  assert.equal(shown.sendUserMessage, "/spec-approve");
  assert.equal(shown.options, undefined);

  spec.put("design.md");
  pi.done.length = 0;
  await pi.approve("");
  assert.deepEqual(spec.state(), { approved: 2, waiting: null });
  assert.equal(pi.done[0].sendMessage.content, nextPrompt({ name: "email-auth", next: "tasks.md", redo: false }));

  spec.put("tasks.md");
  pi.done.length = 0;
  await pi.approve("");
  assert.deepEqual(spec.state(), { approved: 3, waiting: null });
  assert.deepEqual(pi.done, [], "마지막 문서 뒤에는 쓸 것이 없다 — 턴을 시작하지 않는다");
  assert.deepEqual(pi.notes, [{ text: "The spec email-auth is ready: its requirements, design and tasks are approved.", type: "info" }]);
});

test("설계와 작업 목록의 지시문은 Kiro의 형식이고, 묻지 않고 멈추라고 한다", () => {
  const design = nextPrompt({ name: "email-auth", next: "design.md", redo: false });
  assert.ok(design.includes(".octave/specs/email-auth/requirements.md"), "무엇이 승인됐는지");
  assert.ok(design.includes(".octave/specs/email-auth/design.md"));
  for (const section of ["# Design Document", "## Overview", "## Architecture", "## Components and Interfaces", "## Data Models", "## Error Handling", "## Testing Strategy"]) {
    assert.ok(design.includes(section), section);
  }
  assert.match(design, /read the code/i, "설계 단계에서 조사한다");
  assert.match(design, /Mermaid/);
  assert.match(design, /offer to go back/, "빈 곳을 찾으면 고치지 말고 되돌아가자고");
  assert.match(design, /Do not ask them to approve it/);
  assert.match(design, /with write, not note_write|with write — it is not a note/, "노트가 아니다");

  const tasks = nextPrompt({ name: "email-auth", next: "tasks.md", redo: false });
  assert.ok(tasks.includes(".octave/specs/email-auth/tasks.md"));
  assert.ok(
    tasks.includes("Convert the feature design into a series of prompts for a code-generation LLM that will implement each step in a test-driven manner."),
    "Kiro의 지시 그대로",
  );
  for (const form of ["# Implementation Plan", "- [ ] 2.1 Create core data model interfaces and types", "_Requirements: 2.1, 3.3, 1.2_"]) {
    assert.ok(tasks.includes(form), form);
  }
  assert.match(tasks, /at most two levels/);
  assert.match(tasks, /deployment/, "코딩이 아닌 작업은 넣지 않는다");
  assert.match(tasks, /Every requirement/);
  assert.match(tasks, /Do not ask them to approve it/);
  assert.match(tasks, /Do not start on the tasks/);
});

test("되돌아가 고친 뒤 다시 승인하면, 이미 있는 다음 문서를 새 내용에 맞추게 한다 — 바꿀 것이 없으면 그대로", async (t) => {
  const pi = fakePi("minkyojung/email-auth");
  t.after(pi.cleanup);
  const spec = docs(pi);
  for (const doc of ["requirements.md", "design.md", "tasks.md"]) {
    spec.put(doc);
    approve(pi.cwd, "email-auth");
  }
  spec.put("requirements.md", "# requirements.md\n\nSign in with Google as well.\n");
  await pi.approve("");
  assert.deepEqual(spec.state(), { approved: 1, waiting: "design.md" }, "설계는 옛 요구사항 위에 있다");
  const design = pi.done[0].sendMessage.content;
  assert.equal(design, nextPrompt({ name: "email-auth", next: "design.md", redo: true }));
  assert.match(design, /as they were before/);
  assert.match(design, /only there/);
  assert.match(design, /If nothing needs to change, change nothing/);
  assert.equal(design.includes("## Testing Strategy"), false, "새로 쓰는 것이 아니다");

  pi.done.length = 0;
  await pi.approve("");
  const tasks = pi.done[0].sendMessage.content;
  assert.equal(tasks, nextPrompt({ name: "email-auth", next: "tasks.md", redo: true }));
  assert.match(tasks, /checked as done stays as it is/, "이미 한 작업은 지우지 않는다");
});

test("쓰던 턴이 끊겨 다음 문서가 없으면, /spec-approve가 다시 쓰게 한다 — 새로 승인하는 것은 없다", async (t) => {
  const pi = fakePi("minkyojung/email-auth");
  t.after(pi.cleanup);
  const spec = docs(pi);
  spec.put("requirements.md");
  approve(pi.cwd, "email-auth");
  await pi.approve("");
  assert.deepEqual(spec.state(), { approved: 1, waiting: null });
  assert.equal(pi.done[0].sendMessage.content, nextPrompt({ name: "email-auth", next: "design.md", redo: false }));
});

test("승인할 것이 없거나, 여럿이거나, 에이전트가 일하는 중이면 알리기만 한다", async (t) => {
  const pi = fakePi("main");
  t.after(pi.cleanup);
  await pi.approve("");
  assert.match(pi.notes.at(-1).text, /Nothing is waiting for your approval/);

  const a = docs(pi, "email-auth");
  const b = docs(pi, "billing");
  a.put("requirements.md");
  b.put("requirements.md");
  await pi.approve("");
  assert.match(pi.notes.at(-1).text, /More than one spec is waiting: billing, email-auth\. Say which: \/spec-approve billing/);
  assert.deepEqual([a.state().approved, b.state().approved], [0, 0], "아무것도 승인하지 않았다");

  await pi.approve("email-auth", { idle: false });
  assert.equal(pi.notes.at(-1).type, "warning");
  assert.equal(a.state().approved, 0, "일하는 중에는 승인하지 않는다 — 쓰던 문서일 수 있다");

  await pi.approve("  email-auth  ");
  assert.equal(a.state().approved, 1, "이름을 대면 그것만");
  assert.equal(b.state().approved, 0);
  assert.equal(pi.done.at(-1).sendUserMessage, "/spec-approve email-auth");

  const before = pi.done.length;
  await pi.approve("sign-in");
  assert.match(pi.notes.at(-1).text, /There is no spec called sign-in/);
  await pi.approve("../email-auth");
  assert.match(pi.notes.at(-1).text, /There is no spec called \.\.\/email-auth/);

  for (const doc of ["design.md", "tasks.md"]) {
    a.put(doc);
    approve(pi.cwd, "email-auth");
  }
  await pi.approve("email-auth");
  assert.match(pi.notes.at(-1).text, /The spec email-auth is ready/);
  assert.equal(pi.done.length, before, "턴은 하나도 더 시작되지 않았다");
});

test("턴이 끝나면 새로 기다리게 된 문서를 한 번 알린다 — 고쳐 쓰는 턴마다 알리지는 않는다", async (t) => {
  const pi = fakePi("minkyojung/email-auth");
  t.after(pi.cleanup);
  const spec = docs(pi);
  const waiting = (doc, how = "/spec-approve") => ({ text: `.octave/specs/email-auth/${doc} is waiting for you: read it, and when it is right, approve it with ${how}.`, type: "info" });

  pi.start();
  spec.put("requirements.md");
  await pi.settle();
  assert.deepEqual(pi.notes, [waiting("requirements.md")], "처음 쓰였다");

  pi.start();
  spec.put("requirements.md", "# requirements.md\n\nRevised.\n");
  await pi.settle();
  assert.equal(pi.notes.length, 1, "고쳐 달라는 말에 고친 턴: 여전히 같은 문서가 기다린다");

  pi.start();
  await pi.settle();
  assert.equal(pi.notes.length, 1, "스펙과 상관없는 턴");

  await pi.approve("");
  pi.start();
  spec.put("design.md");
  await pi.settle();
  assert.deepEqual(pi.notes.at(-1), waiting("design.md"), "다음 문서");

  // Back to the requirements and approved again: the design waits again, and
  // that is news though it was waiting before — the turn was the command's.
  approve(pi.cwd, "email-auth");
  pi.start();
  spec.put("requirements.md", "# requirements.md\n\nRevised again.\n");
  await pi.settle();
  assert.deepEqual(pi.notes.at(-1), waiting("requirements.md"), "승인이 풀린 것도 새 소식이다");
  const told = pi.notes.length;
  await pi.approve("");
  pi.start();
  await pi.settle();
  assert.equal(pi.notes.length, told + 1);
  assert.deepEqual(pi.notes.at(-1), waiting("design.md"), "명령이 시작한 턴은 끝에 늘 말한다");

  // A second spec waiting as well: the command has to be told which.
  pi.start();
  docs(pi, "billing").put("requirements.md");
  await pi.settle();
  assert.deepEqual(pi.notes.at(-1), { text: ".octave/specs/billing/requirements.md is waiting for you: read it, and when it is right, approve it with /spec-approve billing.", type: "info" });
});

test("기다리는 문서가 있으면, 사람의 메시지 옆에 모델에게만 그렇다고 말한다 — 말로 넘어가자고 하면 쓰지 말고 승인을 안내하라고", async (t) => {
  const pi = fakePi("minkyojung/email-auth");
  t.after(pi.cleanup);
  const spec = docs(pi);
  assert.equal(await pi.beside(), undefined, "스펙이 없을 때는 아무것도");

  spec.put("requirements.md");
  const said = await pi.beside();
  assert.equal(said.message.customType, "spec-waiting");
  assert.equal(said.message.display, false, "화면에는 안 보인다");
  const note = said.message.content;
  assert.match(note, /^When they sent this message, /, "대화에 남으므로 그때의 사실로");
  assert.ok(note.includes(".octave/specs/email-auth/requirements.md was waiting for the person to approve it"));
  assert.match(note, /\/spec-approve/);
  assert.match(note, /do not try to write it/, "쓰려다 거절당하지 말고");
  assert.match(note, /Changing .*requirements\.md.*is fine/, "고치는 것은 된다");

  approve(pi.cwd, "email-auth");
  assert.equal(await pi.beside(), undefined, "승인되어 설계를 쓸 차례 — 기다리는 것이 없다");

  spec.put("design.md");
  docs(pi, "billing").put("requirements.md");
  const both = (await pi.beside()).message.content;
  assert.ok(both.includes(".octave/specs/billing/requirements.md was waiting"), both);
  assert.ok(both.includes(".octave/specs/email-auth/design.md was waiting"), both);
  assert.match(both, /\/spec-approve billing/, "여럿이면 이름을 붙여");
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

test("실제 pi 세션에서 사슬 한 바퀴: 세 문서가 차례로, 승인 없이는 막히고, 되돌아가면 뒤 문서가 다시 기다린다", async (t) => {
  const { InMemoryCredentialStore, fauxAssistantMessage, fauxProvider, fauxToolCall } = await import("@earendil-works/pi-ai");
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const cwd = mkdtempSync(join(tmpdir(), "spec-chain-"));
  const agentDir = mkdtempSync(join(tmpdir(), "spec-agent-"));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  });
  const dir = ".octave/specs/email-auth";
  const read = (doc) => readFileSync(join(cwd, dir, doc), "utf8");
  const has = (doc) => existsSync(join(cwd, dir, doc));
  const state = () => specState(cwd, "email-auth");

  // The model, one reply at a time: what it was sent is kept to look at.
  const faux = fauxProvider();
  const sent = [];
  const reply = (make) => (context) => (sent.push(context.messages), make());
  const text = (message) => (typeof message.content === "string" ? message.content : message.content.map((c) => c.text ?? "").join(""));
  const write = (doc, content) => reply(() => fauxAssistantMessage(fauxToolCall("write", { path: `${dir}/${doc}`, content }), { stopReason: "toolUse" }));
  const say = (words) => reply(() => fauxAssistantMessage(words));
  faux.setResponses([
    // /spec: the requirements.
    write("requirements.md", "# Requirements Document\n\n## Requirements\n\n### Requirement 1\n"),
    say("I wrote the requirements."),
    // Asked for the design before approving: refused, and it stops.
    write("design.md", "# Design Document\n"),
    say("The requirements are not approved yet."),
    // /spec-approve: the design.
    write("design.md", "# Design Document\n\n## Overview\n"),
    say("I wrote the design."),
    // /spec-approve: the tasks.
    write("tasks.md", "# Implementation Plan\n\n- [ ] 1. Set up\n  - _Requirements: 1.1_\n"),
    say("I wrote the tasks."),
    // Back to the requirements at the person's word; the design is refused on the way.
    write("requirements.md", "# Requirements Document\n\n## Requirements\n\n### Requirement 1\n\n### Requirement 2\n"),
    write("design.md", "# Design Document\n\n## Overview\n\nGoogle as well.\n"),
    say("I added the requirement; the design waits for your approval."),
    // /spec-approve: the design brought into line.
    reply(() => fauxAssistantMessage(fauxToolCall("edit", { path: `${dir}/design.md`, edits: [{ oldText: "## Overview\n", newText: "## Overview\n\nGoogle as well.\n" }] }), { stopReason: "toolUse" })),
    say("I added Google to the design."),
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
  // A screen that keeps what it is told, as Octave's does in the conversation.
  const notes = [];
  await session.bindExtensions({ uiContext: new Proxy({ notify: (words) => notes.push(words) }, { get: (ui, key) => ui[key] ?? (() => undefined) }) });

  let settled = false;
  session.subscribe((event) => {
    if (event.type === "agent_settled") settled = true;
  });
  /** A message sent, and its run over — the code's own settling with it. */
  const send = async (words) => {
    settled = false;
    lastWords = words;
    await session.prompt(words);
    const deadline = Date.now() + 20_000;
    while (!settled && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.ok(settled, `${words}: the run settled`);
  };
  const toolErrors = () => session.messages.filter((m) => m.role === "toolResult" && m.isError).map(text);
  /**
   * What the model was sent with the latest message, from it on — not the
   * conversation before it — as one text. Found by its words: what the code
   * puts beside it reaches the model as the person's too.
   */
  let lastWords = null;
  const toldLast = () => {
    const messages = sent.at(-2);
    const at = messages.findLastIndex((m) => text(m) === lastWords);
    assert.ok(at >= 0, `${lastWords} among what the model was sent`);
    return messages.slice(at).map(text).join("\n");
  };

  await send("/spec 이메일 인증 추가");
  assert.deepEqual(state(), { approved: 0, waiting: "requirements.md" });
  assert.match(notes.at(-1), /requirements\.md is waiting for you: .* \/spec-approve\./);

  await send("설계도 써 줘");
  assert.ok(toldLast().includes(`${dir}/requirements.md was waiting for the person to approve it`), "모델은 기다리는 중인 것을 들었다");
  assert.equal(has("design.md"), false, "승인 전에는 설계를 쓸 수 없다");
  assert.match(toolErrors().at(-1), /design\.md comes after requirements\.md, which the person has not approved/);
  const told = notes.length;

  await send("/spec-approve");
  assert.ok(toldLast().includes("# Design Document"), "설계 지시문은 그 턴에 모델에게");
  assert.equal(toldLast().includes("was waiting for the person"), false, "승인된 뒤에는 기다리는 것이 없다");
  assert.deepEqual(state(), { approved: 1, waiting: "design.md" });
  assert.equal(notes.length, told + 1);
  assert.match(notes.at(-1), /design\.md is waiting for you/);

  await send("/spec-approve");
  assert.ok(toldLast().includes("# Implementation Plan"));
  assert.deepEqual(state(), { approved: 2, waiting: "tasks.md" });

  const calls = sent.length;
  await session.prompt("/spec-approve");
  assert.deepEqual(state(), { approved: 3, waiting: null });
  assert.equal(sent.length, calls, "마지막 승인에는 모델을 부르지 않는다");
  assert.match(notes.at(-1), /The spec email-auth is ready/);

  await send("요구사항에 구글 로그인도 넣어 줘");
  assert.match(read("requirements.md"), /Requirement 2/, "되돌아가 고치는 것은 된다");
  assert.equal(read("design.md"), "# Design Document\n\n## Overview\n", "새 요구사항이 승인되기 전에는 설계를 못 고친다");
  assert.deepEqual(state(), { approved: 0, waiting: "requirements.md" }, "요구사항을 고치니 뒤 승인이 모두 풀렸다");

  await send("/spec-approve");
  assert.match(toldLast(), /as they were before/, "새로 쓰지 말고 맞추라고");
  assert.equal(read("design.md"), "# Design Document\n\n## Overview\n\nGoogle as well.\n");
  assert.deepEqual(state(), { approved: 1, waiting: "design.md" });
  assert.match(notes.at(-1), /design\.md is waiting for you/);
  assert.equal(JSON.parse(readFileSync(join(cwd, dir, "approvals.json"), "utf8"))["requirements.md"].length, 1);
});
