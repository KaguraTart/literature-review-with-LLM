function getSettings() {
  const profile = normalizedActiveProfile();
  const provider = profile ? settingsProviderFromProfile(profile) : (pref("provider") || "openai_compatible");
  const defaults = settingsProviderDefaults(provider);
  const fallbackBaseURL = String(pref("baseURL") || defaults.baseURL || "").trim();
  return {
    provider,
    protocol: profile?.protocol || defaults.protocol,
    endpointMode: profile?.endpointMode || defaults.endpointMode,
    baseURL: String(profile?.baseURL || fallbackBaseURL).replace(/\/+$/, ""),
    fullURL: profile?.fullURL || defaults.fullURL || "",
    apiKey: profile ? profile.apiKey : pref("apiKey"),
    model: profile ? profile.model : (pref("model") || defaults.model || ""),
    customHeaders: normalizeObjectStringMap(profile?.customHeaders) || normalizeObjectStringMap(defaults.customHeaders) || {},
    bodyExtra: normalizeObjectStringMap(profile?.bodyExtra) || defaults.bodyExtra,
    capabilities: {
      ...defaults.capabilities,
      ...(profile?.capabilities || {})
    },
    outputDir: pref("outputDir"),
    inputMode: pref("inputMode"),
    maxOutputTokens: Number(pref("maxOutputTokens")) || 8192,
    temperature: Number(pref("temperature")),
    stream: !!pref("stream") && (profile?.capabilities?.streaming !== false),
    summaryVersion: pref("summaryVersion") || "1",
    outputLanguage: pref("outputLanguage") || "zh-CN",
    systemPrompt: pref("systemPrompt") || SYSTEM_PROMPT,
    userPrompt: pref("userPrompt") || USER_PROMPT
  };
}

function settingsProviderDefaults(provider) {
  const id = String(provider || "openai_compatible").trim();
  const commonCapabilities = { text: true, pdfBase64: false, fileReference: false, streaming: true, embeddings: false, jsonMode: false, toolUse: false, modelList: true };
  const common = { endpointMode: "base_url", fullURL: "", model: "", customHeaders: {}, bodyExtra: {} };
  if (id === "openai") {
    return { ...common, protocol: "openai_responses", baseURL: "https://api.openai.com/v1", capabilities: { ...commonCapabilities, pdfBase64: true } };
  }
  if (id === "anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://api.anthropic.com", capabilities: { ...commonCapabilities, pdfBase64: true } };
  }
  if (id === "azure_openai" || id === "azure-openai") {
    return { ...common, protocol: "openai_responses", baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1", capabilities: { ...commonCapabilities, pdfBase64: true } };
  }
  if (id === "perplexity") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.perplexity.ai", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "zhipu" || id === "glm" || id === "bigmodel") {
    return { ...common, protocol: "openai_chat", baseURL: "https://open.bigmodel.cn/api/paas/v4", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "volcengine" || id === "ark" || id === "doubao") {
    return { ...common, protocol: "openai_chat", baseURL: "https://ark.cn-beijing.volces.com/api/v3", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "qianfan" || id === "baidu") {
    return { ...common, protocol: "openai_chat", baseURL: "https://qianfan.baidubce.com/v2", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "hunyuan" || id === "tencent") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.hunyuan.cloud.tencent.com/v1", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "gemini") {
    return { ...common, protocol: "openai_chat", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", capabilities: commonCapabilities };
  }
  if (id === "xai") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.x.ai/v1", capabilities: commonCapabilities };
  }
  if (id === "groq") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.groq.com/openai/v1", capabilities: commonCapabilities };
  }
  if (id === "mistral") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.mistral.ai/v1", capabilities: commonCapabilities };
  }
  if (id === "together") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.together.ai/v1", capabilities: commonCapabilities };
  }
  if (id === "kimi" || id === "moonshot") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.moonshot.ai/v1", capabilities: commonCapabilities };
  }
  if (id === "deepseek") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.deepseek.com", capabilities: commonCapabilities };
  }
  if (id === "openrouter") {
    return { ...common, protocol: "openai_chat", baseURL: "https://openrouter.ai/api/v1", capabilities: commonCapabilities };
  }
  if (id === "dashscope" || id === "qwen") {
    return { ...common, protocol: "openai_chat", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", capabilities: commonCapabilities };
  }
  if (id === "siliconflow") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.siliconflow.com/v1", capabilities: commonCapabilities };
  }
  if (id === "ollama") {
    return { ...common, protocol: "openai_chat", baseURL: "http://localhost:11434/v1", capabilities: commonCapabilities };
  }
  if (id === "lm_studio" || id === "lm-studio") {
    return { ...common, protocol: "openai_chat", baseURL: "http://127.0.0.1:1234/v1", capabilities: commonCapabilities };
  }
  if (id === "deepseek_anthropic" || id === "deepseek-anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://api.deepseek.com/anthropic", capabilities: commonCapabilities };
  }
  if (id === "zai_anthropic" || id === "zai-anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://api.z.ai/api/anthropic", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "minimax") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", capabilities: commonCapabilities, bodyExtra: { extra_body: { reasoning_split: true } } };
  }
  if (id === "local_agents" || id === "local-agents") {
    return {
      ...common,
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:3333/v1",
      capabilities: { ...commonCapabilities, streaming: false, modelList: false },
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
          "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } }
        }
      }
    };
  }
  return { ...common, protocol: "openai_chat", baseURL: "https://api.openai.com/v1", capabilities: commonCapabilities };
}

