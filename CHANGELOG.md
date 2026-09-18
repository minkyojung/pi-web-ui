# Changelog

All notable changes to Octave are written down here, for the person using it
rather than the person building it. The format is [Keep a Changelog](https://keepachangelog.com/en/2.0.0/);
the versions follow [SemVer](https://semver.org/), and while they begin with 0 anything may change.

## [Unreleased]
### Added
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

[Unreleased]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/minkyojung/pi-web-ui/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/minkyojung/pi-web-ui/releases/tag/v0.0.1
