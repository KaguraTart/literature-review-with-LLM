export type ProviderProtocol = "openai_chat" | "openai_responses" | "anthropic_messages";
export type EndpointMode = "base_url" | "full_url";
export type InputMode = "text" | "pdf_base64";

export interface ProviderCapabilities {
  text: boolean;
  pdfBase64: boolean;
  imageBase64: boolean;
  fileReference: boolean;
  streaming: boolean;
  embeddings: boolean;
  jsonMode: boolean;
  toolUse: boolean;
  modelList: boolean;
}

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  endpointMode: EndpointMode;
  baseURL: string;
  fullURL?: string;
  apiKey: string;
  model: string;
  capabilities: ProviderCapabilities;
  customHeaders?: Record<string, string>;
  bodyExtra?: Record<string, unknown>;
  isDefault?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  profile: ProviderProfile;
  system: string;
  messages: ChatMessage[];
  input?: { type: InputMode; text?: string; base64?: string; filename?: string; images?: Array<{ name?: string; mimeType: string; base64: string }> };
  temperature: number;
  maxOutputTokens: number;
  stream: boolean;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

const PROVIDER_RESPONSE_WRAPPER_KEYS = ["data", "result", "payload", "response", "message", "body", "completion"] as const;
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
] as const;

type OpenAIResponsesInputItem = {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
};

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export const defaultCapabilities: ProviderCapabilities = {
  text: true,
  pdfBase64: false,
  imageBase64: true,
  fileReference: false,
  streaming: true,
  embeddings: false,
  jsonMode: false,
  toolUse: false,
  modelList: true
};

export function endpointFor(request: ModelRequest): string {
  const { profile } = request;
  if (profile.endpointMode === "full_url") {
    const fullURL = profile.fullURL || profile.baseURL;
    if (!fullURL) throw new Error("Full URL endpoint is required");
    return fullURL;
  }
  return endpointForProtocol(profile.protocol, profile.baseURL);
}

export function headersFor(profile: ProviderProfile): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...profile.customHeaders
  };
  if (profile.protocol === "anthropic_messages") {
    if (!hasExplicitAuthHeader(headers)) {
      const authHeader = anthropicAuthHeaderName(profile);
      setHeaderIfMissing(headers, authHeader, authHeader === "authorization" && profile.apiKey ? `Bearer ${profile.apiKey}` : profile.apiKey);
    }
    setHeaderIfMissing(headers, "anthropic-version", "2023-06-01");
    if (shouldAddAnthropicDirectBrowserAccess(profile)) {
      setHeaderIfMissing(headers, "anthropic-dangerous-direct-browser-access", "true");
    }
  } else if (usesAzureOpenAIAuth(profile)) {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "api-key", profile.apiKey);
  } else {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "authorization", profile.apiKey ? `Bearer ${profile.apiKey}` : "");
  }
  return withoutBlankHeaders(headers);
}

export function bodyFor(request: ModelRequest): Record<string, unknown> {
  if (request.input?.type === "pdf_base64" && !request.profile.capabilities.pdfBase64) {
    throw new Error("Selected provider profile does not support PDF base64 input");
  }
  if (inputImages(request).length && !request.profile.capabilities.imageBase64) {
    throw new Error("Selected provider profile does not support image input");
  }
  if (request.profile.protocol === "anthropic_messages") return anthropicBody(request);
  if (request.profile.protocol === "openai_responses") return openaiResponsesBody(request);
  if (request.input?.type === "pdf_base64") {
    throw new Error("OpenAI Chat Completions profiles use extracted text input");
  }
  return openaiChatBody(request);
}

export function modelsEndpointFor(profile: ProviderProfile): string | undefined {
  if (!profile.capabilities.modelList || profile.endpointMode === "full_url") return undefined;
  const base = stripKnownProviderEndpointPath(profile.baseURL);
  if (profile.protocol === "anthropic_messages") {
    return /\/v\d+$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
  }
  return `${openAICompatibleBaseWithVersion(base)}/models`;
}

export function extractResponseText(protocol: ProviderProtocol, data: unknown): string {
  const value = data as any;
  const errorText = streamErrorText(value);
  if (errorText) throw new Error(`Provider error: ${redact(errorText)}`);
  const text = protocol === "anthropic_messages"
    ? extractAnthropicResponseContent(value)
    : extractOpenAIResponseContent(value);
  if (!text) throw new Error("No text returned from model");
  return stripThink(text);
}

export function parseStreamChunk(protocol: ProviderProtocol, rawLine: string): string {
  return streamPayloads(rawLine).map((payload) => parseStreamPayload(protocol, payload)).filter(Boolean).join("");
}

export function parseStreamUsage(rawLine: string): ProviderUsage | null {
  return streamPayloads(rawLine)
    .map((payload) => safeParseJSON(payload))
    .filter(Boolean)
    .map((payload) => extractProviderUsage(payload))
    .filter((usage): usage is ProviderUsage => !!usage)
    .reduce((merged, usage) => mergeProviderUsage(merged, usage), null as ProviderUsage | null);
}

export function extractProviderUsage(data: unknown): ProviderUsage | null {
  return providerUsageFromValue(data);
}

function parseStreamPayload(protocol: ProviderProtocol, payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  const data = safeParseJSON(payload) as any;
  if (!data) return "";
  return streamTextFromParsedPayload(protocol, data);
}

function streamTextFromParsedPayload(protocol: ProviderProtocol, data: any, depth = 0): string {
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  if (isReasoningStreamEvent(data)) return "";
  if (protocol === "anthropic_messages") {
    if (data?.type === "content_block_delta") {
      return data?.delta?.text || data?.delta?.partial_json || "";
    }
    return data?.delta?.text
      || data?.delta?.partial_json
      || data?.content_block?.text
      || extractAnthropicContent(data)
      || extractWrappedStreamContent(protocol, data, depth)
      || "";
  }
  const choiceContent = extractOpenAIChoiceContent(data?.choices);
  if (choiceContent) return choiceContent;
  if (data?.type === "response.output_text.delta" && typeof data?.delta === "string") return data.delta;
  if (data?.type === "response.text.delta" && typeof data?.delta === "string") return data.delta;
  if (data?.type === "response.refusal.delta" && typeof data?.delta === "string") return data.delta;
  if (data?.type === "response.output_text.done" && typeof data?.text === "string") return data.text;
  if (data?.type === "response.refusal.done" && typeof data?.refusal === "string") return data.refusal;
  if (data?.delta?.content) {
    const nestedDelta = extractMessageContent(data.delta.content);
    if (nestedDelta) return nestedDelta;
  }
  const directContent = extractMessageContent(data?.content);
  if (directContent) return directContent;
  const candidateContent = extractMessageContent(data?.candidates);
  if (candidateContent) return candidateContent;
  const eventContent = extractOpenAIEventContainer(data);
  if (eventContent) return eventContent;
  return extractOutputContent(data?.output)
    || (typeof data?.delta === "string" ? data.delta : "")
    || extractWrappedStreamContent(protocol, data, depth)
    || "";
}

function extractOpenAIChoiceContent(choices: unknown): string {
  if (!Array.isArray(choices)) return "";
  return choices
    .map((choice: any) => {
      if (typeof choice?.delta === "string") return choice.delta;
      return extractMessageContent(choice?.delta?.content)
        || extractMessageContent(choice?.delta)
        || extractMessageContent(choice?.message?.content)
        || extractMessageContent(choice?.message)
        || (typeof choice?.text === "string" ? choice.text : "")
        || (typeof choice?.delta?.text === "string" ? choice.delta.text : "");
    })
    .filter(Boolean)
    .join("\n");
}

function extractWrappedStreamContent(protocol: ProviderProtocol, data: any, depth: number): string {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object") continue;
    const text = streamTextFromParsedPayload(protocol, value, depth + 1);
    if (text) return text;
  }
  return "";
}

