import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { PathLike, PathOrFileDescriptor } from "node:fs";
import {
  debugLog,
  editorLog,
  resetDebugLog,
  resetEditorLog,
  type DebugLogDeps,
} from "./log.ts";
import { dispatch, actions } from "./state.ts";

interface FsMockState {
  files: Map<string, string>;
  dirs: Set<string>;
}

function makeMockFs(): {
  deps: Pick<
    DebugLogDeps,
    "existsSync" | "mkdirSync" | "appendFileSync" | "writeFileSync" | "readFileSync"
  >;
  state: FsMockState;
} {
  const state: FsMockState = {
    files: new Map(),
    dirs: new Set(),
  };

  return {
    deps: {
      existsSync: ((path: PathLike): boolean => {
        const pathStr = path.toString();
        return state.files.has(pathStr) || state.dirs.has(pathStr);
      }) as DebugLogDeps["existsSync"],
      mkdirSync: ((path: PathLike): void => {
        state.dirs.add(path.toString());
      }) as DebugLogDeps["mkdirSync"],
      appendFileSync: ((path: PathOrFileDescriptor, content: string): void => {
        const pathStr = path.toString();
        const existing = state.files.get(pathStr) ?? "";
        state.files.set(pathStr, existing + "---LOG_ENTRY---" + content);
      }) as DebugLogDeps["appendFileSync"],
      writeFileSync: ((path: PathOrFileDescriptor, content: string): void => {
        state.files.set(path.toString(), content);
      }) as DebugLogDeps["writeFileSync"],
      readFileSync: ((path: PathOrFileDescriptor): string => {
        return state.files.get(path.toString()) ?? "";
      }) as DebugLogDeps["readFileSync"],
    },
    state,
  };
}

function makeTestDeps(
  overrides: {
    getDebugLogPath?: () => string;
    getEditorLogPath?: () => string;
  } = {},
): DebugLogDeps {
  const { deps: mockDeps } = makeMockFs();
  return {
    ...mockDeps,
    getDebugLogPath: overrides.getDebugLogPath ?? (() => "/test/debug.log"),
    getEditorLogPath: overrides.getEditorLogPath ?? (() => "/test/editor.log"),
  };
}

