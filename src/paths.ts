import { homedir } from "node:os";
import { join } from "node:path";
import { processDeps } from "./deps.ts";

export function getGlobalConfigDirPath() {
  return join(homedir(), ".config", ".agent-js");
}

export function getLocalConfigDirPath() {
  return join(processDeps.cwd(), ".agent-js");
}

export function getGlobalConfigPath() {
  return join(getGlobalConfigDirPath(), "settings.json");
}

export function getLocalConfigPath() {
  return join(getLocalConfigDirPath(), "settings.json");
}

export function getGlobalContextDirPath() {
  return join(getGlobalConfigDirPath(), "context");
}

export function getGlobalSkillsDirPath() {
  return join(getGlobalConfigDirPath(), "skills");
}

export function getLocalSkillsDirPath() {
  return join(processDeps.cwd(), ".agent-js", "skills");
}
