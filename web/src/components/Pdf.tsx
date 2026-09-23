import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { choose, chosenStore } from "../chosen";
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
export default function Pdf({ path, page = null }: { path: string; page?: number | null }) {
	const scroller = useRef<HTMLDivElement>(null);
	const pages = useRef<HTMLDivElement>(null);
	const [failed, setFailed] = useState<string | null>(null);
	// The page a link asked for — `[[paper.pdf#page=3]]`. Read when the pages
	// are first laid out, and again whenever another link names another page
	// of the document already open.
	const viewerRef = useRef<PDFViewer | null>(null);
	const asked = useRef(page);
	asked.current = page;
	useEffect(() => {
		const viewer = viewerRef.current;
		if (page && viewer?.pagesCount) viewer.currentPageNumber = Math.min(page, viewer.pagesCount);
	}, [page]);

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
		// Not once the column is off the page: the tab closing takes the scroller
		// out before this effect is undone, the observer reports that as a change
		// of size, and pdf.js, asked to fit to nothing, complains to the console.
		const fit = () => {
			if (viewer.pagesCount && container.offsetParent) viewer.currentScaleValue = "page-width";
		};
		viewerRef.current = viewer;
		eventBus.on("pagesinit", () => {
			fit();
			if (asked.current) viewer.currentPageNumber = Math.min(asked.current, viewer.pagesCount);
		});
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
		// What is chosen on the pages, for the box under pi's column to point
		// with — the editor's own report (Editor.tsx), made from the browser's
		// selection, which is what choosing in pdf.js's text layer is. Two things
		// are not the editor's. The page rides along, read off the pages the
		// selection starts and ends in. And an empty selection is only news when
		// it was emptied here, by a click on the pages: clicking into the message
		// box to ask empties it too, and that must not take the words away.
		const pageAt = (node: Node | null) => Number((node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(".page")?.dataset.pageNumber);
		const chosen = () => {
			const selection = document.getSelection();
			if (!selection || !selection.anchorNode || !container.contains(selection.anchorNode)) return;
			if (selection.isCollapsed) return choose(path, "");
			const [from, to] = [pageAt(selection.anchorNode), pageAt(selection.focusNode)].sort((a, b) => a - b);
			choose(path, selection.toString(), from ? (to && to !== from ? `${from}-${to}` : String(from)) : undefined);
		};
		document.addEventListener("selectionchange", chosen);

		return () => {
			document.removeEventListener("selectionchange", chosen);
			// Nothing is chosen in a PDF that is not open.
			if (chosenStore.get()?.path === path) chosenStore.set(null);
			viewerRef.current = null;
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
				<p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-subtle-foreground">
					This file could not be shown: {failed}
				</p>
			)}
		</div>
	);
}
