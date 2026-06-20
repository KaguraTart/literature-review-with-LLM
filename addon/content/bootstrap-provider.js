const PROVIDER_RESPONSE_WRAPPER_KEYS = ["data", "result", "payload", "response", "message", "body", "completion"];
const MODEL_TEXT_CONTAINER_KEYS = [
  "content",
  "output",
  "parts",
  "message",
  "delta",
  "part",
  "item",
  "response",
  "result",
  "payload",
  "data",
  "body",
  "candidate",
  "candidates",
  "content_block",
  "completion"
];

function streamErrorText(data, depth = 0) {
  const error = data?.error || (data?.type === "error" ? data : null);
  if (error) {
    if (typeof error === "string") return error;
    const code = error.code || error.type || data?.code || data?.type || "";
    const message = error.message || data?.message || "";
    return [code, message || JSON.stringify(error)].filter(Boolean).join(" - ");
  }
  if (depth >= 3 || !data || typeof data !== "object" || Array.isArray(data)) return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = streamErrorText(value, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function streamUsage(chunk, depth = 0) {
  const usage = chunk?.usage || chunk?.message?.usage || chunk?.delta?.usage;
  if (usage) return usage;
  if (depth >= 2 || !chunk || typeof chunk !== "object") return undefined;
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = chunk?.[key];
    if (!value || typeof value !== "object") continue;
    const wrappedUsage = streamUsage(value, depth + 1);
    if (wrappedUsage) return wrappedUsage;
  }
  return undefined;
}

function extractProviderStreamText(protocol, chunk) {
  if (protocol === "anthropic_messages") return extractAnthropicStreamText(chunk);
  return extractOpenAIStreamText(chunk);
}

function isProviderStreamSnapshot(protocol, chunk) {
  return protocol !== "anthropic_messages" && isOpenAIStreamSnapshot(chunk);
}

function extractOpenAIText(data) {
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Provider error: ${redact(errorText)}`);
  const text = extractOpenAITextValue(data);
  if (!text) throw new Error("模型没有返回正文");
  return stripThink(String(text).trim());
}

function extractOpenAITextValue(data, depth = 0) {
  return data?.output_text
    || extractOpenAIMessageContent(data?.choices?.[0]?.message?.content)
    || extractOpenAIMessageContent(data?.choices?.[0]?.delta?.content)
    || data?.choices?.[0]?.text
    || data?.choices?.[0]?.delta?.text
    || extractOpenAIContentArray(data?.output)
    || extractOpenAIMessageContent(data?.content)
    || extractOpenAIMessageContent(data?.candidates)
    || extractOpenAIEventContainer(data)
    || extractWrappedResponseContent("openai", data, depth);
}

function extractOpenAIStreamText(chunk, depth = 0) {
  if (!chunk) return "";
  const errorText = streamErrorText(chunk);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  if (typeof chunk?.choices?.[0]?.delta === "string") return chunk.choices[0].delta;
  const delta = chunk.choices?.[0]?.delta;
  const deltaContent = extractOpenAIMessageContent(delta?.content);
  if (deltaContent) return deltaContent;
  const messageContent = extractOpenAIMessageContent(chunk.choices?.[0]?.message?.content);
  if (messageContent) return messageContent;
  if (typeof delta?.text === "string") return delta.text;
  if ((chunk?.type === "response.output_text.delta" || chunk?.type === "response.text.delta") && typeof chunk?.delta === "string") return chunk.delta;
  if (chunk?.delta?.content) {
    const nestedDelta = extractOpenAIMessageContent(chunk.delta.content);
    if (nestedDelta) return nestedDelta;
  }
  const directContent = extractOpenAIMessageContent(chunk.content);
  if (directContent) return directContent;
  const outputText = extractOpenAIContentArray(chunk.output);
  if (outputText) return outputText;
  const eventText = extractOpenAIEventContainer(chunk);
  if (eventText) return eventText;
  return extractWrappedStreamText("openai", chunk, depth);
}

function extractAnthropicStreamText(chunk, depth = 0) {
  if (!chunk) return "";
  const errorText = streamErrorText(chunk);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  if (chunk?.type === "content_block_delta") {
    if (typeof chunk?.delta?.text === "string") return chunk.delta.text;
    if (typeof chunk?.delta?.partial_json === "string") return chunk.delta.partial_json;
  }
  if (typeof chunk?.delta?.text === "string") return chunk.delta.text;
  if (typeof chunk?.delta?.partial_json === "string") return chunk.delta.partial_json;
  if (typeof chunk?.content_block?.text === "string") return chunk.content_block.text;
  const contentText = extractOpenAIMessageContent(chunk?.content) || extractOpenAIMessageContent(chunk?.message);
  if (contentText) return contentText;
  return extractWrappedStreamText("anthropic", chunk, depth);
}

function extractWrappedStreamText(protocol, chunk, depth) {
  if (depth >= 2 || !chunk || typeof chunk !== "object") return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = chunk?.[key];
    if (!value || typeof value !== "object") continue;
    const text = protocol === "anthropic"
      ? extractAnthropicStreamText(value, depth + 1)
      : extractOpenAIStreamText(value, depth + 1);
    if (text) return text;
  }
  return "";
}

function openaiResponsesInputForSummary(request) {
  const content = [{ type: "input_text", text: request.prompt || "" }];
  if (request.input.type === "text" && request.input.text) {
    content.push({ type: "input_text", text: `CONTEXT:\n${request.input.text}` });
  }
  if (request.input.type === "pdf_base64") {
    content.unshift({
      type: "input_file",
      filename: request.input.filename || "paper.pdf",
      file_data: `data:application/pdf;base64,${request.input.base64}`
    });
  }
  for (const image of requestInputImages(request.input)) {
    content.push({
      type: "input_image",
      image_url: imageDataURL(image)
    });
  }
  return [{ role: "user", content }];
}

function openAIChatSummaryMessages(request) {
  const userText = request.input.type === "text" ? `${request.prompt}\n\n${request.input.text}` : request.prompt;
  const images = requestInputImages(request.input);
  const userContent = images.length
    ? [
      { type: "text", text: userText },
      ...images.map((image) => ({ type: "image_url", image_url: { url: imageDataURL(image) } }))
    ]
    : userText;
  return [
    { role: "system", content: request.system },
    { role: "user", content: userContent }
  ];
}

function requestInputImages(input) {
  return Array.isArray(input?.images) ? input.images.filter((image) => image?.base64) : [];
}

function imageDataURL(image) {
  return `data:${image?.mimeType || "image/png"};base64,${image?.base64 || ""}`;
}

function withProviderBodyDefaults(profile, body) {
  return omitProviderBodyFields({ ...body, ...jsonModeBodyDefaults(profile), ...providerBodyExtra(profile.bodyExtra) }, profile.bodyExtra);
}

function withOpenAIChatBodyDefaults(profile, body) {
  const merged = withProviderBodyDefaults(profile, body);
  if (merged.stream === true && merged.stream_options === undefined && !providerBodyOmitFields(profile?.bodyExtra).has("stream_options")) {
    merged.stream_options = openAIChatStreamOptions();
  }
  return merged;
}

function openAIChatStreamOptions() {
  return { include_usage: true };
}

function jsonModeBodyDefaults(profile) {
  if (!profile?.capabilities?.jsonMode || profile.protocol === "anthropic_messages") return {};
  const extra = providerBodyExtra(profile.bodyExtra);
  const protocol = profile.protocol || "openai_chat";
  if (protocol === "openai_responses") {
    if (extra.text !== undefined || extra.response_format !== undefined) return {};
    return { text: { format: { type: "json_object" } } };
  }
  if (extra.response_format !== undefined) return {};
  return { response_format: { type: "json_object" } };
}

function extractOpenAIMessageContent(content, depth = 0) {
  if (!content || depth > 5) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => extractOpenAIMessageContent(part, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    if (isOpenAIReasoningPart(content)) return "";
    if (typeof content?.text === "string") return content.text;
    if (typeof content?.output_text === "string") return content.output_text;
    if (typeof content?.content === "string") return content.content;
    if (typeof content?.completion === "string") return content.completion;
    for (const key of MODEL_TEXT_CONTAINER_KEYS) {
      const nested = content?.[key];
      if (!nested || nested === content) continue;
      const text = extractOpenAIMessageContent(nested, depth + 1);
      if (text) return text;
    }
  }
  return "";
}

function extractOpenAIContentArray(value) {
  if (!Array.isArray(value)) return "";
  return value.map((part) => extractOpenAIMessageContent(part)).filter(Boolean).join("\n");
}

function extractOpenAIEventContainer(value) {
  return extractOpenAIMessageContent(value?.part)
    || extractOpenAIMessageContent(value?.item)
    || extractOpenAIMessageContent(value?.message)
    || extractOpenAIMessageContent(value?.response)
    || "";
}

function isOpenAIStreamSnapshot(value, depth = 0) {
  const type = String(value?.type || "");
  const direct = type === "response.output_text.done"
    || type === "response.content_part.done"
    || type === "response.output_item.done"
    || type === "response.completed"
    || !!value?.part
    || !!value?.item
    || !!value?.message
    || !!value?.response;
  if (direct) return true;
  if (depth >= 2 || !value || typeof value !== "object") return false;
  return PROVIDER_RESPONSE_WRAPPER_KEYS.some((key) => {
    const wrapped = value?.[key];
    return !!wrapped && typeof wrapped === "object" && isOpenAIStreamSnapshot(wrapped, depth + 1);
  });
}

function isOpenAIReasoningPart(value) {
  const type = String(value?.type || "");
  return type.includes("reasoning") || type.includes("thinking");
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function extractAnthropicText(data) {
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Provider error: ${redact(errorText)}`);
  const text = extractAnthropicContent(data);
  if (!text) throw new Error("模型没有返回正文");
  return stripThink(text.trim());
}

