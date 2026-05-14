import { dirname, join } from "node:path";
import { fsDeps, processDeps } from "./deps.ts";
import { tryCatch } from "./utils.ts";
import { colorPrint } from "./print.ts";
import { debugLog } from "./log.ts";
import { selectors } from "./state.ts";
import {
  getGlobalContextDir,
  getGlobalSkillDir,
  getLocalSkillDir,
} from "./paths.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface ContextEntry {
  filePath: string;
  content: string;
}

export function getContextStr() {
  const contextFiles = getContext();
  if (contextFiles.length === 0) return "";

  const contextFilesList = contextFiles
    .map((entry) => `Path: ${entry.filePath}\nContent: ${entry.content}\n`)
    .join("\n");

  return `
AGENTS.md context files:
${contextFilesList}`;
}

export function getContext() {
  const agentFileDirs: string[] = [processDeps.cwd(), getGlobalContextDir()];

  const agentFilePaths: string[] = [];
  for (const agentFileDir of agentFileDirs) {
    const glob = join(agentFileDir, "**/AGENTS.md");
    const globResult = tryCatch(() => fsDeps.globSync(glob));
    if (!globResult.ok) continue;
    agentFilePaths.push(...globResult.value);
  }

  debugLog(`AGENTS.md found: ${agentFileDirs.join(",")}`);

  const entries: ContextEntry[] = [];

  for (const filePath of agentFilePaths) {
    const readResult = tryCatch(() => fsDeps.readFileSync(filePath).toString());
    if (readResult.ok) {
      entries.push({ filePath, content: readResult.value });
    }
  }

  return entries;
}

const skillMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
});
export type SkillMetadata = z.infer<typeof skillMetadataSchema>;
export interface Skill {
  name: string;
  description: string;
  dir: string;
  content: string;
}

export function getSkillsStr() {
  const skillsList = getSkills()
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

export function getSkills() {
  const seenSkills = new Set<string>();
  const skillGrandparentDirs = [
    ...selectors.getCustomSkillDirs(),
    getLocalSkillDir(),
    getGlobalSkillDir(),
  ];
  const skills: Skill[] = [];
  const skillPaths: string[] = [];

  for (const skillGrandparentDir of skillGrandparentDirs) {
    const glob = join(skillGrandparentDir, "**/SKILL.md");
    const globResult = tryCatch(() => fsDeps.globSync(glob));
    if (!globResult.ok) continue;
    skillPaths.push(...globResult.value);
  }

  for (const skillPath of skillPaths) {
    const skill = getSkillJSON(skillPath);
    if (skill === null) continue;

    if (seenSkills.has(skill.name)) continue;
    seenSkills.add(skill.name);
    skills.push(skill);
  }

  return skills;
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

export function getSkillJSON(skillMdPath: string) {
  const readResult = tryCatch(() =>
    fsDeps.readFileSync(skillMdPath).toString(),
  );
  if (!readResult.ok) return null;

  const parsed = parseFrontMatter(readResult.value);
  if (parsed === null) {
    colorPrint(
      `Malformed skill at ${skillMdPath}! A skill's front matter must contain valid YAML between \`---\` and \`---\`.`,
      "red",
    );
    return null;
  }
  const parseResult = skillMetadataSchema.safeParse(parsed.data);
  if (!parseResult.success) {
    colorPrint(
      `Malformed skill at ${skillMdPath}! A skill's front matter must contain a \`name\` and \`description\` field.`,
      "red",
    );
    return null;
  }

  const skill: Skill = {
    content: parsed.body,
    dir: dirname(skillMdPath),
    name: parseResult.data.name,
    description: parseResult.data.description,
  };
  return skill;
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

