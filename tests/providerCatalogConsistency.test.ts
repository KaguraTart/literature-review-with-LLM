import { execFileSync } from "node:child_process";
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
  "huggingface",
  "deepinfra",
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
  "huggingface",
  "deepinfra",
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

const LIVE_PROVIDER_IDS = PROVIDER_ORDER.filter((id) => id !== "local-agents");
const LIVE_GROUP_IDS = ["all", "mainstream", "core", "openai-chat", "openai-responses", "anthropic-messages", "remote", "local"];

function runLiveProviderJson(args: string[]) {
  return JSON.parse(execFileSync(process.execPath, ["scripts/verify-provider-live.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  }));
}

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

    for (const id of ["openai", "openai-responses-compatible", "anthropic", "gemini", "azure-openai", "huggingface", "deepinfra"]) {
      expect(byId.get(id)?.capabilities?.imageBase64).toBe(true);
    }
    for (const id of ["minimax", "openai-compatible", "deepseek", "kimi", "groq", "openrouter", "ollama", "local-agents"]) {
      expect(byId.get(id)?.capabilities?.imageBase64).toBe(false);
    }
  });

  it("keeps live provider verification cases aligned with the default provider catalog", () => {
    const profiles = new Map(loadPreferencesHelpers().defaultProviderProfiles().map((profile) => [profile.id, profile]));
    const catalog = runLiveProviderJson(["--list", "--json"]);
    const cases = catalog.cases || [];

    expect(catalog.liveProviderCases).toBe(true);
    expect(catalog.count).toBe(LIVE_PROVIDER_IDS.length);
    expect(catalog.groups.map((group: any) => group.id)).toEqual(LIVE_GROUP_IDS);
    expect(cases.map((entry: any) => entry.id).sort()).toEqual([...LIVE_PROVIDER_IDS].sort());
    for (const group of catalog.groups || []) {
      expect(group.caseIds.length).toBeGreaterThan(0);
      expect(group.caseIds.every((id: string) => LIVE_PROVIDER_IDS.includes(id))).toBe(true);
    }
    const byGroup = new Map((catalog.groups || []).map((group: any) => [group.id, group.caseIds]));
    expect(byGroup.get("all")).toEqual(cases.map((entry: any) => entry.id));
    expect(byGroup.get("openai-chat")).toEqual(
      cases.filter((entry: any) => entry.protocol === "openai_chat").map((entry: any) => entry.id)
    );
    expect(byGroup.get("openai-responses")).toEqual(
      cases.filter((entry: any) => entry.protocol === "openai_responses").map((entry: any) => entry.id)
    );
    expect(byGroup.get("anthropic-messages")).toEqual(
      cases.filter((entry: any) => entry.protocol === "anthropic_messages").map((entry: any) => entry.id)
    );
    expect(byGroup.get("local")).toEqual(["ollama", "lm-studio"]);

    for (const entry of cases) {
      const profile = profiles.get(entry.profile);
      expect(entry.profile).toBe(entry.id);
      expect(profile).toBeTruthy();
      expect(entry.protocol).toBe(profile.protocol);
      expect(entry.apiKeyEnv).toMatch(/^[A-Z0-9_]+_API_KEY$/);
      expect(entry.modelEnv).toMatch(/^[A-Z0-9_]+_MODEL$/);
      expect(entry.baseURLEnv).toMatch(/^[A-Z0-9_]+_BASE_URL$/);
      expect(entry.headersEnv).toMatch(/^[A-Z0-9_]+_HEADERS_JSON$/);
      expect(entry.bodyExtraEnv).toMatch(/^[A-Z0-9_]+_BODY_EXTRA_JSON$/);
      expect(entry.capabilitiesEnv).toMatch(/^[A-Z0-9_]+_CAPABILITIES_JSON$/);
      expect(entry.imageInput).toBe(profile.capabilities?.imageBase64 === true);
      expect(entry.pdfInput).toBe(profile.capabilities?.pdfBase64 === true && profile.protocol !== "openai_chat");
    }
  });

  it("keeps live provider env templates complete enough to run generation checks", () => {
    const catalog = runLiveProviderJson(["--list", "--json"]);
    const catalogById = new Map((catalog.cases || []).map((entry: any) => [entry.id, entry]));
    const template = runLiveProviderJson(["--env-template", "--json"]);
    const cases = template.cases || [];

    expect(template.liveProviderEnvTemplate).toBe(true);
    expect(template.count).toBe(LIVE_PROVIDER_IDS.length);
    expect(cases.map((entry: any) => entry.id).sort()).toEqual([...LIVE_PROVIDER_IDS].sort());

    for (const entry of cases) {
      const catalogEntry: any = catalogById.get(entry.id);
      const required = new Set(entry.requiredEnv || []);
      const modelRequired = new Set(entry.modelListRequiredEnv || []);
      const optional = new Set(entry.optionalEnv || []);

      expect(catalogEntry).toBeTruthy();
      expect(entry.generationCommand).toBe(`npm run verify:provider:live -- --include ${entry.id}`);
      expect(required.has(catalogEntry.modelEnv)).toBe(true);
      if (catalogEntry.apiKeyOptional) {
        expect(required.has(catalogEntry.apiKeyEnv)).toBe(false);
      } else {
        expect(required.has(catalogEntry.apiKeyEnv)).toBe(true);
      }
      if (catalogEntry.requireBaseURL) {
        expect(required.has(catalogEntry.baseURLEnv)).toBe(true);
      } else {
        expect(optional.has(catalogEntry.baseURLEnv)).toBe(true);
      }
      expect(optional.has(catalogEntry.headersEnv)).toBe(true);
      expect(optional.has(catalogEntry.bodyExtraEnv)).toBe(true);
      expect(optional.has(catalogEntry.capabilitiesEnv)).toBe(true);
      expect(entry.imageCommand).toBe(catalogEntry.imageInput ? `npm run verify:provider:image:live -- --include ${entry.id}` : "");
      expect(entry.pdfCommand).toBe(catalogEntry.pdfInput ? `npm run verify:provider:pdf:live -- --include ${entry.id}` : "");
      expect(entry.modelListCommand).toBe(
        catalogEntry.modelList ? `npm run verify:provider:models:live -- --include ${entry.id}` : ""
      );
      if (catalogEntry.modelList) {
        if (catalogEntry.apiKeyOptional) {
          expect(modelRequired.has(catalogEntry.apiKeyEnv)).toBe(false);
        } else {
          expect(modelRequired.has(catalogEntry.apiKeyEnv)).toBe(true);
        }
      }
    }
  });
});