function extractAnthropicContent(data, depth = 0) {
  return extractOpenAIMessageContent(data?.content)
    || extractOpenAIMessageContent(data?.message)
    || extractOpenAIMessageContent(data?.body)
    || extractOpenAIMessageContent(data?.candidates)
    || (typeof data?.text === "string" ? data.text : extractWrappedResponseContent("anthropic", data, depth));
}

function extractWrappedResponseContent(protocol, data, depth) {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object") continue;
    const text = protocol === "anthropic"
      ? extractAnthropicContent(value, depth + 1)
      : extractOpenAITextValue(value, depth + 1);
    if (text) return text;
  }
  return "";
}

function hasHeader(headers, name) {
  return !!headerKey(headers, name);
}

function headerKey(headers, name) {
  const normalized = String(name || "").toLowerCase();
  return Object.keys(headers || {}).find((key) => key.toLowerCase() === normalized) || "";
}

function hasExplicitAuthHeader(headers) {
  return hasHeaderValue(headers, "authorization") || hasHeaderValue(headers, "api-key") || hasHeaderValue(headers, "x-api-key");
}

function hasHeaderValue(headers, name) {
  const normalized = String(name || "").toLowerCase();
  return Object.entries(headers || {}).some(([key, value]) => key.toLowerCase() === normalized && String(value || "").trim());
}

