import { useEffect, useState, useSyncExternalStore } from "react";

import { ExternalLinkIcon, KeyRoundIcon, UserRoundIcon } from "lucide-react";

import { bridge as githubBridge, githubStore, refresh as refreshGitHub, type Code, type GitHubBridge, type GitHubStanding } from "../github";
import { loginStore, providersStore, type LoginState } from "../serverState";
import type { LoginEvent, LoginPrompt, ProviderInfo } from "../types";
import { send } from "../ws";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

/**
 * Who pi can run a model from, and signing in to them.
 *
 * pi's /login, drawn here: the list is what the server sends as `providers`,
 * and a sign-in is a conversation with pi carried over the socket (login.ts) —
 * pi asks for what it needs, this shows the question, the person answers.
 * Nothing about any provider's login is known here, which is how a provider
 * pi adds tomorrow is signed in to without a change.
 *
 * Three groups, because the forty rows are three kinds of thing. What is
 * signed in comes first, since it is what the person came to check. Then the
 * providers that take an account, which are few and the way most people
 * start. Then the ones that take only a key — the long tail, behind a line
 * after the first few, since forty is a list to search, not read.
 *
 * Then GitHub, which is not a provider but is an account, and the other
 * thing the agent signs in to: where the code is. It is the shell's — gh's,
 * so the terminal is signed in too — and so is there only in the app.
 */
const FEATURED = ["openai"];

export function Accounts() {
	const providers = useSyncExternalStore(providersStore.subscribe, providersStore.get);
	const login = useSyncExternalStore(loginStore.subscribe, loginStore.get);
	const [all, setAll] = useState(false);

	if (!providers) return <p className="text-xs text-muted-foreground">Reading the providers…</p>;

	const busy = login !== null && login.done === null;
	const signedIn = providers.filter((p) => p.signedIn);
	const out = providers.filter((p) => !p.signedIn);
	const accounts = out.filter((p) => p.methods.includes("oauth"));
	const keyed = out.filter((p) => !p.methods.includes("oauth"));
	// Folded: the featured ones, and enough of the rest that the group does
	// not read as a heading over a button.
	const keyedShown = all ? keyed : [...keyed.filter((p) => FEATURED.includes(p.id)), ...keyed.filter((p) => !FEATURED.includes(p.id))].slice(0, Math.max(FEATURED.length, 3));
	const hidden = keyed.length - keyedShown.length;

	return (
		<>
			<header className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold">Accounts</h2>
				<p className="text-xs text-muted-foreground">
					Who pi runs its models from. Kept by pi, in <code className="text-[11px]">~/.pi/agent</code>, so the terminal pi is
					signed in too.
				</p>
			</header>

			<Group title="Signed in" empty="Nobody yet — pick a provider below.">
				{signedIn.map((p) => (
					<Row key={p.id} provider={p} busy={busy} />
				))}
			</Group>

			{accounts.length > 0 && (
				<Group title="Sign in with an account">
					{accounts.map((p) => (
						<Row key={p.id} provider={p} busy={busy} />
					))}
				</Group>
			)}

			{keyed.length > 0 && (
				<Group title="With an API key">
					{keyedShown.map((p) => (
						<Row key={p.id} provider={p} busy={busy} />
					))}
					{!all && hidden > 0 && (
						<li>
							<Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setAll(true)}>
								{hidden} more providers…
							</Button>
						</li>
					)}
				</Group>
			)}

			{githubBridge && <GitHub bridge={githubBridge} />}

			{login && <SignIn login={login} name={providers.find((p) => p.id === login.provider)?.name ?? login.provider} />}
		</>
	);
}

/**
 * The GitHub row, and the sign-in behind it. Where the person stands is the
 * store's (github.ts), asked again after anything done here. A sign-in is
 * gh's: the shell runs it and says the one-time code as gh gets it, shown
 * here the way a provider's is (Event), and it ends when GitHub says yes or
 * the person gives up.
 */
