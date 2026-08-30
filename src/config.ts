import crypto from "node:crypto";
import { z } from "zod";
import { tryCatch } from "./utils.ts";
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
import {
  getDebugLogDir,
  getGlobalConfigPath,
  getLocalConfigPath,
} from "./paths.ts";
import { syncInitialModelUsageForLimitWindow } from "./usage.ts";
import { print } from "./print.ts";
import { join } from "node:path";
import YAML from "yaml";

export type Provider = "anthropic" | "openai-compatible";

const KeySchema = z.object({
  name: z.string().length(1),
  ctrl: z.boolean().optional(),
  meta: z.boolean().optional(),
  shift: z.boolean().optional(),
});

const ModelPricingSchema = z.object({
  inputPerMillion: z.number(),
  outputPerMillion: z.number(),
  cacheReadPerMillion: z.number().optional(),
  cacheWritePerMillion: z.number().optional(),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const UsageLimitSchema = z.strictObject({
  duration: z.string().refine(
    (duration) => {
      if (duration.length < 2) return false;
      const suffix = duration.slice(-1);
      if (!["s", "m", "h", "d"].includes(suffix)) return false;
      const prefix = duration.slice(0, -1);
      if (Number.isNaN(Number(prefix))) return false;
      return true;
    },
    {
      message: "usageLimit.duration must be of the format '[number][s,m,h,d]'",
    },
  ),
  dollarAmount: z.number(),
});

export type UsageLimit = z.infer<typeof UsageLimitSchema>;

const ModelSchema = z.string();
const BaseURLSchema = z.string();
const ProviderSchema = z.enum(["anthropic", "openai-compatible"]);
const PricingPerModelSchema = z.record(z.string(), ModelPricingSchema);
const ContextWindowPerModelSchema = z.record(z.string(), z.number());
const CompactAtContextRatioSchema = z.number().min(0).max(1);
const CompactTargetRatioSchema = z.number().min(0).max(1);
const KeymapsSchema = z.object({
  edit: KeySchema.optional(),
  paste: KeySchema.optional(),
  history: KeySchema.optional(),
  clear: KeySchema.optional(),
});
const CustomSlashCommandDirsSchema = z.array(z.string());
const CustomSkillDirsSchema = z.array(z.string());
const LoadingStateFrameDurationSchema = z.number();
const LoadingStateFramesSchema = z
  .array(z.string())
  .refine(
    (frames) => {
      if (frames.length === 0) return true;
      return new Set(frames.map((f) => f.length)).size === 1;
    },
    { message: "All loadingStateFrames strings must be the same length" },
  )
  .refine((frames) => frames.length >= 2, {
    message: "loadingStateFrames must be at least length 2",
  });
const PromptPrefixSchema = z.string();

export const ConfigSchema = z.strictObject({
  model: ModelSchema,
  baseURL: BaseURLSchema.optional(),
  provider: ProviderSchema.optional(),
  pricingPerModel: PricingPerModelSchema.optional(),
  contextWindowPerModel: ContextWindowPerModelSchema.optional(),
  compactAtContextRatio: CompactAtContextRatioSchema.optional(),
  compactTargetRatio: CompactTargetRatioSchema.optional(),
  keymaps: KeymapsSchema.optional(),
  customSlashCommandDirs: CustomSlashCommandDirsSchema.optional(),
  customSkillDirs: CustomSkillDirsSchema.optional(),
  loadingStateFrameDuration: LoadingStateFrameDurationSchema.optional(),
  loadingStateFrames: LoadingStateFramesSchema.optional(),
  promptPrefix: PromptPrefixSchema.optional(),
  usageLimit: UsageLimitSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DefaultedConfigSchema = z.strictObject({
  model: ModelSchema,
  baseURL: BaseURLSchema.optional(),
  provider: ProviderSchema,
  pricingPerModel: PricingPerModelSchema,
  contextWindowPerModel: ContextWindowPerModelSchema,
  compactAtContextRatio: CompactAtContextRatioSchema,
  compactTargetRatio: CompactTargetRatioSchema,
  keymapEditPrompt: KeySchema,
  keymapPastePrompt: KeySchema,
  keymapChatHistory: KeySchema,
  keymapClear: KeySchema,
  loadingStateFrames: LoadingStateFramesSchema,
  loadingStateFrameDuration: LoadingStateFrameDurationSchema,
  promptPrefix: PromptPrefixSchema,
  usageLimit: UsageLimitSchema.optional(),
});

export type DefaultedConfig = z.infer<typeof DefaultedConfigSchema>;

export type Key = z.infer<typeof KeySchema>;

export const DEFAULT_CONFIG = {
  provider: "openai-compatible" as const,
  pricingPerModel: {} as Record<string, ModelPricing>,
  contextWindowPerModel: {},
  compactAtContextRatio: 0.7,
  compactTargetRatio: 0.3,
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

export function readConfigFile(path: string): Partial<Config> {
  if (!fsDeps.existsSync(path)) return {};

  const readResult = tryCatch(() => fsDeps.readFileSync(path).toString());
  if (!readResult.ok) return {};

  const parseResult = tryCatch((): unknown => YAML.parse(readResult.value));
  if (!parseResult.ok) {
    throw new Error(`Failed to parse config at ${path} as YAML`);
  }

  return ConfigSchema.parse(parseResult.value);
}

export async function initStateFromConfig() {
  const globalConfig = readConfigFile(getGlobalConfigPath());
  const localConfig = readConfigFile(getLocalConfigPath());

  const defaultedModel = ModelSchema.parse(
    localConfig.model ?? globalConfig.model,
  );

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

  if (defaultedBaseURL !== undefined && defaultedProvider === "anthropic") {
    throw new Error(
      `A \`baseURL\` cannot be provided when \`provider=anthropic\` in either ${getLocalConfigPath()} or ${getGlobalConfigPath()}`,
    );
  }

  actions.setModel(defaultedModel);
  if (defaultedBaseURL) actions.setBaseURL(defaultedBaseURL);
  actions.setProvider(defaultedProvider);

  const defaultedPricingPerModel = {
    ...DEFAULT_CONFIG.pricingPerModel,
    ...globalConfig.pricingPerModel,
    ...localConfig.pricingPerModel,
  };
  actions.setPricingPerModel(defaultedPricingPerModel);
  actions.setContextWindowPerModel({
    ...DEFAULT_CONFIG.contextWindowPerModel,
    ...globalConfig.contextWindowPerModel,
    ...localConfig.contextWindowPerModel,
  });
  actions.setCompactAtContextRatio(
    localConfig.compactAtContextRatio ??
      globalConfig.compactAtContextRatio ??
      DEFAULT_CONFIG.compactAtContextRatio,
  );
  actions.setCompactTargetRatio(
    localConfig.compactTargetRatio ??
      globalConfig.compactTargetRatio ??
      DEFAULT_CONFIG.compactTargetRatio,
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
  actions.setKeymapPastePrompt(
    localConfig.keymaps?.paste ??
      globalConfig.keymaps?.paste ??
      DEFAULT_CONFIG.keymaps.paste,
  );
  actions.setKeymapChatHistory(
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

  const defaultedUsageLimit = localConfig.usageLimit ?? globalConfig.usageLimit;

  if (
    defaultedUsageLimit !== undefined &&
    defaultedPricingPerModel[defaultedModel] === undefined
  ) {
    await print.warning(
      `usage limit disabled: no \`pricingPerModel\` entry for the current model \`${defaultedModel}\``,
    );
  }

  actions.setUsageLimit(defaultedUsageLimit);
}

export async function initStateFromFs() {
  syncInitialModelUsageForLimitWindow();

  const contextEntries = getContextEntries();
  actions.setContextEntries(contextEntries);
  actions.setContextStr(getContextStr(contextEntries));

  const skills = await getSkills();
  actions.setSkills(skills);
  actions.setSkillsStr(getSkillsStr(skills));

  actions.setSessionStartDate();
}

export function initStateForDebug() {
  const args = parseCliArgs();
  actions.setDebugLog(args.debug);

  const debugLogPath = join(
    getDebugLogDir(),
    `debug-${crypto.randomUUID()}.log`,
  );
  actions.setDebugLogPath(debugLogPath);
}

export async function initState() {
  initStateForDebug();
  await initStateFromConfig();
  await initStateFromFs();
}
