import assert from "node:assert/strict";
import test from "node:test";

import { byStatus, listOf, wordCommand, wordsFor } from "../web/src/taskList.ts";

const PLAN = `# Tasks — email-auth

## Backend
- [ ] 1. Add the users table
  - a migration in db/
  - _Requirements: 1.1, 1.2_
  - _Done when: \`npm test -- auth\` passes_
- [ ] 2. Sign-in endpoint
- [ ] 2.1 POST /login
  - _Requirements: 1.3_
- [ ] 2.2 Rate limit
  - _After: 2.1_

## UI
- [ ] 3. Sign-in form
  - _After: 2.1_
- [-] 4. Remember me
`;

const result = (task, at, exit = 0) => ({ task, commit: `${task}-${at}`, short: `${task}${at}`, title: "", at, checks: null, verified: [{ name: "check", exit }], files: [], added: 10, deleted: 1 });

test("rows fall under the plan's headings, each with a standing from the box, git and the session", () => {
	const list = listOf(PLAN, { results: [result("1", 5), result("1", 9, 1)], running: "2.1" });
	assert.equal(list.head, "# Tasks — email-auth");
	assert.deepEqual(list.sections.map((s) => [s.title, s.rows.map((r) => r.number)]), [["Backend", ["1", "2", "2.1", "2.2"]], ["UI", ["3", "4"]]]);
	const [backend, ui] = list.sections;
	const standing = Object.fromEntries([...backend.rows, ...ui.rows].map((r) => [r.number, r.standing]));
	assert.deepEqual(standing, { "1": "review", "2": "running", "2.1": "running", "2.2": "next", "3": "todo", "4": "cancelled" }, "1 has run and waits to be looked at; 2 runs by way of 2.1; 2.2 is next since 1 is in review and 2.1 runs");
	assert.equal(backend.rows[0].tries, 2);
	assert.equal(backend.rows[0].latest.commit, "1-9", "the newest run is the one shown");
	assert.deepEqual(backend.rows[1].count, { done: 0, total: 2 }, "a heading counts its sub-tasks");
	assert.deepEqual([backend.done, backend.total], [0, 3], "the heading is not a task of its own");
	assert.deepEqual([ui.done, ui.total], [0, 1], "one set aside is not to do");
	assert.deepEqual(list.counts, { running: 1, review: 1, next: 1, todo: 1, done: 0, cancelled: 1 });
	assert.equal(list.started, true);
});

test("what a task waits on is its _After_ line less what is done, and is nothing to draw before anything has run", () => {
	const fresh = listOf(PLAN, { results: [], running: null });
	assert.equal(fresh.started, false);
	const rows = Object.fromEntries(fresh.sections.flatMap((s) => s.rows).map((r) => [r.number, r]));
	assert.deepEqual(rows["2.2"].waits, ["2.1"]);
	assert.deepEqual(rows["3"].after, ["2.1"]);
	const later = listOf(PLAN.replace("- [ ] 2.1", "- [x] 2.1"), { results: [], running: null });
	assert.deepEqual(Object.fromEntries(later.sections.flatMap((s) => s.rows).map((r) => [r.number, r.waits]))["2.2"], [], "done, it is waited on no longer");
});

test("a plan with no headings is one section with no title", () => {
	const list = listOf("- [ ] 1. A\n- [ ] 2. B\n", { results: [], running: null });
	assert.deepEqual(list.sections.map((s) => [s.title, s.rows.length]), [[null, 2]]);
	assert.equal(listOf("# Nothing yet\n", { results: [], running: null }).sections.length, 0);
});

test("by standing: the same tasks under In progress, Review, To do, Done, Set aside — headings' own rows left out, empty groups too", () => {
	const list = listOf(PLAN.replace("- [ ] 1.", "- [x] 1."), { results: [result("2.1", 3)], running: null });
	assert.deepEqual(byStatus(list).map((s) => [s.title, s.rows.map((r) => r.number)]), [["Review", ["2.1"]], ["To do", ["2.2", "3"]], ["Done", ["1"]], ["Set aside", ["4"]]]);
});

test("what can be said of a task depends on where it stands, and each word is a command with the spec and the number", () => {
	assert.deepEqual(wordsFor("review"), ["done", "cancel"]);
	assert.deepEqual(wordsFor("todo"), ["cancel"]);
	assert.deepEqual(wordsFor("done"), ["reopen"]);
	assert.deepEqual(wordsFor("running"), []);
	assert.equal(wordCommand("done", "email-auth", "2.1"), "/spec-done email-auth 2.1");
});
