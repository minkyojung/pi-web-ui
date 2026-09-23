import { Fragment, useSyncExternalStore } from "react";

import { KeyRoundIcon } from "lucide-react";

import { providersStore } from "../serverState";
import { openSettings } from "../settingsOpen";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Kbd } from "./ui/kbd";

/**
 * The middle column with nothing open — the first thing a new workspace shows,
 * and what is left when the last tab is closed.
 *
 * Two states, and the first is not a lesson: nobody signed in anywhere means
 * nothing that follows can happen, so the column is the one thing to do, in
 * the same shadcn Empty the screen that adds a repository uses (Start.tsx).
 * Signing in is pi's — its providers, its prompts — so this opens Settings on
 * Accounts rather than asking anything itself, by the way the model picker
 * already offers it.
 *
 * Signed in, it is the commands. VS Code and Cursor put a list of them where
 * the editor is empty, and it is the one empty state nobody has to be taught,
 * because it does not say the column is empty: it says what there is to do.
 * The three are the whole of spec mode, in the order they happen. None of them
 * is a key, so the row carries the command itself where the key would be, and
 * a line underneath says where it is typed.
 *
 * It is left behind by the first line: the agent writes `requirements.md`,
 * that opens in front, and the column is the document's from then on.
 */
const ROWS = [
	["Describe what to build", "/spec"],
	["Approve a document", "/spec-approve"],
	["Run the next task", "/spec-run"],
] as const;

export function Watermark() {
	const providers = useSyncExternalStore(providersStore.subscribe, providersStore.get);
	// Until the server has said who is signed in, neither: a sign-in asked for
	// and taken back a moment later reads as a fault.
	if (!providers) return <div className="flex-1" />;
	if (!providers.some((provider) => provider.signedIn)) return <SignIn />;
	return (
		<div id="watermark" className="flex flex-1 select-none items-center justify-center">
			<div className="grid grid-cols-[1fr_auto] items-center gap-x-10 gap-y-3">
				{ROWS.map(([what, command]) => (
					<Fragment key={command}>
						<span className="text-sm text-muted-foreground">{what}</span>
						<Kbd className="justify-self-end">{command}</Kbd>
					</Fragment>
				))}
				<p className="col-span-2 mt-2 text-xs text-muted-foreground">Typed in the message box.</p>
			</div>
		</div>
	);
}

function SignIn() {
	return (
		<Empty id="sign-in" className="flex-1">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<KeyRoundIcon />
				</EmptyMedia>
				<EmptyTitle>Sign in to a provider</EmptyTitle>
				<EmptyDescription>
					The agent runs on models from an account of your own — a ChatGPT or Claude subscription, or an API key. You are signing in to them, not to us: Octave has no account.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button id="sign-in-open" onClick={() => openSettings("Accounts")}>
					Sign in
				</Button>
			</EmptyContent>
		</Empty>
	);
}