function streamPayloads(rawRecord: string): string[] {
  const record = String(rawRecord || "");
  const dataLines = record
    .split(/\r?\n/)
    .map((line) => sseFieldValue(line, "data"))
    .filter((value): value is string => value !== undefined);
  if (!dataLines.length) {
    const line = record.trim();
    if (!line.startsWith("data:")) return [];
    return [line.slice(5).trim()].filter(Boolean);
  }
  const joined = dataLines.join("\n").trim();
  if (!joined) return [];
  if (dataLines.length === 1 || joined === "[DONE]" || safeParseJSON(joined)) return [joined];
  return dataLines.map((line) => line.trim()).filter(Boolean);
}

function sseFieldValue(line: string, field: string): string | undefined {
  const text = String(line || "");
  const index = text.indexOf(":");
  if (index < 0 || text.slice(0, index).trim() !== field) return undefined;
  const value = text.slice(index + 1);
  return value.startsWith(" ") ? value.slice(1) : value;
}

export function redact(value: unknown): string {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ak|xai|gsk|pplx|ms|rk)[-_][A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .slice(0, 800);
}

function openaiChatBody(request: ModelRequest): Record<string, unknown> {
  const chatMessages = openaiChatMessages(request);
  const messages = isTrueValue(request.profile.bodyExtra?.systemFallbackToUser)
    ? messagesWithPrependedOpenAIChatText(chatMessages, fallbackSystemText(request.system))
    : [
      { role: "system", content: request.system },
      ...chatMessages
    ];
  return withOpenAIChatBodyDefaults(request.profile, {
    model: request.profile.model,
    messages,
    ...openAIChatOptionalDefaults(request.profile, {
      temperature: request.temperature,
      n: 1
    }),
    ...openAIChatTokenLimit(request.profile, request.maxOutputTokens),
    stream: request.stream
  });
}

function withOpenAIChatBodyDefaults(profile: ProviderProfile, body: Record<string, unknown>): Record<string, unknown> {
  const merged = withBodyExtra(profile, body);
  if (merged.stream === true && merged.stream_options === undefined && !providerBodyOmitFields(profile.bodyExtra).has("stream_options")) {
    merged.stream_options = openAIChatStreamOptions();
  }
  return merged;
}

function openAIChatStreamOptions(): Record<string, unknown> {
  return { include_usage: true };
}

function openaiChatMessages(request: ModelRequest): Array<Record<string, unknown>> {
  const messages = withInputText(request).map((message) => ({ role: message.role, content: message.content as unknown }));
  const images = inputImages(request);
  if (!images.length) return messages;
  const lastUserIndex = findLastIndex(messages, (message) => message.role === "user");
  const imageParts = images.map((image) => openAIChatImagePart(image, request.profile));
  if (lastUserIndex >= 0) {
    const baseText = String(messages[lastUserIndex].content || "");
    messages[lastUserIndex] = {
      role: "user",
      content: [
        { type: "text", text: baseText },
        ...imageParts
      ]
    };
    return messages;
  }
  messages.push({ role: "user", content: imageParts });
  return messages;
}

function extractMessageContent(content: unknown, depth = 0): string {
  const record = content as Record<string, unknown> | null;
  if (!content || depth > 5) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item: any) => extractMessageContent(item, depth + 1)).filter(Boolean).join("\n");
  }
  if (record && typeof record === "object") {
    if (isReasoningContent(record)) return "";
    if (typeof record.text === "string") return record.text;
    if (typeof record.output_text === "string") return record.output_text;
    if (typeof record.content === "string") return record.content;
    if (typeof record.completion === "string") return record.completion;
    if (typeof record.refusal === "string") return record.refusal;
    for (const key of MODEL_TEXT_CONTAINER_KEYS) {
      const value = record[key];
      if (!value || value === content) continue;
      const text = extractMessageContent(value, depth + 1);
      if (text) return text;
    }
  }
  return "";
}

function extractOutputContent(output: unknown, depth = 0): string {
  if (!Array.isArray(output)) return "";
  return output
    .map((item: any) => extractMessageContent(item, depth + 1))
    .filter((text: unknown) => typeof text === "string" && text)
    .join("\n");
}

function extractOpenAIEventContainer(data: any): string {
  return extractMessageContent(data?.part)
    || extractMessageContent(data?.item)
    || extractMessageContent(data?.message)
    || extractMessageContent(data?.response)
    || "";
}

function extractOpenAIResponseContent(data: any, depth = 0): string {
  return data?.output_text
    || extractOpenAIChoiceContent(data?.choices)
    || extractOutputContent(data?.output)
    || extractMessageContent(data?.content)
    || extractMessageContent(data?.candidates)
    || extractOpenAIEventContainer(data)
    || extractWrappedResponseContent("openai", data, depth);
}

function extractAnthropicContent(data: any): string {
  return extractMessageContent(data?.content)
    || extractMessageContent(data?.message)
    || extractMessageContent(data?.body)
    || extractMessageContent(data?.candidates)
    || (typeof data?.text === "string" ? data.text : "");
}

function extractAnthropicResponseContent(data: any, depth = 0): string {
  return extractAnthropicContent(data) || extractWrappedResponseContent("anthropic", data, depth);
}

function extractWrappedResponseContent(protocol: "openai" | "anthropic", data: any, depth: number): string {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object") continue;
    const text = protocol === "anthropic"
      ? extractAnthropicResponseContent(value, depth + 1)
      : extractOpenAIResponseContent(value, depth + 1);
    if (text) return text;
  }
  return "";
}

function isReasoningContent(record: Record<string, unknown>): boolean {
  const type = String(record.type || "");
  return type.includes("reasoning") || type.includes("thinking");
}

function isReasoningStreamEvent(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const data = record as Record<string, any>;
  return [data.type, data.delta?.type, data.content_block?.type]
    .some((type) => isReasoningContent({ type }));
}

function stripThink(value: unknown): string {
  return String(value || "").replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
}