function settingsProviderFromProfile(profile) {
  if (profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent) return "local-agents";
  const id = String(profile?.id || "").trim();
  if (["minimax", "openai", "anthropic", "openai-compatible", "openai_compatible", "gemini", "azure-openai", "azure_openai", "xai", "groq", "mistral", "together", "kimi", "moonshot", "perplexity", "deepseek", "deepseek-anthropic", "deepseek_anthropic", "zai-anthropic", "zai_anthropic", "z_ai_anthropic", "z-ai-anthropic", "openrouter", "dashscope", "qwen", "siliconflow", "zhipu", "glm", "bigmodel", "volcengine", "ark", "doubao", "qianfan", "baidu", "hunyuan", "tencent", "ollama", "lm-studio", "lm_studio"].includes(id)) {
    if (id === "azure-openai") return "azure_openai";
    if (id === "moonshot") return "kimi";
    if (id === "glm" || id === "bigmodel") return "zhipu";
    if (id === "ark" || id === "doubao") return "volcengine";
    if (id === "baidu") return "qianfan";
    if (id === "tencent") return "hunyuan";
    if (id === "lm-studio") return "lm_studio";
    if (id === "zai-anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") return "zai_anthropic";
    return id;
  }
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  if (baseURL === "https://api.minimaxi.com/v1") return "minimax";
  if (baseURL === "https://generativelanguage.googleapis.com/v1beta/openai") return "gemini";
  if (/^https:\/\/[^/]+\.openai\.azure\.com\/openai\/v1$/i.test(baseURL) || /^https:\/\/[^/]+\.services\.ai\.azure\.com\/openai\/v1$/i.test(baseURL)) return "azure_openai";
  if (baseURL === "https://api.x.ai/v1") return "xai";
  if (baseURL === "https://api.groq.com/openai/v1") return "groq";
  if (baseURL === "https://api.mistral.ai/v1") return "mistral";
  if (baseURL === "https://api.together.ai/v1") return "together";
  if (baseURL === "https://api.moonshot.ai/v1") return "kimi";
  if (baseURL === "https://api.perplexity.ai") return "perplexity";
  if (baseURL === "https://api.deepseek.com") return "deepseek";
  if (baseURL === "https://api.deepseek.com/anthropic") return "deepseek_anthropic";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL === "https://api.z.ai/api/anthropic/v1" || baseURL === "https://api.z.ai/api/anthropic/v1/messages") return "zai_anthropic";
  if (baseURL === "https://openrouter.ai/api/v1") return "openrouter";
  if (baseURL === "https://dashscope.aliyuncs.com/compatible-mode/v1") return "dashscope";
  if (baseURL === "https://api.siliconflow.com/v1" || baseURL === "https://api.siliconflow.cn/v1") return "siliconflow";
  if (baseURL === "https://open.bigmodel.cn/api/paas/v4" || baseURL === "https://api.z.ai/api/paas/v4") return "zhipu";
  if (baseURL === "https://ark.cn-beijing.volces.com/api/v3") return "volcengine";
  if (baseURL === "https://qianfan.baidubce.com/v2" || baseURL === "https://qianfan.bj.baidubce.com/v2") return "qianfan";
  if (baseURL === "https://api.hunyuan.cloud.tencent.com/v1") return "hunyuan";
  if (baseURL === "http://localhost:11434/v1" || baseURL === "http://127.0.0.1:11434/v1") return "ollama";
  if (baseURL === "http://localhost:1234/v1" || baseURL === "http://127.0.0.1:1234/v1") return "lm_studio";
  if (profile?.protocol === "anthropic_messages") return "anthropic";
  if (profile?.protocol === "openai_responses") return "openai";
  return "openai-compatible";
}

