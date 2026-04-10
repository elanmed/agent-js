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
