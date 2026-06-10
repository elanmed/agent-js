# `agent-js`

A minimal agent implementation for working with LLMs (my own mini claude code)

![demo](./demo.png)

## Features

- **Minimal**: 2,800 lines of source code, 3,600 lines of tests
  - Responses are piped through `bat` to render markdown
  - Multi-line input is supported by spawning an editor of your choice
- **Tools**: 7 tools to execute bash, fetch from the web, and edit files
  - A `git diff` with `delta` is output whenever a tool changes a file
- **Multiple providers**: Anthropic or OpenAI-compatible APIs
- **AGENTS.md support**: The root file is included in context, nested files are internally represented as skills
- **Slash commands**: Change agent settings or execute reusable prompts
- **Cost tracking**: Per-model token pricing
- **Keymaps**: Customizable shortcuts for executing built-in slash commands

## Configuration

Settings live in `~/.config/.agent-js/settings.json` (global) and `./.agent-js/settings.json` (local overrides)

### Config Options

| Option                   | Type                                   | Description                                      |
| ------------------------ | -------------------------------------- | ------------------------------------------------ |
| `model`                  | `string`                               | Model name (required)                            |
| `provider`               | `"anthropic"` \| `"openai-compatible"` | API provider (default: `openai-compatible`)      |
| `baseURL`                | `string`                               | API base URL (required for `openai-compatible`)  |
| `pricingPerModel`        | `object`                               | Token pricing per model per million              |
| `keymaps`                | `object`                               | Custom keybindings (see below)                   |
| `customSlashCommandDirs` | `string[]`                             | Additional directories for custom slash commands |
| `customSkillDirs`        | `string[]`                             | Additional directories for skills                |

### Keymaps

| Key       | Type  | Default                     | Description                                                                                     |
| --------- | ----- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `edit`    | `Key` | `{ name: "g", ctrl: true }` | Call `$AGENT_JS_EDIT` or `$EDITOR __FILE__` to input multi-line prompts                         |
| `paste`   | `Key` | `{ name: "v", ctrl: true }` | Call `$AGENT_JS_EDIT` or `$EDITOR __FILE__` with the current line + clipboard content pasted in |
| `history` | `Key` | `{ name: "o", ctrl: true }` | Call `$AGENT_JS_HISTORY` or `$EDITOR __FILE__` to view chat history                             |
| `clear`   | `Key` | `{ name: "x", ctrl: true }` | Clear conversation context                                                                      |

