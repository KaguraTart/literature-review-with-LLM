export type Provider = "minimax" | "openai" | "anthropic";
export type InputMode = "text" | "pdf_base64";

export interface SummaryRequest {
  provider: Provider;
  baseURL: string;
  apiKey: string;
  model: string;
  request: {
    system: string;
    prompt: string;
    input: { type: InputMode; text?: string; base64?: string; filename?: string };
    temperature: number;
    maxOutputTokens: number;
    stream: boolean;
  };
}

export function endpointFor(request: SummaryRequest): string {
  const base = request.baseURL.replace(/\/+$/, "");
  if (request.provider === "anthropic") return `${base}/v1/messages`;
  if (request.provider === "openai" && request.request.input.type === "pdf_base64") return `${base}/responses`;
  return `${base}/chat/completions`;
}

export function bodyFor(request: SummaryRequest): Record<string, unknown> {
  if (request.provider === "anthropic") return anthropicBody(request);
  if (request.request.input.type === "pdf_base64") {
    if (request.provider === "minimax") throw new Error("MiniMax OpenAI compatible mode uses extracted text input");
    return openaiResponsesBody(request);
  }
  return chatCompletionsBody(request);
}

function chatCompletionsBody(request: SummaryRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: [
      { role: "system", content: request.request.system },
      { role: "user", content: `${request.request.prompt}\n\n${request.request.input.text ?? ""}` }
    ],
    temperature: request.request.temperature,
    max_tokens: request.request.maxOutputTokens,
    stream: request.request.stream,
    n: 1
  };
  if (request.provider === "minimax") {
    body.extra_body = { reasoning_split: true };
  }
  return body;
}

function openaiResponsesBody(request: SummaryRequest): Record<string, unknown> {
  return {
    model: request.model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: `${request.request.system}\n\n${request.request.prompt}` },
          {
            type: "input_file",
            filename: request.request.input.filename ?? "paper.pdf",
            file_data: `data:application/pdf;base64,${request.request.input.base64 ?? ""}`
          }
        ]
      }
    ],
    temperature: request.request.temperature,
    max_output_tokens: request.request.maxOutputTokens,
    stream: request.request.stream
  };
}

function anthropicBody(request: SummaryRequest): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  if (request.request.input.type === "pdf_base64") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: request.request.input.base64 ?? ""
      }
    });
  }
  content.push({
    type: "text",
    text: request.request.input.type === "text"
      ? `${request.request.prompt}\n\n${request.request.input.text ?? ""}`
      : request.request.prompt
  });
  return {
    model: request.model,
    system: request.request.system,
    messages: [{ role: "user", content }],
    max_tokens: request.request.maxOutputTokens,
    temperature: request.request.temperature,
    stream: false
  };
}
