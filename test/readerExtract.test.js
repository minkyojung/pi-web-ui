import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { extract } from "../reader/extract.ts";

/** A site on localhost, so what it answers is the thing under test. */
async function serving(reply) {
	const server = createServer(reply);
	await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
	const url = `http://127.0.0.1:${server.address().port}/`;
	return { url, close: () => new Promise((ok) => server.close(ok)) };
}

const page = "<html><head><title>T</title></head><body><article>" +
	"<p>Long enough that Readability keeps it around as the body of the piece.</p>".repeat(6) +
	"</article></body></html>";

test("a page that answers 200 is read", async () => {
	const site = await serving((_, res) => {
		res.writeHead(200, { "content-type": "text/html" });
		res.end(page);
	});
	const r = await extract(site.url);
	assert.equal(r.status, "ok");
	assert.equal(r.title, "T");
	await site.close();
});

test("a 2xx that is not 200 is a gate, not a page", async () => {
	// A bot wall answering 202 with its own html used to pass `res.ok`, get
	// parsed, come up empty, and be written down as "failed" — the wrong cause.
	const site = await serving((_, res) => {
		res.writeHead(202, { "content-type": "text/html" });
		res.end("<html><body>Checking your browser…</body></html>");
	});
	assert.equal((await extract(site.url)).status, "blocked");
	await site.close();
});

test("401/402/403 stay blocked and 4xx below them stay failed", async () => {
	for (const [code, status] of [[403, "blocked"], [401, "blocked"], [404, "failed"], [500, "failed"]]) {
		const site = await serving((_, res) => {
			res.writeHead(code, { "content-type": "text/html" });
			res.end("nope");
		});
		assert.equal((await extract(site.url)).status, status, `${code}`);
		await site.close();
	}
});

test("force walks past the excluded list, which is about feeds, not about asking", async () => {
	assert.equal((await extract("https://github.com/x/y")).status, "excluded");
	// Without `force` the fetch never happens; with it, the domain is no reason
	// to skip. Only that difference is asserted, not what github answers.
	assert.notEqual((await extract("https://github.com/x/y", { force: true })).status, "excluded");
});
