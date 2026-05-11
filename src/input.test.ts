import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { dispatch, actions, selectors } from "./state.ts";
import {
  editCommand,
  resolveSlashCommand,
  setModelCommand,
  isSameKey,
  getAvailableSlashCommands,
} from "./input.ts";
import { testFs, testProcessEnv, setupFakeDeps } from "./test-helpers.ts";
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
      dispatch(actions.setEditorLog(true));
      dispatch(actions.setEditorLogPath("/tmp/editor.log"));
      mock.method(childProcess, "spawnSync", () => {
        testFs._files.set("/tmp/agent-js-test-uuid.txt", "  hello  ");
      });
      const result = editCommand("");
      assert.strictEqual(result, "hello\n");
      assert.ok(testFs._files.has("/tmp/editor.log"));
      assert.ok(testFs._files.get("/tmp/editor.log")!.includes("hello\n"));
    });

    it("uses AGENT_JS_EDITOR env var when available", () => {
      testProcessEnv._set("AGENT_JS_EDITOR", "nano");
      editCommand("");
      assert.ok(spawned[0]!.includes("nano"));
    });

    it("falls back to EDITOR env var when AGENT_JS_EDITOR is not set", () => {
      testProcessEnv._set("EDITOR", "vim");
      editCommand("");
      assert.ok(spawned[0]!.includes("vim"));
    });

    it("falls back to vi when no editor env vars are set", () => {
      editCommand("");
      assert.ok(spawned[0]!.includes("vi"));
    });
  });

  describe("resolveSlashCommand", () => {
    beforeEach(() => {
      setupFakeDeps();
      mock.method(process, "cwd", () => "/agent-js");
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
        actions.setRl({ write: () => null, prompt: () => null } as never),
      );
      const result = resolveSlashCommand("/edit-log");
      assert.strictEqual(result, null);
    });

    it("handles custom slash command successfully", () => {
      dispatch(actions.setSlashCommands(["custom"]));
      testFs._dirs.add("/agent-js/.agent-js/commands");
      testFs._files.set(
        "/agent-js/.agent-js/commands/custom.md",
        "custom command content",
      );
      const result = resolveSlashCommand("/custom");
      assert.strictEqual(result, "custom command content");
    });

    it("handles custom slash command read error", () => {
      dispatch(actions.setSlashCommands(["custom"]));
      dispatch(actions.resetStdout());
      const result = resolveSlashCommand("/custom");
      assert.strictEqual(result, null);
      assert.ok(
        selectors.getStdout().includes("Error reading the slash command"),
      );
    });

    it("handles unknown slash command", () => {
      dispatch(actions.setSlashCommands(["known"]));
      dispatch(actions.resetStdout());
      const result = resolveSlashCommand("/unknown");
      assert.strictEqual(result, null);
      assert.ok(
        selectors
          .getStdout()
          .includes("Invalid / command detected, valid commands:"),
      );
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
      assert.ok(
        selectors
          .getStdout()
          .includes("Model updated from old-model to new-model"),
      );
    });

    it("prints red error when input has too many parts", () => {
      dispatch(actions.setModel("old-model"));
      setModelCommand("/model new-model extra");
      assert.strictEqual(selectors.getModel(), "old-model");
      assert.ok(selectors.getStdout().includes("Usage: /model [model]"));
    });

    it("prints red error when input has only the command", () => {
      dispatch(actions.setModel("old-model"));
      setModelCommand("/model");
      assert.strictEqual(selectors.getModel(), "old-model");
      assert.ok(selectors.getStdout().includes("Usage: /model [model]"));
    });

    it("handles model name with slashes", () => {
      dispatch(actions.setModel("old"));
      setModelCommand("/model provider/new-model");
      assert.strictEqual(selectors.getModel(), "provider/new-model");
      assert.ok(
        selectors
          .getStdout()
          .includes("Model updated from old to provider/new-model"),
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
      mock.method(process, "cwd", () => "/agent-js");
    });

    it("returns empty array when commands directory does not exist", () => {
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array when readdir throws", () => {
      mock.method(fsDeps, "readdirSync", () => {
        throw new Error("permission denied");
      });
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array when commands directory is empty", () => {
      testFs._dirs.add("/agent-js/.agent-js/commands");
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, []);
    });

    it("returns command names without file extensions", () => {
      testFs._dirs.add("/agent-js/.agent-js/commands");
      testFs._files.set("/agent-js/.agent-js/commands/help.ts", "");
      testFs._files.set("/agent-js/.agent-js/commands/status.js", "");
      testFs._files.set("/agent-js/.agent-js/commands/deploy.mjs", "");
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, ["help", "status", "deploy"]);
    });

    it("returns command names for files without extensions", () => {
      testFs._dirs.add("/agent-js/.agent-js/commands");
      testFs._files.set("/agent-js/.agent-js/commands/help", "");
      testFs._files.set("/agent-js/.agent-js/commands/status", "");
      const result = getAvailableSlashCommands();
      assert.deepStrictEqual(result, ["help", "status"]);
    });
  });
});
