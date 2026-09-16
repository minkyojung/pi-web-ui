import assert from "node:assert/strict";
import test from "node:test";

import { acceptCommand, commandQuery, matchCommands, namesCommand } from "../web/src/commandMenu.ts";

const commands = [
	{ name: "websearch", description: "Open web search curator", source: "extension" },
	{ name: "curator", source: "extension" },
	{ name: "search", description: "Browse stored web search results", source: "extension" },
	{ name: "fix-tests", source: "prompt" },
	{ name: "skill:brave-search", source: "skill" },
];

test("a slash and a word is a command being named; a space after it, or anything else, is not", () => {
	assert.equal(commandQuery("/"), "");
	assert.equal(commandQuery("/cur"), "cur");
	assert.equal(commandQuery("/curator on"), null);
	assert.equal(commandQuery("hello"), null);
	assert.equal(commandQuery(" /cur"), null);
	assert.equal(commandQuery("/cur\nmore"), null);
});

test("the list narrows: what the word begins first, then what it appears in, pi's order kept", () => {
	assert.deepEqual(matchCommands(commands, "").map((c) => c.name), commands.map((c) => c.name));
	assert.deepEqual(matchCommands(commands, "sea").map((c) => c.name), ["search", "websearch", "skill:brave-search"]);
	assert.deepEqual(matchCommands(commands, "CUR").map((c) => c.name), ["curator"]);
	assert.deepEqual(matchCommands(commands, "zzz"), []);
});

test("the first word names a command only if it is on the list, alone or with arguments", () => {
	assert.equal(namesCommand(commands, "/curator"), true);
	assert.equal(namesCommand(commands, "/curator on"), true);
	assert.equal(namesCommand(commands, "/curator\nsecond line"), true);
	assert.equal(namesCommand(commands, "/cur"), false);
	assert.equal(namesCommand(commands, "/curatorx"), false);
	assert.equal(namesCommand(commands, "curator"), false);
	assert.equal(namesCommand(commands, "/skill:brave-search please"), true);
});

test("accepting writes the command in with a space for its arguments", () => {
	assert.equal(acceptCommand("curator"), "/curator ");
});
