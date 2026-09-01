# `lasso`

_A minimal agent harness_

<!-- a hack to get around github sanitizing styles from markdown -->
<br>
<p align="center">
    <img src="./logo.png" width="300px" />
</p>

## Features

- **Minimal**: 3,500 lines of source code, 7,100 lines of tests
  - Responses are piped through `bat` to render markdown
  - Multi-line input is supported by spawning an editor of your choice
- **Tools**: 8 tools to execute bash, fetch from the web, and edit files
  - A `git diff` with `delta` is output whenever a tool changes a file
- **Multiple providers**: Anthropic or OpenAI-compatible APIs
- **AGENTS.md support**: The root file is included in context, nested files are internally represented as skills
- **Slash commands**: Change agent settings or execute reusable prompts
- **Token usage tracking**: Track spending per model within a configurable time window
- **Context compaction**: The conversation is automatically compacted when nearing the model's context window limit
  - Triggered at `compactTriggerRatio`, down to `compactTargetRatio`
- **Session history**: Transcripts are persisted per session and past sessions can be resumed with `/resume`
- **Keymaps**: Customizable shortcuts for executing built-in slash commands

## Configuration

Settings live in `~/.config/agent-js/settings.yaml` (global) and `./.agent-js/settings.yaml` (local overrides), parsed as YAML 1.2 (the `yaml` package default).

### Config Options

| Option                      | Type                                   | Required | Default                  | Description                                      |
| --------------------------- | -------------------------------------- | -------- | ------------------------ | ------------------------------------------------ |
| `model`                     | `string`                               | optional | —                        | Model name (required in the merged config)       |
| `provider`                  | `"anthropic"` \| `"openai-compatible"` | optional | `openai-compatible`      | API provider                                     |
| `baseURL`                   | `string`                               | optional | `null`                   | API base URL (required for `openai-compatible`)  |
| `pricingPerModel`           | `object`                               | optional | `{}`                     | Token pricing per model per million              |
| `contextWindowPerModel`     | `object`                               | optional | `{}`                     | Context window size in tokens per model          |
| `compactTriggerRatio`       | `number`                               | optional | `0.7`                    | Compact when context usage exceeds this ratio    |
| `compactTargetRatio`        | `number`                               | optional | `0.3`                    | Compact down to this context ratio               |
| `keymaps`                   | `object`                               | optional | see below                | Custom keybindings                               |
| `customSlashCommandDirs`    | `string[]`                             | optional | `[]`                     | Additional directories for custom slash commands |
| `customSkillDirs`           | `string[]`                             | optional | `[]`                     | Additional directories for skills                |
| `loadingStateFrames`        | `string[]`                             | optional | `["\|", "/", "-", "\\"]` | Custom spinner frames                            |
| `loadingStateFrameDuration` | `number`                               | optional | `80`                     | Spinner frame interval in ms                     |
| `promptPrefix`              | `string`                               | optional | `"> "`                   | Prompt prefix string                             |
| `usageLimit`                | `object`                               | optional | `undefined`              | Dollar limit and tracking window                 |

### Usage Limits

When `usageLimit` is set, the agent tracks the running dollar cost of usage within the configured time window:

| Field          | Type     | Default  | Description                                    |
| -------------- | -------- | -------- | ---------------------------------------------- |
| `duration`     | `string` | required | Time window, e.g. `"5h"` (`[number][s,m,h,d]`) |
| `dollarAmount` | `number` | required | Maximum dollar spend in the window             |

Previous usages are loaded from `~/.config/agent-js/usage.json` on startup and entries older than `duration` are filtered out.

If the current model has no `pricingPerModel` entry, usage limiting is disabled for that model and a warning is printed at startup.

The current spend is shown as `$<cost> of $<limit>` in the status line.

Example:

```yaml
usageLimit:
  duration: "5h"
  dollarAmount: 10
```

### Pricing Per Model

Token pricing per model per million tokens:

Each model maps to a pricing object with:

| Field                  | Type     | Default  |
| ---------------------- | -------- | -------- |
| `inputPerMillion`      | `number` | required |
| `outputPerMillion`     | `number` | required |
| `cacheReadPerMillion`  | `number` | optional |
| `cacheWritePerMillion` | `number` | optional |

Example:

```yaml
pricingPerModel:
  claude-sonnet-4-6:
    inputPerMillion: 2.5
    outputPerMillion: 10
    cacheReadPerMillion: 1.25
    cacheWritePerMillion: 3.75
```

### Context Window Per Model

Context window size in tokens per model, used to decide when to compact the conversation:

Each entry maps a model name to its context window size in tokens:

| Field          | Type     | Default  |
| -------------- | -------- | -------- |
| `<model name>` | `number` | required |

Example:

```yaml
contextWindowPerModel:
  claude-sonnet-4-6: 200000
```

### Keymaps

Any slash command (builtin or custom) can be bound to a key via the `keymaps` config, e.g.:

