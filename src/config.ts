import { z } from "zod";
import { tryCatch, MISSING } from "./utils.ts";
import { getAvailableSlashCommands } from "./input.ts";
import {
  getContextEntries,
  getContextStr,
  getSkillsStr,
  getSkills,
} from "./context.ts";
import { actions } from "./state.ts";
import { parseCliArgs } from "./args.ts";
import { fsDeps } from "./deps.ts";
import { getGlobalConfigPath, getLocalConfigPath } from "./paths.ts";

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
  pricingPerModel: z.record(z.string(), ModelPricingSchema).optional(),
  keymaps: z
    .object({
      edit: KeySchema.optional(),
      paste: KeySchema.optional(),
      history: KeySchema.optional(),
      clear: KeySchema.optional(),
    })
    .optional(),
  customSlashCommandDirs: z.array(z.string()).optional(),
  customSkillDirs: z.array(z.string()).optional(),
  loadingStateFrameDuration: z.number().optional(),
  loadingStateFrames: z
    .array(z.string())
    .optional()
    .refine(
      (frames) => {
        if (!frames) return true;
        if (frames.length === 0) return true;
        return new Set(frames.map((f) => f.length)).size === 1;
      },
      { message: "All loadingStateFrames strings must be the same length" },
    )
    .refine(
      (frames) => {
        if (!frames) return true;
        return frames.length >= 2;
      },
      { message: "loadingStateFrames must be at least length 2" },
    ),
  promptPrefix: z.string().optional(),
});

type Config = z.infer<typeof ConfigSchema>;
export type Key = z.infer<typeof KeySchema>;

interface DefaultConfig {
  model: string;
  provider: Provider;
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
    paste: Key;
    history: Key;
    clear: Key;
  };
  customSlashCommandDirs: string[];
  customSkillDirs: string[];
  loadingStateFrames: string[];
  loadingStateFrameDuration: number;
  promptPrefix: string;
}

export const DEFAULT_CONFIG: DefaultConfig = {
  provider: "openai-compatible",
  pricingPerModel: {},
  model: MISSING,
  keymaps: {
    edit: {
      name: "g",
      ctrl: true,
    },
    paste: {
      name: "v",
      ctrl: true,
    },
    history: {
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
  loadingStateFrames: ["|", "/", "-", "\\"],
  loadingStateFrameDuration: 80,
  promptPrefix: "> ",
};

export async function initState() {
  const args = parseCliArgs();
  actions.setDebugLog(args.debug);

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

  actions.setModel(defaultedModel);
  if (defaultedBaseURL) actions.setBaseURL(defaultedBaseURL);
  actions.setProvider(defaultedProvider);
  actions.setPricingPerModel(
    localConfig.pricingPerModel ??
      globalConfig.pricingPerModel ??
      DEFAULT_CONFIG.pricingPerModel,
  );

  actions.setCustomSlashCommandDirs(
    localConfig.customSlashCommandDirs ??
      globalConfig.customSlashCommandDirs ??
      DEFAULT_CONFIG.customSlashCommandDirs,
  );
  actions.setSlashCommands(getAvailableSlashCommands());
  actions.setCustomSkillDirs(
    localConfig.customSkillDirs ??
      globalConfig.customSkillDirs ??
      DEFAULT_CONFIG.customSkillDirs,
  );
  actions.setKeymapEditPrompt(
    localConfig.keymaps?.edit ??
      globalConfig.keymaps?.edit ??
      DEFAULT_CONFIG.keymaps.edit,
  );
  actions.setKeymapEditPastePrompt(
    localConfig.keymaps?.paste ??
      globalConfig.keymaps?.paste ??
      DEFAULT_CONFIG.keymaps.paste,
  );
  actions.setKeymapPromptHistory(
    localConfig.keymaps?.history ??
      globalConfig.keymaps?.history ??
      DEFAULT_CONFIG.keymaps.history,
  );
  actions.setKeymapClear(
    localConfig.keymaps?.clear ??
      globalConfig.keymaps?.clear ??
      DEFAULT_CONFIG.keymaps.clear,
  );
  actions.setLoadingStateFrames(
    localConfig.loadingStateFrames ??
      globalConfig.loadingStateFrames ??
      DEFAULT_CONFIG.loadingStateFrames,
  );
  actions.setLoadingStateFrameDuration(
    localConfig.loadingStateFrameDuration ??
      globalConfig.loadingStateFrameDuration ??
      DEFAULT_CONFIG.loadingStateFrameDuration,
  );
  actions.setPromptPrefix(
    localConfig.promptPrefix ??
      globalConfig.promptPrefix ??
      DEFAULT_CONFIG.promptPrefix,
  );

  const contextEntries = getContextEntries();
  actions.setContextEntries(contextEntries);
  actions.setContextStr(getContextStr(contextEntries));

  const skills = await getSkills();
  actions.setSkills(skills);
  actions.setSkillsStr(getSkillsStr(skills));
}

function parseConfigStr(configStr: string): Config {
  const parseResult = tryCatch((): unknown => JSON.parse(configStr));
  if (parseResult.ok) {
    return ConfigSchema.parse(parseResult.value);
  }
  throw new Error("Failed to parse config as JSON");
}