describe("log", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("debugLog", () => {
    it("does nothing when debugLog is disabled", () => {
      dispatch(actions.setDebugLog(false));
      const deps = makeTestDeps();
      debugLog("test message", deps);
      assert.equal(deps.existsSync("/test/debug.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeTestDeps();
      const mkdirCalls: string[] = [];
      const originalMkdirSync = deps.mkdirSync;
      deps.mkdirSync = (path: unknown) => {
        mkdirCalls.push(path as string);
        originalMkdirSync(path as PathLike);
      };

      debugLog("test message", deps);
      assert.deepStrictEqual(mkdirCalls, ["/test"]);
    });

    it("appends content to log file with timestamp", () => {
      dispatch(actions.setDebugLog(true));
      const depsWithTracking = makeTestDeps();

      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = depsWithTracking.appendFileSync;
      depsWithTracking.appendFileSync = (path: unknown, content: unknown) => {
        appendCalls.push({ path: path as string, content: content as string });
        originalAppend(path as PathOrFileDescriptor, content as string);
      };

      debugLog("test message", depsWithTracking);

      assert.equal(appendCalls.length, 1);
      const firstCall = appendCalls[0]!;
      assert.equal(firstCall.path, "/test/debug.log");
      assert.ok(firstCall.content.includes("test message"));
      assert.ok(/\d{4}-\d{2}-\d{2}T/.exec(firstCall.content));
    });

    it("appends multiple messages", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeTestDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.appendFileSync;
      deps.appendFileSync = (path: unknown, content: unknown) => {
        appendCalls.push({ path: path as string, content: content as string });
        originalAppend(path as PathOrFileDescriptor, content as string);
      };

      debugLog("message 1", deps);
      debugLog("message 2", deps);

      assert.equal(appendCalls.length, 2);
      assert.ok(appendCalls[0]!.content.includes("message 1"));
      assert.ok(appendCalls[1]!.content.includes("message 2"));
    });
  });

  describe("editorLog", () => {
    it("does nothing when editorLog is disabled", () => {
      dispatch(actions.setEditorLog(false));
      const deps = makeTestDeps();
      editorLog("test message", deps);
      assert.equal(deps.existsSync("/test/editor.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      dispatch(actions.setEditorLog(true));
      const deps = makeTestDeps();
      const mkdirCalls: string[] = [];
      const originalMkdirSync = deps.mkdirSync;
      deps.mkdirSync = (path: unknown) => {
        mkdirCalls.push(path as string);
        originalMkdirSync(path as PathLike);
      };

      editorLog("test message", deps);
      assert.deepStrictEqual(mkdirCalls, ["/test"]);
    });

    it("appends content with timestamp and separator", () => {
      dispatch(actions.setEditorLog(true));
      const deps = makeTestDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.appendFileSync;
      deps.appendFileSync = (path: unknown, content: unknown) => {
        appendCalls.push({ path: path as string, content: content as string });
        originalAppend(path as PathOrFileDescriptor, content as string);
      };

      editorLog("test content", deps);

      assert.equal(appendCalls.length, 1);
      const firstCall = appendCalls[0]!;
      assert.equal(firstCall.path, "/test/editor.log");
      const content = firstCall.content;
      assert.ok(content.includes("test content"));
      assert.ok(content.includes("-".repeat(25)));
      assert.ok(/\d{4}-\d{2}-\d{2}T/.exec(content));
    });

    it("appends multiple messages with separators", () => {
      dispatch(actions.setEditorLog(true));
      const deps = makeTestDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.appendFileSync;
      deps.appendFileSync = (path: unknown, content: unknown) => {
        appendCalls.push({ path: path as string, content: content as string });
        originalAppend(path as PathOrFileDescriptor, content as string);
      };

      editorLog("content 1", deps);
      editorLog("content 2", deps);

      assert.equal(appendCalls.length, 2);
      assert.ok(appendCalls[0]!.content.includes("content 1"));
      assert.ok(appendCalls[1]!.content.includes("content 2"));
    });
  });

  describe("resetDebugLog", () => {
    it("does nothing when log file does not exist", () => {
      const deps = makeTestDeps();
      const writeCalls: { path: string; content: string }[] = [];
      const originalWrite = deps.writeFileSync;
      deps.writeFileSync = (path: unknown, content: unknown) => {
        writeCalls.push({ path: path as string, content: content as string });
        originalWrite(path as PathOrFileDescriptor, content as string);
      };

      resetDebugLog(deps);
      assert.equal(writeCalls.length, 0);
    });

    it("clears the log file when it exists", () => {
      const { deps: realMockDeps } = makeMockFs();
      const deps: DebugLogDeps = {
        ...realMockDeps,
        getDebugLogPath: () => "/test/debug.log",
        getEditorLogPath: () => "/test/editor.log",
      };

      deps.mkdirSync("/test", { recursive: true });
      deps.writeFileSync("/test/debug.log", "existing content");

      resetDebugLog(deps);

      assert.equal(deps.existsSync("/test/debug.log"), true);
      const debugContent = deps.readFileSync("/test/debug.log");
      assert.equal(debugContent, "");
    });
  });

  describe("resetEditorLog", () => {
    it("does nothing when log file does not exist", () => {
      const deps = makeTestDeps();
      const writeCalls: { path: string; content: string }[] = [];
      const originalWrite = deps.writeFileSync;
      deps.writeFileSync = (path: unknown, content: unknown) => {
        writeCalls.push({ path: path as string, content: content as string });
        originalWrite(path as PathOrFileDescriptor, content as string);
      };

      resetEditorLog(deps);
      assert.equal(writeCalls.length, 0);
    });

    it("clears the log file when it exists", () => {
      const { deps: realMockDeps } = makeMockFs();
      const deps: DebugLogDeps = {
        ...realMockDeps,
        getDebugLogPath: () => "/test/debug.log",
        getEditorLogPath: () => "/test/editor.log",
      };

      deps.mkdirSync("/test", { recursive: true });
      deps.writeFileSync("/test/editor.log", "existing content");

      resetEditorLog(deps);

      assert.equal(deps.existsSync("/test/editor.log"), true);
      const editorContent = deps.readFileSync("/test/editor.log");
      assert.equal(editorContent, "");
    });
  });
});
