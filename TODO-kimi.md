# Audit findings

Verified state: `tsc`, `eslint src`, all 419 tests, and `prettier --check` pass. Line counts in README (3,100 src / 6,400 tests) are accurate (actual: 3,171 / 6,408).

## Bugs

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
