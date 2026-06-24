(function initProviderModelCatalog(root) {
  const MODEL_CATALOG = {
    minimax: [["MiniMax-M2.7", "MiniMax-M2.7"], ["MiniMax-M2.7-highspeed", "MiniMax-M2.7 highspeed"], ["MiniMax-M1", "MiniMax-M1"]],
    openai: [["gpt-4.1", "GPT-4.1"], ["gpt-4.1-mini", "GPT-4.1 mini"], ["gpt-4o", "GPT-4o"], ["gpt-4o-mini", "GPT-4o mini"], ["o3", "o3"], ["o4-mini", "o4-mini"]],
    openai_compatible: [["gpt-4.1-mini", "GPT-4.1 mini"], ["gpt-4o-mini", "GPT-4o mini"], ["deepseek-chat", "DeepSeek chat"], ["qwen-plus", "Qwen plus"]],
    openai_responses_compatible: [["gpt-4.1", "GPT-4.1"], ["gpt-4.1-mini", "GPT-4.1 mini"], ["gpt-4o", "GPT-4o"]],
    anthropic: [["claude-sonnet-4-20250514", "Claude Sonnet 4"], ["claude-3-5-sonnet-latest", "Claude 3.5 Sonnet latest"], ["claude-3-5-haiku-latest", "Claude 3.5 Haiku latest"]],
    anthropic_compatible: [["claude-sonnet-4-20250514", "Claude Sonnet 4"], ["claude-3-5-sonnet-latest", "Claude 3.5 Sonnet latest"]],
    gemini: [["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"], ["gemini-2.0-flash", "Gemini 2.0 Flash"]],
    azure_openai: [["gpt-4.1", "GPT-4.1 deployment"], ["gpt-4.1-mini", "GPT-4.1 mini deployment"], ["gpt-4o", "GPT-4o deployment"]],
    vercel_ai_chat: [["openai/gpt-4.1-mini", "OpenAI GPT-4.1 mini"], ["anthropic/claude-sonnet-4", "Anthropic Claude Sonnet 4"], ["google/gemini-2.5-flash", "Google Gemini 2.5 Flash"]],
    vercel_ai_responses: [["openai/gpt-4.1-mini", "OpenAI GPT-4.1 mini"], ["openai/gpt-4.1", "OpenAI GPT-4.1"]],
    vercel_ai_anthropic: [["anthropic/claude-sonnet-4", "Anthropic Claude Sonnet 4"], ["anthropic/claude-3-5-haiku", "Anthropic Claude 3.5 Haiku"]],
    cloudflare_ai_chat: [["@cf/meta/llama-3.1-8b-instruct", "Cloudflare Llama 3.1 8B"], ["@cf/qwen/qwen1.5-14b-chat-awq", "Cloudflare Qwen 1.5 14B"]],
    cloudflare_ai_responses: [["@cf/meta/llama-3.1-8b-instruct", "Cloudflare Llama 3.1 8B"]],
    cloudflare_ai_anthropic: [["@cf/meta/llama-3.1-8b-instruct", "Cloudflare Llama 3.1 8B"]],
    github_models: [["openai/gpt-4.1", "OpenAI GPT-4.1"], ["openai/gpt-4.1-mini", "OpenAI GPT-4.1 mini"], ["mistral-ai/mistral-medium-2505", "Mistral Medium"]],
    huggingface: [["meta-llama/Llama-3.1-8B-Instruct", "Llama 3.1 8B Instruct"], ["Qwen/Qwen2.5-72B-Instruct", "Qwen2.5 72B Instruct"], ["mistralai/Mistral-7B-Instruct-v0.3", "Mistral 7B Instruct"]],
    deepinfra: [["meta-llama/Meta-Llama-3.1-70B-Instruct", "Llama 3.1 70B Instruct"], ["Qwen/Qwen2.5-72B-Instruct", "Qwen2.5 72B Instruct"], ["deepseek-ai/DeepSeek-V3", "DeepSeek V3"]],
    fireworks: [["accounts/fireworks/models/llama-v3p1-70b-instruct", "Llama 3.1 70B Instruct"], ["accounts/fireworks/models/deepseek-v3", "DeepSeek V3"]],
    cerebras: [["llama-4-scout-17b-16e-instruct", "Llama 4 Scout"], ["llama3.1-8b", "Llama 3.1 8B"]],
    nvidia_nim: [["meta/llama-3.1-70b-instruct", "Llama 3.1 70B Instruct"], ["nvidia/llama-3.1-nemotron-70b-instruct", "Nemotron 70B"]],
    sambanova: [["Meta-Llama-3.1-70B-Instruct", "Llama 3.1 70B Instruct"], ["DeepSeek-R1", "DeepSeek R1"]],
    sambanova_responses: [["Meta-Llama-3.1-70B-Instruct", "Llama 3.1 70B Instruct"]],
    sambanova_anthropic: [["Meta-Llama-3.1-70B-Instruct", "Llama 3.1 70B Instruct"]],
    xai: [["grok-3", "Grok 3"], ["grok-3-mini", "Grok 3 mini"], ["grok-2-vision-1212", "Grok 2 Vision"]],
    groq: [["llama-3.3-70b-versatile", "Llama 3.3 70B Versatile"], ["llama-3.1-8b-instant", "Llama 3.1 8B Instant"], ["deepseek-r1-distill-llama-70b", "DeepSeek R1 Distill Llama 70B"]],
    mistral: [["mistral-large-latest", "Mistral Large"], ["mistral-small-latest", "Mistral Small"], ["pixtral-large-latest", "Pixtral Large"]],
    together: [["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B Turbo"], ["deepseek-ai/DeepSeek-V3", "DeepSeek V3"], ["Qwen/Qwen2.5-72B-Instruct-Turbo", "Qwen2.5 72B Turbo"]],
    kimi: [["moonshot-v1-8k", "Moonshot v1 8k"], ["moonshot-v1-32k", "Moonshot v1 32k"], ["moonshot-v1-128k", "Moonshot v1 128k"]],
    perplexity: [["sonar", "Sonar"], ["sonar-pro", "Sonar Pro"], ["sonar-reasoning", "Sonar Reasoning"]],
    deepseek: [["deepseek-chat", "DeepSeek Chat"], ["deepseek-reasoner", "DeepSeek Reasoner"]],
    deepseek_anthropic: [["deepseek-chat", "DeepSeek Chat"], ["deepseek-reasoner", "DeepSeek Reasoner"]],
    zai_anthropic: [["glm-4.5", "GLM 4.5"], ["glm-4.5-air", "GLM 4.5 Air"]],
    openrouter: [["openai/gpt-4.1-mini", "OpenAI GPT-4.1 mini"], ["anthropic/claude-sonnet-4", "Anthropic Claude Sonnet 4"], ["google/gemini-2.5-pro", "Google Gemini 2.5 Pro"], ["deepseek/deepseek-chat-v3", "DeepSeek Chat V3"]],
    dashscope: [["qwen-plus", "Qwen Plus"], ["qwen-max", "Qwen Max"], ["qwen-turbo", "Qwen Turbo"], ["qwen-vl-plus", "Qwen VL Plus"]],
    siliconflow: [["deepseek-ai/DeepSeek-V3", "DeepSeek V3"], ["deepseek-ai/DeepSeek-R1", "DeepSeek R1"], ["Qwen/Qwen2.5-72B-Instruct", "Qwen2.5 72B Instruct"]],
    zhipu: [["glm-4-plus", "GLM-4 Plus"], ["glm-4-air", "GLM-4 Air"], ["glm-4v-plus", "GLM-4V Plus"]],
    volcengine: [["doubao-seed-1-6", "Doubao Seed 1.6"], ["doubao-1-5-pro-32k", "Doubao 1.5 Pro 32K"], ["doubao-1-5-lite-32k", "Doubao 1.5 Lite 32K"]],
    qianfan: [["ernie-4.0-turbo-8k", "ERNIE 4.0 Turbo"], ["ernie-3.5-8k", "ERNIE 3.5 8K"]],
    hunyuan: [["hunyuan-turbos-latest", "Hunyuan Turbos"], ["hunyuan-large", "Hunyuan Large"]],
    ollama: [["llama3.2", "Llama 3.2"], ["qwen2.5", "Qwen2.5"], ["deepseek-r1", "DeepSeek R1"]],
    lm_studio: [["local-model", "Local model"]],
    local_agents: [["local-agents", "Local agents"]]
  };

  function providerModelCatalogKey(provider) {
    return String(provider || "").trim().replace(/-/g, "_");
  }

  function recommendedModelOptionsForProviderCatalog(provider) {
    const key = providerModelCatalogKey(provider);
    const fallback = key.includes("anthropic")
      ? MODEL_CATALOG.anthropic_compatible
      : (key.includes("responses") ? MODEL_CATALOG.openai_responses_compatible : MODEL_CATALOG.openai_compatible);
    return (MODEL_CATALOG[key] || fallback || []).map(([id, label]) => ({ id, label }));
  }

  function recommendedDefaultModelForProviderCatalog(provider, defaults) {
    const key = providerModelCatalogKey(defaults?.id || provider);
    if (key === "azure_openai" || key === "local_agents") return "";
    return recommendedModelOptionsForProviderCatalog(key)[0]?.id || "";
  }

  root.zmsProviderModelCatalog = MODEL_CATALOG;
  root.zmsRecommendedModelOptionsForProvider = recommendedModelOptionsForProviderCatalog;
  root.zmsRecommendedDefaultModelForProvider = recommendedDefaultModelForProviderCatalog;
})(typeof globalThis !== "undefined" ? globalThis : window);
