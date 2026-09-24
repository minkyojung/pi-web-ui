import assert from "node:assert/strict";
import test from "node:test";

import { firstWorkspace, hiddenRepository, projectsOf, remembered, reordered, statusOf, withWorkspace, workspaceState } from "../electron/workspaces.js";

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

test("a workspace archived keeps its row, with the commit it stood on, and its repository keeps the rest", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one"), tree("/a-2", "two")], retired: [] }, { path: "/b", worktrees: [tree("/b-1", "three")], retired: [] }];
	const archived = workspaceState(projects, "/a-1", "archived", { commit: "abc", at: "2026-09-22T00:00:00.000Z" });
	assert.deepEqual(archived[0].worktrees, [{ ...tree("/a-1", "one"), state: "archived", commit: "abc", at: "2026-09-22T00:00:00.000Z" }, tree("/a-2", "two")]);
	assert.deepEqual(archived[1], projects[1], "the other repository is untouched");
	assert.deepEqual(workspaceState(projects, "/nowhere", "archived"), projects, "nothing by that path, nothing changed");
});

test("archiving is written before the folder goes, and what it remembers is kept when it is done", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one")], retired: [] }];
	const going = workspaceState(projects, "/a-1", "archiving", { commit: "abc" });
	assert.deepEqual(going[0].worktrees[0], { ...tree("/a-1", "one"), state: "archiving", commit: "abc" });
	const done = workspaceState(going, "/a-1", "archived", { at: "2026-09-22T00:00:00.000Z" });
	assert.deepEqual(done[0].worktrees[0], { ...tree("/a-1", "one"), state: "archived", commit: "abc", at: "2026-09-22T00:00:00.000Z" }, "the commit read before the folder went is still there");
});

test("a workspace brought back is a workspace again, and remembers nothing of having been away", () => {
	const projects = workspaceState([{ path: "/a", worktrees: [tree("/a-1", "one")], retired: [] }], "/a-1", "archived", { commit: "abc", at: "2026-09-22T00:00:00.000Z" });
	assert.deepEqual(workspaceState(projects, "/a-1", null)[0].worktrees, [tree("/a-1", "one")]);
});

test("an archived workspace is on the list though its folder is not, and is not the one the app opens on", () => {
	const settings = { projects: [{ path: "/a", worktrees: [{ ...tree("/a-1", "one"), state: "archived", commit: "abc" }, tree("/a-2", "two"), { ...tree("/a-3", "three"), state: "archiving" }] }] };
	const here = (path) => path === "/a" || path === "/a-2";
	const projects = projectsOf(settings, here);
	assert.deepEqual(projects[0].worktrees.map((w) => w.path), ["/a-1", "/a-2", "/a-3"], "only a workspace you can open has to be there");
	assert.equal(projects[0].worktrees[0].commit, "abc");
	assert.equal(firstWorkspace(projects, "/a-1"), null, "the one in front last time was archived since; the app starts on its first screen");
	assert.equal(firstWorkspace(projects, "/a-2"), "/a-2");
	const odd = projectsOf({ projects: [{ path: "/a", worktrees: [{ ...tree("/a-1", "one"), state: "gone", commit: 3 }] }] }, here);
	assert.deepEqual(odd[0].worktrees, [], "a state the settings made up is no state, and then the folder has to be there");
});

