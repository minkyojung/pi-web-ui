import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Follows the same env var server.ts reads, so the two stay on one port. */
const apiPort = process.env.PORT ?? "3000";
const apiHost = process.env.HOST ?? "127.0.0.1";

export default defineConfig({
	// The client lives in web/ rather than at the repo root so its index.html
	// does not collide with the old one while both are still around.
	root: dir("./web"),
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": dir("./web/src") } },
	server: {
		port: 5173,
		// conversation.js sits at the repo root, outside `root`, and the dev
		// server refuses to read outside it without this.
		fs: { allow: [dir(".")] },
		// The API server owns the pi session and the reading library; the socket
		// and the library's /api routes go to it.
		proxy: {
			"/ws": { target: `ws://${apiHost}:${apiPort}`, ws: true },
			"/api": { target: `http://${apiHost}:${apiPort}` },
		},
	},
	build: { outDir: dir("./dist"), emptyOutDir: true },
});
