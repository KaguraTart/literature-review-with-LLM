#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bodyFor,
  defaultCapabilities,
  endpointFor,
  extractProviderUsage,
  extractResponseText,
  headersFor,
  modelsEndpointFor,
  omitProviderRequestBodyFields,
  parseStreamChunk,
  parseStreamUsage,
  providerCompatibilityFallbackFields
} from "../src/providerAdapters.ts";

const PROVIDER_RESPONSE_WRAPPER_KEYS = ["data", "result", "payload", "response", "message", "body", "completion"];
const DEFAULT_PROMPT = "Reply with OK only.";
const DEFAULT_CONTEXT = "Provider smoke-test context.";
const DEFAULT_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const DEFAULT_PDF_BASE64 = "JVBERi0xLjQKMSAwIG9iago8PD4+CmVuZG9iagp0cmFpbGVyCjw8Pj4KJSVFT0YK";

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      process.exit(0);
    }
    const report = options.catalog
      ? runProviderCatalog(options)
      : options.mock
      ? options.models
        ? await runMockProviderModels(options)
        : await runMockProviderSmoke(options)
      : options.models
        ? await runProviderModels(options)
        : await runProviderSmoke(options);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    if (!report.ok) process.exit(1);
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  }
}

export async function runProviderSmoke(options = {}) {
  const profile = buildProfile(options);
  const request = {
    profile,
    system: String(options.system || "You are a provider smoke-test endpoint."),
    messages: [{ role: "user", content: String(options.prompt || DEFAULT_PROMPT) }],
    input: smokeInput(options),
    temperature: numberOption(options.temperature, 0),
    maxOutputTokens: numberOption(options.maxOutputTokens, 64),
    stream: Boolean(options.stream)
  };
  const endpoint = endpointFor(request);
  const headers = headersFor(profile);
  let body = bodyFor(request);
  let responseStream = body.stream === true;
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      profile: profile.id,
      protocol: profile.protocol,
      endpoint,
      modelsEndpoint: modelsEndpointFor(profile) || "",
      inputMode: smokeInputMode(options),
      request: sanitizedRequest(headers, body)
    };
  }

  const timeoutMs = Math.max(numberOption(options.timeoutMs, 30000), 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const usedCompatibilityFallbackFields = [];
    let response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    let responseText = await response.text();
    let parsed = parseResponseBody(responseText);
    while (providerSmokeResponseNeedsFallback(profile.protocol, response, body, responseText, parsed)) {
      const fields = providerCompatibilityFallbackFields(profile.protocol, body, response.status, responseText, usedCompatibilityFallbackFields);
      if (fields.length) {
        body = omitProviderRequestBodyFields(body, fields, usedCompatibilityFallbackFields);
        usedCompatibilityFallbackFields.push(...fields);
        responseStream = body.stream === true;
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        responseText = await response.text();
        parsed = parseResponseBody(responseText);
        continue;
      }
      break;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        profile: profile.id,
        protocol: profile.protocol,
        endpoint,
        error: providerErrorText(parsed, responseText)
      };
    }
    const responseError = providerResponseErrorText(parsed);
    if (responseError) {
      return {
        ok: false,
        status: response.status,
        profile: profile.id,
        protocol: profile.protocol,
        endpoint,
        error: responseError
      };
    }
    const text = responseStream ? streamTextFromBody(profile.protocol, responseText) : extractResponseText(profile.protocol, parsed);
    return {
      ok: true,
      status: response.status,
      profile: profile.id,
      protocol: profile.protocol,
      endpoint,
      model: profile.model,
      stream: responseStream,
      inputMode: smokeInputMode(options),
      contentTypes: requestContentTypes(body),
      text,
      usage: responseStream ? streamUsageFromBody(responseText) : extractProviderUsage(parsed)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runProviderModels(options = {}) {
  const profile = buildProfile(options, { requireModel: false });
  const endpoint = modelsEndpointFor(profile);
  const headers = headersFor(profile);
  if (!endpoint) {
    return {
      ok: false,
      models: true,
      profile: profile.id,
      protocol: profile.protocol,
      endpoint: "",
      error: "Model list is not supported for this profile"
    };
  }
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      models: true,
      profile: profile.id,
      protocol: profile.protocol,
      endpoint,
      request: {
        method: "GET",
        headerNames: Object.keys(headers || {}).sort()
      }
    };
  }

  const timeoutMs = Math.max(numberOption(options.timeoutMs, 30000), 1000);
  const maxPages = clampInteger(options.maxPages, 1, 20, 5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const seenUrls = new Set();
  const requests = [];
  const items = [];
  let nextUrl = endpoint;
  try {
    for (let page = 0; nextUrl && page < maxPages; page += 1) {
      if (seenUrls.has(nextUrl)) break;
      seenUrls.add(nextUrl);
      requests.push(nextUrl);
      const response = await fetch(nextUrl, {
        method: "GET",
        headers,
        signal: controller.signal
      });
      const rawText = await response.text();
      const parsed = parseResponseBody(rawText);
      if (!response.ok) {
        return {
          ok: false,
          models: true,
          status: response.status,
          profile: profile.id,
          protocol: profile.protocol,
          endpoint: nextUrl,
          error: providerErrorText(parsed, rawText)
        };
      }
      const responseError = providerResponseErrorText(parsed);
      if (responseError) {
        return {
          ok: false,
          models: true,
          status: response.status,
          profile: profile.id,
          protocol: profile.protocol,
          endpoint: nextUrl,
          error: responseError
        };
      }
      items.push(...modelListItemsFromResponse(parsed));
      nextUrl = nextModelListURL(nextUrl, parsed);
    }
    const modelOptions = modelOptionsFromItems(items);
    return {
      ok: true,
      models: true,
      profile: profile.id,
      protocol: profile.protocol,
      endpoint,
      pages: requests.length,
      truncated: Boolean(nextUrl),
      modelCount: modelOptions.length,
      modelIds: modelOptions.map((option) => option.id),
      modelOptions
    };
  } finally {
    clearTimeout(timer);
  }
}

