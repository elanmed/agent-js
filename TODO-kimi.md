# Audit findings

Verified state: `tsc`, `eslint src`, all 419 tests, and `prettier --check` pass. Line counts in README (3,100 src / 6,400 tests) are accurate (actual: 3,171 / 6,408).

## Bugs

### 1. Compaction API usage is not cost-tracked

`src/api.ts` `maybeCompactMessageParams()` destructures `totalUsage` but never calls `appendModelUsage(totalUsage)`, unlike `resolveApiCall()`. Dollars/tokens spent on compaction calls are invisible to `/usage` and the usage limit window.

Plan: call `appendModelUsage(totalUsage)` in `maybeCompactMessageParams()` after a successful result; add a test asserting usage is appended after compaction.

### 2. Compaction prompt is missing the token unit

`src/api.ts:165` builds `Compact the following conversation into roughly ${targetTokens}:` — the number has no unit, so the LLM doesn't know it's a token budget.

Plan: change to `...into roughly ${targetTokens} tokens:`, or round and format the number (it can be a float, e.g. `0.3 * 250000 = 75000.00000000001`). Update any matching test fixture.

### 3. Token accounting can go negative when a provider omits `inputTokens`

`src/api.ts:139-141`: `allInputTokens = totalUsage.inputTokens ?? 0`, then `tokensForInputMessageParam = allInputTokens - messageParams.tokens`. If the provider reports no input tokens, this subtracts the whole tracked history from 0, driving `messageParams.tokens` negative and silently disabling context-window tracking / compaction.

Plan: if `totalUsage.inputTokens === undefined`, skip the delta math and leave token count unchanged (or clamp the delta at 0). Add a test with a mocked `generateText` returning usage without `inputTokens`.

### 4. `truncate()` returns only "…" for every string when stdout is not a TTY

`src/utils.ts:104`: `0.9 * processDeps.stdout.getColumns()` is `NaN` when `process.stdout.columns` is `undefined` (piped output), so `substring(0, NaN)` yields `""` and every tool print becomes just `…`.

Plan: default to a sane width (e.g. `getColumns() || 80`) before computing `maxLen`. Add a test with `getColumns` mocked to return `undefined`.

### 5. `execGitDiff` exit-code handling breaks when piping through `delta`

`src/tools.ts:584-597`: the `error.code !== 1` carve-out (git diff exits 1 when there are differences) only works without the pipe. With `| delta`, the pipeline exit code is delta's, so real git failures (e.g. exit 128) are silently swallowed and no error surfaces.

Plan: use `set -o pipefail` in the command, or check stderr content / run git diff separately from the delta pretty-printing step.

### 6. Temp files leak when a tool call is aborted mid-stream

`src/api.ts`: `toolCallIdToTempFile` entries are only cleaned up in `experimental_onToolCallFinish`. If `generateText` throws/aborts between start and finish, the temp files in `os.tmpdir()` are never unlinked.

Plan: in the error path of `resolveApiCall()` (and a `finally`), iterate `toolCallIdToTempFile.values()` and `tryCatch(() => fsDeps.unlinkSync(...))` each.

### 7. `executeBat` ignores spawn failure / non-zero exit

`src/print.ts:199-205`: `spawnSync` rarely throws, so `batResult.ok` is true even if `bat` exits non-zero (result has `.error`/`.status`); the fallback prints `batResult.value.stdout`, which may be empty — the LLM response is lost.

Plan: check `batResult.value.status === 0` (and absence of `.error`) before printing stdout; otherwise fall back to plain `print(content)`.

### 8. Usage-limit config validation ignores pricing requirement

`src/usage.ts:46-56` `isUsageLimitDisabled()` also requires `pricingPerModel[model]`, but `initStateFromConfig()` only validates that `usageLimitDuration` + `usageLimitDollar` are set together. Setting both limits without pricing silently disables the limit feature.

Plan: either warn at startup when limits are set but pricing for the active model is missing, or document the pricing requirement in the README Usage Limits section.

### 9. `/resume` with a missing history dir fails silently

`src/input.ts:611-612`: `if (!fsDeps.existsSync(chatHistoryPath)) return null;` — no message is printed, the prompt just swallows the command.

Plan: print an error like the "No conversation found" branch. Add a test.

## Documentation

### 10. README documents `usageLimitMs`, code implements `usageLimitDuration`

`README.md:41,46` describe `usageLimitMs` (`number`, ms). `src/config.ts:78` implements `usageLimitDuration` (string like `"5h"`, validated against `[number][s,m,h,d]`). Users following the README get a schema error.

Plan: update the README config table and Usage Limits section to `usageLimitDuration` with the string format and an example (`"5h"`).

### 11. README typo: "Toekn usage tracking"

`README.md:17`.

Plan: fix to "Token usage tracking".

### 12. Undocumented config options: `compactAtContextRatio`, `compactTargetRatio`

Both are in `ConfigSchema`/`DEFAULT_CONFIG` (0.7 / 0.3) and drive compaction, but are absent from the README config table.

Plan: add both rows to the table with defaults; mention in the Context compaction feature bullet.

### 13. Undocumented env var `AGENT_JS_CLIPBOARD_PASTE`

`src/input.ts:133` reads it to override the default `pbpaste`/`xclip` paste command, but it's missing from the README Environment Variables table.

Plan: add a row describing it and the platform defaults.

### 14. `__FILE__` placeholder docs don't match behavior for `$EDITOR`

