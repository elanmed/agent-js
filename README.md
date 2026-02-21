# agent-js

A minimal agent implementation for working with Claude: execute bash commands, create/edit files, etc.

## Features

- **Minimal deps**: 3 packages [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), [`globby`](https://www.npmjs.com/package/globby), [`zod`](https://www.npmjs.com/package/zod)
- **Strict TypeScript**: all the strictest `tsconfig`, `eslint` settings
  - Note to future self: probably not worth it
- **No build step**: uses Node's native `.ts` support
- **Tool use**: (see below)
- **Streaming**: responses stream in real time, cancellable
- **Config**: global and local settings to pick your model, track costs
- **Recursive AGENTS.md discovery**: automatically includes project context
- **Cost tracking**: see how much your session is costing (optional)

## Configuration

Settings live in **`~/.config/agent-js/agent-js.settings.json`** (global) and **`./agent-js.settings.json`** (local overrides).

Models: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`

## Tools

- **`bash`** — run bash commands
- **`create_file`** — create new files
- **`view_file`** — view files or list directories
- **`str_replace`** — replace strings in files
- **`insert_lines`** — insert text at a line
