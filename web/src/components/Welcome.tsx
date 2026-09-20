import { useSyncExternalStore } from "react";
import { CheckIcon } from "lucide-react";

import { configStore, filesStore, providersStore } from "../serverState";
import { bridge, shell } from "../update";
import { send } from "../ws";
import { Accounts } from "./Accounts";
import { Button } from "./ui/button";

/**
 * The first run, as one page: three things to do, in order, each ticked
 * as it is done, and nothing else. Opened in front the first time the app
 * runs and from Help › Welcome after; Done closes it for good. The steps
 * are drawn from what the server and the shell already say — the folder,
 * who is signed in, whether the note is there — so a step done elsewhere
 * is ticked here too.
 */
export const WELCOME_NOTE = "Welcome to Octave.md";

const WELCOME_TEXT = `# Welcome to Octave

This is a note in your folder — a markdown file like any other, which you can keep, change or delete. The agent is the column on the right; it reads and writes the same files you do.

Five minutes of things to try:

- [ ] **Ask the agent about this note.** Type *what is this note about?* in the box on the right and send it.
- [ ] **Have it change something.** Select the sentence below and ask: *make this shorter*. What it writes stays a suggestion — press **Keep** to take it or **Undo** to put the old words back. Leave it undecided for as long as you like.
- [ ] **See who wrote what.** Point at the agent's share in the strip at the foot of the window and turn on **Who wrote what**: your words and the agent's are told apart, and stay told apart.
- [ ] **Link to another note.** Type \`[[\` and pick one; ⌘+click a link to follow it.
- [ ] **Change what the agent may do.** The tool menu under the message box starts on Execution — changing files and running commands, though not reaching the web. Plan is one click below for reading only, and Web access is a switch beside them; both stay where you put them.

The sentence for the second one: this paragraph, written in more words than it needs to say what it says, is here for the agent to shorten when you ask it to, and for you to decide about afterwards.

Everything the agent does to this folder is written down beside it, in \`.pi/\`, and nothing leaves your Mac but what you send the provider you signed in to. Help › Getting Started has the rest.
`;

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
	return (
		<section className="flex gap-4" data-step={n} data-done={done}>
			<div className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
				{done ? <CheckIcon className="size-3.5" /> : n}
			</div>
			<div className="min-w-0 flex-1">
				<h2 className="mb-1 text-base font-semibold">{title}</h2>
				<div className="text-sm text-muted-foreground">{children}</div>
			</div>
		</section>
	);
}

export function Welcome({ onDone }: { onDone: () => void }) {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const providers = useSyncExternalStore(providersStore.subscribe, providersStore.get);
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	const folder = config?.folder ?? null;
	const signedIn = providers?.some((p) => p.signedIn) ?? false;
	const noteThere = files.some((f) => f.path === WELCOME_NOTE);
	const pi = shell();

	return (
		<div id="page" className="no-scrollbar edge-top flex min-h-0 flex-1 flex-col overflow-y-auto">
			<article className="mx-auto w-full max-w-2xl px-8 py-10">
				<h1 className="mb-2 text-2xl font-semibold tracking-tight">Welcome</h1>
				<p className="mb-8 text-sm text-muted-foreground">
					Octave is a folder of notes with an agent at the table. Three things, and you are writing.
				</p>
				<div className="flex flex-col gap-8">
					<Step n={1} done={folder !== null} title="Your folder">
						<p>
							The agent reads and writes inside this folder and nowhere else — so a folder of notes, not your whole home folder. An Obsidian vault is fine; nothing in it is changed by opening it.
						</p>
						{folder && (
							<p className="mt-2 flex items-center gap-3">
								<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{folder}</code>
								{pi?.choose && (
									<Button variant="outline" size="sm" onClick={() => void pi.choose?.()}>
										Change…
									</Button>
								)}
							</p>
						)}
					</Step>
					<Step n={2} done={signedIn} title="Sign in">
						<p className="mb-3">
							To the provider whose models the agent will use — a ChatGPT or Claude subscription, or an API key. You are signing in to them, not to us: Octave has no account.
						</p>
						<div className="rounded-lg border border-border p-4 text-foreground">
							<Accounts />
						</div>
					</Step>
					<Step n={3} done={noteThere} title="Try it">
						<p className="mb-3">A note with five minutes of things to try, written into your folder.</p>
						{noteThere ? (
							<p>
								It is in the list on the left: <span className="text-foreground">Welcome to Octave</span>.
							</p>
						) : (
							<Button variant="outline" size="sm" disabled={!config} onClick={() => send({ type: "new_note", name: WELCOME_NOTE.replace(/\.md$/, ""), text: WELCOME_TEXT })}>
								Make the welcome note
							</Button>
						)}
					</Step>
				</div>
				<div className="mt-10 flex items-center gap-3">
					<Button onClick={() => { void bridge()?.welcomed?.(); onDone(); }}>Done</Button>
					<span className="text-xs text-muted-foreground">Help › Welcome opens this again.</span>
				</div>
			</article>
		</div>
	);
}
