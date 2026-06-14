export type UiLanguage = "auto" | "zh-CN" | "en-US";
export type ResolvedUiLanguage = "zh-CN" | "en-US";
export type OutputLanguage = "zh-CN" | "en-US" | "ja-JP";

export function resolveUiLanguage(setting: UiLanguage | undefined, runtimeLocale: string | undefined): ResolvedUiLanguage {
  if (setting === "zh-CN" || setting === "en-US") return setting;
  const normalized = (runtimeLocale || "").trim().toLowerCase();
  return normalized.startsWith("zh") ? "zh-CN" : "en-US";
}

export function normalizeUiLanguage(value: string | undefined): UiLanguage {
  if (value === "zh-CN" || value === "en-US") return value;
  return "auto";
}

export function normalizeOutputLanguage(value: string | undefined): OutputLanguage {
  if (value === "en-US" || value === "ja-JP") return value;
  return "zh-CN";
}
