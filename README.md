# `agent-js`

A minimal agent implementation for working with LLMs (my own mini claude code)

![demo](https://elanmed.dev/nvim-plugins/agent-js.png)

## Features

- **Minimal**: 2,700 lines of source code, 2,600 lines of tests
- **Tools**: execute bash commands, fetch from the web, create/edit files. A `git diff` is output when a tool changes a file
- **Multiple providers**: Anthropic or OpenAI-compatible APIs
- **Configuration**: global and local `settings.json`
- **Cost tracking**: per-model token pricing with usage summary after each response
- **AGENTS.md discovery**: recursively includes project context from `AGENTS.md` files
- **Skills**: load skill metadata from `SKILL.md` files in `~/.config/.agent-js/skills/`, `./.agent-js/skills/`, or any directory specified in `customSkillDirs`
- **Slash commands**: builtin (`/edit`, `/clear`, `/edit-log`, `/model`) and custom commands from `./.agent-js/commands/` or `~/.config/.agent-js/commands/`
- **Keymaps**: customizable shortcuts for common actions
- **Rendering**: responses piped through `bat` for markdown formatting

## Configuration

Settings live in `~/.config/.agent-js/settings.json` (global) and `./.agent-js/settings.json` (local overrides)

### Config Options

| Option                   | Type                                   | Description                                              |
| ------------------------ | -------------------------------------- | -------------------------------------------------------- |
| `model`                  | string                                 | Model name (required)                                    |
| `provider`               | `"anthropic"` \| `"openai-compatible"` | API provider (default: `openai-compatible`)              |
| `baseURL`                | string                                 | API base URL (required for `openai-compatible`)          |
| `diffStyle`              | `"unified"` \| `"lines"`               | Git diff output style (default: `lines`)                 |
| `disableUsageMessage`    | boolean                                | Hide token usage/cost after responses (default: `false`) |
| `pricingPerModel`        | object                                 | Token pricing per model per million                      |
| `keymaps`                | object                                 | Custom keybindings (see below)                           |
| `customSlashCommandDirs` | string[]                               | Additional directories for custom slash commands         |
| `customSkillDirs`        | string[]                               | Additional directories for skills                        |

### Keymaps

| Key       | Type  | Default                     | Description                                                 |
| --------- | ----- | --------------------------- | ----------------------------------------------------------- |
| `edit`    | `Key` | `{ name: "g", ctrl: true }` | Open `$EDITOR` for multi-line                               |
| `editLog` | `Key` | `{ name: "o", ctrl: true }` | Open `$AGENT_JS_EDITOR_LOG` or `$EDITOR` to view editor log |
| `clear`   | `Key` | `{ name: "x", ctrl: true }` | Clear conversation context                                  |

The default keymaps are chosen as not to conflict with Node `readline`s [builtin](https://nodejs.org/api/readline.html#tty-keybindings) keybindings

Each `Key` object has:

| Field   | Type    | Default  |
| ------- | ------- | -------- |
| `name`  | string  | required |
| `ctrl`  | boolean | `false`  |
| `meta`  | boolean | `false`  |
| `shift` | boolean | `false`  |

You can configure individual keymaps while keeping defaults for others

Example `settings.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "diffStyle": "lines",
  "disableUsageMessage": false,
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

## CLI Arguments

| Flag                 | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `--debug`            | Enable debug logging                                 |
| `--resume=sessionId` | Resume a previous session (not currently functional) |

## Builtin Slash Commands

Slash commands are triggered with `/command` at the prompt.

| Command     | Description                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| `/edit`     | Open `$AGENT_JS_EDITOR` or `$EDITOR` with empty input for multi-line messages |
| `/clear`    | Clear conversation context and reset message history                          |
| `/edit-log` | Open `$AGENT_JS_EDITOR_LOG` or `$EDITOR` to view the editor log               |
| `/model`    | Switch the model at runtime (e.g. `/model kimi-k2.6`)                         |

### Custom Slash Commands

Create custom commands by adding markdown files (`.md`) to `./.agent-js/commands/` (local), `~/.config/.agent-js/commands/` (global), or any directory specified in `customSlashCommandDirs`. Nested subdirectories are supported via `**/*.md` glob. Local commands take precedence over global commands with the same filename.

## AGENTS.md Context

`AGENTS.md` files provide project context to the agent, they are discovered from three sources:

### Directory Structure

```
./
  AGENTS.md                        # nested in cwd — any depth
  src/
    AGENTS.md
~/.config/.agent-js/context/       # global context dir
  rules/
    AGENTS.md
  conventions/
    AGENTS.md
```

### Discovery

- **CWD glob** — all `**/AGENTS.md` files under the current working directory
- **Global context dir** — all `**/AGENTS.md` files under `~/.config/.agent-js/context/`

Files from all sources are concatenated into the system prompt with their paths.

## Skills

### Directory Structure

```
~/.config/.agent-js/skills/   # global skills
  my-skill/
    SKILL.md
./.agent-js/skills/            # local skills
  project-skill/
    SKILL.md
/custom/skills/                # custom skills (via customSkillDirs)
  custom-skill/
    SKILL.md
```

### Discovery

Skills are discovered from three sources in priority order:

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

Minimal runtime dependencies (7 total):

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

## TODO (soon)

- [ ] Look into tanstack ai
  - [ ] Support code-mode
- [ ] Progressively disclose nested AGENTS.md files?
- [ ] Read each nested skills file

## TODO (later)

- [ ] Resume session
- [ ] Support MCP servers
