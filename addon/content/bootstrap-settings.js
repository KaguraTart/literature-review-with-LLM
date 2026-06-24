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
    promptPackId: pref("promptPackId") || "general",
    systemPrompt: pref("systemPrompt") || SYSTEM_PROMPT,
    userPrompt: pref("userPrompt") || USER_PROMPT
  };
}

function settingsProviderDefaults(provider) {
  return withSettingsDefaultProviderModel(provider, settingsProviderDefaultsRaw(provider));
}

function settingsProviderDefaultsRaw(provider) {
  const id = String(provider || "openai_compatible").trim();
  const commonCapabilities = { text: true, pdfBase64: false, imageBase64: false, fileReference: false, streaming: true, embeddings: false, jsonMode: false, toolUse: false, modelList: true };
  const imageCapabilities = { ...commonCapabilities, imageBase64: true };
  const common = { endpointMode: "base_url", fullURL: "", model: "", customHeaders: {}, bodyExtra: {} };
  if (id === "openai") {
    return { ...common, protocol: "openai_responses", baseURL: "https://api.openai.com/v1", capabilities: { ...imageCapabilities, pdfBase64: true } };
  }
  if (id === "openai_responses_compatible" || id === "openai-responses-compatible") {
    return { ...common, protocol: "openai_responses", baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1", capabilities: { ...imageCapabilities, pdfBase64: true } };
  }
  if (id === "anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://api.anthropic.com", capabilities: { ...imageCapabilities, pdfBase64: true } };
  }
  if (id === "anthropic_compatible" || id === "anthropic-compatible") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT", capabilities: commonCapabilities, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "azure_openai" || id === "azure-openai") {
    return { ...common, protocol: "openai_responses", baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1", capabilities: { ...imageCapabilities, pdfBase64: true } };
  }
  if (id === "vercel_ai_chat" || id === "vercel-ai-chat" || id === "vercel_ai_gateway" || id === "vercel-ai-gateway") {
    return { ...common, protocol: "openai_chat", baseURL: "https://ai-gateway.vercel.sh/v1", capabilities: { ...imageCapabilities, pdfBase64: false } };
  }
  if (id === "vercel_ai_responses" || id === "vercel-ai-responses") {
    return { ...common, protocol: "openai_responses", baseURL: "https://ai-gateway.vercel.sh/v1", capabilities: { ...imageCapabilities, pdfBase64: true } };
  }
  if (id === "vercel_ai_anthropic" || id === "vercel-ai-anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://ai-gateway.vercel.sh", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "cline_api" || id === "cline-api") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.cline.bot/api/v1", capabilities: { ...imageCapabilities, pdfBase64: false } };
  }
  if (id === "litellm_proxy_chat" || id === "litellm-proxy-chat") {
    return { ...common, protocol: "openai_chat", baseURL: "http://localhost:4000", capabilities: { ...imageCapabilities, pdfBase64: false } };
  }
  if (id === "litellm_proxy_responses" || id === "litellm-proxy-responses") {
    return { ...common, protocol: "openai_responses", baseURL: "http://localhost:4000", capabilities: { ...imageCapabilities, pdfBase64: true } };
  }
  if (id === "litellm_proxy_anthropic" || id === "litellm-proxy-anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "http://localhost:4000", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "perplexity") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.perplexity.ai", capabilities: commonCapabilities };
  }
  if (id === "zhipu" || id === "glm" || id === "bigmodel") {
    return { ...common, protocol: "openai_chat", baseURL: "https://open.bigmodel.cn/api/paas/v4", capabilities: commonCapabilities };
  }
  if (id === "volcengine" || id === "ark" || id === "doubao") {
    return { ...common, protocol: "openai_chat", baseURL: "https://ark.cn-beijing.volces.com/api/v3", capabilities: commonCapabilities };
  }
  if (id === "qianfan" || id === "baidu") {
    return { ...common, protocol: "openai_chat", baseURL: "https://qianfan.baidubce.com/v2", capabilities: commonCapabilities };
  }
  if (id === "hunyuan" || id === "tencent") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.hunyuan.cloud.tencent.com/v1", capabilities: commonCapabilities };
  }
  if (id === "gemini") {
    return { ...common, protocol: "openai_chat", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", capabilities: imageCapabilities };
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
    return { ...common, protocol: "anthropic_messages", baseURL: "https://api.z.ai/api/anthropic", capabilities: commonCapabilities };
  }
  if (id === "github_models" || id === "github-models") {
    return { ...common, protocol: "openai_chat", baseURL: "https://models.github.ai/inference", capabilities: { ...commonCapabilities, modelList: false }, customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } };
  }
  if (id === "huggingface" || id === "hugging_face" || id === "hf") {
    return { ...common, protocol: "openai_chat", baseURL: "https://router.huggingface.co/v1", capabilities: imageCapabilities };
  }
  if (id === "cloudflare_ai_chat" || id === "cloudflare-ai-chat" || id === "cloudflare_workers_ai" || id === "cloudflare-workers-ai") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "cloudflare_ai_responses" || id === "cloudflare-ai-responses") {
    return { ...common, protocol: "openai_responses", baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1", capabilities: { ...commonCapabilities, modelList: false } };
  }
  if (id === "cloudflare_ai_anthropic" || id === "cloudflare-ai-anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1", capabilities: { ...commonCapabilities, modelList: false }, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "deepinfra" || id === "deep_infra") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.deepinfra.com/v1/openai", capabilities: imageCapabilities };
  }
  if (id === "fireworks") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.fireworks.ai/inference/v1", capabilities: commonCapabilities };
  }
  if (id === "cerebras") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.cerebras.ai/v1", capabilities: commonCapabilities };
  }
  if (id === "nvidia_nim" || id === "nvidia-nim") {
    return { ...common, protocol: "openai_chat", baseURL: "https://integrate.api.nvidia.com/v1", capabilities: commonCapabilities };
  }
  if (id === "sambanova") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.sambanova.ai/v1", capabilities: commonCapabilities };
  }
  if (id === "sambanova_responses" || id === "sambanova-responses") {
    return { ...common, protocol: "openai_responses", baseURL: "https://api.sambanova.ai/v1", capabilities: commonCapabilities };
  }
  if (id === "sambanova_anthropic" || id === "sambanova-anthropic") {
    return { ...common, protocol: "anthropic_messages", baseURL: "https://api.sambanova.ai/v1", capabilities: commonCapabilities, bodyExtra: { authHeader: "authorization" } };
  }
  if (id === "minimax") {
    return { ...common, protocol: "openai_chat", baseURL: "https://api.minimaxi.com/v1", capabilities: commonCapabilities, bodyExtra: { extra_body: { reasoning_split: true } } };
  }
  if (id === "local_agents" || id === "local-agents") {
    return {
      ...common,
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:3333/v1",
      capabilities: { ...commonCapabilities, imageBase64: false, streaming: false, modelList: false },
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
          "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } },
          "extract-pdf-pages": { tool: "extract_pdf_pages" }
        }
      }
    };
  }
  return { ...common, protocol: "openai_chat", baseURL: "https://api.openai.com/v1", capabilities: commonCapabilities };
}