function safeParseJSON(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function streamErrorText(data: any, depth = 0): string {
  const direct = directProviderErrorText(data);
  if (direct) return direct;
  if (depth >= 3 || !data || typeof data !== "object" || Array.isArray(data)) return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = streamErrorText(value, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function directProviderErrorText(data: any): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const error = data?.error || (data?.type === "error" ? data : null);
  if (error) {
    if (typeof error === "string") return error;
    const code = firstString(error.code, data?.code);
    const type = normalizedErrorType(error.type);
    const message = firstString(error.message, data?.message, error.detail, data?.detail, error.error_description, data?.error_description);
    return [code, type, message || JSON.stringify(error)].filter(Boolean).join(" - ");
  }
  if (Array.isArray(data?.errors) && data.errors.length) {
    const text = data.errors.map((entry: any) => directProviderErrorText({ error: entry })).filter(Boolean).join("; ");
    if (text) return text;
  }
  const message = firstString(data.message, data.detail, data.error_description, data.errorMessage, data.error_message);
  const code = firstString(data.code, data.error_code, data.errorCode);
  const type = firstString(data.type, data.error_type, data.errorType);
  const status = firstString(data.status, data.status_code, data.statusCode);
  const statusText = status.toLowerCase();
  const typeText = type.toLowerCase();
  const looksLikeError = data.ok === false
    || data.success === false
    || /^(error|failed|failure|invalid|unauthorized|forbidden)$/i.test(statusText)
    || /error|invalid|unauth|forbidden|denied|rate|limit|unsupported/.test(typeText)
    || !!code;
  return message && looksLikeError ? [code, type, status, message].filter(Boolean).join(" - ") : "";
}

function normalizedErrorType(value: unknown): string {
  const type = firstString(value);
  return type.toLowerCase() === "error" ? "" : type;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function providerUsageFromValue(value: unknown, depth = 0): ProviderUsage | null {
  if (!value || typeof value !== "object" || depth > 3) return null;
  const data = value as any;
  const direct = directProviderUsageFromValue(data);
  const nested = PROVIDER_RESPONSE_WRAPPER_KEYS
    .map((key) => providerUsageFromValue(data?.[key], depth + 1))
    .filter((usage): usage is ProviderUsage => !!usage)
    .reduce((merged, usage) => mergeProviderUsage(merged, usage), null as ProviderUsage | null);
  return mergeProviderUsage(direct, nested);
}

function directProviderUsageFromValue(data: any): ProviderUsage | null {
  const candidates = [
    data?.usage,
    data?.token_usage,
    data?.tokenUsage,
    data?.usage_metadata,
    data?.usageMetadata,
    data?.token_counts,
    data?.tokenCounts,
    data?.metadata?.usage,
    data?.metadata?.usage_metadata,
    data?.metadata?.usageMetadata
  ];
  return candidates
    .map((candidate) => normalizeProviderUsage(candidate))
    .filter((usage): usage is ProviderUsage => !!usage)
    .reduce((merged, usage) => mergeProviderUsage(merged, usage), null as ProviderUsage | null);
}

function normalizeProviderUsage(usage: any): ProviderUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = firstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.promptTokens,
    usage.inputTokenCount,
    usage.promptTokenCount,
    usage.input_token_count,
    usage.prompt_token_count
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.completionTokens,
    usage.outputTokenCount,
    usage.candidatesTokenCount,
    usage.output_token_count,
    usage.candidates_token_count
  );
  const totalTokens = firstNumber(
    usage.total_tokens,
    usage.totalTokens,
    usage.totalTokenCount,
    usage.total_token_count,
    inputTokens !== undefined || outputTokens !== undefined ? (inputTokens || 0) + (outputTokens || 0) : undefined
  );
  const cachedInputTokens = sumNumbers(
    usage.cachedInputTokens,
    usage.cached_input_tokens,
    usage.cachedContentTokens,
    usage.cachedContentTokenCount,
    usage.cached_content_tokens,
    usage.cached_content_token_count,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.cacheReadInputTokens,
    usage.cacheCreationInputTokens,
    usage.input_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cachedTokens,
    usage.inputTokensDetails?.cached_tokens,
    usage.inputTokensDetails?.cachedTokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.prompt_tokens_details?.cachedTokens,
    usage.promptTokensDetails?.cached_tokens,
    usage.promptTokensDetails?.cachedTokens
  );
  const reasoningTokens = firstNumber(
    usage.output_tokens_details?.reasoning_tokens,
    usage.output_tokens_details?.reasoningTokens,
    usage.outputTokensDetails?.reasoning_tokens,
    usage.outputTokensDetails?.reasoningTokens,
    usage.completion_tokens_details?.reasoning_tokens,
    usage.completion_tokens_details?.reasoningTokens,
    usage.completionTokensDetails?.reasoning_tokens,
    usage.completionTokensDetails?.reasoningTokens,
    usage.reasoning_tokens,
    usage.reasoningTokens,
    usage.thoughtsTokenCount,
    usage.thoughts_token_count,
    usage.thinkingTokens,
    usage.thinking_tokens
  );
  const normalized: ProviderUsage = {};
  if (inputTokens !== undefined) normalized.inputTokens = inputTokens;
  if (outputTokens !== undefined) normalized.outputTokens = outputTokens;
  if (totalTokens !== undefined) normalized.totalTokens = totalTokens;
  if (cachedInputTokens !== undefined) normalized.cachedInputTokens = cachedInputTokens;
  if (reasoningTokens !== undefined) normalized.reasoningTokens = reasoningTokens;
  return Object.keys(normalized).length ? normalized : null;
}

function mergeProviderUsage(left: ProviderUsage | null, right: ProviderUsage | null): ProviderUsage | null {
  if (!left) return right;
  if (!right) return left;
  const merged: ProviderUsage = {};
  for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens"] as const) {
    merged[key] = maxNumber(left[key], right[key]);
  }
  merged.totalTokens = maxNumber(
    left.totalTokens,
    right.totalTokens,
    merged.inputTokens !== undefined || merged.outputTokens !== undefined
      ? (merged.inputTokens || 0) + (merged.outputTokens || 0)
      : undefined
  );
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as ProviderUsage;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = numericValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function sumNumbers(...values: unknown[]): number | undefined {
  const numbers = values.map((value) => numericValue(value)).filter((value): value is number => value !== undefined);
  if (!numbers.length) return undefined;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function maxNumber(...values: unknown[]): number | undefined {
  const numbers = values.map((value) => numericValue(value)).filter((value): value is number => value !== undefined);
  return numbers.length ? Math.max(...numbers) : undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return !!headerKey(headers, name);
}

function headerKey(headers: Record<string, string>, name: string): string {
  const normalized = name.toLowerCase();
  return Object.keys(headers || {}).find((key) => key.toLowerCase() === normalized) || "";
}

function hasExplicitAuthHeader(headers: Record<string, string>): boolean {
  return hasHeaderValue(headers, "authorization") || hasHeaderValue(headers, "api-key") || hasHeaderValue(headers, "x-api-key");
}

function hasHeaderValue(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.entries(headers || {}).some(([key, value]) => key.toLowerCase() === normalized && String(value || "").trim());
}

function setHeaderIfMissing(headers: Record<string, string>, name: string, value: string): void {
  if (!String(value || "").trim()) return;
  const existingKey = headerKey(headers, name);
  if (existingKey && String(headers[existingKey] || "").trim()) return;
  headers[existingKey || name] = value;
}

function withoutBlankHeaders(headers: Record<string, string>): Record<string, string> {
  for (const key of Object.keys(headers)) {
    if (!String(headers[key] || "").trim()) delete headers[key];
  }
  return headers;
}

function usesAzureOpenAIAuth(profile: ProviderProfile): boolean {
  const id = String(profile?.id || "").toLowerCase();
  const baseURL = String(profile?.baseURL || "");
  return id === "azure-openai" || id === "azure_openai" || /\.openai\.azure\.com\/openai\/v1\/?$/i.test(baseURL) || /\.services\.ai\.azure\.com\/openai\/v1\/?$/i.test(baseURL);
}

function anthropicAuthHeaderName(profile: ProviderProfile): "authorization" | "x-api-key" | "api-key" {
  const explicit = normalizeAuthHeaderName((profile as any)?.authHeader || profile?.bodyExtra?.authHeader || profile?.bodyExtra?.anthropicAuthHeader);
  if (explicit) return explicit;
  const id = String(profile?.id || "").toLowerCase();
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  if (id === "anthropic") return "x-api-key";
  if (id === "anthropic-compatible" || id === "anthropic_compatible" || id === "deepseek-anthropic" || id === "deepseek_anthropic" || id === "zai-anthropic" || id === "zai_anthropic" || id === "sambanova-anthropic" || id === "sambanova_anthropic") return "authorization";
  if (baseURL === "https://api.deepseek.com/anthropic" || baseURL.startsWith("https://api.deepseek.com/anthropic/")) return "authorization";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL.startsWith("https://api.z.ai/api/anthropic/")) return "authorization";
  if (baseURL === "https://api.sambanova.ai/v1" || baseURL.startsWith("https://api.sambanova.ai/v1/")) return "authorization";
  if (!isOfficialAnthropicBaseURL(baseURL)) return "authorization";
  return "x-api-key";
}

function isOfficialAnthropicBaseURL(baseURL: string): boolean {
  const normalized = stripKnownProviderEndpointPath(baseURL).replace(/\/+$/, "");
  return normalized === "https://api.anthropic.com" || normalized.startsWith("https://api.anthropic.com/");
}

function shouldAddAnthropicDirectBrowserAccess(profile: ProviderProfile): boolean {
  const explicit = profile.bodyExtra?.directBrowserAccess
    ?? profile.bodyExtra?.anthropicDirectBrowserAccess
    ?? (profile as any)?.directBrowserAccess
    ?? (profile as any)?.anthropicDirectBrowserAccess;
  if (explicit === false || String(explicit).toLowerCase() === "false") return false;
  if (explicit === true || String(explicit).toLowerCase() === "true") return true;
  const baseURL = String(profile.baseURL || "").replace(/\/+$/, "");
  return baseURL === "https://api.anthropic.com" || baseURL.startsWith("https://api.anthropic.com/");
}

function normalizeAuthHeaderName(value: unknown): "authorization" | "x-api-key" | "api-key" | "" {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "authorization" || normalized === "bearer" || normalized === "auth-token" || normalized === "anthropic-auth-token") return "authorization";
  if (normalized === "x-api-key" || normalized === "anthropic-api-key") return "x-api-key";
  if (normalized === "api-key") return "api-key";
  return "";
}

