# Changelog

All notable changes to Octave are written down here, for the person using it
rather than the person building it. The format is [Keep a Changelog](https://keepachangelog.com/en/2.0.0/);
the versions follow [SemVer](https://semver.org/), and while they begin with 0 anything may change.

## [Unreleased]
### Added
- Octave has an icon of its own in the Dock and in Finder, in place of Electron's.
- The extensions installed for your pi terminal load here too — their tools and commands appear as they do there. A switch in Settings › Agent turns this off; it applies from the next session. An extension that brings its own ask_user or note tool does not replace Octave's, and says so in the conversation.
- Settings › Agent has a "pi" section: switch automatic compaction off or on, whether the agent retries a failed call on its own, whether the model's thinking is shown in the conversation, and whether stepping between answers asks to summarize first. The card that asks has "No summary, don't ask again" too. And a switch to let the agent read this folder's own `.pi/` (its skills, prompts, settings), remembered where pi's terminal keeps its `/trust` answer.
- The context card counts what the agent read in — skills, prompt templates, context files — with a Reload button for what was added since the session began. It is pi's own setting, so the terminal sees the same value; the two thresholds are shown there with where to change them.
- The context card can compact the conversation now, before it fills up and the agent does it on its own.
- A session other than the open one can be deleted from the session list; it goes to the bin where there is one.
- Hover a question and fork: a new session that begins there, with the question back in the box to send or change.
- Clone the conversation from the ⋯ menu: a new session with everything so far copied in, the original left as it is.
- Export the conversation as HTML or JSONL from the ⋯ menu; the file goes under the folder's `.pi/exports`.
- Stepping to another answer with the arrows asks whether to keep a summary of the one you are leaving. pi's `branchSummary.skipPrompt` setting stops the asking.
- Paste an image into the message box and it goes to the agent with your words. It shows above the box until you send, with an × to take it out.
- Type `@` anywhere in the message box and your notes are listed; pick one and its path goes in, so the agent knows which note you mean.
- Type `/` in the message box and the commands the agent can run are listed — the web search extension's, your prompt templates, your skills. Up and down choose, Enter fills it in, Enter again sends. A command an extension runs can ask you something, and it comes up as the same card the agent's questions do.


### Changed
- Under the note, the strip at the foot of the window keeps two things: how much of the note the agent wrote, and how long it is. The note's tags and the count of notes that link to it are gone from there.
- With the agent's column folded away, its half of the strip at the foot of the window folds into the context ring alone, and the ring says what the agent is doing: an arc travels round it while the agent works, an amber dot means it is waiting for your answer, a blue dot means a run finished while you were not looking and stays until you have actually seen how it ended — the column open and scrolled to the bottom, with the app in front, and a dashed ring means the window is offline. Point at the ring and it opens out into the full line; click it and the column comes back. With reduced motion on, the travelling arc stays put and fades in and out instead.
- While the agent is working, the button you send with is still there and still sends: the message waits in the queue until the run ends, which is what Enter always did. Hold ⌘ as you press it — or press ⌘↵ — and it cuts the run short instead. Stopping the run is a button of its own now, beside the one you send with. Hovering either button says what it will do — a screen reader is told the same — so the row no longer carries a line of keyboard hints.
- The window calls it "the agent" now rather than "pi": the message box, the button and shortcut that show and hide its column, the tool menu, the shortcuts in Settings, the card that says who wrote a passage. pi is still what runs underneath, and the record it keeps is still in `.pi/` — this is what the window says on screen.
- The note's half of that strip is quieter. A note that has reached the disk no longer says so — "Saving", "Not saved" and "Not on disk" are the only words left, and they are the ones worth seeing. The count of notes filed under the same tags has gone too: pressing a tag in the strip already lists the notes that carry it, which is the same list by the tag it is about. How much of a note the agent wrote is now said as "agent".
- The strip at the foot of the window is divided where the window is: what is about the note stays under the note, and under the agent there is now what it is doing — a spinner and the step it is on, the tool it reached for and what it touched, or that it is thinking — so a run can be watched without looking away from what you are writing. The tool mode and the context ring moved down there too, out of the row under the message box. Drag the divider and the strip follows it.
- Once the agent has answered, the steps it took getting there — what it thought, which tools it reached for — fold into one line saying how many tools it used and how many times it went out and came back, and whether any of it failed. Click the line to read the steps again. While the agent is still working they stay open, so you can watch.
- The path above a note stays one short line however deep the note is or how long its folders are named: the outermost folder, a "…" for anything between, and the folder it is in, each cut to a width with the whole name on hover. Clicking "…" lists the folders it stands for.
- Settings, skills or a SYSTEM.md in the note folder's own `.pi/` are read by the agent only if pi's terminal was told to trust the folder; until then the context card says they were left out. Before, they were read without asking.
- Anything the agent had to complain about while setting up a session — an extension that failed, an option it did not know — now shows in the conversation instead of nowhere.
- A message one of the agent's extensions posts to the conversation is shown as a notice, live and after resuming; before, it was dropped. So is the summary the agent leaves when a branch is left.
- A message that starts with `/` is sent to the agent as written. Before, the agent read it as one of its commands and ran or rewrote it without saying so.
- Cutting words and pasting them elsewhere — in the same note or another — keeps who wrote them. Before, the words became yours the moment you pasted them.
- The agent can no longer change a note from a terminal command: the system refuses the write, and the agent is told to use its note tools instead — so everything the agent writes in a note is recorded as the agent's, and nothing you write is ever mistaken for the agent's.
- With no provider signed in, the app opens instead of quitting with an error box; the model picker says so until you sign in.
- The app is called Octave.
- Octave's own settings and log moved from `~/.pi/web-ui/` to `~/.octave/`. What pi keeps — credentials, sessions — stays under `~/.pi/`.
- A fresh install opens the agent on Coding — reading, searching and editing files, but no shell. Full access is one step up in the tool menu, and is remembered once chosen.
- The dark theme sits one step lighter: the page you write on, the frame round it and what is raised off it all moved together, so nothing else about it changed.
- Extensions installed in your own pi (`~/.pi/agent`) are no longer loaded into Octave's sessions; the agent's built-in tools and Octave's own are what the agent has here.
- The note's text is a point larger, 16px instead of 15px.
- The agent's conversation sits on a panel of its own beside the note, inset from the note's page on every side — a shade lighter than the note in the dark themes, a shade darker in the light ones — so where the writing stops and the conversation starts is plain to see.
- The notes in the sidebar are a quieter grey until you point at one or open it, so the note you are in is the one that stands out.
- Narrowing the agent's column no longer leaves the row under the message box overlapping itself. It gives things up in order instead: the model's name shortens. Everything comes back as you widen it.
- The model the agent will answer with sits in the row under the message box with no rim or floor of its own, and how hard it thinks sits a shade quieter beside its name — the two used to be the same grey.

### Added
- Pressing a folder in the path above a note shows what is in it — the notes beside the one you are reading, and the folders inside it — and picking one opens it, without a trip to the list on the left. Type to narrow it; the last item still shows the folder on the left.
- Web access is a switch of its own in the tool menu, under the three modes: the agent searches and reads the web in every mode, and turning it off turns off all four web tools at once — and keeps them off when you change mode.
- The agent can search the web and read a page from it, without your setting anything up: it searches through the provider you are already signed in to, and can pull a page, a PDF, a GitHub repository or a YouTube transcript into the conversation. To use another search provider, or a key of your own, put it in `~/.pi/agent/web-search.json`.
- Sign in to a provider inside the app: Settings → Accounts, first in the list, also reached from the bottom of the model picker. An account (Anthropic, by subscription) and an API key are shown as the two different things they are — an account is signed in and out of, a key shows its last four characters and is replaced or removed. Anthropic by account or key, OpenAI by key, and the rest of the providers behind "more". Keys are kept by pi, where the terminal pi finds them too. On a first run with nobody signed in, Accounts opens by itself.
- A run of the agent's that wrote in your notes can be put back in one go, from the line under the run — every note it changed goes back to how it was, keeping what you have already accepted and anything you typed since.
- If your notes folder is a git repository, Octave now writes a `.gitignore` inside its own `.pi/` folder so that who-wrote-what travels with your notes and its caches and trash do not. Written once; edit it and it stays edited.
- Octave ships as a signed, notarized disk image for Apple Silicon Macs: download, open, drag to Applications, no warnings.
- Octave updates itself: a new version is downloaded in the background and offered, with its notes, when it is ready. "Check for Updates…" is in the Octave menu.
- The licence (AGPL-3.0) and the notices of everything the app is built on ship inside it.
- The list of notes folds away, by the button next to the traffic lights or with ⌘B, and the note takes the room it leaves. The way back and forward keep the list's edge while there is a list, and close up beside the fold button when there is not.
- A note fills the page it is on, so the space under the last line is part of the note: click it and the cursor goes to the end, instead of holding Enter until the file has the blank lines to reach down there. The room that used to sit under the text is gone with it.
- A strip across the foot of the window says whether the note you are looking at has reached the disk. It is the same height whatever it has to say, so nothing above it moves.
- The strip counts the note as you write it. Press the count to be told in characters instead, and again for words. It counts what you wrote, not the properties above it.
- The strip says the note's own tags, whether you wrote them in the note or filed them in its properties. Press one to see the other notes that carry it.
- The notes that link here, and the ones that share a tag, moved out of the page and into the strip as counts. Press a count for the list; take one and it opens.
- The strip says how much of a note somebody other than you wrote — the agent's share and anything written outside Octave, counted apart. A note that is all yours says nothing.

### Fixed
- Your loadout and the mode new sessions open on are no longer lost when Octave's settings moved to `~/.octave`: what you chose where they were kept before is brought over the first time, instead of starting again from the defaults.
- A model in the loadout that can't be reached right now — its provider signed out, say — keeps its place, marked "Not available", instead of being dropped from the loadout the next time you change it.
- A setting changed in one window shows in any other window's Settings straight away, and changing a setting there no longer puts back what another window had just changed. A setting that couldn't be saved goes back to what it was, with a note saying so, instead of looking saved.
- A conversation is no longer given a name like "Naming the Chat" or "Note Title Style". While there is nothing to name it by yet — a greeting, a message that says nothing — it keeps showing your first message, and it gets a name, in the language you wrote in, once there is something to call it. A bad name it was already given stays until you rename it or clear it with the pencil.
- The × that takes a tag off a note is the size of the tag again, so the chip keeps its shape when the properties are open.

[Unreleased]: https://github.com/minkyojung/pi-web-ui/compare/reader-v1...HEAD
