import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "../components/ui/tooltip";
import { GalleryPage } from "./GalleryPage";
import { TasksMock } from "./TasksMock";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		{/* The rows carry tooltips, and a tooltip needs the provider the app's root has. */}
		<TooltipProvider delayDuration={300}>
			{/* `?tasks`: the tasks view mock, to be looked at before it is built over the editor. */}
			{new URLSearchParams(location.search).has("tasks") ? <TasksMock /> : <GalleryPage />}
		</TooltipProvider>
	</StrictMode>,
);
