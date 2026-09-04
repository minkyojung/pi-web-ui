import { useSyncExternalStore } from "react";

import { rawStore } from "../serverState";

/** The debug view. Mounted only while it is on, so events cost nothing to keep otherwise. */
export function RawView() {
	const events = useSyncExternalStore(rawStore.subscribe, rawStore.get);
	return (
		<pre id="raw" className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
			{events.map((event) => `${event}\n`).join("")}
		</pre>
	);
}
