import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

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
    parseLocalAgentConfig: (raw: any) => any;
    providerBodyExtra: (bodyExtra: any) => Record<string, any>;
    connectionTestRequestForProfile: (profile: any) => any;
    localAgentConnectionTestRequestForProfile: (profile: any) => any;
    localAgentToolsListRequestForProfile: (profile: any) => any;
    localAgentToolNamesFromResponse: (data: any) => string[];
    isLocalAgentProfile: (profile: any) => boolean;
    headersForProfile: (profile: any) => Record<string, string>;
    profileHasUsableAuth: (profile: any) => boolean;
    modelListRequestForProfile: (profile: any) => any;
    modelIdsFromResponse: (data: any) => string[];
    modelOptionsFromResponse: (data: any) => Array<{ id: string; label: string }>;
    providerErrorText: (status: number, text: string) => string;
    localAgentErrorText: (status: number, text: string) => string;
    extractProviderConnectionText: (protocol: string, text: string) => string;
    normalizeProfileId: (value: string) => string;
    providerFromProfile: (profile: any) => string;
    builtInSkillTemplate: (skillId: string, outputLanguage: string) => string;
    providerDefaults: (provider: string) => any;
    providerSetupGuide: (profile: any, language?: string) => string;
    defaultProviderProfiles: () => any[];
    mergeDefaultProviderProfiles: (profiles: any[]) => any[];
    normalizeProviderProfile: (profile: any) => any;
  };
}

function loadPreferencesController(options: { fetchResponse?: any; fetchResponses?: any[]; fetchOk?: boolean; fetchStatus?: number; initialModel?: string; skillFiles?: string[] } = {}) {
  const code = readFileSync(resolve(process.cwd(), "addon/content/preferences.js"), "utf8");
  const elements = new Map<string, any>();
  const fetchCalls: Array<{ url: string; init: any }> = [];
  const skillFiles = new Set(options.skillFiles || []);
  const messageMap: Record<string, string> = {
    apiKeyMissing: "API key missing",
    jsonInvalid: "Invalid JSON",
    modelListEmpty: "No models",
    modelListLoaded: "Models loaded",
    modelListUnavailable: "Model list unavailable",
    profilesReset: "Default provider profiles restored",
    resetProfiles: "Reset default profiles",
    testOk: "Connection OK",
    testFailed: "Connection failed",
    noProfile: "No profile",
    profileProtocolStatus: "Protocol",
    profileModelStatus: "Model",
    profileEndpointStatus: "Endpoint",
    profileEndpointMissing: "Not configured",
    profileModelMissing: "Not configured",
    profileModelOptional: "Optional",
    profileAuthReady: "Authentication configured",
    profileAuthMissing: "Missing authentication",
    profilePdfReady: "Raw PDF input supported",
    profilePdfTextOnly: "Text input only",
    profileImageReady: "Image input supported",
    profileImageOff: "Image input disabled",
    profileStreamReady: "Streaming supported",
    profileStreamOff: "Streaming disabled",
    profileLocalAgentReady: "Local agent configured"
  };
  const createElement = (id: string, props: Record<string, any> = {}) => {
    let text = props.textContent || "";
    const element: any = {
      id,
      localName: props.localName || "input",
      value: props.value || "",
      checked: !!props.checked,
      children: [] as any[],
      attributes: {} as Record<string, string>,
      appendChild(child: any) {
        this.children.push(child);
      },
      setAttribute(name: string, value: string) {
        this.attributes[name] = String(value);
        this[name] = String(value);
      },
      get textContent() {
        return text;
      },
      set textContent(value: string) {
        text = String(value);
        if (value === "") this.children = [];
      }
    };
    for (const [key, value] of Object.entries(props)) {
      if (key !== "textContent") element[key] = value;
    }
    elements.set(id, element);
    return element;
  };
  const setValue = (id: string, value: string) => createElement(id, { value });
  const setChecked = (id: string, checked: boolean) => createElement(id, { checked });

  setValue("zms-uiLanguage", "en-US");
  setValue("zms-provider", "openai");
  setValue("zms-activeProfileId", "openai");
  setValue("zms-profileName", "OpenAI");
  setValue("zms-profileProtocol", "openai_responses");
  setValue("zms-profileEndpointMode", "base_url");
  setValue("zms-baseURL", "https://api.openai.com/v1");
  setValue("zms-profileFullURL", "");
  setValue("zms-apiKey", "sk-test-secret");
  setValue("zms-model", options.initialModel || "");
  setValue("zms-outputDir", "/tmp/out");
  setValue("zms-inputMode", "text");
  setValue("zms-maxOutputTokens", "8192");
  setValue("zms-temperature", "1");
  setValue("zms-systemPrompt", "");
  setValue("zms-userPrompt", "");
  setValue("zms-outputLanguage", "zh-CN");
  setValue("zms-profilesJson", "[]");
  setValue("zms-skillId", "paper-deep-summary");
  setValue("zms-skillTemplate", "");
  setValue("zms-profileCustomHeaders", "{\"x-route\":\"paper\"}");
  setValue("zms-profileBodyExtra", "{}");
  setValue("zms-profileLocalAgentTimeout", "");
  setValue("zms-profileLocalAgentEndpoint", "");
  setValue("zms-profileLocalAgentTool", "");
  setValue("zms-profileLocalAgentPayloadMode", "jsonrpc");
  setValue("zms-profileLocalAgentHeaders", "{}");
  setValue("zms-profileLocalAgentSkills", "{}");
  createElement("zms-status", { localName: "label" });
  createElement("zms-model-options", { localName: "datalist" });
  createElement("zms-profile-options", { localName: "datalist" });
  createElement("zms-profileStatus", { localName: "pre" });
  createElement("zms-providerGuide", { localName: "pre" });
  setChecked("zms-stream", false);
  setChecked("zms-profileLocalAgentFallback", false);
  setChecked("zms-profileLocalAgentEnabled", false);
  setChecked("zms-cap-text", true);
  setChecked("zms-cap-pdfBase64", true);
  setChecked("zms-cap-imageBase64", true);
  setChecked("zms-cap-streaming", false);
  setChecked("zms-cap-fileReference", false);
  setChecked("zms-cap-embeddings", false);
  setChecked("zms-cap-jsonMode", false);
  setChecked("zms-cap-toolUse", false);
  setChecked("zms-cap-modelList", true);

  const context = createContext({
    window: {},
    document: {
      getElementById(id: string) {
        return elements.get(id) || createElement(id);
      },
      createElement(tag: string) {
        return createElement("", { localName: tag });
      }
    },
    URL,
    fetch: async (url: string, init: any) => {
      const responseIndex = fetchCalls.length;
      fetchCalls.push({ url, init });
      const payload = options.fetchResponses
        ? options.fetchResponses[Math.min(responseIndex, options.fetchResponses.length - 1)]
        : options.fetchResponse || { data: [] };
      return {
        ok: options.fetchOk ?? true,
        status: options.fetchStatus ?? 200,
        text: async () => JSON.stringify(payload)
      };
    },
    zmsMessage: (_scope: string, key: string) => messageMap[key] || key,
    IOUtils: {
      exists: async (path: string) => path === "/tmp/out/skills",
      getChildren: async (path: string) => path === "/tmp/out/skills" ? [...skillFiles] : [],
      makeDirectory: async () => undefined,
      writeUTF8: async (path: string) => {
        if (path.startsWith("/tmp/out/skills/")) skillFiles.add(path);
      }
    },
    PathUtils: {
      join: (...parts: string[]) => parts.filter(Boolean).join("/")
    },
    Zotero: {
      Prefs: {
        set: () => undefined
      }
    },
    console
  });
  runInContext(code, context, { filename: "preferences.js" });
  return {
    controller: (context as any).window.ZoteroMarkdownSummaryPrefs,
    elements,
    fetchCalls
  };
}

