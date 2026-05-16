import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import type readline from "node:readline/promises";
import { dispatch, actions, selectors } from "./state.ts";
import {
  editCommand,
  resolveSlashCommand,
  setModelCommand,
  isSameKey,
  getAvailableSlashCommands,
  clearCommand,
  editLogCommand,
  printSkillsCommand,
  printContextFilesCommand,
  printCommandsCommand,
} from "./input.ts";
import {
  testFs,
  testProcessEnv,
  setupFakeDeps,
  stripAnsi,
} from "./test-helpers.ts";
import { fsDeps } from "./deps.ts";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";

describe("input", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("editCommand", () => {
    let spawned: string[];

    beforeEach(() => {
      setupFakeDeps();
      spawned = [];
      mock.method(crypto, "randomUUID", () => "test-uuid");
      mock.method(os, "tmpdir", () => "/tmp");
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned.push(cmd);
      });
    });

    it("returns null when writeFile fails", () => {
      mock.method(fsDeps, "writeFileSync", () => {
        throw new Error("write failed");
      });
      const result = editCommand("");
      assert.strictEqual(result, null);
    });

    it("returns null and cleans up when readFile fails", () => {
      mock.method(fsDeps, "readFileSync", () => {
        throw new Error("read failed");
      });
      const result = editCommand("content");
      assert.strictEqual(result, null);
      assert.strictEqual(
        testFs._files.has("/tmp/agent-js-test-uuid.txt"),
        false,
      );
    });

    it("returns null when editor returns empty content", () => {
      mock.method(childProcess, "spawnSync", () => {
        testFs._files.set("/tmp/agent-js-test-uuid.txt", "");
      });
      const result = editCommand("content");
      assert.strictEqual(result, null);
    });

    it("returns normalized content and logs it", () => {
      mock.method(Date, "now", () => 0);
      dispatch(actions.setEditorLog(true));
      dispatch(actions.setEditorLogPath("/tmp/editor.log"));
      mock.method(childProcess, "spawnSync", () => {
        testFs._files.set("/tmp/agent-js-test-uuid.txt", "  hello  ");
      });
      const result = editCommand("");
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

    it("uses AGENT_JS_EDITOR env var when available", () => {
      testProcessEnv._set("AGENT_JS_EDITOR", "nano");
      editCommand("");
      assert.strictEqual(spawned[0], 'nano "/tmp/agent-js-test-uuid.txt"');
    });

    it("falls back to EDITOR env var when AGENT_JS_EDITOR is not set", () => {
      testProcessEnv._set("EDITOR", "vim");
      editCommand("");
      assert.strictEqual(spawned[0], 'vim "/tmp/agent-js-test-uuid.txt"');
    });

    it("falls back to vi when no editor env vars are set", () => {
      editCommand("");
      assert.strictEqual(spawned[0], 'vi "/tmp/agent-js-test-uuid.txt"');
    });
  });

  describe("setModelCommand", () => {
    beforeEach(() => {
      setupFakeDeps();
      dispatch(actions.resetState());
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
        "Usage: /model [model]\n",
      );
    });

    it("prints red error when input has only the command", () => {
      dispatch(actions.setModel("old-model"));
      setModelCommand("/model");
      assert.strictEqual(selectors.getModel(), "old-model");
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Usage: /model [model]\n",
      );
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
  });

  describe("clearCommand", () => {
    beforeEach(() => {
      setupFakeDeps();
      dispatch(actions.resetState());
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

  describe("editLogCommand", () => {
    beforeEach(() => {
      setupFakeDeps();
      dispatch(actions.resetState());
      mock.method(childProcess, "spawnSync", () => undefined);
    });

    it("prints warning when log does not exist", () => {
      dispatch(actions.setEditorLogPath("/tmp/nonexistent.log"));
      dispatch(
        actions.setRl({
          write: () => null,
          prompt: () => null,
        } as unknown as readline.Interface),
      );
      editLogCommand();
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "[Edit log does not exist]\n",
      );
    });

    it("spawns editor when log exists", () => {
      let spawned = "";
      mock.method(childProcess, "spawnSync", (cmd: string) => {
        spawned = cmd;
      });
      dispatch(actions.setEditorLogPath("/tmp/editor.log"));
      testFs._files.set("/tmp/editor.log", "log content");
      editLogCommand();
      assert.strictEqual(spawned, 'vi "/tmp/editor.log"');
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
  /skills/test-skill/SKILL.md
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
Available /commands:
- edit
- edit-log
- clear
- model
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
    beforeEach(() => {
      setupFakeDeps();
    });

    it("returns empty array when no commands found", () => {
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array when glob throws", () => {
      mock.method(fsDeps, "globSync", () => {
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
      setupFakeDeps();
      mock.method(childProcess, "spawnSync", () => undefined);
    });

    it("handles /edit command", () => {
      const result = resolveSlashCommand("/edit");
      assert.strictEqual(result, null);
    });

    it("handles /clear command", () => {
      const result = resolveSlashCommand("/clear");
      assert.strictEqual(result, null);
    });

    it("handles /edit-log command", () => {
      dispatch(
        actions.setRl({
          write: () => null,
          prompt: () => null,
        } as unknown as readline.Interface),
      );
      const result = resolveSlashCommand("/edit-log");
      assert.strictEqual(result, null);
    });

    it("handles /model command", () => {
      dispatch(actions.setModel("old"));
      dispatch(actions.resetStdout());
      const result = resolveSlashCommand("/model new-model");
      assert.strictEqual(result, null);
      assert.strictEqual(selectors.getModel(), "new-model");
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Model updated from old to new-model\n",
      );
    });

    it("handles /skills command", () => {
      dispatch(actions.resetStdout());
      const result = resolveSlashCommand("/skills");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available skills:

`,
      );
    });

    it("handles /context command", () => {
      dispatch(actions.resetStdout());
      const result = resolveSlashCommand("/context");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available context files:

`,
      );
    });

    it("handles /commands command", () => {
      dispatch(actions.resetStdout());
      const result = resolveSlashCommand("/commands");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        `
Available /commands:
- edit
- edit-log
- clear
- model
`,
      );
    });

    it("handles custom slash command successfully", () => {
      dispatch(
        actions.setSlashCommands([
          {
            name: "custom",
            filePath: "/test-cwd/.agent-js/commands/custom.md",
            content: "custom command content",
          },
        ]),
      );
      const result = resolveSlashCommand("/custom");
      assert.strictEqual(result, "custom command content");
    });

    it("handles unknown slash command", () => {
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
      const result = resolveSlashCommand("/unknown");
      assert.strictEqual(result, null);
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "Invalid / command detected, valid commands: known, edit, edit-log, clear, model\n",
      );
    });
  });
});
