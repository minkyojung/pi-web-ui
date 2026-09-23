import assert from "node:assert/strict";
import test from "node:test";

import { toOpen, waitingPath } from "../web/src/specTabs.ts";

/** A spec as the server describes it. */
const spec = (name, waiting, waitingAt = waiting ? 1000 : null, approved = 0, own = true) => ({ name, own, approved, waiting, waitingAt });

test("기다리는 문서의 자리는 스펙 폴더 안이다", () => {
  assert.equal(waitingPath(spec("email-auth", "requirements.md")), ".octave/specs/email-auth/requirements.md");
  assert.equal(waitingPath(spec("email-auth", null)), null);
});

test("막 대기로 바뀐 문서를 연다", () => {
  const before = [spec("a", null)];
  assert.equal(toOpen(before, [spec("a", "requirements.md")], true), ".octave/specs/a/requirements.md");
});

test("처음 만난 스펙이 기다리고 있어도 연다", () => {
  assert.equal(toOpen([], [spec("a", "requirements.md")], true), ".octave/specs/a/requirements.md");
});

test("계속 같은 문서가 기다리는 중이면 다시 열지 않는다 — 사람이 닫았을 수 있다", () => {
  const before = [spec("a", "requirements.md", 1000)];
  assert.equal(toOpen(before, [spec("a", "requirements.md", 2000)], true), null, "그 문서를 또 고쳐 써도 마찬가지다");
});

test("다음 문서로 넘어가면 그것을 연다", () => {
  const before = [spec("a", "requirements.md")];
  assert.equal(toOpen(before, [spec("a", "design.md")], true), ".octave/specs/a/design.md");
});

test("승인되어 기다리는 것이 없어지면 아무것도 열지 않는다", () => {
  assert.equal(toOpen([spec("a", "requirements.md")], [spec("a", null)], true), null);
  assert.equal(toOpen(null, [spec("a", null)], false), null);
});

test("둘이 한꺼번에 대기로 바뀌면 가장 최근에 쓰인 것", () => {
  const before = [spec("a", null), spec("b", null)];
  const after = [spec("a", "requirements.md", 1000), spec("b", "requirements.md", 2000)];
  assert.equal(toOpen(before, after, true), ".octave/specs/b/requirements.md");
  assert.equal(toOpen(before, [spec("a", "requirements.md", 3000), spec("b", "requirements.md", 2000)], true), ".octave/specs/a/requirements.md");
});

test("창을 열었을 때는 가운데가 비어 있을 때만 연다", () => {
  const specs = [spec("a", "requirements.md")];
  assert.equal(toOpen(null, specs, false), ".octave/specs/a/requirements.md");
  assert.equal(toOpen(null, specs, true), null, "읽던 것을 밀어내지 않는다");
});

test("창을 열었을 때 둘이 기다리면 가장 최근 것 하나만", () => {
  const specs = [spec("a", "requirements.md", 1000), spec("b", "design.md", 2000)];
  assert.equal(toOpen(null, specs, false), ".octave/specs/b/design.md");
});

test("다른 브랜치가 시작한 스펙의 문서는 저절로 열리지 않는다", () => {
  const theirs = spec("airbnb-clone-page", "requirements.md", 2000, 0, false);
  const ours = spec("stay-reservation", "design.md", 1000);
  assert.equal(toOpen(null, [theirs], false), null, "가운데가 비어 있어도");
  assert.equal(toOpen([spec("airbnb-clone-page", null, null, 0, false)], [theirs], true), null, "막 대기로 바뀌어도");
  assert.equal(toOpen(null, [theirs, ours], false), ".octave/specs/stay-reservation/design.md", "더 새것이어도 이 워크스페이스의 것이 열린다");
});
