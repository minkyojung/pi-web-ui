import { useEffect, useState } from "react";

import { blocksOf, spansOf } from "../pages";
import { bridge, updateStore } from "../update";

/**
 * What changed in a version, as the middle column: the changelog's section,
 * read from the server, drawn with the three marks it uses. Opened by the
 * app on the first run of a new version and from Help › What's New.
 *
 * Being on screen is what "seen" means: the shell is told on mount, so the
 * tab is not opened again for this version, whether it is read or closed.
 */
export function WhatsNew({ version }: { version: string }) {
	const [notes, setNotes] = useState<string | null | undefined>(undefined);
	useEffect(() => {
		let gone = false;
		fetch(`/api/changelog?version=${encodeURIComponent(version)}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((body: { notes: string }) => !gone && setNotes(body.notes))
			.catch(() => !gone && setNotes(null));
		return () => {
			gone = true;
		};
	}, [version]);
	useEffect(() => {
		if (updateStore.get()?.justUpdated?.to === version) void bridge()?.seen();
	}, [version]);

	return (
		<div id="page" className="no-scrollbar edge-top flex min-h-0 flex-1 flex-col overflow-y-auto">
			<article className="mx-auto w-full max-w-2xl px-8 py-10 text-[16px] leading-7">
				<h1 className="mb-6 text-2xl font-semibold tracking-tight">What's new in {version}</h1>
				{notes === undefined && <p className="text-muted-foreground">Reading…</p>}
				{notes === null && <p className="text-muted-foreground">This version's notes are not here to read.</p>}
				{notes &&
					blocksOf(notes).map((block, i) =>
						block.kind === "heading" ? (
							<h2 key={i} className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								{block.text}
							</h2>
						) : block.kind === "list" ? (
							<ul key={i} className="mb-4 list-disc space-y-2 pl-5">
								{block.items.map((item, j) => (
									<li key={j}>
										<Spans text={item} />
									</li>
								))}
							</ul>
						) : (
							<p key={i} className="mb-4">
								<Spans text={block.text} />
							</p>
						),
					)}
			</article>
		</div>
	);
}

function Spans({ text }: { text: string }) {
	return (
		<>
			{spansOf(text).map((s, i) => (s.code ? <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{s.text}</code> : <span key={i}>{s.text}</span>))}
		</>
	);
}
