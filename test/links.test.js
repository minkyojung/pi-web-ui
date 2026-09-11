import assert from "node:assert/strict";
import test from "node:test";

import { backlinksOf, linksIn, resolve, retarget } from "../links.ts";

test("링크는 대상과 별칭과 위치를 갖고, 코드 안의 것은 링크가 아니다", () => {
  const text = "see [[Alpha]] and [[beta|the B]]\n\n```\n[[not a link]]\n```\n\ninline `[[nor this]]` [[gamma]]";
  const links = linksIn(text);
  assert.deepEqual(links.map((l) => [l.target, l.alias]), [["Alpha", null], ["beta", "the B"], ["gamma", null]]);
  assert.equal(text.slice(links[0].from, links[0].to), "[[Alpha]]");
  assert.equal(text.slice(links[1].from, links[1].to), "[[beta|the B]]");
});

test("닫히지 않은 것, 빈 것, 줄을 넘는 것은 링크가 아니다", () => {
  assert.deepEqual(linksIn("[[open"), []);
  assert.deepEqual(linksIn("[[]]"), []);
  assert.deepEqual(linksIn("[[a\nb]]"), []);
  assert.deepEqual(linksIn("[[a [[b]] c]]").map((l) => l.target), ["b"]);
  assert.deepEqual(linksIn("[link](x.md) [[wiki]]").map((l) => l.target), ["wiki"]);
});

const paths = ["Alpha.md", "ideas/beta.md", "ideas/deep/Alpha.md", "Gamma Ray.md"];

test("제목으로 찾고 대소문자는 가리지 않으며, 같은 제목은 가까운 쪽이다", () => {
  assert.equal(resolve("alpha", paths, "Gamma Ray.md"), "Alpha.md");
  assert.equal(resolve("Alpha", paths, "ideas/deep/other.md"), "ideas/deep/Alpha.md");
  assert.equal(resolve("Alpha", paths, "ideas/beta.md"), "Alpha.md", "같은 거리면 이름순");
  assert.equal(resolve("beta", paths, ""), "ideas/beta.md");
  assert.equal(resolve("gamma ray", paths), "Gamma Ray.md");
  assert.equal(resolve("nope", paths), null);
  assert.equal(resolve("", paths), null);
});

test("폴더가 있는 대상은 경로째 맞춰지고, .md는 있어도 없어도 된다", () => {
  assert.equal(resolve("ideas/beta", paths), "ideas/beta.md");
  assert.equal(resolve("ideas/beta.md", paths), "ideas/beta.md");
  assert.equal(resolve("ideas/Alpha", paths), null, "그 폴더에는 없다");
});

test("백링크는 이 노트로 풀리는 링크를 가진 노트들이다", () => {
  const index = {
    "Alpha.md": [{ target: "beta", alias: null, from: 0, to: 8 }],
    "ideas/beta.md": [{ target: "Alpha", alias: "A", from: 0, to: 11 }, { target: "nope", alias: null, from: 20, to: 28 }],
    "Gamma Ray.md": [{ target: "alpha", alias: null, from: 0, to: 9 }],
  };
  assert.deepEqual(
    backlinksOf(index, "Alpha.md", paths).map((b) => [b.path, b.links.length]),
    [["Gamma Ray.md", 1], ["ideas/beta.md", 1]],
  );
  assert.deepEqual(backlinksOf(index, "nope.md", paths), []);
});

test("이름이 바뀌면 그리로 가던 링크가 새 이름을 가리키고 별칭은 남는다", () => {
  const text = "see [[Alpha]] and [[alpha|the A]] but not [[beta]]";
  const after = retarget(text, "Alpha.md", "Omega.md", ["Alpha.md", "ideas/beta.md", "Gamma Ray.md"], "Gamma Ray.md");
  assert.equal(after, "see [[Omega]] and [[Omega|the A]] but not [[beta]]");
  assert.equal(retarget("[[beta]]", "Alpha.md", "Omega.md", paths, ""), null, "가리키지 않으면 건드리지 않는다");
});

test("새 이름을 제목만으로는 못 찾을 때 — 더 가까운 같은 제목이 있을 때 — 경로로 가리킨다", () => {
  const near = retarget("[[Alpha]]", "Alpha.md", "ideas/Alpha.md", ["Alpha.md", "ideas/deep/Alpha.md", "note.md"], "note.md");
  assert.equal(near, "[[Alpha]]", "제목이 가장 가까운 것을 찾으면 제목으로");
  const far = retarget("[[Alpha]]", "Alpha.md", "ideas/deep/Alpha.md", ["Alpha.md", "ideas/Alpha.md", "note.md"], "note.md");
  assert.equal(far, "[[ideas/deep/Alpha]]", "제목이 다른 노트를 찾으면 경로로");
});