function setHeaderIfMissing(headers, name, value) {
  if (!String(value || "").trim()) return;
  const existingKey = headerKey(headers, name);
  if (existingKey && String(headers[existingKey] || "").trim()) return;
  headers[existingKey || name] = value;
}

function usesAzureOpenAIAuth(profile) {
  const id = String(profile?.id || profile?.provider || "").toLowerCase();
  const baseURL = String(profile?.baseURL || "");
  return id === "azure-openai" || id === "azure_openai" || /\.openai\.azure\.com\/openai\/v1\/?$/i.test(baseURL) || /\.services\.ai\.azure\.com\/openai\/v1\/?$/i.test(baseURL);
}

function anthropicAuthHeaderName(profile) {
  const explicit = normalizeAuthHeaderName(profile?.authHeader || profile?.bodyExtra?.authHeader || profile?.bodyExtra?.anthropicAuthHeader);
  if (explicit) return explicit;
  const id = String(profile?.id || profile?.provider || "").toLowerCase();
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  if (id === "anthropic-compatible" || id === "anthropic_compatible" || id === "deepseek-anthropic" || id === "deepseek_anthropic" || id === "zai-anthropic" || id === "zai_anthropic" || id === "sambanova-anthropic" || id === "sambanova_anthropic") return "authorization";
  if (baseURL === "https://api.deepseek.com/anthropic" || baseURL.startsWith("https://api.deepseek.com/anthropic/")) return "authorization";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL.startsWith("https://api.z.ai/api/anthropic/")) return "authorization";
  if (baseURL === "https://api.sambanova.ai/v1" || baseURL.startsWith("https://api.sambanova.ai/v1/")) return "authorization";
  return "x-api-key";
}

