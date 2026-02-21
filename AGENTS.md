# agent-js

A minimal CLI agent built on the Anthropic SDK. It runs an interactive readline loop, streams responses from Claude, and supports tool use for bash execution, file manipulation, and code editing.

## Architecture

```
src/
  index.ts   - Entry point: readline loop, API call orchestration, tool use loop
  state.ts   - Redux-style state management (dispatch/actions/selectors)
  config.ts  - Config loading and validation with zod
  tools.ts   - Tool schemas and execution (bash, file, and code editing tools)
  utils.ts   - Helpers: logging, cost calculation, AGENTS.md discovery
```

**State** is a plain object managed via `dispatch(action)` — no external state library. Config is loaded once at startup and merged into state.

**Tool use loop**: after each API response, if `stop_reason === "tool_use"`, tool calls are executed and results are fed back to the API, repeating until the model stops.

**Supported tools**:

- `bash` — Execute bash commands
- `create_file` — Create new files with content
- `view_file` — View file contents (with line numbers) or list directories
- `str_replace` — Replace exact strings in files
- `insert_lines` — Insert text after a specific line in a file

**AGENTS.md discovery**: `getRecursiveAgentsMdFilesStr()` walks up from the cwd and appends any `AGENTS.md` files found into the system prompt.

## Commands

```bash
# Run the agent
npm start

# Run with debug logging (prints model, token counts, dispatched actions, etc.)
npm run start:debug

# Run tests
npm test

# Type-check (no emit)
npm run types

# Lint
npm run lint

# Format
npm run format
```

## Slash Commands

Slash commands are dynamically loaded from markdown files in `.agent-js/commands/`. When you enter `/commandname`, the agent reads `.agent-js/commands/commandname.md` and passes its instructions to Claude as a prompt.

TypeScript is run directly via Node's native `.ts` support (`node src/index.ts`) — there is no build step.

## Configuration

Settings are loaded from two locations and merged (local takes precedence):

| Path                                         | Purpose                                     |
| -------------------------------------------- | ------------------------------------------- |
| `~/.config/agent-js/.agent-js/settings.json` | Global (created with defaults on first run) |
| `./agent-js/settings.json`                   | Local (project-level overrides)             |

**Config schema** (all fields optional):

```json
{
  "model": "claude-opus-4-6" | "claude-sonnet-4-6" | "claude-haiku-4-5",
  "disableCostMessage": false,
  "pricingPerModel": {
    "claude-opus-4-6":   { "inputPerToken": 5,  "outputPerToken": 25, "cacheWrite5mPerToken": 6.25, "cacheWrite1hPerToken": 10, "cacheReadPerToken": 0.5 },
    "claude-sonnet-4-6": { "inputPerToken": 3,  "outputPerToken": 15, "cacheWrite5mPerToken": 3.75, "cacheWrite1hPerToken": 6,  "cacheReadPerToken": 0.3 },
    "claude-haiku-4-5":  { "inputPerToken": 1,  "outputPerToken": 5,  "cacheWrite5mPerToken": 1.25, "cacheWrite1hPerToken": 2,  "cacheReadPerToken": 0.1 }
  }
}
```

Pricing values are in USD per million tokens.

## Environment Variables

| Variable              | Effect                                         |
| --------------------- | ---------------------------------------------- |
| `ANTHROPIC_API_KEY`   | Required — passed through to the Anthropic SDK |
| `AGENT_JS_DEBUG=true` | Enables verbose debug logging to stdout        |

## TypeScript

The project uses the strictest TypeScript settings: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, and `erasableSyntaxOnly`. All of these must pass (`npm run types`) before committing.

## Testing

Tests use Node's built-in test runner (`node --test`). Test files are colocated with source files as `*.test.ts`.

```bash
npm test
```

No external test framework is used.
