/**
 * The person's GitHub account, as the shell knows it — gh's, so the terminal
 * is signed in too. Only in the app: a page in a browser has no shell, and
 * `bridge` is null there.
 *
 * Where they stand is asked once, and again whenever the window comes back —
 * they may have signed in in a terminal meanwhile — and held here for the
 * two places that show it: Settings › Accounts, where it is signed in and
 * out of, and the foot of the window, which says when there is none to push
 * with. Signing in and out go through the shell (electron/preload.cjs).
 */
import { createStore } from "./serverState";

export type GitHubStanding = { state: "missing" } | { state: "signed-out" } | { state: "signed-in"; login: string };
export type Code = { userCode: string; verificationUri: string };
export type Outcome = { ok?: true; error?: string; cancelled?: true };
export type GitHubBridge = {
	standing(): Promise<GitHubStanding>;
	signIn(): Promise<Outcome>;
	cancel(): Promise<void>;
	signOut(): Promise<Outcome>;
	onCode(listen: (code: Code) => void): () => void;
};

export const bridge: GitHubBridge | null = (window as unknown as { pi?: { github?: GitHubBridge } }).pi?.github ?? null;

/** Where the person stands, or null until the shell has said. */
export const githubStore = createStore<GitHubStanding | null>(null, { window: true });

/** Ask the shell again, and keep what it says. */
export async function refresh(): Promise<GitHubStanding | null> {
	if (!bridge) return null;
	const standing = await bridge.standing();
	githubStore.set(standing);
	return standing;
}

if (bridge) {
	void refresh();
	window.addEventListener("focus", () => void refresh());
}
