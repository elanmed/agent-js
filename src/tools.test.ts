/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import {
  executeBashTool,
  executeCreateFileTool,
  executeViewFileTool,
  executeStrReplaceTool,
  executeInsertLinesTool,
  getToolResultBlock,
} from "./tools.ts";

function makeToolUseBlock(
  overrides: Partial<Anthropic.Messages.ToolUseBlock> = {},
): Anthropic.Messages.ToolUseBlock {
  return {
    type: "tool_use",
    id: "tool_1",
    name: "bash",
    input: { command: "echo hello" },
    ...overrides,
  } as Anthropic.Messages.ToolUseBlock;
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
      const block = makeToolUseBlock({
        input: "not-an-object" as unknown as Record<string, unknown>,
      });
      await assert.rejects(() => executeBashTool(block));
    });

    it("returns a successful tool_result with stdout/stderr JSON", async () => {
      const block = makeToolUseBlock({ input: { command: "echo hello" } });
      const result = await executeBashTool(block);
      assert.equal(result.type, "tool_result");
      assert.equal(result.tool_use_id, "tool_1");
      assert.ok(!result.is_error);
      const parsed = JSON.parse(result.content as string) as {
        stdout: string;
        stderr: string;
      };
      assert.equal(parsed.stdout.trim(), "hello");
      assert.equal(parsed.stderr, "");
    });

    it("captures stderr in the JSON payload", async () => {
      const block = makeToolUseBlock({
        input: { command: "echo error >&2" },
      });
      const result = await executeBashTool(block);
      assert.ok(!result.is_error);
      const parsed = JSON.parse(result.content as string) as {
        stdout: string;
        stderr: string;
      };
      assert.equal(parsed.stderr.trim(), "error");
    });

    it("returns is_error when command exits with non-zero code", async () => {
      const block = makeToolUseBlock({ input: { command: "exit 1" } });
      const result = await executeBashTool(block);
      assert.equal(result.type, "tool_result");
      assert.equal(result.is_error, true);
      assert.ok(typeof result.content === "string");
      assert.ok(result.content.length > 0);
    });
  });

  describe("executeCreateFileTool", () => {
    it("creates a new file and returns success", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "new.txt");
      const block = makeToolUseBlock({
        name: "create_file",
        input: { path: filePath, content: "hello world" },
      });
      const result = executeCreateFileTool(block);
      assert.equal(result.type, "tool_result");
      assert.ok(!result.is_error);
      assert.ok((result.content as string).includes("created successfully"));
      assert.equal(fs.readFileSync(filePath).toString(), "hello world");
    });

    it("returns is_error when the file already exists", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "existing.txt");
      fs.writeFileSync(filePath, "already here");
      const block = makeToolUseBlock({
        name: "create_file",
        input: { path: filePath, content: "new content" },
      });
      const result = executeCreateFileTool(block);
      assert.equal(result.is_error, true);
      assert.ok((result.content as string).includes("already exists"));
    });

    it("returns is_error when writing to an invalid path", () => {
      const block = makeToolUseBlock({
        name: "create_file",
        input: {
          path: "/no/such/directory/file.txt",
          content: "x",
        },
      });
      const result = executeCreateFileTool(block);
      assert.equal(result.is_error, true);
      assert.ok(typeof result.content === "string");
    });

    it("throws on invalid input schema", () => {
      const block = makeToolUseBlock({
        name: "create_file",
        input: { bad: true },
      });
      assert.throws(() => executeCreateFileTool(block));
    });
  });

  describe("executeViewFileTool", () => {
    it("returns file contents with line numbers", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "lines.txt");
      fs.writeFileSync(filePath, "aaa\nbbb\nccc");
      const block = makeToolUseBlock({
        name: "view_file",
        input: { path: filePath },
      });
      const result = executeViewFileTool(block);
      assert.equal(result.type, "tool_result");
      assert.ok(!result.is_error);
      const content = result.content as string;
      assert.ok(content.includes("1\taaa"));
      assert.ok(content.includes("2\tbbb"));
      assert.ok(content.includes("3\tccc"));
    });

    it("returns a slice when start_line and end_line are specified", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "lines.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5");
      const block = makeToolUseBlock({
        name: "view_file",
        input: { path: filePath, start_line: 2, end_line: 4 },
      });
      const result = executeViewFileTool(block);
      assert.ok(!result.is_error);
      const content = result.content as string;
      assert.ok(content.includes("2\tline2"));
      assert.ok(content.includes("3\tline3"));
      assert.ok(content.includes("4\tline4"));
      assert.ok(!content.includes("1\tline1"));
      assert.ok(!content.includes("5\tline5"));
    });

    it("treats end_line=-1 as end of file", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "lines.txt");
      fs.writeFileSync(filePath, "a\nb\nc");
      const block = makeToolUseBlock({
        name: "view_file",
        input: { path: filePath, start_line: 2, end_line: -1 },
      });
      const result = executeViewFileTool(block);
      assert.ok(!result.is_error);
      const content = result.content as string;
      assert.ok(content.includes("2\tb"));
      assert.ok(content.includes("3\tc"));
      assert.ok(!content.includes("1\ta"));
    });

    it("lists directory contents for a directory path", () => {
      const dir = getTmpDir();
      fs.writeFileSync(path.join(dir, "alpha.txt"), "");
      fs.writeFileSync(path.join(dir, "beta.txt"), "");
      const block = makeToolUseBlock({
        name: "view_file",
        input: { path: dir },
      });
      const result = executeViewFileTool(block);
      assert.ok(!result.is_error);
      const content = result.content as string;
      assert.ok(content.includes("alpha.txt"));
      assert.ok(content.includes("beta.txt"));
    });

    it("returns is_error for a nonexistent path", () => {
      const block = makeToolUseBlock({
        name: "view_file",
        input: { path: "/no/such/path/file.txt" },
      });
      const result = executeViewFileTool(block);
      assert.equal(result.is_error, true);
      assert.ok(typeof result.content === "string");
    });

    it("throws on invalid input schema", () => {
      const block = makeToolUseBlock({
        name: "view_file",
        input: { wrong: 123 },
      });
      assert.throws(() => executeViewFileTool(block));
    });
  });

  describe("executeStrReplaceTool", () => {
    it("replaces old_str with new_str when exactly one match exists", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "foo bar baz");
      const block = makeToolUseBlock({
        name: "str_replace",
        input: { path: filePath, old_str: "bar", new_str: "qux" },
      });
      const result = executeStrReplaceTool(block);
      assert.ok(!result.is_error);
      assert.ok((result.content as string).includes("updated successfully"));
      assert.equal(fs.readFileSync(filePath).toString(), "foo qux baz");
    });

    it("returns is_error when old_str is not found", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "foo bar baz");
      const block = makeToolUseBlock({
        name: "str_replace",
        input: { path: filePath, old_str: "missing", new_str: "x" },
      });
      const result = executeStrReplaceTool(block);
      assert.equal(result.is_error, true);
      assert.ok((result.content as string).includes("not found"));
    });

    it("returns is_error when old_str matches more than once", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "aaa bbb aaa");
      const block = makeToolUseBlock({
        name: "str_replace",
        input: { path: filePath, old_str: "aaa", new_str: "x" },
      });
      const result = executeStrReplaceTool(block);
      assert.equal(result.is_error, true);
      assert.ok((result.content as string).includes("2 times"));
    });

    it("returns is_error when the file does not exist", () => {
      const block = makeToolUseBlock({
        name: "str_replace",
        input: {
          path: "/no/such/path/file.txt",
          old_str: "a",
          new_str: "b",
        },
      });
      const result = executeStrReplaceTool(block);
      assert.equal(result.is_error, true);
    });

    it("throws on invalid input schema", () => {
      const block = makeToolUseBlock({
        name: "str_replace",
        input: { path: "/tmp/x" },
      });
      assert.throws(() => executeStrReplaceTool(block));
    });
  });

  describe("executeInsertLinesTool", () => {
    it("inserts text after a specific line", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: { path: filePath, after_line: 2, content: "inserted" },
      });
      const result = executeInsertLinesTool(block);
      assert.ok(!result.is_error);
      assert.ok((result.content as string).includes("updated successfully"));
      assert.equal(
        fs.readFileSync(filePath).toString(),
        "line1\nline2\ninserted\nline3",
      );
    });

    it("inserts at the beginning when after_line is 0", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1\nline2");
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: { path: filePath, after_line: 0, content: "top" },
      });
      const result = executeInsertLinesTool(block);
      assert.ok(!result.is_error);
      assert.equal(fs.readFileSync(filePath).toString(), "top\nline1\nline2");
    });

    it("inserts at the end when after_line equals the number of lines", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1\nline2");
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: { path: filePath, after_line: 2, content: "bottom" },
      });
      const result = executeInsertLinesTool(block);
      assert.ok(!result.is_error);
      assert.equal(
        fs.readFileSync(filePath).toString(),
        "line1\nline2\nbottom",
      );
    });

    it("returns is_error when after_line is out of range (negative)", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1");
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: { path: filePath, after_line: -1, content: "x" },
      });
      const result = executeInsertLinesTool(block);
      assert.equal(result.is_error, true);
      assert.ok((result.content as string).includes("out of range"));
    });

    it("returns is_error when after_line is out of range (too large)", () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "file.txt");
      fs.writeFileSync(filePath, "line1");
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: { path: filePath, after_line: 5, content: "x" },
      });
      const result = executeInsertLinesTool(block);
      assert.equal(result.is_error, true);
      assert.ok((result.content as string).includes("out of range"));
    });

    it("returns is_error when the file does not exist", () => {
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: {
          path: "/no/such/path/file.txt",
          after_line: 0,
          content: "x",
        },
      });
      const result = executeInsertLinesTool(block);
      assert.equal(result.is_error, true);
    });

    it("throws on invalid input schema", () => {
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: { path: "/tmp/x" },
      });
      assert.throws(() => executeInsertLinesTool(block));
    });
  });

  describe("getToolResultBlock", () => {
    it("handles the bash tool", async () => {
      const block = makeToolUseBlock({ input: { command: "echo test" } });
      const result = await getToolResultBlock(block);
      assert.equal(result.type, "tool_result");
      assert.equal(result.tool_use_id, "tool_1");
    });

    it("handles the create_file tool", async () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "via-dispatch.txt");
      const block = makeToolUseBlock({
        name: "create_file",
        input: { path: filePath, content: "dispatched" },
      });
      const result = await getToolResultBlock(block);
      assert.equal(result.type, "tool_result");
      assert.ok(!result.is_error);
      assert.equal(fs.readFileSync(filePath).toString(), "dispatched");
    });

    it("handles the view_file tool", async () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "view-me.txt");
      fs.writeFileSync(filePath, "content");
      const block = makeToolUseBlock({
        name: "view_file",
        input: { path: filePath },
      });
      const result = await getToolResultBlock(block);
      assert.equal(result.type, "tool_result");
      assert.ok(!result.is_error);
      assert.ok((result.content as string).includes("content"));
    });

    it("handles the str_replace tool", async () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "replace-me.txt");
      fs.writeFileSync(filePath, "old text");
      const block = makeToolUseBlock({
        name: "str_replace",
        input: { path: filePath, old_str: "old", new_str: "new" },
      });
      const result = await getToolResultBlock(block);
      assert.equal(result.type, "tool_result");
      assert.ok(!result.is_error);
      assert.equal(fs.readFileSync(filePath).toString(), "new text");
    });

    it("handles the insert_lines tool", async () => {
      const dir = getTmpDir();
      const filePath = path.join(dir, "insert-me.txt");
      fs.writeFileSync(filePath, "first\nsecond");
      const block = makeToolUseBlock({
        name: "insert_lines",
        input: { path: filePath, after_line: 1, content: "middle" },
      });
      const result = await getToolResultBlock(block);
      assert.equal(result.type, "tool_result");
      assert.ok(!result.is_error);
      assert.equal(
        fs.readFileSync(filePath).toString(),
        "first\nmiddle\nsecond",
      );
    });

    it("throws for an unknown tool name", async () => {
      const block = makeToolUseBlock({ name: "unknown_tool" });
      await assert.rejects(
        () => getToolResultBlock(block),
        /Failed to create a tool result when processing the tool call/,
      );
    });
  });
});
