import { describe, it } from "node:test";
import assert from "node:assert";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  executeBashTool,
  executeCreateFileTool,
  executeViewFileTool,
  executeStrReplaceTool,
  executeInsertLinesTool,
  executeWebFetchHtmlTool,
  executeWebFetchJsonTool,
} from "./tools.ts";
import type { ToolCall } from "./tools.ts";
import type { DebugLog, ToolLog } from "./state.ts";
import { makeFsDeps } from "./fs-deps.ts";

const execPromise = promisify(exec);

const debugNoop: DebugLog = () => {
  void 0;
};
const toolNoop: ToolLog = () => {
  void 0;
};
const debugDeps = {
  debugLog: debugNoop,
  toolLog: toolNoop,
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

describe("tools", () => {
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
      const fs = makeFsDeps();
      const call = makeToolCall({
        name: "create_file",
        input: { path: "/test/new.txt", content: "hello world" },
      });
      const result = executeCreateFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `/test/new.txt created successfully`,
      });
      assert.equal(fs._files.get("/test/new.txt"), "hello world");
    });

    it("returns is_error when the file already exists", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/existing.txt", "already here");
      const call = makeToolCall({
        name: "create_file",
        input: { path: "/test/existing.txt", content: "new content" },
      });
      const result = executeCreateFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `/test/existing.txt already exists`,
      });
    });

    it("returns is_error when write fails", () => {
      const fs = makeFsDeps();
      fs.writeFileSync = () => {
        throw new Error("EIO");
      };
      const call = makeToolCall({
        name: "create_file",
        input: {
          path: "/test/file.txt",
          content: "x",
        },
      });
      const result = executeCreateFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "EIO",
      });
    });

    it("throws on invalid input schema", () => {
      const call = makeToolCall({
        name: "create_file",
        input: { bad: true },
      });
      assert.throws(() =>
        executeCreateFileTool(call, {
          ...debugDeps,
          fs: makeFsDeps(),
        }),
      );
    });
  });

  describe("executeViewFileTool", () => {
    it("returns file contents with line numbers", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "aaa\nbbb\nccc");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt" },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "1\taaa\n2\tbbb\n3\tccc",
      });
    });

    it("returns a slice when start_line and end_line are specified", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "line1\nline2\nline3\nline4\nline5");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", start_line: 2, end_line: 4 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "2\tline2\n3\tline3\n4\tline4",
      });
    });

    it("treats end_line=-1 as end of file", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "a\nb\nc");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", start_line: 2, end_line: -1 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "2\tb\n3\tc",
      });
    });

    it("lists directory contents for a directory path", () => {
      const fs = makeFsDeps();
      fs._dirs.add("/test/dir");
      fs._listings.set("/test/dir", ["alpha.txt", "beta.txt"]);
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/dir" },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "alpha.txt\nbeta.txt",
      });
    });

    it("returns is_error for a nonexistent path", () => {
      const fs = makeFsDeps();
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/no/such/path/file.txt" },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "ENOENT: /no/such/path/file.txt",
      });
    });

    it("throws on invalid input schema", () => {
      const fs = makeFsDeps();
      const call = makeToolCall({
        name: "view_file",
        input: { wrong: 123 },
      });
      assert.throws(() =>
        executeViewFileTool(call, {
          ...debugDeps,
          fs,
        }),
      );
    });

    it("returns is_error when start_line is less than 1", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", start_line: 0 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "start_line must be at least 1, got 0",
      });
    });

    it("returns is_error when end_line is less than 1 (and not -1)", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", end_line: 0 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "end_line must be at least 1 or -1, got 0",
      });
    });

    it("returns is_error when start_line is past end of file", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "line1\nline2");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", start_line: 5 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "start_line 5 is past end of file (file has 2 lines)",
      });
    });

    it("returns is_error when end_line is past end of file", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "line1\nline2");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", end_line: 10 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "end_line 10 is past end of file (file has 2 lines)",
      });
    });

    it("returns is_error when start_line is greater than or equal to end_line", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", start_line: 3, end_line: 2 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "start_line (3) must be less than end_line (2)",
      });
    });

    it("returns single line when start_line equals end_line", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const call = makeToolCall({
        name: "view_file",
        input: { path: "/test/lines.txt", start_line: 2, end_line: 2 },
      });
      const result = executeViewFileTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "2\tline2",
      });
    });
  });

  describe("executeStrReplaceTool", () => {
    it("replaces old_str with new_str when exactly one match exists", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "foo bar baz");
      const call = makeToolCall({
        name: "str_replace",
        input: { path: "/test/file.txt", old_str: "bar", new_str: "qux" },
      });
      const result = executeStrReplaceTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(fs._files.get("/test/file.txt"), "foo qux baz");
    });

    it("returns is_error when old_str is not found", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "foo bar baz");
      const call = makeToolCall({
        name: "str_replace",
        input: { path: "/test/file.txt", old_str: "missing", new_str: "x" },
      });
      const result = executeStrReplaceTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "old_str not found in file",
      });
    });

    it("returns is_error when old_str matches more than once", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "aaa bbb aaa");
      const call = makeToolCall({
        name: "str_replace",
        input: { path: "/test/file.txt", old_str: "aaa", new_str: "x" },
      });
      const result = executeStrReplaceTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "old_str matched 2 times — must match exactly once",
      });
    });

    it("returns is_error when the file does not exist", () => {
      const fs = makeFsDeps();
      const call = makeToolCall({
        name: "str_replace",
        input: {
          path: "/no/such/path/file.txt",
          old_str: "a",
          new_str: "b",
        },
      });
      const result = executeStrReplaceTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "ENOENT: /no/such/path/file.txt",
      });
    });

    it("throws on invalid input schema", () => {
      const fs = makeFsDeps();
      const call = makeToolCall({
        name: "str_replace",
        input: { path: "/tmp/x" },
      });
      assert.throws(() =>
        executeStrReplaceTool(call, {
          ...debugDeps,
          fs,
        }),
      );
    });
  });

  describe("executeInsertLinesTool", () => {
    it("inserts text after a specific line", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "line1\nline2\nline3");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: "/test/file.txt", after_line: 2, content: "inserted" },
      });
      const result = executeInsertLinesTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(
        fs._files.get("/test/file.txt"),
        "line1\nline2\ninserted\nline3",
      );
    });

    it("inserts at the beginning when after_line is 0", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "line1\nline2");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: "/test/file.txt", after_line: 0, content: "top" },
      });
      const result = executeInsertLinesTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(fs._files.get("/test/file.txt"), "top\nline1\nline2");
    });

    it("inserts at the end when after_line equals the number of lines", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "line1\nline2");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: "/test/file.txt", after_line: 2, content: "bottom" },
      });
      const result = executeInsertLinesTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(fs._files.get("/test/file.txt"), "line1\nline2\nbottom");
    });

    it("returns is_error when after_line is out of range (negative)", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "line1");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: "/test/file.txt", after_line: -1, content: "x" },
      });
      const result = executeInsertLinesTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `after_line -1 is out of range (file has 1 lines)`,
      });
    });

    it("returns is_error when after_line is out of range (too large)", () => {
      const fs = makeFsDeps();
      fs._files.set("/test/file.txt", "line1");
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: "/test/file.txt", after_line: 5, content: "x" },
      });
      const result = executeInsertLinesTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `after_line 5 is out of range (file has 1 lines)`,
      });
    });

    it("returns is_error when the file does not exist", () => {
      const fs = makeFsDeps();
      const call = makeToolCall({
        name: "insert_lines",
        input: {
          path: "/no/such/path/file.txt",
          after_line: 0,
          content: "x",
        },
      });
      const result = executeInsertLinesTool(call, {
        ...debugDeps,
        fs,
      });
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: `ENOENT: /no/such/path/file.txt`,
      });
    });

    it("throws on invalid input schema", () => {
      const fs = makeFsDeps();
      const call = makeToolCall({
        name: "insert_lines",
        input: { path: "/tmp/x" },
      });
      assert.throws(() =>
        executeInsertLinesTool(call, {
          ...debugDeps,
          fs,
        }),
      );
    });
  });

  describe("executeWebFetchHtmlTool", () => {
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

      const deps = { ...debugDeps, fetch: fakeFetch };
      const call = makeToolCall({
        name: "web_fetch_html",
        input: { href: "https://example.com/article" },
      });
      const result = await executeWebFetchHtmlTool(call, deps);
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
      const deps = { ...debugDeps, fetch: fakeFetch };
      const call = makeToolCall({
        name: "web_fetch_html",
        input: { href: "https://example.com/fail" },
      });
      const result = await executeWebFetchHtmlTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "network error",
      });
    });

    it("throws on invalid input schema", async () => {
      const call = makeToolCall({
        name: "web_fetch_html",
        input: { bad: true },
      });
      await assert.rejects(() =>
        executeWebFetchHtmlTool(call, {
          ...debugDeps,
          fetch: () => Promise.resolve({ ok: true } as Response),
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
      const deps = { ...debugDeps, fetch: fakeFetch };
      const call = makeToolCall({
        name: "web_fetch_html",
        input: { href: "https://example.com/broken" },
      });
      const result = await executeWebFetchHtmlTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "HTTP 500: Internal Server Error",
      });
    });
  });

  describe("executeWebFetchJsonTool", () => {
    it("returns parsed JSON content on success", async () => {
      const jsonData = { name: "test", value: 42 };
      const fakeFetch = () => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(jsonData),
        } as Response);
      };

      const deps = { ...debugDeps, fetch: fakeFetch };
      const call = makeToolCall({
        name: "web_fetch_json",
        input: { href: "https://api.example.com/data" },
      });
      const result = await executeWebFetchJsonTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: JSON.stringify(jsonData, null, 2),
      });
    });

    it("returns is_error when fetch throws", async () => {
      const fakeFetch = () => {
        throw new Error("network error");
      };
      const deps = { ...debugDeps, fetch: fakeFetch };
      const call = makeToolCall({
        name: "web_fetch_json",
        input: { href: "https://api.example.com/fail" },
      });
      const result = await executeWebFetchJsonTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "network error",
      });
    });

    it("throws on invalid input schema", async () => {
      const call = makeToolCall({
        name: "web_fetch_json",
        input: { bad: true },
      });
      await assert.rejects(() =>
        executeWebFetchJsonTool(call, {
          ...debugDeps,
          fetch: () => Promise.resolve({ ok: true } as Response),
        }),
      );
    });

    it("returns is_error when response is not ok", async () => {
      const fakeFetch = () => {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        } as Response);
      };
      const deps = { ...debugDeps, fetch: fakeFetch };
      const call = makeToolCall({
        name: "web_fetch_json",
        input: { href: "https://api.example.com/missing" },
      });
      const result = await executeWebFetchJsonTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "HTTP 404: Not Found",
      });
    });

    it("returns is_error when JSON parsing fails", async () => {
      const fakeFetch = () => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error("Invalid JSON")),
        } as Response);
      };
      const deps = { ...debugDeps, fetch: fakeFetch };
      const call = makeToolCall({
        name: "web_fetch_json",
        input: { href: "https://api.example.com/bad-json" },
      });
      const result = await executeWebFetchJsonTool(call, deps);
      assert.deepStrictEqual(result, {
        type: "tool_result",
        tool_use_id: "tool_1",
        is_error: true,
        content: "Invalid JSON",
      });
    });
  });
});
