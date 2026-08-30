# Audit findings

Verified state: `tsc`, `eslint src`, all 419 tests, and `prettier --check` pass. Line counts in README (3,100 src / 6,400 tests) are accurate (actual: 3,171 / 6,408).

## Bugs

### 1. Compaction API usage is not cost-tracked

`src/api.ts` `maybeCompactMessageParams()` destructures `totalUsage` but never calls `appendModelUsage(totalUsage)`, unlike `resolveApiCall()`. Dollars/tokens spent on compaction calls are invisible to `/usage` and the usage limit window.

Plan: call `appendModelUsage(totalUsage)` in `maybeCompactMessageParams()` after a successful result; add a test asserting usage is appended after compaction.

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

## Code style / consistency

### 20. Truthy checks violate the project's own AGENTS.md rule

AGENTS.md bans truthy/falsy coercion (`if (obj)`), but the codebase has: `src/config.ts:203` `if (defaultedBaseURL)`, `src/api.ts:28,39` `apiKey && { apiKey }`, `src/input.ts:111,147,206,212` (`if (rl.line.length)`, `if (questionAbortController)`, `if (apiStream)`, `if (question)`), `src/print.ts:48` `if (color)`, `src/args.ts:17` `while (args.length)`, `src/tools.ts:340,567` (`if (signal)`, `diffResult.value.stdout`).

Plan: replace with explicit `!== null` / `!== undefined` / `!== ""` / `.length > 0` comparisons. Optionally add `grit`/eslint rule `@typescript-eslint/strict-boolean-expressions` to enforce it.
