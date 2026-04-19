# `agent-js`

A minimal agent implementation for working with LLMs (my own mini claude code)

![demo](https://elanmed.dev/nvim-plugins/agent-js.png)

## Features

- **Minimal**: 1,800 lines of source code, 1,200 lines of tests
- **Tools**: execute bash commands, create/edit files, etc. A `git diff` is output when a tool changes a file
- **Multiple providers**: Anthropic or OpenAI-compatible APIs
- **Configuration**: global and local `settings.json`
- **Cost tracking**: per-model token pricing with usage summary after each response
- **AGENTS.md discovery**: recursively includes project context from `AGENTS.md` files
- **Slash commands**: builtin (`/edit`, `/clear`) and custom commands from `./.agent-js/commands/`
- **Rendering**: responses piped through `bat` for markdown formatting

## Configuration

Settings live in `~/.config/.agent-js/settings.json` (global) and `./.agent-js/settings.json` (local overrides)

### Config Options

| Option                | Type                                   | Description                                              |
| --------------------- | -------------------------------------- | -------------------------------------------------------- |
| `model`               | string                                 | Model name (required)                                    |
| `provider`            | `"anthropic"` \| `"openai-compatible"` | API provider (default: `openai-compatible`)              |
| `baseURL`             | string                                 | API base URL (required for `openai-compatible`)          |
| `diffStyle`           | `"unified"` \| `"lines"`               | Git diff output style (default: `lines`)                 |
| `disableUsageMessage` | boolean                                | Hide token usage/cost after responses (default: `false`) |
| `pricingPerModel`     | object                                 | Token pricing per model per million                      |
| `keymaps`             | object                                 | Custom keybindings (see below)                           |

### Keymaps

| Key      | Type  | Default                                                | Description                  |
| -------- | ----- | ------------------------------------------------------ | ---------------------------- |
| `editor` | `Key` | `{ name: "x", ctrl: true, meta: false, shift: false }` | Keybinding to open `$EDITOR` |

Each `Key` object has:

| Field   | Type    | Default  |
| ------- | ------- | -------- |
| `name`  | string  | required |
| `ctrl`  | boolean | `false`  |
| `meta`  | boolean | `false`  |
| `shift` | boolean | `false`  |

Example `settings.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "diffStyle": "lines",
  "disableUsageMessage": false,
  "keymaps": {
    "editor": {
      "name": "e",
      "ctrl": true,
      "meta": false,
      "shift": false
    }
  },
  "pricingPerModel": {
    "my-custom-model": {
      "inputPerToken": 2.5,
      "outputPerToken": 10,
      "cacheReadPerToken": 1.25,
      "cacheWritePerToken": 3.75
    }
  }
}
```

## CLI Arguments

| Flag                 | Description               |
| -------------------- | ------------------------- |
| `--debug`            | Enable debug logging      |
| `--resume=sessionId` | Resume a previous session |

## Builtin Slash Commands

Slash commands are triggered with `/command` at the prompt.

| Command  | Description                                                                   |
| -------- | ----------------------------------------------------------------------------- |
| `/edit`  | Open `$AGENT_JS_EDITOR` or `$EDITOR` with empty input for multi-line messages |
| `/clear` | Clear conversation context and reset message history                          |

### Custom Slash Commands

Create custom commands by adding markdown files to `./.agent-js/commands/[command].md`

## Tools

- `bash` — run bash commands
- `create_file` — create new files
- `view_file` — view files or list directories
- `str_replace` — replace strings in files
- `insert_lines` — insert text at a line
- `web_fetch` — fetch a URL and return its readable content

## Dependencies

Minimal runtime dependencies (7 total):

| Package                     | Purpose                            |
| --------------------------- | ---------------------------------- |
| `ai`                        | AI SDK core                        |
| `@ai-sdk/anthropic`         | Anthropic provider                 |
| `@ai-sdk/openai-compatible` | OpenAI-compatible provider         |
| `zod`                       | Schema validation                  |
| `jsdom`                     | DOM parsing for `web_fetch`        |
| `@mozilla/readability`      | Content extraction for `web_fetch` |
| `prettier`                  | Markdown formatting                |

## TODO

- [ ] MCP server
- [ ] Resume session
- [ ] View last temp file
- [ ] Update screenshot
- [ ] Spinner for tool calls
- [ ] Tool call interrupt
