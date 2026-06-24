#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runProviderModels, runProviderSmoke } from "./verify-provider-smoke.mjs";
import { endpointFor, modelsEndpointFor } from "../src/providerAdapters.ts";

const DEFAULT_CASES = [
  {
    id: "openai",
    label: "OpenAI Responses",
    profile: "openai",
    protocol: "openai_responses",
    apiKeyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    baseURLEnv: "OPENAI_BASE_URL",
    headersEnv: "OPENAI_HEADERS_JSON",
    bodyExtraEnv: "OPENAI_BODY_EXTRA_JSON",
    requireBaseURL: false
  },
  {
    id: "openai-responses-compatible",
    label: "OpenAI-compatible Responses",
    profile: "openai-responses-compatible",
    protocol: "openai_responses",
    apiKeyEnv: "OPENAI_RESPONSES_COMPATIBLE_API_KEY",
    modelEnv: "OPENAI_RESPONSES_COMPATIBLE_MODEL",
    baseURLEnv: "OPENAI_RESPONSES_COMPATIBLE_BASE_URL",
    headersEnv: "OPENAI_RESPONSES_COMPATIBLE_HEADERS_JSON",
    bodyExtraEnv: "OPENAI_RESPONSES_COMPATIBLE_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true
  },
  {
    id: "anthropic",
    label: "Anthropic Messages",
    profile: "anthropic",
    protocol: "anthropic_messages",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    baseURLEnv: "ANTHROPIC_BASE_URL",
    headersEnv: "ANTHROPIC_HEADERS_JSON",
    bodyExtraEnv: "ANTHROPIC_BODY_EXTRA_JSON",
    requireBaseURL: false
  },
  {
    id: "anthropic-compatible",
    label: "Anthropic-compatible Messages",
    profile: "anthropic-compatible",
    protocol: "anthropic_messages",
    apiKeyEnv: "ANTHROPIC_COMPATIBLE_API_KEY",
    modelEnv: "ANTHROPIC_COMPATIBLE_MODEL",
    baseURLEnv: "ANTHROPIC_COMPATIBLE_BASE_URL",
    headersEnv: "ANTHROPIC_COMPATIBLE_HEADERS_JSON",
    bodyExtraEnv: "ANTHROPIC_COMPATIBLE_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible Chat",
    profile: "openai-compatible",
    protocol: "openai_chat",
    apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
    modelEnv: "OPENAI_COMPATIBLE_MODEL",
    baseURLEnv: "OPENAI_COMPATIBLE_BASE_URL",
    headersEnv: "OPENAI_COMPATIBLE_HEADERS_JSON",
    bodyExtraEnv: "OPENAI_COMPATIBLE_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true
  },
  {
    id: "minimax",
    label: "MiniMax",
    profile: "minimax",
    protocol: "openai_chat",
    apiKeyEnv: "MINIMAX_API_KEY",
    modelEnv: "MINIMAX_MODEL",
    baseURLEnv: "MINIMAX_BASE_URL",
    headersEnv: "MINIMAX_HEADERS_JSON",
    bodyExtraEnv: "MINIMAX_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "gemini",
    label: "Gemini OpenAI-compatible",
    profile: "gemini",
    protocol: "openai_chat",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    baseURLEnv: "GEMINI_BASE_URL",
    headersEnv: "GEMINI_HEADERS_JSON",
    bodyExtraEnv: "GEMINI_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    profile: "azure-openai",
    protocol: "openai_responses",
    apiKeyEnv: "AZURE_OPENAI_API_KEY",
    modelEnv: "AZURE_OPENAI_MODEL",
    baseURLEnv: "AZURE_OPENAI_BASE_URL",
    headersEnv: "AZURE_OPENAI_HEADERS_JSON",
    bodyExtraEnv: "AZURE_OPENAI_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true
  },
  {
    id: "vercel-ai-chat",
    label: "Vercel AI Gateway Chat",
    profile: "vercel-ai-chat",
    protocol: "openai_chat",
    apiKeyEnv: "VERCEL_AI_API_KEY",
    modelEnv: "VERCEL_AI_MODEL",
    baseURLEnv: "VERCEL_AI_BASE_URL",
    headersEnv: "VERCEL_AI_HEADERS_JSON",
    bodyExtraEnv: "VERCEL_AI_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "vercel-ai-responses",
    label: "Vercel AI Gateway Responses",
    profile: "vercel-ai-responses",
    protocol: "openai_responses",
    apiKeyEnv: "VERCEL_AI_RESPONSES_API_KEY",
    modelEnv: "VERCEL_AI_RESPONSES_MODEL",
    baseURLEnv: "VERCEL_AI_RESPONSES_BASE_URL",
    headersEnv: "VERCEL_AI_RESPONSES_HEADERS_JSON",
    bodyExtraEnv: "VERCEL_AI_RESPONSES_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "vercel-ai-anthropic",
    label: "Vercel AI Gateway Anthropic",
    profile: "vercel-ai-anthropic",
    protocol: "anthropic_messages",
    apiKeyEnv: "VERCEL_AI_ANTHROPIC_API_KEY",
    modelEnv: "VERCEL_AI_ANTHROPIC_MODEL",
    baseURLEnv: "VERCEL_AI_ANTHROPIC_BASE_URL",
    headersEnv: "VERCEL_AI_ANTHROPIC_HEADERS_JSON",
    bodyExtraEnv: "VERCEL_AI_ANTHROPIC_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "cloudflare-ai-chat",
    label: "Cloudflare AI OpenAI Chat",
    profile: "cloudflare-ai-chat",
    protocol: "openai_chat",
    apiKeyEnv: "CLOUDFLARE_API_KEY",
    modelEnv: "CLOUDFLARE_MODEL",
    baseURLEnv: "CLOUDFLARE_BASE_URL",
    headersEnv: "CLOUDFLARE_HEADERS_JSON",
    bodyExtraEnv: "CLOUDFLARE_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true,
    modelList: false
  },
  {
    id: "cloudflare-ai-responses",
    label: "Cloudflare AI Responses",
    profile: "cloudflare-ai-responses",
    protocol: "openai_responses",
    apiKeyEnv: "CLOUDFLARE_RESPONSES_API_KEY",
    modelEnv: "CLOUDFLARE_RESPONSES_MODEL",
    baseURLEnv: "CLOUDFLARE_RESPONSES_BASE_URL",
    headersEnv: "CLOUDFLARE_RESPONSES_HEADERS_JSON",
    bodyExtraEnv: "CLOUDFLARE_RESPONSES_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true,
    modelList: false
  },
  {
    id: "cloudflare-ai-anthropic",
    label: "Cloudflare AI Anthropic",
    profile: "cloudflare-ai-anthropic",
    protocol: "anthropic_messages",
    apiKeyEnv: "CLOUDFLARE_ANTHROPIC_API_KEY",
    modelEnv: "CLOUDFLARE_ANTHROPIC_MODEL",
    baseURLEnv: "CLOUDFLARE_ANTHROPIC_BASE_URL",
    headersEnv: "CLOUDFLARE_ANTHROPIC_HEADERS_JSON",
    bodyExtraEnv: "CLOUDFLARE_ANTHROPIC_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true,
    modelList: false
  },
  {
    id: "github-models",
    label: "GitHub Models",
    profile: "github-models",
    protocol: "openai_chat",
    apiKeyEnv: "GITHUB_MODELS_API_KEY",
    modelEnv: "GITHUB_MODELS_MODEL",
    baseURLEnv: "GITHUB_MODELS_BASE_URL",
    headersEnv: "GITHUB_MODELS_HEADERS_JSON",
    bodyExtraEnv: "GITHUB_MODELS_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true,
    modelList: false
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    profile: "huggingface",
    protocol: "openai_chat",
    apiKeyEnv: "HUGGINGFACE_API_KEY",
    modelEnv: "HUGGINGFACE_MODEL",
    baseURLEnv: "HUGGINGFACE_BASE_URL",
    headersEnv: "HUGGINGFACE_HEADERS_JSON",
    bodyExtraEnv: "HUGGINGFACE_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    profile: "deepinfra",
    protocol: "openai_chat",
    apiKeyEnv: "DEEPINFRA_API_KEY",
    modelEnv: "DEEPINFRA_MODEL",
    baseURLEnv: "DEEPINFRA_BASE_URL",
    headersEnv: "DEEPINFRA_HEADERS_JSON",
    bodyExtraEnv: "DEEPINFRA_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    profile: "fireworks",
    protocol: "openai_chat",
    apiKeyEnv: "FIREWORKS_API_KEY",
    modelEnv: "FIREWORKS_MODEL",
    baseURLEnv: "FIREWORKS_BASE_URL",
    headersEnv: "FIREWORKS_HEADERS_JSON",
    bodyExtraEnv: "FIREWORKS_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "cerebras",
    label: "Cerebras",
    profile: "cerebras",
    protocol: "openai_chat",
    apiKeyEnv: "CEREBRAS_API_KEY",
    modelEnv: "CEREBRAS_MODEL",
    baseURLEnv: "CEREBRAS_BASE_URL",
    headersEnv: "CEREBRAS_HEADERS_JSON",
    bodyExtraEnv: "CEREBRAS_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    profile: "nvidia-nim",
    protocol: "openai_chat",
    apiKeyEnv: "NVIDIA_NIM_API_KEY",
    modelEnv: "NVIDIA_NIM_MODEL",
    baseURLEnv: "NVIDIA_NIM_BASE_URL",
    headersEnv: "NVIDIA_NIM_HEADERS_JSON",
    bodyExtraEnv: "NVIDIA_NIM_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "sambanova",
    label: "SambaNova Chat",
    profile: "sambanova",
    protocol: "openai_chat",
    apiKeyEnv: "SAMBANOVA_API_KEY",
    modelEnv: "SAMBANOVA_MODEL",
    baseURLEnv: "SAMBANOVA_BASE_URL",
    headersEnv: "SAMBANOVA_HEADERS_JSON",
    bodyExtraEnv: "SAMBANOVA_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "sambanova-responses",
    label: "SambaNova Responses",
    profile: "sambanova-responses",
    protocol: "openai_responses",
    apiKeyEnv: "SAMBANOVA_RESPONSES_API_KEY",
    modelEnv: "SAMBANOVA_RESPONSES_MODEL",
    baseURLEnv: "SAMBANOVA_RESPONSES_BASE_URL",
    headersEnv: "SAMBANOVA_RESPONSES_HEADERS_JSON",
    bodyExtraEnv: "SAMBANOVA_RESPONSES_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "sambanova-anthropic",
    label: "SambaNova Anthropic",
    profile: "sambanova-anthropic",
    protocol: "anthropic_messages",
    apiKeyEnv: "SAMBANOVA_ANTHROPIC_API_KEY",
    modelEnv: "SAMBANOVA_ANTHROPIC_MODEL",
    baseURLEnv: "SAMBANOVA_ANTHROPIC_BASE_URL",
    headersEnv: "SAMBANOVA_ANTHROPIC_HEADERS_JSON",
    bodyExtraEnv: "SAMBANOVA_ANTHROPIC_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "xai",
    label: "xAI",
    profile: "xai",
    protocol: "openai_chat",
    apiKeyEnv: "XAI_API_KEY",
    modelEnv: "XAI_MODEL",
    baseURLEnv: "XAI_BASE_URL",
    headersEnv: "XAI_HEADERS_JSON",
    bodyExtraEnv: "XAI_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "groq",
    label: "Groq",
    profile: "groq",
    protocol: "openai_chat",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    baseURLEnv: "GROQ_BASE_URL",
    headersEnv: "GROQ_HEADERS_JSON",
    bodyExtraEnv: "GROQ_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "mistral",
    label: "Mistral AI",
    profile: "mistral",
    protocol: "openai_chat",
    apiKeyEnv: "MISTRAL_API_KEY",
    modelEnv: "MISTRAL_MODEL",
    baseURLEnv: "MISTRAL_BASE_URL",
    headersEnv: "MISTRAL_HEADERS_JSON",
    bodyExtraEnv: "MISTRAL_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "together",
    label: "Together AI",
    profile: "together",
    protocol: "openai_chat",
    apiKeyEnv: "TOGETHER_API_KEY",
    modelEnv: "TOGETHER_MODEL",
    baseURLEnv: "TOGETHER_BASE_URL",
    headersEnv: "TOGETHER_HEADERS_JSON",
    bodyExtraEnv: "TOGETHER_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "kimi",
    label: "Kimi / Moonshot",
    profile: "kimi",
    protocol: "openai_chat",
    apiKeyEnv: "KIMI_API_KEY",
    modelEnv: "KIMI_MODEL",
    baseURLEnv: "KIMI_BASE_URL",
    headersEnv: "KIMI_HEADERS_JSON",
    bodyExtraEnv: "KIMI_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "perplexity",
    label: "Perplexity Sonar",
    profile: "perplexity",
    protocol: "openai_chat",
    apiKeyEnv: "PERPLEXITY_API_KEY",
    modelEnv: "PERPLEXITY_MODEL",
    baseURLEnv: "PERPLEXITY_BASE_URL",
    headersEnv: "PERPLEXITY_HEADERS_JSON",
    bodyExtraEnv: "PERPLEXITY_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    profile: "deepseek",
    protocol: "openai_chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    baseURLEnv: "DEEPSEEK_BASE_URL",
    headersEnv: "DEEPSEEK_HEADERS_JSON",
    bodyExtraEnv: "DEEPSEEK_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "deepseek-anthropic",
    label: "DeepSeek Anthropic",
    profile: "deepseek-anthropic",
    protocol: "anthropic_messages",
    apiKeyEnv: "DEEPSEEK_ANTHROPIC_API_KEY",
    modelEnv: "DEEPSEEK_ANTHROPIC_MODEL",
    baseURLEnv: "DEEPSEEK_ANTHROPIC_BASE_URL",
    headersEnv: "DEEPSEEK_ANTHROPIC_HEADERS_JSON",
    bodyExtraEnv: "DEEPSEEK_ANTHROPIC_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "zai-anthropic",
    label: "Z.AI Anthropic",
    profile: "zai-anthropic",
    protocol: "anthropic_messages",
    apiKeyEnv: "ZAI_ANTHROPIC_API_KEY",
    modelEnv: "ZAI_ANTHROPIC_MODEL",
    baseURLEnv: "ZAI_ANTHROPIC_BASE_URL",
    headersEnv: "ZAI_ANTHROPIC_HEADERS_JSON",
    bodyExtraEnv: "ZAI_ANTHROPIC_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    profile: "openrouter",
    protocol: "openai_chat",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    baseURLEnv: "OPENROUTER_BASE_URL",
    headersEnv: "OPENROUTER_HEADERS_JSON",
    bodyExtraEnv: "OPENROUTER_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "dashscope",
    label: "Qwen / DashScope",
    profile: "dashscope",
    protocol: "openai_chat",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    modelEnv: "DASHSCOPE_MODEL",
    baseURLEnv: "DASHSCOPE_BASE_URL",
    headersEnv: "DASHSCOPE_HEADERS_JSON",
    bodyExtraEnv: "DASHSCOPE_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    profile: "siliconflow",
    protocol: "openai_chat",
    apiKeyEnv: "SILICONFLOW_API_KEY",
    modelEnv: "SILICONFLOW_MODEL",
    baseURLEnv: "SILICONFLOW_BASE_URL",
    headersEnv: "SILICONFLOW_HEADERS_JSON",
    bodyExtraEnv: "SILICONFLOW_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "zhipu",
    label: "Zhipu / GLM",
    profile: "zhipu",
    protocol: "openai_chat",
    apiKeyEnv: "ZHIPU_API_KEY",
    modelEnv: "ZHIPU_MODEL",
    baseURLEnv: "ZHIPU_BASE_URL",
    headersEnv: "ZHIPU_HEADERS_JSON",
    bodyExtraEnv: "ZHIPU_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "volcengine",
    label: "Volcengine Ark / Doubao",
    profile: "volcengine",
    protocol: "openai_chat",
    apiKeyEnv: "VOLCENGINE_API_KEY",
    modelEnv: "VOLCENGINE_MODEL",
    baseURLEnv: "VOLCENGINE_BASE_URL",
    headersEnv: "VOLCENGINE_HEADERS_JSON",
    bodyExtraEnv: "VOLCENGINE_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "qianfan",
    label: "Baidu Qianfan",
    profile: "qianfan",
    protocol: "openai_chat",
    apiKeyEnv: "QIANFAN_API_KEY",
    modelEnv: "QIANFAN_MODEL",
    baseURLEnv: "QIANFAN_BASE_URL",
    headersEnv: "QIANFAN_HEADERS_JSON",
    bodyExtraEnv: "QIANFAN_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "hunyuan",
    label: "Tencent Hunyuan",
    profile: "hunyuan",
    protocol: "openai_chat",
    apiKeyEnv: "HUNYUAN_API_KEY",
    modelEnv: "HUNYUAN_MODEL",
    baseURLEnv: "HUNYUAN_BASE_URL",
    headersEnv: "HUNYUAN_HEADERS_JSON",
    bodyExtraEnv: "HUNYUAN_BODY_EXTRA_JSON",
    requireBaseURL: false,
    allowLocalNoAuth: true
  },
  {
    id: "ollama",
    label: "Ollama",
    profile: "ollama",
    protocol: "openai_chat",
    apiKeyEnv: "OLLAMA_API_KEY",
    modelEnv: "OLLAMA_MODEL",
    baseURLEnv: "OLLAMA_BASE_URL",
    headersEnv: "OLLAMA_HEADERS_JSON",
    bodyExtraEnv: "OLLAMA_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true,
    apiKeyOptional: true
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    profile: "lm-studio",
    protocol: "openai_chat",
    apiKeyEnv: "LM_STUDIO_API_KEY",
    modelEnv: "LM_STUDIO_MODEL",
    baseURLEnv: "LM_STUDIO_BASE_URL",
    headersEnv: "LM_STUDIO_HEADERS_JSON",
    bodyExtraEnv: "LM_STUDIO_BODY_EXTRA_JSON",
    requireBaseURL: true,
    allowLocalNoAuth: true,
    apiKeyOptional: true
  }
];

