# Changelog

All notable changes to Octave are written down here, for the person using it
rather than the person building it. The format is [Keep a Changelog](https://keepachangelog.com/en/2.0.0/);
the versions follow [SemVer](https://semver.org/), and while they begin with 0 anything may change.

## [Unreleased]

### Changed
- Cutting words and pasting them elsewhere — in the same note or another — keeps who wrote them. Before, the words became yours the moment you pasted them.
- pi can no longer change a note from a terminal command: the system refuses the write, and pi is told to use its note tools instead — so everything pi writes in a note is recorded as pi's, and nothing you write is ever mistaken for pi's.
- With no provider signed in, the app opens instead of quitting with an error box; the model picker says so until you sign in.
- The app is called Octave. The agent at the table is still pi.
- Octave's own settings and log moved from `~/.pi/web-ui/` to `~/.octave/`. What pi keeps — credentials, sessions — stays under `~/.pi/`.
- A fresh install opens pi on Coding — reading, searching and editing files, but no shell. Full access is one step up in the tool menu, and is remembered once chosen.
- The dark theme sits one step lighter: the page you write on, the frame round it and what is raised off it all moved together, so nothing else about it changed.
- Extensions installed in your own pi (`~/.pi/agent`) are no longer loaded into Octave's sessions; pi's built-in tools and Octave's own are what pi has here.
- The note's text is a point larger, 16px instead of 15px.
- pi's conversation sits on a panel of its own beside the note, inset from the note's page on every side — a shade lighter than the note in the dark themes, a shade darker in the light ones — so where the writing stops and the conversation starts is plain to see.
- The notes in the sidebar are a quieter grey until you point at one or open it, so the note you are in is the one that stands out.
- Narrowing pi's column no longer leaves the row under the message box overlapping itself. It gives things up in order instead: the keyboard hint first, then the tool mode's name — its icon stays, and the tooltip still says which mode — then the model's name shortens, and last of all the context ring. Everything comes back as you widen it.
- The model pi will answer with has a rim and a floor of its own under the message box, so the choice you make most often is the one the row points at, and how hard it thinks sits a shade quieter beside its name — the two used to be the same grey.

### Added
- pi can search the web and read a page from it, without your setting anything up: it searches through the provider you are already signed in to, and can pull a page, a PDF, a GitHub repository or a YouTube transcript into the conversation. To use another search provider, or a key of your own, put it in `~/.pi/agent/web-search.json`.
- Sign in to a provider inside the app: Settings → Accounts, first in the list, also reached from the bottom of the model picker. An account (Anthropic, by subscription) and an API key are shown as the two different things they are — an account is signed in and out of, a key shows its last four characters and is replaced or removed. Anthropic by account or key, OpenAI by key, and the rest of pi's providers behind "more". Keys are kept by pi, where the terminal pi finds them too. On a first run with nobody signed in, Accounts opens by itself.
- A run of pi's that wrote in your notes can be put back in one go, from the line under the run — every note it changed goes back to how it was, keeping what you have already accepted and anything you typed since.
- If your notes folder is a git repository, Octave now writes a `.gitignore` inside its own `.pi/` folder so that who-wrote-what travels with your notes and its caches and trash do not. Written once; edit it and it stays edited.
- Octave ships as a signed, notarized disk image for Apple Silicon Macs: download, open, drag to Applications, no warnings.
- Octave updates itself: a new version is downloaded in the background and offered, with its notes, when it is ready. "Check for Updates…" is in the Octave menu.
- The licence (AGPL-3.0) and the notices of everything the app is built on ship inside it.
- The list of notes folds away, by the button next to the traffic lights or with ⌘B, and the note takes the room it leaves. The way back and forward keep the list's edge while there is a list, and close up beside the fold button when there is not.
- A note fills the page it is on, so the space under the last line is part of the note: click it and the cursor goes to the end, instead of holding Enter until the file has the blank lines to reach down there. The room that used to sit under the text is gone with it.
- A strip across the foot of the window says whether the note you are looking at has reached the disk. It is the same height whatever it has to say, so nothing above it moves.
- The strip counts the note as you write it. Press the count to be told in characters instead, and again for words. It counts what you wrote, not the properties above it.

### Fixed
- The × that takes a tag off a note is the size of the tag again, so the chip keeps its shape when the properties are open.

[Unreleased]: https://github.com/minkyojung/pi-web-ui/compare/reader-v1...HEAD
