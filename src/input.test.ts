import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { actions, getState } from "./state.ts";
import {
  resolveSlashCommand,
  resolveUserInput,
  getModel,
  setModelCommand,
  isSameKey,
  getAvailableSlashCommands,
  clearCommand,
  printSkills,
  printContextFiles,
  printCommands,
  pageContextFiles,
  spawnAndReadEditorContent,
  resume,
} from "./input.ts";
import {
  testFs,
  testProcessEnv,
  setupTestContext,
  setupKeypressTests,
  makeFakeRl,
  mockClipboardPaste,
  mockExec,
  mockPagerSpawn,
  mockBatAvailable,
  batPagerCmd,
  stripAnsi,
} from "./test-helpers.ts";
import { fsDeps } from "./deps.ts";
import childProcess from "node:child_process";
import { getGlobalConfigPath, getGlobalContextDir } from "./paths.ts";

describe("input", () => {
  beforeEach(() => {
    setupTestContext();
  });

  describe("spawnAndReadEditorContent", () => {
    let spawned: string[];

    beforeEach(() => {
      spawned = [];
      actions.setRl(makeFakeRl({ line: "" }));
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned.push(cmd);
      });
    });

    it("returns null when writeFile fails", async () => {
      mock.method(fsDeps, "writeFileSync", () => {
        throw new Error("write failed");
      });
      const result = await spawnAndReadEditorContent();
      assert.strictEqual(result, null);
    });

    it("returns null and cleans up when readFile fails", async () => {
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "modified");
      });
      mock.method(fsDeps, "readFileSync", () => {
        throw new Error("read failed");
      });
      const result = await spawnAndReadEditorContent();
      assert.strictEqual(result, null);
      assert.strictEqual(
        testFs._files.has("/tmp/agent-js-test-uuid.txt"),
        false,
      );
    });

    it("returns null when editor returns empty content", async () => {
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "");
      });
      const result = await spawnAndReadEditorContent();
      assert.strictEqual(result, null);
    });

    it("returns normalized content", async () => {
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "  hello  ");
      });
      const result = await spawnAndReadEditorContent();
      assert.strictEqual(result, "hello\n");
    });

    it("uses AGENT_JS_EDIT env var with __FILE__ when available", async () => {
      testProcessEnv._set("AGENT_JS_EDIT", "nano __FILE__");
      await spawnAndReadEditorContent();
      assert.strictEqual(spawned[0], "nano /tmp/agent-js-test-uuid.txt");
    });

    it("falls back to EDITOR env var when AGENT_JS_EDIT is not set", async () => {
      testProcessEnv._set("EDITOR", "vim");
      await spawnAndReadEditorContent();
      assert.strictEqual(spawned[0], "vim /tmp/agent-js-test-uuid.txt");
    });

    it("falls back to vi when no editor env vars are set", async () => {
      await spawnAndReadEditorContent();
      assert.strictEqual(spawned[0], "vi /tmp/agent-js-test-uuid.txt");
    });

    it("returns normalized content when editor saves unchanged content", async () => {
      actions.setRl(makeFakeRl({ line: "hello" }));
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "hello");
      });
      const result = await spawnAndReadEditorContent();
      assert.strictEqual(result, "hello\n");
    });

    it("includes clipboard content when includeClipboardSuffix is true", async () => {
      actions.setRl(makeFakeRl({ line: "hello " }));
      mockClipboardPaste("world");
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync(
          "/tmp/agent-js-test-uuid.txt",
          "  hello world modified  \n",
        );
      });
      const result = await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
      assert.strictEqual(result, "hello world modified\n");
    });

    it("returns content when includeClipboardSuffix is true and editor saves unchanged content", async () => {
      actions.setRl(makeFakeRl({ line: "query" }));
      mockClipboardPaste("clip");
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "queryclip");
      });
      const result = await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
      assert.strictEqual(result, "queryclip\n");
    });

    it("returns null when includeClipboardSuffix is true and editor is closed without saving", async () => {
      actions.setRl(makeFakeRl({ line: "query" }));
      mockClipboardPaste("clip");
      const result = await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
      assert.strictEqual(result, null);
    });
  });

  describe("resolveUserInput", () => {
    beforeEach(() => {
      actions.resetStdout();
      actions.setRl(makeFakeRl());
    });

    it("returns editor input value when set and clears it", async () => {
      actions.setChatHistoryPath("/tmp/test-history.log");
      actions.setEditorInputValue("editor content");
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "editor content");
      assert.strictEqual(getState().app.editorInputValue, null);
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z  [user]
editor content

`,
      );
    });

    it("returns trimmed user input", async () => {
      mock.method(getState().app.rl!, "question", () =>
        Promise.resolve("  hello  "),
      );
      actions.setChatHistoryPath("/tmp/test-history.log");
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "hello");
      assert.strictEqual(stripAnsi(getState().app.stdout), ">   hello  \n");
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z  [user]
hello

`,
      );
    });

    it("resolves slash commands when input starts with /", async () => {
      actions.setChatHistoryPath("/tmp/test-history.log");
      actions.setModel("old");
      actions.resetStdout();
      mock.method(getState().app.rl!, "question", () =>
        Promise.resolve("/model new-model"),
      );
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, null);
      assert.strictEqual(getState().config.model, "new-model");
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z  [user]
/model new-model

`,
      );
    });

    it("returns null and prints error on non-abort error", async () => {
      mock.method(getState().app.rl!, "question", () =>
        Promise.reject(new Error("read failed")),
      );
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, null);
      assert.strictEqual(stripAnsi(getState().app.stdout), "read failed\n");
    });

    it("returns editor value when aborted by editor", async () => {
      actions.setChatHistoryPath("/tmp/test-history.log");
      mock.method(getState().app.rl!, "question", () => {
        actions.setEditorInputValue("from editor");
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "from editor");
      assert.strictEqual(getState().app.editorInputValue, null);
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z  [user]
from editor

`,
      );
    });

    it("exits on abort during exit confirmation", async () => {
      mock.method(process, "exit", () => {
        throw new Error("process.exit called");
      });
      const questionMock = mock.method(getState().app.rl!, "question", () => {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });
      await assert.rejects(
        resolveUserInput({ isFirstInput: false }),
        /process.exit called/,
      );
      assert.strictEqual(questionMock.mock.callCount(), 2);
    });

    it("returns null when user declines exit confirmation", async () => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      const questionMock = mock.method(getState().app.rl!, "question", () =>
        Promise.resolve("n"),
      );
      questionMock.mock.mockImplementationOnce(() => Promise.reject(err));
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, null);
      assert.strictEqual(questionMock.mock.callCount(), 2);
    });

    it("exits when user confirms exit confirmation", async () => {
      mock.method(process, "exit", () => {
        throw new Error("process.exit called");
      });
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      const questionMock = mock.method(getState().app.rl!, "question", () =>
        Promise.resolve("yes"),
      );
      questionMock.mock.mockImplementationOnce(() => Promise.reject(err));
      await assert.rejects(
        resolveUserInput({ isFirstInput: false }),
        /process.exit called/,
      );
      assert.strictEqual(questionMock.mock.callCount(), 2);
    });

    it("prints session start date when exiting", async () => {
      mock.method(process, "exit", () => {
        throw new Error("process.exit called");
      });
      mock.method(Date, "now", () => 42_000);
      actions.setSessionStartDate();
      actions.resetStdout();
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      const questionMock = mock.method(getState().app.rl!, "question", () =>
        Promise.resolve("yes"),
      );
      questionMock.mock.mockImplementationOnce(() => Promise.reject(err));
      await assert.rejects(
        resolveUserInput({ isFirstInput: false }),
        /process.exit called/,
      );
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `> yes
Resume this session with /resume 42000
`,
      );
    });
  });

  describe("setModelCommand", () => {
    beforeEach(() => {
      actions.resetStdout();
    });

    it("sets model and prints blue confirmation when input is valid", async () => {
      actions.setModel("old-model");
      await setModelCommand("/model new-model");
      assert.strictEqual(getState().config.model, "new-model");
      assert.strictEqual(getState().app.messageParams.tokensStale, true);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Model updated from `old-model` to `new-model`\n",
      );
    });

    it("prints red error when input has too many parts", async () => {
      actions.setModel("old-model");
      await setModelCommand("/model new-model extra");
      assert.strictEqual(getState().config.model, "old-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /model [model]?\n",
      );
    });

    it("prints red error when input has only the command", async () => {
      actions.setModel("old-model");
      await setModelCommand("/model");
      assert.strictEqual(getState().config.model, "old-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /model [model]?\n",
      );
    });

    it("handles model name with slashes", async () => {
      actions.setModel("old");
      await setModelCommand("/model provider/new-model");
      assert.strictEqual(getState().config.model, "provider/new-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Model updated from `old` to `provider/new-model`\n",
      );
    });

    it("handles input with multiple spaces", async () => {
      actions.setModel("old");
      await setModelCommand("/model   new-model");
      assert.strictEqual(getState().config.model, "new-model");
    });

    it("handles input with tabs", async () => {
      actions.setModel("old");
      await setModelCommand("/model\tnew-model");
      assert.strictEqual(getState().config.model, "new-model");
    });
  });

  describe("getModel", () => {
    beforeEach(() => {
      actions.resetStdout();
    });

    it("prints current model", async () => {
      actions.setModel("gpt-4");
      await getModel();
      assert.strictEqual(stripAnsi(getState().app.stdout), "gpt-4\n");
    });
  });

  describe("clearCommand", () => {
    beforeEach(() => {
      actions.resetStdout();
    });

    it("resets params", async () => {
      actions.appendToMessageParams({ role: "user", content: "hello" });
      await clearCommand();
      assert.deepStrictEqual(getState().app.messageParams, {
        tokens: 0,
        tokensStale: false,
        messages: [],
      });
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Context cleared (0 tokens in session)\n",
      );
    });
  });

  describe("resume", () => {
    beforeEach(() => {
      actions.resetStdout();
    });

    it("prints usage error when no session start date is provided", async () => {
      const result = await resume("/resume");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /resume [session start date]\n",
      );
    });

    it("prints usage error when too many parts are provided", async () => {
      const result = await resume("/resume 123 456");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /resume [session start date]\n",
      );
    });

    it("prints usage error when session start date is not a number", async () => {
      const result = await resume("/resume abc");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /resume [session start date]\n",
      );
    });

    it("prints error when history directory does not exist", async () => {
      const result = await resume("/resume 1234567890000");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "No conversation found with session start date: 1234567890000\n",
      );
    });

    it("returns transcript and resets message params when conversation is found", async () => {
      actions.appendToMessageParams({ role: "user", content: "hello" });
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-1234567890000.txt",
        "transcript content",
      );
      const result = await resume("/resume 1234567890000");
      assert.strictEqual(
        result,
        `Continue the conversation recorded in the transcript below. Respond to this message with "Ready to continue chatting."
Transcript:
transcript content
    `,
      );
      assert.deepStrictEqual(getState().app.messageParams, {
        tokens: 0,
        tokensStale: false,
        messages: [],
      });
    });

    it("prints error when no conversation is found", async () => {
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-9999999999999.txt",
        "transcript content",
      );
      const result = await resume("/resume 1234567890000");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "No conversation found with session start date: 1234567890000\n",
      );
    });

    it("skips files that do not match the chat-history format", async () => {
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._files.set(
        "/fake-home/.config/agent-js/history/other-1234567890000.txt",
        "other",
      );
      const result = await resume("/resume 1234567890000");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "No conversation found with session start date: 1234567890000\n",
      );
    });
  });

  describe("pageContextFiles", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints no available context files when entries list is empty", async () => {
      await pageContextFiles();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available context files
`,
      );
    });

    it("opens context string in a pager via AGENT_JS_PAGER_CONTEXT", async () => {
      const { spawned } = mockPagerSpawn();
      testProcessEnv._set("AGENT_JS_PAGER_CONTEXT", "nano __FILE__");
      actions.setContextStr("context string content");
      actions.setContextEntries([
        { filePath: "/project/AGENTS.md", content: "context" },
      ]);
      await pageContextFiles();
      assert.strictEqual(spawned[0], "nano /tmp/agent-js-test-uuid.txt");
    });

    it("copies context string into the temp file", async () => {
      actions.setContextStr("context string content");
      actions.setContextEntries([
        { filePath: "/project/AGENTS.md", content: "context" },
      ]);
      await pageContextFiles();
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "context string content",
      );
      assert.strictEqual(getState().app.stdout, "");
    });
  });

  describe("printSkills", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints available skills", async () => {
      actions.setSkills([
        {
          name: "test-skill",
          description: "A test skill",
          dir: "/skills/test-skill",
          content: "skill content",
        },
      ]);
      await printSkills();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available skills:
- test-skill: A test skill
  /skills/test-skill
`,
      );
    });

    it("prints no available skills when skills list is empty", async () => {
      await printSkills();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available skills
`,
      );
    });

    it("filters out context file skills", async () => {
      actions.setSkills([
        {
          name: "__agent-js-context-for-/ctx",
          description: "Context for /ctx",
          dir: "/ctx",
          content: "context content",
        },
        {
          name: "real-skill",
          description: "A real skill",
          dir: "/skills/real",
          content: "skill content",
        },
      ]);
      await printSkills();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available skills:
- real-skill: A real skill
  /skills/real
`,
      );
    });
  });

  describe("printContextFiles", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints available context files", async () => {
      actions.setContextEntries([
        { filePath: "/project/AGENTS.md", content: "context" },
      ]);
      await printContextFiles();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available context files:
- /project/AGENTS.md
`,
      );
    });

    it("prints no available context files when entries list is empty", async () => {
      await printContextFiles();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available context files
`,
      );
    });

    it("includes context file skills", async () => {
      actions.setContextEntries([
        { filePath: "/project/AGENTS.md", content: "context" },
      ]);
      actions.setSkills([
        {
          name: "__agent-js-context-for-/other",
          description: "Context for /other",
          dir: "/other",
          content: "other context",
        },
        {
          name: "regular-skill",
          description: "A regular skill",
          dir: "/skills/regular",
          content: "skill content",
        },
      ]);
      await printContextFiles();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available context files:
- /project/AGENTS.md
- /other/AGENTS.md (as a skill)
`,
      );
    });
  });

  describe("printCommands", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints builtin and custom commands", async () => {
      actions.setSlashCommands([
        {
          name: "custom.md",
          filePath: "/test/.agent-js/commands/custom.md",
          content: "custom",
        },
      ]);
      await printCommands();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available commands:
- /edit
- /history
- /clear
- /paste
- /model
- /skills
- /context
- /context-str
- /commands
- /commands-str
- /keymaps
- /usage
- /resume
- /config
- /reload
- /test/.agent-js/commands/custom.md
`,
      );
    });
  });

  describe("initKeypress", () => {
    let harness: ReturnType<typeof setupKeypressTests>;

    beforeEach(() => {
      actions.setSlashCommands([
        {
          name: "custom",
          filePath: "/test/.agent-js/commands/custom.md",
          content: "custom command content",
        },
      ]);
      actions.setKeymap("custom", { name: "c", ctrl: true });
      harness = setupKeypressTests();
    });

    afterEach(() => {
      harness.cleanup();
    });

    it("types custom slash command into the prompt when its keymap matches", () => {
      harness.emitKey({ name: "c", ctrl: true });
      assert.strictEqual(getState().app.stdout, "/custom\n");
      assert.deepStrictEqual(harness.writes, [
        { chunk: "/custom\n", key: undefined },
      ]);
    });

    it("does not type custom slash command when no question is pending", () => {
      actions.setQuestionAbortController(null);
      harness.emitKey({ name: "c", ctrl: true });
      assert.strictEqual(getState().app.stdout, "");
      assert.deepStrictEqual(harness.writes, []);
    });

    it("does nothing on unmatched keys", () => {
      harness.emitKey({ name: "x", ctrl: true });
      assert.strictEqual(getState().app.stdout, "");
      assert.deepStrictEqual(harness.writes, []);
    });

    it("runs edit command when its keymap matches", async () => {
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "  edited  ");
      });
      harness.emitKey({ name: "g", ctrl: true });
      await harness.flush();
      assert.strictEqual(getState().app.editorInputValue, "edited\n");
    });

    it("runs paste command with clipboard when its keymap matches", async () => {
      mockClipboardPaste("world");
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync(
          "/tmp/agent-js-test-uuid.txt",
          "  hello world modified  \n",
        );
      });
      harness.emitKey({ name: "v", ctrl: true });
      await harness.flush();
      assert.strictEqual(
        getState().app.editorInputValue,
        "hello world modified\n",
      );
    });

    it("opens chat history in a pager when history keymap matches", async () => {
      const { spawned } = mockPagerSpawn();
      mockBatAvailable(true);
      actions.setKeymap("history", { name: "h", ctrl: true });
      actions.setChatHistoryPath("/tmp/editor.log");
      testFs._files.set("/tmp/editor.log", "log content");
      harness.emitKey({ name: "h", ctrl: true });
      await harness.flush();
      assert.strictEqual(
        spawned[0],
        batPagerCmd("/tmp/agent-js-test-uuid.txt"),
      );
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "log content",
      );
      assert.strictEqual(getState().app.stdout, "");
    });

    it("opens config in a pager when config keymap matches", () => {
      mock.method(childProcess, "spawnSync", () => undefined);
      actions.setKeymap("config", { name: "q", ctrl: true });
      harness.emitKey({ name: "q", ctrl: true });
      assert.match(
        testFs._files.get("/tmp/agent-js-test-uuid.txt") ?? "",
        /# Applied config/,
      );
      assert.strictEqual(getState().app.stdout, "");
    });

    it("opens context in a pager when context-str keymap matches", async () => {
      mock.method(childProcess, "spawnSync", () => undefined);
      actions.setKeymap("context-str", { name: "d", ctrl: true });
      actions.setContextEntries([
        { filePath: "/project/AGENTS.md", content: "context" },
      ]);
      actions.setContextStr("context string content");
      harness.emitKey({ name: "d", ctrl: true });
      await harness.flush();
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "context string content",
      );
      assert.strictEqual(getState().app.stdout, "");
    });

    it("opens custom commands in a pager when commands-str keymap matches", () => {
      mock.method(childProcess, "spawnSync", () => undefined);
      actions.setKeymap("commands-str", { name: "m", ctrl: true });
      harness.emitKey({ name: "m", ctrl: true });
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        `# /test/.agent-js/commands/custom.md
---
custom command content`,
      );
      assert.strictEqual(getState().app.stdout, "");
    });

    for (const [command, keyName] of [
      ["clear", "k"],
      ["model", "m"],
      ["skills", "l"],
      ["context", "n"],
      ["commands", "o"],
      ["keymaps", "p"],
      ["usage", "u"],
      ["resume", "r"],
    ] as const) {
      it(`types /${command} into the prompt when its keymap matches`, () => {
        actions.setKeymap(command, { name: keyName, ctrl: true });
        harness.emitKey({ name: keyName, ctrl: true });
        assert.strictEqual(getState().app.stdout, `/${command}\n`);
        assert.deepStrictEqual(harness.writes, [
          { chunk: `/${command}\n`, key: undefined },
        ]);
      });
    }

    it("does not type builtin command when no question is pending", () => {
      actions.setKeymap("clear", { name: "k", ctrl: true });
      actions.setQuestionAbortController(null);
      harness.emitKey({ name: "k", ctrl: true });
      assert.strictEqual(getState().app.stdout, "");
      assert.deepStrictEqual(harness.writes, []);
    });

    it("uses the first matching builtin keymap when commands share a key", () => {
      actions.setKeymap("clear", { name: "x", ctrl: true });
      actions.setKeymap("skills", { name: "x", ctrl: true });
      harness.emitKey({ name: "x", ctrl: true });
      assert.strictEqual(getState().app.stdout, "/clear\n");
    });

    it("prefers builtin commands over custom commands on the same key", () => {
      actions.setKeymap("clear", { name: "c", ctrl: true });
      harness.emitKey({ name: "c", ctrl: true });
      assert.strictEqual(getState().app.stdout, "/clear\n");
    });

    it("clears the line on unmatched keys during loading", () => {
      actions.setLoadingStateTimeout({} as NodeJS.Timeout);
      harness.emitKey({ name: "z", ctrl: true });
      assert.deepStrictEqual(harness.writes, [
        { chunk: null, key: { ctrl: true, name: "u" } },
      ]);
      assert.strictEqual(getState().app.stdout, "");
    });

    it("types keymap command while loading when a question is pending", () => {
      actions.setKeymap("clear", { name: "k", ctrl: true });
      actions.setLoadingStateTimeout({} as NodeJS.Timeout);
      harness.emitKey({ name: "k", ctrl: true });
      assert.strictEqual(getState().app.stdout, "/clear\n");
    });

    it("does not clear the line for matched keys during loading", () => {
      actions.setKeymap("clear", { name: "k", ctrl: true });
      actions.setQuestionAbortController(null);
      actions.setLoadingStateTimeout({} as NodeJS.Timeout);
      harness.emitKey({ name: "k", ctrl: true });
      assert.strictEqual(getState().app.stdout, "");
      assert.deepStrictEqual(harness.writes, []);
    });
  });

  describe("isSameKey", () => {
    it("returns true when all fields match", () => {
      assert.equal(
        isSameKey(
          { name: "e", ctrl: true, meta: false, shift: false },
          { name: "e", ctrl: true, meta: false, shift: false },
        ),
        true,
      );
    });

    it("returns false when name differs", () => {
      assert.equal(
        isSameKey(
          { name: "e", ctrl: true, meta: false, shift: false },
          { name: "x", ctrl: true, meta: false, shift: false },
        ),
        false,
      );
    });

    it("returns false when ctrl differs", () => {
      assert.equal(
        isSameKey(
          { name: "e", ctrl: true, meta: false, shift: false },
          { name: "e", ctrl: false, meta: false, shift: false },
        ),
        false,
      );
    });

    it("returns false when meta differs", () => {
      assert.equal(
        isSameKey(
          { name: "x", ctrl: false, meta: true, shift: false },
          { name: "x", ctrl: false, meta: false, shift: false },
        ),
        false,
      );
    });

    it("returns false when shift differs", () => {
      assert.equal(
        isSameKey(
          { name: "x", ctrl: false, meta: false, shift: true },
          { name: "x", ctrl: false, meta: false, shift: false },
        ),
        false,
      );
    });
  });

  describe("getAvailableSlashCommands", () => {
    it("returns empty array when no commands found", () => {
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array when glob throws", () => {
      mock.method(fsDeps, "globbySync", () => {
        throw new Error("permission denied");
      });
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array when glob returns empty", () => {
      testFs._globResults.set("/test-cwd/.agent-js/commands/**/*.md", []);
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, []);
    });

    it("includes custom slash command dirs", () => {
      actions.setCustomSlashCommandDirs(["/custom-commands"]);
      testFs._globResults.set("/custom-commands/**/*.md", [
        "/custom-commands/foo.md",
      ]);
      testFs._files.set("/custom-commands/foo.md", "custom content");
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, [
        {
          name: "foo",
          filePath: "/custom-commands/foo.md",
          content: "custom content",
        },
      ]);
    });

    it("returns commands from local and global dirs", () => {
      testFs._globResults.set("/test-cwd/.agent-js/commands/**/*.md", [
        "/test-cwd/.agent-js/commands/help.md",
      ]);
      testFs._globResults.set("/fake-home/.config/agent-js/commands/**/*.md", [
        "/fake-home/.config/agent-js/commands/status.md",
      ]);
      testFs._files.set("/test-cwd/.agent-js/commands/help.md", "help content");
      testFs._files.set(
        "/fake-home/.config/agent-js/commands/status.md",
        "status content",
      );
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, [
        {
          name: "help",
          filePath: "/test-cwd/.agent-js/commands/help.md",
          content: "help content",
        },
        {
          name: "status",
          filePath: "/fake-home/.config/agent-js/commands/status.md",
          content: "status content",
        },
      ]);
    });

    it("deduplicates by name keeping first occurrence", () => {
      testFs._globResults.set("/test-cwd/.agent-js/commands/**/*.md", [
        "/test-cwd/.agent-js/commands/help.md",
      ]);
      testFs._globResults.set("/fake-home/.config/agent-js/commands/**/*.md", [
        "/fake-home/.config/agent-js/commands/help.md",
      ]);
      testFs._files.set(
        "/test-cwd/.agent-js/commands/help.md",
        "local content",
      );
      testFs._files.set(
        "/fake-home/.config/agent-js/commands/help.md",
        "global content",
      );
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, [
        {
          name: "help",
          filePath: "/test-cwd/.agent-js/commands/help.md",
          content: "local content",
        },
      ]);
    });

    it("skips files that fail to read", () => {
      mock.method(fsDeps, "readFileSync", (path: string) => {
        if (path.includes("bad")) throw new Error("read failed");
        return Buffer.from("content");
      });
      testFs._globResults.set("/test-cwd/.agent-js/commands/**/*.md", [
        "/test-cwd/.agent-js/commands/good.md",
        "/test-cwd/.agent-js/commands/bad.md",
      ]);
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, [
        {
          name: "good",
          filePath: "/test-cwd/.agent-js/commands/good.md",
          content: "content",
        },
      ]);
    });
  });

  describe("resolveSlashCommand", () => {
    beforeEach(() => {
      actions.setRl(makeFakeRl({ line: "" }));
      mock.method(childProcess, "spawnSync", () => undefined);
    });

    it("handles /edit command", async () => {
      const result = await resolveSlashCommand("/edit");
      assert.strictEqual(result, null);
    });

    it("handles /edit command and logs editor content to chat history", async () => {
      actions.setChatHistoryPath("/tmp/test-history.log");
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "from editor");
      });
      const result = await resolveSlashCommand("/edit");
      assert.strictEqual(result, "from editor\n");
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z  [user]
from editor

`,
      );
    });

    it("handles /paste command and logs editor content to chat history", async () => {
      actions.setChatHistoryPath("/tmp/test-history.log");
      mockClipboardPaste("clip");
      mock.method(childProcess, "spawnSync", () => {
        testFs.writeFileSync("/tmp/agent-js-test-uuid.txt", "pasted content");
      });
      const result = await resolveSlashCommand("/paste");
      assert.strictEqual(result, "pasted content\n");
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z  [user]
pasted content

`,
      );
    });

    it("handles /clear command", async () => {
      const result = await resolveSlashCommand("/clear");
      assert.strictEqual(result, null);
    });

    it("handles /history command by opening chat history in a pager", async () => {
      testProcessEnv._set("AGENT_JS_PAGER_HISTORY", "nano __FILE__");
      actions.setChatHistoryPath("/tmp/test-history.log");
      testFs._files.set("/tmp/test-history.log", "log content");
      const result = await resolveSlashCommand("/history");
      assert.strictEqual(result, null);
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "log content",
      );
    });

    it("handles /model command", async () => {
      actions.setModel("old");
      actions.resetStdout();
      const result = await resolveSlashCommand("/model new-model");
      assert.strictEqual(result, null);
      assert.strictEqual(getState().config.model, "new-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Model updated from `old` to `new-model`\n",
      );
    });

    it("handles /model without args", async () => {
      actions.setModel("gpt-4");
      actions.resetStdout();
      const result = await resolveSlashCommand("/model");
      assert.strictEqual(result, null);
      assert.strictEqual(stripAnsi(getState().app.stdout), "gpt-4\n");
    });

    it("handles /skills command", async () => {
      actions.resetStdout();
      const result = await resolveSlashCommand("/skills");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available skills
`,
      );
    });

    it("handles /context command", async () => {
      actions.resetStdout();
      const result = await resolveSlashCommand("/context");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available context files
`,
      );
    });

    it("handles /commands command", async () => {
      actions.resetStdout();
      const result = await resolveSlashCommand("/commands");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available commands:
- /edit
- /history
- /clear
- /paste
- /model
- /skills
- /context
- /context-str
- /commands
- /commands-str
- /keymaps
- /usage
- /resume
- /config
- /reload
`,
      );
    });

    it("handles /commands-str command by opening custom commands in a pager", async () => {
      testProcessEnv._set("AGENT_JS_PAGER_COMMANDS", "nano __FILE__");
      actions.setSlashCommands([
        {
          name: "custom",
          filePath: "/test/.agent-js/commands/custom.md",
          content: "custom command content",
        },
      ]);
      const result = await resolveSlashCommand("/commands-str");
      assert.strictEqual(result, null);
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        `# /test/.agent-js/commands/custom.md
---
custom command content`,
      );
    });

    it("uses AGENT_JS_PAGER_COMMANDS for the commands-str pager", async () => {
      const { spawned } = mockPagerSpawn();
      testProcessEnv._set("AGENT_JS_PAGER_COMMANDS", "nano __FILE__");
      actions.setSlashCommands([
        {
          name: "custom",
          filePath: "/test/.agent-js/commands/custom.md",
          content: "custom command content",
        },
      ]);
      const result = await resolveSlashCommand("/commands-str");
      assert.strictEqual(result, null);
      assert.strictEqual(spawned[0], "nano /tmp/agent-js-test-uuid.txt");
    });

    it("writes empty temp file for commands-str when there are no custom commands", async () => {
      mockBatAvailable(true);
      const result = await resolveSlashCommand("/commands-str");
      assert.strictEqual(result, null);
      assert.strictEqual(testFs._files.get("/tmp/agent-js-test-uuid.txt"), "");
    });

    it("handles /context-str command with no context files", async () => {
      actions.resetStdout();
      const result = await resolveSlashCommand("/context-str");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available context files
`,
      );
    });

    it("handles /context-str command by opening context in a pager", async () => {
      testProcessEnv._set("AGENT_JS_PAGER_CONTEXT", "nano __FILE__");
      actions.setContextStr("context string content");
      actions.setContextEntries([
        { filePath: "/project/AGENTS.md", content: "context" },
      ]);
      const result = await resolveSlashCommand("/context-str");
      assert.strictEqual(result, null);
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "context string content",
      );
    });

    it("handles /config command by opening combined config in a pager", async () => {
      testProcessEnv._set("AGENT_JS_PAGER_CONFIG", "nano __FILE__");
      actions.resetStdout();
      const result = await resolveSlashCommand("/config");
      assert.strictEqual(result, null);
      assert.strictEqual(stripAnsi(getState().app.stdout), "");
      const tempContent = testFs._files.get("/tmp/agent-js-test-uuid.txt");
      assert.ok(tempContent !== undefined);
      assert.match(tempContent, /^# Global config from path: /);
      assert.match(tempContent, /\n# Local config from path: /);
      assert.match(tempContent, /# Applied config\n/);
    });

    it("handles /keymaps command", async () => {
      actions.resetStdout();
      const result = await resolveSlashCommand("/keymaps");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Keymaps:
- edit: {"name":"g","ctrl":true}
- paste: {"name":"v","ctrl":true}
`,
      );
    });

    it("handles /usage command", async () => {
      actions.resetStdout();
      actions.setModel("unknown-model");
      const result = await resolveSlashCommand("/usage");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "0 tokens in session\n",
      );
    });

    it("handles /usage command with context window usage", async () => {
      actions.resetStdout();
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      actions.appendToMessageParams({ role: "user", content: "hi" });
      actions.setMessageParamTokens(5_000);
      const result = await resolveSlashCommand("/usage");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "0 tokens in session, 50% of context window\n",
      );
    });

    it("handles /resume without args", async () => {
      actions.resetStdout();
      const result = await resolveSlashCommand("/resume");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /resume [session start date]\n",
      );
    });

    it("handles /resume with a session start date", async () => {
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-1234567890000.txt",
        "transcript content",
      );
      const result = await resolveSlashCommand("/resume 1234567890000");
      assert.strictEqual(
        result,
        `Continue the conversation recorded in the transcript below. Respond to this message with "Ready to continue chatting."
Transcript:
transcript content
    `,
      );
    });

    it("handles /reload command by opening the config diff in a pager", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          model: "gpt-4",
          baseURL: "https://api.example.com",
        }),
      );
      mockExec({ stdout: "config diff content" });
      const result = await resolveSlashCommand("/reload");
      assert.strictEqual(result, null);
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "config diff content",
      );
    });

    it("snapshots config, context, and skills around reload", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          model: "gpt-4",
          baseURL: "https://api.example.com",
        }),
      );
      testFs._dirs.add(getGlobalContextDir());
      testFs._files.set(
        "/fake-home/.config/agent-js/context/AGENTS.md",
        "hello",
      );

      const snapshots: string[] = [];
      mock.method(
        childProcess,
        "exec",
        (cmd: string, _opts: unknown, cb: unknown) => {
          if (cmd.includes("git diff")) {
            snapshots.push(
              testFs._files.get("/tmp/agent-js-test-uuid.txt") ?? "",
            );
          }
          (cb as (error: Error | null, stdout: string, stderr: string) => void)(
            null,
            "diff",
            "",
          );
        },
      );

      const result = await resolveSlashCommand("/reload");
      assert.strictEqual(result, null);
      assert.strictEqual(snapshots.length, 1);
      assert.ok(snapshots[0] !== undefined);
      assert.match(snapshots[0], /# Applied config/);
      assert.match(snapshots[0], /Context files:/);
      assert.match(snapshots[0], /Skills:/);
      assert.match(
        snapshots[0],
        /Path: \/fake-home\/.config\/agent-js\/context\/AGENTS.md/,
      );
    });

    it("handles custom slash command successfully", async () => {
      actions.setSlashCommands([
        {
          name: "custom",
          filePath: "/test-cwd/.agent-js/commands/custom.md",
          content: "custom command content",
        },
      ]);
      const result = await resolveSlashCommand("/custom");
      assert.strictEqual(result, "custom command content");
    });

    it("handles unknown slash command", async () => {
      actions.setSlashCommands([
        {
          name: "known",
          filePath: "/test-cwd/.agent-js/commands/known.md",
          content: "known content",
        },
      ]);
      actions.resetStdout();
      const result = await resolveSlashCommand("/unknown");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Invalid command: /unknown, valid commands:
- /edit
- /history
- /clear
- /paste
- /model
- /skills
- /context
- /context-str
- /commands
- /commands-str
- /keymaps
- /usage
- /resume
- /config
- /reload
- /test-cwd/.agent-js/commands/known.md
`,
      );
    });
  });
});
