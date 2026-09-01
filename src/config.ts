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
import * as YAML from "yaml";

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
      if (Number(prefix) < 0) return false;
      return true;
    },
    {
      message: "usageLimit.duration must be of the format '[>= 0][s,m,h,d]'",
    },
  ),
  dollarAmount: z.number(),
});

export type UsageLimit = z.infer<typeof UsageLimitSchema>;

const ModelSchema = z.string();
const BaseURLSchema = z.string();
const ProviderSchema = z.enum(["anthropic", "openai-compatible"]);
const PricingPerModelSchema = z.record(
  z.string(),
  ModelPricingSchema.nullable(),
);
const ContextWindowPerModelSchema = z.record(z.string(), z.number().nullable());
const DefaultedPricingPerModelSchema = z.record(z.string(), ModelPricingSchema);
const DefaultedContextWindowPerModelSchema = z.record(z.string(), z.number());
const CompactTriggerRatioSchema = z.number().min(0).max(1);
const CompactTargetRatioSchema = z.number().min(0).max(1);
const KeymapsSchema = z.record(z.string(), KeySchema.nullable());
const DefaultedKeymapsSchema = z.record(z.string(), KeySchema);
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
const SuppressBatUnavailableWarningSchema = z.boolean();

export const ConfigSchema = z.strictObject({
  model: ModelSchema.optional(),
  baseURL: BaseURLSchema.optional(),
  provider: ProviderSchema.optional(),
  pricingPerModel: PricingPerModelSchema.optional(),
  contextWindowPerModel: ContextWindowPerModelSchema.optional(),
  compactTriggerRatio: CompactTriggerRatioSchema.optional(),
  compactTargetRatio: CompactTargetRatioSchema.optional(),
  keymaps: KeymapsSchema.optional(),
  customSlashCommandDirs: CustomSlashCommandDirsSchema.optional(),
  customSkillDirs: CustomSkillDirsSchema.optional(),
  loadingStateFrameDuration: LoadingStateFrameDurationSchema.optional(),
  loadingStateFrames: LoadingStateFramesSchema.optional(),
  promptPrefix: PromptPrefixSchema.optional(),
  suppressBatUnavailableWarning: SuppressBatUnavailableWarningSchema.optional(),
  usageLimit: UsageLimitSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DefaultedConfigSchema = z.strictObject({
  model: ModelSchema,
  baseURL: BaseURLSchema.optional(),
  provider: ProviderSchema,
  pricingPerModel: DefaultedPricingPerModelSchema,
  contextWindowPerModel: DefaultedContextWindowPerModelSchema,
  compactTriggerRatio: CompactTriggerRatioSchema,
  compactTargetRatio: CompactTargetRatioSchema,
  keymaps: DefaultedKeymapsSchema,
  customSlashCommandDirs: CustomSlashCommandDirsSchema,
  customSkillDirs: CustomSkillDirsSchema,
  loadingStateFrameDuration: LoadingStateFrameDurationSchema,
  loadingStateFrames: LoadingStateFramesSchema,
  promptPrefix: PromptPrefixSchema,
  suppressBatUnavailableWarning: SuppressBatUnavailableWarningSchema,
  usageLimit: UsageLimitSchema.optional(),
});

export type DefaultedConfig = z.infer<typeof DefaultedConfigSchema>;

export type Key = z.infer<typeof KeySchema>;

export const defaultConfig: DefaultedConfig = {
  model: "",
  provider: "openai-compatible" as const,
  pricingPerModel: {},
  contextWindowPerModel: {},
  compactTriggerRatio: 0.7,
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
  },
  customSlashCommandDirs: [],
  customSkillDirs: [],
  loadingStateFrames: ["|", "/", "-", "\\"],
  loadingStateFrameDuration: 80,
  promptPrefix: "> ",
  suppressBatUnavailableWarning: false,
};

export function readConfigFileStr(path: string) {
  if (!fsDeps.existsSync(path)) return "{}";

  const readResult = tryCatch(() => fsDeps.readFileSync(path).toString());
  if (!readResult.ok) return "{}";

  return readResult.value;
}

export function readConfigFile(path: string): Partial<Config> {
  const configFileStr = readConfigFileStr(path);

  const parseResult = tryCatch((): unknown => YAML.parse(configFileStr));
  if (!parseResult.ok) {
    throw new Error(`Failed to parse config at ${path} as YAML`);
  }

  return ConfigSchema.parse(parseResult.value);
}

function filterNulls<T>(entries: Record<string, T | null>): Record<string, T> {
  const filtered: Record<string, T> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) continue;
    filtered[key] = value;
  }
  return filtered;
}

