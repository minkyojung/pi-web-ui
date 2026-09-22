import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { configStore } from "../serverState";
import { bridge, dismissed, offer, restartWhenIdle, updateStore } from "../update";

/**
 * The offer to restart into a new version, in the corner — the update flow's
 * one interruption, and a small one.
 *
 * Drawn from two things the page already has: the shell's updater state and
 * the agent's (the config). One toast, by id, so a change redraws it rather
 * than stacking another; it stays until it is answered. Waved away, it does
 * not come back for that version — the dot on the settings button is what is
 * left, and quitting installs on the way out — and a newer version is a new
 * offer.
 */
const ID = "update";

export function UpdateToast() {
	const update = useSyncExternalStore(updateStore.subscribe, updateStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const [waiting, setWaiting] = useState(false);
	const cancel = useRef<(() => void) | null>(null);

	const version = update?.phase === "ready" ? update.version : null;
	const what = offer(update, config, waiting);
	const hidden = !what || (version !== null && dismissed(update, version));

	useEffect(() => {
		if (hidden || !what) {
			toast.dismiss(ID);
			return;
		}
		const pi = bridge();
		if (!pi) return;
		toast(what.title, {
			id: ID,
			duration: Infinity,
			closeButton: true,
			description: what.description,
			action: {
				label: what.action === "restart" ? "Restart" : what.action === "wait" ? "Restart when done" : "Keep running",
				onClick: (event) => {
					// The toast stays: it is redrawn with the new state, not closed.
					event.preventDefault();
					if (what.action === "restart") void pi.restart();
					else if (what.action === "wait") {
						cancel.current = restartWhenIdle(pi);
						setWaiting(true);
					} else {
						cancel.current?.();
						cancel.current = null;
						setWaiting(false);
					}
				},
			},
			onDismiss: () => {
				if (version) void pi.dismiss(version);
				cancel.current?.();
				cancel.current = null;
				setWaiting(false);
			},
		});
	}, [hidden, what?.title, what?.description, what?.action, version]);

	return null;
}
