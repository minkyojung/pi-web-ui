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

## Status: step 4 — sessions

The browser shows the conversation: user messages, streamed assistant text,
tool calls with their results, errors, and a completion marker. Everything else
is dropped. The `raw` checkbox still shows every event verbatim, which is the
only way to debug when the rendered view is wrong.

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
sends a `snapshot` — the conversation rebuilt from `session.messages` into the
same item shape the client builds from live events. An unsaved session has no
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
