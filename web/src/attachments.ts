/**
 * Files on their way into the folder from the page — the message box's
 * (every kind, as chips) and a note's pictures — by the server's one door.
 */

import { forFolder } from "./workspace.ts";

/**
 * Put a file in the folder by the server's one door (attach.ts there) and
 * say where it went. A refusal comes back as the server worded it. `from` is
 * the note it is for, where there is one: a vault may keep such files beside
 * the note. `to: "message"` is for the message box instead, whose files are
 * kept out of the work (attach.ts saveMessageAttachment). `name` is for the
 * file that came without one worth keeping.
 */
export async function attach(file: File, { name = file.name, from = "", to }: { name?: string; from?: string; to?: "message" } = {}): Promise<string> {
	const res = await fetch(forFolder(`/api/attachment?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}${to ? `&to=${to}` : ""}`), {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: file,
	});
	const said = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
	if (!res.ok || !said.path) throw new Error(said.error ?? `the server said ${res.status}`);
	return said.path;
}

/**
 * The name a pasted picture is kept under. A clipboard's picture comes as
 * "image.png" whatever it shows, so that one is named from the moment, as
 * Obsidian names it; a file with a name of its own keeps it.
 */
export function pastedName(given: string, type: string, now = new Date()): string {
	const dot = given.lastIndexOf(".");
	const ext = dot > 0 ? given.slice(dot) : `.${(type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`;
	const stem = (dot > 0 ? given.slice(0, dot) : given).trim();
	if (!/^(image|screenshot|pasted image)?$/i.test(stem)) return `${stem}${ext}`;
	const p = (n: number) => String(n).padStart(2, "0");
	return `Pasted image ${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${ext}`;
}