const MAINSTREAM_CASE_IDS = DEFAULT_CASES.map((entry) => entry.id);

const DEFAULT_PROMPT = "Reply with OK only.";
const DEFAULT_CONTEXT = "Live provider verification context.";

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (options.list) {
      const catalog = providerLiveCaseCatalog(options.include || "");
      process.stdout.write(options.json ? `${JSON.stringify(catalog, null, 2)}\n` : formatCaseCatalog(catalog));
      process.exit(0);
    }
    if (options.envTemplate) {
      const template = providerLiveEnvTemplate(options.include || "");
      const textTemplate = options.dotenvTemplate ? formatDotenvTemplate(template) : formatEnvTemplate(template);
      process.stdout.write(options.json ? `${JSON.stringify(template, null, 2)}\n` : textTemplate);
      process.exit(0);
    }
    if (options.doctor) {
      const report = providerLiveDoctor(options.include || "", options, process.env);
      process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
      process.exit(0);
    }
    const report = await runProviderLive(options, process.env);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    if (!report.ok) process.exit(1);
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  }
}

export async function runProviderLive(options = {}, env = process.env) {
  const effectiveEnv = options.envFile ? envWithEnvFile(options.envFile, env) : env;
  const cases = selectedCases(options.include || "");
  const results = [];
  for (const entry of cases) {
    const capabilities = capabilitiesForCase(entry, options, effectiveEnv);
    const unsupported = unsupportedInputReason(entry, options, capabilities);
    if (unsupported) {
      results.push({
        id: entry.id,
        label: entry.label,
        status: "skipped",
        ok: true,
        skipped: true,
        reason: unsupported,
        missing: []
      });
      continue;
    }

    try {
      const customHeaders = customHeadersForCase(entry, options, effectiveEnv);
      const missing = missingRequirements(entry, effectiveEnv, { models: Boolean(options.models), customHeaders });
      if (missing.length) {
        results.push({
          id: entry.id,
          label: entry.label,
          status: "skipped",
          ok: true,
          skipped: true,
          missing
        });
        continue;
      }
      const smokeOptions = {
        profile: entry.profile,
        protocol: entry.protocol,
        apiKey: effectiveEnv[entry.apiKeyEnv],
        baseURL: effectiveEnv[entry.baseURLEnv] || "",
        model: effectiveEnv[entry.modelEnv],
        customHeaders,
        prompt: options.prompt || DEFAULT_PROMPT,
        context: options.context || DEFAULT_CONTEXT,
        timeoutMs: numberOption(options.timeoutMs, 30000),
        maxOutputTokens: numberOption(options.maxOutputTokens, 64),
        temperature: numberOption(options.temperature, 0),
        image: Boolean(options.image),
        pdf: Boolean(options.pdf),
        stream: Boolean(options.stream),
        dryRun: Boolean(options.dryRun),
        capabilities,
        bodyExtra: bodyExtraForCase(entry, options, effectiveEnv)
      };
      const report = options.models
        ? await runProviderModels(smokeOptions)
        : await runProviderSmoke(smokeOptions);
      results.push({
        id: entry.id,
        label: entry.label,
        status: report.ok ? "passed" : "failed",
        ok: report.ok,
        skipped: false,
        report: sanitizeSmokeReport(report, effectiveEnv)
      });
    } catch (error) {
      results.push({
        id: entry.id,
        label: entry.label,
        status: "failed",
        ok: false,
        skipped: false,
        error: redactKnownSecrets(error?.message || String(error), effectiveEnv)
      });
    }
  }

  const counts = countResults(results);
  const ok = counts.failed === 0 && (!options.failOnSkip || counts.skipped === 0);
  return {
    ok,
    live: true,
    models: Boolean(options.models),
    inputMode: liveInputMode(options),
    stream: Boolean(options.stream),
    dryRun: Boolean(options.dryRun),
    envFileLoaded: Boolean(options.envFile),
    failOnSkip: Boolean(options.failOnSkip),
    counts,
    results
  };
}

