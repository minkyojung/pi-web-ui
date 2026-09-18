import assert from "node:assert/strict";
import test from "node:test";

import { projectsOf, withWorkspace } from "../electron/workspaces.js";

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
