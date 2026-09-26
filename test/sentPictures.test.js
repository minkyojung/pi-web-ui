import assert from "node:assert/strict";
import test from "node:test";

import { keptSaid, sentPictures } from "../sentPictures.ts";

/** The before_agent_start handler pi would call, from an extension whose kept pictures are `paths`. */
const beside = (paths) => {
  let handler;
  sentPictures(() => paths)({ on: (event, fn) => { if (event === "before_agent_start") handler = fn; } });
  return handler({ type: "before_agent_start", prompt: "뭐야", systemPrompt: "BASE" });
};

test("보낸 그림이 남은 자리는 보이지 않는 메시지로, 경로는 details에도", async () => {
  const result = await beside([".octave/attachments/ab12cd34/Pasted image 20260926153012.png"]);
  assert.equal(result.systemPrompt, undefined, "시스템 프롬프트는 건드리지 않는다");
  assert.equal(result.message.display, false);
  assert.equal(result.message.customType, "attached");
  assert.equal(result.message.content, "The pictures sent with this message are also kept in the folder, to look at again with read: .octave/attachments/ab12cd34/Pasted image 20260926153012.png");
  assert.deepEqual(result.message.details, { pictures: [".octave/attachments/ab12cd34/Pasted image 20260926153012.png"] });
});

test("그림이 없으면 아무것도 보태지 않는다", async () => {
  assert.equal(await beside([]), undefined);
  assert.match(keptSaid(["a.png", "b.png"]), /read: a\.png, b\.png$/);
});