function GitHub({ bridge }: { bridge: GitHubBridge }) {
	const standing: GitHubStanding | null = useSyncExternalStore(githubStore.subscribe, githubStore.get);
	const [signing, setSigning] = useState<{ code: Code | null; error: string | null } | null>(null);
	const [busy, setBusy] = useState(false);

	const signIn = async () => {
		setBusy(true);
		setSigning({ code: null, error: null });
		const stop = bridge.onCode((code) => setSigning((was) => ({ code, error: was?.error ?? null })));
		const out = await bridge.signIn();
		stop();
		await refreshGitHub();
		setSigning(out.error ? { code: null, error: out.error } : null);
		setBusy(false);
	};
	const signOut = async () => {
		setBusy(true);
		await bridge.signOut();
		await refreshGitHub();
		setBusy(false);
	};
	const b = "h-7 text-xs";

	let status: React.ReactNode = null;
	let actions: React.ReactNode = null;
	if (standing?.state === "signed-in") {
		status = (
			<Badge variant="secondary" className="gap-1 text-[11px]">
				<UserRoundIcon className="size-3" /> {standing.login}
			</Badge>
		);
		actions = (
			<Button type="button" variant="outline" size="sm" className={b} disabled={busy} onClick={signOut}>
				Sign out
			</Button>
		);
	} else if (standing?.state === "signed-out") {
		actions = (
			<Button type="button" variant="outline" size="sm" className={`${b} gap-1.5`} disabled={busy} onClick={signIn}>
				<UserRoundIcon className="size-3" /> Sign in with GitHub
			</Button>
		);
	} else if (standing?.state === "missing") {
		status = <span className="text-xs text-muted-foreground">GitHub CLI isn't installed</span>;
		actions = (
			<a href="https://cli.github.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
				Get gh <ExternalLinkIcon className="size-3" />
			</a>
		);
	}

	return (
		<Group title="Where the code is">
			<li className={`flex min-h-10 items-center gap-3 rounded-md border px-3 py-1.5 ${standing?.state === "signed-in" ? "border-transparent bg-muted" : ""}`} title="Kept by gh, so the terminal is signed in too.">
				<span className="min-w-0 flex-1 truncate text-sm">GitHub</span>
				{status}
				<span className="flex shrink-0 gap-1">{actions}</span>
			</li>
			{signing && (
				<Dialog open onOpenChange={(open) => !open && (busy ? void bridge.cancel() : setSigning(null))}>
					<DialogContent className="max-w-md" showCloseButton={false}>
						<DialogHeader>
							<DialogTitle className="text-sm">GitHub</DialogTitle>
							<DialogDescription className="sr-only">Signing in to GitHub.</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3 text-xs">
							{signing.code && <Event event={{ type: "device_code", ...signing.code }} />}
							{signing.code && !signing.error && <p className="text-muted-foreground">Then come back here: this closes by itself once GitHub says yes.</p>}
							{signing.error && (
								<p role="alert" className="text-destructive">
									{signing.error}
								</p>
							)}
							{!signing.code && !signing.error && (
								<p className="flex items-center gap-2 text-muted-foreground">
									<Spinner className="size-3" /> Asking GitHub for a code…
								</p>
							)}
						</div>
						<DialogFooter>
							<Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => (busy ? void bridge.cancel() : setSigning(null))}>
								{busy ? "Cancel" : "Close"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</Group>
	);
}

/** A run of rows under a small heading; `empty` is what stands in for none. */
function Group({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
	const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
	return (
		<section className="flex flex-col gap-1">
			<h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
			{rows.length ? <ul className="flex flex-col gap-1">{children}</ul> : empty && <p className="px-3 py-2 text-xs text-muted-foreground">{empty}</p>}
		</section>
	);
}

/**
 * One provider. Two things can stand behind it, and they are drawn as two
 * things: an account — signed in to, and out of — and a key, which is a
 * string the person has and can be replaced or removed. A key pi found in the
 * environment is shown by the variable it came from, and nothing here can be
 * done to it. Signed out, the ways in are named for what they are.
 */
function Row({ provider, busy }: { provider: ProviderInfo; busy: boolean }) {
	const { id, name, methods, signedIn } = provider;
	const stored = signedIn?.source === "stored";
	const login = (method: "oauth" | "api_key") => send({ type: "login", provider: id, method });
	const logout = () => send({ type: "logout", provider: id });
	const b = "h-7 text-xs";

	let status: React.ReactNode;
	let actions: React.ReactNode;
	if (signedIn?.method === "oauth") {
		status = (
			<Badge variant="secondary" className="gap-1 text-[11px]">
				<UserRoundIcon className="size-3" /> Account
			</Badge>
		);
		actions = (
			<Button type="button" variant="outline" size="sm" className={b} disabled={busy} onClick={logout}>
				Sign out
			</Button>
		);
	} else if (signedIn && stored) {
		status = <Key tail={signedIn.keyTail} />;
		actions = (
			<>
				<Button type="button" variant="outline" size="sm" className={b} disabled={busy} onClick={() => login("api_key")}>
					Replace
				</Button>
				<Button type="button" variant="ghost" size="sm" className={`${b} text-muted-foreground`} disabled={busy} onClick={logout}>
					Remove
				</Button>
			</>
		);
	} else if (signedIn) {
		status = (
			<Badge variant="outline" className="gap-1 font-mono text-[11px] text-muted-foreground" title="Set outside the app; the agent reads it from the environment.">
				<KeyRoundIcon className="size-3" /> {signedIn.source}
			</Badge>
		);
		actions = null;
	} else {
		status = null;
		actions = (
			<>
				{methods.includes("oauth") && (
					<Button type="button" variant="outline" size="sm" className={`${b} gap-1.5`} disabled={busy} onClick={() => login("oauth")}>
						<UserRoundIcon className="size-3" /> Sign in with account
					</Button>
				)}
				{methods.includes("api_key") && (
					<Button type="button" variant={methods.includes("oauth") ? "ghost" : "outline"} size="sm" className={`${b} gap-1.5`} disabled={busy} onClick={() => login("api_key")}>
						<KeyRoundIcon className="size-3" /> Add API key
					</Button>
				)}
			</>
		);
	}

	return (
		<li className={`flex min-h-10 items-center gap-3 rounded-md border px-3 py-1.5 ${signedIn ? "border-transparent bg-muted" : ""}`}>
			<span className="min-w-0 flex-1 truncate text-sm">{name}</span>
			{status}
			<span className="flex shrink-0 gap-1">{actions}</span>
		</li>
	);
}

/** A key as it is shown: a key icon and its tail, in the monospace a key is read in. */
function Key({ tail }: { tail?: string }) {
	return (
		<Badge variant="secondary" className="gap-1 font-mono text-[11px]">
			<KeyRoundIcon className="size-3" /> {tail ? `…${tail}` : "API key"}
		</Badge>
	);
}

/**
 * The sign-in under way, as a dialog over the list. What pi has said so far
 * above, its question below; closing it before the end is giving up, which pi
 * hears as its signal.
 */
function SignIn({ login, name }: { login: LoginState; name: string }) {
	const { prompt, events, done } = login;

	// Ended well: the row now says so, and there is nothing to read here.
	useEffect(() => {
		if (done?.ok) loginStore.set(null);
	}, [done]);

	const close = () => {
		if (done) loginStore.set(null);
		else send({ type: "login_answer", cancelled: true });
	};

	return (
		<Dialog open onOpenChange={(open) => !open && close()}>
			<DialogContent className="max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle className="text-sm">{name}</DialogTitle>
					<DialogDescription className="sr-only">Signing in to {name}.</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 text-xs">
					{events.map((event, i) => (
						<Event key={i} event={event} />
					))}
					{done && !done.ok && done.error && (
						<p role="alert" className="text-destructive">
							{done.error}
						</p>
					)}
					{prompt && <Ask prompt={prompt} />}
					{!prompt && !done && (
						<p className="flex items-center gap-2 text-muted-foreground">
							<Spinner className="size-3" /> Waiting for the agent…
						</p>
					)}
				</div>

				<DialogFooter>
					<Button type="button" variant="ghost" size="sm" className="text-xs" onClick={close}>
						{done ? "Close" : "Cancel"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Something pi said on the way. A URL is a link as well as having been opened, for a run without a shell to open it. */
function Event({ event }: { event: LoginEvent }) {
	switch (event.type) {
		case "auth_url":
			return (
				<p className="flex flex-col gap-1">
					<span>{event.instructions ?? "Sign in in your browser, then come back here."}</span>
					<a href={event.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
						Open the sign-in page <ExternalLinkIcon className="size-3" />
					</a>
				</p>
			);
		case "device_code":
			return (
				<p className="flex flex-col gap-1">
					<span>
						Enter this code at{" "}
						<a href={event.verificationUri} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
							{event.verificationUri}
						</a>
					</span>
					<code className="self-start rounded bg-muted px-2 py-1 text-sm tracking-widest">{event.userCode}</code>
				</p>
			);
		case "info":
			return (
				<p className="flex flex-col gap-1 text-muted-foreground">
					<span>{event.message}</span>
					{event.links?.map((link) => (
						<a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
							{link.label ?? link.url}
						</a>
					))}
				</p>
			);
		case "progress":
			return <p className="text-muted-foreground">{event.message}</p>;
	}
}

/** pi's question, and the answer going back by the question's id. */
function Ask({ prompt }: { prompt: LoginPrompt }) {
	const [value, setValue] = useState("");
	const answer = (v: string) => send({ type: "login_answer", id: prompt.id, value: v });

	if (prompt.type === "select") {
		return (
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs">{prompt.message}</Label>
				{prompt.options.map((o) => (
					<Button key={o.id} type="button" variant="outline" size="sm" className="h-auto flex-col items-start gap-0 py-1.5 text-xs" onClick={() => answer(o.id)}>
						<span>{o.label}</span>
						{o.description && <span className="font-normal text-muted-foreground">{o.description}</span>}
					</Button>
				))}
			</div>
		);
	}

	// A key is typed unseen; a code pasted back from a browser is not a secret.
	const secret = prompt.type === "secret";
	return (
		<form
			className="flex flex-col gap-1.5"
			onSubmit={(e) => {
				e.preventDefault();
				if (value.trim()) answer(value.trim());
			}}
		>
			<Label htmlFor="login-answer" className="text-xs">
				{prompt.message}
			</Label>
			<div className="flex gap-1.5">
				<Input
					id="login-answer"
					type={secret ? "password" : "text"}
					autoFocus
					autoComplete="off"
					spellCheck={false}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={prompt.placeholder}
					className="h-8 text-xs"
				/>
				<Button type="submit" size="sm" className="h-8 text-xs" disabled={!value.trim()}>
					Continue
				</Button>
			</div>
		</form>
	);
}
