import assert from "node:assert/strict";
import test from "node:test";

import { parser as markdown } from "@lezer/markdown";

import { backlinksOf, linksIn, markdownLinkTo, resolve, retarget } from "../links.ts";
import { wikiLink } from "../wikilink.ts";

/** The node names a parse gives, in order, for asserting on the tree itself. */
const nodes = (text) => {
  const out = [];
  markdown.configure([wikiLink]).parse(text).iterate({ enter: (n) => void out.push(n.name) });
  return out;
};

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

test("#제목과 ^블록은 대상 안의 노드이고, 노트 이름에서 빠져 따로 남는다", () => {
  assert.deepEqual(nodes("[[a#h|x]]").slice(2), ["WikiLink", "WikiLinkMark", "WikiLinkTarget", "WikiLinkHeading", "WikiLinkMark", "WikiLinkMark", "WikiLinkAlias", "WikiLinkMark"]);
  assert.deepEqual(nodes("[[a#^b]]").slice(2), ["WikiLink", "WikiLinkMark", "WikiLinkTarget", "WikiLinkBlock", "WikiLinkMark", "WikiLinkMark"]);
  const pick = (text) => linksIn(text).map((l) => [l.target, l.heading, l.block, l.alias]);
  assert.deepEqual(pick("[[Alpha#Intro]]"), [["Alpha", "Intro", null, null]]);
  assert.deepEqual(pick("[[Alpha # Two words |the A]]"), [["Alpha", "Two words", null, "the A"]]);
  assert.deepEqual(pick("[[Alpha#^b-1]] [[Alpha^b-1]]"), [["Alpha", null, "b-1", null], ["Alpha", null, "b-1", null]]);
  assert.deepEqual(pick("[[#Intro]]"), [["", "Intro", null, null]], "이 노트의 제목");
  assert.deepEqual(pick("[[a#b^c]]"), [["a", "b^c", null, null]], "첫 표시가 무엇인지 정한다");
  assert.deepEqual(pick("[[a#]]"), [["a", null, null, null]], "빈 제목은 제목이 아니다");
});

test("줄 끝의 ^id는 블록의 이름이고, 그 밖의 ^나 코드 안의 것은 아니다", () => {
  const ids = (text) => nodes(text).filter((n) => n === "WikiBlockId").length;
  assert.equal(ids("a paragraph ^b-1"), 1);
  assert.equal(ids("first line ^one\nsecond line"), 1);
  assert.equal(ids("trailing space ^b1  "), 1);
  assert.equal(ids("x^2 and ^b1 then more"), 0);
  assert.equal(ids("^alone"), 0);
  assert.equal(ids("under ^_bad"), 0);
  assert.equal(ids("```\ncode ^b1\n```"), 0);
  assert.equal(ids("inline `code ^b1`"), 0);
});