export async function initStateFromConfig() {
  const globalConfig = readConfigFile(getGlobalConfigPath());
  const localConfig = readConfigFile(getLocalConfigPath());
  actions.setGlobalConfigStr(readConfigFileStr(getGlobalConfigPath()));
  actions.setLocalConfigStr(readConfigFileStr(getLocalConfigPath()));

  const defaultedModel = ModelSchema.parse(
    localConfig.model ?? globalConfig.model,
  );

  const defaultedProvider =
    localConfig.provider ?? globalConfig.provider ?? defaultConfig.provider;
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
  if (defaultedBaseURL !== undefined) actions.setBaseURL(defaultedBaseURL);
  actions.setProvider(defaultedProvider);

  const defaultedPricingPerModel = filterNulls({
    ...defaultConfig.pricingPerModel,
    ...globalConfig.pricingPerModel,
    ...localConfig.pricingPerModel,
  });
  actions.setPricingPerModel(defaultedPricingPerModel);
  const defaultedContextWindowPerModel = filterNulls({
    ...defaultConfig.contextWindowPerModel,
    ...globalConfig.contextWindowPerModel,
    ...localConfig.contextWindowPerModel,
  });
  actions.setContextWindowPerModel(defaultedContextWindowPerModel);
  const defaultedCompactTriggerRatio =
    localConfig.compactTriggerRatio ??
    globalConfig.compactTriggerRatio ??
    defaultConfig.compactTriggerRatio;
  const defaultedCompactTargetRatio =
    localConfig.compactTargetRatio ??
    globalConfig.compactTargetRatio ??
    defaultConfig.compactTargetRatio;
  if (defaultedCompactTriggerRatio <= defaultedCompactTargetRatio) {
    throw new Error(
      `compactTriggerRatio (${String(defaultedCompactTriggerRatio)}) must be greater than compactTargetRatio (${String(defaultedCompactTargetRatio)})`,
    );
  }
  actions.setCompactTriggerRatio(defaultedCompactTriggerRatio);
  actions.setCompactTargetRatio(defaultedCompactTargetRatio);

  actions.setCustomSlashCommandDirs(
    localConfig.customSlashCommandDirs ??
      globalConfig.customSlashCommandDirs ??
      defaultConfig.customSlashCommandDirs,
  );
  actions.setCustomSkillDirs(
    localConfig.customSkillDirs ??
      globalConfig.customSkillDirs ??
      defaultConfig.customSkillDirs,
  );
  const defaultedKeymaps = filterNulls({
    ...defaultConfig.keymaps,
    ...globalConfig.keymaps,
    ...localConfig.keymaps,
  });

  actions.setKeymaps(defaultedKeymaps);
  actions.setLoadingStateFrames(
    localConfig.loadingStateFrames ??
      globalConfig.loadingStateFrames ??
      defaultConfig.loadingStateFrames,
  );
  actions.setLoadingStateFrameDuration(
    localConfig.loadingStateFrameDuration ??
      globalConfig.loadingStateFrameDuration ??
      defaultConfig.loadingStateFrameDuration,
  );
  actions.setPromptPrefix(
    localConfig.promptPrefix ??
      globalConfig.promptPrefix ??
      defaultConfig.promptPrefix,
  );
  actions.setSuppressBatUnavailableWarning(
    localConfig.suppressBatUnavailableWarning ??
      globalConfig.suppressBatUnavailableWarning ??
      defaultConfig.suppressBatUnavailableWarning,
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
  await syncInitialModelUsageForLimitWindow();

  const contextEntries = getContextEntries();
  actions.setContextEntries(contextEntries);
  actions.setContextStr(getContextStr(contextEntries));

  const skills = await getSkills();
  actions.setSkills(skills);
  actions.setSkillsStr(getSkillsStr(skills));

  const slashCommands = getAvailableSlashCommands();
  actions.setSlashCommands(slashCommands);
}

export function initStateForDebug() {
  const args = parseCliArgs();
  actions.setDebugLog(args.debug);
}

export async function initStateRepeatable() {
  initStateForDebug();
  await initStateFromConfig();
  await initStateFromFs();
}

export async function initState() {
  initStateForDebug();
  const debugLogPath = join(
    getDebugLogDir(),
    `debug-${crypto.randomUUID()}.log`,
  );
  actions.setDebugLogPath(debugLogPath);

  await initStateFromConfig();
  await initStateFromFs();
  actions.setSessionStartDate();
}
