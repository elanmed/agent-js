# agent-js

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
- Never use mocking — prefer dependency injection instead
- Always call the dependency parameter `deps`
- Always export a default deps object named `[functionName]Deps`
- Always define a matching type named `[FunctionName]Deps` (capital case), inferred from the default deps object
- If the inferred type is too wide and requires casting in tests (e.g., `fs` functions with multiple overloads), define an explicit interface with narrower types that match how the deps are actually used
- Never put selectors, actions, or dispatch in deps — read from state directly in functions, set state directly in tests
- Prefer `assert.deepStrictEqual` over multiple individual field assertions — check the whole object in one call
- Never use `content: result.content` in deepStrictEqual assertions — it's a tautology. Inline the actual expected value, or if the content is dynamic, use `content: result.content` in deepStrictEqual and then assert on the parsed content separately
- Only put IO or side-effecting dependencies in deps — pure utility functions like `tryCatch`, `getMessageFromError`, `stringify` should be imported directly, not injected. If a function needs to be swapped in tests (e.g. `fs`, `fetch`, `exec`), it belongs in deps. If it doesn't, it doesn't.
- For fs functions, use the `fsDeps` object from `fs-deps.ts`. In production, pass `fsDeps`. In tests, use `makeFsDeps()` to get an in-memory mock.
- In tests, create a `makeDeps` helper function that returns default fake dependencies, allowing individual tests to override specific deps via a partial object spread

### Example

Production code:

```ts
const fetchUserDeps = {
  db: createDb(),
  logger: createLogger(),
};

type FetchUserDeps = typeof fetchUserDeps;

const fetchUser = (id: string, deps: FetchUserDeps = fetchUserDeps) => {
  deps.logger.info("fetching user", { id });
  return deps.db.findById("users", id);
};
```

Test code:

```ts
function makeDeps(overrides: Partial<FetchUserDeps> = {}): FetchUserDeps {
  return {
    db: { findById: () => ({ id: "1", name: "Test User" }) },
    logger: { info: () => undefined },
    ...overrides,
  };
}

it("returns user from db", () => {
  const result = fetchUser("1", makeDeps());
  assert.deepStrictEqual(result, { id: "1", name: "Test User" });
});

it("handles db errors", () => {
  const deps = makeDeps({
    db: { findById: () => null },
  });
  const result = fetchUser("999", deps);
  assert.strictEqual(result, null);
});
```

### fsDeps Example

Production code:

```ts
import { fsDeps, type FsDeps } from "./fs-deps.ts";

export interface ReadConfigDeps {
  fs: FsDeps;
}

export const readConfigDeps: ReadConfigDeps = {
  fs: fsDeps,
};

export function readConfig(deps: ReadConfigDeps = readConfigDeps) {
  if (!deps.fs.existsSync("config.json")) return null;
  return JSON.parse(deps.fs.readFileSync("config.json").toString());
}
```

Test code:

```ts
import { makeFsDeps } from "./fs-deps.ts";

function makeDeps(overrides: Partial<ReadConfigDeps> = {}) {
  return {
    fs: makeFsDeps(),
    ...overrides,
  };
}

it("returns config when file exists", () => {
  const deps = makeDeps();
  deps.fs.files.set("config.json", '{"key": "value"}');
  const result = readConfig(deps);
  assert.deepStrictEqual(result, { key: "value" });
});

it("returns null when file does not exist", () => {
  const deps = makeDeps();
  const result = readConfig(deps);
  assert.strictEqual(result, null);
});
```
