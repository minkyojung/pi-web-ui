import assert from "node:assert/strict";
import test from "node:test";

import { opened, projectsOf } from "../electron/workspaces.js";

const everywhere = () => true;
const tree = (path, name = "trenton") => ({ path, branch: `me/${name}`, name });

test("settings from before projects become projects: the folder in front first, then the recent ones", () => {
	const settings = { workdir: "/b", recent: ["/b", "/a", "/c"] };
	assert.deepEqual(projectsOf(settings, everywhere), [
		{ path: "/b", worktrees: [] },
		{ path: "/a", worktrees: [] },
		{ path: "/c", worktrees: [] },
	]);
});

test("once there are projects, the old folder list is not read again", () => {
	const settings = { workdir: "/z", recent: ["/z", "/y"], projects: [{ path: "/a", worktrees: [tree("/w")] }] };
	assert.deepEqual(projectsOf(settings, everywhere), [{ path: "/a", worktrees: [tree("/w")] }]);
});

test("settings with no folder at all have no projects", () => {
	assert.deepEqual(projectsOf({}, everywhere), []);
	assert.deepEqual(projectsOf({ projects: [] }, everywhere), []);
});

test("a project whose folder is gone is left out, and so is a worktree removed outside the app", () => {
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

test("opening a new folder adds it at the end; opening a known one leaves the list as it was", () => {
	const projects = [{ path: "/a", worktrees: [tree("/w")] }];
	assert.deepEqual(opened(projects, "/b"), [...projects, { path: "/b", worktrees: [] }]);
	assert.equal(opened(projects, "/a"), projects);
	assert.equal(opened(projects, "/w"), projects);
});