test("a branch's status is its pull request's when it has one, else only whether the remote has it — never merged by git alone", () => {
	const bare = { title: "", url: null, draft: false, review: "", checks: { total: 0, pending: 0, failed: 0 }, merge: "", added: null, deleted: null, commits: null, method: "" };
	assert.deepEqual(statusOf({ onRemote: true, pr: { number: 27, state: "OPEN" } }), { state: "open", number: 27, ...bare });
	assert.deepEqual(statusOf({ onRemote: true, pr: { number: 27, state: "MERGED" } }), { state: "merged", number: 27, ...bare });
	assert.deepEqual(statusOf({ onRemote: true, pr: { number: 27, state: "CLOSED" } }), { state: "closed", number: 27, ...bare });
	const full = { number: 30, title: "Merge it", state: "OPEN", url: "https://x/30", draft: true, review: "APPROVED", checks: { total: 2, pending: 1, failed: 0 }, merge: "CLEAN", added: 5, deleted: 1, commits: 3, method: "SQUASH" };
	assert.deepEqual(statusOf({ onRemote: true, pr: full }), { state: "open", number: 30, title: "Merge it", url: "https://x/30", draft: true, review: "APPROVED", checks: { total: 2, pending: 1, failed: 0 }, merge: "CLEAN", added: 5, deleted: 1, commits: 3, method: "SQUASH" }, "what gh said of it goes along");
	assert.deepEqual(statusOf({ onRemote: true, pr: null }), { state: "pushed" });
	assert.deepEqual(statusOf({ onRemote: false, pr: null }), { state: "local" });
	assert.deepEqual(statusOf({ onRemote: false, pr: { number: 1, state: "WHAT" } }), { state: "local" }, "a state gh does not have is no pull request");
});

test("the names of workspaces removed before archiving was how it was done are still not given out again", () => {
	const projects = projectsOf({ projects: [{ path: "/a", worktrees: [tree("/w/lima", "lima"), tree("/w/oslo", "oslo")], retired: ["tokyo", "tokyo", 3] }] }, everywhere);
	assert.deepEqual(projects[0].retired, ["tokyo"], "read once each, strings only");
	assert.deepEqual(withWorkspace([], "/b")[0].retired, [], "a repository new to the list has retired none");
});

test("the repositories go in the order they were dragged into", () => {
	const a = { path: "/a", worktrees: [tree("/a-1", "one")], retired: [] };
	const b = { path: "/b", worktrees: [], retired: [] };
	const c = { path: "/c", worktrees: [], retired: [] };
	assert.deepEqual(reordered([a, b, c], ["/c", "/a", "/b"]), [c, a, b]);
	assert.deepEqual(reordered([a, b, c], ["/a", "/b", "/c"]), [a, b, c]);
	assert.deepEqual(reordered([a, b, c], []), [a, b, c], "no order named, the order it was in");
});

test("an order dropped on a list that has since grown moves what it names and keeps the rest", () => {
	const a = { path: "/a", worktrees: [], retired: [] };
	const b = { path: "/b", worktrees: [], retired: [] };
	const added = { path: "/new", worktrees: [], retired: [] };
	assert.deepEqual(reordered([a, b, added], ["/b", "/a"]), [b, a, added], "the one it did not name keeps its place at the end");
	assert.deepEqual(reordered([a, b], ["/b", "/gone", "/a"]), [b, a], "a path that is no repository is nothing");
	assert.deepEqual(reordered([a, b], ["/b", "/b", "/a"]), [b, a], "and one named twice is one repository");
	assert.deepEqual(reordered([a, b], null), [a, b], "what is not a list of paths leaves the order alone");
});

test("a repository taken off the list is still in the settings, with everything it had", () => {
	const projects = [{ path: "/a", worktrees: [tree("/a-1", "one")], retired: ["tokyo"] }, { path: "/b", worktrees: [], retired: [] }];
	const hidden = hiddenRepository(projects, "/a", true);
	assert.deepEqual(hidden[0], { path: "/a", worktrees: [tree("/a-1", "one")], retired: ["tokyo"], hidden: true });
	assert.deepEqual(hidden[1], projects[1]);
	assert.deepEqual(hiddenRepository(hidden, "/a", false), projects, "adding it again is the whole of the way back");
	assert.deepEqual(hiddenRepository(projects, "/nowhere", true), projects);
});

