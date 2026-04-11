# `agent-js`

A minimal agent implementation for working with LLMs (my own mini claude code)

![demo](https://elanmed.dev/nvim-plugins/agent-js.png)

## Features

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
| `diffStyle`           | `"unified"` \| `"lines"`               | Git diff output style (default: `unified`)               |
| `disableUsageMessage` | boolean                                | Hide token usage/cost after responses (default: `false`) |
| `pricingPerModel`     | object                                 | Token pricing per model per million                      |

Example `settings.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "diffStyle": "lines",
  "disableUsageMessage": false,
  "pricingPerModel": {
    "my-custom-model": {
      "inputPerToken": 2.5,
      "outputPerToken": 10
    }
  }
}
```

## Builtin Slash Commands

Slash commands are triggered with `/command` at the prompt.

| Command  | Description                                             |
| -------- | ------------------------------------------------------- |
| `/edit`  | Open `$EDITOR` with empty input for multi-line messages |
| `/clear` | Clear conversation context and reset message history    |

### Custom Slash Commands

Create custom commands by adding markdown files to `./.agent-js/commands/[command].md`

## Tools

- `bash` — run bash commands
- `create_file` — create new files
- `view_file` — view files or list directories
- `str_replace` — replace strings in files
- `insert_lines` — insert text at a line

## TODO

- [ ] Queue messages with an editor
- [ ] Cleaner diffs with sections filtered
- [ ] MCP server
- [ ] Better newline management - internal stdout state?
- [ ] Modularize main loop
