# `agent-js`

A minimal agent implementation

## Features

- 3 dependencies: [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), [`globby`](https://www.npmjs.com/package/globby), [`zod`](https://www.npmjs.com/package/zod)
- Strictest typescript around
- No build step: uses Node's native type stripping

## TODO

- [x] Basic readline loop with cancellation
- [x] Basic API calls
- [x] API calls with streaming
- [x] Streaming with cancellation
- [x] Test infrastructure
- [x] Pretty terminal output
- [ ] Allow pasting content without submitting
- [ ] Convert to Deno for executable
- [x] Settings file
  - [x] ~/.config/agent-js/agent-js.settings.json
  - [x] ./agent-js.settings.json
  - [x] Model
  - [x] Disable session cost prompt
  - [x] Session cost object
- [x] AGENTS.md support
- [ ] Tool support
  - [x] Bash tool
  - [x] Create file tool
  - [x] Read file tool
  - [x] Insert lines in file tool
  - [x] Replaces string in file tool
  - [ ] Web search tool?
- [ ] ...
- [ ] Skill support
