# pi-web-ui

A minimal web UI over the pi coding agent.

## Run

```bash
npm install
npm run dev            # http://localhost:3000
MODEL=anthropic/claude-opus-4-8 npm run dev
```

Auth comes from `~/.pi/agent/auth.json` (`pi` → `/login`). Sessions are written
to `~/.pi/agent/sessions/` and survive a restart.

```bash
npm test          # replays recorded pi sessions, offline
npm run typecheck
```

## Status: step 5 — one reducer, tested

The browser shows the conversation: user messages, streamed assistant text,
tool calls with their results, errors, and a completion marker. Everything else
is dropped. The `raw` checkbox still shows every event, which is the only way to debug when
the rendered view is wrong. Events go out in the same shape pi's own print and
rpc modes use: a `message_update` carries its delta, not the two full copies of
the in-flight message it also ships as `message` and `assistantMessageEvent.partial`.

`conversation.js` holds the rules for turning a pi session into conversation
items, and both the browser and the server import it. It used to exist twice —
`apply()` in the client for live events, `snapshot()` in the server for resumed
ones — and the two had drifted in four ways: an unusual tool result rendered as
JSON live and as blank on resume; the server emitted the raw `400 {json}`
envelope and relied on the client to unwrap it; empty user messages were kept
by one path and skipped by the other; and a reply that called a tool before
speaking came out in opposite orders. None showed on the happy path, which is
what made them worth removing rather than fixing twice.

`applyEvent` returns the items it added and changed so a renderer can stay
incremental without diffing; a caller that re-renders wholesale can ignore it
and read `state.items`.

Rendering is incremental: each conversation item owns its DOM node, deltas mark
only that item dirty, and updates are flushed once per animation frame. The raw
view keeps the last 300 events. Rebuilding everything per event cost 63ms for
the first turn and 534ms by the twelfth; it is now flat at ~42ms.

The settings bar exposes three controls, all applied to the live session:

- **Model** — any model with usable credentials, grouped by provider. Switching
  is live; `MODEL=` only sets the starting point. Thinking level is clamped to
  the new model, which the config broadcast reflects.
- **Tools** — which of the session's tools the agent may call. Checking only
  `read` genuinely prevents shell execution; the model says so and calls
  nothing. Takes effect on the next turn, not the one in flight.
- **Thinking** — only the levels the current model supports. `setThinkingLevel`
  clamps rather than rejects, so the server validates the value first;
  otherwise an unknown level silently becomes `off`.
- **Stop** — `abort()`. Enabled only while streaming.

Sessions are owned by an `AgentSessionRuntime`, since `/new` and `/resume`
replace the `AgentSession` object rather than mutating it. Every read goes
through `runtime.session`, and the event subscription is rebound after each
replacement. A resumed session emits no events for its history, so the server
sends a `snapshot` — the conversation rebuilt from `session.messages` through
`itemsFromMessages`. An unsaved session has no
file yet and would be missing from the picker, so it appears as a placeholder
entry.

Messages sent while a run is in progress are queued as either `steer` or
`followUp`, chosen next to the input. Steering is delivered at the next turn
boundary — after the current turn's tool calls, before the next model call —
so it cuts a tool-using run short but cannot interrupt a single long
generation. Follow-ups wait for the run to finish. The pending count comes
from `queue_update`.

A `usage` message carries `getSessionStats()` and `getContextUsage()`: accrued
cost, token breakdown, and how full the context window is. Sent on connect and
after every completed message, since spend is otherwise invisible.

The server owns this state and broadcasts a `config` message on connect and
after every change, so multiple tabs stay in sync.

### Events observed

A turn with a tool call produces, in order:

```
agent_start → turn_start
  message_start / message_end                    (user message)
  message_start
    message_update.thinking_start / thinking_end
    message_update.text_start / text_delta / text_end
    message_update.toolcall_start / toolcall_delta / toolcall_end
  message_end
  tool_execution_start / tool_execution_update / tool_execution_end
turn_end → agent_end → agent_settled
```

Notes:

- Assistant text lives at `event.assistantMessageEvent.delta`, not `event.delta`.
- `agent_settled` is the completion signal. `agent_end` carries `willRetry` and
  may be followed by more work.
- Provider failures (billing, rate limits) do **not** throw from `prompt()`.
  They arrive as a message with `stopReason: "error"` and an `errorMessage`,
  so a UI that ignores them looks silently stuck.

## Tests

`npm test` (Node's built-in runner, no dependencies) replays two recordings of
real pi sessions from `test/fixtures/`: a turn with two tool calls, and a
provider billing failure. Recordings are committed verbatim rather than
trimmed, so the tests can only pass on shapes pi actually emits.

The load-bearing test is the equivalence one: `agent_end` carries the run's
messages, so a single recording holds both inputs to the live/resumed contract,
and asserting the two produce the same items is what keeps them from drifting
again.

`npm run record <out.json> "<prompt>"` refreshes a fixture against a live
session. It spends real tokens, so it is manual and never part of `npm test`.
Re-record only when a pi upgrade actually breaks a test — a stale fixture that
still passes is evidence the contract held.

The DOM layer is deliberately untested: it is about to be replaced by a React
client, and its tests would be replaced with it.
