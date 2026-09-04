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

## Status: step 2 — rendered conversation

The browser shows the conversation: user messages, streamed assistant text,
tool calls with their results, errors, and a completion marker. Everything else
is dropped. The `raw` checkbox still shows every event verbatim, which is the
only way to debug when the rendered view is wrong.

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