test("a hidden repository is read back as it was written, and the app does not open on one of its workspaces", () => {
	const settings = { projects: [{ path: "/a", worktrees: [tree("/a-1", "one")], hidden: true }, { path: "/b", worktrees: [tree("/b-1", "two")] }] };
	const projects = projectsOf(settings, everywhere);
	assert.equal(projects[0].hidden, true, "still here: everything written back goes through this");
	assert.equal(projects[1].hidden, undefined);
	assert.equal(firstWorkspace(projects, "/a-1"), null, "its workspace is not the one in front");
	assert.equal(firstWorkspace(projects, "/b-1"), "/b-1");
	assert.equal(projectsOf({ projects: [{ path: "/a", worktrees: [], hidden: "yes" }] }, everywhere)[0].hidden, undefined, "hidden is a yes or nothing");
});

/** A clock and an asker under the test's hand, and what the cache said and when it called back. */
function cache({ staleMs = 30 } = {}) {
	let at = 0;
	const asks = [];
	const fresh = [];
	const ask = (key) => new Promise((resolve, reject) => asks.push({ key, resolve, reject }));
	const get = remembered({ ask, onFresh: (key) => fresh.push(key), now: () => at, staleMs });
	return { get, asks, fresh, tick: (ms) => (at += ms), settle: () => new Promise((r) => setImmediate(r)) };
}

test("what is asked is answered at once with what was last known, and asked again only when that is stale", async () => {
	const c = cache();
	assert.equal(c.get("/a"), null, "nothing known yet is null, not a wait");
	assert.equal(c.asks.length, 1, "and the ask is under way");
	assert.equal(c.get("/a"), null);
	assert.equal(c.asks.length, 1, "asked once, however many look while it is out");
	c.asks[0].resolve("one");
	await c.settle();
	assert.deepEqual(c.fresh, ["/a"], "the answer landing is said, once");
	assert.equal(c.get("/a"), "one");
	c.tick(29);
	assert.equal(c.get("/a"), "one");
	assert.equal(c.asks.length, 1, "fresh enough is not asked again");
	c.tick(1);
	assert.equal(c.get("/a"), "one", "stale is still answered with what was known");
	assert.equal(c.asks.length, 2, "and asked again behind it");
});

test("an ask that fails keeps what was known, says nothing, and is not asked again until the next stale", async () => {
	const c = cache();
	c.get("/a");
	c.asks[0].resolve("one");
	await c.settle();
	c.tick(30);
	c.get("/a");
	c.asks[1].reject(new Error("gh is not signed in"));
	await c.settle();
	assert.equal(c.get("/a"), "one", "the last answer stands");
	assert.deepEqual(c.fresh, ["/a"], "a failure is not news");
	assert.equal(c.asks.length, 2, "and gh is left alone for a while");
	c.tick(30);
	c.get("/a");
	assert.equal(c.asks.length, 3);
});

test("again: the next asking asks at once, and an answer already on its way when it was said is taken as old", async () => {
	const c = cache();
	c.get("/a");
	c.asks[0].resolve("open");
	await c.settle();
	assert.equal(c.get("/a"), "open");
	assert.equal(c.asks.length, 1, "fresh: not asked");
	c.get.again("/a");
	assert.equal(c.get("/a"), "open", "what was known is still given");
	assert.equal(c.asks.length, 2, "and asked at once");
	// Said again while that ask is on its way: its answer began before.
	c.get.again("/a");
	c.asks[1].resolve("open");
	await c.settle();
	assert.deepEqual(c.fresh, ["/a", "/a"]);
	c.get("/a");
	assert.equal(c.asks.length, 3, "asked again at once");
	c.asks[2].resolve("merged");
	await c.settle();
	assert.equal(c.get("/a"), "merged");
	assert.equal(c.asks.length, 3, "and that answer is fresh");
	c.get.again("/nobody");
});

test("each key is remembered on its own", async () => {
	const c = cache();
	c.get("/a");
	c.get("/b");
	c.asks[1].resolve("bee");
	await c.settle();
	assert.equal(c.get("/a"), null);
	assert.equal(c.get("/b"), "bee");
	assert.deepEqual(c.fresh, ["/b"]);
});
