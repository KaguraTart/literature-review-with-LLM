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
  return headers;
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
  return String(text).trim();
}

export function parseStreamChunk(protocol: ProviderProtocol, rawLine: string): string {
  return streamPayloads(rawLine).map((payload) => parseStreamPayload(protocol, payload)).filter(Boolean).join("");
}

function parseStreamPayload(protocol: ProviderProtocol, payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  const data = safeParseJSON(payload) as any;
  if (!data) return "";
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  if (protocol === "anthropic_messages") {
    if (data?.type === "content_block_delta") {
      return data?.delta?.text || data?.delta?.partial_json || "";
    }
    return data?.delta?.text
      || data?.delta?.partial_json
      || data?.content_block?.text
      || extractAnthropicContent(data)
      || "";
  }
  if (typeof data?.choices?.[0]?.delta === "string") return data.choices[0].delta;
  const deltaContent = extractMessageContent(data?.choices?.[0]?.delta?.content);
  if (deltaContent) return deltaContent;
  const messageContent = extractMessageContent(data?.choices?.[0]?.message?.content);
  if (messageContent) return messageContent;
  if (data?.type === "response.output_text.delta" && typeof data?.delta === "string") return data.delta;
  if (data?.type === "response.text.delta" && typeof data?.delta === "string") return data.delta;
  if (data?.delta?.content) {
    const nestedDelta = extractMessageContent(data.delta.content);
    if (nestedDelta) return nestedDelta;
  }
  const directContent = extractMessageContent(data?.content);
  if (directContent) return directContent;
  const eventContent = extractOpenAIEventContainer(data);
  if (eventContent) return eventContent;
  return data?.choices?.[0]?.text
    || data?.choices?.[0]?.delta?.text
    || extractOutputContent(data?.output)
    || (typeof data?.delta === "string" ? data.delta : "")
    || "";
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
  const messages = [
    { role: "system", content: request.system },
    ...openaiChatMessages(request)
  ];
  return withBodyExtra(request.profile, {
    model: request.profile.model,
    messages,
    temperature: request.temperature,
    ...openAIChatTokenLimit(request.profile, request.maxOutputTokens),
    stream: request.stream,
    n: 1
  });
}

function openaiChatMessages(request: ModelRequest): Array<Record<string, unknown>> {
  const messages = withInputText(request).map((message) => ({ role: message.role, content: message.content as unknown }));
  const images = inputImages(request);
  if (!images.length) return messages;
  const lastUserIndex = findLastIndex(messages, (message) => message.role === "user");
  const imageParts = images.map((image) => ({ type: "image_url", image_url: { url: imageDataURL(image) } }));
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

function extractMessageContent(content: unknown): string {
  const record = content as Record<string, unknown> | null;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item: any) => extractMessageContent(item)).filter(Boolean).join("\n");
  }
  if (record && typeof record === "object") {
    if (isReasoningContent(record)) return "";
    if (typeof record.text === "string") return record.text;
    if (typeof record.output_text === "string") return record.output_text;
    if (typeof record.content === "string") return record.content;
    if (Array.isArray(record.content)) return extractMessageContent(record.content);
    if (Array.isArray(record.output)) return extractOutputContent(record.output);
  }
  return "";
}

function extractOutputContent(output: unknown): string {
  if (!Array.isArray(output)) return "";
  return output
    .map((item: any) => extractMessageContent(item))
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
    || extractMessageContent(data?.choices?.[0]?.message?.content)
    || extractMessageContent(data?.choices?.[0]?.delta?.content)
    || data?.choices?.[0]?.text
    || data?.choices?.[0]?.delta?.text
    || extractOutputContent(data?.output)
    || extractMessageContent(data?.content)
    || extractOpenAIEventContainer(data)
    || extractWrappedResponseContent("openai", data, depth);
}

function extractAnthropicContent(data: any): string {
  const content = data?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return typeof data?.text === "string" ? data.text : "";
}

function extractAnthropicResponseContent(data: any, depth = 0): string {
  return extractAnthropicContent(data) || extractWrappedResponseContent("anthropic", data, depth);
}