function parseArgs(args) {
  const options = {
    include: "",
    prompt: "",
    context: "",
    timeoutMs: 30000,
    maxOutputTokens: 64,
    temperature: 0,
    models: false,
    image: false,
    pdf: false,
    stream: false,
    dryRun: false,
    failOnSkip: false,
    customHeaders: {},
    bodyExtra: {},
    capabilities: {},
    envFile: "",
    json: false,
    list: false,
    envTemplate: false,
    dotenvTemplate: false,
    doctor: false,
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--help" || key === "-h") {
      options.help = true;
    } else if (key === "--include" && value) {
      options.include = value;
      index += 1;
    } else if (key === "--prompt" && value) {
      options.prompt = value;
      index += 1;
    } else if (key === "--context" && value) {
      options.context = value;
      index += 1;
    } else if (key === "--timeout-ms" && value) {
      options.timeoutMs = Number(value) || options.timeoutMs;
      index += 1;
    } else if (key === "--max-output-tokens" && value) {
      options.maxOutputTokens = Number(value) || options.maxOutputTokens;
      index += 1;
    } else if (key === "--temperature" && value) {
      options.temperature = Number(value);
      index += 1;
    } else if (key === "--models") {
      options.models = true;
    } else if (key === "--image") {
      options.image = true;
    } else if (key === "--pdf") {
      options.pdf = true;
    } else if (key === "--stream") {
      options.stream = true;
    } else if (key === "--dry-run") {
      options.dryRun = true;
    } else if (key === "--fail-on-skip") {
      options.failOnSkip = true;
    } else if (key === "--list") {
      options.list = true;
    } else if (key === "--env-template") {
      options.envTemplate = true;
    } else if (key === "--dotenv-template") {
      options.dotenvTemplate = true;
    } else if (key === "--doctor") {
      options.doctor = true;
    } else if (key === "--header" && value) {
      const [name, headerValue] = splitAssignment(value, "--header");
      options.customHeaders[name] = headerValue;
      index += 1;
    } else if (key === "--body-extra-json" && value) {
      options.bodyExtra = parseJSONOption(value, "--body-extra-json");
      index += 1;
    } else if (key === "--capabilities-json" && value) {
      options.capabilities = parseJSONOption(value, "--capabilities-json");
      index += 1;
    } else if ((key === "--provider-env-file" || key === "--env-file") && value) {
      options.envFile = value;
      index += 1;
    } else if (key === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${key}`);
    }
  }
  validateLiveOptions(options);
  return options;
}

export function providerLiveCaseCatalog(include = "") {
  const cases = selectedCases(include);
  return {
    liveProviderCases: true,
    count: cases.length,
    groups: providerLiveCaseGroups(),
    cases: cases.map((entry) => ({
      id: entry.id,
      label: entry.label,
      profile: entry.profile,
      protocol: entry.protocol,
      apiKeyEnv: entry.apiKeyEnv,
      modelEnv: entry.modelEnv,
      baseURLEnv: entry.baseURLEnv,
      headersEnv: entry.headersEnv,
      bodyExtraEnv: entry.bodyExtraEnv,
      capabilitiesEnv: capabilitiesEnvForCase(entry),
      requireBaseURL: Boolean(entry.requireBaseURL),
      allowLocalNoAuth: Boolean(entry.allowLocalNoAuth),
      apiKeyOptional: Boolean(entry.apiKeyOptional),
      modelList: entry.modelList !== false,
      imageInput: caseSupportsImageInput(entry),
      pdfInput: caseSupportsPdfInput(entry)
    }))
  };
}

export function providerLiveEnvTemplate(include = "") {
  const cases = selectedCases(include);
  return {
    liveProviderEnvTemplate: true,
    count: cases.length,
    groups: providerLiveCaseGroups(),
    cases: cases.map((entry) => providerEnvTemplateForCase(entry))
  };
}

export function providerLiveDoctor(include = "", options = {}, env = process.env) {
  const envFileState = envWithOptionalEnvFile(options.envFile, env);
  const effectiveEnv = envFileState.env;
  const cases = selectedCases(include);
  const reports = cases.map((entry) => providerLiveDoctorCase(entry, options, effectiveEnv));
  const counts = reports.reduce((acc, entry) => {
    if (entry.status === "ready") acc.ready += 1;
    if (entry.status === "missing") acc.missing += 1;
    if (entry.status === "unsupported") acc.unsupported += 1;
    if (entry.status === "invalid") acc.invalid += 1;
    return acc;
  }, { ready: 0, missing: 0, unsupported: 0, invalid: 0 });
  return {
    ok: true,
    configurationReady: counts.missing === 0 && counts.unsupported === 0 && counts.invalid === 0,
    liveProviderDoctor: true,
    count: reports.length,
    envFileLoaded: envFileState.loaded,
    envFileMissing: envFileState.missing,
    envFilePath: envFileState.path,
    warnings: envFileState.warnings,
    inputMode: liveInputMode(options),
    models: Boolean(options.models),
    stream: Boolean(options.stream),
    counts,
    cases: reports
  };
}

function providerLiveDoctorCase(entry, options, env) {
  try {
    const customHeaders = customHeadersForCase(entry, options, env);
    const capabilities = capabilitiesForCase(entry, options, env);
    const bodyExtra = bodyExtraForCase(entry, options, env);
    const unsupported = unsupportedInputReason(entry, options, capabilities);
    const generationMissing = missingRequirements(entry, env, { models: false, customHeaders });
    const modelListMissing = missingRequirements(entry, env, { models: true, customHeaders });
    const activeMissing = options.models ? modelListMissing : generationMissing;
    const defaults = runProfileDefault(entry.profile) || {};
    const profile = doctorProfileForCase(entry, defaults, env, { customHeaders, capabilities, bodyExtra });
    const endpoint = doctorEndpointForProfile(profile);
    const modelsEndpoint = doctorModelsEndpointForProfile(profile);
    const status = unsupported ? "unsupported" : activeMissing.length ? "missing" : "ready";
    return {
      id: entry.id,
      label: entry.label,
      profile: entry.profile,
      protocol: entry.protocol,
      status,
      ready: status === "ready",
      missing: activeMissing,
      generationMissing,
      modelListMissing,
      unsupportedReason: unsupported,
      endpoint,
      modelsEndpoint,
      model: profile.model || "",
      modelSource: envValueSource(entry.modelEnv, env, defaults.model),
      baseURL: profile.baseURL || "",
      baseURLSource: envValueSource(entry.baseURLEnv, env, defaults.baseURL),
      baseURLRequired: Boolean(entry.requireBaseURL),
      auth: doctorAuthStatus(entry, env, customHeaders, endpoint),
      capabilities: {
        imageBase64: capabilities.imageBase64 === true,
        pdfBase64: capabilities.pdfBase64 === true,
        streaming: capabilities.streaming === true,
        modelList: capabilities.modelList !== false
      },
      env: {
        apiKeyEnv: entry.apiKeyEnv,
        modelEnv: entry.modelEnv,
        baseURLEnv: entry.baseURLEnv,
        headersEnv: entry.headersEnv,
        bodyExtraEnv: entry.bodyExtraEnv,
        capabilitiesEnv: capabilitiesEnvForCase(entry)
      },
      commands: doctorCommandsForCase(entry)
    };
  } catch (error) {
    return {
      id: entry.id,
      label: entry.label,
      profile: entry.profile,
      protocol: entry.protocol,
      status: "invalid",
      ready: false,
      missing: [],
      error: redactKnownSecrets(error?.message || String(error), env),
      commands: doctorCommandsForCase(entry)
    };
  }
}

function doctorProfileForCase(entry, defaults, env, options) {
  return {
    ...defaults,
    protocol: entry.protocol || defaults.protocol,
    endpointMode: defaults.endpointMode || "base_url",
    baseURL: String(env[entry.baseURLEnv] || defaults.baseURL || "").trim(),
    fullURL: String(defaults.fullURL || "").trim(),
    apiKey: String(env[entry.apiKeyEnv] || "").trim() ? "[configured]" : "",
    model: String(env[entry.modelEnv] || defaults.model || "").trim(),
    capabilities: {
      ...(defaults.capabilities || {}),
      ...(options.capabilities || {})
    },
    customHeaders: {
      ...(defaults.customHeaders || {}),
      ...(options.customHeaders || {})
    },
    bodyExtra: {
      ...(defaults.bodyExtra || {}),
      ...(options.bodyExtra || {})
    }
  };
}

function doctorEndpointForProfile(profile) {
  try {
    return endpointFor({
      profile,
      system: "",
      messages: [],
      input: { type: "text", text: "" },
      maxOutputTokens: 1,
      temperature: 0,
      stream: false
    });
  } catch (error) {
    return `unavailable: ${error?.message || String(error)}`;
  }
}

function doctorModelsEndpointForProfile(profile) {
  try {
    return modelsEndpointFor(profile) || "";
  } catch (error) {
    return `unavailable: ${error?.message || String(error)}`;
  }
}

function envValueSource(name, env, defaultValue = "") {
  if (name && String(env[name] || "").trim()) return "env";
  if (String(defaultValue || "").trim()) return "default";
  return "missing";
}

function doctorAuthStatus(entry, env, customHeaders, endpoint) {
  if (hasAuthHeader(customHeaders || {})) return "custom-header";
  if (String(env[entry.apiKeyEnv] || "").trim()) return "api-key-env";
  if (entry.allowLocalNoAuth && isLocalEndpoint(endpoint)) return "local-no-auth";
  if (entry.apiKeyOptional && !String(env[entry.apiKeyEnv] || "").trim()) return "optional-missing";
  return "missing";
}

function doctorCommandsForCase(entry) {
  return {
    generation: `npm run verify:provider:live -- --include ${entry.id}`,
    generationWithEnvFile: `npm run verify:provider:live -- --include ${entry.id} --provider-env-file .env.local`,
    modelList: entry.modelList === false ? "" : `npm run verify:provider:models:live -- --include ${entry.id}`,
    modelListWithEnvFile: entry.modelList === false ? "" : `npm run verify:provider:models:live -- --include ${entry.id} --provider-env-file .env.local`,
    image: caseSupportsImageInput(entry) ? `npm run verify:provider:image:live -- --include ${entry.id}` : "",
    imageWithEnvFile: caseSupportsImageInput(entry) ? `npm run verify:provider:image:live -- --include ${entry.id} --provider-env-file .env.local` : "",
    pdf: caseSupportsPdfInput(entry) ? `npm run verify:provider:pdf:live -- --include ${entry.id}` : "",
    pdfWithEnvFile: caseSupportsPdfInput(entry) ? `npm run verify:provider:pdf:live -- --include ${entry.id} --provider-env-file .env.local` : "",
    envTemplate: `npm run verify:provider:live -- --env-template --include ${entry.id}`,
    dotenvTemplate: `npm run verify:provider:live -- --env-template --dotenv-template --include ${entry.id} > .env.local`
  };
}

function providerEnvTemplateForCase(entry) {
  const requiredEnv = caseGenerationRequiredEnv(entry);
  const modelListRequiredEnv = caseModelListRequiredEnv(entry);
  const capabilitiesEnv = capabilitiesEnvForCase(entry);
  const optionalEnv = [
    ...(entry.apiKeyOptional && entry.apiKeyEnv ? [entry.apiKeyEnv] : []),
    ...(entry.requireBaseURL ? [] : [entry.baseURLEnv]),
    entry.headersEnv,
    entry.bodyExtraEnv,
    capabilitiesEnv
  ].filter(Boolean);
  return {
    id: entry.id,
    label: entry.label,
    profile: entry.profile,
    protocol: entry.protocol,
    requiredEnv,
    requiredEnvValues: envTemplateValuesForCase(entry, requiredEnv),
    modelListRequiredEnv,
    modelListRequiredEnvValues: envTemplateValuesForCase(entry, modelListRequiredEnv),
    optionalEnv,
    optionalEnvValues: envTemplateValuesForCase(entry, optionalEnv),
    generationCommand: `npm run verify:provider:live -- --include ${entry.id}`,
    imageCommand: caseSupportsImageInput(entry)
      ? `npm run verify:provider:image:live -- --include ${entry.id}`
      : "",
    pdfCommand: caseSupportsPdfInput(entry)
      ? `npm run verify:provider:pdf:live -- --include ${entry.id}`
      : "",
    modelListCommand: entry.modelList === false
      ? ""
      : `npm run verify:provider:models:live -- --include ${entry.id}`
  };
}

function envTemplateValuesForCase(entry, names) {
  const values = {};
  for (const name of names || []) {
    values[name] = envTemplateValueForCase(entry, name);
  }
  return values;
}

function envTemplateValueForCase(entry, name) {
  if (!name) return "...";
  if (name === entry.modelEnv) return defaultModelForCase(entry) || "...";
  if (name === entry.baseURLEnv) return defaultBaseURLForCase(entry) || "...";
  if (name === capabilitiesEnvForCase(entry)) return "{}";
  if (name === entry.headersEnv || name === entry.bodyExtraEnv) return "{}";
  return "...";
}

function caseSupportsImageInput(entry, capabilities = null) {
  const effective = capabilities || runProfileDefault(entry.profile)?.capabilities || {};
  return effective?.imageBase64 === true;
}

function caseSupportsPdfInput(entry, capabilities = null) {
  const profile = runProfileDefault(entry.profile);
  const effective = capabilities || profile?.capabilities || {};
  return effective?.pdfBase64 === true && entry.protocol !== "openai_chat";
}

function caseGenerationRequiredEnv(entry) {
  return [
    ...(entry.apiKeyOptional ? [] : [entry.apiKeyEnv]),
    entry.modelEnv,
    ...(entry.requireBaseURL ? [entry.baseURLEnv] : [])
  ].filter(Boolean);
}

function caseModelListRequiredEnv(entry) {
  if (entry.modelList === false) return [];
  return [
    ...(entry.apiKeyOptional ? [] : [entry.apiKeyEnv]),
    ...(entry.requireBaseURL ? [entry.baseURLEnv] : [])
  ].filter(Boolean);
}

function validateLiveOptions(options) {
  if (options.dotenvTemplate && !options.envTemplate) {
    throw new Error("--dotenv-template requires --env-template");
  }
  if (options.models && (options.image || options.pdf)) {
    throw new Error("--image and --pdf verify generation inputs and cannot be combined with --models");
  }
  if (options.models && options.stream) {
    throw new Error("--stream verifies generation output and cannot be combined with --models");
  }
}

function envWithEnvFile(path, env) {
  const fileEnv = parseEnvFile(readFileSync(path, "utf8"), path);
  const result = { ...(env || {}) };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (!String(result[key] ?? "").trim()) result[key] = value;
  }
  return result;
}

function envWithOptionalEnvFile(path, env) {
  const base = env || {};
  if (!path) {
    return { env: base, loaded: false, missing: false, path: "", warnings: [] };
  }
  try {
    return { env: envWithEnvFile(path, base), loaded: true, missing: false, path, warnings: [] };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      env: base,
      loaded: false,
      missing: true,
      path,
      warnings: [`Env file not found: ${path}. Run the env draft command, then fill in the required values.`]
    };
  }
}

function parseEnvFile(text, label = ".env") {
  const values = {};
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const line = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) throw new Error(`${label}:${index + 1} must use KEY=value`);
    const key = line.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`${label}:${index + 1} has invalid env key`);
    values[key] = parseEnvFileValue(line.slice(equalsIndex + 1));
  }
  return values;
}

function parseEnvFileValue(value) {
  const raw = String(value || "").trim();
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    const inner = raw.slice(1, -1);
    if (raw.startsWith("'")) return inner;
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return raw.replace(/\s+#.*$/, "").trim();
}

function selectedCases(include) {
  const requested = String(include || "")
    .split(",")
    .map((value) => providerSelectorKey(value))
    .filter(Boolean);
  if (!requested.length) return DEFAULT_CASES;
  const byId = new Map(DEFAULT_CASES.map((entry) => [entry.id, entry]));
  const byGroup = new Map(providerLiveCaseGroups().map((group) => [group.id, group]));
  const selected = [];
  const seen = new Set();
  for (const id of requested) {
    const entries = byId.has(id)
      ? [byId.get(id)]
      : byGroup.has(id)
        ? byGroup.get(id).caseIds.map((caseId) => byId.get(caseId)).filter(Boolean)
        : [];
    if (!entries[0]) {
      const choices = [...byId.keys(), ...byGroup.keys()].sort().join(", ");
      throw new Error(`Unknown live provider case or group: ${id}. Available: ${choices}`);
    }
    for (const entry of entries) {
      if (!entry || seen.has(entry.id)) continue;
      selected.push(entry);
      seen.add(entry.id);
    }
  }
  return selected;
}

function providerLiveCaseGroups() {
  const byProtocol = (protocol) => DEFAULT_CASES
    .filter((entry) => entry.protocol === protocol)
    .map((entry) => entry.id);
  const localIds = DEFAULT_CASES
    .filter((entry) => entry.apiKeyOptional === true)
    .map((entry) => entry.id);
  const remoteIds = DEFAULT_CASES
    .filter((entry) => entry.apiKeyOptional !== true)
    .map((entry) => entry.id);
  return [
    {
      id: "all",
      label: "All live provider cases",
      caseIds: DEFAULT_CASES.map((entry) => entry.id)
    },
    {
      id: "mainstream",
      label: "Common hosted and local profiles for first-pass checks",
      caseIds: MAINSTREAM_CASE_IDS
    },
    {
      id: "core",
      label: "Core protocol families: OpenAI, OpenAI-compatible, and Anthropic",
      caseIds: ["openai", "openai-compatible", "openai-responses-compatible", "anthropic", "anthropic-compatible"]
    },
    {
      id: "openai-chat",
      label: "OpenAI-compatible Chat protocol profiles",
      caseIds: byProtocol("openai_chat")
    },
    {
      id: "openai-responses",
      label: "OpenAI Responses protocol profiles",
      caseIds: byProtocol("openai_responses")
    },
    {
      id: "anthropic-messages",
      label: "Anthropic Messages protocol profiles",
      caseIds: byProtocol("anthropic_messages")
    },
    {
      id: "remote",
      label: "Remote hosted API profiles",
      caseIds: remoteIds
    },
    {
      id: "local",
      label: "Local OpenAI-compatible runtime profiles",
      caseIds: localIds
    }
  ];
}

function missingRequirements(entry, env, options = {}) {
  const missing = [];
  const baseURL = String(env[entry.baseURLEnv] || (entry.requireBaseURL ? "" : defaultBaseURLForCase(entry)) || "").trim();
  const localNoAuth = entry.allowLocalNoAuth && isLocalEndpoint(baseURL);
  const customAuth = hasAuthHeader(options.customHeaders || {});
  if (!entry.apiKeyOptional && !localNoAuth && !String(env[entry.apiKeyEnv] || "").trim() && !customAuth) missing.push(entry.apiKeyEnv);
  if (!options.models && !String(env[entry.modelEnv] || defaultModelForCase(entry) || "").trim()) missing.push(entry.modelEnv);
  if (entry.requireBaseURL && !baseURL) missing.push(entry.baseURLEnv);
  return missing;
}

function unsupportedInputReason(entry, options = {}, capabilities = null) {
  if (options.models && entry.modelList === false) {
    return "Model-list checks are not supported for this provider profile";
  }
  if (options.image && !caseSupportsImageInput(entry, capabilities)) {
    return "Image checks are not supported for this provider profile";
  }
  if (options.pdf && !caseSupportsPdfInput(entry, capabilities)) {
    if (entry.protocol === "openai_chat") {
      return "OpenAI-compatible Chat profiles use extracted text input; choose a Responses or Anthropic profile for raw PDF input";
    }
    return "Raw PDF checks are not supported for this provider profile";
  }
  return "";
}

function defaultBaseURLForCase(entry) {
  try {
    return entry?.profile ? runProfileDefault(entry.profile)?.baseURL || "" : "";
  } catch (_err) {
    return "";
  }
}

function defaultModelForCase(entry) {
  try {
    return entry?.profile ? runProfileDefault(entry.profile)?.model || "" : "";
  } catch (_err) {
    return "";
  }
}

function runProfileDefault(id) {
  const profiles = readDefaultProfiles();
  const normalized = providerCaseKey(id);
  return profiles.find((profile) => providerCaseKey(profile?.id) === normalized) || null;
}

function readDefaultProfiles() {
  const prefsPath = new URL("../addon/prefs.js", import.meta.url);
  const prefs = readFileSync(fileURLToPath(prefsPath), "utf8");
  const match = prefs.match(/pref\("profilesJson",\s*"((?:\\.|[^"\\])*)"\);/);
  if (!match) throw new Error("profilesJson preference is missing");
  return JSON.parse(JSON.parse(`"${match[1]}"`));
}

function providerCaseKey(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function providerSelectorKey(value) {
  return providerCaseKey(value);
}

function isLocalEndpoint(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
}

function sanitizeSmokeReport(report, env) {
  return JSON.parse(redactKnownSecrets(JSON.stringify(report || {}), env));
}

function redactKnownSecrets(text, env) {
  let output = String(text || "");
  for (const key of sensitiveEnvKeys()) {
    const value = String(env[key] || "");
    for (const secret of redactionCandidates(value, key.includes("HEADERS_JSON"))) {
      output = output.split(secret).join("[redacted]");
    }
  }
  return output;
}

function sensitiveEnvKeys() {
  const keys = new Set();
  for (const entry of DEFAULT_CASES) {
    for (const key of [entry.apiKeyEnv, entry.headersEnv, entry.bodyExtraEnv]) {
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

function redactionCandidates(value, includeJSONLeaves = false) {
  const raw = String(value || "");
  const candidates = [];
  if (raw.length >= 4) candidates.push(raw);
  if (includeJSONLeaves) {
    try {
      collectStringLeaves(JSON.parse(raw), candidates);
    } catch (_err) {
      // Non-JSON env values are handled by the raw string candidate above.
    }
  }
  return [...new Set(candidates.filter((item) => String(item || "").length >= 4))];
}

function collectStringLeaves(value, target) {
  if (typeof value === "string") {
    target.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, target);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringLeaves(item, target);
  }
}

function customHeadersForCase(entry, options, env) {
  const globalHeaders = options.customHeaders || {};
  const envHeaders = entry.headersEnv && env[entry.headersEnv]
    ? normalizeStringMap(parseJSONOption(env[entry.headersEnv], entry.headersEnv), entry.headersEnv)
    : {};
  return { ...globalHeaders, ...envHeaders };
}

function bodyExtraForCase(entry, options, env) {
  const globalExtra = options.bodyExtra || {};
  const envExtra = entry.bodyExtraEnv && env[entry.bodyExtraEnv]
    ? parseJSONOption(env[entry.bodyExtraEnv], entry.bodyExtraEnv)
    : {};
  return { ...globalExtra, ...envExtra };
}

function capabilitiesForCase(entry, options, env) {
  const defaults = runProfileDefault(entry.profile)?.capabilities || {};
  const envName = capabilitiesEnvForCase(entry);
  const envCapabilities = envName && env[envName]
    ? parseJSONOption(env[envName], envName)
    : {};
  return { ...defaults, ...(options.capabilities || {}), ...envCapabilities };
}

function capabilitiesEnvForCase(entry) {
  return `${String(entry.id || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CAPABILITIES_JSON`;
}

function parseJSONOption(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || "{}"));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error?.message || String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function normalizeStringMap(value, label) {
  const result = {};
  for (const [key, item] of Object.entries(value || {})) {
    const name = String(key || "").trim();
    if (!name) throw new Error(`${label} contains an empty key`);
    result[name] = String(item ?? "");
  }
  return result;
}

function splitAssignment(value, label) {
  const raw = String(value || "");
  const index = raw.indexOf("=");
  if (index <= 0) throw new Error(`${label} must use name=value`);
  return [raw.slice(0, index), raw.slice(index + 1)];
}

function hasAuthHeader(headers) {
  return Object.entries(headers || {}).some(([key, value]) =>
    ["authorization", "api-key", "x-api-key"].includes(String(key).toLowerCase()) && String(value || "").trim()
  );
}

function countResults(results) {
  const counts = { passed: 0, skipped: 0, failed: 0 };
  for (const result of results) {
    if (result.status === "passed") counts.passed += 1;
    if (result.status === "skipped") counts.skipped += 1;
    if (result.status === "failed") counts.failed += 1;
  }
  return counts;
}

function numberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatReport(report) {
  const lines = [
    report.ok ? "Provider live verification completed" : "Provider live verification failed",
    `input: ${report.inputMode || "text"}`,
    `passed: ${report.counts.passed}`,
    `skipped: ${report.counts.skipped}`,
    `failed: ${report.counts.failed}`
  ];
  for (const result of report.results || []) {
    if (result.status === "skipped") {
      lines.push(`${result.id}: skipped (${result.reason || result.missing.join(", ")})`);
    } else if (result.status === "failed") {
      lines.push(`${result.id}: failed (${result.error || result.report?.error || ""})`);
    } else {
      const suffix = report.models
        ? `${result.report?.protocol || ""}, ${result.report?.modelCount ?? 0} model(s)`
        : [result.report?.protocol || "", result.report?.inputMode || ""].filter(Boolean).join(", ");
      lines.push(`${result.id}: passed (${suffix})`);
    }
  }
  if (report.failOnSkip && report.counts.skipped > 0) {
    lines.push("Skipped cases are treated as failures because --fail-on-skip was passed.");
  }
  return `${lines.join("\n")}\n`;
}

function formatCaseCatalog(catalog) {
  const lines = [
    "Provider live verification case groups:",
    "group\tcases",
    ...(catalog.groups || []).map((group) => `${group.id}\t${group.caseIds.join(",")}`),
    "",
    "Provider live verification cases:",
    "id\tprotocol\timageInput\tpdfInput\tmodelList\tapiKeyEnv\tmodelEnv\tbaseURLEnv\theadersEnv\tbodyExtraEnv"
  ];
  for (const entry of catalog.cases || []) {
    lines.push([
      entry.id,
      entry.protocol,
      entry.imageInput ? "yes" : "no",
      entry.pdfInput ? "yes" : "no",
      entry.modelList ? "yes" : "no",
      entry.apiKeyEnv || "-",
      entry.modelEnv || "-",
      entry.baseURLEnv || "-",
      entry.headersEnv || "-",
      entry.bodyExtraEnv || "-"
    ].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function formatEnvTemplate(template) {
  const lines = [
    "Provider live verification env templates:",
    "# Include groups: " + (template.groups || []).map((group) => group.id).join(", ")
  ];
  for (const entry of template.cases || []) {
    lines.push("", `# ${entry.id} (${entry.protocol})`, "# Required for generation checks");
    for (const name of entry.requiredEnv || []) {
      lines.push(`${name}=${entry.requiredEnvValues?.[name] || "..."}`);
    }
    if (entry.optionalEnv?.length) {
      lines.push("# Optional");
      for (const name of entry.optionalEnv) {
        lines.push(`# ${name}=${entry.optionalEnvValues?.[name] || "..."}`);
      }
    }
    lines.push(entry.generationCommand);
    if (entry.imageCommand) {
      lines.push("# Image input check");
      lines.push(entry.imageCommand);
    }
    if (entry.pdfCommand) {
      lines.push("# Raw PDF input check");
      lines.push(entry.pdfCommand);
    }
    if (entry.modelListCommand && entry.modelListRequiredEnv?.length) {
      lines.push("# Required for model-list checks");
      for (const name of entry.modelListRequiredEnv) {
        lines.push(`${name}=${entry.modelListRequiredEnvValues?.[name] || "..."}`);
      }
      lines.push(entry.modelListCommand);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatDotenvTemplate(template) {
  const lines = [
    "# Literature Review with LLM provider live-check env draft",
    "# Include groups: " + (template.groups || []).map((group) => group.id).join(", "),
    "# Keep real API keys local; do not commit this file."
  ];
  for (const entry of template.cases || []) {
    const requiredEnv = uniqueEnvNames([
      ...(entry.requiredEnv || []),
      ...(entry.modelListRequiredEnv || [])
    ]);
    lines.push("", `# ${entry.id} (${entry.protocol})`, "# Required");
    for (const name of requiredEnv) {
      const value = entry.requiredEnvValues?.[name] ?? entry.modelListRequiredEnvValues?.[name] ?? "";
      lines.push(`${name}=${dotenvValue(value)}`);
    }
    if (entry.optionalEnv?.length) {
      lines.push("# Optional");
      for (const name of uniqueEnvNames(entry.optionalEnv)) {
        lines.push(`# ${name}=${dotenvValue(entry.optionalEnvValues?.[name])}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatDoctorReport(report) {
  const lines = [
    "Provider live configuration doctor",
    `input: ${report.inputMode || "text"}`,
    `configurationReady: ${report.configurationReady ? "yes" : "no"}`,
    `ready: ${report.counts.ready}`,
    `missing: ${report.counts.missing}`,
    `unsupported: ${report.counts.unsupported}`,
    `invalid: ${report.counts.invalid}`
  ];
  if (report.envFilePath) {
    const state = report.envFileLoaded ? "loaded" : report.envFileMissing ? "missing" : "not loaded";
    lines.push(`envFile: ${report.envFilePath} (${state})`);
  }
  for (const warning of report.warnings || []) {
    lines.push(`warning: ${warning}`);
  }
  for (const entry of report.cases || []) {
    lines.push("", `${entry.id}: ${entry.status}`);
    if (entry.error) lines.push(`  error: ${entry.error}`);
    if (entry.unsupportedReason) lines.push(`  unsupported: ${entry.unsupportedReason}`);
    if (entry.missing?.length) lines.push(`  missing: ${entry.missing.join(", ")}`);
    if (entry.protocol) lines.push(`  protocol: ${entry.protocol}`);
    if (entry.endpoint) lines.push(`  endpoint: ${entry.endpoint}`);
    if (entry.modelsEndpoint) lines.push(`  modelsEndpoint: ${entry.modelsEndpoint}`);
    if (entry.model || entry.modelSource) lines.push(`  model: ${entry.model || "(missing)"} (${entry.modelSource || "missing"})`);
    if (entry.baseURL || entry.baseURLSource) {
      const required = entry.baseURLRequired ? ", required" : "";
      lines.push(`  baseURL: ${entry.baseURL || "(missing)"} (${entry.baseURLSource || "missing"}${required})`);
    }
    if (entry.auth) lines.push(`  auth: ${entry.auth}`);
    if (entry.capabilities) {
      lines.push(`  capabilities: image=${entry.capabilities.imageBase64 ? "yes" : "no"}, pdf=${entry.capabilities.pdfBase64 ? "yes" : "no"}, stream=${entry.capabilities.streaming ? "yes" : "no"}, models=${entry.capabilities.modelList ? "yes" : "no"}`);
    }
    if (entry.generationMissing?.length) lines.push(`  generationMissing: ${entry.generationMissing.join(", ")}`);
    if (entry.modelListMissing?.length) lines.push(`  modelListMissing: ${entry.modelListMissing.join(", ")}`);
    if (entry.commands?.generationWithEnvFile) lines.push(`  next: ${entry.commands.generationWithEnvFile}`);
    if (entry.commands?.modelListWithEnvFile) lines.push(`  models: ${entry.commands.modelListWithEnvFile}`);
    if (entry.commands?.imageWithEnvFile) lines.push(`  image: ${entry.commands.imageWithEnvFile}`);
    if (entry.commands?.pdfWithEnvFile) lines.push(`  pdf: ${entry.commands.pdfWithEnvFile}`);
    if (entry.commands?.dotenvTemplate) lines.push(`  envDraft: ${entry.commands.dotenvTemplate}`);
  }
  return `${lines.join("\n")}\n`;
}

function uniqueEnvNames(names) {
  return [...new Set((names || []).filter(Boolean))];
}

function dotenvValue(value) {
  const text = String(value ?? "").trim();
  return text === "..." ? "" : text;
}

function usage() {
  return [
    "Usage:",
    "  npm run verify:provider:live -- --json",
    "  npm run verify:provider:models:live -- --json",
    "  npm run verify:provider:live -- --list",
    "  npm run verify:provider:live -- --list --include mainstream",
    "  npm run verify:provider:live -- --doctor --include core",
    "  npm run verify:provider:live -- --doctor --include anthropic-compatible --provider-env-file .env.local",
    "  npm run verify:provider:live -- --include core --provider-env-file .env.local --fail-on-skip",
    "  npm run verify:provider:live -- --include openai-chat --stream --provider-env-file .env.local",
    "  npm run verify:provider:models:live -- --include anthropic-messages --provider-env-file .env.local",
    "  npm run verify:provider:live -- --env-template --include openai-compatible",
    "  npm run verify:provider:live -- --env-template --dotenv-template --include core > .env.local",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai",
    "  OPENAI_API_KEY=... npm run verify:provider:models:live -- --include openai",
    "  OPENAI_RESPONSES_COMPATIBLE_API_KEY=... OPENAI_RESPONSES_COMPATIBLE_MODEL=... OPENAI_RESPONSES_COMPATIBLE_BASE_URL=... npm run verify:provider:live -- --include openai-responses-compatible",
    "  OPENAI_RESPONSES_COMPATIBLE_API_KEY=... OPENAI_RESPONSES_COMPATIBLE_BASE_URL=... npm run verify:provider:models:live -- --include openai-responses-compatible",
    "  OPENAI_RESPONSES_COMPATIBLE_MODEL=... OPENAI_RESPONSES_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1 npm run verify:provider:live -- --include openai-responses-compatible",
    "  OPENAI_RESPONSES_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1 npm run verify:provider:models:live -- --include openai-responses-compatible",
    "  ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npm run verify:provider:live -- --include anthropic",
    "  ANTHROPIC_API_KEY=... npm run verify:provider:models:live -- --include anthropic",
    "  ANTHROPIC_COMPATIBLE_API_KEY=... ANTHROPIC_COMPATIBLE_MODEL=... ANTHROPIC_COMPATIBLE_BASE_URL=... npm run verify:provider:live -- --include anthropic-compatible",
    "  ANTHROPIC_COMPATIBLE_API_KEY=... ANTHROPIC_COMPATIBLE_BASE_URL=... npm run verify:provider:models:live -- --include anthropic-compatible",
    "  OPENAI_COMPATIBLE_API_KEY=... OPENAI_COMPATIBLE_MODEL=... OPENAI_COMPATIBLE_BASE_URL=... npm run verify:provider:live -- --include openai-compatible",
    "  OPENAI_COMPATIBLE_API_KEY=... OPENAI_COMPATIBLE_BASE_URL=... npm run verify:provider:models:live -- --include openai-compatible",
    "  OPENAI_COMPATIBLE_MODEL=... OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1 npm run verify:provider:live -- --include openai-compatible",
    "  OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1 npm run verify:provider:models:live -- --include openai-compatible",
    "  npm run verify:provider:live -- --include openai-compatible --provider-env-file .env.local",
    "  MINIMAX_API_KEY=... npm run verify:provider:live -- --include minimax",
    "  GEMINI_API_KEY=... GEMINI_MODEL=... npm run verify:provider:live -- --include gemini",
    "  AZURE_OPENAI_API_KEY=... AZURE_OPENAI_MODEL=... AZURE_OPENAI_BASE_URL=... npm run verify:provider:live -- --include azure-openai",
    "  VERCEL_AI_API_KEY=... VERCEL_AI_MODEL=... npm run verify:provider:live -- --include vercel-ai-chat",
    "  VERCEL_AI_RESPONSES_API_KEY=... VERCEL_AI_RESPONSES_MODEL=... npm run verify:provider:live -- --include vercel-ai-responses",
    "  VERCEL_AI_ANTHROPIC_API_KEY=... VERCEL_AI_ANTHROPIC_MODEL=... npm run verify:provider:live -- --include vercel-ai-anthropic",
    "  CLOUDFLARE_API_KEY=... CLOUDFLARE_MODEL=... CLOUDFLARE_BASE_URL=... npm run verify:provider:live -- --include cloudflare-ai-chat",
    "  CLOUDFLARE_RESPONSES_API_KEY=... CLOUDFLARE_RESPONSES_MODEL=... CLOUDFLARE_RESPONSES_BASE_URL=... npm run verify:provider:live -- --include cloudflare-ai-responses",
    "  CLOUDFLARE_ANTHROPIC_API_KEY=... CLOUDFLARE_ANTHROPIC_MODEL=... CLOUDFLARE_ANTHROPIC_BASE_URL=... npm run verify:provider:live -- --include cloudflare-ai-anthropic",
    "  GITHUB_MODELS_API_KEY=... GITHUB_MODELS_MODEL=... npm run verify:provider:live -- --include github-models",
    "  HUGGINGFACE_API_KEY=... HUGGINGFACE_MODEL=... npm run verify:provider:live -- --include huggingface",
    "  DEEPINFRA_API_KEY=... DEEPINFRA_MODEL=... npm run verify:provider:live -- --include deepinfra",
    "  FIREWORKS_API_KEY=... FIREWORKS_MODEL=... npm run verify:provider:live -- --include fireworks",
    "  CEREBRAS_API_KEY=... CEREBRAS_MODEL=... npm run verify:provider:live -- --include cerebras",
    "  NVIDIA_NIM_API_KEY=... NVIDIA_NIM_MODEL=... npm run verify:provider:live -- --include nvidia-nim",
    "  SAMBANOVA_API_KEY=... SAMBANOVA_MODEL=... npm run verify:provider:live -- --include sambanova",
    "  SAMBANOVA_RESPONSES_API_KEY=... SAMBANOVA_RESPONSES_MODEL=... npm run verify:provider:live -- --include sambanova-responses",
    "  SAMBANOVA_ANTHROPIC_API_KEY=... SAMBANOVA_ANTHROPIC_MODEL=... npm run verify:provider:live -- --include sambanova-anthropic",
    "  DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=... npm run verify:provider:live -- --include deepseek",
    "  OPENROUTER_API_KEY=... OPENROUTER_MODEL=... npm run verify:provider:live -- --include openrouter",
    "  GROQ_API_KEY=... GROQ_MODEL=... npm run verify:provider:live -- --include groq",
    "  OLLAMA_MODEL=llama3.1 OLLAMA_BASE_URL=http://localhost:11434/v1 npm run verify:provider:live -- --include ollama",
    "  LM_STUDIO_MODEL=local-model LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1 npm run verify:provider:live -- --include lm-studio",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --image",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --pdf",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --stream",
    "",
    "Options:",
    "  --include LIST           Comma-separated live case ids or groups; underscores are accepted as aliases. Groups: all, mainstream, core, openai-chat, openai-responses, anthropic-messages, remote, local",
    "  --list                   Print available live case ids and environment variable names, then exit",
    "  --env-template           Print copyable placeholder env lines for selected live case ids, then exit",
    "  --dotenv-template        With --env-template, print a plain KEY=value draft for a local env file",
    "  --doctor                 Check selected env configuration and print safe next-step commands without calling providers",
    "  --prompt TEXT            Override the smoke prompt",
    "  --context TEXT           Override the smoke context",
    "  --timeout-ms NUMBER      Per-provider timeout",
    "  --max-output-tokens N    Maximum output tokens",
    "  --temperature NUMBER     Sampling temperature",
    "  --models                 Verify model-list endpoints instead of text generation",
    "  --image                  Include a tiny base64 PNG in generation checks",
    "  --pdf                    Include a tiny base64 PDF in generation checks",
    "  --stream                 Verify streaming generation with text/event-stream responses",
    "  --dry-run                Print sanitized request shapes without calling providers",
    "  --fail-on-skip           Exit non-zero when any selected case is missing env config",
    "  --header name=value       Add or override a request header for all selected cases",
    "  --body-extra-json JSON    Merge extra request-body fields for all selected generation cases",
    "  --capabilities-json JSON  Override profile capabilities for all selected checks",
    "  --provider-env-file PATH Load KEY=value lines from a local env file; shell env values take precedence",
    "  --env-file PATH          Compatibility alias for --provider-env-file",
    "  --json                   Print machine-readable JSON"
  ].join("\n") + "\n";
}

function liveInputMode(options) {
  if (options.pdf && options.image) return "pdf+image";
  if (options.pdf) return "pdf";
  if (options.image) return "image";
  return "text";
}

function isMainModule() {
  const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
  return import.meta.url === entry || fileURLToPath(import.meta.url) === process.argv[1];
}
