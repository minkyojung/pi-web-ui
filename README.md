# Octave

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

`npm run pack` builds the disk image; `scripts/pack-signed.sh` does the same
signed and notarized, with the credentials read out of 1Password for the one
run, and `scripts/verify-signed.sh` asks of the result what a person's Mac
will — codesign, Gatekeeper, the stapled ticket, and that the server still
starts under `ELECTRON_RUN_AS_NODE`, which is a fuse signing must leave on.
The app is `Octave` to macOS and `run.octave.app` to the signing identity and
the updater; neither changes again, since the first decides where macOS keeps
the app's settings and the second what the updater thinks is the same app.

A release is a tag: `node scripts/release.mjs 0.0.2` closes `[Unreleased]` in
`CHANGELOG.md` as that version — after asking claude what the commits since
the last tag contain that the notes do not, and refusing an empty section —
bumps `package.json`, commits and tags. Pushing the tag runs
`.github/workflows/release.yml`, which builds, signs and notarizes from a
certificate in the secrets and publishes the disk image, the zip and
`latest-mac.yml` as a GitHub Release with the section as its notes. The
installed app (`electron-updater`, in `electron/main.js`) looks there once
the window is up and every few hours, downloads quietly, and offers the new
version with those notes when it is ready; the server is stopped before the
installer's quit, which `before-quit` would otherwise hold back.

Octave is AGPL-3.0 (`LICENSE`). Everything it is built on is permissive and
asks only that its notice be carried, so `npm run build` begins by writing
`THIRD_PARTY_NOTICES.md` — the licence of every package that ships in the app,
from both trees — and refuses on one that is not permissive (`scripts/notices.mjs`).

Auth is pi's: `~/.pi/agent/auth.json`, shared with the terminal `pi`. Signing
in happens in Settings → Accounts, which is pi's `/login` drawn in the browser
— the server hands pi's `login()` an object whose `prompt` and `notify` go over
the socket (`login.ts`), so what pi asks for is what is shown, and a provider
pi adds is signed in to without a change here. A URL pi wants opened goes to
the shell, which opens the person's browser. Sessions are written to
`~/.pi/agent/sessions/` and survive a restart. With no usable credentials at
all the server still starts, as pi's own CLI does, on no model: the picker
says so, its last item leads to Accounts, and on a first run Accounts opens
itself.

