/**
 * A request's body, read whole and capped — the two shapes the server takes.
 * Small, and here rather than beside either reader, since the process reads
 * one (a settings patch, server.ts) and a folder the other (an attachment,
 * workspace.ts).
 */
import type { IncomingMessage } from "node:http";

/** A small request body, whole. Capped: the one endpoint that takes one takes a few fields. */
export function text(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let out = "";
		req.on("data", (chunk) => {
			out += chunk;
			if (out.length > 4096) reject(new Error("too large"));
		});
		req.on("end", () => resolve(out));
		req.on("error", reject);
	});
}

/** A file's bytes, whole, or a refusal once they pass the cap — the connection is dropped there, not read to its end. */
export function bytes(req: IncomingMessage, max: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > max) {
				reject(new Error("too large"));
				req.destroy();
			} else chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
