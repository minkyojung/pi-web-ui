/**
 * Record a real pi session to a test fixture.
 *
 * Fixtures are recordings, not hand-written samples, so the tests can only pass
 * on shapes pi actually emits. This costs real API tokens, so it is manual and
 * never part of `npm test`. Re-record only when a pi upgrade breaks a test.
 *
 *   node scripts/record.mjs test/fixtures/turn-with-tools.json "Run `ls -1` and …"
 */

import { writeFileSync } from "node:fs";

import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const [output, prompt] = process.argv.slice(2);
if (!output || !prompt) {
	console.error("usage: node scripts/record.mjs <output.json> <prompt>");
	process.exit(1);
}

const MODEL = process.env.MODEL ?? "openai/gpt-5.4";
const [provider, ...rest] = MODEL.split("/");
const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel(provider, rest.join("/"));
if (!model) throw new Error(`unknown model: ${MODEL}`);

const { session } = await createAgentSession({
	model,
	modelRuntime,
	// Nothing to keep; the recording is the artifact.
	sessionManager: SessionManager.inMemory(),
});

const events = [];
session.subscribe((event) => events.push(event));

try {
	await session.prompt(prompt);
	await session.waitForIdle();
} finally {
	session.dispose();
}

// agent_end carries the run's messages, which is what itemsFromMessages consumes,
// so one recording holds both sides of the live/resumed contract.
writeFileSync(output, JSON.stringify(events, null, 0));
console.log(`${events.length} events -> ${output}`);
