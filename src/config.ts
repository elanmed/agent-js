import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  colorPrint,
  getAvailableSlashCommands,
  getRecursiveAgentsMdFilesStr,
  tryCatch,
} from "./utils.ts";
import { debugLog } from "./log.ts";
import { actions, dispatch } from "./state.ts";
import { parseCliArgs } from "./args.ts";
import { fsDeps, type FsDeps } from "./fs-deps.ts";

export const MISSING = "MISSING";

export type DiffStyle = "unified" | "lines";
export type Provider = "anthropic" | "openai-compatible";

const KeySchema = z.object({
  name: z.string().length(1),
  ctrl: z.boolean().optional(),
  meta: z.boolean().optional(),
  shift: z.boolean().optional(),
});

const ModelPricingSchema = z.object({
  inputPerToken: z.number(),
  outputPerToken: z.number(),
  cacheReadPerToken: z.number().optional(),
  cacheWritePerToken: z.number().optional(),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

const ConfigSchema = z.object({
  model: z.string().optional(),
  baseURL: z.string().optional(),
  provider: z.enum(["anthropic", "openai-compatible"]).optional(),
  disableUsageMessage: z.boolean().optional(),
  editorLog: z.boolean().optional(),
  diffStyle: z.enum(["unified", "lines"]).optional(),
  pricingPerModel: z.record(z.string(), ModelPricingSchema).optional(),
  keymaps: z
    .object({
      edit: KeySchema.optional(),
      editLog: KeySchema.optional(),
      clear: KeySchema.optional(),
    })
    .optional(),
});

type Config = z.infer<typeof ConfigSchema>;
export type Key = z.infer<typeof KeySchema>;

interface DefaultConfig {
  model: string;
  provider: Provider;
  disableUsageMessage: boolean;
  editorLog: boolean;
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
  keymaps: {
    edit: Key;
    editLog: Key;
    clear: Key;
  };
}

export const DEFAULT_CONFIG: DefaultConfig = {
  provider: "openai-compatible",
  disableUsageMessage: false,
  editorLog: true,
  diffStyle: "lines",
  pricingPerModel: {},
  model: MISSING,
  keymaps: {
    edit: {
      name: "e",
      ctrl: true,
    },
    editLog: {
      name: "k",
      ctrl: true,
    },
    clear: {
      name: "u",
      ctrl: true,
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

export interface InitStateDeps {
  fs: FsDeps;
  parseCliArgs: typeof parseCliArgs;
  getRecursiveAgentsMdFilesStr: typeof getRecursiveAgentsMdFilesStr;
  colorPrint: typeof colorPrint;
}

const initStateDeps: InitStateDeps = {
  fs: fsDeps,
  parseCliArgs,
  getRecursiveAgentsMdFilesStr,
  colorPrint,
};

export function initState(deps: InitStateDeps = initStateDeps) {
  const args = deps.parseCliArgs();
  dispatch(actions.setDebugLog(args.debug));
  dispatch(actions.setDebugLog(args.debug)); // second time so it's logged

  const globalConfig: Config = (() => {
    if (deps.fs.existsSync(GLOBAL_CONFIG_PATH)) {
      debugLog(`${GLOBAL_CONFIG_PATH} exists, returning`);
      const readResult = tryCatch(() =>
        deps.fs.readFileSync(GLOBAL_CONFIG_PATH).toString(),
      );
      if (readResult.ok) {
        return parseConfigStr(readResult.value);
      }
      debugLog(`Failed to read ${GLOBAL_CONFIG_PATH}, using default`);
      return DEFAULT_CONFIG;
    }

    debugLog(`${GLOBAL_CONFIG_PATH} does not exist`);
    return DEFAULT_CONFIG;
  })();

  const localConfig: Config = (() => {
    if (deps.fs.existsSync(LOCAL_CONFIG_PATH)) {
      debugLog(`${LOCAL_CONFIG_PATH} exists, reading`);
      const readResult = tryCatch(() =>
        deps.fs.readFileSync(LOCAL_CONFIG_PATH).toString(),
      );
      if (readResult.ok) {
        return parseConfigStr(readResult.value);
      }
      debugLog(`Failed to read ${LOCAL_CONFIG_PATH}, using empty config`);
      return {};
    }

    debugLog(`${GLOBAL_CONFIG_PATH} does not exist`);
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
    actions.setEditorLog(
      localConfig.editorLog ??
        globalConfig.editorLog ??
        DEFAULT_CONFIG.editorLog,
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
  dispatch(
    actions.setKeymapEdit(
      localConfig.keymaps?.edit ??
        globalConfig.keymaps?.edit ??
        DEFAULT_CONFIG.keymaps.edit,
    ),
  );
  dispatch(
    actions.setKeymapEditLog(
      localConfig.keymaps?.editLog ??
        globalConfig.keymaps?.editLog ??
        DEFAULT_CONFIG.keymaps.editLog,
    ),
  );
  dispatch(
    actions.setKeymapClear(
      localConfig.keymaps?.clear ??
        globalConfig.keymaps?.clear ??
        DEFAULT_CONFIG.keymaps.clear,
    ),
  );

  const agentsMdFilesStr = deps.getRecursiveAgentsMdFilesStr();
  dispatch(actions.setAgentsMdFilesStr(agentsMdFilesStr));
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
