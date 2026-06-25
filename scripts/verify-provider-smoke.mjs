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
  providerCompatibilityFallbackFields,
  providerRequestHeadersWithFallback
} from "../src/providerAdapters.ts";

const PROVIDER_RESPONSE_WRAPPER_KEYS = ["data", "result", "payload", "response", "message", "body", "completion"];
const MODEL_LIST_RESPONSE_WRAPPER_KEYS = [...PROVIDER_RESPONSE_WRAPPER_KEYS, "meta", "metadata", "pagination", "paging", "page", "links"];
const DEFAULT_PROMPT = "Reply with OK only.";
const DEFAULT_CONTEXT = "Provider smoke-test context.";
const DEFAULT_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const DEFAULT_PDF_BASE64 = "JVBERi0xLjQKMSAwIG9iago8PD4+CmVuZG9iagp0cmFpbGVyCjw8Pj4KJSVFT0YK";
const PROVIDER_RETRY_DELAY_MAX_MS = 10000;
const PROVIDER_GENERATION_MAX_ATTEMPTS = 4;
const PROVIDER_MODEL_LIST_MAX_ATTEMPTS = 4;

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
  let headers = headersFor(profile);
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
    const retryDelaysMs = [];
    let response;
    let responseText = "";
    let parsed = null;
    const applyFallbackFields = (fields) => {
      body = omitProviderRequestBodyFields(body, fields, usedCompatibilityFallbackFields);
      headers = providerRequestHeadersWithFallback(headers, fields);
      usedCompatibilityFallbackFields.push(...fields);
      responseStream = body.stream === true;
    };
    const fetchGeneration = async () => {
      for (let attempt = 0; attempt < PROVIDER_GENERATION_MAX_ATTEMPTS; attempt += 1) {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        responseText = await response.text();
        parsed = parseResponseBody(responseText);
        const retryDelayMs = providerGenerationRetryDelayMs(response, attempt);
        if (retryDelayMs != null) {
          retryDelaysMs.push(retryDelayMs);
          await delay(retryDelayMs);
          continue;
        }
        break;
      }
    };
    const applyResponseFallbacks = async () => {
      while (providerSmokeResponseNeedsFallback(profile.protocol, response, body, responseText, parsed)) {
        const fields = providerCompatibilityFallbackFields(profile.protocol, body, response.status, responseText, usedCompatibilityFallbackFields);
        if (!fields.length) break;
        applyFallbackFields(fields);
        await fetchGeneration();
      }
    };
    await fetchGeneration();
    await applyResponseFallbacks();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        profile: profile.id,
        protocol: profile.protocol,
        endpoint,
        retryCount: retryDelaysMs.length,
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
        retryCount: retryDelaysMs.length,
        error: responseError
      };
    }
    let text = "";
    let usage = null;
    for (let parseAttempt = 0; parseAttempt < 4; parseAttempt += 1) {
      try {
        text = responseStream ? streamTextFromBody(profile.protocol, responseText) : extractResponseText(profile.protocol, parsed);
        usage = responseStream ? streamUsageFromBody(responseText) : extractProviderUsage(parsed);
        break;
      } catch (error) {
        const fields = responseStream
          ? providerStreamCompatibilityFallbackFields(profile.protocol, body, error, usedCompatibilityFallbackFields)
          : [];
        if (!fields.length || parseAttempt >= 3) throw error;
        applyFallbackFields(fields);
        await fetchGeneration();
        await applyResponseFallbacks();
        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            profile: profile.id,
            protocol: profile.protocol,
            endpoint,
            retryCount: retryDelaysMs.length,
            error: providerErrorText(parsed, responseText)
          };
        }
        const fallbackResponseError = providerResponseErrorText(parsed);
        if (fallbackResponseError) {
          return {
            ok: false,
            status: response.status,
            profile: profile.id,
            protocol: profile.protocol,
            endpoint,
            retryCount: retryDelaysMs.length,
            error: fallbackResponseError
          };
        }
      }
    }
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
      retryCount: retryDelaysMs.length,
      text,
      usage
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runProviderModels(options = {}) {
  const profile = buildProfile(options, { requireModel: false });
  const endpoint = modelsEndpointFor(profile);
  let headers = headersFor(profile);
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
  const usedCompatibilityFallbackFields = [];
  const retryDelaysMs = [];
  try {
    for (let page = 0; nextUrl && page < maxPages; page += 1) {
      if (seenUrls.has(nextUrl)) break;
      seenUrls.add(nextUrl);
      requests.push(nextUrl);
      let response;
      let rawText = "";
      let parsed = null;
      for (let attempt = 0; attempt < PROVIDER_MODEL_LIST_MAX_ATTEMPTS; attempt += 1) {
        response = await fetch(nextUrl, {
          method: "GET",
          headers,
          signal: controller.signal
        });
        rawText = await response.text();
        parsed = parseResponseBody(rawText);
        const fallbackFields = providerCompatibilityFallbackFields(profile.protocol, {}, response.status, rawText, usedCompatibilityFallbackFields);
        if (fallbackFields.length) {
          headers = providerRequestHeadersWithFallback(headers, fallbackFields);
          usedCompatibilityFallbackFields.push(...fallbackFields);
          continue;
        }
        const retryDelayMs = providerModelListRetryDelayMs(response, attempt);
        if (retryDelayMs != null) {
          retryDelaysMs.push(retryDelayMs);
          await delay(retryDelayMs);
          continue;
        }
        break;
      }
      if (!response.ok) {
        return {
          ok: false,
          models: true,
          status: response.status,
          profile: profile.id,
          protocol: profile.protocol,
          endpoint: nextUrl,
          retryCount: retryDelaysMs.length,
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
          retryCount: retryDelaysMs.length,
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
      retryCount: retryDelaysMs.length,
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
        capabilities: {
          ...(options.capabilities || {}),
          ...(entry.capabilities || {})
        },
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
    { profile: "openai-compatible", baseURL: `${baseURL}/v1`, model: multimodal ? "mock-chat-vision" : "mock-chat", capabilities: multimodal ? { imageBase64: true } : {} },
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
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
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
  if (!dataLines.length) return rawJSONStreamPayloads(record);
  const joined = dataLines.join("\n").trim();
  if (!joined) return [];
  if (dataLines.length === 1 || joined === "[DONE]" || parseResponseBodySafe(joined)) return [joined];
  return dataLines.map((line) => String(line || "").trim()).filter(Boolean);
}

function rawJSONStreamPayloads(record) {
  const trimmed = String(record || "").trim();
  if (!trimmed) return [];
  if (trimmed === "[DONE]" || parseResponseBodySafe(trimmed)) return [trimmed];
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line === "[DONE]" || !!parseResponseBodySafe(line));
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
        model_list: {
          "mock-model-c": { display_name: "Mock Model C" },
          "mock-model-a": {}
        },
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
      "{\"type\":\"response.output_text.delta\",\"delta\":\"\"}",
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
      "{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"\"}}",
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
    "",
    "{\"candidates\":[{\"content\":{\"parts\":[{\"type\":\"thinking\",\"text\":\"hidden\"},{\"text\":\"chat\"}]}}]}",
    "",
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

function modelOptionFromItem(item, depth = 0) {
  if (typeof item === "string") return { id: item, label: item };
  if (!item || typeof item !== "object") return { id: "", label: "" };
  const id = stringField(
    item?.id,
    item?.model,
    item?.model_id,
    item?.modelId,
    item?.model_name,
    item?.modelName,
    item?.deployment,
    item?.deployment_id,
    item?.deploymentId,
    item?.engine,
    item?.engine_id,
    item?.engineId,
    item?.uid,
    item?.key,
    item?.identifier,
    item?.canonical_slug,
    item?.canonicalSlug,
    item?.model_slug,
    item?.modelSlug,
    item?.name,
    item?.value,
    item?.slug
  );
  const label = stringField(
    item?.display_name,
    item?.displayName,
    item?.display_label,
    item?.displayLabel,
    item?.label,
    item?.title,
    item?.model_name,
    item?.modelName,
    item?.name,
    id
  );
  if (!id && depth < 2) {
    for (const key of ["node", "model", "deployment", "engine", "resource", "item", "value"]) {
      const nested = item?.[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const option = modelOptionFromItem(nested, depth + 1);
        if (option.id) return option;
      }
    }
  }
  return { id, label };
}

function modelListItemsFromResponse(data, depth = 0) {
  const direct = directModelListItemsFromResponse(data);
  if (direct.length) return direct;
  if (depth >= 2 || !data || typeof data !== "object" || Array.isArray(data)) return [];
  for (const key of MODEL_LIST_RESPONSE_WRAPPER_KEYS) {
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
  const direct = stringField(envelope.next_page, envelope.nextPage, envelope.next, envelope.next_url, envelope.nextUrl, envelope.nextPageUrl);
  if (direct) return modelListURLFromNextValue(currentUrl, direct);
  const hasMore = envelope.has_more === true || envelope.hasMore === true;
  const nextCursor = stringField(envelope.next_cursor, envelope.nextCursor);
  const nextPageToken = stringField(envelope.next_page_token, envelope.nextPageToken, envelope.next_token, envelope.nextToken);
  if (!hasMore && !nextCursor && !nextPageToken) return "";
  const tokenPairs = [
    ["after_id", stringField(envelope.last_id, envelope.lastId, envelope.after_id, envelope.afterId)],
    ["page_token", nextPageToken],
    ["cursor", nextCursor],
    ["after", hasMore ? stringField(envelope.cursor, envelope.after) : ""]
  ];
  for (const [param, token] of tokenPairs) {
    if (token) return urlWithQueryParam(currentUrl, param, token);
  }
  return "";
}

function directModelListItemsFromResponse(data, options = {}) {
  const includeRootObjectMap = options?.includeRootObjectMap !== false;
  if (Array.isArray(data)) return data;
  const fields = [
    "data",
    "results",
    "objects",
    "entries",
    "records",
    "resources",
    "nodes",
    "edges",
    "models",
    "model",
    "items",
    "list",
    "model_list",
    "modelList",
    "model_ids",
    "modelIds",
    "supported_models",
    "supportedModels",
    "supported_model_ids",
    "supportedModelIds",
    "available_models",
    "availableModels",
    "available_model_ids",
    "availableModelIds",
    "model_catalog",
    "modelCatalog",
    "model_names",
    "modelNames",
    "deployments",
    "deployment_list",
    "deploymentList",
    "engines",
    "engine_list",
    "engineList"
  ];
  for (const field of fields) {
    const items = modelListItemsFromFieldValue(data?.[field], field);
    if (items.length) return items;
  }
  if (Array.isArray(data?.models?.data)) return data.models.data;
  if (Array.isArray(data?.models?.items)) return data.models.items;
  if (Array.isArray(data?.results?.data)) return data.results.data;
  if (Array.isArray(data?.objects?.data)) return data.objects.data;
  for (const field of fields) {
    const items = modelListItemsFromObjectMap(data?.[field]);
    if (items.length) return items;
  }
  if (includeRootObjectMap) {
    const rootItems = modelListItemsFromObjectMap(data, { skipDirectCheck: true });
    if (rootItems.length) return rootItems;
  }
  return [];
}

function modelListItemsFromFieldValue(value, field = "") {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && modelListDelimitedStringFields().has(field)) return modelListItemsFromDelimitedString(value);
  return [];
}

function modelListItemsFromDelimitedString(value) {
  return String(value || "")
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function modelListItemsFromObjectMap(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  if (modelOptionFromItem(value).id) return [];
  if (!options?.skipDirectCheck && directModelListItemsFromResponse(value, { includeRootObjectMap: false }).length) return [];
  const items = [];
  for (const [key, item] of Object.entries(value)) {
    const id = String(key || "").trim();
    if (!id || modelListMapMetadataKeys().has(id)) continue;
    if (item === true) {
      items.push({ id, label: id });
      continue;
    }
    if (item === false) continue;
    if (typeof item === "string") {
      const label = item.trim();
      if (label) items.push({ id, label });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const option = modelOptionFromItem(item);
    items.push(option.id ? item : { ...item, id });
  }
  return items;
}

function modelListDelimitedStringFields() {
  return new Set([
    "model_ids",
    "modelIds",
    "supported_models",
    "supportedModels",
    "supported_model_ids",
    "supportedModelIds",
    "available_models",
    "availableModels",
    "available_model_ids",
    "availableModelIds",
    "model_catalog",
    "modelCatalog",
    "model_names",
    "modelNames"
  ]);
}

function modelListMapMetadataKeys() {
  return new Set([
    "data",
    "result",
    "payload",
    "response",
    "message",
    "body",
    "completion",
    "items",
    "models",
    "model",
    "list",
    "model_list",
    "modelList",
    "model_ids",
    "modelIds",
    "supported_models",
    "supportedModels",
    "supported_model_ids",
    "supportedModelIds",
    "available_models",
    "availableModels",
    "available_model_ids",
    "availableModelIds",
    "model_catalog",
    "modelCatalog",
    "model_names",
    "modelNames",
    "deployments",
    "deployment_list",
    "deploymentList",
    "engines",
    "engine_list",
    "engineList",
    "entries",
    "records",
    "resources",
    "nodes",
    "edges",
    "results",
    "objects",
    "metadata",
    "meta",
    "pagination",
    "paging",
    "page",
    "links",
    "object",
    "type",
    "total",
    "count",
    "first_id",
    "firstId",
    "last_id",
    "lastId",
    "has_more",
    "hasMore",
    "next",
    "next_url",
    "nextUrl",
    "nextPageUrl",
    "next_page",
    "nextPage",
    "next_cursor",
    "nextCursor",
    "next_page_token",
    "nextPageToken",
    "next_token",
    "nextToken",
    "cursor",
    "after",
    "after_id",
    "afterId",
    "page_token",
    "pageToken",
    "error",
    "errors",
    "message",
    "status",
    "status_code",
    "statusCode",
    "code",
    "ok",
    "success",
    "detail",
    "details"
  ]);
}

function modelListPaginationEnvelope(data, depth = 0) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (hasModelListPaginationFields(data)) return data;
  if (depth >= 2) return null;
  for (const key of MODEL_LIST_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const envelope = modelListPaginationEnvelope(value, depth + 1);
    if (envelope) return envelope;
  }
  return null;
}

function hasModelListPaginationFields(data) {
  return !!stringField(
    data?.next_page,
    data?.nextPage,
    data?.next,
    data?.next_url,
    data?.nextUrl,
    data?.nextPageUrl,
    data?.next_cursor,
    data?.nextCursor,
    data?.next_page_token,
    data?.nextPageToken,
    data?.next_token,
    data?.nextToken
  )
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

function providerRetryableStatus(status) {
  const numericStatus = Number(status);
  return numericStatus === 429 || numericStatus >= 500;
}

function providerGenerationRetryDelayMs(response, attempt) {
  if (!response || !providerRetryableStatus(response.status)) return null;
  if (attempt >= PROVIDER_GENERATION_MAX_ATTEMPTS - 1) return null;
  return providerRetryAfterMs(response.headers);
}

function providerModelListRetryableStatus(status) {
  return providerRetryableStatus(status);
}

function providerModelListRetryDelayMs(response, attempt) {
  if (!response || !providerModelListRetryableStatus(response.status)) return null;
  if (attempt >= PROVIDER_MODEL_LIST_MAX_ATTEMPTS - 1) return null;
  return providerRetryAfterMs(response.headers);
}

function providerRetryAfterMs(headers) {
  const retryAfterMs = numericProviderHeaderMs(
    providerHeaderValue(headers, "retry-after-ms")
      || providerHeaderValue(headers, "x-retry-after-ms")
  );
  if (retryAfterMs != null) return retryAfterMs;

  const retryAfter = providerHeaderValue(headers, "retry-after");
  if (retryAfter) {
    const numericSeconds = Number(String(retryAfter).trim());
    if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
      return clampProviderRetryDelayMs(numericSeconds * 1000);
    }
    const dateDelay = Date.parse(String(retryAfter)) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay >= 0) {
      return clampProviderRetryDelayMs(dateDelay);
    }
  }

  const reset = providerHeaderValue(headers, "x-ratelimit-reset")
    || providerHeaderValue(headers, "x-rate-limit-reset");
  if (!reset) return null;
  const resetText = String(reset).trim();
  const resetNumber = Number(resetText);
  if (Number.isFinite(resetNumber) && resetNumber > 0) {
    const epochMs = resetNumber > 100000000000 ? resetNumber : resetNumber * 1000;
    const delayMs = epochMs - Date.now();
    return delayMs >= 0 ? clampProviderRetryDelayMs(delayMs) : null;
  }
  const resetDateDelay = Date.parse(resetText) - Date.now();
  return Number.isFinite(resetDateDelay) && resetDateDelay >= 0 ? clampProviderRetryDelayMs(resetDateDelay) : null;
}

function numericProviderHeaderMs(value) {
  if (value == null || value === "") return null;
  const ms = Number(String(value).trim());
  return Number.isFinite(ms) && ms >= 0 ? clampProviderRetryDelayMs(ms) : null;
}

function providerHeaderValue(headers, name) {
  if (!headers || !name) return "";
  const lower = name.toLowerCase();
  if (typeof headers.get === "function") {
    try {
      return headers.get(name) || headers.get(lower) || "";
    } catch (_err) {
      return "";
    }
  }
  if (headers instanceof Map) {
    return headers.get(name) || headers.get(lower) || "";
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return "";
}

function clampProviderRetryDelayMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(Math.ceil(ms), PROVIDER_RETRY_DELAY_MAX_MS);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function providerStreamCompatibilityFallbackFields(protocol, body, error, usedFallback) {
  const message = streamCompatibilityErrorMessage(error);
  if (!message) return [];
  return providerCompatibilityFallbackFields(protocol, body, 200, JSON.stringify({ error: { message } }), usedFallback);
}

function streamCompatibilityErrorMessage(error) {
  const message = String(error?.message || error || "").trim();
  if (!/^Stream error:/i.test(message)) return "";
  return message.replace(/^Stream error:\s*/i, "").trim();
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
    const details = providerErrorDetailsText(parsed.details, parsed.detail, parsed.errors);
    const code = stringField(parsed.code, parsed.error_code, parsed.errorCode);
    const type = stringField(parsed.type, parsed.error_type, parsed.errorType);
    const status = stringField(parsed.status, parsed.status_code, parsed.statusCode);
    const statusText = status.toLowerCase();
    const typeText = type.toLowerCase();
    const looksLikeError = parsed.ok === false
      || parsed.success === false
      || /^(error|failed|failure|invalid|unauthorized|forbidden)$/i.test(statusText)
      || /error|invalid|unauth|forbidden|denied|rate|limit|unsupported/.test(typeText)
      || !!code
      || providerErrorDetailLooksLikeError(details);
    const messageWithDetails = providerErrorMessageWithDetails(message, details);
    return messageWithDetails && looksLikeError
      ? [code, type, status, redactSecret(messageWithDetails)].filter(Boolean).join(" - ")
      : "";
  }
  if (Array.isArray(parsed.errors) && parsed.errors.length) {
    return parsed.errors.map((entry) => directProviderResponseErrorText({ error: entry })).filter(Boolean).join("; ");
  }
  if (typeof error === "string") return redactSecret(error);
  const code = error.code || parsed.code || "";
  const type = normalizedProviderErrorType(error.type);
  const message = error.message || parsed.message || error.detail || parsed.detail || error.error_description || parsed.error_description;
  const details = providerErrorDetailsText(error.details, error.detail, error.errors, parsed.details, parsed.detail, parsed.errors);
  return [code, type, redactSecret(providerErrorMessageWithDetails(message, details) || JSON.stringify(error))].filter(Boolean).join(" - ");
}

function normalizedProviderErrorType(value) {
  const type = stringField(value);
  return type.toLowerCase() === "error" ? "" : type;
}

function providerErrorMessageWithDetails(message, details) {
  if (!message) return details;
  if (!details || details === message) return message;
  return `${message} | ${details}`;
}

function providerErrorDetailsText(...values) {
  const details = [];
  for (const value of values) collectProviderErrorDetails(value, details, 0);
  return Array.from(new Set(details.map((entry) => entry.trim()).filter(Boolean))).join("; ");
}

function collectProviderErrorDetails(value, details, depth) {
  if (value === undefined || value === null || depth > 4) return;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) details.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProviderErrorDetails(item, details, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const path = providerErrorPath(value.loc ?? value.location ?? value.path ?? value.json_path ?? value.jsonpath ?? value.param ?? value.parameter ?? value.field ?? value.property ?? value.argument);
  const message = stringField(value.msg, value.message, value.detail, value.reason, value.description, value.type, value.code);
  if (path || message) details.push([path, message].filter(Boolean).join(": "));
  collectProviderErrorDetails(value.details, details, depth + 1);
  collectProviderErrorDetails(value.errors, details, depth + 1);
  collectProviderErrorDetails(value.causes, details, depth + 1);
  collectProviderErrorDetails(value.issues, details, depth + 1);
}

function providerErrorPath(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!Array.isArray(value)) return "";
  let path = "";
  for (const item of value) {
    if (typeof item === "number" || (typeof item === "string" && /^\d+$/.test(item))) {
      path += `[${item}]`;
      continue;
    }
    if (typeof item !== "string" || !item.trim()) return "";
    const text = item.trim();
    path += path ? `.${text}` : text;
  }
  return path;
}

function providerErrorDetailLooksLikeError(value) {
  return /error|invalid|unauth|forbidden|denied|rate|limit|unsupported|unknown|not supported|not permitted|not allowed|extra_forbidden/.test(String(value || "").toLowerCase());
}

function redactSecret(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ak|xai|gsk|pplx|ms|rk|hf|deepinfra|cloudflare|cf)[-_][A-Za-z0-9._-]+/gi, "[redacted]")
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
