import { describe, expect, it } from "vitest";
import {
  bodyFor,
  defaultCapabilities,
  endpointFor,
  extractProviderUsage,
  headersFor,
  modelsEndpointFor,
  omitProviderRequestBodyFields,
  parseStreamChunk,
  parseStreamUsage,
  providerCompatibilityFallbackFields,
  providerRequestHeadersWithFallback,
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
  it("keeps image input disabled until a profile explicitly enables it", () => {
    expect(defaultCapabilities.imageBase64).toBe(false);
  });

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
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        id: "github-models",
        name: "GitHub Models",
        baseURL: "https://models.github.ai/inference",
        capabilities: { ...defaultCapabilities, modelList: false }
      }
    })).toBe("https://models.github.ai/inference/chat/completions");
    expect(bodyFor(baseRequest)).toMatchObject({
      model: "MiniMax-M2.7",
      max_tokens: 8192,
      stream: true,
      stream_options: { include_usage: true }
    });
    const systemInUserBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        bodyExtra: { systemFallbackToUser: true }
      }
    });
    expect((systemInUserBody.messages as any[]).some((message) => message.role === "system")).toBe(false);
    expect((systemInUserBody.messages as any[])[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("SYSTEM:\nsystem")
    });
  });

  it("requests OpenAI-compatible Chat stream usage while respecting body-extra overrides", () => {
    const nonStreamBody = bodyFor({ ...baseRequest, stream: false });
    expect(nonStreamBody).toMatchObject({ stream: false });
    expect(nonStreamBody).not.toHaveProperty("stream_options");

    const overrideBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        bodyExtra: { stream_options: { include_usage: false, marker: "router" } }
      }
    });
    expect(overrideBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: false, marker: "router" }
    });

    const omittedBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        bodyExtra: { omitFields: ["stream_options"] }
      }
    });
    expect(omittedBody).toMatchObject({ stream: true });
    expect(omittedBody).not.toHaveProperty("stream_options");

    const noStreamBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        bodyExtra: { omitFields: ["stream"] }
      }
    });
    expect(noStreamBody).not.toHaveProperty("stream");
    expect(noStreamBody).not.toHaveProperty("stream_options");
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
        baseURL: "https://api.openai.com/v1/models"
      }
    })).toBe("https://api.openai.com/v1/chat/completions");
    expect(modelsEndpointFor({
      ...profile,
      baseURL: "https://api.openai.com/v1/models"
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
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses",
        baseURL: "https://api.openai.com/v1/models"
      }
    })).toBe("https://api.openai.com/v1/responses");

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
        ...anthropicProfile,
        baseURL: "https://api.anthropic.com/v1/models"
      }
    })).toBe("https://api.anthropic.com/v1/messages");
    expect(modelsEndpointFor({
      ...anthropicProfile,
      baseURL: "https://api.anthropic.com/v1/models"
    })).toBe("https://api.anthropic.com/v1/models");
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

    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        baseURL: "https://router.example/v1/chat/completions?api-version=2026-01-01"
      }
    })).toBe("https://router.example/v1/chat/completions?api-version=2026-01-01");
    expect(modelsEndpointFor({
      ...profile,
      baseURL: "https://router.example/v1/chat/completions?api-version=2026-01-01"
    })).toBe("https://router.example/v1/models?api-version=2026-01-01");
    const azureWithQuery = {
      ...profile,
      id: "azure-openai",
      name: "Azure OpenAI",
      protocol: "openai_responses" as const,
      baseURL: "https://example-resource.openai.azure.com/openai/v1?api-version=preview",
      apiKey: "azure-secret"
    };
    expect(endpointFor({ ...baseRequest, profile: azureWithQuery }))
      .toBe("https://example-resource.openai.azure.com/openai/v1/responses?api-version=preview");
    expect(modelsEndpointFor(azureWithQuery))
      .toBe("https://example-resource.openai.azure.com/openai/v1/models?api-version=preview");
    expect(headersFor(azureWithQuery)).toMatchObject({ "api-key": "azure-secret" });
    expect(headersFor(azureWithQuery)).not.toHaveProperty("authorization");
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...anthropicProfile,
        baseURL: "https://api.anthropic.com/v1/messages?beta=true"
      }
    })).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(modelsEndpointFor({
      ...anthropicProfile,
      baseURL: "https://api.anthropic.com/v1/messages?beta=true"
    })).toBe("https://api.anthropic.com/v1/models?beta=true");
    expect(headersFor({
      ...anthropicProfile,
      baseURL: "https://api.anthropic.com?beta=true",
      apiKey: "anthropic-secret"
    })).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(endpointFor({
      ...baseRequest,
      profile: {
        ...profile,
        id: "perplexity",
        name: "Perplexity Sonar",
        baseURL: "https://api.perplexity.ai?proxy=1"
      }
    })).toBe("https://api.perplexity.ai/chat/completions?proxy=1");
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
    expect(modelsEndpointFor({
      ...profile,
      id: "github-models",
      baseURL: "https://models.github.ai/inference",
      capabilities: { ...defaultCapabilities, modelList: false }
    })).toBeUndefined();
  });

  it("supports max_completion_tokens for OpenAI-compatible Chat reasoning models and overrides", () => {
    const reasoningBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        model: "o1-preview"
      }
    });
    expect(reasoningBody).toMatchObject({ max_completion_tokens: 8192 });
    expect(reasoningBody).not.toHaveProperty("max_tokens");
    expect(reasoningBody).not.toHaveProperty("temperature");
    expect(reasoningBody).not.toHaveProperty("n");

    const explicitCompletionBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        model: "router-model",
        bodyExtra: {
          tokenLimitField: "max_completion_tokens",
          max_completion_tokens: 2048
        }
      }
    });
    expect(explicitCompletionBody).toMatchObject({ max_completion_tokens: 2048 });
    expect(explicitCompletionBody).not.toHaveProperty("max_tokens");
    expect(explicitCompletionBody).not.toHaveProperty("temperature");
    expect(explicitCompletionBody).not.toHaveProperty("n");
    expect(explicitCompletionBody).not.toHaveProperty("tokenLimitField");

    const explicitSamplingBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        model: "o3-mini",
        bodyExtra: {
          temperature: 0.2,
          n: 2
        }
      }
    });
    expect(explicitSamplingBody).toMatchObject({
      max_completion_tokens: 8192,
      temperature: 0.2,
      n: 2
    });

    const explicitLegacyBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        model: "o3-mini",
        bodyExtra: { tokenLimitField: "max_tokens" }
      }
    });
    expect(explicitLegacyBody).toMatchObject({ max_tokens: 8192 });
    expect(explicitLegacyBody).not.toHaveProperty("max_completion_tokens");
  });

  it("detects unsupported OpenAI Chat optional fields for compatibility fallback", () => {
    const body = {
      model: "router-model",
      messages: [],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.4,
      n: 1,
      response_format: { type: "json_object" },
      max_completion_tokens: 1024
    };
    const fields = providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      400,
      JSON.stringify({ error: { message: "stream_options, temperature, n, response_format, and max_completion_tokens are unsupported" } })
    );
    expect(fields).toEqual(["stream_options", "temperature", "n", "response_format", "max_completion_tokens"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      400,
      "Unsupported parameters: streamOptions, responseFormat, maxCompletionTokens"
    )).toEqual(["stream_options", "response_format", "max_completion_tokens"]);
    const detailedFields = providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      200,
      JSON.stringify({
        error: {
          code: "invalid_request",
          message: "Invalid request body",
          details: [
            { loc: ["body", "stream_options"], msg: "Extra inputs are not permitted" }
          ]
        }
      })
    );
    expect(detailedFields).toEqual(["stream_options"]);
    expect(() => extractResponseText("openai_chat", {
      error: {
        code: "invalid_request",
        message: "Invalid request body",
        details: [
          { loc: ["body", "stream_options"], msg: "Extra inputs are not permitted" }
        ]
      }
    })).toThrow(/body\.stream_options: Extra inputs are not permitted/);
    expect(omitProviderRequestBodyFields(body, fields)).toEqual({
      model: "router-model",
      messages: [],
      stream: true,
      max_tokens: 1024
    });
    const legacyTokenBody = {
      model: "router-model",
      messages: [],
      max_tokens: 1024
    };
    expect(providerCompatibilityFallbackFields("openai_chat", legacyTokenBody, 400, "Unknown field: max_tokens")).toEqual(["max_tokens"]);
    expect(providerCompatibilityFallbackFields("openai_chat", legacyTokenBody, 400, "Unknown field: maxTokens")).toEqual(["max_tokens"]);
    expect(omitProviderRequestBodyFields(legacyTokenBody, ["max_tokens"])).toEqual({
      model: "router-model",
      messages: [],
      max_completion_tokens: 1024
    });
    expect(omitProviderRequestBodyFields(legacyTokenBody, ["max_tokens"], ["max_completion_tokens"])).toEqual({
      model: "router-model",
      messages: []
    });
    expect(omitProviderRequestBodyFields(body, ["max_completion_tokens"], ["max_tokens"])).toEqual({
      model: "router-model",
      messages: [],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.4,
      n: 1,
      response_format: { type: "json_object" }
    });
    const strictOptionalBody = {
      model: "router-model",
      messages: [],
      top_p: 0.9,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
      seed: 42,
      top_logprobs: 3,
      logprobs: true,
      parallel_tool_calls: false,
      reasoning_effort: "low",
      stop: ["END"]
    };
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      strictOptionalBody,
      400,
      "Unsupported parameters: top_p, presence_penalty, frequency_penalty, seed, top_logprobs, logprobs, parallel_tool_calls, reasoning_effort, stop"
    )).toEqual([
      "top_p",
      "presence_penalty",
      "frequency_penalty",
      "seed",
      "top_logprobs",
      "logprobs",
      "parallel_tool_calls",
      "reasoning_effort",
      "stop"
    ]);
    const routerOptionalBody = {
      model: "router-model",
      messages: [],
      modalities: ["text"],
      response_modalities: ["text"],
      audio: { voice: "alloy" },
      prediction: { type: "content", content: "" },
      service_tier: "auto",
      store: false,
      user: "end-user",
      logit_bias: { "42": 1 },
      web_search_options: { search_context_size: "low" },
      search_options: { source: "web" },
      safety_settings: [{ category: "harm", threshold: "block_none" }],
      generation_config: { temperature: 0.1 },
      thinking_config: { budget_tokens: 256 },
      response_mime_type: "application/json",
      response_schema: { type: "object" },
      extra_body: { reasoning_split: true }
    };
    const routerOptionalFields = [
      "modalities",
      "response_modalities",
      "audio",
      "prediction",
      "service_tier",
      "store",
      "user",
      "logit_bias",
      "web_search_options",
      "search_options",
      "safety_settings",
      "generation_config",
      "thinking_config",
      "response_mime_type",
      "response_schema",
      "extra_body"
    ];
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      routerOptionalBody,
      400,
      "Unsupported parameters: modalities, response_modalities, audio, prediction, service_tier, store, user, logit_bias, web_search_options, search_options, safety_settings, generation_config, thinking_config, response_mime_type, response_schema, extra_body"
    )).toEqual(routerOptionalFields);
    const strippedRouterOptionalBody = omitProviderRequestBodyFields(routerOptionalBody, routerOptionalFields);
    for (const field of routerOptionalFields) {
      expect(strippedRouterOptionalBody).not.toHaveProperty(field);
    }
    expect(strippedRouterOptionalBody).toEqual({
      model: "router-model",
      messages: []
    });
    expect(providerCompatibilityFallbackFields("openai_chat", body, 422, "stream is not supported"))
      .toEqual(["stream", "stream_options"]);
    const customBody = {
      model: "router-model",
      messages: [],
      router_extra: { trace: true }
    };
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      customBody,
      422,
      JSON.stringify({
        detail: [
          { type: "extra_forbidden", loc: ["body", "router_extra"], msg: "Extra inputs are not permitted" }
        ]
      })
    )).toEqual(["router_extra"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      customBody,
      400,
      JSON.stringify({
        error: {
          message: "Unsupported fields in request body",
          unsupported_fields: ["router_extra"]
        }
      })
    )).toEqual(["router_extra"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      customBody,
      400,
      "Unsupported parameter: router_extra"
    )).toEqual(["router_extra"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      customBody,
      200,
      JSON.stringify({ error: { message: "Unsupported parameter: router_extra" } })
    )).toEqual(["router_extra"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      {
        model: "router-model",
        messages: [],
        "route-hint": true
      },
      400,
      "Unknown argument route hint"
    )).toEqual(["route-hint"]);
    expect(omitProviderRequestBodyFields(customBody, ["router_extra"])).toEqual({
      model: "router-model",
      messages: []
    });
    const systemRoleBody = {
      model: "router-model",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "ping" }
      ]
    };
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      systemRoleBody,
      422,
      JSON.stringify({
        detail: [
          { type: "literal_error", loc: ["body", "messages", 0, "role"], msg: "Input should be 'user' or 'assistant'" }
        ]
      })
    )).toEqual(["messages.role.system"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      systemRoleBody,
      400,
      "Unsupported role: system"
    )).toEqual(["messages.role.system"]);
    expect(omitProviderRequestBodyFields(systemRoleBody, ["messages.role.system"])).toEqual({
      model: "router-model",
      messages: [{ role: "user", content: "SYSTEM:\nsystem\n\nping" }]
    });
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      customBody,
      422,
      JSON.stringify({
        detail: [
          { type: "extra_forbidden", loc: ["body", "model"], msg: "Extra inputs are not permitted" }
        ]
      })
    )).toEqual([]);
    const imageBody = {
      model: "router-model",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
          ]
        }
      ]
    };
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      imageBody,
      400,
      JSON.stringify({
        error: {
          code: "unsupported_parameter",
          message: "Unsupported request parameter",
          param: "messages[0].content[1].image_url.url"
        }
      })
    )).toEqual(["image_url.url"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      imageBody,
      422,
      JSON.stringify({
        detail: [
          { type: "string_type", loc: ["body", "messages", 0, "content", 1, "image_url"], msg: "Input should be a valid string" }
        ]
      })
    )).toEqual(["image_url.url"]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      imageBody,
      400,
      "image_url must be a string"
    )).toEqual(["image_url.url"]);
    const stringImageBody = omitProviderRequestBodyFields(imageBody, ["image_url.url"]);
    expect(((stringImageBody.messages as any[])[0].content as any[])[1]).toEqual({
      type: "image_url",
      image_url: "data:image/png;base64,abc"
    });
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      stringImageBody,
      400,
      "image input is not supported by this model"
    )).toEqual(["messages.content.image_url"]);
    const textOnlyChatImageBody = omitProviderRequestBodyFields(stringImageBody, ["messages.content.image_url"]);
    expect(((textOnlyChatImageBody.messages as any[])[0].content as any[])).toEqual([
      { type: "text", text: "Describe this image." }
    ]);
    const responsesBody = {
      model: "responses-model",
      input: [],
      text: { format: { type: "json_object" } },
      max_output_tokens: 1024,
      temperature: 0.2,
      stream: false
    };
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      responsesBody,
      400,
      "Unsupported parameters: text.format, max_output_tokens, temperature, stream"
    )).toEqual(["stream", "temperature", "text", "max_output_tokens"]);
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      responsesBody,
      400,
      JSON.stringify({
        error: {
          code: "unsupported_parameter",
          message: "Unsupported request parameter",
          param: "body.text.format"
        },
        details: {
          parameters: ["max_output_tokens", "request.temperature", "stream"]
        }
      })
    )).toEqual(["text", "max_output_tokens", "temperature", "stream"]);
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      responsesBody,
      200,
      JSON.stringify({
        error: {
          code: "unsupported_parameter",
          message: "Unsupported request parameter",
          param: "max_output_tokens"
        }
      })
    )).toEqual(["max_output_tokens"]);
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      responsesBody,
      422,
      JSON.stringify({
        detail: [
          { type: "extra_forbidden", loc: ["body", "text", "format"], msg: "Extra inputs are not permitted" },
          { type: "extra_forbidden", loc: ["body", "max_output_tokens"], msg: "Extra inputs are not permitted" },
          { type: "extra_forbidden", loc: ["body", "temperature"], msg: "Extra inputs are not permitted" },
          { type: "extra_forbidden", loc: ["body", "stream"], msg: "Extra inputs are not permitted" }
        ]
      })
    )).toEqual(["text", "max_output_tokens", "temperature", "stream"]);
    const responsesPDFBody = {
      model: "responses-model",
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", filename: "paper.pdf", file_data: "data:application/pdf;base64,abc" },
            { type: "input_text", text: "ping" }
          ]
        }
      ]
    };
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      responsesPDFBody,
      400,
      JSON.stringify({
        error: {
          code: "unsupported_parameter",
          message: "Unsupported request parameter",
          param: "input[0].content[0].file_data"
        }
      })
    )).toEqual(["input_file.file_data"]);
    const fileURLRetryBody = omitProviderRequestBodyFields(responsesPDFBody, ["input_file.file_data"]);
    expect((fileURLRetryBody.input as any[])[0].content[0]).toEqual({
      type: "input_file",
      filename: "paper.pdf",
      file_url: "data:application/pdf;base64,abc"
    });
    expect((responsesPDFBody.input as any[])[0].content[0]).toHaveProperty("file_data");
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      fileURLRetryBody,
      400,
      "Unsupported parameter: file_url"
    )).toEqual(["input_file.file_url"]);
    const fileDataRetryBody = omitProviderRequestBodyFields(fileURLRetryBody, ["input_file.file_url"]);
    expect((fileDataRetryBody.input as any[])[0].content[0]).toEqual({
      type: "input_file",
      filename: "paper.pdf",
      file_data: "data:application/pdf;base64,abc"
    });
    const textOnlyPDFRetryBody = omitProviderRequestBodyFields(fileURLRetryBody, ["input_file.file_url"], ["input_file.file_data"]);
    expect((textOnlyPDFRetryBody.input as any[])[0].content).toEqual([
      { type: "input_text", text: "ping" }
    ]);
    const responsesImageBody = {
      model: "responses-model",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Describe this image." },
            { type: "input_image", image_url: "data:image/png;base64,abc" }
          ]
        }
      ]
    };
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      responsesImageBody,
      400,
      JSON.stringify({
        error: {
          code: "unsupported_parameter",
          message: "input_image is not supported by this model",
          param: "input[0].content[1].input_image"
        }
      })
    )).toEqual(["input.content.input_image"]);
    expect((omitProviderRequestBodyFields(responsesImageBody, ["input.content.input_image"]).input as any[])[0].content).toEqual([
      { type: "input_text", text: "Describe this image." }
    ]);
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      {
        model: "responses-model",
        input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
        instructions: "system",
        text: { verbosity: "low" },
        reasoning: { effort: "low" },
        verbosity: "low"
      },
      422,
      "Unsupported parameters: instructions, reasoning, text.verbosity, verbosity"
    )).toEqual(["text", "instructions", "reasoning", "verbosity"]);
    const responsesRetryBody = omitProviderRequestBodyFields({
      model: "responses-model",
      input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
      instructions: "system",
      text: { verbosity: "low" },
      reasoning: { effort: "low" },
      verbosity: "low"
    }, ["text", "instructions", "reasoning", "verbosity"]);
    expect(responsesRetryBody).not.toHaveProperty("instructions");
    expect((responsesRetryBody.input as any[])[0].content).toEqual([
      { type: "input_text", text: "SYSTEM:\nsystem" },
      { type: "input_text", text: "ping" }
    ]);
    expect(providerCompatibilityFallbackFields(
      "openai_responses",
      responsesBody,
      400,
      "Unsupported parameter: max_output_tokens",
      ["max_output_tokens"]
    )).toEqual([]);
    const anthropicBody = {
      model: "claude-compatible",
      system: "system",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1024,
      stream: false,
      metadata: { source: "zotero" },
      thinking: { type: "enabled", budget_tokens: 1024 },
      top_p: 0.9,
      stop_sequences: ["END"]
    };
    expect(providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicBody,
      400,
      "Unsupported parameters: stream, system prompt, metadata, thinking, top_p, stop_sequences"
    )).toEqual(["stream", "system", "metadata", "thinking", "top_p", "stop_sequences"]);
    expect(providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicBody,
      400,
      "Unsupported header: anthropic-version"
    )).toEqual(["headers.anthropic-version"]);
    expect(providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicBody,
      200,
      JSON.stringify({ error: { message: "Unsupported header: anthropic-version" } })
    )).toEqual(["headers.anthropic-version"]);
    expect(omitProviderRequestBodyFields(anthropicBody, ["headers.anthropic-version"])).toEqual(anthropicBody);
    const anthropicHeaders = {
      "content-type": "application/json",
      Authorization: "Bearer anthropic-compatible-secret",
      "Anthropic-Version": "2023-06-01"
    };
    const anthropicHeaderRetry = providerRequestHeadersWithFallback(anthropicHeaders, ["headers.anthropic-version"]);
    expect(anthropicHeaderRetry).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer anthropic-compatible-secret"
    });
    expect(anthropicHeaders).toHaveProperty("Anthropic-Version", "2023-06-01");
    expect(providerRequestHeadersWithFallback(anthropicHeaders, ["stream"])).toBe(anthropicHeaders);
    expect(providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicBody,
      422,
      JSON.stringify({
        detail: [
          { type: "list_type", loc: ["body", "messages", 0, "content"], msg: "Input should be a valid list" }
        ]
      })
    )).toEqual(["messages.content"]);
    expect(omitProviderRequestBodyFields(anthropicBody, ["messages.content"])).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }]
    });
    const anthropicDocumentBody = {
      model: "claude-compatible",
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: "abc" } },
            { type: "text", text: "ping" }
          ]
        }
      ]
    };
    expect(providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicDocumentBody,
      422,
      JSON.stringify({
        detail: [
          { type: "unsupported_media_type", loc: ["body", "messages", 0, "content", 0, "source", "media_type"], msg: "Unsupported media_type application/pdf" }
        ]
      })
    )).toEqual(["messages.content.document"]);
    expect((omitProviderRequestBodyFields(anthropicDocumentBody, ["messages.content.document"]).messages as any[])[0].content).toEqual([
      { type: "text", text: "ping" }
    ]);
    const anthropicImageBody = {
      model: "claude-compatible",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
            { type: "text", text: "ping" }
          ]
        }
      ]
    };
    expect(providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicImageBody,
      422,
      JSON.stringify({
        detail: [
          { type: "unsupported_media_type", loc: ["body", "messages", 0, "content", 0, "source", "media_type"], msg: "Unsupported media_type image/png" }
        ]
      })
    )).toEqual(["messages.content.image"]);
    expect((omitProviderRequestBodyFields(anthropicImageBody, ["messages.content.image"]).messages as any[])[0].content).toEqual([
      { type: "text", text: "ping" }
    ]);
    expect(providerCompatibilityFallbackFields(
      "openai_chat",
      { model: "openai-compatible", messages: [{ role: "user", content: "ping" }] },
      422,
      JSON.stringify({
        detail: [
          { type: "list_type", loc: ["body", "messages", 0, "content"], msg: "Input should be a valid list" }
        ]
      })
    )).toEqual([]);
    const anthropicRetryBody = omitProviderRequestBodyFields(anthropicBody, ["stream", "system", "metadata", "thinking", "top_p", "stop_sequences"]);
    expect(anthropicRetryBody).not.toHaveProperty("system");
    expect((anthropicRetryBody.messages as any[])[0].content).toBe("SYSTEM:\nsystem\n\nping");
    expect(providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicBody,
      400,
      "Unsupported parameter: metadata",
      ["metadata"]
    )).toEqual([]);
    expect(providerCompatibilityFallbackFields("openai_chat", body, 401, "stream_options")).toEqual([]);
    expect(providerCompatibilityFallbackFields("openai_chat", body, 400, "stream_options", true)).toEqual([]);
  });

  it("attaches image inputs for supported provider protocols", () => {
    const imageInput = {
      type: "text" as const,
      text: "paper text",
      images: [{ name: "screen.png", mimeType: "image/png", base64: "aW1hZ2U=" }]
    };
    const imageProfile = { ...profile, capabilities: { ...defaultCapabilities, imageBase64: true } };
    const chatBody = bodyFor({ ...baseRequest, profile: imageProfile, input: imageInput });
    expect((chatBody.messages as any[]).at(-1).content).toEqual([
      { type: "text", text: "prompt\n\npaper text" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }
    ]);
    const stringImageChatBody = bodyFor({
      ...baseRequest,
      profile: { ...imageProfile, bodyExtra: { imageURLFormat: "string" } },
      input: imageInput
    });
    expect((stringImageChatBody.messages as any[]).at(-1).content).toEqual([
      { type: "text", text: "prompt\n\npaper text" },
      { type: "image_url", image_url: "data:image/png;base64,aW1hZ2U=" }
    ]);
    const textOnlyChatBody = bodyFor({
      ...baseRequest,
      profile: { ...imageProfile, bodyExtra: { omitOpenAIChatImage: true } },
      input: imageInput
    });
    expect((textOnlyChatBody.messages as any[]).at(-1).content).toBe("prompt\n\npaper text");
    expect(textOnlyChatBody).not.toHaveProperty("omitOpenAIChatImage");

    const responsesBody = bodyFor({
      ...baseRequest,
      profile: { ...imageProfile, protocol: "openai_responses" },
      input: imageInput
    });
    expect((responsesBody.input as any[])[0].content).toContainEqual({
      type: "input_image",
      image_url: "data:image/png;base64,aW1hZ2U="
    });
    const textOnlyResponsesBody = bodyFor({
      ...baseRequest,
      profile: { ...imageProfile, protocol: "openai_responses", bodyExtra: { omitOpenAIResponsesImage: true } },
      input: imageInput
    });
    expect(JSON.stringify(textOnlyResponsesBody.input)).not.toContain("input_image");
    expect((textOnlyResponsesBody.input as any[])[0].content).toContainEqual({
      type: "input_text",
      text: "prompt"
    });
    expect(textOnlyResponsesBody).not.toHaveProperty("omitOpenAIResponsesImage");

    const anthropicBody = bodyFor({
      ...baseRequest,
      profile: { ...imageProfile, protocol: "anthropic_messages", baseURL: "https://api.anthropic.com" },
      input: imageInput
    });
    expect((anthropicBody.messages as any[])[0].content).toContainEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" }
    });
    const anthropicTextOnlyImageBody = bodyFor({
      ...baseRequest,
      profile: {
        ...imageProfile,
        protocol: "anthropic_messages",
        baseURL: "https://api.anthropic.com",
        bodyExtra: { omitAnthropicImage: true }
      },
      input: imageInput
    });
    expect(JSON.stringify(anthropicTextOnlyImageBody.messages)).not.toContain("\"image\"");
    expect((anthropicTextOnlyImageBody.messages as any[])[0].content).toEqual([
      { type: "text", text: "prompt\n\nCONTEXT:\npaper text" }
    ]);
    expect(anthropicTextOnlyImageBody).not.toHaveProperty("omitAnthropicImage");
    const anthropicSystemFallbackBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "anthropic_messages",
        baseURL: "https://router.example",
        capabilities: { ...defaultCapabilities, imageBase64: true },
        bodyExtra: { systemFallbackToUser: true }
      },
      input: imageInput
    });
    expect(anthropicSystemFallbackBody).not.toHaveProperty("system");
    expect((anthropicSystemFallbackBody.messages as any[])[0].content).toContainEqual({
      type: "text",
      text: expect.stringContaining("SYSTEM:\nsystem")
    });
    const anthropicTextBlockBody = bodyFor({
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "anthropic_messages",
        baseURL: "https://api.anthropic.com",
        bodyExtra: { anthropicTextContentFormat: "blocks" }
      },
      input: { type: "text", text: "" }
    });
    expect((anthropicTextBlockBody.messages as any[])[0].content).toEqual([{ type: "text", text: "prompt" }]);
    expect(anthropicTextBlockBody).not.toHaveProperty("anthropicTextContentFormat");

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
      id: "sambanova-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.sambanova.ai/v1",
      apiKey: "sambanova-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer sambanova-secret", "anthropic-version": "2023-06-01" });
    expect(headersFor({
      ...profile,
      id: "sambanova-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.sambanova.ai/v1",
      apiKey: "sambanova-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: { "x-api-key": "" }
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: { "x-api-key": "" }
    })).not.toHaveProperty("x-api-key");
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
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization", omitAnthropicVersion: true }
    })).toMatchObject({ authorization: "Bearer routed-secret" });
    expect(headersFor({
      ...profile,
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization", omitAnthropicVersion: true }
    })).not.toHaveProperty("anthropic-version");
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
          anthropicDirectBrowserAccess: false,
          omitAnthropicVersion: true,
          pdfInputFileField: "file_url",
          omitAnthropicDocument: true,
          imageURLFormat: "string",
          anthropicTextContentFormat: "blocks",
          omitFields: ["temperature", "n", "max_tokens"]
        }
      }
    };
    const body = bodyFor(request);
    expect(body).toMatchObject({ response_format: { type: "json_object" } });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("n");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("localAgent");
    expect(body).not.toHaveProperty("agent");
    expect(body).not.toHaveProperty("subagent");
    expect(body).not.toHaveProperty("directBrowserAccess");
    expect(body).not.toHaveProperty("anthropicDirectBrowserAccess");
    expect(body).not.toHaveProperty("omitAnthropicVersion");
    expect(body).not.toHaveProperty("imageURLFormat");
    expect(body).not.toHaveProperty("anthropicTextContentFormat");
    expect(body).not.toHaveProperty("omitAnthropicDocument");
    expect(body).not.toHaveProperty("omitFields");
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
    const body = bodyFor(request);
    expect(JSON.stringify(body)).toContain("input_file");
    expect((body.input as any[])[0].content.map((part: any) => part.type)).toEqual(["input_file", "input_text"]);
    expect((body.input as any[])[0].content[0]).toMatchObject({
      type: "input_file",
      filename: "paper.pdf",
      file_data: "data:application/pdf;base64,abc"
    });
    expect((body.input as any[])[0].content[0]).not.toHaveProperty("file_url");
  });

  it("can map Responses PDF input to file_url for compatible routers", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses" as const,
        baseURL: "https://router.example/v1",
        capabilities: { ...defaultCapabilities, pdfBase64: true },
        bodyExtra: { pdfInputFileField: "file_url" }
      },
      input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
    };
    const body = bodyFor(request);
    expect((body.input as any[])[0].content[0]).toMatchObject({
      type: "input_file",
      filename: "paper.pdf",
      file_url: "data:application/pdf;base64,abc"
    });
    expect((body.input as any[])[0].content[0]).not.toHaveProperty("file_data");
    expect(body).not.toHaveProperty("pdfInputFileField");
  });

  it("omits Responses PDF input files after raw PDF fallback is exhausted", () => {
    const request = {
      ...baseRequest,
      profile: {
        ...profile,
        protocol: "openai_responses" as const,
        baseURL: "https://router.example/v1",
        capabilities: { ...defaultCapabilities, pdfBase64: true },
        bodyExtra: { omitPdfInputFile: true }
      },
      input: { type: "pdf_base64" as const, base64: "abc", filename: "paper.pdf" }
    };
    const body = bodyFor(request);
    expect(JSON.stringify(body.input)).not.toContain("input_file");
    expect((body.input as any[])[0].content).toEqual([
      { type: "input_text", text: "prompt" }
    ]);
    expect(body).not.toHaveProperty("omitPdfInputFile");
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
    const textOnlyBody = bodyFor({
      ...request,
      profile: {
        ...request.profile,
        bodyExtra: { omitAnthropicDocument: true }
      }
    });
    expect(JSON.stringify(textOnlyBody.messages)).not.toContain("application/pdf");
    expect((textOnlyBody.messages as any[])[0].content).toBe("prompt");
    expect(textOnlyBody).not.toHaveProperty("omitAnthropicDocument");
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

    const fallbackBody = bodyFor({
      ...request,
      profile: {
        ...request.profile,
        bodyExtra: { instructionsFallbackToUser: true }
      }
    });
    const fallbackInput = fallbackBody.input as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    expect(fallbackBody).not.toHaveProperty("instructions");
    expect(fallbackInput[0].content).toEqual([
      { type: "input_text", text: "SYSTEM:\nsystem" },
      { type: "input_text", text: "first question" }
    ]);
    expect(fallbackInput[2].content).toEqual([
      { type: "input_text", text: "second question" },
      { type: "input_text", text: "CONTEXT:\npaper text" }
    ]);
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
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"message\":{\"content\":[{\"type\":\"text\",\"text\":{\"value\":\"message value text\",\"annotations\":[]}}]}}]}")).toBe("message value text");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{\"refusal\":\"stream refusal\"}}]}")).toBe("stream refusal");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{\"text\":\"oops\"}}]}")).toBe("oops");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"delta\":{}},{\"delta\":{\"content\":\"second choice\"}}]}")).toBe("second choice");
    expect(parseStreamChunk("openai_chat", "data: {\"choices\":[{\"message\":{\"content\":null}},{\"message\":{\"refusal\":\"second refusal\"}}]}")).toBe("second refusal");
    expect(parseStreamChunk("openai_responses", "data: {\"output\":[{\"content\":[{\"text\":\"ok\"}]}]}")).toBe("ok");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"streamed\"}")).toBe("streamed");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.output_text.delta\",\"delta\":{\"text\":\"object streamed\"}}")).toBe("object streamed");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.refusal.delta\",\"delta\":\"responses refusal\"}")).toBe("responses refusal");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.output_text.done\",\"text\":\"done text\"}")).toBe("done text");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.refusal.done\",\"refusal\":\"done refusal\"}")).toBe("done refusal");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"hidden reasoning\"}")).toBe("");
    expect(parseStreamChunk("openai_responses", "data: {\"data\":{\"type\":\"response.reasoning_text.delta\",\"delta\":\"wrapped hidden\"}}")).toBe("");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"output_text\",\"text\":\"snapshot part\"}}")).toBe("snapshot part");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"output_text\",\"text\":{\"value\":\"snapshot value part\"}}}")).toBe("snapshot value part");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.output_item.done\",\"item\":{\"content\":[{\"type\":\"output_text\",\"text\":\"snapshot item\"}]}}")).toBe("snapshot item");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.output_item.done\",\"item\":{\"content\":[{\"type\":\"refusal\",\"refusal\":\"snapshot refusal\"}]}}")).toBe("snapshot refusal");
    expect(parseStreamChunk("openai_responses", "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"content\":[{\"type\":\"output_text\",\"text\":\"snapshot response\"}]}]}}")).toBe("snapshot response");
    expect(parseStreamChunk("openai_responses", "data: {\"response\":{\"text\":\"snapshot response text\"}}")).toBe("snapshot response text");
    expect(parseStreamChunk("openai_chat", "data: {\"delta\":{\"output_text\":\"router delta output\"}}")).toBe("router delta output");
    expect(parseStreamChunk("openai_chat", "data: {\"text\":{\"value\":\"router stream text\"}}")).toBe("router stream text");
    expect(parseStreamChunk("openai_chat", "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"candidate stream\"}]}}]}")).toBe("candidate stream");
    expect(parseStreamChunk("openai_chat", "data: {\"candidates\":[{\"content\":{\"parts\":[{\"type\":\"thinking\",\"text\":\"hidden\"},{\"text\":\" visible candidate\"}]}}]}")).toBe(" visible candidate");
    expect(parseStreamChunk("anthropic_messages", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"claude\"}}")).toBe("claude");
    expect(parseStreamChunk("anthropic_messages", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"text\":\"hidden thinking\"}}")).toBe("");
    expect(parseStreamChunk("anthropic_messages", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"ok\\\"\"}}")).toBe("{\"ok\"");
    expect(parseStreamChunk("openai_chat", "data: {\"data\":{\"choices\":[{\"delta\":{\"content\":\"wrapped chat\"}}]}}")).toBe("wrapped chat");
    expect(parseStreamChunk("openai_responses", "data: {\"result\":{\"type\":\"response.output_text.delta\",\"delta\":\"wrapped responses\"}}")).toBe("wrapped responses");
    expect(parseStreamChunk("openai_responses", "data: {\"body\":{\"type\":\"response.output_text.delta\",\"delta\":\"wrapped body\"}}")).toBe("wrapped body");
    expect(parseStreamChunk("openai_chat", "data: {\"completion\":{\"choices\":[{\"delta\":{\"content\":\"wrapped completion\"}}]}}")).toBe("wrapped completion");
    expect(parseStreamChunk("anthropic_messages", "data: {\"payload\":{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"wrapped anthropic\"}}}")).toBe("wrapped anthropic");
    expect(parseStreamChunk("anthropic_messages", "data: {\"message\":{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"wrapped message\"}}}")).toBe("wrapped message");
    expect(parseStreamChunk("openai_chat", "data: not-json")).toBe("");
    expect(parseStreamChunk("openai_chat", [
      "event: message",
      "data: {",
      "data: \"choices\":[{\"delta\":{\"content\":\"split chat\"}}]",
      "data: }"
    ].join("\n"))).toBe("split chat");
    expect(parseStreamChunk("openai_responses", [
      "event: response.output_text.delta",
      "data: {",
      "data: \"type\":\"response.output_text.delta\",",
      "data: \"delta\":\"split responses\"",
      "data: }"
    ].join("\n"))).toBe("split responses");
    expect(parseStreamChunk("anthropic_messages", [
      "event: content_block_delta",
      "data: {",
      "data: \"type\":\"content_block_delta\",",
      "data: \"delta\":{\"type\":\"text_delta\",\"text\":\"split anthropic\"}",
      "data: }"
    ].join("\n"))).toBe("split anthropic");
    expect(parseStreamChunk("openai_chat", [
      "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}",
      "data: {\"choices\":[{\"delta\":{\"content\":\" second\"}}]}"
    ].join("\n"))).toBe("first second");
    expect(redact("Authorization: Bearer sk-test-secret")).toContain("[redacted]");
    const redacted = redact("Groq gsk_test-secret xAI xai-test-secret Perplexity pplx-test-secret MiniMax ms-test-secret Gemini AIzaSyA1234567890abcdefghijklmnop");
    expect(redacted).not.toContain("gsk_test-secret");
    expect(redacted).not.toContain("xai-test-secret");
    expect(redacted).not.toContain("pplx-test-secret");
    expect(redacted).not.toContain("ms-test-secret");
    expect(redacted).not.toContain("AIzaSyA1234567890abcdefghijklmnop");
  });

  it("throws redacted provider errors from stream error events", () => {
    expect(() => parseStreamChunk("openai_responses", "data: {\"type\":\"error\",\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"Too many requests for sk-test-secret\"}}")).toThrow("rate_limit_exceeded - Too many requests for [redacted]");
    expect(() => parseStreamChunk("openai_chat", "data: {\"data\":{\"type\":\"error\",\"error\":{\"code\":\"bad_request\",\"message\":\"Bad sk-test-secret\"}}}")).toThrow("bad_request - Bad [redacted]");
    expect(() => parseStreamChunk("anthropic_messages", "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Bearer routed-secret overloaded\"}}")).toThrow("overloaded_error - Bearer [redacted] overloaded");
    expect(() => parseStreamChunk("openai_chat", "data: {\"payload\":{\"status\":\"error\",\"code\":\"invalid_api_key\",\"message\":\"Bad key sk-test-secret\"}}")).toThrow("invalid_api_key - error - Bad key [redacted]");
  });

  it("throws redacted provider errors from non-stream response bodies", () => {
    expect(() => extractResponseText("openai_responses", {
      error: {
        code: "rate_limit_exceeded",
        message: "Too many requests for sk-test-secret"
      }
    })).toThrow("rate_limit_exceeded - Too many requests for [redacted]");
    expect(() => extractResponseText("openai_chat", {
      body: {
        error: {
          code: "invalid_api_key",
          message: "Bad key sk-test-secret"
        }
      }
    } as any)).toThrow("invalid_api_key - Bad key [redacted]");
    expect(() => extractResponseText("anthropic_messages", {
      type: "error",
      error: {
        type: "overloaded_error",
        message: "Bearer routed-secret overloaded"
      }
    })).toThrow("overloaded_error - Bearer [redacted] overloaded");
    expect(() => extractResponseText("anthropic_messages", {
      payload: {
        type: "error",
        error: {
          type: "authentication_error",
          message: "Bearer routed-secret rejected"
        }
      }
    } as any)).toThrow("authentication_error - Bearer [redacted] rejected");
    expect(() => extractResponseText("openai_chat", {
      result: {
        status: "failed",
        code: "invalid_api_key",
        message: "Bad key sk-test-secret"
      }
    } as any)).toThrow("invalid_api_key - failed - Bad key [redacted]");
    expect(() => extractResponseText("openai_chat", {
      errors: [
        { code: "invalid_api_key", message: "Bad key sk-test-secret" },
        { code: "rate_limit", message: "Slow down" }
      ]
    } as any)).toThrow("invalid_api_key - Bad key [redacted]; rate_limit - Slow down");
  });

  it("normalizes provider token usage across OpenAI, Anthropic, Gemini-style, and wrapped responses", () => {
    expect(extractProviderUsage({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 }
      }
    })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 3,
      reasoningTokens: 2
    });

    expect(extractProviderUsage({
      response: {
        usage: {
          input_tokens: 7,
          output_tokens: 4,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1
        }
      }
    })).toEqual({
      inputTokens: 7,
      outputTokens: 4,
      totalTokens: 11,
      cachedInputTokens: 3
    });

    expect(extractProviderUsage({
      body: {
        usage: {
          prompt_tokens: 4,
          completion_tokens: 2,
          total_tokens: 6
        }
      }
    })).toEqual({
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6
    });

    expect(extractProviderUsage({
      usage_metadata: {
        promptTokenCount: "8",
        candidatesTokenCount: "6",
        totalTokenCount: "14"
      }
    })).toEqual({
      inputTokens: 8,
      outputTokens: 6,
      totalTokens: 14
    });

    expect(extractProviderUsage({
      usageMetadata: {
        inputTokenCount: "9",
        outputTokenCount: "5",
        totalTokenCount: "20",
        cachedContentTokenCount: "4",
        thoughtsTokenCount: "6"
      }
    })).toEqual({
      inputTokens: 9,
      outputTokens: 5,
      totalTokens: 20,
      cachedInputTokens: 4,
      reasoningTokens: 6
    });

    expect(extractProviderUsage({
      metadata: {
        usageMetadata: {
          prompt_token_count: 3,
          candidates_token_count: 2,
          total_token_count: 5,
          cached_content_token_count: 1,
          thinking_tokens: 4
        }
      }
    })).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      cachedInputTokens: 1,
      reasoningTokens: 4
    });
    expect(extractProviderUsage({
      choices: [{
        delta: {
          usage: {
            prompt_tokens: 6,
            completion_tokens: 3,
            total_tokens: 9
          }
        }
      }]
    })).toEqual({
      inputTokens: 6,
      outputTokens: 3,
      totalTokens: 9
    });

    expect(extractProviderUsage({
      output: [{
        content: [{
          usageMetadata: {
            inputTokenCount: "4",
            outputTokenCount: "2",
            totalTokenCount: "6"
          }
        }]
      }]
    })).toEqual({
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6
    });
  });

  it("extracts provider token usage from stream chunks", () => {
    expect(parseStreamUsage([
      "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5,\"total_tokens\":15}}",
      "",
      "data: {\"response\":{\"usage\":{\"input_tokens\":7,\"output_tokens\":4}}}"
    ].join("\n"))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    });

    expect(parseStreamUsage([
      "event: message_start",
      "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":3,\"output_tokens\":0,\"cacheReadInputTokens\":1}}}",
      "",
      "event: message_delta",
      "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":7,\"thinkingTokens\":2}}"
    ].join("\n"))).toEqual({
      inputTokens: 3,
      outputTokens: 7,
      totalTokens: 10,
      cachedInputTokens: 1,
      reasoningTokens: 2
    });

    expect(parseStreamUsage([
      "data: {\"choices\":[{\"delta\":{\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":1}}}]}",
      "",
      "data: {\"output\":[{\"content\":[{\"usageMetadata\":{\"inputTokenCount\":\"5\",\"outputTokenCount\":\"2\",\"thoughtsTokenCount\":\"1\"}}]}]}"
    ].join("\n"))).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
      reasoningTokens: 1
    });
  });

  it("extracts assistant text from nested message and output formats", () => {
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: [{ type: "text", text: "part a" }, { type: "text", text: "part b" }] } }]
    } as any)).toBe("part a\npart b");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: [{ type: "text", text: { value: "assistant value text", annotations: [] } }] } }]
    } as any)).toBe("assistant value text");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: [{ type: "text", value: "assistant direct value" }] } }]
    } as any)).toBe("assistant direct value");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: [{ type: "reasoning", text: "hidden" }, { type: "output_text", text: "final" }] } }]
    } as any)).toBe("final");
    expect(extractResponseText("openai_chat", {
      choices: [{ text: "legacy completion text" }]
    } as any)).toBe("legacy completion text");
    expect(extractResponseText("openai_chat", {
      choices: [{ delta: { content: [{ type: "text", text: "delta content" }] } }]
    } as any)).toBe("delta content");
    expect(extractResponseText("openai_responses", {
      output: [{ content: [{ type: "output_text", text: { value: "responses value text" } }] }]
    } as any)).toBe("responses value text");
    expect(extractResponseText("openai_responses", {
      text: "responses direct text"
    } as any)).toBe("responses direct text");
    expect(extractResponseText("openai_chat", {
      response: { text: { value: "wrapped direct text" } }
    } as any)).toBe("wrapped direct text");
    expect(extractResponseText("anthropic_messages", {
      content: [{ type: "text", text: { value: "anthropic value text" } }]
    } as any)).toBe("anthropic value text");
    expect(extractResponseText("anthropic_messages", {
      payload: { text: { value: "anthropic wrapped direct text" } }
    } as any)).toBe("anthropic wrapped direct text");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: null } }, { message: { content: "second choice text" } }]
    } as any)).toBe("second choice text");
    expect(extractResponseText("openai_chat", {
      choices: [{ delta: { reasoning_content: "hidden" } }, { delta: { refusal: "second refusal" } }]
    } as any)).toBe("second refusal");
    expect(extractResponseText("openai_chat", {
      refusal: "top-level refusal"
    } as any)).toBe("top-level refusal");
    expect(extractResponseText("openai_chat", {
      content: [{ type: "text", text: "top-level content" }]
    } as any)).toBe("top-level content");
    expect(extractResponseText("openai_chat", {
      output: [{ content: [{ text: "x" }, { content: "y" }] }]
    } as any)).toBe("x\ny");
    expect(extractResponseText("openai_responses", {
      response: { output_text: "wrapped response text" }
    } as any)).toBe("wrapped response text");
    expect(extractResponseText("openai_chat", {
      data: { choices: [{ message: { content: "wrapped chat text" } }] }
    } as any)).toBe("wrapped chat text");
    expect(extractResponseText("openai_responses", {
      result: { output: [{ content: [{ type: "output_text", text: "wrapped result text" }] }] }
    } as any)).toBe("wrapped result text");
    expect(extractResponseText("openai_chat", {
      body: { message: { content: [{ type: "output_text", text: "wrapped body message" }] } }
    } as any)).toBe("wrapped body message");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: null, refusal: "chat refusal" } }]
    } as any)).toBe("chat refusal");
    expect(extractResponseText("openai_responses", {
      output: [{ content: [{ type: "refusal", refusal: "responses refusal" }] }]
    } as any)).toBe("responses refusal");
    expect(extractResponseText("openai_responses", {
      type: "response.refusal.done",
      refusal: "responses top-level refusal"
    } as any)).toBe("responses top-level refusal");
    expect(extractResponseText("openai_chat", {
      candidates: [{ content: { parts: [{ text: "candidate part text" }] } }]
    } as any)).toBe("candidate part text");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: "<think data-source=\"router\">hidden chain</think>\n\nvisible text\n\n<think>late hidden" } }]
    } as any)).toBe("visible text");
    expect(extractResponseText("openai_chat", {
      choices: [{ message: { content: "<think>private chain\n\n最终回答：visible answer after marker" } }]
    } as any)).toBe("visible answer after marker");
    expect(extractResponseText("anthropic_messages", {
      content: "compatible anthropic text"
    } as any)).toBe("compatible anthropic text");
    expect(extractResponseText("anthropic_messages", {
      data: { content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "wrapped anthropic text" }] }
    } as any)).toBe("wrapped anthropic text");
    expect(extractResponseText("anthropic_messages", {
      payload: { message: { content: [{ type: "redacted_thinking", text: "hidden" }, { type: "text", text: "anthropic message text" }] } }
    } as any)).toBe("anthropic message text");
  });
});