function openaiResponsesBody(request: ModelRequest): Record<string, unknown> {
  const instructionsInUser = isTrueValue(request.profile.bodyExtra?.instructionsFallbackToUser);
  return withBodyExtra(request.profile, {
    model: request.profile.model,
    ...(instructionsInUser ? {} : { instructions: request.system }),
    input: openaiResponsesInput(request, instructionsInUser ? request.system : ""),
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    stream: request.stream
  });
}

function openaiResponsesInput(request: ModelRequest, fallbackSystem = ""): OpenAIResponsesInputItem[] {
  const input: OpenAIResponsesInputItem[] = request.messages.map((message) => ({
    role: message.role,
    content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.content }]
  }));
  let lastUserIndex = findLastIndex(input, (message) => message.role === "user");
  const systemText = fallbackSystemText(fallbackSystem);
  if (systemText) {
    const textPart = { type: "input_text", text: systemText };
    const firstUserIndex = input.findIndex((message) => message.role === "user");
    if (firstUserIndex >= 0) {
      input[firstUserIndex] = {
        ...input[firstUserIndex],
        content: [textPart, ...input[firstUserIndex].content]
      };
    } else {
      input.unshift({ role: "user", content: [textPart] });
      lastUserIndex = 0;
    }
  }
  if (request.input?.type === "text" && request.input.text) {
    const contextPart = { type: "input_text", text: `CONTEXT:\n${request.input.text}` };
    if (lastUserIndex >= 0) {
      input[lastUserIndex] = {
        ...input[lastUserIndex],
        content: [...input[lastUserIndex].content, contextPart]
      };
    } else {
      input.push({ role: "user", content: [contextPart] });
    }
  }
  if (request.input?.type === "pdf_base64" && !shouldOmitPdfInputFile(request.profile)) {
    const filePart = openAIResponsesPdfFilePart(request.input, request.profile);
    if (lastUserIndex >= 0) {
      input[lastUserIndex] = {
        ...input[lastUserIndex],
        content: [filePart, ...input[lastUserIndex].content]
      };
    } else {
      input.push({ role: "user", content: [filePart] });
    }
  }
  for (const image of inputImages(request)) {
    const imagePart = {
      type: "input_image",
      image_url: imageDataURL(image)
    };
    if (lastUserIndex >= 0) {
      input[lastUserIndex] = {
        ...input[lastUserIndex],
        content: [...input[lastUserIndex].content, imagePart]
      };
    } else {
      input.push({ role: "user", content: [imagePart] });
    }
  }
  return input;
}

function openAIResponsesPdfFilePart(input: NonNullable<ModelRequest["input"]>, profile: ProviderProfile): Record<string, unknown> {
  const dataURL = `data:application/pdf;base64,${input.base64 ?? ""}`;
  const field = normalizePdfInputFileField(profile.bodyExtra?.pdfInputFileField);
  return {
    type: "input_file",
    filename: input.filename ?? "paper.pdf",
    [field]: dataURL
  };
}

function shouldOmitPdfInputFile(profile: ProviderProfile): boolean {
  return isTrueValue(profile.bodyExtra?.omitPdfInputFile)
    || isTrueValue(profile.bodyExtra?.skipPdfInputFile)
    || isTrueValue(profile.bodyExtra?.dropPdfInputFile);
}

function shouldOmitAnthropicDocument(profile: ProviderProfile): boolean {
  return isTrueValue(profile.bodyExtra?.omitAnthropicDocument)
    || isTrueValue(profile.bodyExtra?.skipAnthropicDocument)
    || isTrueValue(profile.bodyExtra?.dropAnthropicDocument)
    || isTrueValue(profile.bodyExtra?.omitPdfDocument)
    || isTrueValue(profile.bodyExtra?.skipPdfDocument)
    || isTrueValue(profile.bodyExtra?.dropPdfDocument);
}

function normalizePdfInputFileField(value: unknown): "file_data" | "file_url" {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]/g, "");
  return normalized === "fileurl" || normalized === "url" ? "file_url" : "file_data";
}

function anthropicBody(request: ModelRequest): Record<string, unknown> {
  const systemInUser = isTrueValue(request.profile.bodyExtra?.systemFallbackToUser);
  return withBodyExtra(request.profile, {
    model: request.profile.model,
    ...(systemInUser ? {} : { system: request.system }),
    messages: anthropicMessages(request, systemInUser ? request.system : ""),
    max_tokens: request.maxOutputTokens,
    stream: request.stream && request.profile.capabilities.streaming
  });
}

