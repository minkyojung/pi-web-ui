# pi-web-ui

A folder of notes, with a coding agent at the table.

Three columns: the notes, the open one, and pi. The notes are markdown files in
a folder you choose; pi reads and writes the same files with its own tools, and
who wrote which words is kept beside them. pi is not an assistant off to the
side — it is the other person at the table, and the column is its seat. It
collapses with `⌘\` so it can be ignored.

## Run

```bash
npm install
npm run dev            # api on :3000, vite with HMR on :5173 — open :5173
```

The folder the server is started in is the vault. It opens on the model pi
would: the one the session was on, else the default pi has persisted (`pi` →
`/model`, or the picker here), else the first with credentials.

The client is a Vite build, so `npm run dev` runs two processes: the API server,
which owns the pi session and the folder, and the Vite dev server, which proxies
`/ws` to it. For the single-port shape the app actually ships as:

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
it picks. It asks which folder to open on first run and remembers it — a
packaged app is launched with a working directory of `/`, which is not somewhere
to point a coding agent. `⌘O` changes it, which relaunches.

The build is **not signed**; that needs an Apple Developer identity. It runs,
but a first open has to be right-click → Open. `productName` and `appId` are
provisional, and `appId` decides where macOS keeps the app's settings, so
changing it later starts a user from scratch.

Auth comes from `~/.pi/agent/auth.json` (`pi` → `/login`). Sessions are written
to `~/.pi/agent/sessions/` and survive a restart. With no usable credentials at
all the server says so and exits rather than failing on the first prompt.

```bash
npm test          # everything below, offline
npm run typecheck
npm run e2e       # drives the real app in the Chrome already on the machine
```

## The vault

A note is a markdown file, and its name is its title. Subfolders are folders.
There is no database: the disk is the truth, and the app is a window on it.
Anything else that edits these files — Obsidian, vim, a sync client — is a
first-class writer, not a thing to defend against.

What the app keeps for itself goes in `.pi/` beside the notes:

```
.pi/history/<note>.md.jsonl   who wrote which words
.pi/links.json                who links where
.pi/trash/notes/              deleted notes, until they are not
```

pi is told in its system prompt that this is a folder of notes and that `.pi/`
is the app's, and `guard.ts` refuses `edit`, `write` and `bash` that reach into
it whatever the tool mode, because the instruction is the soft version and the
history is the one thing a tool call can corrupt silently.

The keys the window answers to wherever you are; the ones that are about the
words under the cursor are with the parts that own them, below.

| | |
|---|---|
| `⌘N` | a new note |
| `⌘P` | open one by a few letters of its name, or make it |
| `⌘F` | find in the note in front |
| `⌘⇧F` | find a word across every note |
| `⌘E` | show the markup the note is hiding |
| `⌘S` | save now; it saves on its own anyway |
| `⌘\` | pi's column, out of the way |
| `⌘⇧D` | the raw event view |

### One note, however its name is spelled

Two strings can name one file. A Mac opens `a.md` when asked for `a.MD`, and
opens a note whose name has an accent or a Hangul syllable however that name's
characters are composed; a symlink is a second name for a third place. None of
that is decidable by reading the string, so `vault.ts` does not: `realpath` asks
the file system, which is the only thing that knows, and what it says is the one
name the log, the version map and the link index all file the note under. It is
the same problem git settles with `core.ignorecase` and `core.precomposeunicode`,
taken at the one place a path becomes a name. Containment is checked after
resolving, so a symlink pointing out of the folder is refused too.

## Who wrote which words

Every character of a note has an author. `history.ts` keeps one append-only log
per note, one line per change: the first seeds it with the whole text as first
seen, and every line after replaces one range. Replaying the lines from an empty
string gives the text back, which is how a note changed behind the app's back is
noticed — what the log says the note is and what the disk says differ, and the
difference is logged too.

Changes are word-level, which is the grain the screen draws at and keeps a
reworded sentence to one line instead of a dozen. Offsets are UTF-16 code units,
which is what both JavaScript strings and CodeMirror count in. Every writer is
recorded the same way, from the text before and the text after: the editor could
say exactly what it changed and pi's tools could too, but one path is easier to
trust than three, and a diff of a note is cheap.

There are three authors, and the whole design is in keeping them apart:

| | |
|---|---|
| `me` | the person, through this app |
| `pi` | the agent, with the session and the message it said so in |
| `outside` | someone else's editor, a sync client, a `git checkout` |

pi's words are drawn marked until they are looked at. `⌘Enter` accepts the run
under the cursor — it stays pi's in the record and stops being drawn — and
`⌘Backspace` puts back what pi replaced, when the run is still the whole of what
pi wrote, and otherwise takes the run out. Accepting is itself a line in the
log, so the marks come back from the same place everything else does.

`web/src/features/pending.ts` is the first feature and the shape every one after
it takes: it reads the note's history, draws one decoration, and binds two keys.

### The door pi writes a note by

pi's own `edit` and `write` put bytes on disk and tell nobody. Everything a note
needs around a write — refusing one made on a version the person has since typed
past, recording whose words the new ones are, telling the tabs where the change
fell — would have to be bolted on afterwards by reading the file again and
guessing. So a note is taken out of their reach: `guard.ts` refuses `edit` and
`write` on one and says where to go instead, and `noteEdit.ts` registers the
pair that goes there.

- `note_edit { path, edits: [{ oldText, newText }] }`
- `note_write { path, content }`

Their shapes are pi's exactly, because `edit` and `write` are still there for
every other file in the folder and a model holding two near-identical pairs will
send one's arguments to the other. Matching is exact rather than fuzzy: pi's own
matcher is not part of its public surface, and a note is prose a person wrote,
where the wrong paragraph silently replaced is worse than a refusal pi can read
and retry. They sit on the Coding rung of the tool ladder — they are ours, but
they are writing all the same, and a Plan mode that let the agent rewrite a note
would not be one.

Told in as many words to use the plain `edit` tool on a note, pi used `note_edit`
anyway. The prompt was enough; the block is for when it is not.

### And when it came through no door

`bash` names nothing. A command that writes a note cannot be told from one that
reads it, and there is no parse of a shell line that settles it — so a write made
there is found the way any write from outside is found, when the disk stops
agreeing with the log. What `recorder.ts` adds is the answer to whose it was.

The log is append-only and has no line that changes an earlier line's author, so
that answer has to be right at the moment the line is written. The watcher is the
only thing that knows *when* a note changed, so it is left to log as promptly as
it always did and given a `claim` to ask with instead: while a shell call is in
flight, a note whose file is newer than the call started is pi's, and carries the
session and the message it came from. Waiting for the call to end instead would
be worse than the bug — `npm run dev` runs for minutes, and every save the person
made meanwhile would come back marked as pi's words in their own editor.

Two bounds keep it honest:

- **Time.** A note that changes in the fifth minute of a dev server is the
  person, not the command. After ten seconds the answer is `outside` again —
  the cheap wrong answer rather than the expensive one.
- **What the app knew.** pi may only be named over a difference measured from a
  state the app had. A note with no log is seeded whole, so naming pi there
  would hand pi every word the person ever wrote in it — unless the note was not
  there before the call at all, in which case pi did write every word of it.

## Writing

The editor is CodeMirror 6. What is typed is written down before anything reads
the disk, so a save that lands after pi has changed the file is refused and
reported rather than merged — the two writers are one person and one agent that
works in turns, so this is rare, and rare things are better seen than smoothed
over.

A write is sent to the other tabs as the change it made, over the version they
have, and fitted around typing they have not saved yet — LSP-style incremental
sync, in `noteSync.ts`, mapping the incoming change set under the local one and
refusing only where the ranges actually overlap. `watcher.ts` hears a write that
did not pass through the app and sends it on like one; the server keeps the
version it last told the tabs about, so its own writes do not come back as
someone else's.

Markup is hidden where the cursor is not — headings, emphasis, links, a task's
box, a quote's bar, a code block in monospace — and `⌘E` shows it all again.
`⌘B` and `⌘I` put a mark around the chosen words and take it off again. A list
item continues on Enter and ends on a second, brackets close as they open, and a
wrapped line starts where its words do.

The title above the note is the file's name. Typing a slash into it moves the
note to that folder, and a leading one moves it back to the top; the history and
the links move with it. Deleting puts a note in `.pi/trash/` and offers it back
until something else is opened.

Notes name each other with `[[wikilinks]]`, `![[embeds]]`, and ordinary markdown
links. `linkIndex.ts` keeps who links where, so backlinks are a lookup rather
than a search, and a rename retargets every link that named the old path. `[[`
offers the notes; `⌘`+click follows a link, or makes the note it names if it is
not there yet; a link to a `#heading` or a `^block` lands on its line. `#tag`,
`==highlight==`, `%%comment%%`, `> [!note]` callouts and front matter are read
by one markdown, shared by the parser that draws the note and the one that
indexes it.

## Asking pi about a note

Choosing words in the editor is how a person points. What is chosen shows above
pi's column, and a question sent while it is chosen goes with it as a quote, so
"what does this mean" is a question about something.

The app owns the place, and the model only writes the words — the same way round
as Zed's inline assistant and Cursor's `⌘K`. The place stays on the server and
is mapped through the note's log while pi thinks, so it still names the same
words when the answer arrives; if the chosen part was replaced whole meanwhile,
the two ends meet and nothing is written. pi is told it is answering into a note
and is kept from writing the note itself for that turn, so the answer lands once,
under the line the chosen words end on, as pi's — marked, like anything pi
writes.

## pi's column

The conversation: user messages, assistant text rendered as markdown as it
streams, tool calls as collapsible cards that fill in with their partial output
while they run, errors, notices for the work pi does without being asked (auto
retries, compaction), and a completion marker. Everything else is dropped. The
raw view — `⌘⇧D` — shows every event, which is the only way to debug when the
rendered view is wrong. Events go out in the same shape pi's own print and rpc
modes use: a `message_update` carries its delta, not the two full copies of the
in-flight message it also ships as `message` and `assistantMessageEvent.partial`.

`conversation.js` holds the rules for turning a pi session into conversation
items, and both the browser and the server import it. It used to exist twice —
`apply()` in the client for live events, `snapshot()` in the server for resumed
ones — and the two had drifted in four ways: an unusual tool result rendered as
JSON live and as blank on resume; the server emitted the raw `400 {json}`
envelope and relied on the client to unwrap it; empty user messages were kept by
one path and skipped by the other; and a reply that called a tool before speaking
came out in opposite orders. None showed on the happy path, which is what made
them worth removing rather than fixing twice.

`applyEvent` returns the items it added and changed so a renderer can stay
incremental without diffing; a caller that re-renders wholesale can ignore it and
read `state.items`.

Rendering is incremental, which the reducer makes possible and the suite pins:
`applyEvent` touches at most one item per event. `conversation.js` updates items
in place, which React cannot see, so the client copies the items the reducer
reports as touched into a fresh array — every other item keeps its identity and
its memoized component skips the render. Updates are coalesced into one animation
frame, which a browser does not run in a hidden tab, so a background tab catches
up when it is focused. The raw view keeps the last 300 events, and keeps them
whether or not it is open — you turn it on after seeing something odd, so the
history has to already be there — but serialises them only where they are read,
rather than on every delta of every run.

The design comes from the hand-written DOM client that preceded it, where
rebuilding everything per event cost 63ms for the first turn and 534ms by the
twelfth, and going incremental made it flat at ~42ms. Markdown made this worth
rechecking, since the open message is now re-parsed rather than appended to: a
5,500-character answer with four highlighted code blocks streamed in over 17.5s
for 698ms of script time and no task over 50ms.

The socket reconnects with a capped, jittered backoff. Recovery is entirely
server-driven — it pushes `config`, `usage`, `snapshot` and `sessions` on
connect — which is also the limit: a snapshot is rebuilt from stored messages, so
`done` markers and live-only notices do not come back, and a tool that was
mid-execution returns with no result and stays that way. Nothing is queued while
the socket is down; a prompt replayed afterwards could land in a session that was
swapped underneath it. The controls disable instead.

`ws.ts` opts out of HMR: it accepts its own update and invalidates, so an edit
that reaches it reloads the page. The module owns a socket, a timer and two
window listeners, and a hot swap that undoes all but one of those leaves a second
instance in the page folding the same events into the same store — which reads as
every delta applied twice, an answer interleaved with itself. The rule this comes
from: a module that takes something at module scope either gives all of it back
in `hot.dispose`, or refuses the swap. Half a teardown is worse than none,
because it looks handled.

The controls sit with the message they apply to, under the composer, since all
three are chosen per message:

- **Model** — any model with usable credentials, grouped by provider, read from
  pi each time it is sent rather than copied at startup: pi's first availability
  pass can be cut short by a credential refresh and come back with one provider,
  and a copy of that would have stayed wrong until a restart. Switching is live.
  Thinking level is clamped to the new model, which the config broadcast
  reflects. Set with `persist`, so pi writes it to its own settings and the next
  session opens on it.
- **Thinking** — only the levels the current model supports. `setThinkingLevel`
  clamps rather than rejects, so the server validates the value first; otherwise
  an unknown level silently becomes `off`. Persisted the same way.
- **Tools** — a mode rather than a row of checkboxes: Plan, Coding, Full access,
  each a strict superset of the one below, with the per-tool list still a
  submenu. Turning a tool off genuinely prevents its use; the model is told what
  it has and calls nothing else. Takes effect on the next turn, not the one in
  flight.

The ladder is in `toolModes.ts` at the repo root, shared like `conversation.js`,
because the server picks the mode a new session opens on and the browser names
the one it is in. Its rungs are pi's own built-ins plus the pair a note is
written by.

That mode is fixed rather than remembered. pi persists the model and the thinking
level when asked, but not the active tools — `setActiveToolsByName` takes no
`persist` and `defaultTools` has a getter and no setter, so tool activation is
session-scoped there by design. Rather than keep a second settings store beside
pi's, every new session opens on `DEFAULT_MODE`. Resumed sessions are left as
they were.

Stopping a run is the composer's submit button, which becomes a stop button while
streaming.

Sessions are owned by an `AgentSessionRuntime`, since `/new` and `/resume`
replace the `AgentSession` object rather than mutating it. Every read goes
through `runtime.session`, and the event subscription is rebound after each
replacement. A resumed session emits no events for its history, so the server
sends a `snapshot` — the conversation rebuilt from `session.messages` through
`itemsFromMessages`. An unsaved session has no file yet and would be missing from
the picker, so it appears as a placeholder entry. Asking the same thing again
makes a sibling rather than a reply, and `branches.ts` finds the points where a
session forked so the ways of asking can be stepped through with arrows.

Messages sent while a run is in progress are queued as either `steer` or
`followUp`, chosen next to the input. Steering is delivered at the next turn
boundary — after the current turn's tool calls, before the next model call — so
it cuts a tool-using run short but cannot interrupt a single long generation.
Follow-ups wait for the run to finish. Both are listed above the composer, in
delivery order, and refresh from `queue_update`.

`clear_queue` empties the queue and returns what was in it, so the tab that asked
can put the text back in its input box. It is all of them at once because that is
the only queue edit pi has: `clearQueue()` is the whole API, and removing one
message by clearing and re-queueing the rest would run `steer()` over text it had
already expanded once and throw on anything that expanded to an extension
command.

A `usage` message carries `getSessionStats()` and `getContextUsage()`: accrued
cost, token breakdown, and how full the context window is. Sent on connect and
after every completed message, since spend is otherwise invisible.

The server owns this state and broadcasts a `config` message on connect and after
every change, so multiple tabs stay in sync.

## The UI stack

Tailwind 4, shadcn/ui, and Vercel's AI Elements. All three vendor their
components into `web/src/components`, which is the point: the files are ours to
edit, and several are edited.

- **Dark mode is a media query, not a class.** shadcn puts its dark tokens behind
  `.dark` and adds `@custom-variant dark` to match. Leaving that variant out
  means Tailwind's built-in `dark:` *is* `prefers-color-scheme`, so every `dark:`
  utility inside a vendored component follows the system with no JS and no flash
  of the wrong theme. `color-scheme: light dark` does the same for native
  controls.
- **`message.tsx` drops the math and mermaid streamdown plugins.** mermaid is by
  far the largest thing in this dependency graph and katex ships its own
  stylesheet and fonts, for LaTeX and diagrams a coding agent does not produce.
  `cjk` stays — it fixes emphasis parsing next to CJK characters. Re-adding
  either is one import.
- **`tool.tsx` renders a string result as-is rather than as JSON**, which is what
  the registry does, and caps its height: a tool result here is whatever the tool
  printed, and a grep over a large tree runs for pages.
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

Two things about the CLIs, since neither is in their docs. shadcn resolves `@/*`
from `paths` alone, which matters because TypeScript 7 removed `baseUrl` and the
Vite guide tells you to add one. And `npx ai-elements add` writes to
`./components/ai-elements` regardless of `components.json`, so its output has to
be moved into `web/src` and its `@/lib/utils` import repointed at the `cn`
package the shadcn components already use.

## Questions from extensions

The dashboard extension installed on this machine replaces pi's dialog methods
with its own PromptBus and sends every `ask_user` question to a dashboard app
nobody here has open, where it waits out a five-minute timeout — and `abort()`
waits with it. The same bridge exposes `prompt:register-adapter`, documented in
its architecture notes and used by its sibling flows plugin, so `prompts.ts`
registers this server as an answerer: each question is broadcast as
`prompt_request`, rendered as a card under the waiting tool, and the first
`prompt_response` from any tab goes back to the bus; every tab then gets
`prompt_dismiss`. Stop, New and switching sessions cancel open questions first,
which is what actually lets the abort through; `abortWithin` remains as the
fallback for anything else that never returns.

This leans on a third-party 0.x package's extension point, not on pi. If the hook
stops answering, the server logs a warning at bind time and questions fall back
to timing out as before.

The same extension also refused to initialise after New or Resume: pi reloads
extensions in-process when it replaces the session, and the bridge keeps its
state on `process` and treats a second load as a subagent, so it registered no
tools (13 became 8) and, because the state it carried held the previous session's
context, threw inside its own `session_start`. Before each session is built the
server retires the previous bridge the way its own initialiser would — cleanup,
connections, timers — and removes that state, so the reload counts as a first
load. Internal, undocumented state again; if the key moves this is a no-op and
the bind-time warning fires. The dashboard server still autostarts unless
`~/.pi/dashboard/config.json` sets `"autoStart": false`.

## Events observed

The app's own extensions are inline in `server.ts` rather than files under
`.pi/extensions/`: that path needs the project trusted, and the desktop shell's
working directory is wherever it was opened. They are built per session and
retired with it — `guard` first, since a blocked call never reaches the ones
after it.

A turn with a tool call produces, in order:

```
agent_start → turn_start
  message_start / message_end                    (user message)
  message_start
    message_update.thinking_start / thinking_end
    message_update.text_start / text_delta / text_end
    message_update.toolcall_start / toolcall_delta / toolcall_end
  message_end
  tool_execution_start / tool_call
  tool_execution_update
  tool_result / tool_execution_end
turn_end → agent_end → agent_settled
```

Notes:

- Assistant text lives at `event.assistantMessageEvent.delta`, not `event.delta`.
- `agent_settled` is the completion signal. `agent_end` carries `willRetry` and
  may be followed by more work.
- Provider failures (billing, rate limits) do **not** throw from `prompt()`. They
  arrive as a message with `stopReason: "error"` and an `errorMessage`, so a UI
  that ignores them looks silently stuck.
- **`tool_result` is not emitted for a call that was blocked by an extension or
  aborted mid-batch** — it is reached only on the path where the tool actually
  ran. `tool_execution_end` is emitted either way, which is why anything set
  aside at `tool_call` is released there.
- A block short-circuits: the runner returns on the first extension that asks
  for one, and the extensions after it never see the call.

## Tests

`npm test` is Node's built-in runner and no dependencies. Everything that decides
what something means is a plain function tested directly: what a change is and
whose it is (`history`), what a path names (`vault`), what a shell call may claim
(`recorder`), what the guard refuses (`guard`), what an edit does to a note
(`noteEdit`), what the markdown is (`highlight`, `tag`, `comment`, `frontmatter`,
`links`, `livePreview`), what a session means (`conversation`, `branches`).

Three recordings of real pi sessions sit in `test/fixtures/` and are committed
verbatim rather than trimmed, so those tests can only pass on shapes pi actually
emits. The load-bearing one is the equivalence test: `agent_end` carries the run's
messages, so a single recording holds both inputs to the live/resumed contract,
and asserting the two produce the same items is what keeps them from drifting
again.

`npm run record <out.json> "<prompt>"` refreshes a fixture against a live session.
It spends real tokens, so it is manual and never part of `npm test`. Re-record
only when a pi upgrade actually breaks a test — a stale fixture that still passes
is evidence the contract held.

`server.test.js` boots the real server on a real socket against a real temporary
vault: no mocks of the file system or of pi, so what is pinned is what a tab
actually gets back. It skips itself, rather than failing, on a machine with no
credentials.

Where a test asks about the file system's own behaviour — whether it opens `a.MD`
as `a.md`, whether it hides a name's composition — it probes for that behaviour
first and skips when the disk under it does not have one, the way git probes for
`core.ignorecase`. A test that asserts a Mac's answer everywhere is a test that
lies on Linux.

What is left after all that is JSX, and none of it would notice a component that
renders nothing or a control that is never reachable. `npm run e2e` is for that.
It starts its own server and dev server on free ports, writes a vault and a
session of its own, and drives the Chrome already on the machine over the
DevTools protocol — no browser library, since `npx playwright install` would
download a second browser to do the same thing. It opens notes, types in them,
presses the keys, follows links, accepts and reverts pi's words, and checks that
nothing reached the console. Its folder, its session, its ports and its browser
profile are its own, and it removes them, so it will not disturb a server or a
session you have open.

Two things it needed are worth knowing about the app rather than about the test.
A background tab gets no animation frames, and the store tells React about new
items on one, so a page nobody is looking at holds a conversation it never draws
— the test emulates focus to get around it, and the behaviour is deliberate. And
pi's column is a share of the window, so a narrow window collapses it to nothing:
the browser is given a wide one.
