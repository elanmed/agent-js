import type Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { colorLog, debugLog, tryCatch, tryCatchAsync } from "./utils.ts";

const execPromise = promisify(exec);

function getMessageFromError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return JSON.stringify(error);
}

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

export const CREATE_FILE_TOOL_SCHEMA: Anthropic.Messages.Tool = {
  name: "create_file",
  description:
    "Create a new file with the given content. Fails if the file already exists.",
  input_schema: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: {
        type: "string",
        description: "Path for the new file",
      },
      content: {
        type: "string",
        description: "Full content of the new file",
      },
    },
  },
};

const CreateFileToolSchema = z
  .object({ path: z.string(), content: z.string() })
  .strict();

export async function executeBashTool(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const { command: bashCommand } = BashToolInputSchema.parse(
    toolUseBlock.input,
  );
  colorLog(`Executing bash tool: ${bashCommand}`, "grey");
  debugLog(`executeBashTool: command=${bashCommand}`);

  const bashResult = await tryCatchAsync(execPromise(bashCommand));

  if (bashResult.ok) {
    debugLog(
      `executeBashTool: stdout=${bashResult.value.stdout}, stderr=${bashResult.value.stderr}`,
    );
    const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: JSON.stringify({
        stdout: bashResult.value.stdout,
        stderr: bashResult.value.stderr,
      }),
    };
    return toolResultBlock;
  }

  const error = getMessageFromError(bashResult.error);
  debugLog(`executeBashTool: error=${error}`);
  const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content: error,
    is_error: true,
  };
  return toolResultBlock;
}

export function executeCreateFileTool(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
): Anthropic.Messages.ToolResultBlockParam {
  const { content, path } = CreateFileToolSchema.parse(toolUseBlock.input);
  if (fs.existsSync(path)) {
    debugLog(`executeCreatefileTool: ${path} already exists`);
    const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: `${path} already exists`,
      is_error: true,
    };
    return toolResultBlock;
  }

  const createFileResult = tryCatch(() => {
    fs.writeFileSync(path, content);
  });

  if (!createFileResult.ok) {
    const error = getMessageFromError(createFileResult.error);
    debugLog(`executeCreateFileTool: error=${error}`);
    const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: error,
      is_error: true,
    };
    return toolResultBlock;
  }

  debugLog(`executeCreateFileTool: ${path} created successfully `);
  const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content: `${path} created successfully`,
  };
  return toolResultBlock;
}

export async function getToolResultBlock(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
) {
  let toolResultBlock: Anthropic.Messages.ToolResultBlockParam | null = null;

  switch (toolUseBlock.name) {
    case "bash": {
      toolResultBlock = await executeBashTool(toolUseBlock);
      break;
    }
    case "create_file": {
      toolResultBlock = executeCreateFileTool(toolUseBlock);
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
