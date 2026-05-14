import { join } from "node:path";
import { fsDeps, processDeps } from "./deps.ts";
import { tryCatch } from "./utils.ts";
import { colorPrint } from "./print.ts";
import { debugLog } from "./log.ts";
import { dispatch, actions } from "./state.ts";
import {
  getGlobalContextDirPath,
  getGlobalSkillsDirPath,
  getLocalSkillsDirPath,
} from "./paths.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export function getAgentsContext() {
  const agentFileDirs: string[] = [processDeps.cwd()];

  if (fsDeps.existsSync(getGlobalContextDirPath())) {
    agentFileDirs.push(getGlobalContextDirPath());
  }

  const agentFilePaths: string[] = [];
  for (const agentFileDir of agentFileDirs) {
    const glob = join(agentFileDir, "**/AGENTS.md");
    const globResult = tryCatch(() => fsDeps.globSync(glob));
    if (!globResult.ok) continue;
    agentFilePaths.push(...globResult.value);
  }

  debugLog(`AGENTS.md found: ${agentFileDirs.join(",")}`);

  const entries: { filePath: string; content: string }[] = [];

  for (const filePath of agentFilePaths) {
    const readResult = tryCatch(() => fsDeps.readFileSync(filePath).toString());
    if (readResult.ok) {
      entries.push({ filePath, content: readResult.value });
    }
  }

  if (entries.length === 0) return "";

  const agentFilesList = entries
    .map((entry) => `Path: ${entry.filePath}\nContent: ${entry.content}\n`)
    .join("\n");
  return `
AGENTS.md context files:
${agentFilesList}`;
}

const skillMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
});
export type SkillMetadata = z.infer<typeof skillMetadataSchema>;
export interface Skill {
  name: string;
  dir: string;
  content: string;
}

export function getSkillsContext(skillsDirPaths?: string[]) {
  const seenSkills = new Set();
  const paths = skillsDirPaths ?? [
    getLocalSkillsDirPath(),
    getGlobalSkillsDirPath(),
  ];
  const skills: SkillMetadata[] = [];

  paths.forEach((dirPath) => {
    if (!fsDeps.existsSync(dirPath)) return;

    for (const dirName of fsDeps.readdirSync(dirPath)) {
      const fullDirPath = join(dirPath, dirName);
      const statResult = tryCatch(() => fsDeps.statSync(fullDirPath));
      if (!statResult.ok) continue;
      if (statResult.value.isFile()) continue;

      const skill = getSkillJSON(fullDirPath);
      if (skill === null) continue;
      if (seenSkills.has(skill.name)) continue;
      seenSkills.add(skill.name);
      skills.push(skill);
    }
  });

  const skillsList = skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");

  return `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
${skillsList}
`;
}

export function parseFrontMatter(content: string) {
  if (!content.startsWith("---\n")) return null;

  // start search on the char after the ---\n
  const closeIndex = content.indexOf("\n---\n", 4);
  if (closeIndex === -1) return null;

  // start slice on the char after the --- \n
  const yamlStr = content.slice(4, closeIndex);
  if (yamlStr === "") return null;
  const parseResult = tryCatch(() => parseYaml(yamlStr) as unknown);
  if (!parseResult.ok) return null;

  // start slice on the char after the \n---\n
  const body = content.slice(closeIndex + 5);
  return { data: parseResult.value, body };
}

export function getSkillJSON(dirPath: string) {
  for (const name of fsDeps.readdirSync(dirPath)) {
    const fullPath = join(dirPath, name);
    const statResult = tryCatch(() => fsDeps.statSync(fullPath));
    if (!statResult.ok) continue;
    if (!statResult.value.isFile()) continue;
    if (name !== "SKILL.md") continue;

    const readResult = tryCatch(() => fsDeps.readFileSync(fullPath).toString());
    if (!readResult.ok) continue;

    const parsed = parseFrontMatter(readResult.value);
    if (parsed === null) {
      colorPrint(
        `Malformed skill at ${fullPath}! A skill's front matter must contain valid YAML between \`---\` and \`---\`.`,
        "red",
      );
      continue;
    }
    const parseResult = skillMetadataSchema.safeParse(parsed.data);
    if (!parseResult.success) {
      colorPrint(
        `Malformed skill at ${fullPath}! A skill's front matter must contain a \`name\` and \`description\` field.`,
        "red",
      );
      continue;
    }
    dispatch(
      actions.appendToSkills({
        name: parseResult.data.name,
        content: parsed.body,
        dir: dirPath,
      }),
    );

    return parseResult.data;
  }

  return null;
}

export const BASE_SYSTEM_PROMPT = `
You are an AI agent being called from a minimal terminal cli. 

- Keep responses under 25 words unless the task requires detail.
- No filler: omit "I'll help", "Sure", "Here is", etc.
- Answer in 1 sentence when possible
- For code edits: show only the change, no description
- Questions get answers only, no padding
- When giving commands for debugging, give one command at a time - not multiple.
- The CLI will automatically output a diff for every file-modifying tool. DO NOT include code snippets in markdown responses if the code snippet was already applied in a file-modifying tool.
- DO display code snippets in markdown responses when the snippet has not been applied with a file-modifying tool

CRITICAL: All responses will be parsed by bat as markdown, you MUST format as valid markdown.
`;

