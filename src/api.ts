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
import {
  print,
  startLoadingState,
  flushAndStopLoadingState,
  appendIncrementalUsage,
} from "./print.ts";
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

function getLanguageModel() {
  const apiKey = processDeps.env.get("AGENT_JS_API_KEY");

  if (getState().config.provider === "anthropic") {
    return createAnthropic({ ...(apiKey && { apiKey }) })(
      getState().config.model,
    );
  }

  const baseURL = getState().config.baseURL;
  assert(baseURL !== null);

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: baseURL,
    ...(apiKey && { apiKey }),
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
      messages: [...getState().app.messageParams, inputMessageParam],
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
    if (isAbortError(generateTextResult.error)) {
      await print.error("Interrupted");
      return null;
    }

    await print.error(getMessageFromError(generateTextResult.error));
    return null;
  }

  const { totalUsage, text, response } = generateTextResult.value;

  appendIncrementalUsage(totalUsage);

  actions.appendToMessageParams(inputMessageParam);
  for (const msg of response.messages) {
    actions.appendToMessageParams(msg);
  }
  appendToChatHistory(text, "assistant");

  return text;
}
