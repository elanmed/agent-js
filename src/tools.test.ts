/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  executeBashTool,
  getBashToolResultBlockParam,
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

describe("tools", () => {
  describe("executeBashTool", () => {
    it("throws when input is not an object", async () => {
      const block = makeToolUseBlock({
        input: "not-an-object" as unknown as Record<string, unknown>,
      });
      await assert.rejects(
        () => executeBashTool(block),
        /Expected `toolUseBlock.input` to be an object/,
      );
    });

    it("throws when input is null", async () => {
      const block = makeToolUseBlock({
        input: null as unknown as Record<string, unknown>,
      });
      await assert.rejects(
        () => executeBashTool(block),
        /Expected `toolUseBlock.input` to be an object/,
      );
    });

    it("throws when command key is missing", async () => {
      const block = makeToolUseBlock({ input: {} });
      await assert.rejects(
        () => executeBashTool(block),
        /Expected `toolUseBlock.input.command` to be a valid key/,
      );
    });

    it("throws when command is not a string", async () => {
      const block = makeToolUseBlock({ input: { command: 42 } });
      await assert.rejects(
        () => executeBashTool(block),
        /Expected `toolUseBlock.input.command` to be a string/,
      );
    });

    it("returns stdout from a successful command", async () => {
      const block = makeToolUseBlock({ input: { command: "echo hello" } });
      const result = await executeBashTool(block);
      assert.equal(result.stdout.trim(), "hello");
      assert.equal(result.stderr, "");
    });

    it("returns stderr from a command writing to stderr", async () => {
      const block = makeToolUseBlock({
        input: { command: "echo error >&2" },
      });
      const result = await executeBashTool(block);
      assert.equal(result.stderr.trim(), "error");
    });

    it("rejects when command exits with non-zero code", async () => {
      const block = makeToolUseBlock({ input: { command: "exit 1" } });
      await assert.rejects(() => executeBashTool(block));
    });
  });

  describe("getBashToolResultBlockParam", () => {
    it("returns a successful tool_result block with stdout", async () => {
      const block = makeToolUseBlock({ input: { command: "echo hi" } });
      const result = await getBashToolResultBlockParam(block);
      assert.equal(result.type, "tool_result");
      assert.equal(result.tool_use_id, "tool_1");
      assert.ok(!result.is_error);
      const parsed = JSON.parse(result.content as string) as {
        stdout: string;
        stderr: string;
      };
      assert.equal(parsed.stdout.trim(), "hi");
    });

    it("returns an is_error tool_result block on failure with the error message", async () => {
      const block = makeToolUseBlock({ input: { command: "exit 1" } });
      const result = await getBashToolResultBlockParam(block);
      assert.equal(result.type, "tool_result");
      assert.equal(result.tool_use_id, "tool_1");
      assert.equal(result.is_error, true);
      assert.ok(typeof result.content === "string");
      assert.ok(result.content.length > 0);
    });
  });

  describe("getToolResultBlock", () => {
    it("handles the bash tool", async () => {
      const block = makeToolUseBlock({ input: { command: "echo test" } });
      const result = await getToolResultBlock(block);
      assert.equal(result.type, "tool_result");
      assert.equal(result.tool_use_id, "tool_1");
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
