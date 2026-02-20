import fs from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { debugLog } from "./utils.ts";

const ModelPricingSchema = z
  .object({
    inputPerToken: z.number(),
    outputPerToken: z.number(),
    cacheWrite5mPerToken: z.number(),
    cacheWrite1hPerToken: z.number(),
    cacheReadPerToken: z.number(),
  })
  .strict();

const ConfigSchema = z
  .object({
    model: z.enum(["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]),
    disableCostMessage: z.boolean(),
    pricingPerModel: z
      .object({
        "claude-opus-4-6": ModelPricingSchema,
        "claude-sonnet-4-6": ModelPricingSchema,
        "claude-haiku-4-5": ModelPricingSchema,
      })
      .strict(),
  })
  .strict();

type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  model: "claude-opus-4-6",
  disableCostMessage: false,
  pricingPerModel: {
    "claude-opus-4-6": {
      inputPerToken: 5,
      cacheWrite5mPerToken: 6.25,
      cacheWrite1hPerToken: 10,
      cacheReadPerToken: 0.5,
      outputPerToken: 25,
    },
    "claude-sonnet-4-6": {
      inputPerToken: 3,
      cacheWrite5mPerToken: 3.75,
      cacheWrite1hPerToken: 6,
      cacheReadPerToken: 0.3,
      outputPerToken: 15,
    },
    "claude-haiku-4-5": {
      inputPerToken: 1,
      cacheWrite5mPerToken: 1.25,
      cacheWrite1hPerToken: 2,
      cacheReadPerToken: 0.1,
      outputPerToken: 5,
    },
  },
};

const GLOBAL_CONFIG_PATH = join(
  homedir(),
  ".config",
  "agent-js",
  "agent-js.settings.json",
);
const LOCAL_CONFIG_PATH = resolve("agent-js.settings.json");

export function writeGlobalConfig() {
  if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
    debugLog(`${GLOBAL_CONFIG_PATH} exists, returning`);
    return;
  }

  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  debugLog(`${GLOBAL_CONFIG_PATH} does not exist, writing default config`);
}

export function initStateFromConfig() {
  const globalConfigStr = fs.readFileSync(GLOBAL_CONFIG_PATH).toString();
  const localConfigStr = (() => {
    if (!fs.existsSync(LOCAL_CONFIG_PATH)) {
      debugLog(`${LOCAL_CONFIG_PATH} does not exist, returning`);
      return {};
    }

    return fs.readFileSync(LOCAL_CONFIG_PATH).toString();
  })();

  const globalConfig = parseConfigStr(globalConfigStr);
  const localConfig = parseConfigStr(localConfigStr);
}

function parseConfigStr(configStr: string): Config {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configStr);
  } catch {
    throw new Error("Failed to parse config as JSON");
  }
  return ConfigSchema.parse(parsed);
}

