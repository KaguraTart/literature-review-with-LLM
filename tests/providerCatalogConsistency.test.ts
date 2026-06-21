import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const PROVIDER_ORDER = [
  "minimax",
  "openai",
  "openai-compatible",
  "openai-responses-compatible",
  "anthropic",
  "anthropic-compatible",
  "gemini",
  "azure-openai",
  "github-models",
  "fireworks",
  "cerebras",
  "nvidia-nim",
  "sambanova",
  "sambanova-responses",
  "sambanova-anthropic",
  "xai",
  "groq",
  "mistral",
  "together",
  "kimi",
  "perplexity",
  "deepseek",
  "deepseek-anthropic",
  "zai-anthropic",
  "openrouter",
  "dashscope",
  "siliconflow",
  "zhipu",
  "volcengine",
  "qianfan",
  "hunyuan",
  "ollama",
  "lm-studio",
  "local-agents"
];

const SETTINGS_ALIASES = [
  "minimax",
  "openai",
  "openai_compatible",
  "openai_responses_compatible",
  "anthropic",
  "anthropic_compatible",
  "gemini",
  "azure_openai",
  "github_models",
  "fireworks",
  "cerebras",
  "nvidia_nim",
  "sambanova",
  "sambanova_responses",
  "sambanova_anthropic",
  "xai",
  "groq",
  "mistral",
  "together",
  "kimi",
  "perplexity",
  "deepseek",
  "deepseek_anthropic",
  "zai_anthropic",
  "openrouter",
  "dashscope",
  "siliconflow",
  "zhipu",
  "volcengine",
  "qianfan",
  "hunyuan",
  "ollama",
  "lm_studio",
  "local_agents"
];

function loadPreferencesHelpers() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/preferences.js"), "utf8");
  const context = createContext({
    window: {},
    document: {
      getElementById: () => ({ checked: false })
    },
    URL,
    console
  });
  runInContext(code, context, { filename: "preferences.js" });
  return context as {
    defaultProviderProfiles: () => any[];
    providerDefaults: (provider: string) => any;
  };
}

function loadWorkbenchHelpers() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/workbench.js"), "utf8");
  const context = createContext({
    window: { parent: undefined },
    navigator: {
      clipboard: {
        writeText() {}
      }
    },
    console
  });
  runInContext(code, context, { filename: "workbench.js" });
  return context as {
    defaultProviderProfiles: () => any[];
    workbenchProviderDefaults: (provider: string) => any;
  };
}

function loadBootstrapSettingsHelpers() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-settings.js"), "utf8");
  const context = createContext({
    Zotero: {
      Prefs: {
        get: () => undefined
      }
    },
    console
  });
  runInContext(code, context, { filename: "bootstrap-settings.js" });
  return context as {
    settingsProviderDefaults: (provider: string) => any;
  };
}

function defaultPrefsProfiles() {
  const prefs = readFileSync("addon/prefs.js", "utf8");
  const match = prefs.match(/pref\("profilesJson",\s*"((?:\\.|[^"\\])*)"\);/);
  if (!match) throw new Error("profilesJson preference is missing");
  return JSON.parse(JSON.parse(`"${match[1]}"`));
}

function catalogCanonical(profile: any) {
  return {
    id: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    endpointMode: profile.endpointMode,
    baseURL: profile.baseURL || "",
    fullURL: profile.fullURL || "",
    model: profile.model || "",
    capabilities: profile.capabilities || {},
    customHeaders: profile.customHeaders || {},
    bodyExtra: profile.bodyExtra || {},
    isDefault: profile.isDefault === true
  };
}

function settingsCanonical(id: string, defaults: any) {
  return {
    id,
    protocol: defaults.protocol,
    endpointMode: defaults.endpointMode,
    baseURL: defaults.baseURL || "",
    fullURL: defaults.fullURL || "",
    model: defaults.model || "",
    capabilities: defaults.capabilities || {},
    customHeaders: defaults.customHeaders || {},
    bodyExtra: defaults.bodyExtra || {}
  };
}

describe("provider catalog consistency", () => {
  it("keeps default provider profile order aligned across prefs, settings, and workbench", () => {
    const preferencesProfiles = loadPreferencesHelpers().defaultProviderProfiles().map(catalogCanonical);
    const workbenchProfiles = loadWorkbenchHelpers().defaultProviderProfiles().map(catalogCanonical);
    const prefsProfiles = defaultPrefsProfiles().map(catalogCanonical);

    expect(preferencesProfiles.map((profile) => profile.id)).toEqual(PROVIDER_ORDER);
    expect(workbenchProfiles).toEqual(preferencesProfiles);
    expect(prefsProfiles).toEqual(preferencesProfiles);
  });

  it("keeps bootstrap fallback provider defaults aligned with the editable catalog", () => {
    const preferences = loadPreferencesHelpers();
    const bootstrap = loadBootstrapSettingsHelpers();

    const editableDefaults = SETTINGS_ALIASES.map((alias) => {
      const defaults = preferences.providerDefaults(alias);
      return settingsCanonical(defaults.id, defaults);
    });
    const bootstrapDefaults = SETTINGS_ALIASES.map((alias, index) => {
      const defaults = bootstrap.settingsProviderDefaults(alias);
      return settingsCanonical(PROVIDER_ORDER[index], defaults);
    });

    expect(bootstrapDefaults).toEqual(editableDefaults);
  });

  it("keeps screenshot input opt-in for unknown or text-first provider defaults", () => {
    const profiles = loadPreferencesHelpers().defaultProviderProfiles();
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));

    for (const id of ["openai", "openai-responses-compatible", "anthropic", "gemini", "azure-openai"]) {
      expect(byId.get(id)?.capabilities?.imageBase64).toBe(true);
    }
    for (const id of ["minimax", "openai-compatible", "deepseek", "kimi", "groq", "openrouter", "ollama", "local-agents"]) {
      expect(byId.get(id)?.capabilities?.imageBase64).toBe(false);
    }
  });
});
