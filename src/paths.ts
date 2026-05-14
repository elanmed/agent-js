import os from "node:os";
import { join } from "node:path";
import { processDeps } from "./deps.ts";

export function getGlobalConfigDir() {
  return join(os.homedir(), ".config", ".agent-js");
}

export function getLocalConfigDir() {
  return join(processDeps.cwd(), ".agent-js");
}

export function getGlobalConfigPath() {
  return join(getGlobalConfigDir(), "settings.json");
}

export function getLocalConfigPath() {
  return join(getLocalConfigDir(), "settings.json");
}

export function getGlobalContextDir() {
  return join(getGlobalConfigDir(), "context");
}

export function getGlobalSkillDir() {
  return join(getGlobalConfigDir(), "skills");
}

export function getLocalSkillDir() {
  return join(getLocalConfigDir(), "skills");
}

export function getLocalSlashCommandDir() {
  return join(getLocalConfigDir(), "commands");
}

export function getGlobalSlashCommandDir() {
  return join(getGlobalConfigDir(), "commands");
}
