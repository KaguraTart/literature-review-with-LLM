#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runProviderModels, runProviderSmoke } from "./verify-provider-smoke.mjs";

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
  }
];

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
      process.stdout.write(options.json ? `${JSON.stringify(template, null, 2)}\n` : formatEnvTemplate(template));
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
  const cases = selectedCases(options.include || "");
  const results = [];
  for (const entry of cases) {
    const unsupported = unsupportedInputReason(entry, options);
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
      const customHeaders = customHeadersForCase(entry, options, env);
      const missing = missingRequirements(entry, env, { models: Boolean(options.models), customHeaders });
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
        apiKey: env[entry.apiKeyEnv],
        baseURL: env[entry.baseURLEnv] || "",
        model: env[entry.modelEnv],
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
        bodyExtra: bodyExtraForCase(entry, options, env)
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
        report: sanitizeSmokeReport(report, env)
      });
    } catch (error) {
      results.push({
        id: entry.id,
        label: entry.label,
        status: "failed",
        ok: false,
        skipped: false,
        error: redactKnownSecrets(error?.message || String(error), env)
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
    json: false,
    list: false,
    envTemplate: false,
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
    } else if (key === "--header" && value) {
      const [name, headerValue] = splitAssignment(value, "--header");
      options.customHeaders[name] = headerValue;
      index += 1;
    } else if (key === "--body-extra-json" && value) {
      options.bodyExtra = parseJSONOption(value, "--body-extra-json");
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
      requireBaseURL: Boolean(entry.requireBaseURL),
      allowLocalNoAuth: Boolean(entry.allowLocalNoAuth),
      modelList: entry.modelList !== false
    }))
  };
}

export function providerLiveEnvTemplate(include = "") {
  const cases = selectedCases(include);
  return {
    liveProviderEnvTemplate: true,
    count: cases.length,
    cases: cases.map((entry) => providerEnvTemplateForCase(entry))
  };
}

function providerEnvTemplateForCase(entry) {
  const requiredEnv = caseGenerationRequiredEnv(entry);
  const modelListRequiredEnv = caseModelListRequiredEnv(entry);
  const optionalEnv = [
    ...(entry.requireBaseURL ? [] : [entry.baseURLEnv]),
    entry.headersEnv,
    entry.bodyExtraEnv
  ].filter(Boolean);
  return {
    id: entry.id,
    label: entry.label,
    profile: entry.profile,
    protocol: entry.protocol,
    requiredEnv,
    modelListRequiredEnv,
    optionalEnv,
    generationCommand: `npm run verify:provider:live -- --include ${entry.id}`,
    modelListCommand: entry.modelList === false
      ? ""
      : `npm run verify:provider:models:live -- --include ${entry.id}`
  };
}

function caseGenerationRequiredEnv(entry) {
  return [
    entry.apiKeyEnv,
    entry.modelEnv,
    ...(entry.requireBaseURL ? [entry.baseURLEnv] : [])
  ].filter(Boolean);
}

function caseModelListRequiredEnv(entry) {
  if (entry.modelList === false) return [];
  return [
    entry.apiKeyEnv,
    ...(entry.requireBaseURL ? [entry.baseURLEnv] : [])
  ].filter(Boolean);
}

function validateLiveOptions(options) {
  if (options.models && (options.image || options.pdf)) {
    throw new Error("--image and --pdf verify generation inputs and cannot be combined with --models");
  }
  if (options.models && options.stream) {
    throw new Error("--stream verifies generation output and cannot be combined with --models");
  }
}

