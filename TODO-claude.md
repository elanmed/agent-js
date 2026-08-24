# agent-js audit — TODO

Findings from a read-through of `src/`. Grouped by severity. Each item has a
short repro/why-it's-a-bug note and a fix plan.

---

## Critical

### 1. `appendModelUsage` assumes `usage.inputTokenDetails` always exists

**File:** `src/usage.ts`

```ts
cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
```

Every test constructs `LanguageModelUsage` with `inputTokenDetails` explicitly
set (via `as LanguageModelUsage` casts), so this is never exercised with a
missing/undefined `inputTokenDetails`. The real `ai` SDK's `LanguageModelUsage`
type does not guarantee a nested `inputTokenDetails` object for every
provider/model — if it's ever `undefined` this throws
`TypeError: Cannot read properties of undefined`, which is uncaught and
propagates all the way to `main()`'s top-level catch, killing the whole
session on a single bad turn.

**Fix:** Guard the read: `usage.inputTokenDetails?.cacheReadTokens ?? 0`
(same for cacheWrite). Add a unit test that calls `appendModelUsage` with
`inputTokenDetails` entirely omitted. Double check the actual runtime shape
returned by the installed `ai` version against this assumption (the field
name may not even be `inputTokenDetails` — verify against `ai`'s type defs).

### 2. Compaction API call's usage/cost is never tracked

**File:** `src/api.ts` — `maybeCompactMessageParams`

The compaction call goes straight through `aiDeps.generateText(...)` and never
calls `appendModelUsage`. Compaction consumes real tokens (and costs real
money against `usageLimitDollar`), but:

- `/usage` and the fence line under-report actual spend for the session.
- The dollar-based usage limit silently misses this cost, so a user relying
  on `usageLimitDollar` to cap spend can go over budget without the tool ever
  reflecting it.

**Fix:** Call `appendModelUsage(totalUsage)` (or an equivalent) after the
compaction `generateText` call succeeds, same as `resolveApiCall` does.

### 3. Tool-call callbacks can throw uncaught inside `generateText`

**File:** `src/api.ts` — `experimental_onToolCallStart` / `...Finish`

```ts
const { path } = objectWithPathSchema.parse(toolCall.input);
```

If the model produces a malformed `str_replace`/`insert_lines` tool call
(e.g. missing `path`, or the arg parsing schema mismatches whatever the
provider returns), `.parse` throws a `ZodError` synchronously inside a
callback that isn't wrapped in `tryCatch`. This isn't guarded by the outer
`tryCatchAsync` around `generateText` in the way you'd hope — depending on
where in the SDK's execution loop the callback fires, this can crash the
whole turn ungracefully instead of failing that one tool call.

**Fix:** Wrap the `.parse(...)` (and the temp-file bookkeeping around it) in
`tryCatch`, and on failure, skip the diff-printing/temp-file logic instead of
throwing. Add a test with an intentionally malformed tool call input.

---

## High

### 4. Switching models mid-session corrupts token accounting

**File:** `src/api.ts` — `resolveApiCall`

```ts
const allInputTokens = totalUsage.inputTokens ?? 0;
const tokensForInputMessageParam =
  allInputTokens - getState().app.messageParams.tokens;
```

This assumes `totalUsage.inputTokens` (reported by the _current_ model/
tokenizer) is directly comparable to the running `messageParams.tokens` total
(which may have been accumulated under a _different_ model's tokenizer, via
`/model <new-model>`). Switching models mid-conversation can produce a wildly
different token count for the same message history, making
`tokensForInputMessageParam` go negative or nonsensical. This then gets
written into `messageParams.tokens` via `appendToMessageParams`, silently
poisoning the running total used for context-window-usage percentage and
future compaction decisions.

**Fix:** Either (a) clamp `tokensForInputMessageParam` to `>= 0`, or (b) on
`/model` change, mark the token accounting as "unknown" and re-derive it from
the next API response instead of doing a delta against a total computed under
the old model. At minimum, add a regression test: append messages under model
A, switch to model B via `/model`, call `resolveApiCall` again, and assert
`messageParams.tokens` doesn't go negative.

### 5. `/resume` can inject a transcript larger than the context window with no compaction check

**File:** `src/input.ts` — `resumeCommand`; `src/index.ts` — main loop

`resumeCommand` calls `actions.resetMessageParams()` (tokens → 0) and returns
the raw transcript text as the next "user input". The main loop's
`maybeCompactMessageParams()` runs _before_ `resolveUserInput`, so it checks
against the just-reset (zero) token count and does nothing. The transcript is
then sent as a single user message with zero preceding compaction, and can
exceed `contextWindowPerModel[model]` outright on the very first call after a
resume.

**Fix:** After building the resume transcript, either (a) run it through the
same compaction routine used by `maybeCompactMessageParams` before returning
it as user input, or (b) estimate its token size and warn/refuse if it's
already over the compaction threshold, prompting the user to resume from a
different session or accept a lossy summary.

### 6. `truncate()` produces garbage output when stdout is not a TTY

**File:** `src/utils.ts` — `truncate`

```ts
const maxLen = 0.9 * processDeps.stdout.getColumns();
```

`process.stdout.columns` is `undefined` when stdout isn't a TTY (piped
output, redirected to a file, running in some CI/non-interactive contexts).
`0.9 * undefined` is `NaN`, and `str.substring(0, NaN)` treats `NaN` as `0`,
so every truncated string collapses to just `"…"`. This is used both for the
edited-content preview (`abortRlQuestionForEditor`) and for `toolPrint`
labels shown for every tool call — in a non-TTY environment, all of these
become useless single-ellipsis output.

