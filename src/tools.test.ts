import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import {
  executeBashTool,
  executeCreateFileTool,
  executeViewFileTool,
  executeStrReplaceTool,
  executeInsertLinesTool,
  executeWebFetchHtmlTool,
  executeWebFetchJsonTool,
  loadSkillTool,
} from "./tools.ts";
import { testFs, setupFakeDeps } from "./test-helpers.ts";
import { fsDeps } from "./deps.ts";
import { dispatch, actions } from "./state.ts";
import { processDeps } from "./deps.ts";

describe("tools", () => {
  beforeEach(() => {
    mock.method(processDeps.stdout, "write", () => undefined);
  });

  describe("executeBashTool", () => {
    it("returns a successful tool_result with stdout/stderr JSON", async () => {
      const result = await executeBashTool(
        { command: "echo hello" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        content: JSON.stringify({ stdout: "hello\n", stderr: "" }),
      });
    });

    it("captures stderr in the JSON payload", async () => {
      const result = await executeBashTool(
        { command: "echo error >&2" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        content: JSON.stringify({ stdout: "", stderr: "error\n" }),
      });
    });

    it("returns isError when command exits with non-zero code", async () => {
      const result = await executeBashTool({ command: "exit 1" }, undefined);
      assert.strictEqual(result.isError, true);
      assert.match(result.content, /Command failed: exit 1/);
    });
  });

  describe("executeCreateFileTool", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("creates a new file and returns success", () => {
      const result = executeCreateFileTool(
        { content: "hello world", path: "/test/new.txt" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        content: `/test/new.txt created successfully`,
      });
      assert.equal(testFs._files.get("/test/new.txt"), "hello world");
    });

    it("returns isError when the file already exists", () => {
      testFs._files.set("/test/existing.txt", "already here");
      const result = executeCreateFileTool(
        { content: "new content", path: "/test/existing.txt" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: `/test/existing.txt already exists`,
      });
    });

    it("returns isError when write fails", () => {
      mock.method(fsDeps, "writeFileSync", () => {
        throw new Error("EIO");
      });
      const result = executeCreateFileTool(
        { content: "x", path: "/test/file.txt" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: "EIO",
      });
    });
  });

  describe("executeViewFileTool", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("returns file contents with line numbers", () => {
      testFs._files.set("/test/lines.txt", "aaa\nbbb\nccc");
      const result = executeViewFileTool({ path: "/test/lines.txt" });
      assert.deepStrictEqual(result, {
        content: "1\taaa\n2\tbbb\n3\tccc",
      });
    });

    it("returns a slice when start_line and end_line are specified", () => {
      testFs._files.set("/test/lines.txt", "line1\nline2\nline3\nline4\nline5");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        start_line: 2,
        end_line: 4,
      });
      assert.deepStrictEqual(result, {
        content: "2\tline2\n3\tline3\n4\tline4",
      });
    });

    it("treats end_line=-1 as end of file", () => {
      testFs._files.set("/test/lines.txt", "a\nb\nc");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        start_line: 2,
        end_line: -1,
      });
      assert.deepStrictEqual(result, {
        content: "2\tb\n3\tc",
      });
    });

    it("lists directory contents for a directory path", () => {
      testFs._dirs.add("/test/dir");
      testFs._files.set("/test/dir/alpha.txt", "");
      testFs._files.set("/test/dir/beta.txt", "");
      const result = executeViewFileTool({ path: "/test/dir" });
      assert.deepStrictEqual(result, {
        content: "alpha.txt\nbeta.txt",
      });
    });

    it("returns isError for a nonexistent path", () => {
      const result = executeViewFileTool({ path: "/no/such/path/file.txt" });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "ENOENT: /no/such/path/file.txt",
      });
    });

    it("returns isError when start_line is less than 1", () => {
      testFs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        start_line: 0,
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "start_line must be at least 1, got 0",
      });
    });

    it("returns isError when end_line is less than 1 (and not -1)", () => {
      testFs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        end_line: 0,
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "end_line must be at least 1 or -1, got 0",
      });
    });

    it("returns isError when start_line is past end of file", () => {
      testFs._files.set("/test/lines.txt", "line1\nline2");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        start_line: 5,
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "start_line 5 is past end of file (file has 2 lines)",
      });
    });

    it("returns isError when end_line is past end of file", () => {
      testFs._files.set("/test/lines.txt", "line1\nline2");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        end_line: 10,
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "end_line 10 is past end of file (file has 2 lines)",
      });
    });

    it("returns isError when start_line is greater than or equal to end_line", () => {
      testFs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        start_line: 3,
        end_line: 2,
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "start_line (3) must be less than end_line (2)",
      });
    });

    it("returns single line when start_line equals end_line", () => {
      testFs._files.set("/test/lines.txt", "line1\nline2\nline3");
      const result = executeViewFileTool({
        path: "/test/lines.txt",
        start_line: 2,
        end_line: 2,
      });
      assert.deepStrictEqual(result, {
        content: "2\tline2",
      });
    });
  });

  describe("executeStrReplaceTool", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("replaces old_str with new_str when exactly one match exists", () => {
      testFs._files.set("/test/file.txt", "foo bar baz");
      const result = executeStrReplaceTool(
        { path: "/test/file.txt", old_str: "bar", new_str: "qux" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(testFs._files.get("/test/file.txt"), "foo qux baz");
    });

    it("returns isError when old_str is not found", () => {
      testFs._files.set("/test/file.txt", "foo bar baz");
      const result = executeStrReplaceTool(
        { path: "/test/file.txt", old_str: "missing", new_str: "x" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: "old_str not found in file",
      });
    });

    it("returns isError when old_str matches more than once", () => {
      testFs._files.set("/test/file.txt", "aaa bbb aaa");
      const result = executeStrReplaceTool(
        { path: "/test/file.txt", old_str: "aaa", new_str: "x" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: "old_str matched 2 times — must match exactly once",
      });
    });

    it("returns isError when the file does not exist", () => {
      const result = executeStrReplaceTool(
        { path: "/no/such/path/file.txt", old_str: "a", new_str: "b" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: "ENOENT: /no/such/path/file.txt",
      });
    });
  });

  describe("executeInsertLinesTool", () => {
    beforeEach(() => {
      setupFakeDeps();
    });

    it("inserts text after a specific line", () => {
      testFs._files.set("/test/file.txt", "line1\nline2\nline3");
      const result = executeInsertLinesTool(
        { path: "/test/file.txt", after_line: 2, content: "inserted" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(
        testFs._files.get("/test/file.txt"),
        "line1\nline2\ninserted\nline3",
      );
    });

    it("inserts at the beginning when after_line is 0", () => {
      testFs._files.set("/test/file.txt", "line1\nline2");
      const result = executeInsertLinesTool(
        { path: "/test/file.txt", after_line: 0, content: "top" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(testFs._files.get("/test/file.txt"), `top\nline1\nline2`);
    });

    it("inserts at the end when after_line equals the number of lines", () => {
      testFs._files.set("/test/file.txt", "line1\nline2");
      const result = executeInsertLinesTool(
        { path: "/test/file.txt", after_line: 2, content: "bottom" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        content: `/test/file.txt updated successfully`,
      });
      assert.equal(testFs._files.get("/test/file.txt"), `line1\nline2\nbottom`);
    });

    it("returns isError when after_line is out of range (negative)", () => {
      testFs._files.set("/test/file.txt", "line1");
      const result = executeInsertLinesTool(
        { path: "/test/file.txt", after_line: -1, content: "x" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: `after_line -1 is out of range (file has 1 lines)`,
      });
    });

    it("returns isError when after_line is out of range (too large)", () => {
      testFs._files.set("/test/file.txt", "line1");
      const result = executeInsertLinesTool(
        { path: "/test/file.txt", after_line: 5, content: "x" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: `after_line 5 is out of range (file has 1 lines)`,
      });
    });

    it("returns isError when the file does not exist", () => {
      const result = executeInsertLinesTool(
        { path: "/no/such/path/file.txt", after_line: 0, content: "x" },
        undefined,
      );
      assert.deepStrictEqual(result, {
        isError: true,
        content: `ENOENT: /no/such/path/file.txt`,
      });
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
      mock.method(globalThis, "fetch", fakeFetch);

      const result = await executeWebFetchHtmlTool({
        href: "https://example.com/article",
      });
      assert.strictEqual(result.isError, undefined);
      const parsed = JSON.parse(result.content) as Record<string, unknown>;
      assert.equal(parsed["title"], "Test Page");
      assert.equal(
        parsed["textContent"],
        `This is the main content of the article that should be extracted.\n        \n      `,
      );
    });

    it("returns isError when fetch throws", async () => {
      const fakeFetch = () => {
        throw new Error("network error");
      };
      mock.method(globalThis, "fetch", fakeFetch);

      const result = await executeWebFetchHtmlTool({
        href: "https://example.com/fail",
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "network error",
      });
    });

    it("returns isError when response is not ok", async () => {
      const fakeFetch = () => {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve("server error"),
        } as Response);
      };
      mock.method(globalThis, "fetch", fakeFetch);

      const result = await executeWebFetchHtmlTool({
        href: "https://example.com/broken",
      });
      assert.deepStrictEqual(result, {
        isError: true,
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
      mock.method(globalThis, "fetch", fakeFetch);

      const result = await executeWebFetchJsonTool({
        href: "https://api.example.com/data",
      });
      assert.deepStrictEqual(result, {
        content: JSON.stringify(jsonData, null, 2),
      });
    });

    it("returns isError when fetch throws", async () => {
      const fakeFetch = () => {
        throw new Error("network error");
      };
      mock.method(globalThis, "fetch", fakeFetch);

      const result = await executeWebFetchJsonTool({
        href: "https://api.example.com/fail",
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "network error",
      });
    });

    it("returns isError when response is not ok", async () => {
      const fakeFetch = () => {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        } as Response);
      };
      mock.method(globalThis, "fetch", fakeFetch);

      const result = await executeWebFetchJsonTool({
        href: "https://api.example.com/missing",
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "HTTP 404: Not Found",
      });
    });

    it("returns isError when JSON parsing fails", async () => {
      const fakeFetch = () => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error("Invalid JSON")),
        } as Response);
      };
      mock.method(globalThis, "fetch", fakeFetch);

      const result = await executeWebFetchJsonTool({
        href: "https://api.example.com/bad-json",
      });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "Invalid JSON",
      });
    });
  });

  describe("loadSkillTool", () => {
    beforeEach(() => {
      dispatch(actions.resetState());
    });

    it("returns loaded skill content when skill exists in state", () => {
      dispatch(
        actions.setSkills([
          {
            name: "deploy",
            description: "Deploy skill",
            dir: "/skills/deploy",
            content: "# Deploy instructions",
          },
        ]),
      );
      const result = loadSkillTool({ name: "deploy" });
      assert.deepStrictEqual(result, {
        content: JSON.stringify(
          {
            name: "deploy",
            description: "Deploy skill",
            dir: "/skills/deploy",
            content: "# Deploy instructions",
          },
          null,
          2,
        ),
      });
    });

    it("finds the correct skill when multiple skills are stored", () => {
      dispatch(
        actions.setSkills([
          {
            name: "skill-a",
            description: "Skill A",
            dir: "/a",
            content: "content a",
          },
          {
            name: "skill-b",
            description: "Skill B",
            dir: "/b",
            content: "content b",
          },
        ]),
      );
      const result = loadSkillTool({ name: "skill-b" });
      const parsed = JSON.parse(result.content) as Record<string, unknown>;
      assert.equal(parsed["name"], "skill-b");
    });

    it("returns isError when skill is not found", () => {
      const result = loadSkillTool({ name: "nonexistent" });
      assert.deepStrictEqual(result, {
        isError: true,
        content: "Could not find a skill with name: nonexistent",
      });
    });

    it("returns isError when no skills are loaded", () => {
      const result = loadSkillTool({ name: "any" });
      assert.strictEqual(result.isError, true);
    });
  });
});
