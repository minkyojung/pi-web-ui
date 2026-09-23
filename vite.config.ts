import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Follows the same env var server.ts reads, so the two stay on one port. */
const apiPort = process.env.PORT ?? "3000";
const apiHost = process.env.HOST ?? "127.0.0.1";

/**
 * What pdf.js fetches beside itself while it reads a file: the character maps
 * a PDF in Korean, Japanese or Chinese names its text by, the fourteen fonts
 * a PDF may use without carrying, and the decoders for the image kinds the
 * browser has none for. They are plain files it asks for by name under one
 * address, so they cannot be imports; they are given out from the package
 * while developing and copied beside the build when building — under /pdfjs/,
 * which is where Pdf.tsx says they are. Without them most PDFs still open,
 * and one written in Hangul with its fonts left out opens as empty boxes.
 */
const PDFJS = dir("./node_modules/pdfjs-dist");
const PDFJS_ASSETS = ["cmaps", "standard_fonts", "wasm"];
const pdfjsAssets = (): Plugin => ({
	name: "pdfjs-assets",
	configureServer(server) {
		server.middlewares.use("/pdfjs", (req, res, next) => {
			const name = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
			if (!PDFJS_ASSETS.some((d) => name.startsWith(`${d}/`)) || name.includes("..")) return next();
			readFile(join(PDFJS, name)).then(
				(body) => res.setHeader("content-type", name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream").end(body),
				() => next(),
			);
		});
	},
	async closeBundle() {
		for (const d of PDFJS_ASSETS) await cp(join(PDFJS, d), join(dir("./dist/pdfjs"), d), { recursive: true });
	},
});

export default defineConfig({
	// The client lives in web/ rather than at the repo root so its index.html
	// does not collide with the old one while both are still around.
	root: dir("./web"),
	plugins: [react(), tailwindcss(), pdfjsAssets()],
	resolve: { alias: { "@": dir("./web/src") } },
	server: {
		port: 5173,
		// conversation.js sits at the repo root, outside `root`, and the dev
		// server refuses to read outside it without this.
		fs: { allow: [dir(".")] },
		// The API server owns the pi session and the settings; the socket and
		// the /api routes go to it.
		proxy: {
			"/ws": { target: `ws://${apiHost}:${apiPort}`, ws: true },
			// A terminal's bytes, the same way (pty/terminal.ts).
			"/pty": { target: `ws://${apiHost}:${apiPort}`, ws: true },
			"/api": { target: `http://${apiHost}:${apiPort}` },
			// The pictures in the folder, served by the API server (pictures.ts).
			"/vault": { target: `http://${apiHost}:${apiPort}` },
		},
	},
	build: {
		outDir: dir("./dist"),
		emptyOutDir: true,
		// Two pages: the app, served by a workspace's server, and the screen
		// the app opens on before there is any workspace — served by the shell
		// itself (electron/appScheme.js).
		rollupOptions: { input: { main: dir("./web/index.html"), start: dir("./web/start.html") } },
	},
});
