import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { dispatch, actions, selectors } from "./state.ts";
import { resolveApiCall } from "./api.ts";
import {
  setupTestContext,
  testFs,
  mockExec,
  stripAnsi,
} from "./test-helpers.ts";
import { aiDeps } from "./deps.ts";
import { BASE_SYSTEM_PROMPT } from "./context.ts";
import type { ModelMessage } from "ai";

function makeGenerateTextResult(overrides: Record<string, unknown> = {}) {
  return {
    text: "response text",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    response: { messages: [] },
    ...overrides,
  };
}

describe("api", () => {
  beforeEach(() => {
    setupTestContext();
    dispatch(actions.setProvider("anthropic"));
    dispatch(actions.setModel("claude-sonnet-4-20250514"));
    dispatch(actions.setBaseURL("https://api.anthropic.com"));
    dispatch(actions.setContextStr(""));
    dispatch(actions.setSkillsStr(""));
    mock.method(aiDeps, "generateText", () =>
      Promise.resolve(makeGenerateTextResult()),
    );
  });

  describe("resolveApiCall", () => {
    it("returns text on success", async () => {
      const result = await resolveApiCall("hello");
      assert.strictEqual(result, "response text");
    });

    it("returns null on non-abort error", async () => {
      mock.method(aiDeps, "generateText", () =>
        Promise.reject(new Error("network error")),
      );
      const result = await resolveApiCall("hello");
      assert.strictEqual(result, null);
    });

    it("returns null on abort error", async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      mock.method(aiDeps, "generateText", () => Promise.reject(err));
      const result = await resolveApiCall("hello");
      assert.strictEqual(result, null);
    });

    it("appends usage and messages on success", async () => {
      mock.method(aiDeps, "generateText", () =>
        Promise.resolve(
          makeGenerateTextResult({
            usage: {
              inputTokens: 42,
              outputTokens: 7,
              inputTokenDetails: {
                cacheReadTokens: 3,
                cacheWriteTokens: 1,
              },
            },
            response: {
              messages: [
                { role: "assistant", content: "tool call" },
                { role: "tool", content: "tool result" },
              ],
            },
          }),
        ),
      );
      await resolveApiCall("hello");
      const usages = selectors.getMessageUsages();
      assert.deepStrictEqual(usages, [
        {
          inputTokens: 42,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
        },
      ]);
      const params = selectors.getMessageParams();
      assert.strictEqual(params.length, 3);
      assert.deepStrictEqual(params[0], { role: "user", content: "hello" });
    });

    it("creates temp file on tool call start for str_replace", async () => {
      testFs._files.set("/test/file.txt", "original content");
      mock.method(aiDeps, "generateText", (opts: Record<string, unknown>) => {
        const onStart = opts["experimental_onToolCallStart"] as (
          arg: Record<string, unknown>,
        ) => void;
        onStart({
          toolCall: {
            toolName: "str_replace",
            toolCallId: "call-1",
            input: { path: "/test/file.txt" },
          },
        });
        return makeGenerateTextResult();
      });
      await resolveApiCall("edit file");
      assert.ok(testFs._files.has("/tmp/agent-js-test-uuid.txt"));
      assert.strictEqual(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "original content",
      );
    });

    it("creates temp file on tool call start for insert_lines", async () => {
      testFs._files.set("/test/file.txt", "original");
      mock.method(aiDeps, "generateText", (opts: Record<string, unknown>) => {
        const onStart = opts["experimental_onToolCallStart"] as (
          arg: Record<string, unknown>,
        ) => void;
        onStart({
          toolCall: {
            toolName: "insert_lines",
            toolCallId: "call-2",
            input: { path: "/test/file.txt" },
          },
        });
        return makeGenerateTextResult();
      });
      await resolveApiCall("edit file");
      assert.ok(testFs._files.has("/tmp/agent-js-test-uuid.txt"));
    });

    it("does not create temp file for non-file tools", async () => {
      mock.method(aiDeps, "generateText", (opts: Record<string, unknown>) => {
        const onStart = opts["experimental_onToolCallStart"] as (
          arg: Record<string, unknown>,
        ) => void;
        onStart({
          toolCall: {
            toolName: "bash",
            toolCallId: "call-3",
            input: { command: "ls" },
          },
        });
        return makeGenerateTextResult();
      });
      await resolveApiCall("run command");
      assert.strictEqual(
        testFs._files.has("/tmp/agent-js-test-uuid.txt"),
        false,
      );
    });

    it("prints diff and cleans up on tool call finish success", async () => {
      dispatch(actions.resetStdout());
      testFs._files.set("/test/file.txt", "modified content");
      mock.method(
        aiDeps,
        "generateText",
        async (opts: Record<string, unknown>) => {
          const onStart = opts["experimental_onToolCallStart"] as (
            arg: Record<string, unknown>,
          ) => void;
          const onFinish = opts["experimental_onToolCallFinish"] as (
            arg: Record<string, unknown>,
          ) => Promise<void>;
          onStart({
            toolCall: {
              toolName: "str_replace",
              toolCallId: "call-1",
              input: { path: "/test/file.txt" },
            },
          });
          await onFinish({
            toolCall: {
              toolName: "str_replace",
              toolCallId: "call-1",
              input: { path: "/test/file.txt" },
            },
            success: true,
          });
          return makeGenerateTextResult();
        },
      );
      mockExec({ stdout: "+added line" });
      await resolveApiCall("edit file");
      assert.strictEqual(
        stripAnsi(selectors.getStdout()),
        "\n━━ File change: /test/file.txt ━━\n+added line\n\n",
      );
      assert.strictEqual(
        testFs._files.has("/tmp/agent-js-test-uuid.txt"),
        false,
      );
    });

    it("cleans up without printing diff on tool call finish failure", async () => {
      testFs._files.set("/test/file.txt", "content");
      mock.method(
        aiDeps,
        "generateText",
        async (opts: Record<string, unknown>) => {
          const onStart = opts["experimental_onToolCallStart"] as (
            arg: Record<string, unknown>,
          ) => void;
          const onFinish = opts["experimental_onToolCallFinish"] as (
            arg: Record<string, unknown>,
          ) => Promise<void>;
          onStart({
            toolCall: {
              toolName: "str_replace",
              toolCallId: "call-1",
              input: { path: "/test/file.txt" },
            },
          });
          await onFinish({
            toolCall: {
              toolName: "str_replace",
              toolCallId: "call-1",
              input: { path: "/test/file.txt" },
            },
            success: false,
          });
          return makeGenerateTextResult();
        },
      );
      await resolveApiCall("edit file");
      assert.strictEqual(
        testFs._files.has("/tmp/agent-js-test-uuid.txt"),
        false,
      );
    });

    it("passes system content from context and skills", async () => {
      dispatch(actions.setContextStr("CTX: project context"));
      dispatch(actions.setSkillsStr("SKILLS: available skills"));
      let capturedSystem: string | undefined;
      mock.method(aiDeps, "generateText", (opts: Record<string, unknown>) => {
        capturedSystem = opts["system"] as string;
        return makeGenerateTextResult();
      });
      await resolveApiCall("hello");
      assert.strictEqual(
        capturedSystem,
        `${BASE_SYSTEM_PROMPT}
CTX: project context
SKILLS: available skills`,
      );
    });

    it("includes previous messages in request", async () => {
      dispatch(
        actions.appendToMessageParams({ role: "user", content: "previous" }),
      );
      dispatch(
        actions.appendToMessageParams({
          role: "assistant",
          content: "response",
        }),
      );
      let capturedMessages: ModelMessage[] = [];
      mock.method(aiDeps, "generateText", (opts: Record<string, unknown>) => {
        capturedMessages = opts["messages"] as ModelMessage[];
        return makeGenerateTextResult();
      });
      await resolveApiCall("hello");
      assert.strictEqual(capturedMessages.length, 3);
      assert.deepStrictEqual(capturedMessages[0], {
        role: "user",
        content: "previous",
      });
      assert.deepStrictEqual(capturedMessages[1], {
        role: "assistant",
        content: "response",
      });
      assert.deepStrictEqual(capturedMessages[2], {
        role: "user",
        content: "hello",
      });
    });
  });
});