```yaml
keymaps:
  history:
    name: "o"
    ctrl: true
  clear:
    name: "x"
    ctrl: true
```

`edit` and `paste` have default keymaps:

| Key     | Type  | Default                     | Description                                                                                     |
| ------- | ----- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `edit`  | `Key` | `{ name: "g", ctrl: true }` | Call `$AGENT_JS_EDIT` or `$EDITOR __FILE__` to input multi-line prompts                         |
| `paste` | `Key` | `{ name: "v", ctrl: true }` | Call `$AGENT_JS_EDIT` or `$EDITOR __FILE__` with the current line + clipboard content pasted in |

Pressing a bound key runs the command directly for `edit`/`paste` (editor) and pager commands (`history`, `config`, `context-str`, `commands-str`); all other commands, builtin or custom, are typed into the prompt. Custom command keymaps use the command's name (its filename without extension).

The default keymaps are chosen as not to conflict with Node `readline`s [builtin](https://nodejs.org/api/readline.html#tty-keybindings) keybindings

Each `Key` object has:

| Field   | Type      | Default  |
| ------- | --------- | -------- |
| `name`  | `string`  | required |
| `ctrl`  | `boolean` | `false`  |
| `meta`  | `boolean` | `false`  |
| `shift` | `boolean` | `false`  |

You can configure individual keymaps while keeping defaults for others

Example:

```yaml
keymaps:
  edit:
    name: x
    ctrl: true
  paste:
    name: v
    ctrl: true
```

### Example settings.yaml

A complete example including every option:

```yaml
model: claude-sonnet-4-6
provider: openai-compatible
baseURL: https://api.example.com/v1
compactTriggerRatio: 0.7
compactTargetRatio: 0.3
keymaps:
  edit:
    name: x
    ctrl: true
  paste:
    name: v
    ctrl: true
  history:
    name: o
    ctrl: true
  clear:
    name: x
    ctrl: true
pricingPerModel:
  claude-sonnet-4-6:
    inputPerMillion: 2.5
    outputPerMillion: 10
    cacheReadPerMillion: 1.25
    cacheWritePerMillion: 3.75
contextWindowPerModel:
  claude-sonnet-4-6: 200000
customSlashCommandDirs:
  - /home/me/my-commands
customSkillDirs:
  - /home/me/my-skills
loadingStateFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
loadingStateFrameDuration: 100
promptPrefix: "🤖 "
usageLimit:
  duration: "5h"
  dollarAmount: 10
```

## Environment Variables

| Variable                   | Description                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AGENT_JS_API_KEY`         | API key for the configured provider (required)                                                                         |
| `AGENT_JS_EDIT`            | Editor command with `__FILE__` placeholder for multi-line input (fallback: `$EDITOR __FILE__`)                         |
| `AGENT_JS_PAGER_HISTORY`   | Pager command with `__FILE__` placeholder for viewing chat history (fallback: `$AGENT_JS_PAGER`)                       |
| `AGENT_JS_PAGER_CONFIG`    | Pager command with `__FILE__` placeholder for viewing config (fallback: `$AGENT_JS_PAGER`)                             |
| `AGENT_JS_PAGER_CONTEXT`   | Pager command with `__FILE__` placeholder for viewing context (fallback: `$AGENT_JS_PAGER`)                            |
| `AGENT_JS_PAGER_COMMANDS`  | Pager command with `__FILE__` placeholder for viewing custom commands (fallback: `$AGENT_JS_PAGER`)                    |
| `AGENT_JS_PAGER_RELOAD`    | Pager command with `__FILE__` placeholder for viewing the reload config diff (fallback: `$AGENT_JS_PAGER`)             |
| `AGENT_JS_PAGER`           | Default pager command with `__FILE__` placeholder (fallback: `$PAGER`, then `bat`, then `less`)                        |
| `AGENT_JS_CLIPBOARD_PASTE` | Command used by `/paste` to read the clipboard (default: `pbpaste` on macOS, `xclip -selection clipboard -o` on Linux) |

## CLI Arguments

| Flag      | Description          |
| --------- | -------------------- |
| `--debug` | Enable debug logging |

## Builtin Slash Commands

Slash commands are triggered with `/command` at the prompt.

| Command         | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `/edit`         | Call the `edit` keymap                                                     |
| `/clear`        | Clear conversation context                                                 |
| `/history`      | View chat history in a pager                                               |
| `/paste`        | Call the `paste` keymap                                                    |
| `/model`        | Switch the model at runtime (e.g. `/model kimi-k2.6`)                      |
| `/skills`       | List available skills                                                      |
| `/context`      | List available context files                                               |
| `/context-str`  | View the raw context string in a pager                                     |
| `/commands`     | List available slash commands (builtin and custom)                         |
| `/commands-str` | View custom slash command contents in a pager                              |
| `/keymaps`      | List configured keybindings                                                |
| `/usage`        | Show current session usage                                                 |
| `/config`       | View global, local, and applied config in a pager                          |
| `/reload`       | Reload config and context, diff the result in a pager                      |
| `/resume`       | Continue a past session from its start date (e.g. `/resume 1754000000000`) |

### Custom Slash Commands

Create custom commands by adding markdown files (`.md`) to `./.agent-js/commands/` (local), `~/.config/agent-js/commands/` (global), or any directory specified in `customSlashCommandDirs`. Nested subdirectories are supported via `**/*.md` glob. Commands with the same filename are deduplicated with the first occurrence taking precedence, in this priority order: custom dirs → local → global.

#### Directory Structure

```
./.agent-js/commands/              # local commands
  help.md
  refactor.md
~/.config/agent-js/commands/      # global commands
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
~/.config/agent-js/context/       # global context dir
  AGENTS.md                        # always in context
```

### Discovery

- **Root files** — `./AGENTS.md` and `~/.config/agent-js/context/AGENTS.md` are always included in the system prompt
- **Nested files** — all `*/**/AGENTS.md` files under the current working directory are registered as skills. The agent can call `load_skill` to progressively disclose their content when needed

## Skills

### Directory Structure

```
~/.config/agent-js/skills/   # global skills
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
3. **Global skills** — `~/.config/agent-js/skills/`

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

Available skills are listed in the system prompt, the LLM can use the `load_skill` tool to load a skill's full instructions.

## Tools

- `bash` — run bash commands
- `create_file` — create new files
- `view_file` — view files or list directories
- `str_replace` — replace strings in files
- `insert_lines` — insert text at a line
- `web_fetch_html` — fetch a URL and return extracted article content
- `web_fetch_json` — fetch a JSON API endpoint and return parsed data
- `load_skill` — load a skill to get specialized instructions

## Dependencies

Minimal runtime dependencies (9 total):

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

- This project uses **pnpm v11** for package management, which helps [mitigate the risk of supply chain attacks](https://pnpm.io/supply-chain-security)
- All tests are written with the Node.js native test runner and mocks i.e. no Jest
- TypeScript is executed directly via `node` (no build step), keeping the toolchain minimal

## Running in a container

The `scripts/copy-server.ts` and `scripts/paste-server.ts` helpers bridge the host clipboard to a container. In the example below, each listens on a random port and prints that port to stdout, so the port can be captured via a FIFO. Set `paste_cmd`/`copy_cmd` to the host clipboard commands (e.g. `pbpaste`/`pbcopy` on macOS).

```bash
agent() {
  paste_fifo=$(mktemp -u /tmp/paste-fifo.XXXXXX)
  rm -f "$paste_fifo"
  mkfifo "$paste_fifo"
  node "/path/to/agent-js/scripts/paste-server.ts" "$paste_cmd" >"$paste_fifo" &
  paste_server_pid="$!"
  read -r PASTE_PORT <"$paste_fifo"
  rm -f "$paste_fifo"

  copy_fifo=$(mktemp -u /tmp/copy-fifo.XXXXXX)
  rm -f "$copy_fifo"
  mkfifo "$copy_fifo"
  node "/path/to/agent-js/scripts/copy-server.ts" "$copy_cmd" >"$copy_fifo" &
  copy_server_pid="$!"
  read -r COPY_PORT <"$copy_fifo"
  rm -f "$copy_fifo"

  trap "kill $paste_server_pid $copy_server_pid 2>/dev/null" EXIT INT TERM

  local podman_args=(
    --env AGENT_JS_EDIT='nvim -c "normal! G$" -c startinsert! __FILE__'
    --env AGENT_JS_PAGER_HISTORY='nvim -c "normal! G$" __FILE__'
    --env AGENT_JS_CLIPBOARD_PASTE="nc --recv-only host.docker.internal $PASTE_PORT"
    --env COPY_PORT="$COPY_PORT"
    --env PASTE_PORT="$PASTE_PORT"
  )

  # ...
}
```

```lua
-- the vim config running in the container
vim.g.clipboard = {
  name = "agent-js-clipboard",
  copy = {
    ["+"] = { "nc", "--send-only", "host.docker.internal", vim.env.COPY_PORT, },
    ["*"] = { "nc", "--send-only", "host.docker.internal", vim.env.COPY_PORT, },
  },
  paste = {
    ["+"] = { "nc", "--recv-only", "host.docker.internal", vim.env.PASTE_PORT, },
    ["*"] = { "nc", "--recv-only", "host.docker.internal", vim.env.PASTE_PORT, },
  }
}
```

## TODO (soon)

- [ ] Tool for creating subagents
- [ ] Validate that two slash commands don't share the same keymap
- [ ] Support additional user content after a slash command without args

## TODO (later)

- [ ] Support MCP servers
- [ ] Look into tanstack ai when it supports openai compatible
  - [ ] Support code-mode
- [ ] Support Windows-style newlines
