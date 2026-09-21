import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { wireFirstSpec } from "./firstSpecWire";
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

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
