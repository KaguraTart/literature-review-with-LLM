#!/usr/bin/env node
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
    bodyExtraEnv: "OPENAI_COMPATIBLE_BODY_EXTRA_JSON",
    requireBaseURL: true,
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

    const missing = missingRequirements(entry, env, { models: Boolean(options.models) });
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

    try {
      const smokeOptions = {
        profile: entry.profile,
        protocol: entry.protocol,
        apiKey: env[entry.apiKeyEnv],
        baseURL: env[entry.baseURLEnv] || "",
        model: env[entry.modelEnv],
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
    bodyExtra: {},
    json: false,
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
  const baseURL = String(env[entry.baseURLEnv] || "").trim();
  const localNoAuth = entry.allowLocalNoAuth && isLocalEndpoint(baseURL);
  if (!localNoAuth && !String(env[entry.apiKeyEnv] || "").trim()) missing.push(entry.apiKeyEnv);
  if (!options.models && !String(env[entry.modelEnv] || "").trim()) missing.push(entry.modelEnv);
  if (entry.requireBaseURL && !baseURL) missing.push(entry.baseURLEnv);
  return missing;
}

function unsupportedInputReason(entry, options = {}) {
  if (options.pdf && entry.protocol === "openai_chat") {
    return "OpenAI-compatible Chat profiles use extracted text input; choose a Responses or Anthropic profile for raw PDF input";
  }
  return "";
}

function isLocalEndpoint(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
}

function sanitizeSmokeReport(report, env) {
  return JSON.parse(redactKnownSecrets(JSON.stringify(report || {}), env));
}

function redactKnownSecrets(text, env) {
  let output = String(text || "");
  for (const key of [
    "OPENAI_API_KEY",
    "OPENAI_RESPONSES_COMPATIBLE_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_COMPATIBLE_API_KEY",
    "OPENAI_COMPATIBLE_API_KEY",
    "OPENAI_BODY_EXTRA_JSON",
    "OPENAI_RESPONSES_COMPATIBLE_BODY_EXTRA_JSON",
    "ANTHROPIC_BODY_EXTRA_JSON",
    "ANTHROPIC_COMPATIBLE_BODY_EXTRA_JSON",
    "OPENAI_COMPATIBLE_BODY_EXTRA_JSON"
  ]) {
    const value = String(env[key] || "");
    if (value.length >= 4) {
      output = output.split(value).join("[redacted]");
    }
  }
  return output;
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

function usage() {
  return [
    "Usage:",
    "  npm run verify:provider:live -- --json",
    "  npm run verify:provider:models:live -- --json",
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
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --image",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --pdf",
    "  OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --stream",
    "",
    "Options:",
    "  --include LIST           Comma-separated cases: openai, openai-responses-compatible, anthropic, anthropic-compatible, openai-compatible",
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
