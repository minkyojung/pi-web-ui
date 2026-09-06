# pi-web-ui

A minimal web UI over the pi coding agent.

## Run

```bash
npm install
npm run dev            # api on :3000, vite with HMR on :5173 — open :5173
MODEL=anthropic/claude-opus-4-8 npm run dev
```

The client is a Vite build, so `npm run dev` runs two processes: the API server,
which owns the pi session, and the Vite dev server, which proxies `/ws` to it.
For the single-port shape the app actually ships as:

```bash
npm run build && npm run dev:server   # http://localhost:3000
```

As a desktop app:

```bash
npm run app       # build and open it
npm run app:dev   # open the window on the running dev server instead — live edits
npm run pack      # release/mac-arm64/pi.app
```

`app:dev` expects `npm run dev` to be running and points the window at
`http://localhost:5173`: it spawns no server and asks for no folder, so client
edits arrive through vite's HMR and server edits through tsx's watch, after
which the window reconnects on its own.

The app is a window over the same server, started as a child process on a port
it picks. It asks which folder the agent should work in on first run and
remembers it — a packaged app is launched with a working directory of `/`,
which is not somewhere to point a coding agent. `⌘O` changes it, which
relaunches.

The build is **not signed**; that needs an Apple Developer identity. It runs,
but a first open has to be right-click → Open. `productName` and `appId` are
provisional, and `appId` decides where macOS keeps the app's settings, so
changing it later starts a user from scratch.

Auth comes from `~/.pi/agent/auth.json` (`pi` → `/login`). Sessions are written
to `~/.pi/agent/sessions/` and survive a restart. With no usable credentials at
all the server says so and exits rather than failing on the first prompt.

```bash
npm test          # replays recorded pi sessions, offline
npm run typecheck
```

## Status: step 7 — Tailwind, shadcn, AI Elements

The browser shows the conversation: user messages, assistant text rendered as
markdown as it streams, tool calls as collapsible cards that fill in with their
partial output while they run, errors,
notices for the work pi does without being asked (auto retries, compaction), and
a completion marker. Everything else is dropped. The raw view — ⌘⇧D — still
shows every event, which is the only way to debug when the rendered view is
wrong.
Events go out in the same shape pi's own print and rpc modes use: a
`message_update` carries its delta, not the two full copies of the in-flight
message it also ships as `message` and `assistantMessageEvent.partial`.

`conversation.js` holds the rules for turning a pi session into conversation
items, and both the browser and the server import it. It used to exist twice —
`apply()` in the client for live events, `snapshot()` in the server for resumed
ones — and the two had drifted in four ways: an unusual tool result rendered as
JSON live and as blank on resume; the server emitted the raw `400 {json}`
envelope and relied on the client to unwrap it; empty user messages were kept
by one path and skipped by the other; and a reply that called a tool before
speaking came out in opposite orders. None showed on the happy path, which is
what made them worth removing rather than fixing twice.

`applyEvent` returns the items it added and changed so a renderer can stay
incremental without diffing; a caller that re-renders wholesale can ignore it
and read `state.items`.

Rendering is incremental, which the reducer makes possible and the suite pins:
`applyEvent` touches at most one item per event. `conversation.js` updates items
in place, which React cannot see, so the client copies the items the reducer
reports as touched into a fresh array — every other item keeps its identity and
its memoized component skips the render. Updates are coalesced into one
animation frame, which a browser does not run in a hidden tab, so a background
tab catches up when it is focused. The raw view keeps the last 300 events, and
keeps them whether or not it is open — you turn it on after seeing something
odd, so the history has to already be there — but serialises them only where
they are read, rather than on every delta of every run.

The design comes from the hand-written DOM client that preceded it, where
rebuilding everything per event cost 63ms for the first turn and 534ms by the
twelfth, and going incremental made it flat at ~42ms. Markdown made this worth
rechecking, since the open message is now re-parsed rather than appended to: a
5,500-character answer with four highlighted code blocks streamed in over 17.5s
for 698ms of script time and no task over 50ms.

The socket reconnects with a capped, jittered backoff. Recovery is entirely
server-driven — it pushes `config`, `usage`, `snapshot` and `sessions` on
connect — which is also the limit: a snapshot is rebuilt from stored messages,
so `done` markers and live-only notices do not come back, and a tool that was
mid-execution returns with no result and stays that way. Nothing is queued while
the socket is down; a prompt replayed afterwards could land in a session that
was swapped underneath it. The controls disable instead.

