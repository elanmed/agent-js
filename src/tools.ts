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

export const VIEW_FILE_TOOL_SCHEMA: Anthropic.Messages.Tool = {
  name: "view_file",
  description:
    "View the contents of a file or list a directory. File contents are returned with line numbers.",
  input_schema: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Path to the file or directory to view",
      },
      start_line: {
        type: "integer",
        description: "Starting line number (1-indexed). Only applies to files.",
      },
      end_line: {
        type: "integer",
        description:
          "Ending line number (inclusive). Use -1 for end of file. Only applies to files.",
      },
    },
  },
};

const ViewFileToolInputSchema = z
  .object({
    path: z.string(),
    start_line: z.number().int().optional(),
    end_line: z.number().int().optional(),
  })
  .strict();

export function executeViewFileTool(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
): Anthropic.Messages.ToolResultBlockParam {
  const { path, start_line, end_line } = ViewFileToolInputSchema.parse(
    toolUseBlock.input,
  );
  colorLog(`Executing view_file tool: ${path}`, "grey");
  debugLog(`executeViewFileTool: path=${path}`);

  const statResult = tryCatch(() => fs.statSync(path));
  if (!statResult.ok) {
    const error = getMessageFromError(statResult.error);
    debugLog(`executeViewFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: error,
      is_error: true,
    };
  }

  if (statResult.value.isDirectory()) {
    const readdirResult = tryCatch(() => fs.readdirSync(path));
    if (!readdirResult.ok) {
      const error = getMessageFromError(readdirResult.error);
      debugLog(`executeViewFileTool: error=${error}`);
      return {
        type: "tool_result",
        tool_use_id: toolUseBlock.id,
        content: error,
        is_error: true,
      };
    }
    const listing = readdirResult.value.join("\n");
    debugLog(`executeViewFileTool: directory listing for ${path}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: listing,
    };
  }

  const readResult = tryCatch(() => fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    debugLog(`executeViewFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: error,
      is_error: true,
    };
  }

  const lines = readResult.value.toString().split("\n");
  const start = (start_line ?? 1) - 1;
  const end =
    end_line === undefined || end_line === -1 ? lines.length : end_line;
  const slice = lines.slice(start, end);
  const numbered = slice
    .map((line, i) => `${String(start + i + 1)}\t${line}`)
    .join("\n");

  debugLog(
    `executeViewFileTool: ${path} lines ${String(start + 1)}-${String(end)}`,
  );
  return {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content: numbered,
  };
}

export const STR_REPLACE_TOOL_SCHEMA: Anthropic.Messages.Tool = {
  name: "str_replace",
  description:
    "Replace an exact string in a file. The old_str must match exactly once. Include enough surrounding lines to make the match unique.",
  input_schema: {
    type: "object",
    required: ["path", "old_str", "new_str"],
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_str: {
        type: "string",
        description:
          "The exact text to find (must match exactly once in the file)",
      },
      new_str: {
        type: "string",
        description: "The replacement text",
      },
    },
  },
};

const StrReplaceToolInputSchema = z
  .object({ path: z.string(), old_str: z.string(), new_str: z.string() })
  .strict();

export function executeStrReplaceTool(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
): Anthropic.Messages.ToolResultBlockParam {
  const { path, old_str, new_str } = StrReplaceToolInputSchema.parse(
    toolUseBlock.input,
  );
  colorLog(`Executing str_replace tool: ${path}`, "grey");
  debugLog(`executeStrReplaceTool: path=${path}`);

  const readResult = tryCatch(() => fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    debugLog(`executeStrReplaceTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: error,
      is_error: true,
    };
  }

  const content = readResult.value.toString();
  const occurrences = content.split(old_str).length - 1;

  if (occurrences === 0) {
    debugLog(`executeStrReplaceTool: old_str not found in ${path}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: "old_str not found in file",
      is_error: true,
    };
  }

  if (occurrences > 1) {
    debugLog(
      `executeStrReplaceTool: old_str matched ${String(occurrences)} times in ${path}`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: `old_str matched ${String(occurrences)} times — must match exactly once`,
      is_error: true,
    };
  }

  const writeResult = tryCatch(() => {
    fs.writeFileSync(path, content.replace(old_str, new_str));
  });
  if (!writeResult.ok) {
    const error = getMessageFromError(writeResult.error);
    debugLog(`executeStrReplaceTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: error,
      is_error: true,
    };
  }

  debugLog(`executeStrReplaceTool: ${path} updated successfully`);
  return {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content: `${path} updated successfully`,
  };
}

export const INSERT_LINES_TOOL_SCHEMA: Anthropic.Messages.Tool = {
  name: "insert_lines",
  description:
    "Insert text after a specific line number in a file. Use line 0 to insert at the beginning of the file.",
  input_schema: {
    type: "object",
    required: ["path", "after_line", "content"],
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit",
      },
      after_line: {
        type: "integer",
        description: "Line number to insert after (0 for beginning of file)",
      },
      content: {
        type: "string",
        description: "Text to insert",
      },
    },
  },
};

const InsertLinesToolInputSchema = z
  .object({
    path: z.string(),
    after_line: z.number().int(),
    content: z.string(),
  })
  .strict();

export function executeInsertLinesTool(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
): Anthropic.Messages.ToolResultBlockParam {
  const { path, after_line, content } = InsertLinesToolInputSchema.parse(
    toolUseBlock.input,
  );
  colorLog(`Executing insert_lines tool: ${path}`, "grey");
  debugLog(
    `executeInsertLinesTool: path=${path}, after_line=${String(after_line)}`,
  );

  const readResult = tryCatch(() => fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    debugLog(`executeInsertLinesTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: error,
      is_error: true,
    };
  }

  const lines = readResult.value.toString().split("\n");

  if (after_line < 0 || after_line > lines.length) {
    debugLog(
      `executeInsertLinesTool: after_line ${String(after_line)} out of range`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: `after_line ${String(after_line)} is out of range (file has ${String(lines.length)} lines)`,
      is_error: true,
    };
  }

  lines.splice(after_line, 0, content);

  const writeResult = tryCatch(() => {
    fs.writeFileSync(path, lines.join("\n"));
  });
  if (!writeResult.ok) {
    const error = getMessageFromError(writeResult.error);
    debugLog(`executeInsertLinesTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: error,
      is_error: true,
    };
  }

  debugLog(`executeInsertLinesTool: ${path} updated successfully`);
  return {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content: `${path} updated successfully`,
  };
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
    case "view_file": {
      toolResultBlock = executeViewFileTool(toolUseBlock);
      break;
    }
    case "str_replace": {
      toolResultBlock = executeStrReplaceTool(toolUseBlock);
      break;
    }
    case "insert_lines": {
      toolResultBlock = executeInsertLinesTool(toolUseBlock);
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
