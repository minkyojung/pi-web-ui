import { useSyncExternalStore } from "react";

import { rawStore } from "../serverState";

/** The debug view. Mounted only while it is on, so events cost nothing to keep otherwise. */
export function RawView() {
	const events = useSyncExternalStore(rawStore.subscribe, rawStore.get);
	return <pre id="raw">{events.map((event) => `${event}\n`).join("")}</pre>;
}
