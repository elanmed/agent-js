import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { colorLog, debugLog, getAvailableSlashCommands } from "./utils.ts";
import { actions, dispatch } from "./state.ts";

export const MISSING = "MISSING";

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
  provider: "openai-compatible",
  disableUsageMessage: false,
  diffStyle: "lines",
  pricingPerModel: {},
  model: MISSING,
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

const initStateDeps = {
  existsSync: (path: string): boolean => existsSync(path),
  readFileSync: (path: string): string => readFileSync(path).toString(),
  mkdirSync: (path: string, options?: { recursive: boolean }): void => {
    mkdirSync(path, options);
  },
  writeFileSync: (path: string, content: string): void => {
    writeFileSync(path, content);
  },
};

export type InitStateDeps = typeof initStateDeps;

export function initState(deps: InitStateDeps = initStateDeps) {
  const globalConfig: Config = (() => {
    if (deps.existsSync(GLOBAL_CONFIG_PATH)) {
      debugLog(`${GLOBAL_CONFIG_PATH} exists, returning`);
      return parseConfigStr(deps.readFileSync(GLOBAL_CONFIG_PATH));
    }

    debugLog(`${GLOBAL_CONFIG_PATH} does not exist`);
    return DEFAULT_CONFIG;
  })();

  const localConfig: Config = (() => {
    if (deps.existsSync(LOCAL_CONFIG_PATH)) {
      debugLog(`${LOCAL_CONFIG_PATH} exists, reading`);
      return parseConfigStr(deps.readFileSync(LOCAL_CONFIG_PATH));
    }

    deps.mkdirSync(dirname(LOCAL_CONFIG_PATH), { recursive: true });
    deps.writeFileSync(
      LOCAL_CONFIG_PATH,
      JSON.stringify(DEFAULT_CONFIG, null, 2),
    );
    debugLog(`${LOCAL_CONFIG_PATH} does not exist`);
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
  const defaultedBaseURL = localConfig.baseURL ?? globalConfig.baseURL;
  if (
    defaultedBaseURL === undefined &&
    defaultedProvider === "openai-compatible"
  ) {
    throw new Error(
      `A \`baseURL\` is required when \`provider=openai-compatible\` in either ${LOCAL_CONFIG_PATH} or ${GLOBAL_CONFIG_PATH}`,
    );
  }

  dispatch(actions.setModel(defaultedModel));
  if (defaultedBaseURL) dispatch(actions.setBaseURL(defaultedBaseURL));
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