describe("preferences local-agent config helpers", () => {
  const helpers = loadPreferencesHelpers();

  it("preserves root-level advanced local-agent fields", () => {
    const parsed = helpers.parseLocalAgentConfig({
      endpoint: "http://127.0.0.1:3333/mcp",
      method: "root.call",
      model: "local-model",
      timeoutSeconds: 180,
      args: { route: "default" },
      body: { shared: true },
      "ask-gemini": {
        method: "gemini.call",
        args: { provider: "gemini" }
      }
    });

    expect(parsed).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      method: "root.call",
      model: "local-model",
      timeoutSeconds: 180,
      args: { route: "default" },
      body: { shared: true },
      "ask-gemini": {
        method: "gemini.call",
        args: { provider: "gemini" }
      }
    });
  });

  it("normalizes profile ids before storing provider profiles", () => {
    expect(helpers.normalizeProfileId("../ My OpenAI:Profile?.md ")).toBe("My-OpenAI-Profile-.md");
    expect(helpers.normalizeProfileId("  local agents  ")).toBe("local-agents");
    expect(helpers.normalizeProfileId("...")).toBe("");
  });

  it("filters local-agent config from provider body extras", () => {
    expect(helpers.providerBodyExtra({
      extra_body: { reasoning_split: true },
      localAgent: { endpoint: "http://127.0.0.1:3333/mcp" },
      agent: { endpoint: "http://127.0.0.1:3334/mcp" },
      subagent: { endpoint: "http://127.0.0.1:3335/mcp" },
      directBrowserAccess: true,
      anthropicDirectBrowserAccess: false
    })).toEqual({ extra_body: { reasoning_split: true } });
  });

  it("builds a Responses connection test request from the edited profile", () => {
    const request = helpers.connectionTestRequestForProfile({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "model-a",
      customHeaders: { "x-route": "paper" },
      bodyExtra: {
        response_format: { type: "json_object" },
        localAgent: { endpoint: "http://127.0.0.1:3333/mcp" }
      }
    });

    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.headers).toMatchObject({ authorization: "Bearer sk-test-secret", "x-route": "paper" });
    expect(request.body).toMatchObject({
      model: "model-a",
      instructions: expect.stringContaining("connection test endpoint"),
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "ping" }]
        }
      ],
      max_output_tokens: 32,
      stream: false,
      response_format: { type: "json_object" }
    });
    expect(request.body).not.toHaveProperty("localAgent");
  });

  it("adds JSON mode defaults to settings connection test requests", () => {
    expect(helpers.connectionTestRequestForProfile({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "model-a",
      capabilities: { jsonMode: true },
      customHeaders: {},
      bodyExtra: {}
    }).body).toMatchObject({
      text: { format: { type: "json_object" } }
    });

    expect(helpers.connectionTestRequestForProfile({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "model-a",
      capabilities: { jsonMode: true },
      customHeaders: {},
      bodyExtra: {
        response_format: { type: "json_schema", json_schema: { name: "paper" } }
      }
    }).body).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "paper" } }
    });
  });

  it("builds OpenAI-compatible Chat connection and model-list requests without provider-specific extras", () => {
    const profile = {
      ...helpers.providerDefaults("openai_compatible"),
      apiKey: "sk-test-secret",
      model: "router-model",
      customHeaders: { "x-route": "paper" }
    };
    const request = helpers.connectionTestRequestForProfile(profile);
    const modelList = helpers.modelListRequestForProfile(profile);

    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.headers).toMatchObject({ authorization: "Bearer sk-test-secret", "x-route": "paper" });
    expect(request.body).toMatchObject({
      model: "router-model",
      messages: [
        { role: "system", content: expect.stringContaining("connection test endpoint") },
        { role: "user", content: "ping" }
      ],
      max_tokens: 32,
      stream: true,
      stream_options: { include_usage: true },
      n: 1
    });
    expect(request.body).not.toHaveProperty("extra_body");
    expect(modelList?.url).toBe("https://api.openai.com/v1/models");

    const nonStreamingRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      capabilities: { ...profile.capabilities, streaming: false }
    });
    expect(nonStreamingRequest.body).toMatchObject({ stream: false });
    expect(nonStreamingRequest.body).not.toHaveProperty("stream_options");

    const streamOptionOverride = helpers.connectionTestRequestForProfile({
      ...profile,
      bodyExtra: { stream_options: { include_usage: false } }
    });
    expect(streamOptionOverride.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: false }
    });

    const streamOptionOmitted = helpers.connectionTestRequestForProfile({
      ...profile,
      bodyExtra: { omitFields: ["stream_options"] }
    });
    expect(streamOptionOmitted.body).toMatchObject({ stream: true });
    expect(streamOptionOmitted.body).not.toHaveProperty("stream_options");

    const reasoningRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      model: "o1-preview"
    });
    expect(reasoningRequest.body).toMatchObject({ max_completion_tokens: 32 });
    expect(reasoningRequest.body).not.toHaveProperty("max_tokens");

    const explicitLegacyRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      model: "o3-mini",
      bodyExtra: { tokenLimitField: "max_tokens" }
    });
    expect(explicitLegacyRequest.body).toMatchObject({ max_tokens: 32 });
    expect(explicitLegacyRequest.body).not.toHaveProperty("max_completion_tokens");
    expect(explicitLegacyRequest.body).not.toHaveProperty("tokenLimitField");

    const strippedRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      bodyExtra: {
        response_format: { type: "json_object" },
        omitFields: ["temperature", "n", "max_tokens"]
      }
    });
    expect(strippedRequest.body).toMatchObject({ response_format: { type: "json_object" } });
    expect(strippedRequest.body).not.toHaveProperty("temperature");
    expect(strippedRequest.body).not.toHaveProperty("n");
    expect(strippedRequest.body).not.toHaveProperty("max_tokens");
    expect(strippedRequest.body).not.toHaveProperty("omitFields");

    const pastedChatEndpointProfile = {
      ...profile,
      baseURL: "https://api.openai.com/v1/chat/completions"
    };
    expect(helpers.connectionTestRequestForProfile(pastedChatEndpointProfile).url)
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(helpers.modelListRequestForProfile(pastedChatEndpointProfile)?.url)
      .toBe("https://api.openai.com/v1/models");
    const pastedChatModelsProfile = {
      ...profile,
      baseURL: "https://api.openai.com/v1/models"
    };
    expect(helpers.connectionTestRequestForProfile(pastedChatModelsProfile).url)
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(helpers.modelListRequestForProfile(pastedChatModelsProfile)?.url)
      .toBe("https://api.openai.com/v1/models");

    const noVersionProfile = {
      ...helpers.providerDefaults("deepseek"),
      apiKey: "sk-test-secret",
      model: "deepseek-chat"
    };
    expect(helpers.connectionTestRequestForProfile(noVersionProfile).url)
      .toBe("https://api.deepseek.com/v1/chat/completions");
    expect(helpers.modelListRequestForProfile(noVersionProfile)?.url)
      .toBe("https://api.deepseek.com/v1/models");

    const geminiProfile = {
      ...helpers.providerDefaults("gemini"),
      apiKey: "gemini-secret",
      model: "gemini-model"
    };
    expect(helpers.connectionTestRequestForProfile(geminiProfile).url)
      .toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(helpers.modelListRequestForProfile(geminiProfile)?.url)
      .toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");

    const azureProfile = {
      ...helpers.providerDefaults("azure_openai"),
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      model: "deployment-a"
    };
    expect(helpers.connectionTestRequestForProfile(azureProfile).url)
      .toBe("https://example-resource.openai.azure.com/openai/v1/responses");
    expect(helpers.connectionTestRequestForProfile(azureProfile).headers).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.connectionTestRequestForProfile(azureProfile).headers).not.toHaveProperty("authorization");

    const pastedResponsesEndpointProfile = {
      ...helpers.providerDefaults("openai"),
      baseURL: "https://api.openai.com/v1/responses",
      apiKey: "sk-test-secret",
      model: "response-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedResponsesEndpointProfile).url)
      .toBe("https://api.openai.com/v1/responses");
    expect(helpers.modelListRequestForProfile(pastedResponsesEndpointProfile)?.url)
      .toBe("https://api.openai.com/v1/models");
    const pastedResponsesModelsProfile = {
      ...helpers.providerDefaults("openai"),
      baseURL: "https://api.openai.com/v1/models",
      apiKey: "sk-test-secret",
      model: "response-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedResponsesModelsProfile).url)
      .toBe("https://api.openai.com/v1/responses");
    expect(helpers.modelListRequestForProfile(pastedResponsesModelsProfile)?.url)
      .toBe("https://api.openai.com/v1/models");

    const pastedAnthropicEndpointProfile = {
      ...helpers.providerDefaults("anthropic"),
      baseURL: "https://api.anthropic.com/v1/messages",
      apiKey: "anthropic-secret",
      model: "claude-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedAnthropicEndpointProfile).url)
      .toBe("https://api.anthropic.com/v1/messages");
    expect(helpers.modelListRequestForProfile(pastedAnthropicEndpointProfile)?.url)
      .toBe("https://api.anthropic.com/v1/models");
    const pastedAnthropicModelsProfile = {
      ...helpers.providerDefaults("anthropic"),
      baseURL: "https://api.anthropic.com/v1/models",
      apiKey: "anthropic-secret",
      model: "claude-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedAnthropicModelsProfile).url)
      .toBe("https://api.anthropic.com/v1/messages");
    expect(helpers.modelListRequestForProfile(pastedAnthropicModelsProfile)?.url)
      .toBe("https://api.anthropic.com/v1/models");

    const perplexityProfile = {
      ...helpers.providerDefaults("perplexity"),
      apiKey: "perplexity-secret",
      model: "sonar-pro"
    };
    expect(helpers.connectionTestRequestForProfile(perplexityProfile).url)
      .toBe("https://api.perplexity.ai/chat/completions");
    expect(helpers.modelListRequestForProfile(perplexityProfile)?.url)
      .toBe("https://api.perplexity.ai/models");
  });

  it("keeps settings custom auth headers and allows auth-header-only profiles", () => {
    const openaiProfile = {
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "",
      customHeaders: { Authorization: "Bearer routed-secret" }
    };
    expect(helpers.profileHasUsableAuth(openaiProfile)).toBe(true);
    expect(helpers.headersForProfile(openaiProfile)).toMatchObject({ Authorization: "Bearer routed-secret" });
    expect(helpers.headersForProfile({ ...openaiProfile, customHeaders: {} })).not.toHaveProperty("authorization");
    expect(helpers.headersForProfile({ ...openaiProfile, apiKey: "sk-test-secret", customHeaders: { Authorization: "" } })).toMatchObject({ Authorization: "Bearer sk-test-secret" });
    expect(helpers.profileHasUsableAuth({ ...openaiProfile, apiKey: "", customHeaders: { "api-key": "azure-secret" } })).toBe(true);
    expect(helpers.headersForProfile({ ...openaiProfile, id: "azure-openai", apiKey: "azure-secret", customHeaders: { "api-key": "" } })).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.headersForProfile({ ...openaiProfile, apiKey: "sk-test-secret", customHeaders: { "api-key": "azure-secret" } })).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.headersForProfile({ ...openaiProfile, apiKey: "sk-test-secret", customHeaders: { "api-key": "azure-secret" } })).not.toHaveProperty("authorization");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: { "x-api-key": "" }
    })).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "",
      customHeaders: { "x-api-key": "anthropic-routed-secret" }
    })).toMatchObject({
      "x-api-key": "anthropic-routed-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "sk-test-secret",
      customHeaders: { Authorization: "Bearer routed-secret" }
    })).not.toHaveProperty("x-api-key");
    expect(helpers.headersForProfile({
      id: "anthropic-compatible",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example",
      apiKey: "anthropic-compatible-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer anthropic-compatible-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer deepseek-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.headersForProfile({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer zai-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization" }
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization", directBrowserAccess: true }
    })).toMatchObject({
      authorization: "Bearer routed-secret",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: {},
      bodyExtra: { directBrowserAccess: false }
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.profileHasUsableAuth({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:11434/v1",
      apiKey: "",
      customHeaders: {}
    })).toBe(true);
  });

  it("builds an Anthropic connection test request without duplicating v1", () => {
    const request = helpers.connectionTestRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "sk-test-secret",
      model: "model-b",
      customHeaders: {},
      bodyExtra: { metadata: { source: "settings" } }
    });

    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers).toMatchObject({
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(request.body).toMatchObject({
      model: "model-b",
      system: expect.stringContaining("connection test endpoint"),
      max_tokens: 32,
      stream: false,
      metadata: { source: "settings" },
      messages: [{ role: "user", content: "ping" }]
    });
  });

  it("builds a local-agent connection test request without API credentials", () => {
    const profile = {
      bodyExtra: {
        localAgent: {
          endpoint: "127.0.0.1:3333/mcp",
          headers: { "x-local": "1" }
        }
      }
    };
    const request = helpers.localAgentConnectionTestRequestForProfile(profile);
    const toolsRequest = helpers.localAgentToolsListRequestForProfile(profile);

    expect(helpers.isLocalAgentProfile(profile)).toBe(true);
    expect(request.url).toBe("http://127.0.0.1:3333/mcp");
    expect(request.headers).toMatchObject({ "content-type": "application/json", "x-local": "1" });
    expect(request.body).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "zotero-markdown-summary-settings" }
      }
    });
    expect(toolsRequest.url).toBe("http://127.0.0.1:3333/mcp");
    expect(toolsRequest.headers).toMatchObject({ "content-type": "application/json", "x-local": "1" });
    expect(toolsRequest.body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list"
    });
    expect(helpers.localAgentToolNamesFromResponse({
      result: { tools: [{ name: "ask_gemini" }, { name: "ask_claude" }] }
    })).toEqual(["ask_gemini", "ask_claude"]);
  });

  it("builds model-list requests for OpenAI-compatible and Anthropic profiles", () => {
    const openai = helpers.modelListRequestForProfile({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true },
      customHeaders: { "x-route": "paper" }
    });
    expect(openai.url).toBe("https://api.openai.com/v1/models");
    expect(openai.headers).toMatchObject({ authorization: "Bearer sk-test-secret", "x-route": "paper" });

    const anthropic = helpers.modelListRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true },
      customHeaders: {}
    });
    expect(anthropic.url).toBe("https://api.anthropic.com/v1/models");
    expect(anthropic.headers).toMatchObject({
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });

    const zaiAnthropic = helpers.modelListRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      capabilities: { modelList: true },
      customHeaders: {}
    });
    expect(zaiAnthropic.url).toBe("https://api.z.ai/api/anthropic/v1/models");
    expect(zaiAnthropic.headers).toMatchObject({ authorization: "Bearer zai-secret", "anthropic-version": "2023-06-01" });
    expect(zaiAnthropic.headers).not.toHaveProperty("anthropic-dangerous-direct-browser-access");

    expect(helpers.modelListRequestForProfile({
      protocol: "openai_chat",
      endpointMode: "full_url",
      baseURL: "https://example.test/custom",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true }
    })).toBeNull();
  });

  it("extracts model ids from common model-list response shapes", () => {
    expect(helpers.modelIdsFromResponse({
      data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }]
    })).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(helpers.modelIdsFromResponse({
      models: [{ name: "custom-a" }, "custom-b", { model: "custom-c" }]
    })).toEqual(["custom-a", "custom-b", "custom-c"]);
    expect(helpers.modelIdsFromResponse({
      result: { data: [{ id: "wrapped-a" }] }
    })).toEqual(["wrapped-a"]);
    expect(helpers.modelIdsFromResponse({
      payload: { models: [{ id: "wrapped-b" }] }
    })).toEqual(["wrapped-b"]);
    expect(helpers.modelIdsFromResponse({
      body: { model_list: [{ id: "wrapped-body" }] }
    })).toEqual(["wrapped-body"]);
    expect(helpers.modelIdsFromResponse({
      message: { models: { data: [{ id: "nested-models-data" }] } }
    })).toEqual(["nested-models-data"]);
    expect(helpers.modelIdsFromResponse({
      completion: { list: [{ name: "completion-list-model" }] }
    })).toEqual(["completion-list-model"]);
    expect(helpers.modelIdsFromResponse({ data: [{ id: "same" }, { id: "same" }] })).toEqual(["same"]);
    expect(helpers.modelOptionsFromResponse({
      data: [
        { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
        { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" }
      ],
      has_more: false
    })).toEqual([
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }
    ]);
  });

  it("formats settings provider errors without leaking API credentials", () => {
    const formatted = helpers.providerErrorText(401, JSON.stringify({
      error: {
        code: "invalid_api_key",
        type: "invalid_request_error",
        message: "Invalid API key sk-test-secret with Authorization: Bearer routed-secret and gsk_test-secret"
      }
    }));

    expect(formatted).toContain("HTTP 401");
    expect(formatted).toContain("invalid_api_key");
    expect(formatted).toContain("invalid_request_error");
    expect(formatted).toContain("Invalid API key [redacted]");
    expect(formatted).toContain("Bearer [redacted]");
    expect(formatted).not.toContain("sk-test-secret");
    expect(formatted).not.toContain("routed-secret");
    expect(formatted).not.toContain("gsk_test-secret");
    expect(helpers.localAgentErrorText(200, JSON.stringify({
      error: { code: "tool_failed", message: "Tool failed with Bearer local-secret" }
    }))).toBe("tool_failed - Tool failed with Bearer [redacted]");
  });

  it("provides a local-agents preset for callable local skills", () => {
    expect(helpers.providerDefaults("openai")).toMatchObject({
      protocol: "openai_responses",
      capabilities: { streaming: true, pdfBase64: true }
    });
    expect(helpers.providerDefaults("openai_compatible")).toMatchObject({
      id: "openai-compatible",
      protocol: "openai_chat",
      baseURL: "https://api.openai.com/v1",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("openai_responses_compatible")).toMatchObject({
      id: "openai-responses-compatible",
      protocol: "openai_responses",
      baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
      capabilities: { streaming: true, pdfBase64: true, modelList: true }
    });
    expect(helpers.providerDefaults("anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      capabilities: { streaming: true, pdfBase64: true }
    });
    expect(helpers.providerDefaults("anthropic_compatible")).toMatchObject({
      id: "anthropic-compatible",
      protocol: "anthropic_messages",
      baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT",
      capabilities: { streaming: true, pdfBase64: false, modelList: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(helpers.providerDefaults("github_models")).toMatchObject({
      id: "github-models",
      protocol: "openai_chat",
      baseURL: "https://models.github.ai/inference",
      customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      capabilities: { streaming: true, pdfBase64: false, modelList: false }
    });
    expect(helpers.providerDefaults("fireworks")).toMatchObject({
      id: "fireworks",
      protocol: "openai_chat",
      baseURL: "https://api.fireworks.ai/inference/v1"
    });
    expect(helpers.providerDefaults("cerebras")).toMatchObject({
      id: "cerebras",
      protocol: "openai_chat",
      baseURL: "https://api.cerebras.ai/v1"
    });
    expect(helpers.providerDefaults("nvidia_nim")).toMatchObject({
      id: "nvidia-nim",
      protocol: "openai_chat",
      baseURL: "https://integrate.api.nvidia.com/v1"
    });
    expect(helpers.providerDefaults("sambanova")).toMatchObject({
      id: "sambanova",
      protocol: "openai_chat",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(helpers.providerDefaults("sambanova_responses")).toMatchObject({
      id: "sambanova-responses",
      protocol: "openai_responses",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(helpers.providerDefaults("sambanova_anthropic")).toMatchObject({
      id: "sambanova-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.sambanova.ai/v1",
      bodyExtra: { authHeader: "authorization" }
    });
    expect(helpers.providerDefaults("xai")).toMatchObject({
      id: "xai",
      protocol: "openai_chat",
      baseURL: "https://api.x.ai/v1"
    });
    expect(helpers.providerDefaults("groq")).toMatchObject({
      id: "groq",
      protocol: "openai_chat",
      baseURL: "https://api.groq.com/openai/v1"
    });
    expect(helpers.providerDefaults("mistral")).toMatchObject({
      id: "mistral",
      protocol: "openai_chat",
      baseURL: "https://api.mistral.ai/v1"
    });
    expect(helpers.providerDefaults("together")).toMatchObject({
      id: "together",
      protocol: "openai_chat",
      baseURL: "https://api.together.ai/v1"
    });
    expect(helpers.providerDefaults("kimi")).toMatchObject({
      id: "kimi",
      protocol: "openai_chat",
      baseURL: "https://api.moonshot.ai/v1"
    });
    expect(helpers.providerDefaults("perplexity")).toMatchObject({
      id: "perplexity",
      protocol: "openai_chat",
      baseURL: "https://api.perplexity.ai",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("deepseek")).toMatchObject({
      id: "deepseek",
      protocol: "openai_chat",
      baseURL: "https://api.deepseek.com",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("deepseek_anthropic")).toMatchObject({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.deepseek.com/anthropic",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("zai_anthropic")).toMatchObject({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("openrouter")).toMatchObject({
      id: "openrouter",
      protocol: "openai_chat",
      baseURL: "https://openrouter.ai/api/v1"
    });
    expect(helpers.providerDefaults("dashscope")).toMatchObject({
      id: "dashscope",
      protocol: "openai_chat",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    expect(helpers.providerDefaults("siliconflow")).toMatchObject({
      id: "siliconflow",
      protocol: "openai_chat",
      baseURL: "https://api.siliconflow.com/v1"
    });
    expect(helpers.providerDefaults("zhipu")).toMatchObject({
      id: "zhipu",
      protocol: "openai_chat",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("volcengine")).toMatchObject({
      id: "volcengine",
      protocol: "openai_chat",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("qianfan")).toMatchObject({
      id: "qianfan",
      protocol: "openai_chat",
      baseURL: "https://qianfan.baidubce.com/v2",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("hunyuan")).toMatchObject({
      id: "hunyuan",
      protocol: "openai_chat",
      baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("ollama")).toMatchObject({
      id: "ollama",
      protocol: "openai_chat",
      baseURL: "http://localhost:11434/v1",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("lm_studio")).toMatchObject({
      id: "lm-studio",
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:1234/v1",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    const localAgentsPreset = {
      id: "local-agents",
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:3333/v1",
      capabilities: { streaming: false, modelList: false },
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          payloadMode: "jsonrpc",
          timeoutSeconds: 180,
          "ask-gemini": { tool: "ask_gemini" },
          "ask-claude": { tool: "ask_claude" },
          "ask-opencode": { tool: "ask_opencode" },
          "ask-all-agents": { tool: "ask_all_agents" },
          "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } },
          "check-local-agents": { tool: "check_local_agents" }
        }
      }
    };
    expect(helpers.providerDefaults("local_agents")).toMatchObject(localAgentsPreset);
    expect(helpers.providerDefaults("local-agents")).toMatchObject(localAgentsPreset);
  });

  it("builds restorable default provider profiles for major provider protocols", () => {
    const profiles = helpers.defaultProviderProfiles();

    expect(profiles.map((profile) => profile.id)).toEqual([
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
    ]);
    expect(profiles.map((profile) => profile.isDefault)).toEqual(profiles.map((_, index) => index === 0));
    expect(profiles.every((profile) => profile.apiKey === "")).toBe(true);
    expect(profiles.find((profile) => profile.id === "openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1"
    });
    expect(profiles.find((profile) => profile.id === "openai-compatible")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      bodyExtra: {}
    });
    expect(profiles.find((profile) => profile.id === "openai-responses-compatible")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
      bodyExtra: {}
    });
    expect(profiles.find((profile) => profile.id === "anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com"
    });
    expect(profiles.find((profile) => profile.id === "anthropic-compatible")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT",
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile) => profile.id === "gemini")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
    });
    expect(profiles.find((profile) => profile.id === "azure-openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1",
      customHeaders: {}
    });
    expect(profiles.find((profile) => profile.id === "github-models")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://models.github.ai/inference",
      customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      capabilities: { modelList: false }
    });
    expect(profiles.find((profile) => profile.id === "fireworks")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.fireworks.ai/inference/v1"
    });
    expect(profiles.find((profile) => profile.id === "cerebras")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cerebras.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "nvidia-nim")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://integrate.api.nvidia.com/v1"
    });
    expect(profiles.find((profile) => profile.id === "sambanova")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "sambanova-responses")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "sambanova-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1",
      bodyExtra: { authHeader: "authorization" }
    });
    expect(profiles.find((profile) => profile.id === "xai")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.x.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "groq")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.groq.com/openai/v1"
    });
    expect(profiles.find((profile) => profile.id === "mistral")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.mistral.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "together")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.together.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "kimi")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.moonshot.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "perplexity")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.perplexity.ai",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "deepseek")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com"
    });
    expect(profiles.find((profile) => profile.id === "deepseek-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com/anthropic"
    });
    expect(profiles.find((profile) => profile.id === "zai-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "openrouter")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://openrouter.ai/api/v1"
    });
    expect(profiles.find((profile) => profile.id === "dashscope")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    expect(profiles.find((profile) => profile.id === "siliconflow")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.siliconflow.com/v1"
    });
    expect(profiles.find((profile) => profile.id === "zhipu")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "volcengine")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "qianfan")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://qianfan.baidubce.com/v2",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "hunyuan")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "ollama")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "http://localhost:11434/v1"
    });
    expect(profiles.find((profile) => profile.id === "lm-studio")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:1234/v1"
    });
    expect(profiles.find((profile) => profile.id === "local-agents")).toMatchObject({
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          payloadMode: "jsonrpc",
          "ask-gemini": { tool: "ask_gemini" },
          "ask-claude": { tool: "ask_claude" },
          "ask-opencode": { tool: "ask_opencode" },
          "ask-all-agents": { tool: "ask_all_agents" },
          "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } },
          "check-local-agents": { tool: "check_local_agents" }
        }
      }
    });
  });

  it("merges missing default provider profiles without overwriting user profiles", () => {
    const profiles = helpers.mergeDefaultProviderProfiles([
      {
        id: "openai",
        name: "OpenAI",
        protocol: "openai_responses",
        baseURL: "https://api.openai.com/v1",
        apiKey: "kept-secret",
        model: "kept-model",
        customHeaders: { "x-route": "kept" },
        isDefault: true
      },
      {
        id: "custom-router",
        name: "Custom Router",
        protocol: "openai_chat",
        baseURL: "https://router.example/v1",
        apiKey: "custom-secret",
        isDefault: false
      }
    ]);

    expect(profiles.find((profile) => profile.id === "openai")).toMatchObject({
      apiKey: "kept-secret",
      model: "kept-model",
      customHeaders: { "x-route": "kept" },
      isDefault: true
    });
    expect(profiles.find((profile) => profile.id === "custom-router")).toMatchObject({
      apiKey: "custom-secret"
    });
    expect(profiles.map((profile) => profile.id)).toEqual(expect.arrayContaining([
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
      "local-agents"
    ]));
    expect(profiles.filter((profile) => profile.isDefault)).toHaveLength(1);
  });

  it("normalizes imported provider profiles before merging defaults", () => {
    const profiles = helpers.mergeDefaultProviderProfiles([
      {
        id: "../ Custom Router:Profile? ",
        name: "",
        protocol: "bad_protocol",
        endpointMode: "streaming_url",
        baseURL: " https://router.example/v1/responses/ ",
        apiKey: "  sk-custom  ",
        model: "  model-a  ",
        capabilities: { streaming: "false", pdfBase64: "yes", modelList: "0", jsonMode: "on" },
        customHeaders: ["broken"],
        bodyExtra: ["broken"],
        isDefault: true
      }
    ]);
    const profile = profiles[0];

    expect(profile).toMatchObject({
      id: "Custom-Router-Profile",
      name: "OpenAI Compatible Chat",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1/responses/",
      apiKey: "sk-custom",
      model: "model-a",
      customHeaders: {},
      bodyExtra: {},
      isDefault: true
    });
    expect(profile.capabilities).toMatchObject({
      streaming: false,
      pdfBase64: true,
      modelList: false,
      jsonMode: true
    });
    expect(profiles.filter((candidate) => candidate.isDefault)).toHaveLength(1);
    expect(profiles.map((candidate) => candidate.id)).toContain("openai");
  });

  it("keeps OpenAI-compatible chat profiles out of the MiniMax preset", () => {
    expect(helpers.providerFromProfile({
      id: "openai-compatible",
      protocol: "openai_chat",
      baseURL: "https://api.openai.com/v1",
      bodyExtra: {}
    })).toBe("openai_compatible");
    expect(helpers.providerFromProfile({
      id: "router",
      protocol: "openai_chat",
      baseURL: "https://router.example/v1",
      bodyExtra: {}
    })).toBe("openai_compatible");
    expect(helpers.providerFromProfile({
      id: "responses-router",
      protocol: "openai_responses",
      baseURL: "https://router.example/v1",
      bodyExtra: {}
    })).toBe("openai_responses_compatible");
    expect(helpers.providerFromProfile({
      id: "official-openai",
      protocol: "openai_responses",
      baseURL: "https://api.openai.com/v1",
      bodyExtra: {}
    })).toBe("openai");
    expect(helpers.providerFromProfile({
      id: "minimax",
      protocol: "openai_chat",
      baseURL: "https://api.minimaxi.com/v1",
      bodyExtra: { extra_body: { reasoning_split: true } }
    })).toBe("minimax");
    expect(helpers.providerFromProfile({
      id: "moonshot",
      protocol: "openai_chat",
      baseURL: "https://api.moonshot.ai/v1",
      bodyExtra: {}
    })).toBe("kimi");
    expect(helpers.providerFromProfile({
      id: "custom-perplexity",
      protocol: "openai_chat",
      baseURL: "https://api.perplexity.ai",
      bodyExtra: {}
    })).toBe("perplexity");
    expect(helpers.providerFromProfile({
      id: "custom-zai",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic/v1/messages",
      bodyExtra: {}
    })).toBe("zai_anthropic");
  });

  it("keeps local-agent skill reset templates specific to their tools", () => {
    expect(helpers.builtInSkillTemplate("figure-table-extractor", "en-US")).toContain("[image]");
    expect(helpers.builtInSkillTemplate("figure-table-extractor", "zh-CN")).toContain("图表");
    expect(helpers.builtInSkillTemplate("literature-matrix-builder", "en-US")).toContain("literature matrix");
    expect(helpers.builtInSkillTemplate("literature-matrix-builder", "zh-CN")).toContain("[paper2:<id>]");
    expect(helpers.builtInSkillTemplate("ask-all-agents", "en-US")).toContain("Gemini, Claude, and opencode");
    expect(helpers.builtInSkillTemplate("ask-gemini-claude", "en-US")).toContain("Gemini and Claude");
    expect(helpers.builtInSkillTemplate("check-local-agents", "en-US")).toContain("availability");
    expect(helpers.builtInSkillTemplate("check-local-agents", "zh-CN")).toContain("请使用中文输出。");
  });

  it("discovers custom skill templates from the output skills directory", async () => {
    const { controller, elements } = loadPreferencesController({
      skillFiles: [
        "/tmp/out/skills/roadmap-audit.md",
        "/tmp/out/skills/readme.txt",
        "/tmp/out/skills/../unsafe.md"
      ]
    });

    await controller.refreshSkillMenu();

    const values = elements.get("zms-skillId").children.map((item: any) => item.value);
    expect(values).toContain("paper-deep-summary");
    expect(values).toContain("roadmap-audit");
    expect(values).toContain("unsafe");
    expect(values).not.toContain("readme");
  });

  it("adds a newly saved custom skill back into the skill menu", async () => {
    const { controller, elements } = loadPreferencesController();
    elements.get("zms-skillId").value = " my custom/skill ";
    elements.get("zms-skillTemplate").value = "Custom skill prompt.";

    await controller.saveSkillTemplateEditor();

    expect(elements.get("zms-skillId").value).toBe("my-custom-skill");
    expect(elements.get("zms-skillId").children.map((item: any) => item.value)).toContain("my-custom-skill");
  });

  it("saves provider profiles with a normalized profile id", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "model-a" });
    elements.get("zms-activeProfileId").value = "../ My Router:OpenAI? ";
    elements.get("zms-profileName").value = "My Router OpenAI";

    controller.saveProfileFromEditor();

    const profiles = JSON.parse(elements.get("zms-profilesJson").value);
    expect(elements.get("zms-activeProfileId").value).toBe("My-Router-OpenAI");
    expect(elements.get("zms-profile-options").children.map((option: any) => option.value)).toContain("My-Router-OpenAI");
    expect(profiles[0]).toMatchObject({
      id: "My-Router-OpenAI",
      name: "My Router OpenAI",
      isDefault: true,
      protocol: "openai_responses"
    });
  });

  it("loads the active provider profile into simple and advanced editor fields", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "stale-model" });
    elements.get("zms-provider").value = "openai";
    elements.get("zms-baseURL").value = "https://api.openai.com/v1";
    elements.get("zms-apiKey").value = "stale-secret";
    elements.get("zms-activeProfileId").value = "perplexity";
    elements.get("zms-profilesJson").value = JSON.stringify([
      {
        id: "openai",
        name: "OpenAI",
        protocol: "openai_responses",
        endpointMode: "base_url",
        baseURL: "https://api.openai.com/v1",
        apiKey: "openai-secret",
        model: "openai-model",
        capabilities: { pdfBase64: true, streaming: true, modelList: true },
        customHeaders: {},
        bodyExtra: {},
        isDefault: true
      },
      {
        id: "perplexity",
        name: "Perplexity Sonar",
        protocol: "openai_chat",
        endpointMode: "base_url",
        baseURL: "https://api.perplexity.ai",
        apiKey: "perplexity-secret",
        model: "sonar-pro",
        capabilities: { pdfBase64: false, streaming: true, modelList: true },
        customHeaders: { "x-route": "sonar" },
        bodyExtra: {},
        isDefault: false
      }
    ]);

    controller.loadProfileEditor();

    expect(elements.get("zms-activeProfileId").value).toBe("perplexity");
    expect(elements.get("zms-provider").value).toBe("perplexity");
    expect(elements.get("zms-baseURL").value).toBe("https://api.perplexity.ai");
    expect(elements.get("zms-apiKey").value).toBe("perplexity-secret");
    expect(elements.get("zms-model").value).toBe("sonar-pro");
    expect(elements.get("zms-profileName").value).toBe("Perplexity Sonar");
    expect(elements.get("zms-profileProtocol").value).toBe("openai_chat");
    expect(elements.get("zms-cap-modelList").checked).toBe(true);
    expect(elements.get("zms-profileCustomHeaders").value).toContain("x-route");
  });

  it("renders provider readiness status in settings without exposing credentials", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "gpt-4.1" });
    elements.get("zms-profileCustomHeaders").value = "{\"Authorization\":\"Bearer routed-secret\"}";

    const summary = controller.refreshProfileStatus();

    expect(summary).toContain("Protocol: openai_responses");
    expect(summary).toContain("Model: gpt-4.1");
    expect(summary).toContain("Endpoint: https://api.openai.com/v1/responses");
    expect(summary).toContain("Raw PDF input supported");
    expect(summary).toContain("Authentication configured");
    expect(summary).not.toContain("sk-test-secret");
    expect(summary).not.toContain("routed-secret");
  });

  it("renders a provider setup guide with endpoint and live-check commands", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("openai"),
      apiKey: "sk-test-secret",
      model: "gpt-4.1"
    }, "en-US");

    expect(guide).toContain("Protocol: OpenAI Responses");
    expect(guide).toContain("Request endpoint: https://api.openai.com/v1/responses");
    expect(guide).toContain("OPENAI_API_KEY=...");
    expect(guide).toContain("OPENAI_MODEL=gpt-4.1");
    expect(guide).toContain("npm run verify:provider:live -- --include openai");
    expect(guide).toContain("npm run verify:provider:models:live -- --include openai");
    expect(guide).not.toContain("sk-test-secret");
  });

  it("uses compatible live-check variables for Anthropic-style routers", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("anthropic_compatible"),
      apiKey: "anthropic-secret",
      model: "claude-router",
      baseURL: "https://router.example/anthropic"
    }, "en-US");

    expect(guide).toContain("Protocol: Anthropic Messages");
    expect(guide).toContain("ANTHROPIC_COMPATIBLE_API_KEY=...");
    expect(guide).toContain("ANTHROPIC_COMPATIBLE_MODEL=claude-router");
    expect(guide).toContain("ANTHROPIC_COMPATIBLE_BASE_URL=https://router.example/anthropic");
    expect(guide).toContain("--include anthropic-compatible");
    expect(guide).not.toContain("anthropic-secret");
  });

  it("treats local OpenAI-compatible endpoints as API-key optional in setup guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("openai_compatible"),
      baseURL: "http://127.0.0.1:11434/v1",
      apiKey: "",
      model: "qwen3"
    }, "en-US");

    expect(guide).toContain("Local endpoint; API key is usually optional");
    expect(guide).toContain("OPENAI_COMPATIBLE_MODEL=qwen3");
    expect(guide).toContain("OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1");
    expect(guide).toContain("--include openai-compatible");
    expect(guide).not.toContain("OPENAI_COMPATIBLE_API_KEY=...");
  });

  it("uses named live-check variables for GitHub Models setup guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("github_models"),
      apiKey: "github-model-secret",
      model: "openai/gpt-4.1-mini"
    }, "en-US");

    expect(guide).toContain("Active profile: GitHub Models");
    expect(guide).toContain("GITHUB_MODELS_API_KEY=...");
    expect(guide).toContain("GITHUB_MODELS_MODEL=openai/gpt-4.1-mini");
    expect(guide).toContain("--include github-models");
    expect(guide).not.toContain("GITHUB_MODELS_BASE_URL=");
    expect(guide).not.toContain("github-model-secret");
  });

  it("includes edited Base URL for named provider live-check commands", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("github_models"),
      baseURL: "https://router.example/github/inference",
      model: "openai/gpt-4.1-mini"
    }, "en-US");

    expect(guide).toContain("GITHUB_MODELS_BASE_URL=https://router.example/github/inference");
    expect(guide).toContain("--include github-models");
  });

  it("uses named live-check variables and bearer auth for SambaNova Anthropic guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("sambanova_anthropic"),
      apiKey: "sambanova-anthropic-secret",
      model: "Meta-Llama-3.1-8B-Instruct"
    }, "en-US");

    expect(guide).toContain("Protocol: Anthropic Messages");
    expect(guide).toContain("Auth: API key is sent as Authorization: Bearer.");
    expect(guide).toContain("SAMBANOVA_ANTHROPIC_API_KEY=...");
    expect(guide).toContain("SAMBANOVA_ANTHROPIC_MODEL=Meta-Llama-3.1-8B-Instruct");
    expect(guide).toContain("--include sambanova-anthropic");
    expect(guide).not.toContain("sambanova-anthropic-secret");
  });

  it("uses named live-check variables for older built-in OpenAI-compatible providers", () => {
    const helpers = loadPreferencesHelpers();
    const deepseekGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("deepseek"),
      apiKey: "deepseek-secret",
      model: "deepseek-chat"
    }, "en-US");
    const openrouterGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("openrouter"),
      apiKey: "openrouter-secret",
      model: "openai/gpt-4.1-mini"
    }, "en-US");
    const groqGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("groq"),
      apiKey: "groq-secret",
      model: "llama-3.3-70b-versatile"
    }, "en-US");

    expect(deepseekGuide).toContain("DEEPSEEK_API_KEY=...");
    expect(deepseekGuide).toContain("DEEPSEEK_MODEL=deepseek-chat");
    expect(deepseekGuide).toContain("--include deepseek");
    expect(deepseekGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(deepseekGuide).not.toContain("deepseek-secret");
    expect(openrouterGuide).toContain("OPENROUTER_API_KEY=...");
    expect(openrouterGuide).toContain("OPENROUTER_MODEL=openai/gpt-4.1-mini");
    expect(openrouterGuide).toContain("--include openrouter");
    expect(openrouterGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(openrouterGuide).not.toContain("openrouter-secret");
    expect(groqGuide).toContain("GROQ_API_KEY=...");
    expect(groqGuide).toContain("GROQ_MODEL=llama-3.3-70b-versatile");
    expect(groqGuide).toContain("--include groq");
    expect(groqGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(groqGuide).not.toContain("groq-secret");
  });

  it("uses named live-check variables for MiniMax, Gemini, and Azure guides", () => {
    const helpers = loadPreferencesHelpers();
    const minimaxGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("minimax"),
      apiKey: "minimax-secret",
      model: "MiniMax-M2.7-highspeed"
    }, "en-US");
    const geminiGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("gemini"),
      apiKey: "gemini-secret",
      model: "gemini-2.5-flash"
    }, "en-US");
    const azureGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("azure_openai"),
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      model: "gpt-4.1"
    }, "en-US");

    expect(minimaxGuide).toContain("MINIMAX_API_KEY=...");
    expect(minimaxGuide).toContain("MINIMAX_MODEL=MiniMax-M2.7-highspeed");
    expect(minimaxGuide).toContain("--include minimax");
    expect(minimaxGuide).not.toContain("minimax-secret");
    expect(geminiGuide).toContain("GEMINI_API_KEY=...");
    expect(geminiGuide).toContain("GEMINI_MODEL=gemini-2.5-flash");
    expect(geminiGuide).toContain("--include gemini");
    expect(geminiGuide).not.toContain("gemini-secret");
    expect(azureGuide).toContain("AZURE_OPENAI_API_KEY=...");
    expect(azureGuide).toContain("AZURE_OPENAI_MODEL=gpt-4.1");
    expect(azureGuide).toContain("AZURE_OPENAI_BASE_URL=https://example-resource.openai.azure.com/openai/v1");
    expect(azureGuide).toContain("--include azure-openai");
    expect(azureGuide).not.toContain("azure-secret");
  });

  it("updates the settings provider guide from edited fields", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "gpt-4.1" });
    elements.get("zms-profileCustomHeaders").value = "{\"Authorization\":\"Bearer routed-secret\"}";

    const guide = controller.refreshProviderGuide();

    expect(guide).toContain("Active profile: OpenAI");
    expect(guide).toContain("Request endpoint: https://api.openai.com/v1/responses");
    expect(guide).toContain("OPENAI_API_KEY=...");
    expect(elements.get("zms-providerGuide").textContent).toBe(guide);
    expect(guide).not.toContain("sk-test-secret");
    expect(guide).not.toContain("routed-secret");
  });

  it("saves edited API key and model into the active provider profile", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "old-model" });
    elements.get("zms-profilesJson").value = JSON.stringify([
      {
        id: "openai",
        name: "OpenAI",
        protocol: "openai_responses",
        endpointMode: "base_url",
        baseURL: "https://api.openai.com/v1",
        apiKey: "old-secret",
        model: "old-model",
        capabilities: { pdfBase64: true, imageBase64: true, streaming: true, modelList: true },
        customHeaders: {},
        bodyExtra: {},
        isDefault: true
      }
    ]);
    elements.get("zms-apiKey").value = "new-secret";
    elements.get("zms-model").value = "new-model";
    elements.get("zms-baseURL").value = "https://new.example/v1";

    expect(controller.save()).toBe(true);

    const profiles = JSON.parse(elements.get("zms-profilesJson").value);
    expect(profiles[0]).toMatchObject({
      id: "openai",
      apiKey: "new-secret",
      model: "new-model",
      baseURL: "https://new.example/v1",
      isDefault: true
    });
  });

  it("marks local-agent settings profiles as model-optional", () => {
    const { controller, elements } = loadPreferencesController();
    elements.get("zms-activeProfileId").value = "local-agents";
    elements.get("zms-profileName").value = "Local Agents";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "http://127.0.0.1:3333/v1";
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";
    elements.get("zms-profileLocalAgentEnabled").checked = true;
    elements.get("zms-profileLocalAgentEndpoint").value = "127.0.0.1:3333/mcp";
    elements.get("zms-cap-pdfBase64").checked = false;
    elements.get("zms-cap-streaming").checked = false;

    const summary = controller.refreshProfileStatus();

    expect(summary).toContain("Model: Optional");
    expect(summary).toContain("Authentication configured");
    expect(summary).toContain("Local agent configured");
    expect(summary).toContain("Text input only");
  });

  it("restores damaged provider profiles to the default profile set", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "damaged-model" });
    elements.get("zms-activeProfileId").value = "../broken";
    elements.get("zms-provider").value = "custom";
    elements.get("zms-baseURL").value = "https://broken.example/v1";
    elements.get("zms-apiKey").value = "should-be-cleared";
    elements.get("zms-profilesJson").value = "[{\"id\":\"broken\",\"apiKey\":\"should-be-cleared\",\"isDefault\":true}]";

    controller.resetProfilesToDefaults();

    const profiles = JSON.parse(elements.get("zms-profilesJson").value);
    expect(elements.get("zms-activeProfileId").value).toBe("minimax");
    expect(elements.get("zms-profile-options").children.map((option: any) => option.value)).toEqual([
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
    ]);
    expect(elements.get("zms-provider").value).toBe("minimax");
    expect(elements.get("zms-baseURL").value).toBe("https://api.minimaxi.com/v1");
    expect(elements.get("zms-apiKey").value).toBe("");
    expect(elements.get("zms-status").value).toBe("Default provider profiles restored");
    expect(profiles.map((profile: any) => profile.id)).toEqual([
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
    ]);
    expect(profiles.every((profile: any) => profile.apiKey === "")).toBe(true);
    expect(profiles[0]).toMatchObject({
      id: "minimax",
      isDefault: true,
      protocol: "openai_chat"
    });
  });

  it("loads model options into the settings datalist and fills an empty model field", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponse: {
        data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }]
      }
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/models");
    expect(fetchCalls[0].init).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer sk-test-secret", "x-route": "paper" }
    });
    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(elements.get("zms-model").value).toBe("model-a");
    expect(elements.get("zms-status").value).toBe("Models loaded: 2");
  });

  it("keeps an existing model when refreshing model options", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "manual-model",
      fetchResponse: { models: ["model-a", "model-b"] }
    });

    await controller.loadModels();

    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(elements.get("zms-model").value).toBe("manual-model");
  });

  it("renders model display names from Anthropic-compatible model lists", async () => {
    const { controller, elements } = loadPreferencesController({
      fetchResponse: {
        data: [
          { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
          { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" }
        ],
        has_more: false
      }
    });
    elements.get("zms-profileProtocol").value = "anthropic_messages";
    elements.get("zms-baseURL").value = "https://api.anthropic.com";
    elements.get("zms-profileCustomHeaders").value = "{}";

    await controller.loadModels();

    const options = elements.get("zms-model-options").children;
    expect(options.map((option: any) => option.value)).toEqual(["claude-opus-4-8", "claude-sonnet-4-5"]);
    expect(options.map((option: any) => option.label)).toEqual(["Claude Opus 4.8", "Claude Sonnet 4.5"]);
    expect(elements.get("zms-model").value).toBe("claude-opus-4-8");
  });

  it("follows bounded model-list pagination cursors in settings", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          data: [{ id: "model-b" }],
          has_more: true,
          last_id: "model-b"
        },
        {
          data: [{ id: "model-c" }, { id: "model-a" }],
          has_more: false
        }
      ]
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/models");
    expect(fetchCalls[1].url).toBe("https://api.openai.com/v1/models?after_id=model-b");
    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toEqual(["model-a", "model-b", "model-c"]);
    expect(elements.get("zms-status").value).toBe("Models loaded: 3");
  });

  it("loads wrapped model-list pages in settings", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          result: {
            data: [{ id: "model-b" }],
            has_more: true,
            last_id: "model-b"
          }
        },
        {
          payload: {
            models: [{ id: "model-a", display_name: "Model A" }]
          }
        }
      ]
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].url).toBe("https://api.openai.com/v1/models?after_id=model-b");
    const options = elements.get("zms-model-options").children;
    expect(options.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(options.find((option: any) => option.value === "model-a")?.label).toBe("Model A");
    expect(elements.get("zms-status").value).toBe("Models loaded: 2");
  });

  it("loads body-wrapped model-list pages in settings", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          body: {
            models: {
              data: [{ id: "model-b" }]
            },
            has_more: true,
            last_id: "model-b"
          }
        },
        {
          message: {
            model_list: [{ id: "model-a", display_name: "Model A" }]
          }
        }
      ]
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].url).toBe("https://api.openai.com/v1/models?after_id=model-b");
    const options = elements.get("zms-model-options").children;
    expect(options.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(options.find((option: any) => option.value === "model-a")?.label).toBe("Model A");
  });

  it("loads model options with a custom authorization header and empty API key", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponse: { data: [{ id: "model-a" }] }
    });
    elements.get("zms-apiKey").value = "";
    elements.get("zms-profileCustomHeaders").value = "{\"Authorization\":\"Bearer routed-secret\"}";

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].init.headers).toMatchObject({ Authorization: "Bearer routed-secret" });
    expect(fetchCalls[0].init.headers).not.toHaveProperty("authorization");
    expect(elements.get("zms-status").value).toBe("Models loaded: 1");
  });

  it("shows parsed provider errors when a settings connection test fails", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "model-a",
      fetchOk: false,
      fetchStatus: 401,
      fetchResponse: {
        error: {
          code: "invalid_api_key",
          type: "invalid_request_error",
          message: "Invalid API key sk-test-secret"
        }
      }
    });

    await controller.testConnection();

    expect(elements.get("zms-status").value).toContain("Connection failed: HTTP 401");
    expect(elements.get("zms-status").value).toContain("invalid_api_key");
    expect(elements.get("zms-status").value).toContain("invalid_request_error");
    expect(elements.get("zms-status").value).toContain("Invalid API key [redacted]");
    expect(elements.get("zms-status").value).not.toContain("sk-test-secret");
  });

  it("marks settings connection tests OK only after extracting model text", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponse: {
        output: [
          {
            content: [
              { type: "reasoning", text: "hidden" },
              { type: "output_text", text: "pong" }
            ]
          }
        ]
      }
    });

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("fails settings connection tests when a 200 response still contains a provider error", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponse: {
        body: {
          error: {
            code: "invalid_api_key",
            type: "authentication_error",
            message: "Invalid API key sk-test-secret"
          }
        }
      }
    });

    await controller.testConnection();

    expect(elements.get("zms-status").value).toContain("Connection failed: Provider error");
    expect(elements.get("zms-status").value).toContain("invalid_api_key");
    expect(elements.get("zms-status").value).toContain("authentication_error");
    expect(elements.get("zms-status").value).toContain("Invalid API key [redacted]");
    expect(elements.get("zms-status").value).not.toContain("sk-test-secret");
  });

  it("fails settings connection tests when a 200 response has no model text", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponse: { data: [] }
    });

    await controller.testConnection();

    expect(elements.get("zms-status").value).toBe("Connection failed: No text returned from model");
  });

  it("extracts provider connection text variants from settings test responses", () => {
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      choices: [{ message: { content: [{ type: "reasoning", text: "hidden" }, { type: "text", text: "chat ok" }] } }]
    }))).toBe("chat ok");
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      response: { output: [{ content: [{ type: "output_text", text: "responses ok" }] }] }
    }))).toBe("responses ok");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      data: { choices: [{ message: { content: "wrapped chat ok" } }] }
    }))).toBe("wrapped chat ok");
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      result: { output_text: "wrapped responses ok" }
    }))).toBe("wrapped responses ok");
    expect(helpers.extractProviderConnectionText("anthropic_messages", JSON.stringify({
      content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "anthropic ok" }]
    }))).toBe("anthropic ok");
    expect(helpers.extractProviderConnectionText("anthropic_messages", JSON.stringify({
      data: { content: [{ type: "text", text: "wrapped anthropic ok" }] }
    }))).toBe("wrapped anthropic ok");
    expect(helpers.extractProviderConnectionText("openai_chat", [
      "data: {\"choices\":[{\"delta\":{\"content\":\"stream \"}}]}",
      "",
      "data: {\"choices\":[{\"delta\":{\"content\":\"chat\"}}]}",
      "data: [DONE]"
    ].join("\n"))).toBe("stream chat");
    expect(helpers.extractProviderConnectionText("openai_responses", [
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"stream \"}",
      "",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"responses\"}",
      "data: [DONE]"
    ].join("\n"))).toBe("stream responses");
    expect(helpers.extractProviderConnectionText("anthropic_messages", [
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"stream \"}}",
      "",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"anthropic\"}}"
    ].join("\n"))).toBe("stream anthropic");
    expect(() => helpers.extractProviderConnectionText("openai_chat", [
      "data: {\"type\":\"error\",\"error\":{\"code\":\"rate_limit\",\"message\":\"Too many requests for sk-test-secret\"}}"
    ].join("\n"))).toThrow("Too many requests for [redacted]");
    expect(() => helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      completion: { error: { code: "invalid_api_key", message: "Bad key sk-test-secret" } }
    }))).toThrow("invalid_api_key - Bad key [redacted]");
  });

  it("shows parsed provider errors when model listing fails", async () => {
    const { controller, elements } = loadPreferencesController({
      fetchOk: false,
      fetchStatus: 429,
      fetchResponse: {
        error: {
          code: "rate_limit_exceeded",
          type: "rate_limit_error",
          message: "Too many requests for Bearer routed-secret"
        }
      }
    });

    await controller.loadModels();

    expect(elements.get("zms-status").value).toContain("Connection failed: HTTP 429");
    expect(elements.get("zms-status").value).toContain("rate_limit_exceeded");
    expect(elements.get("zms-status").value).toContain("rate_limit_error");
    expect(elements.get("zms-status").value).toContain("Bearer [redacted]");
    expect(elements.get("zms-status").value).not.toContain("routed-secret");
  });

  it("shows provider errors when a 200 model-list response contains an error body", async () => {
    const { controller, elements } = loadPreferencesController({
      fetchResponse: {
        error: {
          code: "invalid_api_key",
          type: "authentication_error",
          message: "Invalid API key sk-test-secret"
        }
      }
    });

    await controller.loadModels();

    expect(elements.get("zms-status").value).toContain("Connection failed: Provider error");
    expect(elements.get("zms-status").value).toContain("invalid_api_key");
    expect(elements.get("zms-status").value).toContain("authentication_error");
    expect(elements.get("zms-status").value).toContain("Invalid API key [redacted]");
    expect(elements.get("zms-status").value).not.toContain("sk-test-secret");
  });

  it("does not test a stale saved profile when edited profile JSON is invalid", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({ initialModel: "model-a" });
    elements.get("zms-profileCustomHeaders").value = "{";

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(0);
    expect(elements.get("zms-status").value).toBe("Invalid JSON");
  });

  it("does not load models from a stale saved profile when edited profile JSON is invalid", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController();
    elements.get("zms-profileBodyExtra").value = "{";

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(0);
    expect(elements.get("zms-status").value).toBe("Invalid JSON");
  });

  it("tests local-agent profiles through the MCP endpoint without requiring API key or model", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          result: {
            serverInfo: { name: "local-agent-mcp" }
          }
        },
        {
          result: {
            tools: [
              { name: "ask_gemini" },
              { name: "ask_claude" },
              { name: "ask_opencode" },
              { name: "ask_all_agents" },
              { name: "check_local_agents" }
            ]
          }
        }
      ]
    });
    elements.get("zms-activeProfileId").value = "local-agents";
    elements.get("zms-profileName").value = "Local Agents";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "http://127.0.0.1:3333/v1";
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";
    elements.get("zms-profileLocalAgentEnabled").checked = true;
    elements.get("zms-profileLocalAgentEndpoint").value = "127.0.0.1:3333/mcp";
    elements.get("zms-cap-modelList").checked = false;

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toBe("http://127.0.0.1:3333/mcp");
    expect(JSON.parse(fetchCalls[0].init.body)).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize"
    });
    expect(JSON.parse(fetchCalls[1].init.body)).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list"
    });
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("fails local-agent settings tests when required MCP tools are not registered", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          result: {
            serverInfo: { name: "local-agent-mcp" }
          }
        },
        {
          result: {
            tools: [
              { name: "ask_gemini" },
              { name: "ask_claude" }
            ]
          }
        }
      ]
    });
    elements.get("zms-activeProfileId").value = "local-agents";
    elements.get("zms-profileName").value = "Local Agents";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "http://127.0.0.1:3333/v1";
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";
    elements.get("zms-profileLocalAgentEnabled").checked = true;
    elements.get("zms-profileLocalAgentEndpoint").value = "127.0.0.1:3333/mcp";
    elements.get("zms-cap-modelList").checked = false;

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(elements.get("zms-status").value).toContain("Connection failed");
    expect(elements.get("zms-status").value).toContain("ask_opencode");
    expect(elements.get("zms-status").value).toContain("ask_all_agents");
    expect(elements.get("zms-status").value).toContain("check_local_agents");
  });
});
