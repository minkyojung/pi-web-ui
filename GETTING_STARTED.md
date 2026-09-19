# Getting started with Octave

Octave is a notes app for the Mac with an agent that works in the same notes you do. Your notes are markdown
files in a folder you choose; Octave is a window onto that folder, and the agent reads and writes the same files.

**You need:** a Mac with Apple Silicon (M1 or later) on macOS 13 Ventura or later, and an account or API key
with a model provider — a ChatGPT or Claude subscription works.

## 1. Install

Download `Octave-<version>-arm64.dmg` from the [releases page](https://github.com/minkyojung/pi-web-ui/releases/latest),
open it, and drag Octave to Applications. It is signed and notarized, so it opens without a warning.

Octave updates itself. When a new version has been downloaded, a small notice in the bottom-right corner offers
to restart; if the agent is in the middle of something, *Restart when done* waits for it. Closing the notice is
fine — the update goes in the next time you quit. **Help › What's New** says what changed.

## 2. Add a repository

With no repository yet, Octave opens on a screen that adds one. **Open local repository** takes a repository
you have on this Mac. **Clone from GitHub** lists yours to pick from — signed in with `gh`, private ones too —
or takes any by owner/name or its address, and clones it into `~/octave/repos/`. Either way Octave makes the
repository's first workspace and opens it.

A workspace is a folder and a branch of its own, made from the latest on the remote, under
`~/octave/workspaces/`; the agent works there, and your own clone is never touched. The sidebar lists your
repositories and their workspaces: + on a repository makes another workspace, + beside **Repositories** adds
another repository, and `⌘O` opens a local one.

In a workspace, `/spec` and a line of what you want built starts a spec. The agent names the work, writes its
requirements to `.octave/specs/<name>/requirements.md` in the workspace's folder, and stops for you to read and
change them; the workspace's branch then takes the spec's name. One spec to a workspace: for the next one, make
another with +.

When the requirements are right, `/spec-approve` approves them and the agent writes the design; approve that and
it writes the tasks. Nobody asks you to approve: ask for changes, or make them yourself, as many times as you like
first. The agent cannot write a document before you approve the one before it, and if you go back and change one
you approved, the documents after it wait for you again, and the next `/spec-approve` has the agent bring them into
line. What you approved is kept beside the documents, in `approvals.json`.

## 3. Sign in

The first run opens a **Welcome** page with three steps: your folder, signing in, and a button that writes a
welcome note into the folder with a few things to try. Sign in with a subscription account, or paste an API key.
You are signing in to the provider, not to us — Octave has no account of its own. **Help › Welcome** opens the
page again; accounts are also in Settings (`⌘,`).

## 4. Write, and ask

- Write as you would anywhere. Typing saves on its own.
- The agent is the column on the right (`⌘\` hides it). Ask about the note you are in; select words first to
  ask about those; type `@` to point at another note and `/` for commands.
- **PDFs are part of the folder.** They are in the sidebar and in `⌘P`, and open in a tab. Drop one on the
  message box, or type `@` and pick it, and ask: the agent reads it page by page. Select words in a PDF first
  and the question is about those words, on that page.
- **What the agent writes in a note is a suggestion until you decide.** Each change is shown against what it
  replaced. `⌘↵` keeps the one under the cursor, `⌘⌫` puts back what was there. Leave it for days if you like.
  Under a finished run there is one button that puts back everything that run changed.
- **Every word keeps its author.** Point at the agent's share in the strip at the foot of the window and turn
  on *Who wrote what*: your words, the agent's, and anything that arrived from outside Octave are told apart.
  Click the agent's words to see which model wrote them and what it was asked.

## 5. What the agent may do

A new conversation starts careful: the agent can read and edit your notes, and **cannot run shell commands or
reach the web**. Both are one step away in the tool menu under the message box — *Full access* and *Web access* —
and stay where you put them. Octave does not ask before each step, so the mode is the boundary: leave it on
*Coding* unless you want the agent to run commands on your Mac.

## 6. What leaves your Mac

When you ask the agent something, your message and whatever it reads to answer — which can be the text of your
notes — go to the provider you signed in to, and nowhere else. With Web access on, its search words go out too.
Octave checks GitHub for a new version when it starts and every four hours. There is no telemetry and no crash
reporting. The full table, where every file is kept, and how to remove it all: [PRIVACY.md](PRIVACY.md).

## 7. Coming from Obsidian

Open your vault as it is; Obsidian can stay open on the same folder. What is drawn the way Obsidian draws it:

| | |
|---|---|
| Links, tags, properties | `[[note]]`, `[[note#heading]]`, `#tag`, the properties at the top of a note |
| Pictures | `![[photo.png]]`, `![[photo.png\|300]]`, `![alt](path.png)`. Paste or drop a picture and it is saved where your vault's attachment setting says — `attachments/` if it says nothing |
| Embedded notes | `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block]]`, kept current as the other note changes |
| Tables | Drawn as tables. Inside one, `Tab` and `⇧Tab` move between cells, `↵` adds a row, and the columns are squared up when you leave |
| PDFs | `[[paper.pdf]]` opens it, `[[paper.pdf#page=3]]` at that page |
| Footnotes | `[^1]` and its note; type `[^` to pick one or start a new one, point at a number to read it |
| Math | `$x^2$` and `$$` blocks |
| The rest | Callouts, highlights, comments, task lists, `H~2~O`, `x^2^`, and a short list of HTML (`<u>`, `<kbd>`, `<details>` …) |

As in Obsidian, the markup comes back when the cursor is in it. Not here yet: a list of the notes that link to
the one you are in, plugins, and canvas.

## 8. Keys

| | |
|---|---|
| `⌘N` | New note |
| `⌘P` | Open a note by name, or make one |
| `⌘O` | Open a repository |
| `⌘⇧F` | Search the text of every note |
| `⌘F` | Find and replace in the note |
| `⌘↵` | Keep the agent's words under the cursor |
| `⌘⌫` | Put back what the agent replaced under the cursor |
| `⌘↵` in the message box | Steer the run in progress |
| `⌘\` | Show or hide the agent |
| `⌘,` | Settings (every key is listed under Keys) |

## 9. When something goes wrong

**Help › Report a Problem…** opens the folder Octave keeps its log in and a form on GitHub with your versions
filled in. The app sends nothing itself — the log is yours to read over and drag in.
