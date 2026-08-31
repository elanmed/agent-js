# agent-js audit — TODO

---

## High

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
