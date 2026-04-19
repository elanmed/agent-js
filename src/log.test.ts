import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
  fs: DebugLogDeps["fs"];
  state: FsMockState;
} {
  const state: FsMockState = {
    files: new Map(),
    dirs: new Set(),
  };

  return {
    fs: {
      existsSync: (path: string): boolean => {
        return state.files.has(path) || state.dirs.has(path);
      },
      mkdirSync: (path: string): void => {
        state.dirs.add(path);
      },
      appendFileSync: (path: string, content: string): void => {
        const existing = state.files.get(path) ?? "";
        state.files.set(path, existing + "---LOG_ENTRY---" + content);
      },
      writeFileSync: (path: string, content: string): void => {
        state.files.set(path, content);
      },
      readFileSync: (path: string): string => {
        return state.files.get(path) ?? "";
      },
    },
    state,
  };
}

function makeTestDeps(
  overrides: {
    getDebugLog?: () => boolean;
    getEditorLog?: () => boolean;
    getDebugLogPath?: () => string;
    getEditorLogPath?: () => string;
  } = {},
): DebugLogDeps {
  const { fs: mockFs } = makeMockFs();
  return {
    getDebugLog: overrides.getDebugLog ?? (() => true),
    getEditorLog: overrides.getEditorLog ?? (() => true),
    fs: mockFs,
    getDebugLogPath: overrides.getDebugLogPath ?? (() => "/test/debug.log"),
    getEditorLogPath: overrides.getEditorLogPath ?? (() => "/test/editor.log"),
  };
}

describe("log", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("debugLog", () => {
    it("does nothing when getDebugLog returns false", () => {
      const deps = makeTestDeps({ getDebugLog: () => false });
      debugLog("test message", deps);
      assert.equal(deps.fs.existsSync("/test/debug.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      const deps = makeTestDeps();
      const mkdirCalls: string[] = [];
      const originalMkdirSync = deps.fs.mkdirSync;
      deps.fs.mkdirSync = (path: string) => {
        mkdirCalls.push(path);
        originalMkdirSync(path);
      };

      debugLog("test message", deps);
      assert.deepStrictEqual(mkdirCalls, ["/test"]);
    });

    it("appends content to log file with timestamp", () => {
      const depsWithTracking = makeTestDeps();

      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = depsWithTracking.fs.appendFileSync;
      depsWithTracking.fs.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
      };

      debugLog("test message", depsWithTracking);

      assert.equal(appendCalls.length, 1);
      const firstCall = appendCalls[0]!;
      assert.equal(firstCall.path, "/test/debug.log");
      assert.ok(firstCall.content.includes("test message"));
      assert.ok(/\d{4}-\d{2}-\d{2}T/.exec(firstCall.content));
    });

    it("appends multiple messages", () => {
      const deps = makeTestDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.fs.appendFileSync;
      deps.fs.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
      };

      debugLog("message 1", deps);
      debugLog("message 2", deps);

      assert.equal(appendCalls.length, 2);
      assert.ok(appendCalls[0]!.content.includes("message 1"));
      assert.ok(appendCalls[1]!.content.includes("message 2"));
    });
  });

  describe("editorLog", () => {
    it("does nothing when getEditorLog returns false", () => {
      const deps = makeTestDeps({ getEditorLog: () => false });
      editorLog("test message", deps);
      assert.equal(deps.fs.existsSync("/test/editor.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      const deps = makeTestDeps();
      const mkdirCalls: string[] = [];
      const originalMkdirSync = deps.fs.mkdirSync;
      deps.fs.mkdirSync = (path: string) => {
        mkdirCalls.push(path);
        originalMkdirSync(path);
      };

      editorLog("test message", deps);
      assert.deepStrictEqual(mkdirCalls, ["/test"]);
    });

    it("appends content with timestamp and separator", () => {
      const deps = makeTestDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.fs.appendFileSync;
      deps.fs.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
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
      const deps = makeTestDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.fs.appendFileSync;
      deps.fs.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
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
      const originalWrite = deps.fs.writeFileSync;
      deps.fs.writeFileSync = (path: string, content: string) => {
        writeCalls.push({ path, content });
        originalWrite(path, content);
      };

      resetDebugLog(deps);
      assert.equal(writeCalls.length, 0);
    });

    it("clears the log file when it exists", () => {
      const { fs: realMockFs } = makeMockFs();
      const deps: DebugLogDeps = {
        getDebugLog: () => true,
        getEditorLog: () => false,
        fs: realMockFs,
        getDebugLogPath: () => "/test/debug.log",
        getEditorLogPath: () => "/test/editor.log",
      };

      realMockFs.mkdirSync("/test", { recursive: true });
      realMockFs.writeFileSync("/test/debug.log", "existing content");

      resetDebugLog(deps);

      assert.equal(realMockFs.existsSync("/test/debug.log"), true);
      const debugContent = realMockFs.readFileSync("/test/debug.log");
      assert.equal(debugContent, "");
    });
  });

  describe("resetEditorLog", () => {
    it("does nothing when log file does not exist", () => {
      const deps = makeTestDeps();
      const writeCalls: { path: string; content: string }[] = [];
      const originalWrite = deps.fs.writeFileSync;
      deps.fs.writeFileSync = (path: string, content: string) => {
        writeCalls.push({ path, content });
        originalWrite(path, content);
      };

      resetEditorLog(deps);
      assert.equal(writeCalls.length, 0);
    });

    it("clears the log file when it exists", () => {
      const { fs: realMockFs } = makeMockFs();
      const deps: DebugLogDeps = {
        getDebugLog: () => false,
        getEditorLog: () => true,
        fs: realMockFs,
        getDebugLogPath: () => "/test/debug.log",
        getEditorLogPath: () => "/test/editor.log",
      };

      realMockFs.mkdirSync("/test", { recursive: true });
      realMockFs.writeFileSync("/test/editor.log", "existing content");

      resetEditorLog(deps);

      assert.equal(realMockFs.existsSync("/test/editor.log"), true);
      const editorContent = realMockFs.readFileSync("/test/editor.log");
      assert.equal(editorContent, "");
    });
  });
});
