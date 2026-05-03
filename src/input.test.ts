import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { Buffer } from "node:buffer";
import { dispatch, actions } from "./state.ts";
import { editCommand, resolveSlashCommand } from "./input.ts";
import type { EditCommandDeps, ResolveSlashCommandDeps } from "./input.ts";
import type { Color } from "./utils.ts";

beforeEach(() => {
  dispatch(actions.resetState());
});

function makeDeps(overrides: Partial<EditCommandDeps> = {}): EditCommandDeps {
  return {
    createTempFile: () => "/tmp/test.txt",
    writeFileSync: () => undefined,
    readFileSync: () => Buffer.from("content"),
    unlinkSync: () => undefined,
    spawnSync: () => ({ stdout: Buffer.from("") }),
    env: {},
    editorLog: () => undefined,
    ...overrides,
  };
}

describe("editCommand", () => {
  it("returns null when writeFile fails", () => {
    const deps = makeDeps({
      writeFileSync: () => {
        throw new Error("write failed");
      },
    });

    const result = editCommand("", deps);
    assert.strictEqual(result, null);
  });

  it("returns null and cleans up when readFile fails", () => {
    let unlinkCalled = false;
    const deps = makeDeps({
      readFileSync: () => {
        throw new Error("read failed");
      },
      unlinkSync: () => {
        unlinkCalled = true;
      },
    });

    const result = editCommand("content", deps);
    assert.strictEqual(result, null);
    assert.strictEqual(unlinkCalled, true);
  });

  it("returns null when editor returns empty content", () => {
    const deps = makeDeps({
      readFileSync: () => Buffer.from(""),
    });

    const result = editCommand("content", deps);
    assert.strictEqual(result, null);
  });

  it("returns normalized content and logs it", () => {
    const logs: string[] = [];
    const deps = makeDeps({
      readFileSync: () => Buffer.from("  hello  "),
      editorLog: (content: string) => {
        logs.push(content);
      },
    });

    const result = editCommand("", deps);
    assert.strictEqual(result, "hello\n");
    assert.deepStrictEqual(logs, ["hello\n"]);
  });

  it("uses AGENT_JS_EDITOR env var when available", () => {
    let spawnedEditor = "";
    const deps = makeDeps({
      env: { AGENT_JS_EDITOR: "nano" },
      spawnSync: (command: string) => {
        spawnedEditor = command;
        return { stdout: Buffer.from("") };
      },
    });

    editCommand("", deps);
    assert.ok(spawnedEditor.includes("nano"));
  });

  it("falls back to EDITOR env var when AGENT_JS_EDITOR is not set", () => {
    let spawnedEditor = "";
    const deps = makeDeps({
      env: { EDITOR: "vim" },
      spawnSync: (command: string) => {
        spawnedEditor = command;
        return { stdout: Buffer.from("") };
      },
    });

    editCommand("", deps);
    assert.ok(spawnedEditor.includes("vim"));
  });

  it("falls back to vi when no editor env vars are set", () => {
    let spawnedEditor = "";
    const deps = makeDeps({
      spawnSync: (command: string) => {
        spawnedEditor = command;
        return { stdout: Buffer.from("") };
      },
    });

    editCommand("", deps);
    assert.ok(spawnedEditor.includes("vi"));
  });
});

function makeSlashDeps(
  overrides: Partial<ResolveSlashCommandDeps> = {},
): ResolveSlashCommandDeps {
  return {
    editCommand: () => null,
    clearCommand: () => undefined,
    editLogCommand: () => undefined,
    readFileSync: () => Buffer.from(""),
    colorPrint: () => undefined,
    debugLog: () => undefined,
    join: (...segments: string[]) => segments.join("/"),
    cwd: () => "/test",
    ...overrides,
  };
}

describe("resolveSlashCommand", () => {
  it("handles /edit command", () => {
    let editCalled = false;
    const deps = makeSlashDeps({
      editCommand: () => {
        editCalled = true;
        return "edited content";
      },
    });

    const result = resolveSlashCommand("/edit", deps);
    assert.strictEqual(editCalled, true);
    assert.strictEqual(result, "edited content");
  });

  it("handles /clear command", () => {
    let clearCalled = false;
    const deps = makeSlashDeps({
      clearCommand: () => {
        clearCalled = true;
      },
    });

    const result = resolveSlashCommand("/clear", deps);
    assert.strictEqual(clearCalled, true);
    assert.strictEqual(result, null);
  });

  it("handles /edit-log command", () => {
    let editLogCalled = false;
    const deps = makeSlashDeps({
      editLogCommand: () => {
        editLogCalled = true;
      },
    });

    const result = resolveSlashCommand("/edit-log", deps);
    assert.strictEqual(editLogCalled, true);
    assert.strictEqual(result, null);
  });

  it("handles custom slash command successfully", () => {
    dispatch(actions.setSlashCommands(["custom"]));
    const deps = makeSlashDeps({
      readFileSync: () => Buffer.from("custom command content"),
      join: (...segments: string[]) => segments.join("/"),
      cwd: () => "/test",
    });

    const result = resolveSlashCommand("/custom", deps);
    assert.strictEqual(result, "custom command content");
  });

  it("handles custom slash command read error", () => {
    dispatch(actions.setSlashCommands(["custom"]));
    const errors: { message: string; color: Color | undefined }[] = [];
    const deps = makeSlashDeps({
      readFileSync: () => {
        throw new Error("read failed");
      },
      colorPrint: (message: string, color?: Color) => {
        errors.push({ message, color });
      },
    });

    const result = resolveSlashCommand("/custom", deps);
    assert.strictEqual(result, null);
    assert.strictEqual(errors.length, 2);
    assert.strictEqual(errors[1]!.color, "red");
  });

  it("handles unknown slash command", () => {
    dispatch(actions.setSlashCommands(["known"]));
    const errors: { message: string; color: Color | undefined }[] = [];
    const deps = makeSlashDeps({
      colorPrint: (message: string, color?: Color) => {
        errors.push({ message, color });
      },
    });

    const result = resolveSlashCommand("/unknown", deps);
    assert.strictEqual(result, null);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0]!.color, "red");
    assert.ok(errors[0]!.message.includes("known,edit,edit-log,clear"));
  });
});