function withSettingsDefaultProviderModel(provider, defaults) {
  const current = String(defaults?.model || "").trim();
  if (current) return defaults;
  const model = settingsRecommendedDefaultModel(provider, defaults);
  return model ? { ...defaults, model } : defaults;
}

function settingsRecommendedDefaultModel(provider, defaults = {}) {
  const key = String(settingsProviderCanonicalId(defaults?.id || provider || "")).replace(/-/g, "_");
  if (key === "azure_openai" || key === "local_agents") return "";
  if (typeof zmsRecommendedDefaultModelForProvider === "function") {
    const model = zmsRecommendedDefaultModelForProvider(key, { id: key });
    if (model) return model;
  }
  const models = {
    minimax: "MiniMax-M3",
    openai: "gpt-5.4-mini",
    openai_compatible: "gpt-5.4-mini",
    openai_responses_compatible: "gpt-5.4-mini",
    anthropic: "claude-sonnet-4-6",
    anthropic_compatible: "claude-sonnet-4-6",
    gemini: "gemini-3.1-pro",
    vercel_ai_chat: "openai/gpt-5.4-mini",
    vercel_ai_responses: "openai/gpt-5.4-mini",
    vercel_ai_anthropic: "anthropic/claude-sonnet-4.6",
    cline_api: "anthropic/claude-sonnet-4-6",
    litellm_proxy_chat: "openai/gpt-4o-mini",
    litellm_proxy_responses: "openai/gpt-4o-mini",
    litellm_proxy_anthropic: "anthropic/claude-sonnet-4-6",
    cloudflare_ai_chat: "@cf/meta/llama-3.1-8b-instruct",
    cloudflare_ai_responses: "@cf/meta/llama-3.1-8b-instruct",
    cloudflare_ai_anthropic: "@cf/meta/llama-3.1-8b-instruct",
    github_models: "openai/gpt-5.4-mini",
    huggingface: "meta-llama/Llama-3.1-8B-Instruct",
    deepinfra: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    fireworks: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    cerebras: "llama-4-scout-17b-16e-instruct",
    nvidia_nim: "meta/llama-3.1-70b-instruct",
    sambanova: "Meta-Llama-3.1-70B-Instruct",
    sambanova_responses: "Meta-Llama-3.1-70B-Instruct",
    sambanova_anthropic: "Meta-Llama-3.1-70B-Instruct",
    xai: "grok-3",
    groq: "llama-3.3-70b-versatile",
    mistral: "mistral-large-latest",
    together: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    kimi: "moonshot-v1-8k",
    perplexity: "sonar",
    deepseek: "deepseek-v4-flash",
    deepseek_anthropic: "deepseek-v4-flash",
    zai_anthropic: "glm-4.5",
    openrouter: "openai/gpt-5.4-mini",
    dashscope: "qwen3-max",
    siliconflow: "deepseek-ai/DeepSeek-V3",
    zhipu: "glm-4-plus",
    volcengine: "doubao-seed-1-6",
    qianfan: "ernie-4.0-turbo-8k",
    hunyuan: "hunyuan-turbos-latest",
    ollama: "llama3.2",
    lm_studio: "local-model"
  };
  return models[key] || "";
}

