import { z } from "zod";
import { tryCatch, MISSING } from "./utils.ts";
import { getAvailableSlashCommands } from "./input.ts";
import {
  getContextEntries,
  getContextStr,
  getSkillsStr,
  getSkills,
} from "./context.ts";
import { actions, dispatch } from "./state.ts";
import { parseCliArgs } from "./args.ts";
import { fsDeps } from "./deps.ts";
import { getGlobalConfigPath, getLocalConfigPath } from "./paths.ts";

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
  editorLog: z.boolean().optional(),
  diffStyle: z.enum(["unified", "lines"]).optional(),
  pricingPerModel: z.record(z.string(), ModelPricingSchema).optional(),
  keymaps: z
    .object({
      edit: KeySchema.optional(),
      editPaste: KeySchema.optional(),
      editLog: KeySchema.optional(),
      clear: KeySchema.optional(),
    })
    .optional(),
  customSlashCommandDirs: z.array(z.string()).optional(),
  customSkillDirs: z.array(z.string()).optional(),
});

type Config = z.infer<typeof ConfigSchema>;
export type Key = z.infer<typeof KeySchema>;

interface DefaultConfig {
  model: string;
  provider: Provider;
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
    editPaste: Key;
    editLog: Key;
    clear: Key;
  };
  customSlashCommandDirs: string[];
  customSkillDirs: string[];
}

export const DEFAULT_CONFIG: DefaultConfig = {
  provider: "openai-compatible",
  editorLog: true,
  diffStyle: "lines",
  pricingPerModel: {},
  model: MISSING,
  keymaps: {
    edit: {
      name: "g",
      ctrl: true,
    },
    editPaste: {
      name: "v",
      ctrl: true,
    },
    editLog: {
      name: "o",
      ctrl: true,
    },
    clear: {
      name: "x",
      ctrl: true,
    },
  },
  customSlashCommandDirs: [],
  customSkillDirs: [],
};

export function initState() {
  const args = parseCliArgs();
  dispatch(actions.setDebugLog(args.debug));

  const globalConfig: Config = (() => {
    if (fsDeps.existsSync(getGlobalConfigPath())) {
      const readResult = tryCatch(() =>
        fsDeps.readFileSync(getGlobalConfigPath()).toString(),
      );
      if (readResult.ok) {
        return parseConfigStr(readResult.value);
      }
      return DEFAULT_CONFIG;
    }

    return DEFAULT_CONFIG;
  })();

  const localConfig: Config = (() => {
    if (fsDeps.existsSync(getLocalConfigPath())) {
      const readResult = tryCatch(() =>
        fsDeps.readFileSync(getLocalConfigPath()).toString(),
      );
      if (readResult.ok) {
        return parseConfigStr(readResult.value);
      }
      return {};
    }

    return {};
  })();

  const defaultedModel =
    localConfig.model ?? globalConfig.model ?? DEFAULT_CONFIG.model;
  if (defaultedModel === MISSING) {
    throw new Error(
      `A \`model\` is required in either ${getLocalConfigPath()} or ${getGlobalConfigPath()}`,
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
      `A \`baseURL\` is required when \`provider=openai-compatible\` in either ${getLocalConfigPath()} or ${getGlobalConfigPath()}`,
    );
  }

  dispatch(actions.setModel(defaultedModel));
  if (defaultedBaseURL) dispatch(actions.setBaseURL(defaultedBaseURL));
  dispatch(actions.setProvider(defaultedProvider));
  dispatch(
    actions.setDiffStyle(
      localConfig.diffStyle ??
        globalConfig.diffStyle ??
        DEFAULT_CONFIG.diffStyle,
    ),
  );
  dispatch(
    actions.setPricingPerModel(
      localConfig.pricingPerModel ??
        globalConfig.pricingPerModel ??
        DEFAULT_CONFIG.pricingPerModel,
    ),
  );

  dispatch(
    actions.setCustomSlashCommandDirs(
      localConfig.customSlashCommandDirs ??
        globalConfig.customSlashCommandDirs ??
        DEFAULT_CONFIG.customSlashCommandDirs,
    ),
  );
  dispatch(actions.setSlashCommands(getAvailableSlashCommands()));
  dispatch(
    actions.setCustomSkillDirs(
      localConfig.customSkillDirs ??
        globalConfig.customSkillDirs ??
        DEFAULT_CONFIG.customSkillDirs,
    ),
  );
  dispatch(
    actions.setKeymapEdit(
      localConfig.keymaps?.edit ??
        globalConfig.keymaps?.edit ??
        DEFAULT_CONFIG.keymaps.edit,
    ),
  );
  dispatch(
    actions.setKeymapEditPaste(
      localConfig.keymaps?.editPaste ??
        globalConfig.keymaps?.editPaste ??
        DEFAULT_CONFIG.keymaps.editPaste,
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

  const contextEntries = getContextEntries();
  dispatch(actions.setContextEntries(contextEntries));
  dispatch(actions.setContextStr(getContextStr(contextEntries)));

  const skills = getSkills();
  dispatch(actions.setSkills(skills));
  dispatch(actions.setSkillsStr(getSkillsStr(skills)));
}

function parseConfigStr(configStr: string): Config {
  const parseResult = tryCatch((): unknown => JSON.parse(configStr));
  if (parseResult.ok) {
    return ConfigSchema.parse(parseResult.value);
  }
  throw new Error("Failed to parse config as JSON");
}
