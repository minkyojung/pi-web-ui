# What leaves your Mac, and where things are kept

This is about the Octave app. Octave has no account, no server of ours, and sends nothing about you or how you
use it. There is no telemetry and no crash reporting.

## What leaves this machine

| When | Where | What |
|---|---|---|
| You send the agent a message | The model provider you signed in to, and nobody else | Your message, the conversation so far, and whatever the agent read to answer — which can be the text of your notes |
| The agent reads a PDF | The same provider | The text of the pages it read. The text is taken out of the PDF on your Mac; the file itself is not sent anywhere, and no conversion service is used |
| The agent uses Web access (a switch in the tool menu, **off** until you turn it on) | The same provider, which runs the search; then the pages the agent opens | The search words, and requests for those pages |
| A note shows a picture from the web | The site the picture is on | A request for that picture |
| Octave starts, and every four hours after | GitHub Releases (`github.com/minkyojung/pi-web-ui`) | A request for the latest version number; then the update itself, if there is one |
| The model list is refreshed | The provider you signed in to | A request for the models it offers |
| You add a repository from GitHub | GitHub — through `gh` if you are signed in to it, else git | A request for the list of your repositories, and the clone of the one you choose |
| A workspace is made | The repository's own remote (`origin`), and GitHub through `gh` | A fetch of its latest commits, and a request for your GitHub user name, which begins the workspace's branch name |
| You choose Help › Report a Problem… | GitHub, in your browser | Only what you type and attach yourself. The app sends nothing |

The agent's file-search tools (`rg` and `fd`) are inside the app; nothing is downloaded to run them.

Signing up on octave.run is a separate thing from the app: the website keeps your GitHub profile and email
(see [its privacy policy](https://www.octave.run/privacy)); the app never asks who you are and the two are not
connected.

## Where things are kept

| Where | What | Made by |
|---|---|---|
| `~/octave/repos/` | The repositories you cloned from GitHub | Octave, with git |
| `~/octave/workspaces/<repository>/<city>/` | Each workspace: a git worktree of its repository, on a branch of its own. What the agent writes goes here, never into your own clone | Octave, with git |
| Your folder | Your notes, as markdown files, and the pictures and PDFs you paste or drop (where your vault keeps attachments, else `attachments/`). The app is a window onto them | you, and the agent |
| `<folder>/.pi/history/` | Who wrote which words, one log per note. **The one thing that cannot be rebuilt** — it travels with the notes | Octave |
| `<folder>/.pi/properties.json` | The property types you chose | Octave |
| `<folder>/.pi/links.json`, `*.snapshot.json` | Caches; safe to delete, rebuilt on their own | Octave |
| `<folder>/.pi/trash/` | Notes you deleted where the system trash was not available, and the logs of deleted notes | Octave |
| `<folder>/.pi/exports/` | Conversations you exported | Octave |
| `~/.pi/agent/` | pi's own: your sign-in (`auth.json`), sessions, settings. Shared with `pi` in a terminal if you use it | pi |
| `~/.octave/` | Octave's settings, and its log (`logs/server.log`) | Octave |
| `~/Library/Application Support/Octave/` | Your repositories and their workspaces, the one you were in last, and which version's What's New you have seen | Octave |

## Removing it

Dragging Octave to the Trash removes the app and nothing else. To remove the rest: `~/.octave/` and
`~/Library/Application Support/Octave/` are Octave's alone. `~/.pi/agent/` is pi's — leave it if you use `pi` in
a terminal. `.pi/` inside your notes folder holds who-wrote-what; delete it and the notes are untouched, but
that record is gone for good. `~/octave/` holds your clones and workspaces, which are git's: a workspace's
branch may hold work that was never pushed, so look before deleting one, and after deleting its folder run
`git worktree prune` in its repository.