function settingsProviderCanonicalId(value) {
  const id = String(value || "").trim();
  if (id === "openai-compatible" || id === "openai_compatible") return "openai_compatible";
  if (id === "openai-responses-compatible" || id === "openai_responses_compatible") return "openai_responses_compatible";
  if (id === "anthropic-compatible" || id === "anthropic_compatible") return "anthropic_compatible";
  if (id === "azure-openai" || id === "azure_openai") return "azure_openai";
  if (id === "vercel-ai-chat" || id === "vercel_ai_chat" || id === "vercel-ai-gateway" || id === "vercel_ai_gateway") return "vercel_ai_chat";
  if (id === "vercel-ai-responses" || id === "vercel_ai_responses") return "vercel_ai_responses";
  if (id === "vercel-ai-anthropic" || id === "vercel_ai_anthropic") return "vercel_ai_anthropic";
  if (id === "cline-api" || id === "cline_api") return "cline_api";
  if (id === "litellm-proxy-chat" || id === "litellm_proxy_chat") return "litellm_proxy_chat";
  if (id === "litellm-proxy-responses" || id === "litellm_proxy_responses") return "litellm_proxy_responses";
  if (id === "litellm-proxy-anthropic" || id === "litellm_proxy_anthropic") return "litellm_proxy_anthropic";
  if (id === "cloudflare-ai-chat" || id === "cloudflare_ai_chat" || id === "cloudflare-workers-ai" || id === "cloudflare_workers_ai") return "cloudflare_ai_chat";
  if (id === "cloudflare-ai-responses" || id === "cloudflare_ai_responses") return "cloudflare_ai_responses";
  if (id === "cloudflare-ai-anthropic" || id === "cloudflare_ai_anthropic") return "cloudflare_ai_anthropic";
  if (id === "github-models" || id === "github_models") return "github_models";
  if (id === "hugging_face" || id === "hf") return "huggingface";
  if (id === "deep_infra") return "deepinfra";
  if (id === "nvidia-nim" || id === "nvidia_nim") return "nvidia_nim";
  if (id === "sambanova-responses" || id === "sambanova_responses") return "sambanova_responses";
  if (id === "sambanova-anthropic" || id === "sambanova_anthropic") return "sambanova_anthropic";
  if (id === "moonshot") return "kimi";
  if (id === "deepseek-anthropic" || id === "deepseek_anthropic") return "deepseek_anthropic";
  if (id === "zai-anthropic" || id === "zai_anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") return "zai_anthropic";
  if (id === "glm" || id === "bigmodel") return "zhipu";
  if (id === "ark" || id === "doubao") return "volcengine";
  if (id === "baidu") return "qianfan";
  if (id === "tencent") return "hunyuan";
  if (id === "lm-studio" || id === "lm_studio") return "lm_studio";
  if (id === "local-agents" || id === "local_agents") return "local_agents";
  return id.replace(/-/g, "_");
}

