/**
 * The page the app opens on when there is no workspace to open: no
 * repository has been added yet. It is served by the shell rather than by a
 * server (electron/appScheme.js), since until there is a repository there is
 * no folder for a server to work in.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Start } from "./components/Start";
import { watchSystem } from "./theme";
import "./styles.css";

// start.html has already set the theme; this is only about it changing later.
watchSystem();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Start />
	</StrictMode>,
);
