import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asideOf, putBack, setAside } from "../electron/keptAside.js";

const home = () => mkdtempSync(join(tmpdir(), "aside-"));
const give = (workspace, id, name, text) => {
  mkdirSync(join(workspace, ".octave/attachments", id), { recursive: true });
  writeFileSync(join(workspace, ".octave/attachments", id, name), text);
};

test("보관 자리는 워크스페이스가 workspaces/ 아래 있는 모양 그대로 archived/ 아래", () => {
  assert.equal(asideOf("/h/octave", "/h/octave/workspaces/pi-web-ui/oslo"), "/h/octave/archived/pi-web-ui/oslo/attachments");
});

test("archive 전에 옮겨 두고, 되살리면 같은 자리로 돌아오며 보관 자리는 비워진다", () => {
  const root = home();
  try {
    const workspace = join(root, "workspaces/demo/oslo");
    give(workspace, "aaaa1111", "shot.png", "one");
    give(workspace, "bbbb2222", "paper.pdf", "two");
    writeFileSync(join(workspace, "README.md"), "branch's");
    const aside = asideOf(root, workspace);
    setAside(workspace, aside);
    assert.equal(existsSync(join(workspace, ".octave/attachments")), false, "워크스페이스에는 남지 않는다");
    assert.deepEqual(readdirSync(aside).sort(), ["aaaa1111", "bbbb2222"]);
    assert.equal(existsSync(join(workspace, "README.md")), true, "첨부 말고는 건드리지 않는다");
    rmSync(workspace, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    putBack(aside, workspace);
    assert.equal(readFileSync(join(workspace, ".octave/attachments/aaaa1111/shot.png"), "utf8"), "one");
    assert.equal(readFileSync(join(workspace, ".octave/attachments/bbbb2222/paper.pdf"), "utf8"), "two");
    assert.equal(existsSync(join(root, "archived/demo/oslo")), false, "기다리던 자리는 남지 않는다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("옮길 것이 없으면 아무것도 만들지 않는다", () => {
  const root = home();
  try {
    const workspace = join(root, "workspaces/demo/lima");
    mkdirSync(workspace, { recursive: true });
    setAside(workspace, asideOf(root, workspace));
    assert.equal(existsSync(join(root, "archived")), false);
    putBack(asideOf(root, workspace), workspace);
    assert.equal(existsSync(join(workspace, ".octave")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("중간에 멈춘 옮기기 뒤에 다시 옮기면, 이미 건너간 것은 두고 남은 것만 더한다", () => {
  const root = home();
  try {
    const workspace = join(root, "workspaces/demo/rome");
    const aside = asideOf(root, workspace);
    // One went across before it stopped; the source still has it and one more.
    mkdirSync(join(aside, "aaaa1111"), { recursive: true });
    writeFileSync(join(aside, "aaaa1111/shot.png"), "one");
    give(workspace, "aaaa1111", "shot.png", "one");
    give(workspace, "cccc3333", "late.png", "three");
    setAside(workspace, aside);
    assert.deepEqual(readdirSync(aside).sort(), ["aaaa1111", "cccc3333"]);
    assert.equal(existsSync(join(workspace, ".octave/attachments")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