**Fix:** Default to a sane column width (e.g. `80`) when
`processDeps.stdout.getColumns()` is falsy/`NaN`. Add a test that mocks
`getColumns()` to return `undefined` and asserts `truncate` still returns
meaningful content.

### 7. `getPrettyApiDuration` produces negative durations on clock skew

**File:** `src/print.ts`

```ts
const diff = endTime - startTime;
const prettyMs = `${String(diff % 1_000)}ms`;
```

If the system clock is adjusted backwards between `setApiStartTime()` and
`setApiEndTime()` (NTP sync, VM pause/resume, etc.), `diff` can be negative.
`diff % 1000` for a negative number in JS returns a negative remainder,
producing output like `"-500ms"` in the session-info fence line.

**Fix:** Clamp `diff` to `Math.max(0, endTime - startTime)` before computing
the pretty string, or switch to `process.hrtime.bigint()`/`performance.now()`
for a monotonic clock instead of `Date.now()`.

---

## Medium

### 8. No validation that `compactTargetRatio < compactAtContextRatio`

**File:** `src/config.ts` — `ConfigSchema`

Both ratios are independently validated to be in `[0, 1]`, but nothing
prevents `compactTargetRatio >= compactAtContextRatio` (e.g. target `0.8`,
trigger `0.7`). If a compaction summary doesn't actually shrink the
conversation below the trigger ratio (plausible if the model doesn't follow
the "compact to roughly N tokens" instruction precisely), every subsequent
turn re-triggers compaction, burning tokens/money on repeated no-op
summarization.

**Fix:** Add a schema-level `.refine` (or a post-merge assertion in
`initStateFromConfig`) requiring `compactTargetRatio < compactAtContextRatio`,
with a clear error message. Consider also asserting the _post_-compaction
token count is actually below the target as a safety net, logging a warning
if not.

### 9. `usageLimitDuration` accepts a negative numeric prefix

**File:** `src/config.ts` — `ConfigSchema.usageLimitDuration` refine

The refine only checks that the prefix parses as a number and the suffix is
one of `s/m/h/d` — `"-5m"` passes validation. `getExpiredTime()` would then
compute `expiredTime = now - (negative duration)`, i.e. a time in the
_future_, which would cause `filterExpiredModelUsage` to treat effectively
all usage as "expired" (since `usage.date >= expiredTime` would rarely hold)
or behave unpredictably depending on data.

**Fix:** Extend the refine to reject a negative or zero prefix
(`Number(prefix) > 0`).

### 10. Duplicated "parse `chat-history-<timestamp>.txt`" logic

**Files:** `src/log.ts` (`deleteExpiredPromptHistory`) and `src/input.ts`
(`resumeCommand`)

Both independently re-implement the same filename-parsing logic (split on
`-`, check `parts.length === 3`, check prefix, parse timestamp). There's
literally a `// TODO: reuse this logic` comment in `log.ts` marking this.
Any future change to the naming scheme requires updating both call sites in
lockstep, and it's easy to update one and forget the other.

**Fix:** Extract a shared helper, e.g.
`parseChatHistoryFilename(name: string): number | null`, used by both
`deleteExpiredPromptHistory` and `resumeCommand`.

### 11. `bat` unavailability is reported inconsistently

**File:** `src/print.ts` — `executeBat`

When `checkBat()` reports bat is unavailable, the user is explicitly warned
(`"`bat` is not available, falling back to plain text rendering"`). When
`spawnBat` throws for any other reason (bat exists per `--version` but the
actual invocation fails), the fallback to plain text happens silently with no
warning at all. A user debugging "why isn't my output rendering with syntax
highlighting" gets no signal in the second case.

**Fix:** Print the same (or a more specific) warning in the `spawnBat` throw
path before falling back to plain content.

### 12. Read-modify-write of the shared usage log has no locking

