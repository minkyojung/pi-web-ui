import assert from "node:assert/strict";
import test from "node:test";
import { markSpans } from "../reader/spans.ts";

test("wide images step outside the measure, narrow ones do not", () => {
  assert.match(markSpans(`<img src="a.png" width="900">`), /data-span="wide"/);
  assert.doesNotMatch(markSpans(`<img src="a.png" width="320">`), /data-span/);
});

test("a caption travels with the figure it belongs to", () => {
  const out = markSpans(`<figure><img src="a.png" width="900"><figcaption>c</figcaption></figure>`);
  assert.match(out, /<figure data-span="wide">/);
  assert.doesNotMatch(out, /<img [^>]*data-span/);
});

test("width=\"100%\" says nothing about pixels", () => {
  assert.doesNotMatch(markSpans(`<img src="a.png" width="100%">`), /data-span/);
});

test("inline pixel widths count, and beat nothing else being said", () => {
  assert.match(markSpans(`<img src="a.png" style="width: 880px">`), /data-span="wide"/);
});

test("an svg's viewBox is its width when it declares none", () => {
  assert.match(markSpans(`<svg viewBox="0 0 900 400"></svg>`), /data-span="wide"/);
});

test("an svg without a viewBox gets one, so it can scale instead of crop", () => {
  assert.match(markSpans(`<svg width="900" height="400"></svg>`), /viewBox="0 0 900 400"/);
  // 이미 있으면 건드리지 않는다.
  assert.match(markSpans(`<svg width="900" height="400" viewBox="0 0 10 5"></svg>`), /viewBox="0 0 10 5"/);
});

test("tables are wrapped, because a table cannot scroll itself", () => {
  const out = markSpans(`<table><tr><td>a</td></tr></table>`);
  assert.match(out, /^<div data-span="wide"><table>/);
});

test("code breaks out only when a line is too long to fold", () => {
  assert.match(markSpans(`<pre>${"x".repeat(120)}</pre>`), /data-span="wide"/);
  assert.doesNotMatch(markSpans(`<pre>short line</pre>`), /data-span/);
});

test("depth does not matter — Readability nests to a depth we cannot predict", () => {
  const out = markSpans(`<div class="page"><article><div><img src="a.png" width="900"></div></article></div>`);
  assert.match(out, /data-span="wide"/);
});

test("nothing in, nothing out", () => {
  assert.equal(markSpans(""), "");
});
