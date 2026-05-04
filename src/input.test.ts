import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { Buffer } from "node:buffer";
import { dispatch, actions } from "./state.ts";
import { editCommand, resolveSlashCommand } from "./input.ts";
import type { EditCommandDeps, ResolveSlashCommandDeps } from "./input.ts";
import type { Color } from "./utils.ts";
import { makeFsDeps } from "./fs-deps.ts";

beforeEach(() => {
  dispatch(actions.resetState());
});

describe("editCommand", () => {
  let fs: ReturnType<typeof makeFsDeps>;

  beforeEach(() => {
    fs = makeFsDeps();
  });

  function makeDeps(overrides: Partial<EditCommandDeps> = {}): EditCommandDeps {
    return {
      fs,
      createTempFile: () => "/tmp/test.txt",
      spawnSync: () => ({ stdout: Buffer.from("") }),
      env: {},
      editorLog: () => undefined,
      ...overrides,
    };
  }

  it("returns null when writeFile fails", () => {
    const deps = makeDeps({
      fs: {
        ...fs,
        writeFileSync: () => {
          throw new Error("write failed");
        },
      },
    });

    const result = editCommand("", deps);
    assert.strictEqual(result, null);
  });

  it("returns null and cleans up when readFile fails", () => {
    let unlinkCalled = false;
    const deps = makeDeps({
      fs: {
        ...fs,
        readFileSync: () => {
          throw new Error("read failed");
        },
        unlinkSync: () => {
          unlinkCalled = true;
        },
      },
    });

    const result = editCommand("content", deps);
    assert.strictEqual(result, null);
    assert.strictEqual(unlinkCalled, true);
  });

  it("returns null when editor returns empty content", () => {
    const deps = makeDeps({
      fs: { ...fs, readFileSync: () => Buffer.from("") },
    });

    const result = editCommand("content", deps);
    assert.strictEqual(result, null);
  });

  it("returns normalized content and logs it", () => {
    const logs: string[] = [];
    const deps = makeDeps({
      fs: { ...fs, readFileSync: () => Buffer.from("  hello  ") },
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

describe("resolveSlashCommand", () => {
  let fs: ReturnType<typeof makeFsDeps>;

  beforeEach(() => {
    fs = makeFsDeps();
  });

  function makeDeps(
    overrides: Partial<ResolveSlashCommandDeps> = {},
  ): ResolveSlashCommandDeps {
    return {
      fs,
      editCommand: () => null,
      clearCommand: () => undefined,
      editLogCommand: () => undefined,
      colorPrint: () => undefined,
      debugLog: () => undefined,
      join: (...segments: string[]) => segments.join("/"),
      cwd: () => "/test",
      ...overrides,
    };
  }

  it("handles /edit command", () => {
    let editCalled = false;
    const deps = makeDeps({
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
    const deps = makeDeps({
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
    const deps = makeDeps({
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
    const deps = makeDeps({
      fs: { ...fs, readFileSync: () => Buffer.from("custom command content") },
    });

    const result = resolveSlashCommand("/custom", deps);
    assert.strictEqual(result, "custom command content");
  });

  it("handles custom slash command read error", () => {
    dispatch(actions.setSlashCommands(["custom"]));
    const errors: { message: string; color: Color | undefined }[] = [];
    const deps = makeDeps({
      fs: {
        ...fs,
        readFileSync: () => {
          throw new Error("read failed");
        },
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
    const deps = makeDeps({
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