function shouldAddAnthropicDirectBrowserAccess(profile) {
  const explicit = profile?.bodyExtra?.directBrowserAccess
    ?? profile?.bodyExtra?.anthropicDirectBrowserAccess
    ?? profile?.directBrowserAccess
    ?? profile?.anthropicDirectBrowserAccess;
  if (explicit === false || String(explicit).toLowerCase() === "false") return false;
  if (explicit === true || String(explicit).toLowerCase() === "true") return true;
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  return baseURL === "https://api.anthropic.com" || baseURL.startsWith("https://api.anthropic.com/");
}

function normalizeAuthHeaderName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "authorization" || normalized === "bearer" || normalized === "auth-token" || normalized === "anthropic-auth-token") return "authorization";
  if (normalized === "x-api-key" || normalized === "anthropic-api-key") return "x-api-key";
  if (normalized === "api-key") return "api-key";
  return "";
}

function endpointForProtocol(protocol, baseURL) {
  const base = stripKnownProviderEndpointPath(baseURL);
  if (!base) throw new Error("Base URL endpoint is required");
  if (protocol === "anthropic_messages") {
    return /\/v\d+$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
  }
  if (protocol === "openai_responses") return `${openAICompatibleBaseWithVersion(base)}/responses`;
  return `${openAICompatibleBaseWithVersion(base)}/chat/completions`;
}

function stripKnownProviderEndpointPath(baseURL) {
  return String(baseURL || "")
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|responses|messages|models)$/i, "");
}

function openAICompatibleBaseWithVersion(baseURL) {
  const base = String(baseURL || "").replace(/\/+$/, "");
  return hasOpenAICompatibleVersionPath(base) || usesVersionlessOpenAICompatibleBase(base) ? base : `${base}/v1`;
}

function hasOpenAICompatibleVersionPath(baseURL) {
  return /\/v\d+(?:[a-z]+)?$/i.test(baseURL) || /\/v\d+(?:[a-z]+)?\/openai$/i.test(baseURL);
}

function usesVersionlessOpenAICompatibleBase(baseURL) {
  const normalized = String(baseURL || "").replace(/\/+$/, "");
  return /^https:\/\/api\.perplexity\.ai$/i.test(normalized)
    || /^https:\/\/models\.github\.ai\/inference$/i.test(normalized);
}