**File:** `src/usage.ts` — `syncNewModelUsageForLimitWindow`

Each API call reads the whole `usage.json`, appends an entry, filters
expired entries, and rewrites the entire file. If two `agent-js` processes
run concurrently against the same global config dir (two terminal tabs), the
read-modify-write is not atomic — one process's usage entry can be lost to a
last-write-wins race, undercounting usage against `usageLimitDollar`.

**Fix:** At minimum document this as a known limitation for concurrent
sessions. If it needs to be correct, switch to append-only writes (never
rewrite/filter on every call — only filter/compact periodically or on read)
plus a simple file lock (e.g. `proper-lockfile`) around the read-modify-write.

### 13. Unverified assumption about the `ai` SDK's usage shape

**File:** `src/usage.ts`, `src/api.ts`

The whole cache-token accounting path (`inputTokenDetails.cacheReadTokens`/
`cacheWriteTokens`) is only ever validated against hand-constructed test
fixtures (`as LanguageModelUsage`), never against a real response from the
installed `ai` package. If the SDK's actual `LanguageModelUsage` shape
differs (different field names, or cache stats reported at the top level
instead of nested), cache pricing (`cacheReadPerToken`/`cacheWritePerToken`)
is silently always computed as `0`/`undefined`-defaulted, and cost estimates
would be wrong across the board, not just in an edge case.

**Fix:** Add an integration smoke test (or at least a manual check) that logs
the raw `totalUsage` object returned by a live `generateText` call against
the configured provider, and confirms the fields the code reads actually
exist. Pin/document the `ai` package version this shape was verified against.

---

## Low / polish

### 14. `getPrettyApiDuration` omits "0s" when minutes but no seconds

**File:** `src/print.ts`

For a duration like exactly 2 minutes flat, output is `"2m 0ms"` — the
seconds segment is dropped entirely (only rendered when `sec > 0`), which
reads oddly next to milliseconds. Not incorrect, just inconsistent
formatting.

**Fix:** Always render the seconds segment once minutes are present (i.e.
also show `"0s "` when `min > 0 && sec === 0`), or restructure as a single
formatter that always shows every unit down to the smallest nonzero one.

### 15. Dead/redundant `editorInputValue === null` check

**File:** `src/input.ts` — `resolveUserInput`

```ts
if (getState().app.editorInputValue === null && rawInput.at(0) === "/") {
```

By the time this line runs, the function has already returned early if
`editorInputValue !== null` (top of the function), and the only other place
`editorInputValue` gets set (`abortRlQuestionForEditor`) always pairs with
aborting `rl.question`, which is handled in the `!inputResult.ok` branch
above. So this condition is always true when reached — harmless, but
confusing to future readers who'll assume it's reachable as false.

**Fix:** Drop the redundant check (`if (rawInput.at(0) === "/")`), or add a
comment explaining why it's defensive if you want to keep it as a guard
against future refactors.

### 16. `executeStrReplaceTool` occurrence counting can undercount overlapping matches

**File:** `src/tools.ts`

```ts
const occurrences = content.split(old_str).length - 1;
```

`String.split` doesn't count overlapping occurrences (e.g. `"aaa".split("aa")`
→ 1 split, not 2), so a genuinely ambiguous `old_str` that only matches via
overlap could be treated as unique when it isn't, replacing the wrong
occurrence's worth of text semantics-wise. Rare in practice for typical code
edits, but worth knowing.

**Fix:** If this matters, use a manual overlap-aware count (`indexOf` in a
loop advancing by 1 instead of by `old_str.length`) instead of `split`.

### 17. Config allows `baseURL` to be silently ignored for the `anthropic` provider

**File:** `src/api.ts` — `getLanguageModel`; `src/config.ts`

A user can set `provider: "anthropic"` and also set `baseURL` (schema doesn't
forbid it), but `getLanguageModel()` only ever reads `baseURL` for the
`openai-compatible` branch. Someone trying to point the Anthropic client at a
proxy via `baseURL` will have it silently do nothing.

**Fix:** Either wire `baseURL` through to `createAnthropic({ baseURL, ... })`
as well, or have config validation reject `baseURL` when
`provider === "anthropic"` with a clear error, so the mistake surfaces
immediately instead of silently no-opping.

---

## Suggested order of work

1. #1, #2, #3 — crash/cost-correctness bugs, low effort, high value.
2. #6, #7 — cheap, isolated fixes with easy regression tests.
3. #4, #5 — token accounting correctness; needs a bit more design thought
   (what "correct" means across a model switch or resume).
4. #8, #9, #12, #13 — config/validation hardening and verifying the `ai` SDK
   assumption, since everything else in the cost-tracking story rests on it.
5. #10, #11, #14–#17 — cleanup, can be batched into one pass.
