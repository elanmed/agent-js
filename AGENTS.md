# agent-js

A minimal CLI agent built on the Anthropic SDK. Runs an interactive readline loop, streams Claude responses, and supports tool use for bash execution and file manipulation.

## Source Layout

```
src/
  index.ts   - Entry point: readline loop, API call orchestration, tool use loop
  state.ts   - Redux-style state management (dispatch/actions/selectors)
  config.ts  - Config loading and validation with zod
  tools.ts   - Tool schemas and execution
  utils.ts   - Helpers: logging, cost calculation, AGENTS.md discovery
```

## Tools

- `bash` — Execute bash commands
- `create_file` — Create new files
- `view_file` — View file contents or list directories
- `str_replace` — Replace exact strings in files
- `insert_lines` — Insert text after a specific line

## Commands

```bash
bun start           # Run the agent
bun run start:debug # Run with debug logging
bun test            # Run tests
bun run types       # Type-check
bun run lint        # Lint
bun run format      # Format
```

## Slash Commands

Slash commands are loaded from `.agent-js/commands/<name>.md`. Entering `/name` sends that file's contents to Claude as a prompt.

## Configuration

Merged from global (`~/.config/agent-js/.agent-js/settings.json`) and local (`.agent-js/settings.json`), with local taking precedence.

```json
{
  "model": "claude-opus-4-6" | "claude-sonnet-4-6" | "claude-haiku-4-5",
  "disableCostMessage": false,
  "pricingPerModel": { ... }
}
```

Pricing values are in USD per million tokens.

## Environment Variables

| Variable              | Effect                                  |
| --------------------- | --------------------------------------- |
| `ANTHROPIC_API_KEY`   | Required — passed to the Anthropic SDK  |
| `AGENT_JS_DEBUG=true` | Enables verbose debug logging           |

## TypeScript & Testing

Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.) — all must pass via `bun run types`.

Tests use Node's built-in test runner, colocated as `*.test.ts`. No external test framework.