The default keymaps are chosen as not to conflict with Node `readline`s [builtin](https://nodejs.org/api/readline.html#tty-keybindings) keybindings

Each `Key` object has:

| Field   | Type      | Default  |
| ------- | --------- | -------- |
| `name`  | `string`  | required |
| `ctrl`  | `boolean` | `false`  |
| `meta`  | `boolean` | `false`  |
| `shift` | `boolean` | `false`  |

You can configure individual keymaps while keeping defaults for others

Example `settings.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "keymaps": {
    "edit": {
      "name": "x",
      "ctrl": true
    }
  },
  "pricingPerModel": {
    "claude-sonnet-4-6": {
      "inputPerToken": 2.5,
      "outputPerToken": 10,
      "cacheReadPerToken": 1.25,
      "cacheWritePerToken": 3.75
    }
  },
  "customSlashCommandDirs": ["/home/me/my-commands"],
  "customSkillDirs": ["/home/me/my-skills"]
}
```

## Environment Variables

| Variable           | Description                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `AGENT_JS_API_KEY` | API key for the configured provider (required)                                                     |
| `AGENT_JS_EDIT`    | Editor command with `__FILE__` placeholder for multi-line input (fallback: `$EDITOR __FILE__`)     |
| `AGENT_JS_HISTORY` | Editor command with `__FILE__` placeholder for viewing chat history (fallback: `$EDITOR __FILE__`) |

## CLI Arguments

| Flag      | Description          |
| --------- | -------------------- |
| `--debug` | Enable debug logging |

## Builtin Slash Commands

Slash commands are triggered with `/command` at the prompt.

| Command     | Description                                           |
| ----------- | ----------------------------------------------------- |
| `/edit`     | Call the `edit` keymap                                |
| `/clear`    | Call the `clear` keymap                               |
| `/history`  | Call the `history` keymap                             |
| `/paste`    | Call the `paste` keymap                               |
| `/model`    | Switch the model at runtime (e.g. `/model kimi-k2.6`) |
| `/skills`   | List available skills                                 |
| `/context`  | List available context files                          |
| `/commands` | List available slash commands (builtin and custom)    |

### Custom Slash Commands

Create custom commands by adding markdown files (`.md`) to `./.agent-js/commands/` (local), `~/.config/.agent-js/commands/` (global), or any directory specified in `customSlashCommandDirs`. Nested subdirectories are supported via `**/*.md` glob. Local commands take precedence over global commands with the same filename.

#### Directory Structure

```
./.agent-js/commands/              # local commands
  help.md
  refactor.md
~/.config/.agent-js/commands/      # global commands
  status.md
/home/me/my-commands/              # custom commands (via customSlashCommandDirs)
  custom.md
```

## AGENTS.md Context

`AGENTS.md` files provide project context to the agent. The root `AGENTS.md` files are always included in the system prompt, while nested `AGENTS.md` files are progressively disclosed as skills.

### Directory Structure

```
./
  AGENTS.md                        # always in context
  src/
    AGENTS.md                      # loaded as a skill on demand
~/.config/.agent-js/context/       # global context dir
  AGENTS.md                        # always in context
```

### Discovery

- **Root files** — `./AGENTS.md` and `~/.config/.agent-js/context/AGENTS.md` are always included in the system prompt
- **Nested files** — all `*/**/AGENTS.md` files under the current working directory are registered as skills. The agent can call `loadSkill` to progressively disclose their content when needed

## Skills

### Directory Structure

```
~/.config/.agent-js/skills/   # global skills
  my-skill/
    SKILL.md
  category/
    nested-skill/
      SKILL.md
./.agent-js/skills/            # local skills
  project-skill/
    SKILL.md
/custom/skills/                # custom skills (via customSkillDirs)
  custom-skill/
    SKILL.md
```

### Discovery

Skills are discovered via `**/SKILL.md` glob from three sources in priority order:

1. **Custom skill dirs** — directories specified in `customSkillDirs`
2. **Local skills** — `./.agent-js/skills/`
3. **Global skills** — `~/.config/.agent-js/skills/`

Skills with duplicate names are deduplicated, with the first occurrence taking precedence.

### SKILL.md Format

Each `SKILL.md` must have front matter with `name` and `description`:

```markdown
---
name: my-skill
description: Does something useful
---

# My Skill

Skill body with instructions the agent will use when this skill is loaded.
```

Available skills are listed in the system prompt, the LLM can use the `loadSkill` tool to load a skill's full instructions.

## Tools

- `bash` — run bash commands
- `create_file` — create new files
- `view_file` — view files or list directories
- `str_replace` — replace strings in files
- `insert_lines` — insert text at a line
- `web_fetch_html` — fetch a URL and return extracted article content
- `web_fetch_json` — fetch a JSON API endpoint and return parsed data

## Dependencies

Minimal runtime dependencies (8 total):

| Package                     | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `ai`                        | AI SDK core                             |
| `@ai-sdk/anthropic`         | Anthropic provider                      |
| `@ai-sdk/openai-compatible` | OpenAI-compatible provider              |
| `zod`                       | Schema validation                       |
| `jsdom`                     | DOM parsing for `web_fetch_html`        |
| `@mozilla/readability`      | Content extraction for `web_fetch_html` |
| `prettier`                  | Markdown formatting                     |
| `yaml`                      | Parsing Skill metadata                  |
| `globby`                    | Glob with .gitignore support            |

- This project uses **pnpm v11** for package management, which helps [prevent supply chain attacks](https://pnpm.io/supply-chain-security)
- All tests are written with the Node.js native test runner and mocks i.e. no Jest
- TypeScript is executed directly via `node` (no build step), keeping the toolchain minimal

## TODO (soon)

## TODO (later)

- [ ] Resume session
- [ ] Support MCP servers
- [ ] Look into tanstack ai when it supports openai compatible
  - [ ] Support code-mode
