import type Anthropic from "@anthropic-ai/sdk";
import { exec } from "node:child_process";
import { z } from "zod";
import { colorLog, tryCatch } from "./utils.ts";

export const BASH_TOOL_SCHEMA: Anthropic.Messages.Tool = {
  name: "bash",
  description: "Execute a bash command and return its output.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute.",
      },
    },
    required: ["command"],
  },
};

const BashToolInputSchema = z.object({ command: z.string() }).strict();

export async function executeBashTool(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
) {
  const { command: bashCommand } = BashToolInputSchema.parse(
    toolUseBlock.input,
  );
  colorLog(`Executing bash tool: ${bashCommand}`, "grey");

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    exec(bashCommand, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function getBashToolResultBlockParam(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
) {
  const bashResult = await tryCatch(executeBashTool(toolUseBlock));
  if (bashResult.ok) {
    const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: JSON.stringify(bashResult.value),
    };
    return toolResultBlock;
  }

  const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content:
      bashResult.error instanceof Error
        ? bashResult.error.message
        : JSON.stringify(bashResult.error),
    is_error: true,
  };
  return toolResultBlock;
}

export async function getToolResultBlock(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
) {
  let toolResultBlock: Anthropic.Messages.ToolResultBlockParam | null = null;

  switch (toolUseBlock.name) {
    case "bash": {
      toolResultBlock = await getBashToolResultBlockParam(toolUseBlock);
      break;
    }
  }

  if (!toolResultBlock) {
    throw new Error(
      "Failed to create a tool result when processing the tool call",
    );
  }

  return toolResultBlock;
}
