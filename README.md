# `agent-js`

A minimal agent implementation for working with Claude: execute bash commands, create/edit files, etc.

![demo](https://elanmed.dev/nvim-plugins/agent-js.png)

## Features

- **Minimal deps**: 3 packages [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), [`globby`](https://www.npmjs.com/package/globby), [`zod`](https://www.npmjs.com/package/zod)
- **Strict TypeScript**: all the strictest `tsconfig`, `eslint` settings
  - Note to future self: probably not worth it
- **No build step**: uses Bun's native `.ts` support
- **Tools**: (see below)
- **Streaming**: responses stream in real time, cancellable
- **Configurable**: global and local settings to pick your model, track costs
- **Recursive AGENTS.md discovery**: automatically includes project context
- **Slash commands**: trigger a command defined in `./.agent-js/commands/command.md` with an input of `/command`

## Configuration

Settings live in `~/.config/.agent-js/settings.json` (global) and `./.agent-js/settings.json` (local overrides)

The global `settings.json` is written if it doesn't exist - see it for configurable options

## Tools

- `bash` — run bash commands
- `create_file` — create new files
- `view_file` — view files or list directories
- `str_replace` — replace strings in files
- `insert_lines` — insert text at a line

## TODO:

- [ ] Executable
- [x] Slash commands
- [ ] Allow pasting content without submitting
