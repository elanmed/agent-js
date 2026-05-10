# agent-js

You are running in a container. Make all changes to `/agent-js` at the root of the filesystem.

This is a Node.js project. Only Node.js APIs should be used. Use `node` for running and testing, and `pnpm` as the package manager. Run `pnpm install` after pulling changes.

## Development

After every change, run linting, types, and tests:

```
npm run lint
npm run types
npm run test
```

Or all at once:

```
npm run ci
```

## Guidelines

- Never add comments
- Minimize diffs — only change what's necessary
- All changes must have test coverage
- Use `node:test` for tests and `node:assert` for assertions
- Use `node:test` mocking (`mock.fn`, `mock.method`, `mock.module`, etc.) instead of dependency injection. Some existing code still uses DI (`deps` parameters) — do not add new DI; prefer mocking for new code and migrate existing DI when touching those files.
- Never put selectors, actions, or dispatch in deps (legacy DI deps sometimes still have them — remove when migrating to mocking)
- Prefer `assert.deepStrictEqual` over multiple individual field assertions — check the whole object in one call
- Never use `content: result.content` in deepStrictEqual assertions — it's a tautology. Inline the actual expected value
- For fs, import `fsDeps` directly in production code — no dependency injection. In tests, use `setupFakeFs()` from `test-helpers.ts` to mock all fs methods globally, and use `testFs._files` / `testFs._dirs` / `testFs._globResults` to set up fixture state. Import `testFs` and `setupFakeFs` from `./test-helpers.ts`.
- Pure utility functions do not need deps — import and call them directly in tests.

### fs mocking example

Production code:

```ts
import { fsDeps } from "./fs-deps.ts";

export function readConfig() {
  if (!fsDeps.existsSync("config.json")) return null;
  return JSON.parse(fsDeps.readFileSync("config.json").toString());
}
```

Test code:

```ts
import { testFs, setupFakeFs } from "./test-helpers.ts";

describe("readConfig", () => {
  beforeEach(() => {
    setupFakeFs();
  });

  it("returns config when file exists", () => {
    testFs._files.set("config.json", '{"key": "value"}');
    const result = readConfig();
    assert.deepStrictEqual(result, { key: "value" });
  });

  it("returns null when file does not exist", () => {
    const result = readConfig();
    assert.strictEqual(result, null);
  });
});
```

### mocking other built-ins

Use `mock.method` from `node:test` — pass the module and method name with a replacement function. Restore is automatic between tests.

```ts
import { mock } from "node:test";
import os from "node:os";
import crypto from "node:crypto";

beforeEach(() => {
  mock.method(os, "tmpdir", () => "/tmp");
  mock.method(crypto, "randomUUID", () => "test-uuid");
});
```
