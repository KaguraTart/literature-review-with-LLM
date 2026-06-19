import { describe, expect, it } from "vitest";
import {
  bodyFor,
  defaultCapabilities,
  endpointFor,
  headersFor,
  modelsEndpointFor,
  parseStreamChunk,
  providerBodyExtra,
  redact,
  extractResponseText,
  type ModelRequest,
  type ProviderProfile
} from "../src/providerAdapters.js";

const profile: ProviderProfile = {
  id: "minimax",
  name: "MiniMax",
  protocol: "openai_chat",
  endpointMode: "base_url",
  baseURL: "https://api.minimaxi.com/v1",
  apiKey: "sk-test-secret",
  model: "MiniMax-M2.7",
  capabilities: { ...defaultCapabilities },
  isDefault: true
};

const baseRequest: ModelRequest = {
  profile,
  system: "system",
  messages: [{ role: "user", content: "prompt" }],
  input: { type: "text", text: "paper text" },
  temperature: 1,
  maxOutputTokens: 8192,
  stream: true
};

describe("provider adapters", () => {
  it("maps OpenAI-compatible chat profiles to chat completions", () => {
    expect(endpointFor(baseRequest)).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        id: "deepseek",
        name: "DeepSeek",
        baseURL: "https://api.deepseek.com"
      }
    })).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        id: "gemini",
        name: "Gemini OpenAI Compatible",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
      }
    })).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        id: "perplexity",
        name: "Perplexity Sonar",
        baseURL: "https://api.perplexity.ai",
        capabilities: { ...defaultCapabilities, modelList: false }
      }
    })).toBe("https://api.perplexity.ai/chat/completions");
    expect(bodyFor(baseRequest)).toMatchObject({
      model: "MiniMax-M2.7",
      max_tokens: 8192,
      stream: true
    });
  });

  it("normalizes pasted full provider endpoints in base URL mode", () => {
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        baseURL: "https://api.openai.com/v1/chat/completions"
      }
    })).toBe("https://api.openai.com/v1/chat/completions");
    expect(modelsEndpointFor({
      ...profile,
      baseURL: "https://api.openai.com/v1/chat/completions"
    })).toBe("https://api.openai.com/v1/models");

    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses",
        baseURL: "https://api.openai.com/v1/responses"
      }
    })).toBe("https://api.openai.com/v1/responses");
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses",
        baseURL: "https://api.openai.com/v1/chat/completions"
      }
    })).toBe("https://api.openai.com/v1/responses");
    expect(modelsEndpointFor({
      ...profile,
      protocol: "openai_responses",
      baseURL: "https://api.openai.com/v1/responses"
    })).toBe("https://api.openai.com/v1/models");

    const anthropicProfile: ProviderProfile = {
      ...profile,
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.anthropic.com/v1/messages"
    };
    expect(endpointFor({
      ...baseRequest,
      profile: anthropicProfile
    })).toBe("https://api.anthropic.com/v1/messages");
    expect(modelsEndpointFor(anthropicProfile)).toBe("https://api.anthropic.com/v1/models");
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        id: "zai-anthropic",
        name: "Z.AI Anthropic",
        protocol: "anthropic_messages",
        baseURL: "https://api.z.ai/api/anthropic",
        capabilities: { ...defaultCapabilities, modelList: false }
      }
    })).toBe("https://api.z.ai/api/anthropic/v1/messages");

    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        id: "perplexity",
        name: "Perplexity Sonar",
        baseURL: "https://api.perplexity.ai/chat/completions"
      }
    })).toBe("https://api.perplexity.ai/chat/completions");
  });

  it("applies custom headers, body extra, and model list capability", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        customHeaders: { "x-router": "paper-workbench" },
        bodyExtra: { response_format: { type: "json_object" } },
        capabilities: { ...defaultCapabilities, modelList: false }
      }
    };
    expect(headersFor(request.profile)).toMatchObject({ "x-router": "paper-workbench" });
    expect(bodyFor(request)).toMatchObject({ response_format: { type: "json_object" } });
    expect(modelsEndpointFor(request.profile)).toBeUndefined();
    expect(modelsEndpointFor({
      ...profile,
      id: "deepseek",
      baseURL: "https://api.deepseek.com"
    })).toBe("https://api.deepseek.com/v1/models");
    expect(modelsEndpointFor({
      ...profile,
      id: "gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
    })).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
    expect(modelsEndpointFor({
      ...profile,
      id: "perplexity",
      baseURL: "https://api.perplexity.ai",
      capabilities: { ...defaultCapabilities, modelList: false }
    })).toBeUndefined();
  });

  it("attaches image inputs for supported provider protocols", () => {
    const imageInput = {
      type: "text" as const,
      text: "paper text",
      images: [{ name: "screen.png", mimeType: "image/png", base64: "aW1hZ2U=" }]
    };
    const chatBody = bodyFor({ ...baseRequest, input: imageInput });
    expect((chatBody.messages as any[]).at(-1).content).toEqual([
      { type: "text", text: "prompt\n\npaper text" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }
    ]);

    const responsesBody = bodyFor({
      ...baseRequest,
      profile: { ...profile, protocol: "openai_responses" },
      input: imageInput
    });
    expect((responsesBody.input as any[])[0].content).toContainEqual({
      type: "input_image",
      image_url: "data:image/png;base64,aW1hZ2U="
    });

    const anthropicBody = bodyFor({
      ...baseRequest,
      profile: { ...profile, protocol: "anthropic_messages", baseURL: "https://api.anthropic.com" },
      input: imageInput
    });
    expect((anthropicBody.messages as any[])[0].content).toContainEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" }
    });

    expect(() => bodyFor({
      ...baseRequest,
      profile: { ...profile, capabilities: { ...defaultCapabilities, imageBase64: false } },
      input: imageInput
    })).toThrow("image input");
  });

  it("preserves custom auth headers and omits empty default auth headers", () => {
    expect(headersFor({
      ...profile,
      apiKey: "",
      customHeaders: { Authorization: "Bearer routed-secret" }
    })).toMatchObject({ Authorization: "Bearer routed-secret" });
    expect(headersFor({
      ...profile,
      apiKey: "",
      customHeaders: {}
    })).not.toHaveProperty("authorization");
    expect(headersFor({
      ...profile,
      apiKey: "sk-test-secret",
      customHeaders: { Authorization: "" }
    })).toMatchObject({ Authorization: "Bearer sk-test-secret" });
    expect(headersFor({
      ...profile,
      id: "azure-openai",
      protocol: "openai_responses",
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      customHeaders: { "api-key": "" }
    })).toMatchObject({ "api-key": "azure-secret" });
    expect(headersFor({
      ...profile,
      apiKey: "sk-test-secret",
      customHeaders: { "api-key": "azure-secret" }
    })).toMatchObject({ "api-key": "azure-secret" });
    expect(headersFor({
      ...profile,
      apiKey: "sk-test-secret",
      customHeaders: { "api-key": "azure-secret" }
    })).not.toHaveProperty("authorization");
    expect(headersFor({
      ...profile,
      id: "azure-openai",
      name: "Azure OpenAI",
      protocol: "openai_responses",
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      customHeaders: {}
    })).toMatchObject({ "api-key": "azure-secret" });
    expect(headersFor({
      ...profile,
      id: "azure-openai",
      protocol: "openai_responses",
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      customHeaders: {}
    })).not.toHaveProperty("authorization");
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: { "x-api-key": "" }
    })).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      apiKey: "",
      customHeaders: { "x-api-key": "anthropic-routed-secret" }
    })).toMatchObject({
      "x-api-key": "anthropic-routed-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      apiKey: "sk-test-secret",
      customHeaders: { Authorization: "Bearer routed-secret" }
    })).not.toHaveProperty("x-api-key");
    expect(headersFor({
      ...profile,
      id: "anthropic-compatible",
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example",
      apiKey: "anthropic-compatible-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer anthropic-compatible-secret", "anthropic-version": "2023-06-01" });
    expect(headersFor({
      ...profile,
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer deepseek-secret", "anthropic-version": "2023-06-01" });
    expect(headersFor({
      ...profile,
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(headersFor({
      ...profile,
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer zai-secret", "anthropic-version": "2023-06-01" });
    expect(headersFor({
      ...profile,
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization" }
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization", directBrowserAccess: true }
    })).toMatchObject({
      authorization: "Bearer routed-secret",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: {},
      bodyExtra: { directBrowserAccess: false }
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
  });

  it("does not leak local-agent config into provider request bodies", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        bodyExtra: {
          response_format: { type: "json_object" },
          localAgent: { endpoint: "http://127.0.0.1:3333/mcp" },
          agent: { endpoint: "http://127.0.0.1:3334/mcp" },
          subagent: { endpoint: "http://127.0.0.1:3335/mcp" },
          authHeader: "authorization",
          directBrowserAccess: true,
          anthropicDirectBrowserAccess: false
        }
      }
    };
    const body = bodyFor(request);
    expect(body).toMatchObject({ response_format: { type: "json_object" } });
    expect(body).not.toHaveProperty("localAgent");
    expect(body).not.toHaveProperty("agent");
    expect(body).not.toHaveProperty("subagent");
    expect(body).not.toHaveProperty("directBrowserAccess");
    expect(body).not.toHaveProperty("anthropicDirectBrowserAccess");
    expect(providerBodyExtra(request.profile.bodyExtra)).toEqual({ response_format: { type: "json_object" } });
  });

  it("maps jsonMode capability to protocol-specific OpenAI request bodies", () => {
    expect(bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        capabilities: { ...defaultCapabilities, jsonMode: true }
      }
    })).toMatchObject({
      response_format: { type: "json_object" }
    });

    expect(bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses" as const,
        baseURL: "https://api.openai.com/v1",
        capabilities: { ...defaultCapabilities, jsonMode: true }
      }
    })).toMatchObject({
      text: { format: { type: "json_object" } }
    });

    expect(bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses" as const,
        baseURL: "https://api.openai.com/v1",
        capabilities: { ...defaultCapabilities, jsonMode: true },
        bodyExtra: { text: { format: { type: "json_schema", name: "paper" } } }
      }
    })).toMatchObject({
      text: { format: { type: "json_schema", name: "paper" } }
    });
  });

  it("uses full URL mode without path appending", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        endpointMode: "full_url" as const,
        fullURL: "https://example.test/custom/messages"
      }
    };
    expect(endpointFor(request)).toBe("https://example.test/custom/messages");
    expect(modelsEndpointFor(request.profile)).toBeUndefined();
  });

  it("maps Responses PDF input when the profile declares support", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses" as const,
        baseURL: "https://api.openai.com/v1",
        capabilities: { ...defaultCapabilities, pdfBase64: true }
      },
      input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
    };
    expect(endpointFor(request)).toBe("https://api.openai.com/v1/responses");
    expect(JSON.stringify(bodyFor(request))).toContain("input_file");
  });

  it("maps Anthropic PDF input and auth headers", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "anthropic_messages" as const,
        baseURL: "https://api.anthropic.com",
        capabilities: { ...defaultCapabilities, pdfBase64: true }
      },
      input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
    };
    expect(endpointFor(request)).toBe("https://api.anthropic.com/v1/messages");
    expect(headersFor(request.profile)).toMatchObject({
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    const body = bodyFor(request);
    expect(JSON.stringify(body)).toContain("application/pdf");
    expect(body).not.toHaveProperty("temperature");
    expect(bodyFor({
      ...request,
      profile: {
        ...request.profile,
        bodyExtra: { temperature: 0.2 }
      }
    })).toMatchObject({ temperature: 0.2 });
  });

  it("does not duplicate Anthropic v1 in base URLs", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "anthropic_messages" as const,
        baseURL: "https://api.anthropic.com/v1"
      }
    };
    expect(endpointFor(request)).toBe("https://api.anthropic.com/v1/messages");
    expect(modelsEndpointFor(request.profile)).toBe("https://api.anthropic.com/v1/models");
    expect(modelsEndpointFor({ ...request.profile, baseURL: "https://api.anthropic.com" })).toBe("https://api.anthropic.com/v1/models");
    expect(endpointFor({
      ...request,
      profile: {
        ...request.profile,
        baseURL: "https://api.z.ai/api/anthropic/v1"
      }
    })).toBe("https://api.z.ai/api/anthropic/v1/messages");
  });

  it("uses Responses instructions instead of merging system text into input", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses" as const,
        baseURL: "https://api.openai.com/v1"
      },
      messages: [
        { role: "user" as const, content: "first question" },
        { role: "assistant" as const, content: "first answer" },
        { role: "user" as const, content: "second question" }
      ],
      input: { type: "text" as const, text: "paper text" }
    };
    const body = bodyFor(request);
    const input = body.input as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;

    expect(body).toMatchObject({ instructions: "system" });
    expect(input.map((item) => item.role)).toEqual(["user", "assistant", "user"]);
    expect(input[0].content[0]).toMatchObject({ type: "input_text", text: "first question" });
    expect(input[1].content[0]).toMatchObject({ type: "output_text", text: "first answer" });
    expect(input[2].content).toEqual([
      { type: "input_text", text: "second question" },
      { type: "input_text", text: "CONTEXT:\npaper text" }
    ]);
    expect(JSON.stringify(body.input)).not.toContain("system\\n\\n");
    expect(JSON.stringify(body.input)).not.toContain("USER:");
  });

  it("keeps Anthropic message history roles while attaching PDF context", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "anthropic_messages" as const,
        baseURL: "https://api.anthropic.com",
        capabilities: { ...defaultCapabilities, pdfBase64: true }
      },
      messages: [
        { role: "user" as const, content: "first question" },
        { role: "assistant" as const, content: "first answer" },
        { role: "user" as const, content: "second question" }
      ],
      input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
    };
    const messages = bodyFor(request).messages as Array<{ role: string; content: unknown }>;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(messages[2].content)).toContain("application/pdf");
    expect(JSON.stringify(messages[2].content)).toContain("second question");
  });

  it("merges consecutive Anthropic history roles before sending", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "anthropic_messages" as const,
        baseURL: "https://api.anthropic.com",
        capabilities: { ...defaultCapabilities, pdfBase64: true }
      },
      messages: [
        { role: "user" as const, content: "first question" },
        { role: "user" as const, content: "follow-up question" },
        { role: "assistant" as const, content: "first answer" },
        { role: "assistant" as const, content: "second answer" },
        { role: "user" as const, content: "final question" }
      ],
      input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
    };
    const messages = bodyFor(request).messages as Array<{ role: string; content: any }>;

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0].content).toEqual([{ type: "text", text: "first question\n\nfollow-up question" }]);
    expect(messages[1].content).toEqual([{ type: "text", text: "first answer\n\nsecond answer" }]);
    expect(messages[2].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "document" }),
      expect.objectContaining({ type: "text", text: "final question" })
    ]));
  });

  it("rejects undeclared PDF base64 support", () => {
    const request = {
      ...baseRequest,
      input: { type: "pdf_base64" as const, base64: "abc" }
    };
    expect(() => bodyFor(request)).toThrow(/PDF base64/);
  });

  it("parses stream deltas and redacts secrets", () => {
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}")).toBe("hi");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hidden\"}}]}")).toBe("");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hidden\",\"content\":\"visible\"}}]}")).toBe("visible");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"reasoning\",\"text\":\"hidden\"},{\"type\":\"text\",\"text\":\"array text\"}]}}]}")).toBe("array text");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"message\":{\"content\":[{\"type\":\"output_text\",\"text\":\"message text\"}]}}]}")).toBe("message text");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{\"text\":\"oops\"}}]}")).toBe("oops");
    expect(parseStreamChunk("openai_responses", "data: {\"output\":[{\"content\":[{\"text\":\"ok\"}]}]}")).toBe("ok");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"streamed\"}")).toBe("streamed");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"output_text\",\"text\":\"snapshot part\"}}")).toBe("snapshot part");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.output_item.done\",\"item\":{\"content\":[{\"type\":\"output_text\",\"text\":\"snapshot item\"}]}}")).toBe("snapshot item");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"content\":[{\"type\":\"output_text\",\"text\":\"snapshot response\"}]}]}}")).toBe("snapshot response");
    expect(parseStreamChunk("anthropic_messages", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"claude\"}}")).toBe("claude");
    expect(parseStreamChunk("anthropic_messages", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"ok\\\"\"}}")).toBe("{\"ok\"");
    expect(parseStreamChunk("openai_chat", "data: not-json")).toBe("");
    expect(redact("Authorization: Bearer sk-test-secret")).toContain("[redacted]");
  });

  it("throws redacted provider errors from stream error events", () => {
    expect(() => parseStreamChunk("openai_responses", "data: {\"type\":\"error\",\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"Too many requests for sk-test-secret\"}}")).toThrow("rate_limit_exceeded - Too many requests for [redacted]");
    expect(() => parseStreamChunk("anthropic_messages", "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Bearer routed-secret overloaded\"}}")).toThrow("overloaded_error - Bearer [redacted] overloaded");
  });

  it("throws redacted provider errors from non-stream response bodies", () => {
    expect(() => extractResponseText("openai_responses", {
      error: {
        code: "rate_limit_exceeded",
        message: "Too many requests for sk-test-secret"
      }
    })).toThrow("rate_limit_exceeded - Too many requests for [redacted]");
    expect(() => extractResponseText("anthropic_messages", {
      type: "error",
      error: {
        type: "overloaded_error",
        message: "Bearer routed-secret overloaded"
      }
    })).toThrow("overloaded_error - Bearer [redacted] overloaded");
  });

  it("extracts assistant text from nested message and output formats", () => {
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: [{ type: "text", text: "part a" }, { type: "text", text: "part b" }] } }]
    } as any)).toBe("part a\npart b");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: [{ type: "reasoning", text: "hidden" }, { type: "output_text", text: "final" }] } }]
    } as any)).toBe("final");
    expect(extractResponseText("openai_chat", {
      choices: [{ text: "legacy completion text" }]
    } as any)).toBe("legacy completion text");
    expect(extractResponseText("openai_chat", {
      choices: [{ delta: { content: [{ type: "text", text: "delta content" }] } }]
    } as any)).toBe("delta content");
    expect(extractResponseText("openai_chat", {
      content: [{ type: "text", text: "top-level content" }]
    } as any)).toBe("top-level content");
    expect(extractResponseText("openai_chat", {
      output: [{ content: [{ text: "x" }, { content: "y" }] }]
    } as any)).toBe("x\ny");
    expect(extractResponseText("openai_responses", {
      response: { output_text: "wrapped response text" }
    } as any)).toBe("wrapped response text");
    expect(extractResponseText("anthropic_messages", {
      content: "compatible anthropic text"
    } as any)).toBe("compatible anthropic text");
  });
});
