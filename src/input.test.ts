import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import readline from "node:readline/promises";
import { dispatch, actions, selectors } from "./state.ts";
import {
  resolveSlashCommand,
  resolveUserInput,
  setModelCommand,
  isSameKey,
  getAvailableSlashCommands,
  clearCommand,
  promptHistoryCommand,
  printSkillsCommand,
  printContextFilesCommand,
  printCommandsCommand,
  spawnAndReadEditorContent,
} from "./input.ts";
import {
  testFs,
  testProcessEnv,
  setupTestContext,
  makeFakeRl,
  mockExec,
  stripAnsi,
} from "./test-helpers.ts";
import { fsDeps } from "./deps.ts";
import childProcess from "node:child_process";
import os from "node:os";

describe("input", () => {
  beforeEach(() => {
    setupTestContext();
  });

  describe("spawnAndReadEditorContent", () => {
    let spawned: string[];

    beforeEach(() => {
      spawned = [];
      dispatch(
        actions.setRl(
          makeFakeRl({ line: "" }) as unknown as readline.Interface,
        ),
      );
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
        testFs._files.set("/tmp/agent-js-test-uuid.txt", "");
      });
      const result = await spawnAndReadEditorContent();
      assert.strictEqual(result, null);
    });

    it("returns normalized content and logs it", async () => {
      mock.method(Date, "now", () => 0);
      dispatch(actions.setPromptHistoryPath("/tmp/editor.log"));
      mock.method(childProcess, "spawnSync", () => {
        testFs._files.set("/tmp/agent-js-test-uuid.txt", "  hello  ");
      });
      const result = await spawnAndReadEditorContent();
      assert.strictEqual(result, "hello\n");
      assert.ok(testFs._files.has("/tmp/editor.log"));
      assert.strictEqual(
        testFs._files.get("/tmp/editor.log"),
        `1970-01-01T00:00:00.000Z
-------------------------
hello

`,
      );
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

    it("includes clipboard content when includeClipboardSuffix is true", async () => {
      dispatch(
        actions.setRl(
          makeFakeRl({ line: "hello " }) as unknown as readline.Interface,
        ),
      );
      mock.method(os, "platform", () => "linux");
      mockExec({ stdout: "world" });
      mock.method(childProcess, "spawnSync", () => {
        testFs._files.set("/tmp/agent-js-test-uuid.txt", "hello world\n");
      });
      const result = await spawnAndReadEditorContent({
        includeClipboardSuffix: true,
      });
      assert.strictEqual(result, "hello world\n");
    });
  });

  describe("resolveUserInput", () => {
    beforeEach(() => {
      dispatch(actions.resetStdout());
      dispatch(actions.setRl(makeFakeRl() as unknown as readline.Interface));
    });

    it("returns editor input value when set and clears it", async () => {
      dispatch(actions.setEditorInputValue("editor content"));
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "editor content");
      assert.strictEqual(selectors.getEditorInputValue(), null);
    });

    it("returns trimmed user input", async () => {
      mock.method(selectors.getRl()!, "question", () =>
        Promise.resolve("  hello  "),
      );
      mock.method(Date, "now", () => 0);
      dispatch(actions.setPromptHistoryPath("/tmp/test-history.log"));
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "hello");
      assert.strictEqual(stripAnsi(selectors.getStdout()), ">  hello  \n");
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z
-------------------------
hello

`,
      );
    });

    it("resolves slash commands when input starts with /", async () => {
      dispatch(actions.setModel("old"));
      dispatch(actions.resetStdout());
      mock.method(selectors.getRl()!, "question", () =>
        Promise.resolve("/model new-model"),
      );
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, null);
      assert.strictEqual(selectors.getModel(), "new-model");
    });

    it("returns null and prints error on non-abort error", async () => {
      mock.method(selectors.getRl()!, "question", () =>
        Promise.reject(new Error("read failed")),
      );
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, null);
      assert.ok(
        selectors.getStdout().includes(">[unable to read rl.question result]"),
      );
    });

    it("returns editor value when aborted by editor", async () => {
      mock.method(selectors.getRl()!, "question", () => {
        dispatch(actions.setEditorInputValue("from editor"));
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "from editor");
      assert.strictEqual(selectors.getEditorInputValue(), null);
    });

    it("exits on abort during exit confirmation", async () => {
      mock.method(process, "exit", () => {
        throw new Error("process.exit called");
      });
      const questionMock = mock.method(selectors.getRl()!, "question", () => {
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
      const questionMock = mock.method(selectors.getRl()!, "question", () =>
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
      const questionMock = mock.method(selectors.getRl()!, "question", () =>
        Promise.resolve("yes"),
      );
      questionMock.mock.mockImplementationOnce(() => Promise.reject(err));
      await assert.rejects(
        resolveUserInput({ isFirstInput: false }),
        /process.exit called/,
      );
      assert.strictEqual(questionMock.mock.callCount(), 2);
    });
  });

  describe("setModelCommand", () => {
    beforeEach(() => {
      dispatch(actions.resetStdout());
    });

    it("sets model and prints blue confirmation when input is valid", () => {
      dispatch(actions.setModel("old-model"));
      setModelCommand("/model new-model");
      assert.strictEqual(selectors.getModel(), "new-model");
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Model updated from old-model to new-model\n",
      );
    });

    it("prints red error when input has too many parts", () => {
      dispatch(actions.setModel("old-model"));
      setModelCommand("/model new-model extra");
      assert.strictEqual(selectors.getModel(), "old-model");
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Usage: /model [model]?\n",
      );
    });

    it("prints red error when input has only the command", () => {
      dispatch(actions.setModel("old-model"));
      setModelCommand("/model");
      assert.strictEqual(selectors.getModel(), "old-model");
      assert.strictEqual(stripAnsi(selectors.getStdout()), "old-model\n");
    });

    it("handles model name with slashes", () => {
      dispatch(actions.setModel("old"));
      setModelCommand("/model provider/new-model");
      assert.strictEqual(selectors.getModel(), "provider/new-model");
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Model updated from old to provider/new-model\n",
      );
    });

    it("handles input with multiple spaces", () => {
      dispatch(actions.setModel("old"));
      setModelCommand("/model   new-model");
      assert.strictEqual(selectors.getModel(), "new-model");
    });

    it("handles input with tabs", () => {
      dispatch(actions.setModel("old"));
      setModelCommand("/model\tnew-model");
      assert.strictEqual(selectors.getModel(), "new-model");
    });
  });

  describe("clearCommand", () => {
    beforeEach(() => {
      dispatch(actions.resetStdout());
    });

    it("resets message usages and params", () => {
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      dispatch(
        actions.appendToMessageParams({
          role: "user",
          content: "hello",
        }),
      );
      clearCommand();
      assert.deepStrictEqual(selectors.getMessageUsages(), []);
      assert.deepStrictEqual(selectors.getMessageParams(), []);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Context cleared (10 in, 5 out)\n",
      );
    });
  });

  describe("promptHistoryCommand", () => {
    beforeEach(() => {
      mock.method(childProcess, "spawnSync", () => undefined);
    });

    it("prints warning when log does not exist", () => {
      dispatch(actions.setPromptHistoryPath("/tmp/nonexistent.log"));
      dispatch(actions.setRl(makeFakeRl() as unknown as readline.Interface));
      promptHistoryCommand();
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "[Cannot read history]\n",
      );
    });

    it("uses AGENT_JS_HISTORY env var with __FILE__ when available", () => {
      let spawned = "";
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned = cmd;
      });
      testProcessEnv._set("AGENT_JS_HISTORY", "nano __FILE__");
      dispatch(actions.setPromptHistoryPath("/tmp/editor.log"));
      testFs._files.set("/tmp/editor.log", "log content");
      promptHistoryCommand();
      assert.strictEqual(spawned, "nano /tmp/editor.log");
    });

    it("falls back to EDITOR env var when AGENT_JS_HISTORY is not set", () => {
      let spawned = "";
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned = cmd;
      });
      testProcessEnv._set("EDITOR", "vim");
      dispatch(actions.setPromptHistoryPath("/tmp/editor.log"));
      testFs._files.set("/tmp/editor.log", "log content");
      promptHistoryCommand();
      assert.strictEqual(spawned, 'vim "/tmp/editor.log"');
    });

    it("falls back to vi when no editor env vars are set", () => {
      let spawned = "";
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned = cmd;
      });
      dispatch(actions.setPromptHistoryPath("/tmp/editor.log"));
      testFs._files.set("/tmp/editor.log", "log content");
      promptHistoryCommand();
      assert.strictEqual(spawned, 'vi "/tmp/editor.log"');
    });

    it("prints warning when log cannot be read", () => {
      dispatch(actions.setPromptHistoryPath("/tmp/editor.log"));
      testFs._files.set("/tmp/editor.log", "log content");
      dispatch(actions.setRl(makeFakeRl() as unknown as readline.Interface));
      mock.method(fsDeps, "readFileSync", () => {
        throw new Error("read failed");
      });
      promptHistoryCommand();
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "[Cannot read history]\n",
      );
    });

    it("restores original log content after editing", () => {
      dispatch(actions.setPromptHistoryPath("/tmp/editor.log"));
      testFs._files.set("/tmp/editor.log", "original content");
      mock.method(childProcess, "spawnSync", () => {
        testFs._files.set("/tmp/editor.log", "modified by editor");
      });
      promptHistoryCommand();
      assert.strictEqual(
        testFs._files.get("/tmp/editor.log"),
        "original content",
      );
    });
  });

  describe("printSkillsCommand", () => {
    beforeEach(() => {
      dispatch(actions.resetState());
      dispatch(actions.resetStdout());
    });

    it("prints available skills", () => {
      dispatch(
        actions.setSkills([
          {
            name: "test-skill",
            description: "A test skill",
            dir: "/skills/test-skill",
            content: "skill content",
          },
        ]),
      );
      printSkillsCommand();
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available skills:
- test-skill: A test skill
  /skills/test-skill
`,
      );
    });
  });

  describe("printContextFilesCommand", () => {
    beforeEach(() => {
      dispatch(actions.resetState());
      dispatch(actions.resetStdout());
    });

    it("prints available context files", () => {
      dispatch(
        actions.setContextEntries([
          { filePath: "/project/AGENTS.md", content: "context" },
        ]),
      );
      printContextFilesCommand();
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available context files:
- /project/AGENTS.md
`,
      );
    });
  });

  describe("printCommandsCommand", () => {
    beforeEach(() => {
      dispatch(actions.resetState());
      dispatch(actions.resetStdout());
    });

    it("prints builtin and custom commands", () => {
      dispatch(
        actions.setSlashCommands([
          {
            name: "custom.md",
            filePath: "/test/.agent-js/commands/custom.md",
            content: "custom",
          },
        ]),
      );
      printCommandsCommand();
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available commands:
- /edit
- /history
- /clear
- /model
- /skills
- /context
- /commands
- /keymaps
- /test/.agent-js/commands/custom.md
`,
      );
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
      dispatch(actions.setCustomSlashCommandDirs(["/custom-commands"]));
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
      testFs._globResults.set("/fake-home/.config/.agent-js/commands/**/*.md", [
        "/fake-home/.config/.agent-js/commands/status.md",
      ]);
      testFs._files.set("/test-cwd/.agent-js/commands/help.md", "help content");
      testFs._files.set(
        "/fake-home/.config/.agent-js/commands/status.md",
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
          filePath: "/fake-home/.config/.agent-js/commands/status.md",
          content: "status content",
        },
      ]);
    });

    it("deduplicates by name keeping first occurrence", () => {
      testFs._globResults.set("/test-cwd/.agent-js/commands/**/*.md", [
        "/test-cwd/.agent-js/commands/help.md",
      ]);
      testFs._globResults.set("/fake-home/.config/.agent-js/commands/**/*.md", [
        "/fake-home/.config/.agent-js/commands/help.md",
      ]);
      testFs._files.set(
        "/test-cwd/.agent-js/commands/help.md",
        "local content",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/commands/help.md",
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
      dispatch(
        actions.setRl(
          makeFakeRl({ line: "" }) as unknown as readline.Interface,
        ),
      );
      mock.method(childProcess, "spawnSync", () => undefined);
    });

    it("handles /edit command", async () => {
      const result = await resolveSlashCommand("/edit");
      assert.strictEqual(result, null);
    });

    it("handles /clear command", async () => {
      const result = await resolveSlashCommand("/clear");
      assert.strictEqual(result, null);
    });

    it("handles /history command", async () => {
      dispatch(actions.setRl(makeFakeRl() as unknown as readline.Interface));
      const result = await resolveSlashCommand("/history");
      assert.strictEqual(result, null);
    });

    it("handles /model command", async () => {
      dispatch(actions.setModel("old"));
      dispatch(actions.resetStdout());
      const result = await resolveSlashCommand("/model new-model");
      assert.strictEqual(result, null);
      assert.strictEqual(selectors.getModel(), "new-model");
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Model updated from old to new-model\n",
      );
    });

    it("handles /skills command", async () => {
      dispatch(actions.resetStdout());
      const result = await resolveSlashCommand("/skills");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available skills:

`,
      );
    });

    it("handles /context command", async () => {
      dispatch(actions.resetStdout());
      const result = await resolveSlashCommand("/context");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available context files:

`,
      );
    });

    it("handles /commands command", async () => {
      dispatch(actions.resetStdout());
      const result = await resolveSlashCommand("/commands");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available commands:
- /edit
- /history
- /clear
- /model
- /skills
- /context
- /commands
- /keymaps
`,
      );
    });

    it("handles custom slash command successfully", async () => {
      dispatch(
        actions.setSlashCommands([
          {
            name: "custom",
            filePath: "/test-cwd/.agent-js/commands/custom.md",
            content: "custom command content",
          },
        ]),
      );
      const result = await resolveSlashCommand("/custom");
      assert.strictEqual(result, "custom command content");
    });

    it("handles unknown slash command", async () => {
      dispatch(
        actions.setSlashCommands([
          {
            name: "known",
            filePath: "/test-cwd/.agent-js/commands/known.md",
            content: "known content",
          },
        ]),
      );
      dispatch(actions.resetStdout());
      const result = await resolveSlashCommand("/unknown");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Invalid command: /unknown, valid commands:
- /edit
- /history
- /clear
- /model
- /skills
- /context
- /commands
- /keymaps
- /test-cwd/.agent-js/commands/known.md
`,
      );
    });
  });
});
