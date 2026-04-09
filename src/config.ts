import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { colorLog, debugLog } from "./utils.ts";
import { actions, dispatch } from "./state.ts";

export type DiffStyle = "unified" | "lines";

const ModelPricingSchema = z
  .object({
    inputPerToken: z.number(),
    outputPerToken: z.number(),
  })
  .strict();

const ConfigSchema = z.object({
  model: z.string().optional(),
  baseURL: z.string().optional(),
  disableUsageMessage: z.boolean().optional(),
  diffStyle: z.enum(["unified", "lines"]).optional(),
  pricingPerModel: z.record(z.string(), ModelPricingSchema).optional(),
});

type Config = z.infer<typeof ConfigSchema>;

interface DefaultConfig {
  model: string;
  disableUsageMessage: boolean;
  diffStyle: "unified" | "lines";
  pricingPerModel: Record<
    string,
    { inputPerToken: number; outputPerToken: number }
  >;
}

export const DEFAULT_CONFIG: DefaultConfig = {
  model: "claude-opus-4-6",
  disableUsageMessage: false,
  diffStyle: "unified",
  pricingPerModel: {
    "claude-opus-4-6": { inputPerToken: 5, outputPerToken: 25 },
    "claude-sonnet-4-6": { inputPerToken: 3, outputPerToken: 15 },
    "claude-haiku-4-5": { inputPerToken: 1, outputPerToken: 5 },
  },
};

export const GLOBAL_CONFIG_PATH = join(
  homedir(),
  ".config",
  ".agent-js",
  "settings.json",
);
export const LOCAL_CONFIG_PATH = join(
  process.cwd(),
  ".agent-js",
  "settings.json",
);

export function initStateFromConfig() {
  const globalConfig: Config = (() => {
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
      debugLog(`${GLOBAL_CONFIG_PATH} exists, returning`);
      return parseConfigStr(fs.readFileSync(GLOBAL_CONFIG_PATH).toString());
    }

    fs.mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(
      GLOBAL_CONFIG_PATH,
      JSON.stringify(DEFAULT_CONFIG, null, 2),
    );
    colorLog(
      `${GLOBAL_CONFIG_PATH} does not exist, writing default config`,
      "grey",
    );

    return DEFAULT_CONFIG;
  })();

  const localConfig: Config = (() => {
    if (fs.existsSync(LOCAL_CONFIG_PATH)) {
      debugLog(`${LOCAL_CONFIG_PATH} exists, reading`);
      return parseConfigStr(fs.readFileSync(LOCAL_CONFIG_PATH).toString());
    }

    debugLog(`${LOCAL_CONFIG_PATH} does not exist`);
    return {};
  })();

  dispatch(
    actions.setModel(
      localConfig.model ?? globalConfig.model ?? DEFAULT_CONFIG.model,
    ),
  );
  dispatch(
    actions.setBaseURL(localConfig.baseURL ?? globalConfig.baseURL ?? null),
  );
  dispatch(
    actions.setDisableUsageMessage(
      localConfig.disableUsageMessage ??
        globalConfig.disableUsageMessage ??
        DEFAULT_CONFIG.disableUsageMessage,
    ),
  );
  dispatch(
    actions.setDiffStyle(
      (localConfig.diffStyle ??
        globalConfig.diffStyle ??
        DEFAULT_CONFIG.diffStyle) as DiffStyle,
    ),
  );
  dispatch(
    actions.setPricingPerModel(
      localConfig.pricingPerModel ??
        globalConfig.pricingPerModel ??
        DEFAULT_CONFIG.pricingPerModel,
    ),
  );
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
