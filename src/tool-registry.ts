import { tool } from "ai";
import {
  BashToolInputSchema,
  CreateFileToolSchema,
  ViewFileToolInputSchema,
  StrReplaceToolInputSchema,
  InsertLinesToolInputSchema,
  WebFetchToolSchema,
} from "./tools.ts";

export const TOOLS = {
  bash: tool({
    description: "Execute a bash command and return its output.",
    inputSchema: BashToolInputSchema,
  }),
  create_file: tool({
    description:
      "Create a new file with the given content. Fails if the file already exists.",
    inputSchema: CreateFileToolSchema,
  }),
  view_file: tool({
    description:
      "View the contents of a file or list a directory. File contents are returned with line numbers.",
    inputSchema: ViewFileToolInputSchema,
  }),
  str_replace: tool({
    description:
      "Replace an exact string in a file. The old_str must match exactly once. Include enough surrounding lines to make the match unique.",
    inputSchema: StrReplaceToolInputSchema,
  }),
  insert_lines: tool({
    description:
      "Insert text after a specific line number in a file. Use line 0 to insert at the beginning of the file.",
    inputSchema: InsertLinesToolInputSchema,
  }),
  web_fetch_html: tool({
    description:
      "Fetch a web page by URL and return its readable content, parsed to extract the main article.",
    inputSchema: WebFetchToolSchema,
  }),
  web_fetch_json: tool({
    description:
      "Fetch a JSON API endpoint by URL and return the parsed JSON response.",
    inputSchema: WebFetchToolSchema,
  }),
};
