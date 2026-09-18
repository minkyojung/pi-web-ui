import assert from "node:assert/strict";
import test from "node:test";

import { configStore } from "../web/src/serverState.ts";
import { agentIdle, offer, restartWhenIdle } from "../web/src/update.ts";

const ready = { phase: "ready", version: "0.0.4", progress: 100, error: null, justUpdated: null };
const config = (isStreaming, followUp = []) => ({ isStreaming, queued: { steering: [], followUp } });

test("the agent is idle when nothing is in hand and nothing is waiting", () => {
	assert.equal(agentIdle(null), false, "no config yet is not idle: nothing is known");
	assert.equal(agentIdle(config(false)), true);
	assert.equal(agentIdle(config(true)), false);
	assert.equal(agentIdle(config(false, ["one more"])), false, "a message waiting to be sent is work to come");
});

test("the offer is for now when the agent is idle, for later while it works, and says so while waiting", () => {
	assert.equal(offer(null, config(false), false), null, "nothing to offer before anything is ready");
	assert.equal(offer({ ...ready, phase: "downloading" }, config(false), false), null);
	assert.deepEqual(offer(ready, config(false), false), { title: "Octave 0.0.4 is ready", action: "restart" });
	assert.equal(offer(ready, config(true), false).action, "wait");
	assert.equal(offer(ready, config(true), true).action, "cancel");
	assert.match(offer(ready, config(true), true).description, /when the agent is done/);
});

test("a restart asked for while the agent works happens when it stops, and can be called off", () => {
	const restarts = [];
	const pi = { restart: async () => restarts.push(Date.now()) };
	configStore.set(config(true));
	const cancel = restartWhenIdle(pi);
	assert.equal(restarts.length, 0, "not while it is working");
	configStore.set(config(true, ["queued"]));
	configStore.set(config(false, ["queued"]));
	assert.equal(restarts.length, 0, "not while a message is still waiting to go");
	configStore.set(config(false));
	assert.equal(restarts.length, 1, "the moment it is idle");
	configStore.set(config(false));
	assert.equal(restarts.length, 1, "once");
	cancel();

	configStore.set(config(true));
	const stop = restartWhenIdle(pi);
	stop();
	configStore.set(config(false));
	assert.equal(restarts.length, 1, "called off, it does not happen");

	configStore.set(config(false));
	restartWhenIdle(pi);
	assert.equal(restarts.length, 2, "already idle: now");
	configStore.set(null);
});
