import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "../components/ui/tooltip";
import { GalleryPage } from "./GalleryPage";
import { HeaderBench } from "./HeaderBench";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		{/* The rows carry tooltips, and a tooltip needs the provider the app's root has. */}
		<TooltipProvider delayDuration={300}>
			{/* Two benches on one page: #header is the spec document's header, anything else the conversation. */}
			{location.hash === "#header" ? <HeaderBench /> : <GalleryPage />}
		</TooltipProvider>
	</StrictMode>,
);