function extractWrappedResponseContent(protocol: "openai" | "anthropic", data: any, depth: number): string {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of ["data", "result", "payload", "response"]) {
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
  return type.includes("reasoning") || type === "thinking";
}

function safeParseJSON(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function streamErrorText(data: any): string {
  const error = data?.error || (data?.type === "error" ? data : null);
  if (!error) return "";
  if (typeof error === "string") return error;
  const code = error.code || error.type || data?.code || data?.type || "";
  const message = error.message || data?.message || "";
  return [code, message || JSON.stringify(error)].filter(Boolean).join(" - ");
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
  if (id === "anthropic-compatible" || id === "anthropic_compatible" || id === "deepseek-anthropic" || id === "deepseek_anthropic" || id === "zai-anthropic" || id === "zai_anthropic") return "authorization";
  if (baseURL === "https://api.deepseek.com/anthropic" || baseURL.startsWith("https://api.deepseek.com/anthropic/")) return "authorization";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL.startsWith("https://api.z.ai/api/anthropic/")) return "authorization";
  return "x-api-key";
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
  return withBodyExtra(request.profile, {
    model: request.profile.model,
    instructions: request.system,
    input: openaiResponsesInput(request),
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    stream: request.stream
  });
}

function openaiResponsesInput(request: ModelRequest): OpenAIResponsesInputItem[] {
  const input: OpenAIResponsesInputItem[] = request.messages.map((message) => ({
    role: message.role,
    content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.content }]
  }));
  const lastUserIndex = findLastIndex(input, (message) => message.role === "user");
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
  if (request.input?.type === "pdf_base64") {
    const filePart = {
      type: "input_file",
      filename: request.input.filename ?? "paper.pdf",
      file_data: `data:application/pdf;base64,${request.input.base64 ?? ""}`
    };
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

function anthropicBody(request: ModelRequest): Record<string, unknown> {
  return withBodyExtra(request.profile, {
    model: request.profile.model,
    system: request.system,
    messages: anthropicMessages(request),
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

function anthropicMessages(request: ModelRequest): Array<Record<string, unknown>> {
  const messages: AnthropicMessage[] = request.messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
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
  if (request.input?.type === "pdf_base64") {
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
  if (!contentBlocks.length && !inputText) return mergeConsecutiveAnthropicMessages(messages);
  const lastUserIndex = findLastIndex(messages, (message) => message.role === "user");
  if (lastUserIndex >= 0) {
    const baseText = String(messages[lastUserIndex].content || "");
    contentBlocks.push({ type: "text", text: inputText ? `${baseText}\n\nCONTEXT:\n${inputText}` : baseText });
    messages[lastUserIndex] = { role: "user", content: contentBlocks };
    return mergeConsecutiveAnthropicMessages(messages);
  }
  contentBlocks.push({ type: "text", text: inputText ? `CONTEXT:\n${inputText}` : "" });
  messages.push({ role: "user", content: contentBlocks });
  return mergeConsecutiveAnthropicMessages(messages);
}

function inputImages(request: ModelRequest): Array<{ name?: string; mimeType: string; base64: string }> {
  return Array.isArray(request.input?.images)
    ? request.input.images.filter((image) => !!image?.base64)
    : [];
}

function imageDataURL(image: { mimeType?: string; base64?: string }): string {
  return `data:${image.mimeType || "image/png"};base64,${image.base64 || ""}`;
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
    omitFields: _omitFields,
    omitBodyFields: _omitBodyFields,
    removeFields: _removeFields,
    removeBodyFields: _removeBodyFields,
    ...rest
  } = bodyExtra;
  return rest;
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

function openAIChatTokenLimit(profile: ProviderProfile, maxTokens: number): Record<string, unknown> {
  return { [openAIChatTokenLimitField(profile)]: maxTokens };
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
  return /^https:\/\/api\.perplexity\.ai$/i.test(String(baseURL || "").replace(/\/+$/, ""));
}
