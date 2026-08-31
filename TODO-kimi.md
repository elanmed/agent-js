# Audit findings

Verified state: `tsc`, `eslint src`, all 419 tests, and `prettier --check` pass. Line counts in README (3,100 src / 6,400 tests) are accurate (actual: 3,171 / 6,408).

## Bugs

### 5. `execGitDiff` exit-code handling breaks when piping through `delta`

`src/tools.ts:584-597`: the `error.code !== 1` carve-out (git diff exits 1 when there are differences) only works without the pipe. With `| delta`, the pipeline exit code is delta's, so real git failures (e.g. exit 128) are silently swallowed and no error surfaces.

Plan: use `set -o pipefail` in the command, or check stderr content / run git diff separately from the delta pretty-printing step.
