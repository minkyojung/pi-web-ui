import assert from "node:assert/strict";
import test from "node:test";

import { firstWorkspace, projectsOf, statusOf, withWorkspace, withoutWorkspace } from "../electron/workspaces.js";

const everywhere = () => true;
const tree = (path, name = "trenton") => ({ path, branch: `me/${name}`, name });

test("the projects are what the settings hold, and the folders opened before them are not made into projects", () => {
	assert.deepEqual(projectsOf({ workdir: "/b", recent: ["/b", "/a"] }, everywhere), []);
	assert.deepEqual(projectsOf({ workdir: "/z", projects: [{ path: "/a", worktrees: [tree("/w")] }] }, everywhere), [{ path: "/a", worktrees: [tree("/w")], retired: [] }]);
});

test("settings with no projects have none", () => {
	assert.deepEqual(projectsOf({}, everywhere), []);
	assert.deepEqual(projectsOf({ projects: [] }, everywhere), []);
});

test("a project whose clone is gone is left out, and so is a worktree removed outside the app", () => {
	const settings = { projects: [{ path: "/gone", worktrees: [] }, { path: "/a", worktrees: [tree("/a-1", "one"), tree("/a-2", "two")] }] };
	const exists = (path) => path !== "/gone" && path !== "/a-1";
	assert.deepEqual(projectsOf(settings, exists), [{ path: "/a", worktrees: [tree("/a-2", "two")], retired: [] }]);
});

test("what the settings hold that is not a project or a worktree is left out rather than trusted", () => {
	const settings = {
		projects: [null, { path: "" }, { path: 3 }, { path: "/a", worktrees: [null, { path: "/w" }, tree("/w2")], retired: [] }, { path: "/a", worktrees: [], retired: [] }],
	};
	assert.deepEqual(projectsOf(settings, everywhere), [{ path: "/a", worktrees: [tree("/w2")], retired: [] }]);
});

test("a folder is listed once, whether as a project or as a worktree", () => {
	const settings = { projects: [{ path: "/a", worktrees: [tree("/w")] }, { path: "/w", worktrees: [] }] };
	assert.deepEqual(projectsOf(settings, everywhere), [{ path: "/a", worktrees: [tree("/w")], retired: [] }]);
});

test("a new repository goes at the end, with its workspace when it has one", () => {
	const projects = [{ path: "/a", worktrees: [], retired: [] }];
	assert.deepEqual(withWorkspace(projects, "/b"), [...projects, { path: "/b", worktrees: [], retired: [] }]);
	assert.deepEqual(withWorkspace(projects, "/b", tree("/b-1")), [...projects, { path: "/b", worktrees: [tree("/b-1")], retired: [] }]);
});

test("a new workspace goes at the end of its repository's, and the others keep their places", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one")], retired: [] }, { path: "/b", worktrees: [], retired: [] }];
	assert.deepEqual(withWorkspace(projects, "/a", tree("/a-2", "two")), [{ path: "/a", worktrees: [tree("/a-1", "one"), tree("/a-2", "two")], retired: [] }, projects[1]]);
});

test("what is already there leaves the list as it was", () => {
	const projects = [{ path: "/a", worktrees: [tree("/w")], retired: [] }];
	assert.equal(withWorkspace(projects, "/a"), projects);
	assert.equal(withWorkspace(projects, "/a", tree("/w")), projects);
});

test("starting opens the workspace in front last time, and no other in its place", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one")], retired: [] }, { path: "/b", worktrees: [tree("/b-1", "two")], retired: [] }];
	assert.equal(firstWorkspace(projects, "/b-1"), "/b-1");
	assert.equal(firstWorkspace(projects, "/gone"), null, "one the person did not open is not opened for them");
	assert.equal(firstWorkspace(projects, null), null);
	assert.equal(firstWorkspace([{ path: "/a", worktrees: [], retired: [] }], "/a"), null, "a repository's own clone is not a workspace");
	assert.equal(firstWorkspace([], "/notes"), null);
});

test("a workspace removed leaves its repository on the list, with the rest of its workspaces", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one"), tree("/a-2", "two")], retired: [] }, { path: "/b", worktrees: [tree("/b-1", "three")], retired: [] }];
	assert.deepEqual(withoutWorkspace(projects, "/a-1"), [{ path: "/a", worktrees: [tree("/a-2", "two")] , retired: ["one"] }, projects[1]]);
	assert.deepEqual(withoutWorkspace(projects, "/b-1"), [projects[0], { path: "/b", worktrees: [] , retired: ["three"] }]);
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

test("a workspace removed retires its name, so the repository never makes another by it and opens on its conversations", () => {
	const projects = projectsOf({ projects: [{ path: "/a", worktrees: [tree("/w/lima", "lima"), tree("/w/oslo", "oslo")], retired: ["tokyo", "tokyo", 3] }] }, everywhere);
	assert.deepEqual(projects[0].retired, ["tokyo"], "read once each, strings only");
	const after = withoutWorkspace(projects, "/w/lima");
	assert.deepEqual(after[0].worktrees, [tree("/w/oslo", "oslo")]);
	assert.deepEqual(after[0].retired, ["tokyo", "lima"]);
	assert.deepEqual(withoutWorkspace(after, "/w/nowhere"), after);
	assert.deepEqual(withWorkspace([], "/b")[0].retired, [], "a repository new to the list has retired none");
});
