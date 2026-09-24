import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "../components/ui/tooltip";
import { GalleryPage } from "./GalleryPage";
import { HeaderBench } from "./HeaderBench";
import { StatusBench } from "./StatusBench";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		{/* The rows carry tooltips, and a tooltip needs the provider the app's root has. */}
		<TooltipProvider delayDuration={300}>
			{/* Benches on one page: #header is the spec document's header, #status the branch at the foot of the window, anything else the conversation. */}
			{location.hash === "#header" ? <HeaderBench /> : location.hash === "#status" ? <StatusBench /> : <GalleryPage />}
		</TooltipProvider>
	</StrictMode>,
);
