import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { vaultUrl } from "../pages";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/** Where vite puts what pdf.js reads beside itself — character maps, the fourteen standard fonts, its decoders. See vite.config.ts. */
const ASSETS = "/pdfjs/";

/**
 * A PDF in the folder, as the middle column.
 *
 * Drawn by pdf.js's own viewer rather than onto a canvas by hand: it is the
 * part that lays a layer of real text over each page, so words can be chosen
 * with the mouse like any words in the window, draws only the pages near the
 * ones in view, and follows the links inside the file. It is what Firefox
 * and Obsidian show a PDF with. This file is the little that is left — give
 * it a place to scroll in, the file, and the column's width to fit to.
 *
 * Loaded when a PDF is first opened and not before (App.tsx): pdf.js is
 * larger than the rest of the window put together.
 */
export default function Pdf({ path }: { path: string }) {
	const scroller = useRef<HTMLDivElement>(null);
	const pages = useRef<HTMLDivElement>(null);
	const [failed, setFailed] = useState<string | null>(null);

	useEffect(() => {
		const container = scroller.current;
		if (!container || !pages.current) return;
		setFailed(null);
		const eventBus = new EventBus();
		const linkService = new PDFLinkService({ eventBus });
		const viewer = new PDFViewer({ container, viewer: pages.current, eventBus, linkService });
		linkService.setViewer(viewer);
		// The column's width is the page's: set once the pages have a size, and
		// again whenever the column is dragged.
		const fit = () => {
			if (viewer.pagesCount) viewer.currentScaleValue = "page-width";
		};
		eventBus.on("pagesinit", fit);
		const resized = new ResizeObserver(fit);
		resized.observe(container);

		const task = pdfjs.getDocument({
			url: vaultUrl(path),
			cMapUrl: `${ASSETS}cmaps/`,
			cMapPacked: true,
			standardFontDataUrl: `${ASSETS}standard_fonts/`,
			wasmUrl: `${ASSETS}wasm/`,
		});
		task.promise.then(
			(doc) => {
				viewer.setDocument(doc);
				linkService.setDocument(doc);
			},
			(err: Error) => {
				// Destroyed on the way out is not a failure to say anything about.
				if (err?.name !== "AbortException" && !task.destroyed) setFailed(err.message);
			},
		);
		return () => {
			resized.disconnect();
			viewer.setDocument(null as never);
			void task.destroy();
		};
	}, [path]);

	return (
		// pdf.js measures from a scroller that is positioned, and wants it to hold
		// exactly one child, the pages; so the column is a box and the scroller
		// fills it.
		<div id="page" data-document={path} className="edge-top relative min-h-0 flex-1 bg-muted/40">
			<div ref={scroller} className="absolute inset-0 overflow-auto">
				<div ref={pages} className="pdfViewer" />
			</div>
			{failed && (
				<p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
					This file could not be shown: {failed}
				</p>
			)}
		</div>
	);
}
