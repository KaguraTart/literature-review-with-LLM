import { describe, expect, it } from "vitest";
import { bodyFor, endpointFor, type SummaryRequest } from "../src/providerAdapters";

const baseRequest: SummaryRequest = {
  provider: "minimax",
  baseURL: "https://api.minimaxi.com/v1",
  apiKey: "not-used-in-tests",
  model: "MiniMax-M2.7",
  request: {
    system: "system",
    prompt: "prompt",
    input: { type: "text", text: "paper text" },
    temperature: 1,
    maxOutputTokens: 8192,
    stream: true
  }
};

describe("provider adapters", () => {
  it("maps MiniMax to OpenAI-compatible chat completions", () => {
    expect(endpointFor(baseRequest)).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(bodyFor(baseRequest)).toMatchObject({
      model: "MiniMax-M2.7",
      max_tokens: 8192,
      extra_body: { reasoning_split: true }
    });
  });

  it("maps OpenAI PDF input to responses", () => {
    const request = {
      ...baseRequest,
      provider: "openai" as const,
      baseURL: "https://api.openai.com/v1",
      request: {
        ...baseRequest.request,
        input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
      }
    };
    expect(endpointFor(request)).toBe("https://api.openai.com/v1/responses");
    expect(JSON.stringify(bodyFor(request))).toContain("input_file");
  });

  it("maps Anthropic PDF input to document blocks", () => {
    const request = {
      ...baseRequest,
      provider: "anthropic" as const,
      baseURL: "https://api.anthropic.com",
      request: {
        ...baseRequest.request,
        input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
      }
    };
    expect(endpointFor(request)).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.stringify(bodyFor(request))).toContain("application/pdf");
  });

  it("rejects MiniMax PDF base64 input", () => {
    const request = {
      ...baseRequest,
      request: {
        ...baseRequest.request,
        input: { type: "pdf_base64" as const, base64: "abc" }
      }
    };
    expect(() => bodyFor(request)).toThrow(/MiniMax/);
  });
});
