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
or takes any by owner/name or its address, and clones it into `~/octave/repos/`. Either way the repository is
added to your list and nothing else happens: no workspace is made or opened until you ask for one.

A workspace is a folder and a branch of its own, made from the latest on the remote, under
`~/octave/workspaces/`; the agent works there, and your own clone is never touched. The sidebar lists your
repositories and their workspaces — and so does the first screen, until a workspace is open: click a workspace
to move into it, + beside **Repositories** adds another repository, and `⌘O` opens a local one. Drag a
repository's row to put the list in the order you want it in. Right-click one and **Take off the list…** when
you are done with it: nothing on your disk is touched, and adding it again brings its workspaces back with it.

+ on a repository starts a spec, and that is how a workspace is made. Say what you want built, choose the model
and effort for it, and **Create** (`⌘↵`): the workspace is made, the window moves into it, and your line is sent
there as `/spec`. The agent names the work, writes its requirements to `.octave/specs/<name>/requirements.md`
in the workspace's folder, and stops for you to read and change them; the workspace's branch then takes the
spec's name. If you are not signed in yet, the line waits in the message box for you to send once you are. One
spec to a workspace: for the next one, press + again. `/spec` and a line, typed in a workspace that has no spec
yet, does the same there.

The dialog opens from anywhere with **Folder › New Spec…** (`⌘⇧N`), over the repository you are in; the name at
its top changes to another. Behind the ⋯ beside it is the branch the workspace starts from — the remote's default
unless you choose another, for a spec that stands on work not merged yet. The button at the far end starts from
one of the repository's open GitHub issues, listed with `gh`: its number, title and words go into the box, for you
to read and change before Create.

When you are done with a workspace, right-click its row and **Archive workspace…**. Its folder is given back;
the branch and its commits stay, the conversation stays, and so does the row — under **Archived** at the foot of
the repository, where a click makes the folder again from the branch, sets it up and opens it. Changes you have
not committed would go with the folder, so you are told how many there are first.

When the requirements are right, `/spec-approve` approves them and the agent writes the design; approve that and
it writes the tasks. Nobody asks you to approve: ask for changes, or make them yourself, as many times as you like
first. The agent cannot write a document before you approve the one before it, and if you go back and change one
you approved, the documents after it wait for you again, and the next `/spec-approve` has the agent bring them into
line. What you approved is kept beside the documents, in `approvals.json`.

Once all three are approved, `/spec-run` does the tasks, one at a time. Each one opens a session of its own that
reads the three documents, does that task and stops; the task is then checked off in `tasks.md`, and what it
changed becomes a commit of its own, named after the task. Run it again for the next one, or name one:
`/spec-run 2.1` — or several, `/spec-run 2.1 2.2 3`, which run one after another, each as the one before it is
committed. It will not start while you have changes of your own uncommitted, since a task's commit takes
the whole folder.

None of it has to be typed. In `tasks.md`, point at a task and press the ▶ to its left; select across several and
the line over the list offers to run them as one. That line also chooses the model and effort the tasks run on,
so a spec written by a strong model can be carried out by a cheaper one. The start of the tab row says how far
the tasks have got, and the strip at the foot of the window says which one is running.

What a task came to is read in the window too. Each task ends in a commit of its own, and the foot of the window
counts them — `✓ 5 tasks`, with `· 2 new` beside it when some have finished since you last looked. Press it for
the list, a line a task: a filled circle where the agent said it checked its work (point at it for what it said),
a hollow one where it checked nothing, which is the one to open. A line opens what that task changed — every file
it touched, one after another, the lines taken out in red and the lines put in in green, everything unmodified
folded away until you press it. In `tasks.md` itself, a finished task carries its commit at the end of its line,
and that opens the same page. Nothing about any of this is kept by the app: it is read off the repository's
history, so it is the same in a fresh clone and for a task you ran from the terminal. The checks are the agent's
word, not something Octave ran — read the diff.

To read a file as it is now, ⌘P finds any file in the repository and opens it in a tab, read-only — and from
there, in your own editor at the line you were reading. When every task is done the branch is the pull request: the code and the three documents
together.

**A repository can say how it is worked in.** Octave makes a fresh folder for every spec, and a fresh folder has
only what is committed — no dependencies, no `.env`. Type `/setup` in the agent's column, or press `Set up` at
the foot of the window, and the agent drafts `.octave/config.toml` from what is there: package files, CI, the
README. Read it and fix it; it is a short file, and yours. What goes in it:

- `copy`, the files kept beside the code and out of git — `.env*` unless you say otherwise — brought over
  from the repository's own folder into every new workspace first. A file the branch already has is left alone.
- `setup`, run in every new workspace before it opens — `npm ci`, say. Fails, and the workspace stays on the
  list with what you typed; the dialog says why, and *Run setup again* is in the menu at the foot of the window.
- `[[scripts.check]]`, one per check: run after every task the agent finishes, before its commit, in order.
  Each ends up under the commit as `Verified: unit — exit 0`, and the list at the foot of the window shows a
  tick or a red cross for it, beside the circle that stands for the agent's own word; press the tick or the
  cross and what the check printed opens in a tab. A check that exits 2 stops the commit altogether; any
  other failure is committed and marked, so a failed try is still a record. They run one after another, so
  put the quick ones first and leave the slow ones — a browser suite, say — to your CI on the pull request.
- `[scripts.run.dev]`, a dev server or a watcher: the ▶ at the foot of the window, on a port of the
  workspace's own in `OCTAVE_PORT`. Press it for the menu — every run the file names, to start or stop (one at
  a time in a workspace), open what it serves, read what it printed. A run that ends by itself gets a red
  dot, and its exit code is in the menu.
- `archive`, run just before a workspace is removed.

What each printed is a file in the workspace's `.pi/runs/` folder, and opens in a tab like any file: at its
end, following it while it runs. Octave runs these commands and understands none of them, so any language
and any tool is fine; it only reads the exit code.

## 3. Sign in

With nobody signed in yet, the middle of the window says so and has the button. The agent runs on models from
an account of your own — a ChatGPT or Claude subscription, or an API key. You are signing in to the provider,
not to us: Octave has no account of its own. Accounts are in Settings (`⌘,`) at any time.

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

There are two modes in the tool menu under the message box. *Execution*, where a new conversation starts, lets
the agent change files and run commands — which is what running a spec's task takes, since a task that cannot run
its own tests cannot tell whether it did the job. *Plan* is one click below: reading, searching and listing only,
for asking about a repository before anything is changed.

Octave does not ask before each step, so the mode is the boundary. Drop to *Plan* when you only want to talk.
Reaching the web is a switch of its own beside the modes, off until you turn it on, and both stay where you put
them.

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
