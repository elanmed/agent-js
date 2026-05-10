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
- Use `node:test` mocking (`mock.fn`, `mock.method`, `mock.module`, etc.) instead of dependency injection
- Never put selectors, actions, or dispatch in deps — read from state directly in functions, set state directly in tests
- Prefer `assert.deepStrictEqual` over multiple individual field assertions — check the whole object in one call
- Never use `content: result.content` in deepStrictEqual assertions — it's a tautology. Inline the actual expected value, or if the content is dynamic, use `content: result.content` in deepStrictEqual and then assert on the parsed content separately
- For fs functions, use the `fsDeps` object from `fs-deps.ts`. In production, pass `fsDeps`. In tests, use `makeFakeFsDeps()` to get an in-memory mock.
- Pure utility functions do not need deps — import and call them directly in tests. Only IO or side-effecting functions go in deps.

### fsDeps Example

Production code:

```ts
import { fsDeps, type FsDeps } from "./fs-deps.ts";

export function readConfig() {
  if (!fsDeps.existsSync("config.json")) return null;
  return JSON.parse(fsDeps.readFileSync("config.json").toString());
}
```

Test code:

```ts
import { makeFakeFsDeps, type FsDeps } from "./fs-deps.ts";

describe("readConfig", () => {
  let fs: FsDeps;

  beforeEach(() => {
    fs = makeFakeFsDeps();
  });

  it("returns config when file exists", () => {
    fs._files.set("config.json", '{"key": "value"}');
    const result = readConfig();
    assert.deepStrictEqual(result, { key: "value" });
  });

  it("returns null when file does not exist", () => {
    const result = readConfig();
    assert.strictEqual(result, null);
  });
});
```
