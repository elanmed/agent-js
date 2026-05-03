import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { Buffer } from "node:buffer";
import { dispatch, actions } from "./state.ts";
import { editCommand } from "./input.ts";
import type { EditCommandDeps } from "./input.ts";

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