README (env table + keymaps table) says the fallback is `$EDITOR __FILE__`, but `src/input.ts:453-454,515-516` only replaces `__FILE__` for `AGENT_JS_EDIT`/`AGENT_JS_HISTORY`; for `$EDITOR` the temp path is appended verbatim and a literal `__FILE__` in `$EDITOR` is never substituted.

Plan: either also `.replace("__FILE__", ...)` for the `$EDITOR` branch, or clarify in README that the placeholder is only supported in `AGENT_JS_EDIT`/`AGENT_JS_HISTORY`.

### 15. Session history 1-day expiry is undocumented

`src/log.ts:83-86` deletes `chat-history-*` files older than 24h on startup, while README advertises "past sessions can be resumed with `/resume`" with no mention of the retention window.

Plan: document the 1-day retention in the README Session history bullet (or make retention configurable and document the option).

### 16. Slash command precedence docs incomplete

README says "Local commands take precedence over global commands", but `src/input.ts:725-729` resolves `customSlashCommandDirs` first, then local, then global (first-seen-wins).

Plan: state the full precedence order (custom dirs → local → global), mirroring the Skills section.

### 17. `view_file` tool description omits `start_line`/`end_line` semantics

`src/tools.ts:516-519` description doesn't mention the 1-based numbering or the `-1` "to end of file" sentinel that `executeViewFileTool` supports.

Plan: extend the tool description to document both params and the `-1` sentinel.

### 19. `jq` is an undeclared system dependency of `pnpm run ci`

`package.json` `cloc-source`/`cloc-tests` pipe to `jq`, which is not a devDependency and not mentioned in README.

Plan: either document `jq` as a prerequisite, or replace with `node -e` JSON parsing to stay Node-only.

## Code style / consistency

### 20. Truthy checks violate the project's own AGENTS.md rule

AGENTS.md bans truthy/falsy coercion (`if (obj)`), but the codebase has: `src/config.ts:203` `if (defaultedBaseURL)`, `src/api.ts:28,39` `apiKey && { apiKey }`, `src/input.ts:111,147,206,212` (`if (rl.line.length)`, `if (questionAbortController)`, `if (apiStream)`, `if (question)`), `src/print.ts:48` `if (color)`, `src/args.ts:17` `while (args.length)`, `src/tools.ts:340,567` (`if (signal)`, `diffResult.value.stdout`).

Plan: replace with explicit `!== null` / `!== undefined` / `!== ""` / `.length > 0` comparisons. Optionally add `grit`/eslint rule `@typescript-eslint/strict-boolean-expressions` to enforce it.

### 23. Config JSON parse error omits the file path

`src/config.ts:172` throws "Failed to parse config as JSON" without saying which of the two config files failed.

Plan: include `path` in the error message; update tests.

### 24. Inconsistent local/global merge strategy

`initStateFromConfig()` merges `keymaps` per-key (`localConfig.keymaps?.edit ?? globalConfig.keymaps?.edit`) but replaces `pricingPerModel` and `contextWindowPerModel` wholesale — defining pricing for one model locally wipes global pricing for all other models.

Plan: merge records per-model (`{...global, ...local}`) for both, matching the keymap behavior; update tests.

### 25. Tooling coverage gaps for `scripts/`

`tsconfig.json` includes `scripts/`, but `pnpm run lint` is `eslint src` and `pnpm run format` covers only `src/ AGENTS.md eslint.config.mjs tsconfig.json .agent-js/` — `scripts/` is type-checked but never linted or formatted. `README.md`/`package.json` are also excluded from formatting while `AGENTS.md` is included.

Plan: add `scripts/` (and optionally README.md) to the lint and format script paths; run format once to normalize.

### 26. `scripts/copy-server.ts` usage string names the wrong flag

Both scripts throw `usage: --paste-cmd [cmd]`; in `copy-server.ts` the label doesn't match the script's purpose (it receives data to copy).

Plan: adjust each script's usage string to match its role, or extract a shared helper.

### 28. `setDebugLog` skips `logStateChange`

`src/state.ts:303-305` is the only mutating action that doesn't log a state change.

Plan: add a `logStateChange("set-debug-log", ...)` call for consistency (or drop logging everywhere it adds no value — pick one convention).

### 29. Naming mismatch: `setKeymapPromptHistory` vs `keymapChatHistory`

The action name says "PromptHistory", the state field says "ChatHistory" (`src/state.ts:217-225`); likewise `setKeymapEditPastePrompt` / `keymapEditPastePrompt` mix "Edit" in for paste.

Plan: rename actions to match state fields (`setKeymapChatHistory`, `setKeymapPastePrompt`) or vice versa; mechanical rename plus test updates.

### 30. Duplicated history-file scanning logic

`resumeCommand` (`src/input.ts:614-637`) and `deleteExpiredPromptHistory` (`src/log.ts:69-87`) re-implement the same filename parse/validate loop; a `// TODO: reuse this logic` comment already exists.

Plan: extract a shared `listChatHistoryFiles(dir)` helper in `log.ts` (or `utils.ts`) returning `{ fullPath, fileTimestampMs }[]`, use it in both places, remove the TODO.

### 31. `parseFrontMatter` rejects `\r\n` files and files without trailing newline after closing `---`

`src/context.ts:127-142` only matches `"---\n"` / `"\n---\n"`, so CRLF skill files are reported as malformed with a confusing error.

Plan: either normalize line endings before parsing or document the LF requirement; optionally improve the error message to mention line endings.