`ws.ts` opts out of HMR: it accepts its own update and invalidates, so an edit
that reaches it reloads the page. The module owns a socket, a timer and two
window listeners, and a hot swap that undoes all but one of those leaves a
second instance in the page folding the same events into the same store —
which reads as every delta applied twice, an answer interleaved with itself.
The rule this comes from: a module that takes something at module scope either
gives all of it back in `hot.dispose`, or refuses the swap. Half a teardown is
worse than none, because it looks handled.

The controls sit with the message they apply to, under the composer, since all
three are chosen per message:

- **Model** — any model with usable credentials, grouped by provider. Switching
  is live; `MODEL=` only sets the starting point. Thinking level is clamped to
  the new model, which the config broadcast reflects. Set with `persist`, so
  pi writes it to its own settings and the next session opens on it.
- **Thinking** — only the levels the current model supports. `setThinkingLevel`
  clamps rather than rejects, so the server validates the value first;
  otherwise an unknown level silently becomes `off`. Persisted the same way.
- **Tools** — a mode rather than a row of checkboxes: Plan, Coding, Full access,
  each a strict superset of the one below, with the per-tool list still a
  submenu. Turning a tool off genuinely prevents its use; the model is told what
  it has and calls nothing else. Takes effect on the next turn, not the one in
  flight.

The ladder is in `toolModes.ts` at the repo root, shared like `conversation.js`,
because the server picks the mode a new session opens on and the browser names
the one it is in.

That mode is fixed rather than remembered. pi persists the model and the
thinking level when asked, but not the active tools — `setActiveToolsByName`
takes no `persist` and `defaultTools` has a getter and no setter, so tool
activation is session-scoped there by design. Rather than keep a second
settings store beside pi's, every new session opens on `DEFAULT_MODE`. Resumed
sessions are left as they were.

Stopping a run is the composer's submit button, which becomes a stop button
while streaming.

Sessions are owned by an `AgentSessionRuntime`, since `/new` and `/resume`
replace the `AgentSession` object rather than mutating it. Every read goes
through `runtime.session`, and the event subscription is rebound after each
replacement. A resumed session emits no events for its history, so the server
sends a `snapshot` — the conversation rebuilt from `session.messages` through
`itemsFromMessages`. An unsaved session has no
file yet and would be missing from the picker, so it appears as a placeholder
entry.

Messages sent while a run is in progress are queued as either `steer` or
`followUp`, chosen next to the input. Steering is delivered at the next turn
boundary — after the current turn's tool calls, before the next model call —
so it cuts a tool-using run short but cannot interrupt a single long
generation. Follow-ups wait for the run to finish. Both are listed above the
composer, in delivery order, and refresh from `queue_update`.

`clear_queue` empties the queue and returns what was in it, so the tab that
asked can put the text back in its input box. It is all of them at once because
that is the only queue edit pi has: `clearQueue()` is the whole API, and
removing one message by clearing and re-queueing the rest would run `steer()`
over text it had already expanded once and throw on anything that expanded to
an extension command.

A `usage` message carries `getSessionStats()` and `getContextUsage()`: accrued
cost, token breakdown, and how full the context window is. Sent on connect and
after every completed message, since spend is otherwise invisible.

The server owns this state and broadcasts a `config` message on connect and
after every change, so multiple tabs stay in sync.

### The UI stack

Tailwind 4, shadcn/ui, and Vercel's AI Elements. All three vendor their
components into `web/src/components`, which is the point: the files are ours to
edit, and several are edited.

- **Dark mode is a media query, not a class.** shadcn puts its dark tokens
  behind `.dark` and adds `@custom-variant dark` to match. Leaving that variant
  out means Tailwind's built-in `dark:` *is* `prefers-color-scheme`, so every
  `dark:` utility inside a vendored component follows the system with no JS and
  no flash of the wrong theme. `color-scheme: light dark` does the same for
  native controls.
- **`message.tsx` drops the math and mermaid streamdown plugins.** mermaid is by
  far the largest thing in this dependency graph and katex ships its own
  stylesheet and fonts, for LaTeX and diagrams a coding agent does not produce.
  `cjk` stays — it fixes emphasis parsing next to CJK characters. Re-adding
  either is one import.
- **`tool.tsx` renders a string result as-is rather than as JSON**, which is what
  the registry does, and caps its height: a tool result here is whatever the
  tool printed, and a grep over a large tree runs for pages.