function selectedCases(include) {
  const requested = String(include || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length) return DEFAULT_CASES;
  const byId = new Map(DEFAULT_CASES.map((entry) => [entry.id, entry]));
  return requested.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Unknown live provider case: ${id}`);
    return entry;
  });
}

function missingRequirements(entry, env, options = {}) {
  const missing = [];
  const baseURL = String(env[entry.baseURLEnv] || (entry.requireBaseURL ? "" : defaultBaseURLForCase(entry)) || "").trim();
  const localNoAuth = entry.allowLocalNoAuth && isLocalEndpoint(baseURL);
  const customAuth = hasAuthHeader(options.customHeaders || {});
  if (!localNoAuth && !String(env[entry.apiKeyEnv] || "").trim() && !customAuth) missing.push(entry.apiKeyEnv);
  if (!options.models && !String(env[entry.modelEnv] || defaultModelForCase(entry) || "").trim()) missing.push(entry.modelEnv);
  if (entry.requireBaseURL && !baseURL) missing.push(entry.baseURLEnv);
  return missing;
}

function unsupportedInputReason(entry, options = {}) {
  if (options.models && entry.modelList === false) {
    return "Model-list checks are not supported for this provider profile";
  }
  if (options.pdf && entry.protocol === "openai_chat") {
    return "OpenAI-compatible Chat profiles use extracted text input; choose a Responses or Anthropic profile for raw PDF input";
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

function isLocalEndpoint(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
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
    "Provider live verification cases:",
    "id\tprotocol\tapiKeyEnv\tmodelEnv\tbaseURLEnv\theadersEnv\tbodyExtraEnv"
  ];
  for (const entry of catalog.cases || []) {
    lines.push([
      entry.id,
      entry.protocol,
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
  const lines = ["Provider live verification env templates:"];
  for (const entry of template.cases || []) {
    lines.push("", `# ${entry.id} (${entry.protocol})`, "# Required for generation checks");
    for (const name of entry.requiredEnv || []) {
      lines.push(`${name}=...`);
    }
    if (entry.optionalEnv?.length) {
      lines.push("# Optional");
      for (const name of entry.optionalEnv) {
        lines.push(`# ${name}=...`);
      }
    }
    lines.push(entry.generationCommand);
    if (entry.modelListCommand && entry.modelListRequiredEnv?.length) {
      lines.push("# Required for model-list checks");
      for (const name of entry.modelListRequiredEnv) {
        lines.push(`${name}=...`);
      }
      lines.push(entry.modelListCommand);
    }
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return [
    "Usage:",
    "  npm run verify:provider:live -- --json",
    "  npm run verify:provider:models:live -- --json",
    "  npm run verify:provider:live -- --list",
    "  npm run verify:provider:live -- --env-template --include openai-compatible",
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
    "  MINIMAX_API_KEY=... npm run verify:provider:live -- --include minimax",
    "  GEMINI_API_KEY=... GEMINI_MODEL=... npm run verify:provider:live -- --include gemini",
    "  AZURE_OPENAI_API_KEY=... AZURE_OPENAI_MODEL=... AZURE_OPENAI_BASE_URL=... npm run verify:provider:live -- --include azure-openai",
    "  GITHUB_MODELS_API_KEY=... GITHUB_MODELS_MODEL=... npm run verify:provider:live -- --include github-models",
    "  FIREWORKS_API_KEY=... FIREWORKS_MODEL=... npm run verify:provider:live -- --include fireworks",
    "  CEREBRAS_API_KEY=... CEREBRAS_MODEL=... npm run verify:provider:live -- --include cerebras",
    "  NVIDIA_NIM_API_KEY=... NVIDIA_NIM_MODEL=... npm run verify:provider:live -- --include nvidia-nim",
    "  SAMBANOVA_API_KEY=... SAMBANOVA_MODEL=... npm run verify:provider:live -- --include sambanova",
    "  SAMBANOVA_RESPONSES_API_KEY=... SAMBANOVA_RESPONSES_MODEL=... npm run verify:provider:live -- --include sambanova-responses",
    "  SAMBANOVA_ANTHROPIC_API_KEY=... SAMBANOVA_ANTHROPIC_MODEL=... npm run verify:provider:live -- --include sambanova-anthropic",
    "  DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=... npm run verify:provider:live -- --include deepseek",
    "  OPENROUTER_API_KEY=... OPENROUTER_MODEL=... npm run verify:provider:live -- --include openrouter",
    "  GROQ_API_KEY=... GROQ_MODEL=... npm run verify:provider:live -- --include groq",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --image",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --pdf",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --stream",
    "",
    "Options:",
    "  --include LIST           Comma-separated live case ids; named cases include built-in provider ids such as minimax, gemini, azure-openai, deepseek, openrouter, groq, github-models, fireworks, cerebras, nvidia-nim, sambanova, sambanova-responses, and sambanova-anthropic",
    "  --list                   Print available live case ids and environment variable names, then exit",
    "  --env-template           Print copyable placeholder env lines for selected live case ids, then exit",
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