function settingsHasUsableAuth(settings) {
  if (String(settings?.apiKey || "").trim()) return true;
  const headers = settings?.customHeaders || {};
  if (hasExplicitAuthHeader(headers)) return true;
  const localAgentEndpoint = typeof localAgentEndpointForProfile === "function" ? localAgentEndpointForProfile(settings) : "";
  if (isLocalEndpoint(localAgentEndpoint)) return true;
  const endpoint = settings?.endpointMode === "full_url" ? (settings.fullURL || settings.baseURL) : settings?.baseURL;
  return isLocalEndpoint(endpoint);
}

function isLocalEndpoint(url) {
  const value = String(url || "").trim().toLowerCase();
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(?::|\/|$)/.test(value);
}

function pref(key) {
  return Zotero.Prefs.get(`${PREF_PREFIX}.${key}`, true);
}

function activeProfile() {
  try {
    const profiles = JSON.parse(pref("profilesJson") || "[]");
    const activeProfileId = pref("activeProfileId");
    if (!Array.isArray(profiles)) return null;
    return profiles.find((profile) => profile.id === activeProfileId)
      || profiles.find((profile) => profile.isDefault)
      || profiles[0]
      || null;
  } catch (_err) {
    return null;
  }
}

function normalizedActiveProfile() {
  const profile = activeProfile();
  return profile ? normalizeSettingsProfile(profile) : null;
}

function normalizeSettingsProfile(profile) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const provider = settingsProviderFromProfile(source);
  const defaults = settingsProviderDefaults(provider);
  return {
    ...source,
    id: normalizeSettingsProfileId(source.id || provider || "custom"),
    protocol: normalizeProviderProtocol(source.protocol, defaults.protocol || "openai_chat"),
    endpointMode: normalizeEndpointMode(source.endpointMode, defaults.endpointMode || "base_url"),
    baseURL: String(source.baseURL || pref("baseURL") || defaults.baseURL || "").trim(),
    fullURL: String(source.fullURL || defaults.fullURL || "").trim(),
    apiKey: String(source.apiKey || "").trim(),
    model: String(source.model || defaults.model || "").trim(),
    customHeaders: normalizeObjectStringMap(source.customHeaders) || {},
    bodyExtra: normalizeObjectStringMap(source.bodyExtra) || normalizeObjectStringMap(defaults.bodyExtra) || {},
    capabilities: normalizeProviderCapabilities(source.capabilities, defaults.capabilities || {}),
    isDefault: source.isDefault === true
  };
}

function normalizeProviderProtocol(value, fallback) {
  const protocol = String(value || "").trim();
  return ["openai_chat", "openai_responses", "anthropic_messages"].includes(protocol)
    ? protocol
    : fallback;
}

function normalizeEndpointMode(value, fallback) {
  const mode = String(value || "").trim();
  if (mode === "full_url" || mode === "base_url") return mode;
  return fallback === "full_url" ? "full_url" : "base_url";
}

function normalizeProviderCapabilities(value, defaults) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const keys = new Set([...Object.keys(defaults || {}), ...Object.keys(raw)]);
  const result = {};
  for (const key of keys) {
    result[key] = normalizeBoolean(raw[key], !!defaults?.[key]);
  }
  return result;
}

function normalizeObjectStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined).map(([key, candidate]) => [String(key), candidate]));
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "yes", "on"].includes(lowered)) return true;
    if (["false", "no", "off"].includes(lowered)) return false;
  }
  return fallback;
}

function normalizeSettingsProfileId(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
