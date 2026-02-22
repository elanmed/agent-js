# `agent-js`

A minimal agent implementation for working with claude (my mini claude code)

![demo](https://elanmed.dev/nvim-plugins/agent-js.png)

## Features

- **Minimal deps**: 3 packages [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), [`globby`](https://www.npmjs.com/package/globby), [`zod`](https://www.npmjs.com/package/zod)
- **Strict TypeScript**: all the strictest `tsconfig`, `eslint` settings
  - Note to future self: probably not worth it
- **No build step**: uses Bun's native `.ts` support
- **Tools**: execute bash commands, create/edit files, etc. A `git diff` is output when a tool changes a file
- **Rendering with `bat`**: responses are parsed and rendered as markdown
- **Configurable**: global and local settings to pick your model, track costs
- **Recursive AGENTS.md discovery**: automatically includes project context
- **Slash commands**: trigger a command defined in `./.agent-js/commands/command.md` with `/command`
  - Builtin `/e` to open your editor and send multi-line content to the LLM

## Configuration

Settings live in `~/.config/.agent-js/settings.json` (global) and `./.agent-js/settings.json` (local overrides)

The global `settings.json` is written if it doesn't exist - see it for configurable options

## Tools

- `bash` — run bash commands
- `create_file` — create new files
- `view_file` — view files or list directories
- `str_replace` — replace strings in files
- `insert_lines` — insert text at a line
