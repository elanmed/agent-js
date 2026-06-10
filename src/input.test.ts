import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import readline from "node:readline/promises";
import { actions, getState } from "./state.ts";
import {
  resolveSlashCommand,
  resolveUserInput,
  getModelCommand,
  setModelCommand,
  isSameKey,
  getAvailableSlashCommands,
  clearCommand,
  chatHistoryCommand,
  printSkillsCommand,
  printContextFilesCommand,
  printCommandsCommand,
  printKeymapsCommand,
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
      actions.setRl(makeFakeRl({ line: "" }) as unknown as readline.Interface);
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
      actions.setPromptHistoryPath("/tmp/editor.log");
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
      actions.setRl(
        makeFakeRl({ line: "hello " }) as unknown as readline.Interface,
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
      actions.resetStdout();
      actions.setRl(makeFakeRl() as unknown as readline.Interface);
    });

    it("returns editor input value when set and clears it", async () => {
      actions.setEditorInputValue("editor content");
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "editor content");
      assert.strictEqual(getState().app.editorInputValue, null);
    });

    it("returns trimmed user input", async () => {
      mock.method(getState().app.rl!, "question", () =>
        Promise.resolve("  hello  "),
      );
      mock.method(Date, "now", () => 0);
      actions.setPromptHistoryPath("/tmp/test-history.log");
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "hello");
      assert.strictEqual(stripAnsi(getState().app.stdout), ">  hello  \n");
      assert.strictEqual(
        testFs._files.get("/tmp/test-history.log"),
        `1970-01-01T00:00:00.000Z
-------------------------
hello

`,
      );
    });

    it("resolves slash commands when input starts with /", async () => {
      actions.setModel("old");
      actions.resetStdout();
      mock.method(getState().app.rl!, "question", () =>
        Promise.resolve("/model new-model"),
      );
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, null);
      assert.strictEqual(getState().config.model, "new-model");
    });

    it("returns null and prints error on non-abort error", async () => {
      mock.method(getState().app.rl!, "question", () =>
        Promise.reject(new Error("read failed")),
      );
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, null);
      assert.ok(
        getState().app.stdout.includes(">[unable to read rl.question result]"),
      );
    });

    it("returns editor value when aborted by editor", async () => {
      mock.method(getState().app.rl!, "question", () => {
        actions.setEditorInputValue("from editor");
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });
      const result = await resolveUserInput({ isFirstInput: false });
      assert.strictEqual(result, "from editor");
      assert.strictEqual(getState().app.editorInputValue, null);
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
  });

  describe("setModelCommand", () => {
    beforeEach(() => {
      actions.resetStdout();
    });

    it("sets model and prints blue confirmation when input is valid", () => {
      actions.setModel("old-model");
      setModelCommand("/model new-model");
      assert.strictEqual(getState().config.model, "new-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Model updated from `old-model` to `new-model`\n",
      );
    });

    it("prints red error when input has too many parts", () => {
      actions.setModel("old-model");
      setModelCommand("/model new-model extra");
      assert.strictEqual(getState().config.model, "old-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /model [model]?\n",
      );
    });

    it("prints red error when input has only the command", () => {
      actions.setModel("old-model");
      setModelCommand("/model");
      assert.strictEqual(getState().config.model, "old-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Usage: /model [model]?\n",
      );
    });

    it("handles model name with slashes", () => {
      actions.setModel("old");
      setModelCommand("/model provider/new-model");
      assert.strictEqual(getState().config.model, "provider/new-model");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Model updated from `old` to `provider/new-model`\n",
      );
    });

    it("handles input with multiple spaces", () => {
      actions.setModel("old");
      setModelCommand("/model   new-model");
      assert.strictEqual(getState().config.model, "new-model");
    });

    it("handles input with tabs", () => {
      actions.setModel("old");
      setModelCommand("/model\tnew-model");
      assert.strictEqual(getState().config.model, "new-model");
    });
  });

  describe("getModelCommand", () => {
    beforeEach(() => {
      actions.resetStdout();
    });

    it("prints current model", () => {
      actions.setModel("gpt-4");
      getModelCommand();
      assert.strictEqual(stripAnsi(getState().app.stdout), "gpt-4\n");
    });
  });

  describe("clearCommand", () => {
    beforeEach(() => {
      actions.resetStdout();
    });

    it("resets message usages and params", () => {
      actions.appendToMessageUsages({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      actions.appendToMessageParams({
        role: "user",
        content: "hello",
      });
      clearCommand();
      assert.deepStrictEqual(getState().app.messageUsages, []);
      assert.deepStrictEqual(getState().app.messageParams, []);
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Context cleared (10 in, 5 out)\n",
      );
    });
  });

  describe("chatHistoryCommand", () => {
    beforeEach(() => {
      mock.method(childProcess, "spawnSync", () => undefined);
    });

    it("prints warning when log does not exist", () => {
      actions.setPromptHistoryPath("/tmp/nonexistent.log");
      actions.setRl(makeFakeRl() as unknown as readline.Interface);
      chatHistoryCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "[Cannot read history]\n",
      );
    });

    it("uses AGENT_JS_HISTORY env var with __FILE__ when available", () => {
      let spawned = "";
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned = cmd;
      });
      testProcessEnv._set("AGENT_JS_HISTORY", "nano __FILE__");
      actions.setPromptHistoryPath("/tmp/editor.log");
      testFs._files.set("/tmp/editor.log", "log content");
      chatHistoryCommand();
      assert.strictEqual(spawned, "nano /tmp/editor.log");
    });

    it("falls back to EDITOR env var when AGENT_JS_HISTORY is not set", () => {
      let spawned = "";
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned = cmd;
      });
      testProcessEnv._set("EDITOR", "vim");
      actions.setPromptHistoryPath("/tmp/editor.log");
      testFs._files.set("/tmp/editor.log", "log content");
      chatHistoryCommand();
      assert.strictEqual(spawned, 'vim "/tmp/editor.log"');
    });

    it("falls back to vi when no editor env vars are set", () => {
      let spawned = "";
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned = cmd;
      });
      actions.setPromptHistoryPath("/tmp/editor.log");
      testFs._files.set("/tmp/editor.log", "log content");
      chatHistoryCommand();
      assert.strictEqual(spawned, 'vi "/tmp/editor.log"');
    });

    it("prints warning when log cannot be read", () => {
      actions.setPromptHistoryPath("/tmp/editor.log");
      testFs._files.set("/tmp/editor.log", "log content");
      actions.setRl(makeFakeRl() as unknown as readline.Interface);
      mock.method(fsDeps, "readFileSync", () => {
        throw new Error("read failed");
      });
      chatHistoryCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "[Cannot read history]\n",
      );
    });

    it("restores original log content after editing", () => {
      actions.setPromptHistoryPath("/tmp/editor.log");
      testFs._files.set("/tmp/editor.log", "original content");
      mock.method(childProcess, "spawnSync", () => {
        testFs._files.set("/tmp/editor.log", "modified by editor");
      });
      chatHistoryCommand();
      assert.strictEqual(
        testFs._files.get("/tmp/editor.log"),
        "original content",
      );
    });
  });

  describe("printSkillsCommand", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints available skills", () => {
      actions.setSkills([
        {
          name: "test-skill",
          description: "A test skill",
          dir: "/skills/test-skill",
          content: "skill content",
        },
      ]);
      printSkillsCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available skills:
- test-skill: A test skill
  /skills/test-skill
`,
      );
    });

    it("prints no available skills when skills list is empty", () => {
      printSkillsCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available skills
`,
      );
    });

    it("filters out context file skills", () => {
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
      printSkillsCommand();
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

  describe("printContextFilesCommand", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints available context files", () => {
      actions.setContextEntries([
        { filePath: "/project/AGENTS.md", content: "context" },
      ]);
      printContextFilesCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Available context files:
- /project/AGENTS.md
`,
      );
    });

    it("prints no available context files when entries list is empty", () => {
      printContextFilesCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
No available context files
`,
      );
    });

    it("includes context file skills", () => {
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
      printContextFilesCommand();
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

  describe("printCommandsCommand", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints builtin and custom commands", () => {
      actions.setSlashCommands([
        {
          name: "custom.md",
          filePath: "/test/.agent-js/commands/custom.md",
          content: "custom",
        },
      ]);
      printCommandsCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
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

  describe("printKeymapsCommand", () => {
    beforeEach(() => {
      actions.resetState();
      actions.resetStdout();
    });

    it("prints default keymaps", () => {
      printKeymapsCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Keymaps:
- edit: {"name":"g","ctrl":true}
- history: {"name":"o","ctrl":true}
- paste: {"name":"v","ctrl":true}
- clear: {"name":"x","ctrl":true}
`,
      );
    });

    it("prints custom keymaps", () => {
      actions.setKeymapEditPrompt({ name: "e", ctrl: true, meta: true });
      actions.setKeymapEditPastePrompt({ name: "p", ctrl: true, shift: true });
      actions.setKeymapPromptHistory({ name: "h", ctrl: true });
      actions.setKeymapClear({ name: "k", ctrl: true });
      printKeymapsCommand();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        `
Keymaps:
- edit: {"name":"e","ctrl":true,"meta":true}
- history: {"name":"h","ctrl":true}
- paste: {"name":"p","ctrl":true,"shift":true}
- clear: {"name":"k","ctrl":true}
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
      actions.setRl(makeFakeRl({ line: "" }) as unknown as readline.Interface);
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
      actions.setRl(makeFakeRl() as unknown as readline.Interface);
      const result = await resolveSlashCommand("/history");
      assert.strictEqual(result, null);
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
- /model
- /skills
- /context
- /commands
- /keymaps
`,
      );
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
- history: {"name":"o","ctrl":true}
- paste: {"name":"v","ctrl":true}
- clear: {"name":"x","ctrl":true}
`,
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
