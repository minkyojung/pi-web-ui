import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { watchSystem } from "./theme";
import "./styles.css";

// index.html has already set the theme; this is only about it changing later.
watchSystem();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