export function runProviderCatalog(_options = {}) {
  const profiles = readDefaultProfiles();
  const results = profiles.map(catalogProfileResult);
  const checked = results.filter((result) => !result.skipped);
  const skipped = results.filter((result) => result.skipped);
  return {
    ok: results.every((result) => result.ok),
    catalog: true,
    profileCount: profiles.length,
    checked: checked.length,
    skipped: skipped.length,
    results
  };
}

export async function runMockProviderSmoke(options = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const bodyText = await readRequestBody(request);
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const body = bodyText ? JSON.parse(bodyText) : {};
    requests.push({
      method: request.method,
      path,
      headerNames: Object.keys(request.headers || {}).map((key) => key.toLowerCase()).sort(),
      body
    });
    if (body?.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(mockProviderStreamResponse(path));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(mockProviderResponse(path)));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock provider server did not bind to a TCP port");
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const cases = mockSmokeCases(options, baseURL);
    const results = [];
    for (const entry of cases) {
      results.push(await runProviderSmoke({
        ...options,
        mock: false,
        dryRun: false,
        profile: entry.profile,
        baseURL: entry.baseURL,
        apiKey: "mock-secret",
        model: entry.model
      }));
    }
    return {
      ok: results.every((result) => result.ok),
      mock: true,
      inputMode: smokeInputMode(options),
      baseURL,
      results,
      requests: requests.map(mockRequestSummary)
    };
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

function mockSmokeCases(options, baseURL) {
  const multimodal = Boolean(options.image || options.pdf);
  if (options.pdf) {
    return [
      { profile: "openai", baseURL: `${baseURL}/v1`, model: "mock-responses" },
      { profile: "openai-responses-compatible", baseURL: `${baseURL}/v1`, model: "mock-responses-compatible" },
      { profile: "anthropic", baseURL, model: "mock-anthropic" }
    ];
  }
  return [
    { profile: "openai-compatible", baseURL: `${baseURL}/v1`, model: multimodal ? "mock-chat-vision" : "mock-chat" },
    { profile: "openai", baseURL: `${baseURL}/v1`, model: multimodal ? "mock-responses-vision" : "mock-responses" },
    { profile: "openai-responses-compatible", baseURL: `${baseURL}/v1`, model: multimodal ? "mock-responses-compatible-vision" : "mock-responses-compatible" },
    { profile: "anthropic", baseURL, model: multimodal ? "mock-anthropic-vision" : "mock-anthropic" }
  ];
}

export async function runMockProviderModels(options = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const bodyText = await readRequestBody(request);
    const url = new URL(request.url || "/", "http://127.0.0.1");
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headerNames: Object.keys(request.headers || {}).map((key) => key.toLowerCase()).sort(),
      body: bodyText ? JSON.parse(bodyText) : {}
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(mockModelListResponse(url)));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock provider server did not bind to a TCP port");
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const cases = [
      { profile: "openai-compatible", baseURL: `${baseURL}/v1` },
      { profile: "openai", baseURL: `${baseURL}/v1` },
      { profile: "openai-responses-compatible", baseURL: `${baseURL}/v1` },
      { profile: "anthropic", baseURL }
    ];
    const results = [];
    for (const entry of cases) {
      results.push(await runProviderModels({
        ...options,
        mock: false,
        models: false,
        dryRun: false,
        profile: entry.profile,
        baseURL: entry.baseURL,
        apiKey: "mock-secret",
        maxPages: 5
      }));
    }
    return {
      ok: results.every((result) => result.ok),
      mock: true,
      models: true,
      baseURL,
      results,
      requests: requests.map(modelRequestSummary)
    };
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

function parseArgs(args) {
  const options = {
    profile: "openai-compatible",
    apiKeyEnv: "",
    apiKey: "",
    baseURL: "",
    fullURL: "",
    endpointMode: "",
    protocol: "",
    model: "",
    prompt: "",
    context: "",
    system: "",
    timeoutMs: 30000,
    maxOutputTokens: 64,
    temperature: 0,
    maxPages: 5,
    customHeaders: {},
    bodyExtra: {},
    capabilities: {},
    models: false,
    image: false,
    pdf: false,
    dryRun: false,
    mock: false,
    json: false,
    catalog: false,
    stream: false,
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--help" || key === "-h") {
      options.help = true;
    } else if (key === "--profile" && value) {
      options.profile = value;
      index += 1;
    } else if (key === "--api-key-env" && value) {
      options.apiKeyEnv = value;
      index += 1;
    } else if (key === "--api-key" && value) {
      options.apiKey = value;
      index += 1;
    } else if (key === "--base-url" && value) {
      options.baseURL = value;
      index += 1;
    } else if (key === "--full-url" && value) {
      options.fullURL = value;
      options.endpointMode = "full_url";
      index += 1;
    } else if (key === "--protocol" && value) {
      options.protocol = value;
      index += 1;
    } else if (key === "--model" && value) {
      options.model = value;
      index += 1;
    } else if (key === "--prompt" && value) {
      options.prompt = value;
      index += 1;
    } else if (key === "--context" && value) {
      options.context = value;
      index += 1;
    } else if (key === "--system" && value) {
      options.system = value;
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
    } else if (key === "--max-pages" && value) {
      options.maxPages = Number(value) || options.maxPages;
      index += 1;
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
    } else if (key === "--dry-run") {
      options.dryRun = true;
    } else if (key === "--models") {
      options.models = true;
    } else if (key === "--image") {
      options.image = true;
    } else if (key === "--pdf") {
      options.pdf = true;
    } else if (key === "--stream") {
      options.stream = true;
    } else if (key === "--mock") {
      options.mock = true;
    } else if (key === "--catalog") {
      options.catalog = true;
    } else if (key === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${key}`);
    }
  }
  return options;
}

function smokeInput(options) {
  const images = options.image
    ? [{ name: "smoke.png", mimeType: "image/png", base64: DEFAULT_IMAGE_BASE64 }]
    : [];
  if (options.pdf) {
    return {
      type: "pdf_base64",
      filename: "smoke.pdf",
      base64: DEFAULT_PDF_BASE64,
      images
    };
  }
  return {
    type: "text",
    text: String(options.context || DEFAULT_CONTEXT),
    images
  };
}

function smokeInputMode(options) {
  if (options.pdf && options.image) return "pdf+image";
  if (options.pdf) return "pdf";
  if (options.image) return "image";
  return "text";
}

function buildProfile(options, requirements = {}) {
  const requireModel = requirements.requireModel !== false;
  const requireAuth = requirements.requireAuth !== false;
  const defaults = defaultProfile(options.profile);
  const apiKey = options.apiKey || (options.apiKeyEnv ? process.env[options.apiKeyEnv] : "") || defaults.apiKey || "";
  const profile = {
    ...defaults,
    protocol: normalizeProtocol(options.protocol || defaults.protocol),
    endpointMode: options.endpointMode || defaults.endpointMode || "base_url",
    baseURL: options.baseURL || defaults.baseURL || "",
    fullURL: options.fullURL || defaults.fullURL || "",
    apiKey,
    model: options.model || defaults.model || "",
    capabilities: {
      ...defaultCapabilities,
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
  if (profile.bodyExtra?.localAgent) {
    throw new Error("Local Agents profiles use the local-agent service checks, not provider smoke verification");
  }
  if (requireModel && !profile.model) {
    throw new Error("Model is required. Pass --model or choose a profile with a default model.");
  }
  if (requireAuth && !profileHasUsableAuth(profile)) {
    throw new Error("API key or explicit auth header is required. Pass --api-key-env, --api-key, or --header Authorization=...");
  }
  return profile;
}

function defaultProfile(id) {
  const profiles = readDefaultProfiles();
  const normalized = profileKey(id);
  const profile = profiles.find((candidate) => profileKey(candidate.id) === normalized);
  if (!profile) throw new Error(`Unknown provider profile: ${id}`);
  return profile;
}

function readDefaultProfiles() {
  const prefsPath = resolve(process.cwd(), "addon/prefs.js");
  if (!existsSync(prefsPath)) throw new Error(`Missing ${prefsPath}`);
  const prefs = readFileSync(prefsPath, "utf8");
  const match = prefs.match(/pref\("profilesJson",\s*"((?:\\.|[^"\\])*)"\);/);
  if (!match) throw new Error("profilesJson preference is missing");
  return JSON.parse(JSON.parse(`"${match[1]}"`));
}

function catalogProfileResult(defaultProfile) {
  const id = String(defaultProfile?.id || "").trim();
  if (defaultProfile?.bodyExtra?.localAgent || defaultProfile?.bodyExtra?.agent || defaultProfile?.bodyExtra?.subagent) {
    return {
      ok: true,
      skipped: true,
      id,
      protocol: defaultProfile?.protocol || "",
      reason: "Local Agents profiles are verified by local-agent service checks"
    };
  }
  try {
    const profile = {
      ...defaultProfile,
      protocol: normalizeProtocol(defaultProfile.protocol),
      endpointMode: defaultProfile.endpointMode || "base_url",
      baseURL: defaultProfile.baseURL || "",
      fullURL: defaultProfile.fullURL || "",
      apiKey: "",
      model: defaultProfile.model || `${id || "provider"}-catalog-model`,
      capabilities: {
        ...defaultCapabilities,
        ...(defaultProfile.capabilities || {})
      },
      customHeaders: { ...(defaultProfile.customHeaders || {}) },
      bodyExtra: { ...(defaultProfile.bodyExtra || {}) }
    };
    const request = catalogSmokeRequest(profile, catalogTextInput());
    const endpoint = endpointFor(request);
    if (!isLocalEndpoint(endpoint)) profile.apiKey = "catalog-secret";
    const headers = headersFor(profile);
    const body = bodyFor(catalogSmokeRequest(profile, catalogTextInput()));
    const modelsEndpoint = modelsEndpointFor(profile) || "";
    const inputChecks = catalogInputChecks(profile);
    const issues = [
      ...catalogProfileIssues(profile, endpoint, headers, body, modelsEndpoint),
      ...inputChecks.flatMap((check) => check.issues.map((issue) => `${check.mode}: ${issue}`))
    ];
    return {
      ok: issues.length === 0,
      skipped: false,
      id,
      name: defaultProfile.name || "",
      protocol: profile.protocol,
      endpoint,
      modelsEndpoint,
      modelList: profile.capabilities.modelList !== false,
      localEndpoint: isLocalEndpoint(endpoint),
      headerNames: Object.keys(headers || {}).sort(),
      authHeaderNames: authHeaderNames(headers),
      bodyKeys: Object.keys(body || {}).sort(),
      contentTypes: requestContentTypes(body),
      inputChecks,
      issues
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      id,
      protocol: defaultProfile?.protocol || "",
      endpoint: "",
      modelsEndpoint: "",
      issues: [error?.message || String(error)]
    };
  }
}

function catalogSmokeRequest(profile, input) {
  return {
    profile,
    system: "You are a provider catalog verifier.",
    messages: [{ role: "user", content: DEFAULT_PROMPT }],
    input,
    temperature: 0,
    maxOutputTokens: 64,
    stream: false
  };
}

function catalogTextInput() {
  return { type: "text", text: DEFAULT_CONTEXT };
}

function catalogImageInput() {
  return {
    type: "text",
    text: DEFAULT_CONTEXT,
    images: [{ name: "catalog.png", mimeType: "image/png", base64: DEFAULT_IMAGE_BASE64 }]
  };
}

function catalogPDFInput() {
  return {
    type: "pdf_base64",
    filename: "catalog.pdf",
    base64: DEFAULT_PDF_BASE64
  };
}

function catalogInputChecks(profile) {
  const checks = [
    catalogInputCheck(profile, "text", catalogTextInput(), true)
  ];
  checks.push(catalogInputCheck(profile, "image", catalogImageInput(), profile.capabilities?.imageBase64 === true));
  checks.push(catalogInputCheck(profile, "pdf", catalogPDFInput(), profile.capabilities?.pdfBase64 === true));
  return checks;
}

function catalogInputCheck(profile, mode, input, supported) {
  try {
    const body = bodyFor(catalogSmokeRequest(profile, input));
    const contentTypes = requestContentTypes(body);
    const issues = catalogInputIssues(profile, mode, contentTypes);
    if (!supported) {
      issues.push(`${mode} request body was accepted while capability is disabled`);
    }
    return {
      mode,
      supported,
      ok: supported && issues.length === 0,
      contentTypes,
      issues
    };
  } catch (error) {
    if (!supported && expectedUnsupportedCatalogInputError(mode, error)) {
      return {
        mode,
        supported,
        ok: true,
        rejected: true,
        contentTypes: [],
        issues: []
      };
    }
    return {
      mode,
      supported,
      ok: false,
      contentTypes: [],
      issues: [error?.message || String(error)]
    };
  }
}

function catalogInputIssues(profile, mode, contentTypes) {
  if (mode === "text") return contentTypes.includes("text") || contentTypes.includes("input_text") || !contentTypes.length
    ? []
    : ["text input did not produce a text content block"];
  if (mode === "image") {
    const expected = profile.protocol === "openai_responses"
      ? "input_image"
      : profile.protocol === "anthropic_messages"
        ? "image"
        : "image_url";
    return contentTypes.includes(expected) ? [] : [`missing ${expected} image content block`];
  }
  if (mode === "pdf") {
    const expected = profile.protocol === "openai_responses"
      ? "input_file"
      : profile.protocol === "anthropic_messages"
        ? "document"
        : "";
    if (!expected) return ["PDF input is not valid for OpenAI Chat Completions profiles"];
    return contentTypes.includes(expected) ? [] : [`missing ${expected} PDF content block`];
  }
  return [];
}

function expectedUnsupportedCatalogInputError(mode, error) {
  const message = String(error?.message || error || "");
  if (mode === "image") return /image input/i.test(message);
  if (mode === "pdf") return /PDF base64|extracted text input/i.test(message);
  return false;
}

function catalogProfileIssues(profile, endpoint, headers, body, modelsEndpoint) {
  const issues = [];
  if (!endpoint) issues.push("missing generation endpoint");
  const localEndpoint = isLocalEndpoint(endpoint);
  const authNames = authHeaderNames(headers);
  if (!localEndpoint && !authNames.length) issues.push("missing auth header for remote endpoint");
  if (profile.capabilities?.modelList === false && modelsEndpoint) issues.push("model-list endpoint present while capability is disabled");
  if (profile.capabilities?.modelList !== false && !modelsEndpoint) issues.push("missing model-list endpoint while capability is enabled");
  if (profile.protocol === "openai_chat") {
    if (!Array.isArray(body?.messages)) issues.push("openai_chat body missing messages");
    if (!Object.prototype.hasOwnProperty.call(body || {}, "max_tokens")) issues.push("openai_chat body missing max_tokens");
  } else if (profile.protocol === "openai_responses") {
    if (!Array.isArray(body?.input)) issues.push("openai_responses body missing input");
    if (!Object.prototype.hasOwnProperty.call(body || {}, "max_output_tokens")) issues.push("openai_responses body missing max_output_tokens");
  } else if (profile.protocol === "anthropic_messages") {
    if (!Array.isArray(body?.messages)) issues.push("anthropic_messages body missing messages");
    if (!Object.prototype.hasOwnProperty.call(body || {}, "max_tokens")) issues.push("anthropic_messages body missing max_tokens");
    if (!hasHeader(headers, "anthropic-version")) issues.push("anthropic_messages headers missing anthropic-version");
  }
  return issues;
}

function authHeaderNames(headers) {
  return Object.keys(headers || {})
    .filter((key) => ["authorization", "api-key", "x-api-key"].includes(key.toLowerCase()))
    .sort();
}

function hasHeader(headers, name) {
  const normalized = String(name || "").toLowerCase();
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === normalized);
}

function profileKey(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function normalizeProtocol(value) {
  const protocol = String(value || "").trim();
  if (protocol === "openai_chat" || protocol === "openai_responses" || protocol === "anthropic_messages") return protocol;
  throw new Error(`Unsupported provider protocol: ${value}`);
}

function hasAuthHeader(headers) {
  return Object.entries(headers || {}).some(([key, value]) =>
    ["authorization", "api-key", "x-api-key"].includes(String(key).toLowerCase()) && String(value || "").trim()
  );
}

function profileHasUsableAuth(profile) {
  if (String(profile?.apiKey || "").trim()) return true;
  if (hasAuthHeader(profile?.customHeaders)) return true;
  try {
    const endpoint = profile?.endpointMode === "full_url"
      ? profile.fullURL || profile.baseURL
      : endpointFor({ profile, system: "", messages: [], temperature: 0, maxOutputTokens: 1, stream: false });
    return isLocalEndpoint(endpoint);
  } catch (_err) {
    return false;
  }
}

function isLocalEndpoint(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
}

function sanitizedRequest(headers, body) {
  return {
    headerNames: Object.keys(headers || {}).sort(),
    body
  };
}

function parseResponseBody(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_err) {
    return { text };
  }
}

function streamTextFromBody(protocol, rawText) {
  let text = "";
  for (const record of streamRecords(rawText)) {
    const delta = parseStreamChunk(protocol, record);
    if (delta) text += delta;
  }
  if (!text.trim()) throw new Error("No text returned from model");
  return text.trim();
}

function streamUsageFromBody(rawText) {
  return streamRecords(rawText)
    .map((record) => parseStreamUsage(record))
    .filter(Boolean)
    .reduce((merged, usage) => mergeProviderUsage(merged, usage), null);
}

function mergeProviderUsage(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  const merged = {};
  for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens"]) {
    const values = [left[key], right[key]].filter((value) => typeof value === "number" && Number.isFinite(value));
    if (values.length) merged[key] = Math.max(...values);
  }
  const totalValues = [
    left.totalTokens,
    right.totalTokens,
    merged.inputTokens !== undefined || merged.outputTokens !== undefined
      ? (merged.inputTokens || 0) + (merged.outputTokens || 0)
      : undefined
  ].filter((value) => typeof value === "number" && Number.isFinite(value));
  if (totalValues.length) merged.totalTokens = Math.max(...totalValues);
  return Object.keys(merged).length ? merged : null;
}

function streamRecords(rawText) {
  const records = [];
  let recordLines = [];
  const flush = () => {
    if (!recordLines.length) return;
    records.push(recordLines.join("\n"));
    recordLines = [];
  };
  for (const line of String(rawText || "").split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (shouldStartNewStreamRecord(recordLines, line)) flush();
    recordLines.push(line);
  }
  flush();
  return records;
}

function shouldStartNewStreamRecord(recordLines, nextLine) {
  if (!recordLines.length || !isStreamFieldLine(nextLine)) return false;
  return streamPayloads(recordLines.join("\n")).some((payload) => payload === "[DONE]" || !!parseResponseBodySafe(payload));
}

function streamPayloads(record) {
  const dataLines = String(record || "")
    .split(/\r?\n/)
    .map((line) => sseFieldValue(line, "data"))
    .filter((value) => value !== undefined);
  if (!dataLines.length) return [];
  const joined = dataLines.join("\n").trim();
  if (!joined) return [];
  if (dataLines.length === 1 || joined === "[DONE]" || parseResponseBodySafe(joined)) return [joined];
  return dataLines.map((line) => String(line || "").trim()).filter(Boolean);
}

function sseFieldValue(line, field) {
  const text = String(line || "");
  const index = text.indexOf(":");
  if (index < 0 || text.slice(0, index).trim() !== field) return undefined;
  const value = text.slice(index + 1);
  return value.startsWith(" ") ? value.slice(1) : value;
}

function parseResponseBodySafe(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function isStreamFieldLine(line) {
  return /^(?:data|event|id|retry):/i.test(String(line || "").trim());
}

function mockModelListResponse(url) {
  if (url.searchParams.get("after_id") || url.searchParams.get("page_token") || url.searchParams.get("after") || url.searchParams.get("page")) {
    return {
      body: {
        model_list: [
          { id: "mock-model-c", display_name: "Mock Model C" },
          { id: "mock-model-a" }
        ],
        has_more: false
      }
    };
  }
  return {
    data: [
      { id: "mock-model-b", display_name: "Mock Model B" },
      { id: "mock-model-a" }
    ],
    has_more: true,
    last_id: "mock-model-b"
  };
}

function mockProviderResponse(path) {
  if (path.endsWith("/responses")) return { output_text: "OK responses", usage: { total_tokens: 3 } };
  if (path.endsWith("/messages")) return { content: [{ type: "text", text: "OK anthropic" }], usage: { input_tokens: 1, output_tokens: 2 } };
  return { choices: [{ message: { content: "OK chat" } }], usage: { total_tokens: 3 } };
}

function mockProviderStreamResponse(path) {
  if (path.endsWith("/responses")) {
    return [
      "event: response.output_text.delta",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK \"}",
      "",
      "event: response.output_text.delta",
      "data: {",
      "data: \"type\":\"response.output_text.delta\",",
      "data: \"delta\":\"responses\"",
      "data: }",
      "",
      "event: response.completed",
      "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":1,\"total_tokens\":3}}}",
      "",
      "data: [DONE]",
      ""
    ].join("\n");
  }
  if (path.endsWith("/messages")) {
    return [
      "event: content_block_delta",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"OK \"}}",
      "",
      "event: content_block_delta",
      "data: {",
      "data: \"type\":\"content_block_delta\",",
      "data: \"delta\":{\"type\":\"text_delta\",\"text\":\"anthropic\"}",
      "data: }",
      "",
      "event: message_delta",
      "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2}}",
      "",
      "data: [DONE]",
      ""
    ].join("\n");
  }
  return [
    "data: {\"choices\":[{\"delta\":{\"content\":\"OK \"}}]}",
    "data: {\"choices\":[{\"delta\":{\"content\":\"chat\"}}]}",
    "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}",
    "data: [DONE]",
    ""
  ].join("\n");
}

function modelRequestSummary(request) {
  return {
    method: request.method,
    path: request.path,
    headerNames: request.headerNames
  };
}

function mockRequestSummary(request) {
  return {
    method: request.method,
    path: request.path,
    headerNames: request.headerNames,
    model: request.body?.model || "",
    bodyKeys: Object.keys(request.body || {}).sort(),
    contentTypes: requestContentTypes(request.body)
  };
}

function modelOptionsFromItems(source) {
  const options = new Map();
  for (const item of source) {
    const option = modelOptionFromItem(item);
    if (option.id && !options.has(option.id)) options.set(option.id, option);
  }
  return [...options.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function modelOptionFromItem(item) {
  if (typeof item === "string") return { id: item, label: item };
  const id = stringField(item?.id, item?.model, item?.model_id, item?.modelId, item?.model_name, item?.modelName, item?.name, item?.value, item?.slug);
  const label = stringField(item?.display_name, item?.displayName, item?.label, item?.title, item?.model_name, item?.modelName, item?.name, id);
  return { id, label };
}

function modelListItemsFromResponse(data, depth = 0) {
  const direct = directModelListItemsFromResponse(data);
  if (direct.length) return direct;
  if (depth >= 2 || !data || typeof data !== "object" || Array.isArray(data)) return [];
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const items = modelListItemsFromResponse(value, depth + 1);
    if (items.length) return items;
  }
  return [];
}

function nextModelListURL(currentUrl, data) {
  const envelope = modelListPaginationEnvelope(data);
  if (!envelope) return "";
  const direct = stringField(envelope.next_page, envelope.nextPage, envelope.next);
  if (direct) return modelListURLFromNextValue(currentUrl, direct);
  if (envelope.has_more !== true && envelope.hasMore !== true) return "";
  const tokenPairs = [
    ["after_id", stringField(envelope.last_id, envelope.lastId, envelope.after_id, envelope.afterId)],
    ["page_token", stringField(envelope.next_page_token, envelope.nextPageToken, envelope.next_token, envelope.nextToken)],
    ["after", stringField(envelope.next_cursor, envelope.nextCursor, envelope.cursor, envelope.after)]
  ];
  for (const [param, token] of tokenPairs) {
    if (token) return urlWithQueryParam(currentUrl, param, token);
  }
  return "";
}

function directModelListItemsFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.model)) return data.model;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.model_list)) return data.model_list;
  if (Array.isArray(data?.modelList)) return data.modelList;
  if (Array.isArray(data?.available_models)) return data.available_models;
  if (Array.isArray(data?.availableModels)) return data.availableModels;
  if (Array.isArray(data?.model_names)) return data.model_names;
  if (Array.isArray(data?.modelNames)) return data.modelNames;
  if (Array.isArray(data?.models?.data)) return data.models.data;
  if (Array.isArray(data?.models?.items)) return data.models.items;
  return [];
}

function modelListPaginationEnvelope(data, depth = 0) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (hasModelListPaginationFields(data)) return data;
  if (depth >= 2) return null;
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const envelope = modelListPaginationEnvelope(value, depth + 1);
    if (envelope) return envelope;
  }
  return null;
}

function hasModelListPaginationFields(data) {
  return !!stringField(data?.next_page, data?.nextPage, data?.next)
    || data?.has_more === true
    || data?.hasMore === true;
}

function modelListURLFromNextValue(currentUrl, nextValue) {
  if (/^https?:\/\//i.test(nextValue) || nextValue.startsWith("/") || nextValue.startsWith("?")) {
    return resolveModelListURL(currentUrl, nextValue);
  }
  return urlWithQueryParam(currentUrl, "page", nextValue);
}

function resolveModelListURL(currentUrl, nextValue) {
  try {
    return new URL(nextValue, currentUrl).toString();
  } catch (_err) {
    return "";
  }
}

function urlWithQueryParam(currentUrl, param, value) {
  try {
    const url = new URL(currentUrl);
    url.searchParams.set(param, value);
    return url.toString();
  } catch (_err) {
    return "";
  }
}

function stringField(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function requestContentTypes(body) {
  if (Array.isArray(body?.input)) {
    return body.input
      .flatMap((message) => Array.isArray(message?.content) ? message.content : [])
      .map((part) => part?.type)
      .filter(Boolean);
  }
  if (Array.isArray(body?.messages)) {
    return body.messages
      .flatMap((message) => Array.isArray(message?.content) ? message.content : [])
      .map((part) => part?.type)
      .filter(Boolean);
  }
  return [];
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function providerSmokeResponseNeedsFallback(protocol, response, body, responseText, parsed) {
  if (!response?.ok) return true;
  if (Number(response?.status) !== 200) return false;
  if (!providerResponseErrorText(parsed)) return false;
  return providerCompatibilityFallbackFields(protocol, body, 200, responseText).length > 0;
}

function providerErrorText(parsed, rawText) {
  const responseError = providerResponseErrorText(parsed);
  if (responseError) return responseError;
  const error = parsed?.error || parsed;
  if (typeof error === "string") return redactSecret(error);
  const code = error?.code || error?.type || "";
  const message = error?.message || rawText || "";
  return [code, redactSecret(message)].filter(Boolean).join(" - ");
}

function providerResponseErrorText(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  const direct = directProviderResponseErrorText(parsed);
  if (direct) return direct;
  if (Array.isArray(parsed)) return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = parsed?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = providerResponseErrorText(value);
    if (nested) return nested;
  }
  return "";
}

function directProviderResponseErrorText(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const error = parsed.error || (parsed.type === "error" ? parsed : null);
  if (!error && !Array.isArray(parsed.errors)) {
    const message = stringField(parsed.message, parsed.detail, parsed.error_description, parsed.errorMessage, parsed.error_message);
    const code = stringField(parsed.code, parsed.error_code, parsed.errorCode);
    const type = stringField(parsed.type, parsed.error_type, parsed.errorType);
    const status = stringField(parsed.status, parsed.status_code, parsed.statusCode);
    const statusText = status.toLowerCase();
    const typeText = type.toLowerCase();
    const looksLikeError = parsed.ok === false
      || parsed.success === false
      || /^(error|failed|failure|invalid|unauthorized|forbidden)$/i.test(statusText)
      || /error|invalid|unauth|forbidden|denied|rate|limit|unsupported/.test(typeText)
      || !!code;
    return message && looksLikeError
      ? [code, type, status, redactSecret(message)].filter(Boolean).join(" - ")
      : "";
  }
  if (Array.isArray(parsed.errors) && parsed.errors.length) {
    return parsed.errors.map((entry) => directProviderResponseErrorText({ error: entry })).filter(Boolean).join("; ");
  }
  if (typeof error === "string") return redactSecret(error);
  const code = error.code || parsed.code || "";
  const type = normalizedProviderErrorType(error.type);
  const message = error.message || parsed.message || error.detail || parsed.detail || error.error_description || parsed.error_description || JSON.stringify(error);
  return [code, type, redactSecret(message)].filter(Boolean).join(" - ");
}

function normalizedProviderErrorType(value) {
  const type = stringField(value);
  return type.toLowerCase() === "error" ? "" : type;
}

function redactSecret(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ak|xai|gsk|pplx|ms|rk)[-_][A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]");
}

function numberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function splitAssignment(value, flag) {
  const index = String(value || "").indexOf("=");
  if (index <= 0) throw new Error(`${flag} expects name=value`);
  return [value.slice(0, index).trim(), value.slice(index + 1)];
}

function parseJSONOption(value, flag) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || "{}"));
  } catch (error) {
    throw new Error(`${flag} must be valid JSON: ${error?.message || String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON object`);
  }
  return parsed;
}

function formatReport(report) {
  if (report.catalog) {
    const lines = [
      report.ok ? "Provider catalog verification passed" : "Provider catalog verification failed",
      `profiles: ${report.profileCount}`,
      `checked: ${report.checked}`,
      `skipped: ${report.skipped}`
    ];
    for (const result of report.results || []) {
      if (result.skipped) {
        lines.push(`${result.id}: skipped (${result.reason})`);
      } else {
        lines.push(`${result.id}: ${result.protocol} ${result.endpoint} -> ${result.ok ? "OK" : `FAILED ${result.issues?.join("; ")}`}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
  if (report.mock && report.models) {
    const lines = [
      "Provider mock model-list verification passed",
      `baseURL: ${report.baseURL}`
    ];
    for (const result of report.results || []) {
      lines.push(`${result.profile}: ${result.protocol} ${result.endpoint} -> ${result.modelCount || 0} model(s)`);
    }
    return `${lines.join("\n")}\n`;
  }
  if (report.mock) {
    const lines = [
      report.results?.some((result) => result.stream) ? "Provider mock stream smoke passed" : "Provider mock smoke passed",
      `baseURL: ${report.baseURL}`
    ];
    for (const result of report.results || []) {
      lines.push(`${result.profile}: ${result.protocol} ${result.endpoint} -> ${result.text || result.error || ""}`);
    }
    return `${lines.join("\n")}\n`;
  }
  if (report.dryRun) {
    return [
      report.models ? "Provider model-list dry run passed" : "Provider smoke dry run passed",
      `profile: ${report.profile}`,
      `protocol: ${report.protocol}`,
      `endpoint: ${report.endpoint}`,
      `headers: ${report.request.headerNames.join(", ")}`
    ].join("\n") + "\n";
  }
  if (report.models && !report.ok) {
    return [
      "Provider model-list verification failed",
      `profile: ${report.profile}`,
      `protocol: ${report.protocol}`,
      `endpoint: ${report.endpoint}`,
      `status: ${report.status || ""}`,
      `error: ${report.error || ""}`
    ].join("\n") + "\n";
  }
  if (report.models) {
    return [
      "Provider model-list verification passed",
      `profile: ${report.profile}`,
      `protocol: ${report.protocol}`,
      `endpoint: ${report.endpoint}`,
      `models: ${report.modelCount}`,
      `sample: ${(report.modelIds || []).slice(0, 5).join(", ")}`
    ].join("\n") + "\n";
  }
  if (!report.ok) {
    return [
      "Provider smoke failed",
      `profile: ${report.profile}`,
      `protocol: ${report.protocol}`,
      `endpoint: ${report.endpoint}`,
      `status: ${report.status || ""}`,
      `error: ${report.error || ""}`
    ].join("\n") + "\n";
  }
  return [
    "Provider smoke passed",
    `profile: ${report.profile}`,
    `protocol: ${report.protocol}`,
    `endpoint: ${report.endpoint}`,
    `model: ${report.model}`,
    `stream: ${report.stream ? "true" : "false"}`,
    `text: ${report.text}`
  ].join("\n") + "\n";
}

function usage() {
  return [
    "Usage:",
    "  npm run verify:provider -- --profile openai --api-key-env OPENAI_API_KEY --model MODEL",
    "  npm run verify:provider -- --profile anthropic --api-key-env ANTHROPIC_API_KEY --model MODEL",
    "  npm run verify:provider -- --profile openai-compatible --base-url http://127.0.0.1:8000/v1 --api-key test --model model",
    "  npm run verify:provider -- --profile openai-responses-compatible --base-url http://127.0.0.1:8000/v1 --api-key test --model model",
    "  npm run verify:provider:catalog",
    "  npm run verify:provider:models:mock",
    "  npm run verify:provider:mock",
    "",
    "Options:",
    "  --profile ID              Default provider profile id from addon/prefs.js",
    "  --api-key-env NAME        Read API key from an environment variable",
    "  --api-key VALUE           API key value for this smoke run",
    "  --base-url URL            Override profile baseURL",
    "  --full-url URL            Use a full request URL",
    "  --protocol NAME           Override protocol: openai_chat, openai_responses, anthropic_messages",
    "  --model MODEL             Override model",
    "  --max-pages NUMBER        Maximum model-list pages to follow",
    "  --header name=value       Add or override a request header",
    "  --body-extra-json JSON    Merge extra provider body fields; omitFields removes top-level body fields",
    "  --capabilities-json JSON  Override profile capabilities for this verification run",
    "  --models                 Verify model-list endpoint instead of text generation",
    "  --image                  Include a tiny base64 PNG in the generation request",
    "  --pdf                    Include a tiny base64 PDF in the generation request",
    "  --stream                 Verify streaming generation with text/event-stream responses",
    "  --mock                   Run built-in local mock checks for chat, responses, and messages",
    "  --catalog                Verify all default provider profile request shapes offline",
    "  --dry-run                 Print sanitized request shape without calling the endpoint",
    "  --json                    Print machine-readable JSON"
  ].join("\n") + "\n";
}

function isMainModule() {
  const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
  return import.meta.url === entry || fileURLToPath(import.meta.url) === process.argv[1];
}
