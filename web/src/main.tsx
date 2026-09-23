import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { wireFirstSpec } from "./firstSpecWire";
import { switchWorkspace } from "./switch";
import { folderStore } from "./workspace";
import { watchSystem } from "./theme";
import { openSettings } from "./settingsOpen";
import { wireUpdates } from "./update";
import "./styles.css";

// index.html has already set the theme; this is only about it changing later.
watchSystem();
// The shell, if there is one, says where the updater is, and may ask for Settings.
wireUpdates(openSettings);
// And what this workspace was made to be told first, if it was made for a spec.
wireFirstSpec();

// The shell moves the window to another workspace without the page being
// made again — see switch.ts for what changes hands.
(window as { pi?: { workspaces?: { onShow?: (listen: (folder: string) => void) => void } } }).pi?.workspaces?.onShow?.(switchWorkspace);

/** The app under the folder it is on: another folder is another tree, begun from that folder's own tabs and history. */
function Root() {
	const folder = useSyncExternalStore(folderStore.subscribe, folderStore.get);
	return <App key={folder ?? ""} />;
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Root />
	</StrictMode>,
);
