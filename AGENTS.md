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

## Runtime

Node is used for development (running, testing, linting). Bun is used only to compile binaries (`npm run build:*`).

## Guidelines

- Never add comments
- Minimize diffs — only change what's necessary
- All changes must have test coverage
- Never use mocking — prefer dependency injection instead
- Always call the dependency parameter `deps`
- Always export a default deps object named `[functionName]Deps`
- Always define a matching type named `[FunctionName]Deps` (capital case), inferred from the default deps object
- Never put selectors, actions, or dispatch in deps — read from state directly in functions, set state directly in tests
- Prefer `assert.deepStrictEqual` over multiple individual field assertions — check the whole object in one call
- Never use `content: result.content` in deepStrictEqual assertions — it's a tautology. Inline the actual expected value, or if the content is dynamic, use `content: result.content` in deepStrictEqual and then assert on the parsed content separately
- Only put IO or side-effecting dependencies in deps — pure utility functions like `tryCatch`, `getMessageFromError`, `stringify` should be imported directly, not injected. If a function needs to be swapped in tests (e.g. `fs`, `fetch`, `exec`), it belongs in deps. If it doesn't, it doesn't.
### Example

```ts
const fetchUserDeps = {
  db: createDb(),
  logger: createLogger(),
};

type FetchUserDeps = typeof fetchUserDeps;

const fetchUser = (id: string, deps: FetchUserDeps) => {
  deps.logger.info("fetching user", { id });
  return deps.db.findById("users", id);
};
```
