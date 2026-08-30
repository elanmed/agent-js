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

---

## Medium

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

---

## Low / polish

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
