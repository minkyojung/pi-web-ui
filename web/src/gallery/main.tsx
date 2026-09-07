import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { GalleryPage } from "./GalleryPage";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<GalleryPage />
	</StrictMode>,
);
