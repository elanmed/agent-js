# Architecture

A single loop drives the whole agent: ask for input, act on it, print the result, repeat.

```text
loop forever
    input = resolveUserInput()      // may return null
    if input is null: continue      // nothing happened, try again
    if input is "":  warn "empty input"; continue

    text = resolveApiCall(input)    // may return null
    if text is null: continue       // call was interrupted, nothing to print

    print(text)
```

## null and "" as signals

- `null` means "this turn produced nothing" — the loop silently continues.
  User input returns `null` when the prompt was aborted (Ctrl-C), a slash command had no message, or the editor produced no content.
  The API call returns `null` when the stream was interrupted or no text came back.
- `""` means "the user explicitly sent an empty line" — a real event that gets a warning, then the loop continues.

## Abort controllers

Two controllers live in state, set around the two blocking waits:

| Controller  | Covers                 | Who aborts it                                      | Result                                     |
| ----------- | ---------------------- | -------------------------------------------------- | ------------------------------------------ |
| `question`  | the readline prompt    | editor keymap (Ctrl-G), or Ctrl-C on an empty line | aborted prompt → editor input or exit path |
| `apiStream` | the streaming API call | Ctrl-C while streaming                             | aborted stream → discard output            |

- Ctrl-C is routed by priority: if `apiStream` is active, it aborts the stream; otherwise it acts on the `question` (clear a non-empty line, or exit).
- Some aborts are detected indirectly: the editor keymap aborts the prompt as a _side effect_ of stashing editor input in state, so the loop knows to read from the editor instead of the prompt.

The loop itself only branches on return values; all routing between prompt, editor queue, slash commands, and exit lives inside `resolveUserInput`.