function providerBodyExtra(bodyExtra) {
  if (!bodyExtra || typeof bodyExtra !== "object" || Array.isArray(bodyExtra)) return {};
  const {
    localAgent: _localAgent,
    agent: _agent,
    subagent: _subagent,
    authHeader: _authHeader,
    anthropicAuthHeader: _anthropicAuthHeader,
    directBrowserAccess: _directBrowserAccess,
    anthropicDirectBrowserAccess: _anthropicDirectBrowserAccess,
    tokenLimitField: _tokenLimitField,
    openAIChatTokenField: _openAIChatTokenField,
    chatTokenField: _chatTokenField,
    maxTokenField: _maxTokenField,
    omitFields: _omitFields,
    omitBodyFields: _omitBodyFields,
    removeFields: _removeFields,
    removeBodyFields: _removeBodyFields,
    ...rest
  } = bodyExtra;
  return rest;
}

function omitProviderBodyFields(body, bodyExtra) {
  const fields = providerBodyOmitFields(bodyExtra);
  if (!fields.size) return body;
  const next = { ...body };
  for (const field of fields) delete next[field];
  return next;
}

function providerBodyOmitFields(bodyExtra) {
  if (!bodyExtra || typeof bodyExtra !== "object" || Array.isArray(bodyExtra)) return new Set();
  const values = [
    bodyExtra.omitFields,
    bodyExtra.omitBodyFields,
    bodyExtra.removeFields,
    bodyExtra.removeBodyFields
  ];
  return new Set(values.flatMap((value) => bodyFieldList(value)).filter(Boolean));
}

function bodyFieldList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => bodyFieldList(item));
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function openAIChatTokenLimit(profile, maxTokens) {
  return { [openAIChatTokenLimitField(profile)]: maxTokens };
}

function openAIChatOptionalDefaults(profile, defaults) {
  return openAIChatTokenLimitField(profile) === "max_completion_tokens" ? {} : defaults;
}

function providerCompatibilityFallbackFields(protocol, body, status, text, usedFallback = false) {
  if (usedFallback || protocol !== "openai_chat" || ![400, 422].includes(Number(status))) return [];
  const detail = String(text || "").toLowerCase();
  const fields = [];
  if (body?.stream_options !== undefined && /stream_options|stream options|stream option/.test(detail)) {
    fields.push("stream_options");
  }
  if (body?.stream === true && /\bstream\b|streaming/.test(detail)) {
    fields.push("stream", "stream_options");
  }
  if (body?.temperature !== undefined && /temperature/.test(detail)) {
    fields.push("temperature");
  }
  if (body?.n !== undefined && /(?:^|[^a-z0-9_])n(?:[^a-z0-9_]|$)|number of completions|multiple completions/.test(detail)) {
    fields.push("n");
  }
  return Array.from(new Set(fields));
}

function omitProviderRequestBodyFields(body, fields) {
  if (!fields.length) return body;
  const next = { ...body };
  for (const field of fields) delete next[field];
  return next;
}

function openAIChatTokenLimitField(profile) {
  const extra = providerBodyExtra(profile?.bodyExtra);
  const explicit = normalizeOpenAIChatTokenLimitField(
    profile?.bodyExtra?.tokenLimitField
    ?? profile?.bodyExtra?.openAIChatTokenField
    ?? profile?.bodyExtra?.chatTokenField
    ?? profile?.bodyExtra?.maxTokenField
  );
  if (explicit) return explicit;
  if (extra.max_completion_tokens !== undefined && extra.max_tokens === undefined) return "max_completion_tokens";
  if (extra.max_tokens !== undefined && extra.max_completion_tokens === undefined) return "max_tokens";
  return modelPrefersCompletionTokenLimit(profile?.model) ? "max_completion_tokens" : "max_tokens";
}

function normalizeOpenAIChatTokenLimitField(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[.\s-]+/g, "_");
  if (!normalized) return "";
  if (normalized === "max_completion_tokens" || normalized === "completion_tokens" || normalized === "completion") return "max_completion_tokens";
  if (normalized === "max_tokens" || normalized === "tokens") return "max_tokens";
  return "";
}

function modelPrefersCompletionTokenLimit(model) {
  return /^o\d(?:$|[-_.])/i.test(String(model || "").trim());
}
