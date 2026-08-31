import type { ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { actions, getState } from "./state.ts";
import {
  isAbortError,
  tryCatchAsync,
  getMessageFromError,
  getTempFileName,
} from "./utils.ts";
import { print, startLoadingState, flushAndStopLoadingState } from "./print.ts";
import { appendModelUsage } from "./usage.ts";
import { BASE_SYSTEM_PROMPT } from "./context.ts";
import {
  objectWithPathSchema,
  printGitDiff,
  TOOLS,
  type ToolName,
} from "./tools.ts";
import assert from "node:assert";
import { aiDeps, fsDeps, processDeps } from "./deps.ts";
import { appendToChatHistory } from "./log.ts";

export function getLanguageModel() {
  const apiKey = processDeps.env.get("AGENT_JS_API_KEY");
  const apiOptions = (() => {
    if (apiKey === undefined) return {};
    return { apiKey };
  })();

  if (getState().config.provider === "anthropic") {
    return createAnthropic({
      ...apiOptions,
    })(getState().config.model);
  }

  const baseURL = getState().config.baseURL;
  assert(baseURL !== undefined);

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: baseURL,
    ...apiOptions,
  })(getState().config.model);
}

export async function resolveApiCall(userInput: string) {
  const toolCallIdToTempFile = new Map<string, string>();

  const inputMessageParam: ModelMessage = {
    role: "user",
    content: userInput,
  };

  const systemContent = [
    BASE_SYSTEM_PROMPT,
    getState().app.contextStr,
    getState().app.skillsStr,
  ].join("\n");

  actions.setApiStartTime();
  actions.setApiStreamAbortController(new AbortController());
  startLoadingState();
  const generateTextResult = await tryCatchAsync(
    aiDeps.generateText({
      model: getLanguageModel(),
      system: systemContent,
      messages: [...getState().app.messageParams.messages, inputMessageParam],
      tools: TOOLS,
      stopWhen: aiDeps.isLoopFinished(),
      abortSignal: getState().abortControllers.apiStream!.signal,
      experimental_onToolCallStart: ({ toolCall }) => {
        switch (toolCall.toolName as ToolName) {
          case "create_file": {
            const tempFileBefore = getTempFileName();
            fsDeps.writeFileSync(tempFileBefore, "");
            toolCallIdToTempFile.set(toolCall.toolCallId, tempFileBefore);
            break;
          }
          case "insert_lines":
          case "str_replace": {
            const { path } = objectWithPathSchema.parse(toolCall.input);
            const tempFileBefore = getTempFileName({
              initialContentPath: path,
            });
            toolCallIdToTempFile.set(toolCall.toolCallId, tempFileBefore);
            break;
          }
        }
      },
      experimental_onToolCallFinish: async ({ toolCall, success }) => {
        switch (toolCall.toolName as ToolName) {
          case "create_file":
          case "insert_lines":
          case "str_replace": {
            const tempFileBefore = toolCallIdToTempFile.get(
              toolCall.toolCallId,
            );
            assert(tempFileBefore !== undefined);

            if (!success) {
              fsDeps.unlinkSync(tempFileBefore);
              toolCallIdToTempFile.delete(toolCall.toolCallId);
              return;
            }

            const { path } = objectWithPathSchema.parse(toolCall.input);
            const tempFileAfter = getTempFileName({
              initialContentPath: path,
            });
            await printGitDiff({
              tempFileBeforePath: tempFileBefore,
              tempFileAfterPath: tempFileAfter,
              path,
            });
            fsDeps.unlinkSync(tempFileBefore);
            fsDeps.unlinkSync(tempFileAfter);
            toolCallIdToTempFile.delete(toolCall.toolCallId);
            break;
          }
        }
      },
    }),
  );
  await flushAndStopLoadingState();
  actions.setApiStreamAbortController(null);
  actions.setApiEndTime();

  if (!generateTextResult.ok) {
    for (const tempFile of toolCallIdToTempFile.values()) {
      fsDeps.unlinkSync(tempFile);
    }

    if (isAbortError(generateTextResult.error)) {
      await print.error("Interrupted");
      return null;
    }

    await print.error(getMessageFromError(generateTextResult.error));
    return null;
  }

  const { totalUsage, text, response } = generateTextResult.value;

  await appendModelUsage(totalUsage);

  const inputTokens = totalUsage.inputTokens ?? 0;
  const outputTokens = totalUsage.outputTokens ?? 0;

  actions.setMessageParamTokens(inputTokens + outputTokens);
  actions.setMessageParamTokensStale(false);

  actions.appendToMessageParams(inputMessageParam);
  for (const message of response.messages) {
    actions.appendToMessageParams(message);
  }
  appendToChatHistory(text, "assistant");

  return text;
}

export async function maybeCompactMessageParams(userInput: string) {
  const { model } = getState().config;
  const contextWindow = getState().config.contextWindowPerModel[model];
  if (contextWindow === undefined) return;

  if (getState().app.messageParams.tokensStale) return;

  const userInputTokensApprox = Math.floor(userInput.length / 3);
  const nextApiTokens =
    getState().app.messageParams.tokens + userInputTokensApprox;

  const currRatio = nextApiTokens / contextWindow;
  if (currRatio <= getState().config.compactTriggerRatio) return;
  await print.doing("Compacting…");

  const targetTokens = getState().config.compactTargetRatio * contextWindow;

  const compactMessageParam = `Compact the following conversation. Your summary must be less than ${String(targetTokens)} tokens:
${JSON.stringify(getState().app.messageParams.messages)}
`;

  actions.setApiStreamAbortController(new AbortController());
  startLoadingState();
  const generateTextResult = await tryCatchAsync(
    aiDeps.generateText({
      model: getLanguageModel(),
      messages: [{ content: compactMessageParam, role: "user" }],
      stopWhen: aiDeps.isLoopFinished(),
      abortSignal: getState().abortControllers.apiStream!.signal,
    }),
  );
  await flushAndStopLoadingState();
  actions.setApiStreamAbortController(null);

  if (!generateTextResult.ok) {
    if (isAbortError(generateTextResult.error)) {
      await print.error("Interrupted compaction");
      return;
    }

    await print.error(getMessageFromError(generateTextResult.error));
    return;
  }

  const { totalUsage, text } = generateTextResult.value;
  await appendModelUsage(totalUsage);
  const afterCompactionTokens = totalUsage.outputTokens ?? 0;

  actions.resetMessageParams();
  actions.appendToMessageParams({ content: text, role: "assistant" });
  actions.setMessageParamTokens(afterCompactionTokens);
  if (afterCompactionTokens >= targetTokens) {
    await print.warning(
      `Compacted to ${afterCompactionTokens.toLocaleString()}, ${(afterCompactionTokens - targetTokens).toLocaleString()} over the target.`,
    );
  }
}