test("![[노트]]는 WikiLink를 품은 WikiEmbed이고, 링크로서 똑같이 찾아진다", () => {
  assert.deepEqual(nodes("![[a]]").slice(2), ["WikiEmbed", "WikiLinkMark", "WikiLink", "WikiLinkMark", "WikiLinkTarget", "WikiLinkMark"]);
  const text = "see ![[Alpha#Intro|x]] and [[beta]] but ![img](pic.png)";
  const links = linksIn(text);
  assert.deepEqual(links.map((l) => [l.target, l.heading, l.alias]), [["Alpha", "Intro", "x"], ["beta", null, null]]);
  assert.equal(text.slice(links[0].from, links[0].to), "[[Alpha#Intro|x]]", "링크의 자리는 ! 뒤다");
  assert.ok(nodes("![img](pic.png)").includes("Image"), "그림은 그대로 그림이다");
  assert.ok(!nodes("![[]] ![[open").includes("WikiEmbed"));
  assert.deepEqual(linksIn("```\n![[not]]\n```"), []);
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

test("이름 없는 대상은 링크를 쓴 노트다", () => {
  assert.equal(resolve("", paths, "Gamma Ray.md"), "Gamma Ray.md");
  assert.equal(resolve("", paths, "nope.md"), null, "없는 노트는 아니다");
  assert.equal(resolve(linksIn("[[Alpha#Intro]]")[0].target, paths, "Gamma Ray.md"), "Alpha.md", "제목은 노트를 정하지 않는다");
});

test("마크다운 링크는 노트의 폴더에서 경로로 찾고, 웹 주소는 웹 주소이며, 나머지는 어디로도 가지 않는다", () => {
  const to = (url, from = "ideas/beta.md") => markdownLinkTo(url, paths, from);
  assert.deepEqual(to("deep/Alpha.md"), { note: "ideas/deep/Alpha.md" });
  assert.deepEqual(to("../Alpha.md"), { note: "Alpha.md" }, "위로");
  assert.deepEqual(to("./deep/../beta.md"), { note: "ideas/beta.md" });
  assert.deepEqual(to("/Gamma%20Ray.md"), { note: "Gamma Ray.md" }, "맨 위에서, 인코딩을 풀어서");
  assert.deepEqual(to("<../Gamma Ray.md>"), { note: "Gamma Ray.md" }, "꺾쇠 안의 공백");
  assert.deepEqual(to("../alpha.md#Intro"), { note: "Alpha.md" }, "조각은 떼고 대소문자는 가리지 않는다");
  assert.equal(to("Alpha.md"), null, "노트의 폴더에 없다 — 제목으로 찾지 않는다");
  assert.equal(to("../../Alpha.md"), null, "서재 밖으로는 못 간다");
  assert.equal(to("../nope.md"), null);
  assert.equal(to("../Alpha"), null, "노트가 아닌 경로");
  assert.equal(to("pic.png"), null);
  assert.equal(to("%E0%A4%A.md"), null, "풀리지 않는 인코딩");
  assert.deepEqual(to("https://example.com/a.md"), { web: "https://example.com/a.md" });
  assert.deepEqual(to("<HTTP://example.com>"), { web: "HTTP://example.com" });
  assert.equal(to("mailto:a@b.c"), null);
  assert.equal(to("file:///Alpha.md"), null);
  assert.deepEqual(linksIn("[a](../Alpha.md) <https://example.com> https://example.com"), [], "색인에는 들어가지 않는다");
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

test("이름이 바뀌어도 링크의 #제목과 ^블록은 그대로다", () => {
  const text = "[[Alpha#Intro|the A]] [[Alpha#^b1]] [[Alpha^b1]] [[#here]]";
  const after = retarget(text, "Alpha.md", "Omega.md", ["Alpha.md", "Gamma Ray.md"], "Gamma Ray.md");
  assert.equal(after, "[[Omega#Intro|the A]] [[Omega#^b1]] [[Omega^b1]] [[#here]]");
  assert.equal(retarget("![[Alpha]]", "Alpha.md", "Omega.md", ["Alpha.md", "Gamma Ray.md"], "Gamma Ray.md"), "![[Omega]]", "삽입은 삽입으로 남는다");
});

test("새 이름을 제목만으로는 못 찾을 때 — 더 가까운 같은 제목이 있을 때 — 경로로 가리킨다", () => {
  const near = retarget("[[Alpha]]", "Alpha.md", "ideas/Alpha.md", ["Alpha.md", "ideas/deep/Alpha.md", "note.md"], "note.md");
  assert.equal(near, "[[Alpha]]", "제목이 가장 가까운 것을 찾으면 제목으로");
  const far = retarget("[[Alpha]]", "Alpha.md", "ideas/deep/Alpha.md", ["Alpha.md", "ideas/Alpha.md", "note.md"], "note.md");
  assert.equal(far, "[[ideas/deep/Alpha]]", "제목이 다른 노트를 찾으면 경로로");
});
