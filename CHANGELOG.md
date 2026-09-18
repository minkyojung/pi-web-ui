# Changelog

All notable changes to Octave are written down here, for the person using it
rather than the person building it. The format is [Keep a Changelog](https://keepachangelog.com/en/2.0.0/);
the versions follow [SemVer](https://semver.org/), and while they begin with 0 anything may change.

## [Unreleased]
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

[Unreleased]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.5...HEAD
[0.0.5]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/minkyojung/pi-web-ui/releases/tag/v0.0.1