function withInputText(request: ModelRequest): ChatMessage[] {
  const messages = [...request.messages];
  if (!request.input?.text) return messages;
  const last = messages[messages.length - 1];
  if (last?.role === "user") {
    messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${request.input.text}` };
    return messages;
  }
  messages.push({ role: "user", content: request.input.text });
  return messages;
}

function messagesToText(messages: ChatMessage[], inputText?: string): string {
  const body = messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  return inputText ? `${body}\n\nCONTEXT:\n${inputText}` : body;
}

function anthropicMessages(request: ModelRequest, fallbackSystem = ""): Array<Record<string, unknown>> {
  const messages: AnthropicMessage[] = request.messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
  const systemText = fallbackSystemText(fallbackSystem);
  const contentBlocks: Array<Record<string, unknown>> = [];
  for (const image of inputImages(request)) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType || "image/png",
        data: image.base64 ?? ""
      }
    });
  }
  if (request.input?.type === "pdf_base64" && !shouldOmitAnthropicDocument(request.profile)) {
    contentBlocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: request.input.base64 ?? ""
      }
    });
  }
  const inputText = request.input?.type === "text" ? request.input.text : "";
  if (!contentBlocks.length && !inputText) {
    const nextMessages = systemText ? messagesWithPrependedAnthropicText(messages, systemText) as AnthropicMessage[] : messages;
    return formatAnthropicMessages(mergeConsecutiveAnthropicMessages(nextMessages), request.profile);
  }
  const lastUserIndex = findLastIndex(messages, (message) => message.role === "user");
  if (lastUserIndex >= 0) {
    const baseText = String(messages[lastUserIndex].content || "");
    const text = [systemText, inputText ? `${baseText}\n\nCONTEXT:\n${inputText}` : baseText].filter(Boolean).join("\n\n");
    contentBlocks.push({ type: "text", text });
    messages[lastUserIndex] = { role: "user", content: contentBlocks };
    return formatAnthropicMessages(mergeConsecutiveAnthropicMessages(messages), request.profile);
  }
  contentBlocks.push({ type: "text", text: [systemText, inputText ? `CONTEXT:\n${inputText}` : ""].filter(Boolean).join("\n\n") });
  messages.push({ role: "user", content: contentBlocks });
  return formatAnthropicMessages(mergeConsecutiveAnthropicMessages(messages), request.profile);
}

function inputImages(request: ModelRequest): Array<{ name?: string; mimeType: string; base64: string }> {
  return Array.isArray(request.input?.images)
    ? request.input.images.filter((image) => !!image?.base64)
    : [];
}

function imageDataURL(image: { mimeType?: string; base64?: string }): string {
  return `data:${image.mimeType || "image/png"};base64,${image.base64 || ""}`;
}

function openAIChatImagePart(image: { mimeType?: string; base64?: string }, profile: ProviderProfile): Record<string, unknown> {
  const dataURL = imageDataURL(image);
  return {
    type: "image_url",
    image_url: openAIChatImageURLFormat(profile.bodyExtra?.imageURLFormat) === "string" ? dataURL : { url: dataURL }
  };
}

function openAIChatImageURLFormat(value: unknown): "object" | "string" {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  return normalized === "string" || normalized === "dataurl" || normalized === "urlstring" ? "string" : "object";
}

function formatAnthropicMessages(messages: AnthropicMessage[], profile: ProviderProfile): AnthropicMessage[] {
  if (anthropicTextContentFormat(profile.bodyExtra?.anthropicTextContentFormat ?? profile.bodyExtra?.anthropicTextContent) !== "blocks") {
    return messages;
  }
  return messages.map((message) => typeof message.content === "string"
    ? { ...message, content: [{ type: "text", text: message.content }] }
    : message);
}

function anthropicTextContentFormat(value: unknown): "string" | "blocks" {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  return normalized === "block" || normalized === "blocks" || normalized === "array" || normalized === "contentblocks" || normalized === "textblocks" ? "blocks" : "string";
}

function mergeConsecutiveAnthropicMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = [];
  for (const message of messages) {
    if (!hasAnthropicContent(message.content)) continue;
    const last = merged[merged.length - 1];
    if (last?.role === message.role) {
      last.content = mergeAnthropicContent(last.content, message.content);
    } else {
      merged.push({ role: message.role, content: message.content });
    }
  }
  return merged;
}

function hasAnthropicContent(content: AnthropicMessage["content"]): boolean {
  if (typeof content === "string") return !!content.trim();
  return Array.isArray(content) && content.length > 0;
}

function mergeAnthropicContent(left: AnthropicMessage["content"], right: AnthropicMessage["content"]): Array<Record<string, unknown>> {
  return compactAnthropicTextBlocks([...anthropicContentBlocks(left), ...anthropicContentBlocks(right)]);
}

function anthropicContentBlocks(content: AnthropicMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function compactAnthropicTextBlocks(blocks: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const compacted: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    const last = compacted[compacted.length - 1];
    if (block?.type === "text" && typeof block.text === "string" && last?.type === "text" && typeof last.text === "string") {
      last.text = `${last.text}\n\n${block.text}`;
    } else {
      compacted.push(block);
    }
  }
  return compacted;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function withBodyExtra(profile: ProviderProfile, body: Record<string, unknown>): Record<string, unknown> {
  return omitProviderBodyFields({ ...body, ...jsonModeBodyDefaults(profile), ...providerBodyExtra(profile.bodyExtra) }, profile.bodyExtra);
}

export function providerBodyExtra(bodyExtra: Record<string, unknown> | undefined): Record<string, unknown> {
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
    instructionsFallbackToUser: _instructionsFallbackToUser,
    systemFallbackToUser: _systemFallbackToUser,
    pdfInputFileField: _pdfInputFileField,
    omitPdfInputFile: _omitPdfInputFile,
    skipPdfInputFile: _skipPdfInputFile,
    dropPdfInputFile: _dropPdfInputFile,
    omitAnthropicDocument: _omitAnthropicDocument,
    skipAnthropicDocument: _skipAnthropicDocument,
    dropAnthropicDocument: _dropAnthropicDocument,
    omitPdfDocument: _omitPdfDocument,
    skipPdfDocument: _skipPdfDocument,
    dropPdfDocument: _dropPdfDocument,
    imageURLFormat: _imageURLFormat,
    anthropicTextContentFormat: _anthropicTextContentFormat,
    anthropicTextContent: _anthropicTextContent,
    omitFields: _omitFields,
    omitBodyFields: _omitBodyFields,
    removeFields: _removeFields,
    removeBodyFields: _removeBodyFields,
    ...rest
  } = bodyExtra;
  return rest;
}

export function providerCompatibilityFallbackFields(protocol: string, body: Record<string, unknown>, status: number, text: string, usedFallback: boolean | string[] = false): string[] {
  if (usedFallback === true || !["openai_chat", "openai_responses", "anthropic_messages"].includes(protocol) || !providerFallbackEligibleStatus(body, status, text, protocol)) return [];
  const usedFields = new Set(Array.isArray(usedFallback) ? usedFallback : []);
  const detail = String(text || "").toLowerCase();
  const fields: string[] = providerStructuredUnsupportedFields(body, text, protocol);
  if (body?.stream_options !== undefined && /stream_options|stream options|stream option/.test(detail)) {
    fields.push("stream_options");
  }
  if (body?.stream !== undefined && /\bstream\b|streaming/.test(detail)) {
    fields.push("stream");
    if (body?.stream_options !== undefined) fields.push("stream_options");
  }
  if (body?.temperature !== undefined && /temperature/.test(detail)) {
    fields.push("temperature");
  }
  if (body?.n !== undefined && /(?:^|[^a-z0-9_])n(?:[^a-z0-9_]|$)|number of completions|multiple completions/.test(detail)) {
    fields.push("n");
  }
  if (body?.response_format !== undefined && /response_format|response format/.test(detail)) {
    fields.push("response_format");
  }
  if (body?.max_completion_tokens !== undefined && /max_completion_tokens|max completion tokens|max completion token/.test(detail)) {
    fields.push("max_completion_tokens");
  }
  if (body?.max_tokens !== undefined && /max_tokens|max tokens|max token/.test(detail)) {
    fields.push("max_tokens");
  }
  if (body?.text !== undefined && /text\.format|text format|text\.verbosity|text verbosity|(?:^|[^a-z0-9_])text(?:[^a-z0-9_]|$)|json mode|json_schema|json schema/.test(detail)) {
    fields.push("text");
  }
  if (body?.max_output_tokens !== undefined && /max_output_tokens|max output tokens|max output token/.test(detail)) {
    fields.push("max_output_tokens");
  }
  if (body?.instructions !== undefined && /(?:^|[^a-z0-9_])instructions?(?:[^a-z0-9_]|$)|system instructions?|developer instructions?|system prompt/.test(detail)) {
    fields.push("instructions");
  }
  if (body?.reasoning !== undefined && /(?:^|[^a-z0-9_])reasoning(?:[^a-z0-9_]|$)|reasoning config|reasoning parameter/.test(detail)) {
    fields.push("reasoning");
  }
  if (body?.verbosity !== undefined && /(?:^|[^a-z0-9_])verbosity(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("verbosity");
  }
  if (body?.system !== undefined && /(?:^|[^a-z0-9_])system(?:[^a-z0-9_]|$)|system prompt|system field/.test(detail)) {
    fields.push("system");
  }
  if (body?.metadata !== undefined && /metadata/.test(detail)) {
    fields.push("metadata");
  }
  if (body?.thinking !== undefined && /thinking|reasoning/.test(detail)) {
    fields.push("thinking");
  }
  if (body?.top_p !== undefined && /top_p|top p/.test(detail)) {
    fields.push("top_p");
  }
  if (body?.presence_penalty !== undefined && /presence_penalty|presence penalty/.test(detail)) {
    fields.push("presence_penalty");
  }
  if (body?.frequency_penalty !== undefined && /frequency_penalty|frequency penalty/.test(detail)) {
    fields.push("frequency_penalty");
  }
  if (body?.seed !== undefined && /(?:^|[^a-z0-9_])seed(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("seed");
  }
  if (body?.top_logprobs !== undefined && /top_logprobs|top logprobs/.test(detail)) {
    fields.push("top_logprobs");
  }
  if (body?.logprobs !== undefined && /(?:^|[^a-z0-9_])logprobs(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("logprobs");
  }
  if (body?.parallel_tool_calls !== undefined && /parallel_tool_calls|parallel tool calls|parallel tool call/.test(detail)) {
    fields.push("parallel_tool_calls");
  }
  if (body?.reasoning_effort !== undefined && /reasoning_effort|reasoning effort/.test(detail)) {
    fields.push("reasoning_effort");
  }
  if (body?.stop !== undefined && /(?:^|[^a-z0-9_])stop(?:[^a-z0-9_]|$)|stop sequence|stop sequences/.test(detail)) {
    fields.push("stop");
  }
  if (body?.top_k !== undefined && /top_k|top k/.test(detail)) {
    fields.push("top_k");
  }
  if (body?.stop_sequences !== undefined && /stop_sequences|stop sequences|stop sequence/.test(detail)) {
    fields.push("stop_sequences");
  }
  if (body?.tools !== undefined && /(?:^|[^a-z0-9_])tools?(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("tools");
  }
  if (body?.tool_choice !== undefined && /tool_choice|tool choice/.test(detail)) {
    fields.push("tool_choice");
  }
  const rejectedAnthropicContentField = rejectedAnthropicMessagesContentField(body, detail);
  if (protocol === "anthropic_messages" && rejectedAnthropicContentField) {
    fields.push(rejectedAnthropicContentField);
  }
  const rejectedAnthropicDocumentField = rejectedAnthropicMessagesDocumentField(body, detail);
  if (protocol === "anthropic_messages" && rejectedAnthropicDocumentField) {
    fields.push(rejectedAnthropicDocumentField);
  }
  const rejectedImageURLField = rejectedOpenAIChatImageURLField(body, detail);
  if (protocol === "openai_chat" && rejectedImageURLField) {
    fields.push(rejectedImageURLField);
  }
  const rejectedSystemRoleField = rejectedOpenAIChatSystemRoleField(body, detail);
  if (protocol === "openai_chat" && rejectedSystemRoleField) {
    fields.push(rejectedSystemRoleField);
  }
  const rejectedPDFField = rejectedOpenAIResponsesPdfFileField(body, detail);
  if (protocol === "openai_responses" && rejectedPDFField) {
    fields.push(rejectedPDFField);
  }
  return Array.from(new Set(fields)).filter((field) => !usedFields.has(field));
}

function providerFallbackEligibleStatus(body: Record<string, unknown>, status: number, text: string, protocol = ""): boolean {
  const numericStatus = Number(status);
  if (numericStatus === 400 || numericStatus === 422) return true;
  if (numericStatus !== 200) return false;
  return providerOkResponseLooksLikeFallbackError(body, text, protocol);
}

function providerOkResponseLooksLikeFallbackError(body: Record<string, unknown>, text: string, protocol = ""): boolean {
  const parsed = safeParseJSON(text);
  if (!parsed) return false;
  if (streamErrorText(parsed)) return true;
  if (!providerStructuredUnsupportedFields(body, text, protocol).length) return false;
  return /unsupported|unrecognized|not supported|unknown (?:field|parameter|argument)|extra_forbidden|not permitted|invalid|forbidden/.test(String(text || "").toLowerCase());
}

const PROVIDER_FALLBACK_BODY_FIELDS = new Set([
  "stream_options",
  "stream",
  "temperature",
  "n",
  "response_format",
  "max_completion_tokens",
  "max_tokens",
  "text",
  "max_output_tokens",
  "instructions",
  "reasoning",
  "verbosity",
  "system",
  "metadata",
  "thinking",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "top_logprobs",
  "logprobs",
  "parallel_tool_calls",
  "reasoning_effort",
  "stop",
  "top_k",
  "stop_sequences",
  "tools",
  "tool_choice",
  "messages.content",
  "messages.content.document",
  "messages.role.system",
  "image_url.url",
  "input_file.file_data",
  "input_file.file_url"
]);
const PROVIDER_REQUIRED_BODY_FIELDS = new Set(["model", "messages", "input"]);

function providerStructuredUnsupportedFields(body: Record<string, unknown>, text: string, protocol = ""): string[] {
  const parsed = safeParseJSON(text);
  if (!parsed) return [];
  const hints: string[] = [];
  collectProviderFieldHints(parsed, hints);
  return hints
    .map((value) => normalizeProviderFieldHint(value))
    .filter((field) => providerFallbackFieldSupported(body, field, protocol) && providerFallbackFieldPresent(body, field));
}

function collectProviderFieldHints(value: unknown, hints: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectProviderFieldHints(item, hints);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isProviderFieldHintKey(key)) collectProviderFieldHintValue(entry, hints);
    if (entry && typeof entry === "object") collectProviderFieldHints(entry, hints);
  }
}

function collectProviderFieldHintValue(value: unknown, hints: string[]): void {
  if (typeof value === "string") {
    hints.push(value);
    return;
  }
  if (Array.isArray(value)) {
    const path = providerFieldHintArrayPath(value);
    if (path) hints.push(path);
    for (const item of value) collectProviderFieldHintValue(item, hints);
  }
}

function providerFieldHintArrayPath(value: unknown[]): string {
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
  return path.includes(".") || path.includes("[") ? path : "";
}

function isProviderFieldHintKey(key: string): boolean {
  return /^(?:param|params|parameter|parameters|field|fields|property|properties|argument|arguments|loc|location|path|json_path|jsonpath|unsupported_param|unsupported_params|unsupported_parameter|unsupported_parameters|unsupported_field|unsupported_fields|unknown_param|unknown_params|unknown_parameter|unknown_parameters|unknown_field|unknown_fields|invalid_param|invalid_params|invalid_parameter|invalid_parameters|invalid_field|invalid_fields|extra_field|extra_fields|forbidden_field|forbidden_fields|unrecognized_param|unrecognized_params|unrecognized_parameter|unrecognized_parameters|unrecognized_field|unrecognized_fields)$/i.test(key);
}

function normalizeProviderFieldHint(value: string): string {
  const normalized = String(value || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\$\.?/, "")
    .replace(/^(?:body|request|payload|params?|parameters?|input)\./i, "")
    .replace(/\[[^\]]+\]/g, "");
  if (/\bfile_data\b/.test(normalized)) return "input_file.file_data";
  if (/\bfile_url\b/.test(normalized)) return "input_file.file_url";
  if (/image_url\.url|image_url_url|imageurl\.url|imageurlurl|(?:^|[^a-z0-9_])image_url(?:[^a-z0-9_]|$)|(?:^|[^a-z0-9_])imageurl(?:[^a-z0-9_]|$)/.test(normalized)) return "image_url.url";
  if (/messages?(?:\.\d+|\[\d+\])?\.content.*(?:document|source|media_type|mediatype|base64|application\/pdf)|messages?content.*(?:document|source|media_type|mediatype|base64|applicationpdf)|(?:^|[^a-z0-9_])document(?:[^a-z0-9_]|$)/.test(normalized)) return "messages.content.document";
  if (/messages?(?:\.\d+|\[\d+\])?\.content|messages?content/.test(normalized)) return "messages.content";
  if (/messages?(?:\.\d+|\[\d+\])?\.role|messages?role/.test(normalized)) return "messages.role.system";
  return normalized
    .split(".")[0]
    .trim();
}

function providerFallbackFieldPresent(body: Record<string, unknown>, field: string): boolean {
  if (field === "messages.content") return anthropicMessagesHaveStringContent(body);
  if (field === "messages.content.document") return anthropicMessagesHaveDocumentBlock(body);
  if (field === "messages.role.system") return openAIChatHasSystemMessage(body);
  if (field === "image_url.url") return openAIChatImageURLHasObjectURL(body);
  if (field === "input_file.file_data") return openAIResponsesInputFileHasField(body, "file_data");
  if (field === "input_file.file_url") return openAIResponsesInputFileHasField(body, "file_url");
  return body?.[field] !== undefined;
}

function providerFallbackFieldSupported(body: Record<string, unknown>, field: string, protocol = ""): boolean {
  if (!field) return false;
  if (field === "messages.content") return protocol === "anthropic_messages";
  if (field === "messages.content.document") return protocol === "anthropic_messages";
  if (field === "messages.role.system") return protocol === "openai_chat";
  if (PROVIDER_FALLBACK_BODY_FIELDS.has(field)) return true;
  return providerFallbackCustomBodyFieldPresent(body, field);
}

function providerFallbackCustomBodyFieldPresent(body: Record<string, unknown>, field: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) return false;
  if (PROVIDER_REQUIRED_BODY_FIELDS.has(field.toLowerCase())) return false;
  return Object.prototype.hasOwnProperty.call(body || {}, field);
}

function rejectedAnthropicMessagesContentField(body: Record<string, unknown>, detail: string): string {
  if (!anthropicMessagesHaveStringContent(body)) return "";
  if (/messages?(?:[.\[]\d+\]?)*\.?content|message content|content.*(?:array|list|block)|(?:array|list|block).*content|valid list|list_type/.test(detail)) {
    return "messages.content";
  }
  return "";
}

function anthropicMessagesHaveStringContent(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some((message: any) => typeof message?.content === "string");
}

function rejectedAnthropicMessagesDocumentField(body: Record<string, unknown>, detail: string): string {
  if (!anthropicMessagesHaveDocumentBlock(body)) return "";
  if (/messages?(?:[.\[]\d+\]?)*\.?content.*(?:document|source|media_type|media type|base64|application\/pdf)|content block.*document|document.*content block|unsupported document|document.*unsupported|pdf.*(?:unsupported|not supported|invalid)|(?:unsupported|not supported|invalid).*pdf/.test(detail)) {
    return "messages.content.document";
  }
  return "";
}

function anthropicMessagesHaveDocumentBlock(body: Record<string, unknown>): boolean {
  return anthropicDocumentBlocks(body).length > 0;
}

function anthropicDocumentBlocks(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.flatMap((message: any) => Array.isArray(message?.content) ? message.content : [])
    .filter((part: any) => part?.type === "document" && part && typeof part === "object");
}

function rejectedOpenAIChatImageURLField(body: Record<string, unknown>, detail: string): string {
  if (!openAIChatImageURLHasObjectURL(body)) return "";
  if (/image_url\.url|image_url_url|imageurl\.url|imageurlurl|(?:^|[^a-z0-9_])image_url(?:[^a-z0-9_]|$)|image url|(?:^|[^a-z0-9_])imageurl(?:[^a-z0-9_]|$)/.test(detail)) return "image_url.url";
  return "";
}

function rejectedOpenAIChatSystemRoleField(body: Record<string, unknown>, detail: string): string {
  if (!openAIChatHasSystemMessage(body)) return "";
  if (/system (?:role|message)|(?:role|message).*system|messages?(?:[.\[]\d+\]?)*\.?role|message role|unsupported role|invalid role|expected.*(?:user|assistant)|(?:user|assistant).*expected/.test(detail)) {
    return "messages.role.system";
  }
  return "";
}

function openAIChatHasSystemMessage(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some((message: any) => String(message?.role || "").toLowerCase() === "system");
}

function openAIChatImageURLHasObjectURL(body: Record<string, unknown>): boolean {
  return openAIChatImageParts(body).some((part) => {
    const imageURL = part?.image_url;
    return imageURL && typeof imageURL === "object" && !Array.isArray(imageURL) && imageURL.url !== undefined;
  });
}

function openAIChatImageParts(body: Record<string, unknown>): Array<Record<string, any>> {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.flatMap((message: any) => Array.isArray(message?.content) ? message.content : [])
    .filter((part: any) => part?.type === "image_url" && part && typeof part === "object");
}

function rejectedOpenAIResponsesPdfFileField(body: Record<string, unknown>, detail: string): string {
  if (openAIResponsesInputFileHasField(body, "file_data") && /\bfile_data\b/.test(detail)) return "input_file.file_data";
  if (openAIResponsesInputFileHasField(body, "file_url") && /\bfile_url\b/.test(detail)) return "input_file.file_url";
  return "";
}

function openAIResponsesInputFileHasField(body: Record<string, unknown>, field: "file_data" | "file_url"): boolean {
  return openAIResponsesInputFileParts(body).some((part) => part[field] !== undefined);
}

function openAIResponsesInputFileParts(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const input = Array.isArray(body?.input) ? body.input : [];
  return input.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => part?.type === "input_file" && part && typeof part === "object");
}

export function omitProviderRequestBodyFields(body: Record<string, unknown>, fields: string[], usedFallback: boolean | string[] = false): Record<string, unknown> {
  if (!fields.length) return body;
  const next = { ...body };
  const usedFields = new Set(Array.isArray(usedFallback) ? usedFallback : []);
  for (const field of fields) {
    if (field === "instructions") {
      moveInstructionsIntoOpenAIResponsesInput(next);
      continue;
    }
    if (field === "system") {
      moveAnthropicSystemIntoMessages(next);
      continue;
    }
    if (field === "max_completion_tokens" && !usedFields.has("max_tokens") && next.max_completion_tokens !== undefined && next.max_tokens === undefined) {
      next.max_tokens = next.max_completion_tokens;
      delete next.max_completion_tokens;
      continue;
    }
    if (field === "max_tokens" && !usedFields.has("max_completion_tokens") && next.max_tokens !== undefined && next.max_completion_tokens === undefined) {
      next.max_completion_tokens = next.max_tokens;
      delete next.max_tokens;
      continue;
    }
    if (field === "input_file.file_data") {
      if (usedFields.has("input_file.file_url")) {
        removeOpenAIResponsesInputFiles(next);
      } else {
        switchOpenAIResponsesInputFileField(next, "file_data", "file_url");
      }
      continue;
    }
    if (field === "input_file.file_url") {
      if (usedFields.has("input_file.file_data")) {
        removeOpenAIResponsesInputFiles(next);
      } else {
        switchOpenAIResponsesInputFileField(next, "file_url", "file_data");
      }
      continue;
    }
    if (field === "image_url.url") {
      switchOpenAIChatImageURLToString(next);
      continue;
    }
    if (field === "messages.role.system") {
      moveOpenAIChatSystemIntoMessages(next);
      continue;
    }
    if (field === "messages.content") {
      switchAnthropicStringMessagesToTextBlocks(next);
      continue;
    }
    if (field === "messages.content.document") {
      removeAnthropicDocumentBlocks(next);
      continue;
    }
    delete next[field];
  }
  return next;
}

function switchAnthropicStringMessagesToTextBlocks(body: Record<string, unknown>): void {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message: any) => typeof message?.content === "string"
    ? { ...message, content: [{ type: "text", text: message.content }] }
    : message);
}

function switchOpenAIChatImageURLToString(body: Record<string, unknown>): void {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message: any) => {
    const content = Array.isArray(message?.content) ? message.content : null;
    if (!content) return message;
    return {
      ...message,
      content: content.map((part: any) => {
        const imageURL = part?.image_url;
        if (part?.type !== "image_url" || !imageURL || typeof imageURL !== "object" || Array.isArray(imageURL) || imageURL.url === undefined) return part;
        return { ...part, image_url: imageURL.url };
      })
    };
  });
}

function switchOpenAIResponsesInputFileField(body: Record<string, unknown>, from: "file_data" | "file_url", to: "file_data" | "file_url"): void {
  const input = Array.isArray(body.input) ? body.input : [];
  body.input = input.map((item: any) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    return {
      ...item,
      content: content.map((part: any) => {
        if (part?.type !== "input_file" || part?.[from] === undefined) return part;
        const { [from]: value, ...rest } = part;
        return { ...rest, [to]: value };
      })
    };
  });
}

function removeOpenAIResponsesInputFiles(body: Record<string, unknown>): void {
  const input = Array.isArray(body.input) ? body.input : [];
  body.input = input.map((item: any) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    return {
      ...item,
      content: content.filter((part: any) => part?.type !== "input_file")
    };
  });
}

function removeAnthropicDocumentBlocks(body: Record<string, unknown>): void {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message: any) => {
    const content = Array.isArray(message?.content) ? message.content : null;
    if (!content) return message;
    return {
      ...message,
      content: content.filter((part: any) => part?.type !== "document")
    };
  });
}

function fallbackSystemText(value: unknown): string {
  const text = String(value || "").trim();
  return text ? `SYSTEM:\n${text}` : "";
}

function moveInstructionsIntoOpenAIResponsesInput(body: Record<string, unknown>): void {
  const systemText = fallbackSystemText(body.instructions);
  if (systemText) {
    body.input = inputWithPrependedOpenAIResponsesText(body.input, systemText);
  }
  delete body.instructions;
}

function inputWithPrependedOpenAIResponsesText(input: unknown, text: string): unknown {
  const textPart = { type: "input_text", text };
  const items = Array.isArray(input) ? input.map((item) => clonePlainObject(item)) : [];
  const userIndex = items.findIndex((item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex] as Record<string, unknown>;
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [textPart, ...content] };
    return items;
  }
  return [{ role: "user", content: [textPart] }, ...items];
}

function moveAnthropicSystemIntoMessages(body: Record<string, unknown>): void {
  const systemText = fallbackSystemText(body.system);
  if (systemText) {
    body.messages = messagesWithPrependedAnthropicText(body.messages, systemText);
  }
  delete body.system;
}

function moveOpenAIChatSystemIntoMessages(body: Record<string, unknown>): void {
  const messages = Array.isArray(body.messages) ? body.messages.map((item) => clonePlainObject(item)) : [];
  const systemText = messages
    .filter((message) => String(message?.role || "").toLowerCase() === "system")
    .map((message) => extractMessageContent(message.content))
    .filter(Boolean)
    .join("\n\n");
  const remaining = messages.filter((message) => String(message?.role || "").toLowerCase() !== "system");
  body.messages = systemText ? messagesWithPrependedOpenAIChatText(remaining, fallbackSystemText(systemText)) : remaining;
}

function messagesWithPrependedOpenAIChatText(messages: unknown, text: string): unknown {
  const items = Array.isArray(messages) ? messages.map((item) => clonePlainObject(item)) : [];
  const userIndex = items.findIndex((item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex] as Record<string, unknown>;
    if (typeof item.content === "string") {
      items[userIndex] = { ...item, content: `${text}\n\n${item.content}` };
      return items;
    }
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [{ type: "text", text }, ...content] };
    return items;
  }
  return [{ role: "user", content: text }, ...items];
}

function messagesWithPrependedAnthropicText(messages: unknown, text: string): unknown {
  const items = Array.isArray(messages) ? messages.map((item) => clonePlainObject(item)) : [];
  const userIndex = items.findIndex((item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex] as Record<string, unknown>;
    if (typeof item.content === "string") {
      items[userIndex] = { ...item, content: `${text}\n\n${item.content}` };
      return items;
    }
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [{ type: "text", text }, ...content] };
    return items;
  }
  return [{ role: "user", content: text }, ...items];
}

function clonePlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : { value };
}

function omitProviderBodyFields(body: Record<string, unknown>, bodyExtra: Record<string, unknown> | undefined): Record<string, unknown> {
  const fields = providerBodyOmitFields(bodyExtra);
  if (!fields.size) return body;
  const next = { ...body };
  for (const field of fields) delete next[field];
  return next;
}

function providerBodyOmitFields(bodyExtra: Record<string, unknown> | undefined): Set<string> {
  if (!bodyExtra || typeof bodyExtra !== "object" || Array.isArray(bodyExtra)) return new Set();
  const values = [
    bodyExtra.omitFields,
    bodyExtra.omitBodyFields,
    bodyExtra.removeFields,
    bodyExtra.removeBodyFields
  ];
  return new Set(values.flatMap((value) => bodyFieldList(value)).filter(Boolean));
}

function bodyFieldList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => bodyFieldList(item));
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function isTrueValue(value: unknown): boolean {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function openAIChatTokenLimit(profile: ProviderProfile, maxTokens: number): Record<string, unknown> {
  return { [openAIChatTokenLimitField(profile)]: maxTokens };
}

function openAIChatOptionalDefaults(profile: ProviderProfile, defaults: Record<string, unknown>): Record<string, unknown> {
  return openAIChatTokenLimitField(profile) === "max_completion_tokens" ? {} : defaults;
}

function openAIChatTokenLimitField(profile: ProviderProfile): "max_tokens" | "max_completion_tokens" {
  const extra = providerBodyExtra(profile.bodyExtra);
  const explicit = normalizeOpenAIChatTokenLimitField(
    profile.bodyExtra?.tokenLimitField
    ?? profile.bodyExtra?.openAIChatTokenField
    ?? profile.bodyExtra?.chatTokenField
    ?? profile.bodyExtra?.maxTokenField
  );
  if (explicit) return explicit;
  if (extra.max_completion_tokens !== undefined && extra.max_tokens === undefined) return "max_completion_tokens";
  if (extra.max_tokens !== undefined && extra.max_completion_tokens === undefined) return "max_tokens";
  return modelPrefersCompletionTokenLimit(profile.model) ? "max_completion_tokens" : "max_tokens";
}

function normalizeOpenAIChatTokenLimitField(value: unknown): "max_tokens" | "max_completion_tokens" | "" {
  const normalized = String(value || "").trim().toLowerCase().replace(/[.\s-]+/g, "_");
  if (!normalized) return "";
  if (normalized === "max_completion_tokens" || normalized === "completion_tokens" || normalized === "completion") return "max_completion_tokens";
  if (normalized === "max_tokens" || normalized === "tokens") return "max_tokens";
  return "";
}

function modelPrefersCompletionTokenLimit(model: unknown): boolean {
  return /^o\d(?:$|[-_.])/i.test(String(model || "").trim());
}

function jsonModeBodyDefaults(profile: ProviderProfile): Record<string, unknown> {
  if (!profile.capabilities?.jsonMode || profile.protocol === "anthropic_messages") return {};
  const extra = providerBodyExtra(profile.bodyExtra);
  if (profile.protocol === "openai_responses") {
    if (extra.text !== undefined || extra.response_format !== undefined) return {};
    return { text: { format: { type: "json_object" } } };
  }
  if (extra.response_format !== undefined) return {};
  return { response_format: { type: "json_object" } };
}

function endpointForProtocol(protocol: ProviderProtocol, baseURL: string): string {
  const base = stripKnownProviderEndpointPath(baseURL);
  if (!base) throw new Error("Base URL endpoint is required");
  if (protocol === "anthropic_messages") {
    return /\/v\d+$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
  }
  if (protocol === "openai_responses") return `${openAICompatibleBaseWithVersion(base)}/responses`;
  return `${openAICompatibleBaseWithVersion(base)}/chat/completions`;
}

function stripKnownProviderEndpointPath(baseURL: string): string {
  return String(baseURL || "")
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|responses|messages|models)$/i, "");
}

function openAICompatibleBaseWithVersion(baseURL: string): string {
  const base = String(baseURL || "").replace(/\/+$/, "");
  return hasOpenAICompatibleVersionPath(base) || usesVersionlessOpenAICompatibleBase(base) ? base : `${base}/v1`;
}

function hasOpenAICompatibleVersionPath(baseURL: string): boolean {
  return /\/v\d+(?:[a-z]+)?$/i.test(baseURL) || /\/v\d+(?:[a-z]+)?\/openai$/i.test(baseURL);
}

function usesVersionlessOpenAICompatibleBase(baseURL: string): boolean {
  const normalized = String(baseURL || "").replace(/\/+$/, "");
  return /^https:\/\/api\.perplexity\.ai$/i.test(normalized)
    || /^https:\/\/models\.github\.ai\/inference$/i.test(normalized);
}
