/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-non-null-assertion */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { getState, resetState, dispatch, actions } from "./state.ts";

beforeEach(() => {
  resetState();
});

describe("state", () => {
  it("initial state", () => {
    const s = getState();
    assert.equal(s.running, true);
    assert.equal(s.interrupted, false);
    assert.deepEqual(s.messageParams, []);
    assert.deepEqual(s.messageUsages, []);
  });

  it("set-interrupted", () => {
    dispatch(actions.setInterrupted(true));
    assert.equal(getState().interrupted, true);

    dispatch(actions.setInterrupted(false));
    assert.equal(getState().interrupted, false);
  });

  it("set-running", () => {
    dispatch(actions.setRunning(false));
    assert.equal(getState().running, false);

    dispatch(actions.setRunning(true));
    assert.equal(getState().running, true);
  });

  describe("append-to-message-params", () => {
    it("appends new message to the list", () => {
      dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
      assert.equal(getState().messageParams.length, 1);
      assert.deepEqual(getState().messageParams[0], {
        role: "user",
        content: "hi",
      });
    });

    it("sets cache_control to null on prior messages with array content", () => {
      dispatch(
        actions.appendToMessageParams({
          role: "user",
          content: [
            {
              type: "text",
              text: "first",
              cache_control: { type: "ephemeral" },
            },
          ],
        }),
      );

      dispatch(
        actions.appendToMessageParams({
          role: "assistant",
          content: [{ type: "text", text: "second" }],
        }),
      );

      const params = getState().messageParams;
      assert.equal(params.length, 2);
      const firstContent = params[0]!.content;
      assert.ok(Array.isArray(firstContent));
      assert.equal(
        (firstContent[0] as { cache_control: unknown }).cache_control,
        null,
      );
    });

    it("passes through messages with string content untouched", () => {
      dispatch(
        actions.appendToMessageParams({ role: "user", content: "hello" }),
      );
      dispatch(
        actions.appendToMessageParams({ role: "assistant", content: "world" }),
      );

      const params = getState().messageParams;
      assert.equal(params[0]!.content, "hello");
    });
  });

  it("append-to-message-responses", () => {
    const usage1 = {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as Anthropic.Messages.Usage;
    const usage2 = {
      input_tokens: 20,
      output_tokens: 8,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 1,
    } as Anthropic.Messages.Usage;

    dispatch(actions.appendToMessageUsages(usage1));
    dispatch(actions.appendToMessageUsages(usage2));

    assert.deepEqual(getState().messageUsages, [usage1, usage2]);
  });

  describe("pop-last-message-param", () => {
    it("removes the last message", () => {
      dispatch(actions.appendToMessageParams({ role: "user", content: "a" }));
      dispatch(
        actions.appendToMessageParams({ role: "assistant", content: "b" }),
      );
      dispatch(actions.popLastMessageParam());

      const params = getState().messageParams;
      assert.equal(params.length, 1);
      assert.equal(params[0]!.content, "a");
    });

    it("no-ops on empty array", () => {
      dispatch(actions.popLastMessageParam());
      assert.deepEqual(getState().messageParams, []);
    });
  });
});
