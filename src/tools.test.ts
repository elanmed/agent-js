import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import {
  executeBashTool,
  executeCreateFileTool,
  executeViewFileTool,
  executeStrReplaceTool,
  executeInsertLinesTool,
  executeWebFetchTool,
} from "./tools.ts";
import type { ToolCall } from "./tools.ts";
import type { ToolLogDeps } from "./tools.ts";
import type { DebugLog } from "./utils.ts";

const execPromise = promisify(exec);

const noop: DebugLog = () => {
  void 0;
};
const debugDeps = {
  debugLog: noop,
  toolLog: noop as (label: string, detail: string, deps?: ToolLogDeps) => void,
};
const bashDeps = { ...debugDeps, exec: execPromise };

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tool_1",
    name: "bash",
    input: { command: "echo hello" },
    ...overrides,
  };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tools-test-"));
}

describe("tools", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function getTmpDir(): string {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    return dir;
  }

  describe("executeBashTool", () => {
    it("throws when input is invalid", async () => {
      const call = makeToolCall({
        input: "not-an-object" as unknown as Record<string, unknown>,
      });
      await assert.rejects(() => executeBashTool(call, bashDeps));
    });

    it("returns a successful tool_result with stdout/stderr JSON", async () => {
      const call = makeToolCall({ input: { command: "echo hello" } });
      const result = await executeBashTool(call, bashDeps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: JSON.stringify({ stdout: "hello\n", stderr: "" }),
      });
    });

    it("captures stderr in the JSON payload", async () => {
      const call = makeToolCall({
        input: { command: "echo error >&2" },
      });
      const result = await executeBashTool(call, bashDeps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: JSON.stringify({ stdout: "", stderr: "error\n" }),
      });
    });

    it("returns is_error when command exits with non-zero code", async () => {
      const call = makeToolCall({ input: { command: "exit 1" } });
      const result = await executeBashTool(call, bashDeps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "Command failed: exit 1\n",
      });
    });
  });

  describe("executeCreateFileTool", () => {
    it("creates a new file and returns success", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "new.txt");
      const call = makeToolCall({
        name: "create_file",
        input: { path: filePath, content: "hello world" },
      });
      const result = executeCreateFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `${filePath} created successfully`,
      });
      assert.equal(fs.readFileSync(filePath).toString(), "hello world");
    });

    it("returns is_error when the file already exists", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "existing.txt");
      fs.writeFileSync(filePath, "already here");
      const call = makeToolCall({
        name: "create_file",
        input: { path: filePath, content: "new content" },
      });
      const result = executeCreateFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `${filePath} already exists`,
      });
    });

    it("returns is_error when writing to an invalid path", () => {
      const call = makeToolCall({
        name: "create_file",
        input: {
          path: "/no/such/directory/file.txt",
          content: "x",
        },
      });
      const result = executeCreateFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `ENOENT: no such file or directory, open '/no/such/directory/file.txt'`,
      });
    });

    it("throws on invalid input schema", () => {
      const call = makeToolCall({
        name: "create_file",
        input: { bad: true },
      });
      assert.throws(() => executeCreateFileTool(call, { ...debugDeps, fs }));
    });
  });

  describe("executeViewFileTool", () => {
    it("returns file contents with line numbers", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "lines.txt");
      fs.writeFileSync(filePath, "aaa\nbbb\nccc");
      const call = makeToolCall({
        name: "view_file",
        input: { path: filePath },
      });
      const result = executeViewFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "1\taaa\n2\tbbb\n3\tccc",
      });
    });

    it("returns a slice when start_line and end_line are specified", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "lines.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5");
      const call = makeToolCall({
        name: "view_file",
        input: { path: filePath, start_line: 2, end_line: 4 },
      });
      const result = executeViewFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "2\tline2\n3\tline3\n4\tline4",
      });
    });

    it("treats end_line=-1 as end of file", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "lines.txt");
      fs.writeFileSync(filePath, "a\nb\nc");
      const call = makeToolCall({
        name: "view_file",
        input: { path: filePath, start_line: 2, end_line: -1 },
      });
      const result = executeViewFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "2\tb\n3\tc",
      });
    });

    it("lists directory contents for a directory path", () => {
      const dir = getTmpDir();
      fs.writeFileSync(path.join(dir, "alpha.txt"), "");
      fs.writeFileSync(path.join(dir, "beta.txt"), "");
      const call = makeToolCall({
        name: "view_file",
        input: { path: dir },
      });
      const result = executeViewFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "alpha.txt\nbeta.txt",
      });
    });

    it("returns is_error for a nonexistent path", () => {
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/no/such/path/file.txt" },
      });
      const result = executeViewFileTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `ENOENT: no such file or directory, stat '/no/such/path/file.txt'`,
      });
    });

    it("throws on invalid input schema", () => {
      const call = makeToolCall({
        name: "view_file",
        input: { wrong: 123 },
      });
      assert.throws(() => executeViewFileTool(call, { ...debugDeps, fs }));
    });
  });

  describe("executeStrReplaceTool", () => {
    it("replaces old_str with new_str when exactly one match exists", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "foo bar baz");
      const call = makeToolCall({
        name: "str_replace",
        input: { path: filePath, old_str: "bar", new_str: "qux" },
      });
      const result = executeStrReplaceTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `${filePath} updated successfully`,
      });
      assert.equal(fs.readFileSync(filePath).toString(), "foo qux baz");
    });

    it("returns is_error when old_str is not found", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "foo bar baz");
      const call = makeToolCall({
        name: "str_replace",
        input: { path: filePath, old_str: "missing", new_str: "x" },
      });
      const result = executeStrReplaceTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "old_str not found in file",
      });
    });

    it("returns is_error when old_str matches more than once", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "aaa bbb aaa");
      const call = makeToolCall({
        name: "str_replace",
        input: { path: filePath, old_str: "aaa", new_str: "x" },
      });
      const result = executeStrReplaceTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "old_str matched 2 times — must match exactly once",
      });
    });

    it("returns is_error when the file does not exist", () => {
      const call = makeToolCall({
        name: "str_replace",
        input: {
          path: "/no/such/path/file.txt",
          old_str: "a",
          new_str: "b",
        },
      });
      const result = executeStrReplaceTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `ENOENT: no such file or directory, open '/no/such/path/file.txt'`,
      });
    });

    it("throws on invalid input schema", () => {
      const call = makeToolCall({
        name: "str_replace",
        input: { path: "/tmp/x" },
      });
      assert.throws(() => executeStrReplaceTool(call, { ...debugDeps, fs }));
    });
  });

  describe("executeInsertLinesTool", () => {
    it("inserts text after a specific line", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: filePath, after_line: 2, content: "inserted" },
      });
      const result = executeInsertLinesTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `${filePath} updated successfully`,
      });
      assert.equal(
        fs.readFileSync(filePath).toString(),
        "line1\nline2\ninserted\nline3",
      );
    });

    it("inserts at the beginning when after_line is 0", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1\nline2");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: filePath, after_line: 0, content: "top" },
      });
      const result = executeInsertLinesTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `${filePath} updated successfully`,
      });
      assert.equal(fs.readFileSync(filePath).toString(), "top\nline1\nline2");
    });

    it("inserts at the end when after_line equals the number of lines", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1\nline2");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: filePath, after_line: 2, content: "bottom" },
      });
      const result = executeInsertLinesTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `${filePath} updated successfully`,
      });
      assert.equal(
        fs.readFileSync(filePath).toString(),
        "line1\nline2\nbottom",
      );
    });

    it("returns is_error when after_line is out of range (negative)", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: filePath, after_line: -1, content: "x" },
      });
      const result = executeInsertLinesTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `after_line -1 is out of range (file has 1 lines)`,
      });
    });

    it("returns is_error when after_line is out of range (too large)", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: filePath, after_line: 5, content: "x" },
      });
      const result = executeInsertLinesTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `after_line 5 is out of range (file has 1 lines)`,
      });
    });

    it("returns is_error when the file does not exist", () => {
      const call = makeToolCall({
        name: "insert_lines",
        input: {
          path: "/no/such/path/file.txt",
          after_line: 0,
          content: "x",
        },
      });
      const result = executeInsertLinesTool(call, { ...debugDeps, fs });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `ENOENT: no such file or directory, open '/no/such/path/file.txt'`,
      });
    });

    it("throws on invalid input schema", () => {
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: "/tmp/x" },
      });
      assert.throws(() => executeInsertLinesTool(call, { ...debugDeps, fs }));
    });
  });

  describe("executeWebFetchTool", () => {
    it("returns parsed article content on success", async () => {
      const html = `
        <html>
          <head><title>Test Page</title></head>
          <body><p>This is the main content of the article that should be extracted.</p></body>
        </html>
      `;
      const fakeFetch = () => {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(html),
        } as Response);
      };

      const deps = { ...debugDeps, fetch: fakeFetch, JSDOM, Readability };
      const call = makeToolCall({
        name: "web_fetch",
        input: { href: "https://example.com/article" },
      });
      const result = await executeWebFetchTool(call, deps);
      assert.equal(result.type, "tool_result");
      assert.equal(result.tool_use_id, "tool_1");
      assert.equal(result.is_error, undefined);
      const parsed = JSON.parse(result.content) as Record<string, unknown>;
      assert.equal(parsed["title"], "Test Page");
      assert.ok((parsed["textContent"] as string).includes("main content"));
    });

    it("returns is_error when fetch throws", async () => {
      const fakeFetch = () => {
        throw new Error("network error");
      };
      const deps = { ...debugDeps, fetch: fakeFetch, JSDOM, Readability };
      const call = makeToolCall({
        name: "web_fetch",
        input: { href: "https://example.com/fail" },
      });
      const result = await executeWebFetchTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "network error",
      });
    });

    it("returns is_error for invalid input schema", async () => {
      const call = makeToolCall({
        name: "web_fetch",
        input: { bad: true },
      });
      await assert.rejects(() =>
        executeWebFetchTool(call, {
          ...debugDeps,
          fetch: fetch,
          JSDOM,
          Readability,
        }),
      );
    });

    it("returns is_error when response is not ok", async () => {
      const fakeFetch = () => {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve("server error"),
        } as Response);
      };
      const deps = { ...debugDeps, fetch: fakeFetch, JSDOM, Readability };
      const call = makeToolCall({
        name: "web_fetch",
        input: { href: "https://example.com/broken" },
      });
      const result = await executeWebFetchTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "HTTP 500: Internal Server Error",
      });
    });
  });
});
