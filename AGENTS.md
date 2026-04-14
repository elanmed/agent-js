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
- Never put selectors, actions, or dispatch in deps — set state directly in tests
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
