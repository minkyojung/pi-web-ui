# Changelog

All notable changes to Octave are written down here, for the person using it
rather than the person building it. The format is [Keep a Changelog](https://keepachangelog.com/en/2.0.0/);
the versions follow [SemVer](https://semver.org/), and while they begin with 0 anything may change.

## [Unreleased]
### Added
- The sidebar lists your repositories, and under each its workspaces by branch. Click one to move into it; + on a repository makes a new workspace — a folder and a branch of its own, started from the latest on the remote — and moves you into it.
- With no repository yet, Octave opens on a screen that adds one: Open local repository, choose its folder, and its first workspace is made and opened. Folder › Open Repository… (⌘O) does the same from anywhere.
- Clone from GitHub: your repositories are listed to search — signed in with `gh`, private ones too — or give any by owner/name or its address. It is cloned into `~/octave/repos`, and its first workspace is made and opened.
- The + beside Repositories in the sidebar adds another: open a local one, or clone one from GitHub.
- `/spec` and a line of what you want built starts a spec: the agent names the work, writes its requirements to `.octave/specs/<name>/requirements.md`, and stops for you to read them — and a new workspace's branch takes the spec's name.
- `/spec-approve` approves the spec document waiting for you, when you have read it and it is right, and the agent goes on to the next: the design, then the tasks. It never asks — change a document as many times as you like first. The agent cannot write the next document before you approve the one before it, and if you go back and change one you approved, what comes after it waits for you again, brought into line with the change.
- `/spec-run` runs the next task of a spec you have approved. It opens a session of its own, which reads the three documents, does that one task and stops — and then the task is checked off in `tasks.md` and what it changed is committed on its own. Run it again for the task after it, or name one: `/spec-run 2.1`. It will not start while you have changes of your own uncommitted, since a task's commit takes the whole folder.
- A spec's document opens in front of you the moment it is waiting for your approval — the requirements, then the design, then the tasks — whether the agent wrote it here or in the terminal. Close it and it stays closed; the next one to wait opens in its turn.
- The spec you are working on sits at the start of the row of tabs: its name, and what it is waiting for. Its menu holds every spec's three documents and what has become of each, opens any of them, and approves the one waiting for you — the same approval as the command, without typing it.
- A spec document waiting for you says so in a line above it, with the button that approves it. The line goes when you approve, and the next document arrives with its own.
- A spec document no longer carries a note's furniture: no properties to add at its head, and no word count in the strip at the foot.
- ⌘P opens any file in the repository now, not only your notes. Type a few letters of a name and the rest of the repository is offered under Files — the code a task just wrote, a config, a workflow — including files that are not committed yet. What git ignores is left out, so `node_modules` and build folders never appear.
- A file that is not a note opens in a tab of its own, to read: its lines numbered, its language set in a monospace, ⌘F to search it, and words chosen in it asked about like words in a note. It is read-only — the code is the agent's to change, and yours in your own editor.

### Changed
- The agent can change any file in the folder now, notes among them, with its ordinary tools and from the shell. It used to be refused on markdown, which also meant a spec's task could not touch a README or a changelog. Your unsaved typing is still safe: a note open in front of you that changes underneath is shown, and if you have unsaved words in it you are asked which to keep.
- The tool menu has two modes instead of three: **Plan**, which reads and searches only, and **Execution**, which changes files and runs commands. The middle one — editing without a shell — is gone, and a new conversation starts on Execution: running a spec's task means running its tests, and a task that cannot check its own work reports it as done either way. If you were on Coding you are on Execution now; drop to Plan whenever you only want to talk.
- Octave opens where you left off — the workspace you were last in — and works only in repositories now: a folder of notes is no longer opened, and the first run no longer asks for a folder.
- Opening another folder no longer restarts Octave. The folder you left keeps running — a reply the agent was writing there carries on — and going back to it finds your tabs where they were.
- The agent can no longer write git's own files in `.git` with its file tools, which goes around git and can leave a repository broken; it changes the repository with git commands, as before.
- With nothing open, the middle of the window says what there is to do — `/spec` and a line about what to build, then `/spec-approve` and `/spec-run` — where it used to offer to make a note. Before you have signed in anywhere it says that instead, and the button there opens Settings on your accounts.

### Removed
- The Welcome page is gone, and Help › Welcome with it. Its three steps are each somewhere better now: a workspace is made when you add a repository, signing in is said in the middle of the window until you have, and the note of things to try belonged to the app this one no longer is.
- The sidebar no longer lists the folder's notes; it lists your repositories and their workspaces instead. ⌘P still finds a note.
- The folder menu at the foot of the sidebar, and its list of folders opened before, are gone: the repositories and their workspaces are the list now.

### Fixed
- Opened from the Dock or the Finder, the agent's commands now find the tools your terminal finds — Homebrew's, nvm's, your `npm`, `node` and `gh` — where before they found only the system's.

## [0.0.6] - 2026-09-18
### Added
- A PDF in your folder can be talked about: name it in the message by its path, as you would a note, and the agent reads it page by page. A long one it reads in parts, as it does a long file.
- Type `@` in the message box and the PDFs in your folder are offered after the notes, so one can be named without typing its path.
- Drop a PDF on the message box, or paste one, and it is saved in your folder — where your vault keeps attachments if it says, else under `attachments/` — and named in your message, ready to ask about. A file of the same name is never replaced; the new one gets a number.
- The PDFs in your folder are in the sidebar where they are on disk, and in ⌘P. Click one and it opens in a tab, fitted to the column; its words can be selected and copied.
- Select words in a PDF and they show above the message box with their page, as words chosen in a note do; ask, and the agent knows which words and where. With a PDF open and nothing selected, the agent still knows which PDF you mean.
- A link to a PDF works as Obsidian writes it: ⌘-click `[[paper.pdf]]` and it opens, `[[paper.pdf#page=3]]` and it opens at that page. Before, following one made an empty note called `paper.pdf`.
- When the agent asks you to choose, there is a line under the choices to answer in your own words instead.
- Help › Getting Started and Help › What Leaves Your Mac open two short guides: how to begin, what comes over from Obsidian, the keys; and what is sent where, where every file is kept, and how to remove it all.
- The first run opens a Welcome page: your folder and what the agent may do in it, signing in, and a button that writes a welcome note into the folder with five minutes of things to try. Done closes it; Help › Welcome opens it again.
- Type `[^` and the note's footnotes are offered, with what each says, and a new one numbered next whose note is started at the end for you to write. Point at a footnote's number and its note is shown.
- Inside a table, Tab moves to the next cell and Shift-Tab to the one before, Tab from the last cell starts a new row, Enter puts a row under this one, and the pipes are lined up whenever the cursor leaves the table. A click on a drawn table puts the cursor in the cell you clicked.
- Paste a picture into a note, or drop one in, and it is kept in the folder — where Obsidian keeps pictures if the folder is a vault that says, else in `attachments/` — and the note says `![[its name]]` where the cursor was.

### Changed
- A note shown inside another with `![[Note]]` keeps up: when that note changes — in another tab, by the agent, or outside Octave — the card is redrawn, where before it kept the old words until the note holding it was reopened. A click on the card's text puts the cursor on its line and brings the markup back.
- A question from the agent comes up where the message box is, and the box comes back — with whatever you had typed or pasted in it — once you answer or close the question. Take a choice with a number key or a click and send it with Enter, so you can change your mind before it goes; Esc closes the question without answering. A question in several parts asks one at a time, with a way back, and while the agent is running the question has the button to stop it.
- The two search tools the agent uses to find things in your notes come inside the app now. Before, on a Mac without them, the agent downloaded them from GitHub the first time it searched; nothing is downloaded any more, and searching works offline.

### Fixed
- A question from the agent could not be seen or answered while the raw view was open.
- A question arriving while you were typing in a note could take the keyboard away from the note. It now leaves the keys where you are writing, and the strip at the foot of the window says the agent is waiting.

## [0.0.5] - 2026-09-18
### Added
- The HTML a note may hold is drawn: `<u>`, `<sub>`, `<sup>`, `<kbd>`, `<mark>` and their like around words, `<br>` for a line broken by hand, `<img>` with a width, and a `<details>` block — from a short list, with no script run and no style applied. Anything not on the list is left as written.
- `H~2~O` and `x^2^` sit below and above the line, their marks hidden off the cursor.
- Math is set as math: `$x^2$` in a line and a `$$` block on lines of its own, the way Obsidian writes them; the source comes back when the cursor is in it.
- Another note embedded with `![[Note]]` is shown in place, as a card with its text — or the section under a heading with `![[Note#Heading]]`, or one block with `![[Note#^id]]`. The card's title opens the note. A note that is not there says so.
- A table is drawn as a table, with its columns sitting as the `:--` and `--:` say; the pipes come back when the cursor is in it, or when you click it.
- Footnotes: `[^1]` in the text is a small number, the note it points to is labelled with the same, and a click on either goes to the other.
- Pictures in a note are shown as pictures: `![[photo.png]]` and `![[photo.png|300]]` as Obsidian writes them, `![alt](images/photo.png)`, and a picture on the web. A picture named alone is found wherever it is in the folder, as Obsidian finds it. On the cursor's line the markup shows, as with everything else.

## [0.0.4] - 2026-09-18
### Added
- Settings has an About: the version you are on, a Check for Updates button, and one line saying what came of it — the latest already, a download under way, a version ready to restart into, or that it could not check right now. Octave › Check for Updates… opens it.
- The first time a new version runs, a tab opens with what changed in it, in the words of the release notes; Help › What's New opens it again any time.

### Changed
- A new version, once it is downloaded, is offered in the corner of the window rather than in a box over your work: Restart takes it, and while the agent is working the button waits for it to finish first. Wave the offer away and a dot on the settings button keeps it; quitting installs the new version on the way out.

## [0.0.3] - 2026-09-18
### Changed
- On a Mac the agent is no longer offered PowerShell, which is not there to run: a call to it could only fail. It is gone from the tool menu too.
- Opening another note or choosing other words before you ask no longer makes the provider read the whole conversation afresh: what was said before stays cached, so a reply in a long conversation starts sooner and costs less.
- The agent is told it is someone you think with and who gets things done for you, rather than a programmer: when you are thinking something through it thinks with you and asks, when you want something done it does it and says what it did, and a change you did not ask for it suggests instead of making. A SYSTEM.md you gave pi still takes the place of this.

## [0.0.2] - 2026-09-18
### Added
- Help › Report a Problem… opens the folder Octave keeps its log in, and a form on GitHub with your Octave and macOS versions already filled in. Nothing is sent by the app: the log is yours to read and to drag in. Help › Show Log in Finder goes to the log alone.

## [0.0.1] - 2026-09-17

The first release. Octave is a notes app for the Mac with an agent that works in the same notes you do.

### Added
- Your notes are markdown files in a folder you choose. There is no account, no server and no database: Octave is a window onto the folder, and anything else that edits those files is welcome to.
- An agent sits beside the note and reads and writes the same files. Ask it about the note you are in, about words you have selected, or about the whole folder; type `@` to point it at a note and `/` for its commands.
- What the agent writes in a note stays a suggestion until you decide: each change is shown against what it replaced, with Keep and Undo, for as long as you leave it — days, if you like. Everything one run changed can be put back in one go.
- Every word keeps its author. A switch shows which words are yours, which the agent wrote, and which arrived from outside Octave; click the agent's words to see which model wrote them and what it was asked. Cut and paste keeps the author with the words.
- The agent starts careful. A new conversation can read and edit notes but cannot run shell commands or reach the web; Full access and Web access are one step away in the tool menu, and stay where you put them.
- Sign in inside the app, in Settings → Accounts: a subscription account or an API key, for the provider you choose. Your notes go to that provider when you ask the agent something, and nowhere else.
- Links between notes, tags, and properties at the top of a note, in the shapes Obsidian uses — a folder of notes made there opens here as it is. Two things such a folder will miss for now: images inside notes are not shown, and neither is the list of notes that link to the one you are in.
- Tabs, back and forward, find in a note, find across the folder, open a note by a few letters of its name, and a bin that deleted notes come back from.
- Conversations are kept, named, and can be forked from any question, cloned, or exported.
- Light and dark themes.
- A signed, notarized disk image for Apple Silicon Macs. Octave updates itself: a new version is downloaded in the background and offered, with its notes, when it is ready.
- Octave is free software under the AGPL-3.0; the licences of everything it is built on ship inside it.

[Unreleased]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.6...HEAD
[0.0.6]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/minkyojung/pi-web-ui/releases/tag/v0.0.1
