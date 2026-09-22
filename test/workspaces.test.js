import assert from "node:assert/strict";
import test from "node:test";

import { firstWorkspace, projectsOf, statusOf, withWorkspace, withoutWorkspace } from "../electron/workspaces.js";

const everywhere = () => true;
const tree = (path, name = "trenton") => ({ path, branch: `me/${name}`, name });

test("the projects are what the settings hold, and the folders opened before them are not made into projects", () => {
	assert.deepEqual(projectsOf({ workdir: "/b", recent: ["/b", "/a"] }, everywhere), []);
	assert.deepEqual(projectsOf({ workdir: "/z", projects: [{ path: "/a", worktrees: [tree("/w")] }] }, everywhere), [{ path: "/a", worktrees: [tree("/w")] }]);
});

test("settings with no projects have none", () => {
	assert.deepEqual(projectsOf({}, everywhere), []);
	assert.deepEqual(projectsOf({ projects: [] }, everywhere), []);
});

test("a project whose clone is gone is left out, and so is a worktree removed outside the app", () => {
	const settings = { projects: [{ path: "/gone", worktrees: [] }, { path: "/a", worktrees: [tree("/a-1", "one"), tree("/a-2", "two")] }] };
	const exists = (path) => path !== "/gone" && path !== "/a-1";
	assert.deepEqual(projectsOf(settings, exists), [{ path: "/a", worktrees: [tree("/a-2", "two")] }]);
});

test("what the settings hold that is not a project or a worktree is left out rather than trusted", () => {
	const settings = {
		projects: [null, { path: "" }, { path: 3 }, { path: "/a", worktrees: [null, { path: "/w" }, tree("/w2")] }, { path: "/a", worktrees: [] }],
	};
	assert.deepEqual(projectsOf(settings, everywhere), [{ path: "/a", worktrees: [tree("/w2")] }]);
});

test("a folder is listed once, whether as a project or as a worktree", () => {
	const settings = { projects: [{ path: "/a", worktrees: [tree("/w")] }, { path: "/w", worktrees: [] }] };
	assert.deepEqual(projectsOf(settings, everywhere), [{ path: "/a", worktrees: [tree("/w")] }]);
});

test("a new repository goes at the end, with its workspace when it has one", () => {
	const projects = [{ path: "/a", worktrees: [] }];
	assert.deepEqual(withWorkspace(projects, "/b"), [...projects, { path: "/b", worktrees: [] }]);
	assert.deepEqual(withWorkspace(projects, "/b", tree("/b-1")), [...projects, { path: "/b", worktrees: [tree("/b-1")] }]);
});

test("a new workspace goes at the end of its repository's, and the others keep their places", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one")] }, { path: "/b", worktrees: [] }];
	assert.deepEqual(withWorkspace(projects, "/a", tree("/a-2", "two")), [{ path: "/a", worktrees: [tree("/a-1", "one"), tree("/a-2", "two")] }, projects[1]]);
});

test("what is already there leaves the list as it was", () => {
	const projects = [{ path: "/a", worktrees: [tree("/w")] }];
	assert.equal(withWorkspace(projects, "/a"), projects);
	assert.equal(withWorkspace(projects, "/a", tree("/w")), projects);
});

test("starting opens the workspace in front last time, and no other in its place", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one")] }, { path: "/b", worktrees: [tree("/b-1", "two")] }];
	assert.equal(firstWorkspace(projects, "/b-1"), "/b-1");
	assert.equal(firstWorkspace(projects, "/gone"), null, "one the person did not open is not opened for them");
	assert.equal(firstWorkspace(projects, null), null);
	assert.equal(firstWorkspace([{ path: "/a", worktrees: [] }], "/a"), null, "a repository's own clone is not a workspace");
	assert.equal(firstWorkspace([], "/notes"), null);
});

test("a workspace removed leaves its repository on the list, with the rest of its workspaces", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one"), tree("/a-2", "two")] }, { path: "/b", worktrees: [tree("/b-1", "three")] }];
	assert.deepEqual(withoutWorkspace(projects, "/a-1"), [{ path: "/a", worktrees: [tree("/a-2", "two")] }, projects[1]]);
	assert.deepEqual(withoutWorkspace(projects, "/b-1"), [projects[0], { path: "/b", worktrees: [] }]);
	assert.equal(withoutWorkspace(projects, "/nowhere")[0], projects[0], "nothing by that path, nothing changed");
});

test("a branch's status is its pull request's when it has one, else only whether the remote has it — never merged by git alone", () => {
	const bare = { url: null, draft: false, review: "", checks: { total: 0, pending: 0, failed: 0 } };
	assert.deepEqual(statusOf({ onRemote: true, pr: { number: 27, state: "OPEN" } }), { state: "open", number: 27, ...bare });
	assert.deepEqual(statusOf({ onRemote: true, pr: { number: 27, state: "MERGED" } }), { state: "merged", number: 27, ...bare });
	assert.deepEqual(statusOf({ onRemote: true, pr: { number: 27, state: "CLOSED" } }), { state: "closed", number: 27, ...bare });
	const full = { number: 30, state: "OPEN", url: "https://x/30", draft: true, review: "APPROVED", checks: { total: 2, pending: 1, failed: 0 } };
	assert.deepEqual(statusOf({ onRemote: true, pr: full }), { state: "open", number: 30, url: "https://x/30", draft: true, review: "APPROVED", checks: { total: 2, pending: 1, failed: 0 } }, "what gh said of it goes along");
	assert.deepEqual(statusOf({ onRemote: true, pr: null }), { state: "pushed" });
	assert.deepEqual(statusOf({ onRemote: false, pr: null }), { state: "local" });
	assert.deepEqual(statusOf({ onRemote: false, pr: { number: 1, state: "WHAT" } }), { state: "local" }, "a state gh does not have is no pull request");
});
