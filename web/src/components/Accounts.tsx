import { useEffect, useState, useSyncExternalStore } from "react";

import { ExternalLinkIcon } from "lucide-react";

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
 * Two providers first and the rest behind a line, since two is what most people
 * have and forty is a list to search, not read.
 */
const FEATURED = ["anthropic", "openai"];

export function Accounts() {
	const providers = useSyncExternalStore(providersStore.subscribe, providersStore.get);
	const login = useSyncExternalStore(loginStore.subscribe, loginStore.get);
	const [all, setAll] = useState(false);

	if (!providers) return <p className="text-xs text-muted-foreground">Reading the providers…</p>;

	const featured = FEATURED.flatMap((id) => providers.filter((p) => p.id === id));
	const rest = providers.filter((p) => !FEATURED.includes(p.id));
	// One signed in elsewhere in the list is worth seeing without opening it.
	const shown = all ? [...featured, ...rest] : [...featured, ...rest.filter((p) => p.signedIn)];
	const hidden = rest.length - rest.filter((p) => p.signedIn).length;

	return (
		<>
			<header className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold">Accounts</h2>
				<p className="text-xs text-muted-foreground">
					Who pi runs its models from. Kept by pi, in <code className="text-[11px]">~/.pi/agent</code>, so the terminal pi is
					signed in too.
				</p>
			</header>

			<ul className="flex flex-col gap-1">
				{shown.map((p) => (
					<Row key={p.id} provider={p} busy={login !== null && login.done === null} />
				))}
			</ul>

			{!all && hidden > 0 && (
				<Button type="button" variant="ghost" size="sm" className="self-start text-xs text-muted-foreground" onClick={() => setAll(true)}>
					{hidden} more providers…
				</Button>
			)}

			{login && <SignIn login={login} name={providers.find((p) => p.id === login.provider)?.name ?? login.provider} />}
		</>
	);
}

function Row({ provider, busy }: { provider: ProviderInfo; busy: boolean }) {
	const { id, name, methods, signedIn } = provider;
	// pi keeps what it was given here; a key it found in the environment is
	// not its to forget, and Sign out would only seem to.
	const stored = signedIn?.source === "stored";
	return (
		<li className="flex min-h-9 items-center gap-3 rounded-md border px-3 py-1.5">
			<span className="min-w-0 flex-1 truncate text-sm">{name}</span>
			{signedIn ? (
				<Badge variant="secondary" className="text-[11px]">
					{signedIn.method === "oauth" ? "Signed in" : stored ? "API key" : `Key from ${signedIn.source}`}
				</Badge>
			) : (
				<Badge variant="outline" className="text-[11px] text-muted-foreground">
					Not signed in
				</Badge>
			)}
			<span className="flex shrink-0 gap-1">
				{stored ? (
					<Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => send({ type: "logout", provider: id })}>
						Sign out
					</Button>
				) : (
					<>
						{methods.includes("oauth") && (
							<Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => send({ type: "login", provider: id, method: "oauth" })}>
								Sign in
							</Button>
						)}
						{methods.includes("api_key") && (
							<Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => send({ type: "login", provider: id, method: "api_key" })}>
								Use API key
							</Button>
						)}
					</>
				)}
			</span>
		</li>
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
							<Spinner className="size-3" /> Waiting for pi…
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
