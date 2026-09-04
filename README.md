# pi-web-ui

A minimal web UI over the pi coding agent.

## Run

```bash
npm install
npm run dev            # http://localhost:3000
MODEL=anthropic/claude-opus-4-8 npm run dev
```

Auth comes from `~/.pi/agent/auth.json` (`pi` → `/login`). Sessions are
in-memory, so nothing is written to `~/.pi/agent/sessions/`.

## Status: step 3 — settings

The browser shows the conversation: user messages, streamed assistant text,
tool calls with their results, errors, and a completion marker. Everything else
is dropped. The `raw` checkbox still shows every event verbatim, which is the
only way to debug when the rendered view is wrong.

The settings bar exposes three controls, all applied to the live session:

- **Tools** — which of the session's tools the agent may call. Checking only
  `read` genuinely prevents shell execution; the model says so and calls
  nothing. Takes effect on the next turn, not the one in flight.
- **Thinking** — only the levels the current model supports. `setThinkingLevel`
  clamps rather than rejects, so the server validates the value first;
  otherwise an unknown level silently becomes `off`.
- **Stop** — `abort()`. Enabled only while streaming.

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
