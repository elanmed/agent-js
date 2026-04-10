import { generateText } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { actions, dispatch, selectors } from "./state.ts";
import {
  debugLog,
  executeBat,
  BASE_SYSTEM_PROMPT,
  getRecursiveAgentsMdFilesStr,
} from "./utils.ts";
import { TOOLS } from "./tools.ts";

function getLanguageModel() {
  const provider = selectors.getProvider();
  const modelName = selectors.getModel();
  const apiKey = process.env["AGENT_JS_API_KEY"];

  if (provider === "anthropic") {
    return createAnthropic({ ...(apiKey && { apiKey }) })(modelName);
  }

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: selectors.getBaseURL(),
    ...(apiKey && { apiKey }),
  })(modelName);
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface CallApiResult {
  finishReason: string;
  toolCalls: ToolCallInfo[];
}

export async function callApi(
  newMessages: ModelMessage[],
  { prependNewline }: { prependNewline: boolean } = { prependNewline: false },
  abortSignal?: AbortSignal,
): Promise<CallApiResult> {
  const messageCount =
    selectors.getMessageParams().length + newMessages.length;
  debugLog(
    `callApi: model=${selectors.getModel()}, messages=${String(messageCount)}`,
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

    debugLog(
      `callApi: finish_reason=${finishReason}, prompt_tokens=${String(usage.inputTokens)}, completion_tokens=${String(usage.outputTokens)}`,
    );

    clearSpinner();

    if (text) {
      if (prependNewline) process.stdout.write("\n");
      await executeBat(text);
    }

    for (const message of newMessages) {
      dispatch(actions.appendToMessageParams(message));
    }
    dispatch(
      actions.appendToMessageUsages({
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
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
