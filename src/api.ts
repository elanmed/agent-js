import type { ModelMessage, ToolSet } from "ai";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { actions, dispatch, selectors } from "./state.ts";
import {
  isAbortError,
  colorLog,
  debugLog,
  maybePrintUsageMessage,
  tryCatchAsync,
  getMessageFromError,
  executeBat,
  BASE_SYSTEM_PROMPT,
  getRecursiveAgentsMdFilesStr,
} from "./utils.ts";
import { getToolResultBlock, type ToolCall } from "./tools.ts";
import { TOOLS } from "./tools.ts";
import assert from "node:assert";

interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

interface CallApiResult {
  finishReason: string;
  toolCalls: ToolCallInfo[];
}

function getLanguageModel() {
  const provider = selectors.getProvider();
  const modelName = selectors.getModel();
  const apiKey = process.env["AGENT_JS_API_KEY"];

  if (provider === "anthropic") {
    return createAnthropic({ ...(apiKey && { apiKey }) })(modelName);
  }

  const baseURL = selectors.getBaseURL();
  assert(baseURL !== null);

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: baseURL,
    ...(apiKey && { apiKey }),
  })(modelName);
}

async function callApi(
  newMessages: ModelMessage[],
  abortSignal?: AbortSignal,
): Promise<CallApiResult> {
  const messageCount = selectors.getMessageParams().length + newMessages.length;
  debugLog(
    `callApi: model=${selectors.getModel()}, messageCount=${String(messageCount)}`,
  );

  const spinnerFrames = ["|", "/", "-", "\\"];
  let spinnerIdx = 0;
  const spinnerInterval = setInterval(() => {
    process.stdout.write(
      `\r${String(spinnerFrames[spinnerIdx++ % spinnerFrames.length])}`,
    );
  }, 80);
  let spinnerCleared = false;
  const clearSpinner = () => {
    if (spinnerCleared) return;
    clearInterval(spinnerInterval);
    process.stdout.write("\r \r");
    spinnerCleared = true;
  };

  const systemContent = [
    BASE_SYSTEM_PROMPT,
    await getRecursiveAgentsMdFilesStr(),
  ].join("\n");

  try {
    const { text, finishReason, toolCalls, usage, response } =
      await generateText({
        model: getLanguageModel(),
        system: systemContent,
        messages: [...selectors.getMessageParams(), ...newMessages],
        tools: TOOLS as unknown as ToolSet,
        maxOutputTokens: 8192,
        ...(abortSignal && { abortSignal }),
      });

    debugLog(`callApi: finishReason=${finishReason}`);

    clearSpinner();

    if (text) {
      await executeBat(text);
    }

    for (const message of newMessages) {
      dispatch(actions.appendToMessageParams(message));
    }
    dispatch(
      actions.appendToMessageUsages({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
      }),
    );
    for (const msg of response.messages) {
      dispatch(actions.appendToMessageParams(msg));
    }

    return {
      finishReason,
      toolCalls: toolCalls.map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
    };
  } finally {
    clearSpinner();
  }
}

export async function resolveUserInputApiCall(initialContent: string) {
  const inputMessageParam: ModelMessage = {
    role: "user",
    content: initialContent,
  };
  dispatch(actions.setApiStreamAbortController(new AbortController()));
  const apiStreamController = selectors.getApiStreamAbortController();
  const apiResult = await tryCatchAsync(
    callApi([inputMessageParam], apiStreamController!.signal),
  );
  dispatch(actions.setApiStreamAbortController(null));

  if (!apiResult.ok) {
    if (isAbortError(apiResult.error)) {
      colorLog("Aborted", "red");
      maybePrintUsageMessage();
      return null;
    }

    colorLog(getMessageFromError(apiResult.error), "red");
    return null;
  }

  return apiResult.value;
}

interface ToolMessage {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output:
    | { type: "text"; value: string }
    | { type: "error-text"; value: string };
}

export async function runToolLoop(
  initialResult: CallApiResult,
  messageCountBeforeTurn: number,
) {
  let currentResult = initialResult;
  while (currentResult.finishReason === "tool-calls") {
    const toolMessages: ToolMessage[] = [];

    for (const toolCall of currentResult.toolCalls) {
      const localToolCall: ToolCall = {
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        input: toolCall.input,
      };
      const toolResult = await getToolResultBlock(localToolCall);
      toolMessages.push({
        type: "tool-result",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: toolResult.is_error
          ? { type: "error-text", value: toolResult.content }
          : { type: "text", value: toolResult.content },
      });
    }

    const toolMessage: ModelMessage = {
      role: "tool",
      content: toolMessages,
    };

    dispatch(actions.setApiStreamAbortController(new AbortController()));
    const toolApiStreamController = selectors.getApiStreamAbortController();
    const toolApiCallResult = await tryCatchAsync(
      callApi([toolMessage], toolApiStreamController!.signal),
    );
    dispatch(actions.setApiStreamAbortController(null));

    if (toolApiCallResult.ok) {
      currentResult = toolApiCallResult.value;
    } else {
      if (isAbortError(toolApiCallResult.error)) {
        colorLog("Aborted", "red");
        dispatch(actions.truncateMessageParams(messageCountBeforeTurn));
        break;
      } else {
        colorLog(getMessageFromError(toolApiCallResult.error), "red");
        continue;
      }
    }
  }
}