function settingsProviderFromProfile(profile) {
  if (profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent) return "local-agents";
  const id = String(profile?.id || "").trim();
  if (["minimax", "openai", "openai-responses-compatible", "openai_responses_compatible", "anthropic", "anthropic-compatible", "anthropic_compatible", "openai-compatible", "openai_compatible", "gemini", "azure-openai", "azure_openai", "vercel-ai-chat", "vercel_ai_chat", "vercel-ai-gateway", "vercel_ai_gateway", "vercel-ai-responses", "vercel_ai_responses", "vercel-ai-anthropic", "vercel_ai_anthropic", "cline-api", "cline_api", "litellm-proxy-chat", "litellm_proxy_chat", "litellm-proxy-responses", "litellm_proxy_responses", "litellm-proxy-anthropic", "litellm_proxy_anthropic", "cloudflare-ai-chat", "cloudflare_ai_chat", "cloudflare-workers-ai", "cloudflare_workers_ai", "cloudflare-ai-responses", "cloudflare_ai_responses", "cloudflare-ai-anthropic", "cloudflare_ai_anthropic", "github-models", "github_models", "huggingface", "hugging_face", "hf", "deepinfra", "deep_infra", "fireworks", "cerebras", "nvidia-nim", "nvidia_nim", "sambanova", "sambanova-responses", "sambanova_responses", "sambanova-anthropic", "sambanova_anthropic", "xai", "groq", "mistral", "together", "kimi", "moonshot", "perplexity", "deepseek", "deepseek-anthropic", "deepseek_anthropic", "zai-anthropic", "zai_anthropic", "z_ai_anthropic", "z-ai-anthropic", "openrouter", "dashscope", "qwen", "siliconflow", "zhipu", "glm", "bigmodel", "volcengine", "ark", "doubao", "qianfan", "baidu", "hunyuan", "tencent", "ollama", "lm-studio", "lm_studio"].includes(id)) {
    if (id === "azure-openai") return "azure_openai";
    if (id === "vercel-ai-chat" || id === "vercel_ai_gateway" || id === "vercel-ai-gateway") return "vercel_ai_chat";
    if (id === "vercel-ai-responses") return "vercel_ai_responses";
    if (id === "vercel-ai-anthropic") return "vercel_ai_anthropic";
    if (id === "cline-api") return "cline_api";
    if (id === "litellm-proxy-chat") return "litellm_proxy_chat";
    if (id === "litellm-proxy-responses") return "litellm_proxy_responses";
    if (id === "litellm-proxy-anthropic") return "litellm_proxy_anthropic";
    if (id === "cloudflare-ai-chat" || id === "cloudflare_workers_ai" || id === "cloudflare-workers-ai") return "cloudflare_ai_chat";
    if (id === "cloudflare-ai-responses") return "cloudflare_ai_responses";
    if (id === "cloudflare-ai-anthropic") return "cloudflare_ai_anthropic";
    if (id === "github-models") return "github_models";
    if (id === "hugging_face" || id === "hf") return "huggingface";
    if (id === "deep_infra") return "deepinfra";
    if (id === "nvidia-nim") return "nvidia_nim";
    if (id === "sambanova-responses") return "sambanova_responses";
    if (id === "sambanova-anthropic") return "sambanova_anthropic";
    if (id === "anthropic-compatible") return "anthropic_compatible";
    if (id === "openai-responses-compatible") return "openai_responses_compatible";
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
  if (baseURL === "https://ai-gateway.vercel.sh/v1" || baseURL === "https://ai-gateway.vercel.sh/v1/chat/completions" || baseURL === "https://ai-gateway.vercel.sh/v1/responses") {
    if (profile?.protocol === "openai_responses") return "vercel_ai_responses";
    if (profile?.protocol === "anthropic_messages") return "vercel_ai_anthropic";
    return "vercel_ai_chat";
  }
  if (baseURL === "https://ai-gateway.vercel.sh" || baseURL === "https://ai-gateway.vercel.sh/v1/messages") {
    if (profile?.protocol === "anthropic_messages") return "vercel_ai_anthropic";
  }
  if (baseURL === "https://api.cline.bot/api/v1" || baseURL === "https://api.cline.bot/api/v1/chat/completions") return "cline_api";
  if (baseURL === "http://localhost:4000" || baseURL === "http://localhost:4000/v1" || baseURL === "http://localhost:4000/v1/chat/completions" || baseURL === "http://localhost:4000/v1/responses" || baseURL === "http://localhost:4000/v1/messages" || baseURL === "http://127.0.0.1:4000" || baseURL === "http://127.0.0.1:4000/v1" || baseURL === "http://127.0.0.1:4000/v1/chat/completions" || baseURL === "http://127.0.0.1:4000/v1/responses" || baseURL === "http://127.0.0.1:4000/v1/messages") {
    if (profile?.protocol === "openai_responses") return "litellm_proxy_responses";
    if (profile?.protocol === "anthropic_messages") return "litellm_proxy_anthropic";
    return "litellm_proxy_chat";
  }
  if (/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai\/v1(?:\/(?:chat\/completions|responses|messages))?$/i.test(baseURL)) {
    if (profile?.protocol === "openai_responses") return "cloudflare_ai_responses";
    if (profile?.protocol === "anthropic_messages") return "cloudflare_ai_anthropic";
    return "cloudflare_ai_chat";
  }
  if (baseURL === "https://router.huggingface.co/v1" || baseURL === "https://router.huggingface.co/v1/chat/completions") return "huggingface";
  if (baseURL === "https://api.deepinfra.com/v1/openai" || baseURL === "https://api.deepinfra.com/v1/openai/chat/completions") return "deepinfra";
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
  if (profile?.protocol === "openai_responses") {
    return baseURL === "https://api.openai.com/v1" || baseURL === "https://api.openai.com/v1/responses"
      ? "openai"
      : "openai_responses_compatible";
  }
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
  const id = normalizeSettingsProfileId(source.id || provider || "custom");
  return {
    ...source,
    id,
    protocol: normalizeProviderProtocol(source.protocol, defaults.protocol || "openai_chat"),
    endpointMode: normalizeEndpointMode(source.endpointMode, defaults.endpointMode || "base_url"),
    baseURL: String(source.baseURL || pref("baseURL") || defaults.baseURL || "").trim(),
    fullURL: String(source.fullURL || defaults.fullURL || "").trim(),
    apiKey: String(source.apiKey || "").trim(),
    model: String(source.model || (shouldUseSettingsDefaultProviderModelForProfile(source, provider) ? defaults.model : "") || "").trim(),
    customHeaders: normalizeObjectStringMap(source.customHeaders) || {},
    bodyExtra: normalizeObjectStringMap(source.bodyExtra) || normalizeObjectStringMap(defaults.bodyExtra) || {},
    capabilities: normalizeProviderCapabilities(source.capabilities, defaults.capabilities || {}),
    isDefault: source.isDefault === true
  };
}

function shouldUseSettingsDefaultProviderModelForProfile(source, provider) {
  const sourceId = String(source?.id || "").trim();
  if (!sourceId) return true;
  const sourceKey = settingsProviderCanonicalId(sourceId);
  const providerKey = settingsProviderCanonicalId(provider);
  return !!sourceKey && sourceKey === providerKey && defaultSettingsProviderIds().includes(sourceKey);
}

function defaultSettingsProviderIds() {
  return [
    "minimax",
    "openai",
    "openai_compatible",
    "openai_responses_compatible",
    "anthropic",
    "anthropic_compatible",
    "gemini",
    "azure_openai",
    "vercel_ai_chat",
    "vercel_ai_responses",
    "vercel_ai_anthropic",
    "cline_api",
    "litellm_proxy_chat",
    "litellm_proxy_responses",
    "litellm_proxy_anthropic",
    "cloudflare_ai_chat",
    "cloudflare_ai_responses",
    "cloudflare_ai_anthropic",
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