- **The selects are native.** The model list is fifty-odd entries across provider
  groups and the session list is unbounded; picking out of either is done by
  typing the first characters, which a portalled listbox does not do.
  `native-select.tsx` is a `<select>` wearing shadcn's chrome.
- **AI Elements' `PromptInput` is not used.** It brings attachments, a dropzone
  and a model picker that route nowhere here, and its textarea is controlled —
  the input is deliberately uncontrolled so a keystroke does not re-render the
  conversation.
- **`ai` is a devDependency.** Every import of it in the vendored files is
  type-only, so it erases at build.

Two things about the CLIs, since neither is in their docs. shadcn resolves
`@/*` from `paths` alone, which matters because TypeScript 7 removed `baseUrl`
and the Vite guide tells you to add one. And `npx ai-elements add` writes to
`./components/ai-elements` regardless of `components.json`, so its output has to
be moved into `web/src` and its `@/lib/utils` import repointed at the `cn`
package the shadcn components already use.

### Questions from extensions

The dashboard extension installed on this machine replaces pi's dialog methods
with its own PromptBus and sends every `ask_user` question to a dashboard app
nobody here has open, where it waits out a five-minute timeout — and `abort()`
waits with it. The same bridge exposes `prompt:register-adapter`, documented in
its architecture notes and used by its sibling flows plugin, so `prompts.ts`
registers this server as an answerer: each question is broadcast as
`prompt_request`, rendered as a card under the waiting tool, and the first
`prompt_response` from any tab goes back to the bus; every tab then gets
`prompt_dismiss`. Stop, New and switching sessions cancel open questions
first, which is what actually lets the abort through; `abortWithin` remains as
the fallback for anything else that never returns.

This leans on a third-party 0.x package's extension point, not on pi. If the
hook stops answering, the server logs a warning at bind time and questions fall
back to timing out as before.

The same extension also refused to initialise after New or Resume: pi reloads
extensions in-process when it replaces the session, and the bridge keeps its
state on `process` and treats a second load as a subagent, so it registered no
tools (13 became 8) and, because the state it carried held the previous
session's context, threw inside its own `session_start`. Before each session is
built the server retires the previous bridge the way its own initialiser would
— cleanup, connections, timers — and removes that state, so the reload counts
as a first load. Internal, undocumented state again; if the key moves this is a
no-op and the bind-time warning fires. The dashboard server still autostarts
unless `~/.pi/dashboard/config.json` sets `"autoStart": false`.

### Events observed

A turn with a tool call produces, in order:

```
agent_start → turn_start
  message_start / message_end                    (user message)
  message_start
    message_update.thinking_start / thinking_end
    message_update.text_start / text_delta / text_end
    message_update.toolcall_start / toolcall_delta / toolcall_end
  message_end
  tool_execution_start / tool_execution_update / tool_execution_end
turn_end → agent_end → agent_settled
```

Notes:

- Assistant text lives at `event.assistantMessageEvent.delta`, not `event.delta`.
- `agent_settled` is the completion signal. `agent_end` carries `willRetry` and
  may be followed by more work.
- Provider failures (billing, rate limits) do **not** throw from `prompt()`.
  They arrive as a message with `stopReason: "error"` and an `errorMessage`,
  so a UI that ignores them looks silently stuck.

## Tests

`npm test` (Node's built-in runner, no dependencies) replays two recordings of
real pi sessions from `test/fixtures/`: a turn with two tool calls, and a
provider billing failure. Recordings are committed verbatim rather than
trimmed, so the tests can only pass on shapes pi actually emits.

The load-bearing test is the equivalence one: `agent_end` carries the run's
messages, so a single recording holds both inputs to the live/resumed contract,
and asserting the two produce the same items is what keeps them from drifting
again.

`npm run record <out.json> "<prompt>"` refreshes a fixture against a live
session. It spends real tokens, so it is manual and never part of `npm test`.
Re-record only when a pi upgrade actually breaks a test — a stale fixture that
still passes is evidence the contract held.

The rendering layer is deliberately untested. Every rule about what a session
means lives in `conversation.js` and is covered here; the renderer's one
contract with it — an event touches at most one item — is asserted by the same
suite. What is left is JSX, and it was checked the one way that is worth the
trouble: by running both clients against the same live session until the DOM
they produced was identical.
