/**
 * 팔레트가 무엇을 들어 올리는가. 너무 많이 들면 키를 누를 때마다 수천 개를 짓고,
 * 이미 다른 머리글 아래 있는 것을 또 들면 파일이 둘인 것처럼 보인다.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { repoOffers, SHOWN } from "../web/src/quickOpen.ts";

const REPO = ["README.md", "server.ts", "web/src/App.tsx", "web/src/components/QuickOpen.tsx", "paper.pdf"];
const LISTED = new Set(["README.md", "paper.pdf"]);

test("한 글자도 치기 전에는 저장소에서 아무것도 들지 않는다", () => {
  assert.deepEqual(repoOffers(REPO, LISTED, ""), []);
  assert.deepEqual(repoOffers(REPO, LISTED, "   "), []);
});

test("노트와 문서가 이미 보여 주는 것은 다시 올리지 않는다", () => {
  assert.deepEqual(repoOffers(REPO, LISTED, "e").sort(), ["server.ts", "web/src/App.tsx", "web/src/components/QuickOpen.tsx"]);
  assert.ok(!repoOffers(REPO, LISTED, "read").includes("README.md"), "노트는 노트 머리글 아래에 있다");
  assert.ok(!repoOffers(REPO, LISTED, "pap").includes("paper.pdf"), "문서도 마찬가지다");
});

test("이름이 앞에서 맞는 것이 먼저, 그다음이 경로에만 든 것", () => {
  assert.deepEqual(repoOffers(REPO, LISTED, "app"), ["web/src/App.tsx"]);
  assert.deepEqual(repoOffers(REPO, LISTED, "components"), ["web/src/components/QuickOpen.tsx"], "경로로도 찾힌다");
});

test("아무리 많아도 한 번에 드는 수는 정해져 있다", () => {
  const many = Array.from({ length: SHOWN * 3 }, (_, n) => `src/file${n}.ts`);
  assert.equal(repoOffers(many, new Set(), "file").length, SHOWN);
  assert.equal(repoOffers(many, new Set(), "file", 5).length, 5);
});

test("저장소가 아닌 폴더에서는 팔레트가 있던 그대로다", () => {
  assert.deepEqual(repoOffers([], LISTED, "app"), []);
});