What the server says it also writes down, in `~/.octave/logs/server.log`,
rolled to `server.log.1` at two megabytes. In a terminal the log is beside the
point — it is on screen — but the desktop app has no terminal, and without it a
crash that does not happen again is never seen at all, and the safety net for
uncaught errors reports to nobody. `⌘⇧D` says where the file is. `APP_DIR`
moves it, which is how the tests and `npm run e2e` keep out of yours.

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
.pi/trash/history/            a deleted note's past, waiting for it to come back
.pi/trash/notes/              deleted notes, where there is no shell to ask
```

A folder of notes is often a git repository already, so `.pi/.gitignore` is
written once, by the app, and says what git should make of the folder: the
history and the chosen property types travel with the notes, since the notes
cannot give them back; the snapshots, `links.json` and the trash do not, since
they can be rebuilt or are this machine's. Edit it and it stays edited.

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
seen, and every line after replaces one range. Each line says which shape it
is (`v`), since the log is never rewritten and only how a line is read can
change. Replaying the lines from an empty
string gives the text back, which is how a note changed behind the app's back is
noticed — what the log says the note is and what the disk says differ, and the
difference is logged too.

The editor says exactly what it changed — the change set it already keeps for
the other tabs goes with every save — and the record takes it as said, on one
condition: applied to the text the editor started from, it must give the text
it ended with, to the character. An account that does not add up is set aside
and the change is read off the two texts instead, word-level, which is the
grain the screen draws at and keeps a reworded sentence to one line. That
reading is also how anything that did not come through the editor is recorded.
So the one path of reading a change off two texts is still here, as the check
on every account and the only way to know a write from outside; it is no longer
what the editor's own words are known by. Offsets are UTF-16 code units, which
is what both JavaScript strings and CodeMirror count in.

One thing that account can say which no diff can: where words came from. A
paragraph cut and pasted is, to a diff, a paragraph deleted and another
written, and the one who pasted it becomes its author. The editor saw the cut
(`moves.ts`) — it is a transaction it can name, as a paste is — so it remembers
the words and where they stood in the record, and sends a paste of exactly
those words with that place on it. The record replays the note's log to the
length it had then, before the cut took the words out, and lays the authors it
finds over the pasted words; they ride the line as theirs, and `replay` gives
them back. Nothing is read from the clipboard and nothing is matched by
resemblance: words from another app are new to the note and the person's,
which is right. Moving pi's undecided words is the person handling them — where
they were reads as it did before pi, where they are is where the person put
them — so nothing is left to decide, and who wrote them still says pi.

There are three authors, and the whole design is in keeping them apart:

| | |
|---|---|
| `me` | the person, through this app |
| `pi` | the agent, with the session and the message it said so in |
| `outside` | someone else's editor, a sync client, a `git checkout` |

And one word for what is not a writer: `before`, the words a note had when
the app first read it. A note the app did not know cannot have its change told
from its text, so the whole of it is seeded as `before`, and `before` is
never marked — the alternative is a folder of old notes underlined from end to
end as someone else's. A note that appears in the folder while the app is
running is different: nobody had it, so every word of it was written just now,
and it is seeded as `outside`.

### Deciding about what pi wrote

pi's changes to a note are shown as a diff until the person decides about
them, a chunk at a time — what pi added coloured in place, what pi removed
drawn above it in a widget, since it is not in the file and must not be put
there. Keep and Undo sit on each chunk; `⌘Enter` and `⌘Backspace` do the same
to the one under the cursor. The drawing is CodeMirror's own `unifiedMergeView`,
which is where the work of drawing a diff already is; the two texts it needs
are the note as it is and the note as it would be with pi's undecided changes
put back.

That second text is not kept anywhere. `unreviewed` in `history.ts` reads it
off the log: it walks the changes carrying holes — pi's undecided runs, each
with what stood there before pi did — and fills them at the end. A change of
pi's opens a hole or widens the one it lands in. A change of the person's
inside a hole joins it, as Cursor and Zed diff the file as it is against the
file as it was; typing on from a hole's end is the person's, as a mark does not
grow at its end, so putting a chunk back never takes their words with it. Words
pi took away and replaced with nothing leave a hole of no width, and a decision
about one is a touch of no width at that seam.

So the diff is there whenever there is something to decide, however long ago
pi wrote and whichever tab opens the note, and gone when there is not. There is
no other marking of pi's words: a mark that says "pi wrote this, decide" is the
diff said with less, and it was what this app had first.

A run of pi's that wrote in several notes can be put back at once, from the
line under the run: every note pi wrote to in that run goes back to its
"before", as one edit of the person's per note. It is the diff's Undo applied
wholesale — what was kept stays kept, what the person typed since stays theirs
— and it is found by the log rather than remembered, so it works on a run from
before the app was last opened. Cursor and Zed offer the same on a run, as a
snapshot of the files; here the record knows which words were pi's, so only
those go.

Between saves the editor keeps "before" honest itself: a change of the person's
outside the chunks is made to it in the same transaction, so their own words
never read as pi's for the length of an autosave.

Keeping a chunk is two things, not one: the view forgets it, and the record is
told the words have been looked at. Undoing is one thing — it puts the text
back, which is an edit like any other, saved and logged as the person's. `⌘Z`
takes back either. Undoing a chunk is a plain edit and the editor's own history
has it already; keeping one changes no text at all, so it is put into the
history the way CodeMirror provides for, with `invertedEffects`, and the record
is told again the other way round — the log is append-only, so a decision is
unmade by writing its opposite, the way a ledger reverses an entry rather than
rubbing one out. A touch line carries `kept`, and the last word about a range
wins.

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
reads it, and there is no parse of a shell line that settles it. The app used to
answer afterwards, from the clock — a note that changed while a shell call was in
flight was pi's for ten seconds and then `outside` — which was right almost
always and wrong in a way nothing could catch. What cannot be told apart is
better made impossible: pi's shell runs behind a wall (`wall.ts`), a macOS
sandbox profile that denies writing to `*.md` under the folder and to `.pi/`
and allows everything else. Reading the notes, building, testing, writing any
other file — as before. Writing a note — "Operation not permitted", which pi
reads, and its prompt has already told it where to go instead.

The wall is the command rewritten in `tool_call`, the way pi documents for
patching a tool's arguments: `sandbox-exec -f <profile> /bin/bash -c <command>`.
pi's own shell still spawns it and still kills it on timeout, and the
conversation still shows the command pi wrote. One consequence is meant: a
`git checkout` or `git pull` pi runs cannot rewrite notes either. Where
`sandbox-exec` is not there — another platform — there is no wall, and a note
the shell writes is found the way any write from outside is, and called so.

So the log's author is never guessed. The editor's save is `me`; `note_edit`
and `note_write` are `pi`, with the session and the message; a note that
appears in a folder that did not have it is `outside`, whole; and a difference
between the disk and what the log knew is `outside`, or `before` when the log
knew nothing. Four rules, and no clock.

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
the links move with it.

Deleting puts a note in the trash the machine already has — the one the Finder
opens, where it can be searched, put back, and emptied on the schedule that was
chosen for it. It follows from the folder being the truth: deleting is a thing
that happens to a file, and an app that moves one somewhere only it can see is
not a window on the folder but a place files hide in. The test that settles it
is to imagine this app deleted tomorrow. The notes are still there; everything
ever deleted would be in a dot-folder nobody will open again. Obsidian's
default is the same, for the same reason.

Only the shell can put a file there. The trash is not a directory to move a
file into — one renamed into `~/.Trash` sits there with its way home lost,
since what Put Back knows is kept by the Finder and not by the file — so it
takes the platform's own call, which in Electron lives in the main process and
not in this server. The server asks for it over the channel a parent and a
child already have, and `process.send` being there at all is how it knows there
is a shell to ask (`trash.ts`). Where there is none — a server started by hand,
a page in a browser — the note goes to `.pi/trash/notes/` as before, and that
is the one the app itself can offer back.

A note's past does not go with it either way. It cannot stay where it is, or a
new note made at the same name would inherit it; it cannot be thrown away,
since it is the one thing about a note that cannot be rebuilt from the note. So
it steps aside into `.pi/trash/history/` and waits. When a note appears where
one was deleted, the log is asked rather than assumed: replaying it gives the
text the app last knew that note to be, and a log whose replay is exactly what
is on disk now is this note's. Put Back brings a file home byte for byte, so a
note that comes back comes back with its authors; a different note that happens
to take the name replays to something else and starts with a history of its
own.

Notes name each other with `[[wikilinks]]`, `![[embeds]]`, and ordinary markdown
links. `linkIndex.ts` keeps who links where, so backlinks are a lookup rather
than a search, and a rename retargets every link that named the old path. `[[`
offers the notes; `⌘`+click follows a link, or makes the note it names if it is
not there yet; a link to a `#heading` or a `^block` lands on its line. `#tag`,
`==highlight==`, `%%comment%%`, `> [!note]` callouts and front matter are read
by one markdown, shared by the parser that draws the note and the one that
indexes it.

A note's front matter is its properties, shown as rows above the text rather
than as the `---` block, which stays in the file and out of the cursor's way.
A value changed in a row, a property added or removed, is one change to the
block's lines and no other — the comments and quotes around it are kept — and
⌘Z takes it back as it would typing. A block that does not parse is said so
and left exactly as it is; ⌘E shows the block as text either way.

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

- **Model** — any model with usable credentials, grouped by provider. pi decides
  which by reading each provider's credential, and leaves out without a word any
  it cannot read at that moment — and the file they all live in is rewritten
  whole whenever an OAuth token is renewed, so a pass that reads it mid-write
  comes back one provider short. pi's CLI runs the pass again each time its
  picker opens; this server runs it when the credentials file changes and when
  a tab connects, looks once more when a provider has gone missing, and says so
  beside the picker meanwhile (see `models.ts`). Switching is live.
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
- **Web access** — a checkbox beside those three, not a fourth radio, because it
  is a different question: the ladder is about what happens to your notes, the
  web about what leaves this machine and what comes back into the conversation.
  Every mode comes with it on; turned off it stays off through a change of rung
  (`withWeb` exists so a mode, which is generous with extension tools, cannot
  quietly turn it back on). The four tools go together, and the per-tool list
  below still separates them.

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

## Questions from pi

`ask_user` is Octave's own tool (`askUser.ts`): the same name and the same five
kinds of question pi already knows how to ask, so nothing about pi changes.
Each question goes out to every tab as `prompt_request`, is drawn as a card
under the waiting tool, and the first `prompt_response` from any tab settles
it; every tab then gets `prompt_dismiss` (`prompts.ts`). Nothing waits it out —
the card stays until it is answered or closed, and Stop, New and switching
sessions cancel open questions first, which is what lets the abort through.

It began as the dashboard extension's tool, reached over that extension's bus,
and the bus cost a second on every new session and threw on the second load.
That is the general case of a package installed into someone's own pi: it was
installed for the terminal, it may not survive being restarted per session,
and a tool that is there on one machine and not another cannot be documented.
So the session is built with `noExtensions` — what `~/.pi/agent/settings.json`
names is not loaded here.

`noExtensions` is about whose extensions, not about having none. The five
inline ones below are Octave's, and one more is loaded from a file:
`pi-web-access`, a dependency of ours in our own `node_modules`, handed to pi
as a path (`additionalExtensionPaths`, which that flag does not cover). It
brings `web_search`, `fetch_content`, `source_check` and `get_search_content`
— a note is written from what was read, and half of that is on the web. It
ships TypeScript and names its entry in its own `package.json`, so pi's loader
transpiles it; importing it into `server.ts` would only put source esbuild
cannot bundle into the server. That transpile costs 750ms once and 30ms from
jiti's disk cache after, and a new session costs nothing at all, the module
being kept for the life of the process: boot with it and boot without it are
the same to a stopwatch. Search works with no key of its own — it reaches for
the provider pi is already signed in to — and `~/.pi/agent/web-search.json` is
where a key, another provider, or a tool turned off would go.

## Events observed

The app's own extensions are inline in `server.ts` rather than files under
`.pi/extensions/`: that path needs the project trusted, and the desktop shell's
working directory is wherever it was opened. Trust is pi's own — the answer
its terminal remembered in `~/.pi/agent/trust.json` when it asked — and a
vault it never asked about is not trusted, so a `.pi/settings.json`, a skill
or a `SYSTEM.md` in the vault is not read. The context card says so. Left to
pi's SDK the vault would be trusted without asking, which is the one place its
defaults are not taken. They are built per session and
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
`links`, `livePreview`), what a note's properties say and how they are changed
without touching the rest (`properties`), what a session means (`conversation`, `branches`).

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
