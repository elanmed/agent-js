import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { colorLog, debugLog, getAvailableSlashCommands } from "./utils.ts";
import { actions, dispatch, MISSING } from "./state.ts";

export type DiffStyle = "unified" | "lines";
export type Provider = "anthropic" | "openai-compatible";

const ModelPricingSchema = z
  .object({
    inputPerToken: z.number(),
    outputPerToken: z.number(),
    cacheReadPerToken: z.number(),
    cacheWritePerToken: z.number(),
  })
  .strict();

const ConfigSchema = z.object({
  model: z.string().optional(),
  baseURL: z.string().optional(),
  provider: z.enum(["anthropic", "openai-compatible"]).optional(),
  disableUsageMessage: z.boolean().optional(),
  diffStyle: z.enum(["unified", "lines"]).optional(),
  pricingPerModel: z.record(z.string(), ModelPricingSchema).optional(),
});

type Config = z.infer<typeof ConfigSchema>;

interface DefaultConfig {
  model: string;
  baseURL: string;
  provider: Provider;
  disableUsageMessage: boolean;
  diffStyle: "unified" | "lines";
  pricingPerModel: Record<
    string,
    {
      inputPerToken: number;
      outputPerToken: number;
      cacheReadPerToken: number;
      cacheWritePerToken: number;
    }
  >;
}

export const DEFAULT_CONFIG: DefaultConfig = {
  model: "MISSING",
  baseURL: "MISSING",
  provider: "openai-compatible",
  disableUsageMessage: false,
  diffStyle: "lines",
  pricingPerModel: {
    MISSING: {
      inputPerToken: 0,
      outputPerToken: 0,
      cacheReadPerToken: 0,
      cacheWritePerToken: 0,
    },
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

export function initState() {
  const globalConfig: Config = (() => {
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
      debugLog(`${GLOBAL_CONFIG_PATH} exists, returning`);
      return parseConfigStr(fs.readFileSync(GLOBAL_CONFIG_PATH).toString());
    }

    debugLog(`${GLOBAL_CONFIG_PATH} does not exist`);
    return DEFAULT_CONFIG;
  })();

  const localConfig: Config = (() => {
    if (fs.existsSync(LOCAL_CONFIG_PATH)) {
      debugLog(`${LOCAL_CONFIG_PATH} exists, reading`);
      return parseConfigStr(fs.readFileSync(LOCAL_CONFIG_PATH).toString());
    }

    fs.mkdirSync(dirname(LOCAL_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(
      LOCAL_CONFIG_PATH,
      JSON.stringify(DEFAULT_CONFIG, null, 2),
    );
    colorLog(
      `${LOCAL_CONFIG_PATH} does not exist, writing default config`,
      "grey",
    );

    return {};
  })();

  const defaultedModel =
    localConfig.model ?? globalConfig.model ?? DEFAULT_CONFIG.model;
  if (defaultedModel === MISSING) {
    throw new Error(
      `A \`model\` is required in either ${LOCAL_CONFIG_PATH} or ${GLOBAL_CONFIG_PATH}`,
    );
  }

  const defaultedProvider =
    localConfig.provider ?? globalConfig.provider ?? DEFAULT_CONFIG.provider;
  const defaultedBaseURL =
    localConfig.baseURL ?? globalConfig.baseURL ?? DEFAULT_CONFIG.baseURL;
  if (
    defaultedBaseURL === MISSING &&
    defaultedProvider === "openai-compatible"
  ) {
    throw new Error(
      `A \`baseURL\` is required when \`provider=openai-compatible\` in either ${LOCAL_CONFIG_PATH} or ${GLOBAL_CONFIG_PATH}`,
    );
  }

  dispatch(actions.setModel(defaultedModel));
  dispatch(actions.setBaseURL(defaultedBaseURL));
  dispatch(actions.setProvider(defaultedProvider));
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

  dispatch(actions.setSlashCommands(getAvailableSlashCommands()));
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
