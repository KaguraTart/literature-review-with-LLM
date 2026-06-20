import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const BASIC_LIVE_CASE_IDS = ["openai", "openai-responses-compatible", "anthropic", "anthropic-compatible", "openai-compatible"];
const NAMED_LIVE_SPECS = [
  { id: "minimax", envPrefix: "MINIMAX", protocol: "openai_chat", basePath: "/minimax/v1", model: "MiniMax-M2.7-highspeed", secret: "live-minimax-secret" },
  { id: "gemini", envPrefix: "GEMINI", protocol: "openai_chat", basePath: "/gemini/v1beta/openai", model: "gemini-2.5-flash", secret: "live-gemini-secret" },
  { id: "azure-openai", envPrefix: "AZURE_OPENAI", protocol: "openai_responses", basePath: "/azure/openai/v1", model: "azure-gpt-4.1", secret: "live-azure-secret" },
  { id: "github-models", envPrefix: "GITHUB_MODELS", protocol: "openai_chat", basePath: "/inference", model: "github/model", secret: "live-github-secret" },
  { id: "fireworks", envPrefix: "FIREWORKS", protocol: "openai_chat", basePath: "/fireworks/v1", model: "accounts/fireworks/models/llama-v3p1-8b-instruct", secret: "live-fireworks-secret" },
  { id: "cerebras", envPrefix: "CEREBRAS", protocol: "openai_chat", basePath: "/cerebras/v1", model: "llama3.1-8b", secret: "live-cerebras-secret" },
  { id: "nvidia-nim", envPrefix: "NVIDIA_NIM", protocol: "openai_chat", basePath: "/nvidia/v1", model: "meta/llama-3.1-8b-instruct", secret: "live-nvidia-secret" },
  { id: "sambanova", envPrefix: "SAMBANOVA", protocol: "openai_chat", basePath: "/sambanova/v1", model: "Meta-Llama-3.1-8B-Instruct", secret: "live-sambanova-secret" },
  { id: "sambanova-responses", envPrefix: "SAMBANOVA_RESPONSES", protocol: "openai_responses", basePath: "/sambanova-responses/v1", model: "Meta-Llama-3.1-8B-Instruct", secret: "live-sambanova-responses-secret" },
  { id: "sambanova-anthropic", envPrefix: "SAMBANOVA_ANTHROPIC", protocol: "anthropic_messages", basePath: "/sambanova-anthropic", model: "Meta-Llama-3.1-8B-Instruct", secret: "live-sambanova-anthropic-secret" },
  { id: "xai", envPrefix: "XAI", protocol: "openai_chat", basePath: "/xai/v1", model: "grok-4", secret: "live-xai-secret" },
  { id: "groq", envPrefix: "GROQ", protocol: "openai_chat", basePath: "/groq/openai/v1", model: "llama-3.3-70b-versatile", secret: "live-groq-secret" },
  { id: "mistral", envPrefix: "MISTRAL", protocol: "openai_chat", basePath: "/mistral/v1", model: "mistral-large-latest", secret: "live-mistral-secret" },
  { id: "together", envPrefix: "TOGETHER", protocol: "openai_chat", basePath: "/together/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", secret: "live-together-secret" },
  { id: "kimi", envPrefix: "KIMI", protocol: "openai_chat", basePath: "/moonshot/v1", model: "kimi-k2-0711-preview", secret: "live-kimi-secret" },
  { id: "perplexity", envPrefix: "PERPLEXITY", protocol: "openai_chat", basePath: "/perplexity", model: "sonar-pro", secret: "live-perplexity-secret" },
  { id: "deepseek", envPrefix: "DEEPSEEK", protocol: "openai_chat", basePath: "/deepseek", model: "deepseek-chat", secret: "live-deepseek-secret" },
  { id: "deepseek-anthropic", envPrefix: "DEEPSEEK_ANTHROPIC", protocol: "anthropic_messages", basePath: "/deepseek-anthropic", model: "deepseek-chat", secret: "live-deepseek-anthropic-secret" },
  { id: "zai-anthropic", envPrefix: "ZAI_ANTHROPIC", protocol: "anthropic_messages", basePath: "/zai-anthropic", model: "glm-4.5", secret: "live-zai-anthropic-secret" },
  { id: "openrouter", envPrefix: "OPENROUTER", protocol: "openai_chat", basePath: "/openrouter/api/v1", model: "openai/gpt-4.1-mini", secret: "live-openrouter-secret" },
  { id: "dashscope", envPrefix: "DASHSCOPE", protocol: "openai_chat", basePath: "/dashscope/compatible-mode/v1", model: "qwen-plus", secret: "live-dashscope-secret" },
  { id: "siliconflow", envPrefix: "SILICONFLOW", protocol: "openai_chat", basePath: "/siliconflow/v1", model: "Qwen/Qwen3-32B", secret: "live-siliconflow-secret" },
  { id: "zhipu", envPrefix: "ZHIPU", protocol: "openai_chat", basePath: "/zhipu/api/paas/v4", model: "glm-4.5", secret: "live-zhipu-secret" },
  { id: "volcengine", envPrefix: "VOLCENGINE", protocol: "openai_chat", basePath: "/volcengine/api/v3", model: "doubao-seed-1-6-250615", secret: "live-volcengine-secret" },
  { id: "qianfan", envPrefix: "QIANFAN", protocol: "openai_chat", basePath: "/qianfan/v2", model: "ernie-x1-turbo-32k", secret: "live-qianfan-secret" },
  { id: "hunyuan", envPrefix: "HUNYUAN", protocol: "openai_chat", basePath: "/hunyuan/v1", model: "hunyuan-turbos-latest", secret: "live-hunyuan-secret" },
  { id: "ollama", envPrefix: "OLLAMA", protocol: "openai_chat", basePath: "/ollama/v1", model: "llama3.1", secret: "live-ollama-secret", apiKeyOptional: true },
  { id: "lm-studio", envPrefix: "LM_STUDIO", protocol: "openai_chat", basePath: "/lm-studio/v1", model: "local-model", secret: "live-lm-studio-secret", apiKeyOptional: true }
];
const NAMED_LIVE_CASE_IDS = NAMED_LIVE_SPECS.map((entry) => entry.id);
const BASIC_LIVE_CASES = BASIC_LIVE_CASE_IDS.join(",");
const NAMED_LIVE_CASES = NAMED_LIVE_CASE_IDS.join(",");
const ALL_LIVE_CASE_IDS = [...BASIC_LIVE_CASE_IDS, ...NAMED_LIVE_CASE_IDS];

describe("provider smoke verifier", () => {
  it("calls an OpenAI-compatible chat endpoint with the expected request shape", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "smoke-secret",
        "--model", "mock-chat",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_chat",
        endpoint: `${baseURL}/v1/chat/completions`,
        text: "OK chat"
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: "POST",
        path: "/v1/chat/completions",
        authorization: "Bearer smoke-secret",
        body: {
          model: "mock-chat",
          max_tokens: 64,
          stream: false,
          messages: [
            { role: "system" },
            { role: "user" }
          ]
        }
      });
    }, { responseBody: { choices: [{ message: { content: "OK chat" } }] } });
  });

  it("omits configured provider body fields before sending and parsing the response", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "smoke-secret",
        "--model", "mock-chat",
        "--stream",
        "--body-extra-json", JSON.stringify({
          response_format: { type: "json_object" },
          omitFields: ["temperature", "n", "max_tokens", "stream"]
        }),
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_chat",
        stream: false,
        text: "OK stripped"
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toMatchObject({
        model: "mock-chat",
        response_format: { type: "json_object" }
      });
      expect(requests[0].body).not.toHaveProperty("temperature");
      expect(requests[0].body).not.toHaveProperty("n");
      expect(requests[0].body).not.toHaveProperty("max_tokens");
      expect(requests[0].body).not.toHaveProperty("stream");
      expect(requests[0].body).not.toHaveProperty("omitFields");
    }, { responseBody: { choices: [{ message: { content: "OK stripped" } }] } });
  });

  it("falls back when an OpenAI-compatible smoke endpoint rejects stream_options", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "smoke-secret",
        "--model", "mock-chat",
        "--stream",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_chat",
        stream: true,
        text: "OK fallback"
      });
      expect(requests).toHaveLength(2);
      expect(requests[0].body).toMatchObject({
        stream: true,
        stream_options: { include_usage: true }
      });
      expect(requests[1].body).toMatchObject({ stream: true });
      expect(requests[1].body).not.toHaveProperty("stream_options");
    }, {
      handler: (requestData, response) => {
        if (requestData.body?.stream_options) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } }));
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end("data: {\"choices\":[{\"delta\":{\"content\":\"OK fallback\"}}]}\n\ndata: [DONE]\n\n");
      }
    });
  });

  it("falls back when an OpenAI-compatible smoke endpoint rejects JSON and token fields", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "smoke-secret",
        "--model", "mock-chat",
        "--body-extra-json", JSON.stringify({ response_format: { type: "json_object" } }),
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_chat",
        stream: false,
        text: "OK fallback"
      });
      expect(requests).toHaveLength(2);
      expect(requests[0].body).toMatchObject({
        response_format: { type: "json_object" },
        max_tokens: 64
      });
      expect(requests[1].body).not.toHaveProperty("response_format");
      expect(requests[1].body).not.toHaveProperty("max_tokens");
      expect(requests[1].body).toMatchObject({ max_completion_tokens: 64 });
    }, {
      handler: (requestData, response) => {
        if (requestData.body?.response_format || requestData.body?.max_tokens) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "response_format and max_tokens are unsupported" } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "OK fallback" } }] }));
      }
    });
  });

  it("falls back when a provider returns structured unsupported-parameter fields", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "smoke-secret",
        "--model", "mock-chat",
        "--body-extra-json", JSON.stringify({ response_format: { type: "json_object" } }),
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_chat",
        text: "OK structured fallback"
      });
      expect(requests).toHaveLength(2);
      expect(requests[0].body).toMatchObject({
        response_format: { type: "json_object" },
        max_tokens: 64
      });
      expect(requests[1].body).not.toHaveProperty("response_format");
      expect(requests[1].body).toMatchObject({ max_tokens: 64 });
    }, {
      handler: (requestData, response) => {
        if (requestData.body?.response_format) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({
            error: {
              code: "unsupported_parameter",
              message: "Unsupported request parameter",
              param: "response_format"
            }
          }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "OK structured fallback" } }] }));
      }
    });
  });

  it("falls back across multiple OpenAI Responses-compatible smoke optional-field errors", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-responses-compatible",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "smoke-secret",
        "--model", "mock-responses",
        "--body-extra-json", JSON.stringify({ text: { format: { type: "json_object" } } }),
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_responses",
        stream: false,
        text: "OK fallback"
      });
      expect(requests).toHaveLength(4);
      expect(requests[0].body).toMatchObject({
        instructions: expect.stringContaining("provider smoke-test"),
        text: { format: { type: "json_object" } },
        max_output_tokens: 64
      });
      expect(requests[1].body).not.toHaveProperty("text");
      expect(requests[1].body).toMatchObject({
        instructions: expect.stringContaining("provider smoke-test"),
        max_output_tokens: 64
      });
      expect(requests[2].body).not.toHaveProperty("text");
      expect(requests[2].body).not.toHaveProperty("max_output_tokens");
      expect(requests[2].body).toHaveProperty("instructions");
      expect(requests[3].body).not.toHaveProperty("text");
      expect(requests[3].body).not.toHaveProperty("max_output_tokens");
      expect(requests[3].body).not.toHaveProperty("instructions");
      expect(requests[3].body.input[0].content[0]).toMatchObject({
        type: "input_text",
        text: expect.stringContaining("SYSTEM:")
      });
    }, {
      handler: (requestData, response) => {
        if (requestData.body?.text) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Unsupported parameter: text.format" } }));
          return;
        }
        if (requestData.body?.max_output_tokens) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Unsupported parameter: max_output_tokens" } }));
          return;
        }
        if (requestData.body?.instructions) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Unsupported parameter: instructions" } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ output_text: "OK fallback" }));
      }
    });
  });

  it("falls back across multiple Anthropic-compatible smoke optional-field errors", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "anthropic-compatible",
        "--base-url", baseURL,
        "--api-key", "smoke-secret",
        "--model", "mock-anthropic",
        "--body-extra-json", JSON.stringify({ metadata: { source: "zotero" } }),
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "anthropic_messages",
        stream: false,
        text: "OK anthropic fallback"
      });
      expect(requests).toHaveLength(4);
      expect(requests[0].body).toMatchObject({
        metadata: { source: "zotero" },
        system: expect.stringContaining("provider smoke-test"),
        stream: false
      });
      expect(requests[1].body).not.toHaveProperty("metadata");
      expect(requests[1].body).toMatchObject({
        system: expect.stringContaining("provider smoke-test"),
        stream: false
      });
      expect(requests[2].body).not.toHaveProperty("metadata");
      expect(requests[2].body).not.toHaveProperty("system");
      expect(requests[2].body).toMatchObject({ stream: false });
      expect(JSON.stringify(requests[2].body.messages[0].content)).toContain("SYSTEM:");
      expect(requests[3].body).not.toHaveProperty("metadata");
      expect(requests[3].body).not.toHaveProperty("system");
      expect(requests[3].body).not.toHaveProperty("stream");
    }, {
      handler: (requestData, response) => {
        if (requestData.body?.metadata) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Unsupported parameter: metadata" } }));
          return;
        }
        if (requestData.body?.system) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Unsupported parameter: system prompt" } }));
          return;
        }
        if (Object.prototype.hasOwnProperty.call(requestData.body || {}, "stream")) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Unsupported parameter: stream" } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ content: [{ type: "text", text: "OK anthropic fallback" }] }));
      }
    });
  });

  it("rejects non-object provider body-extra JSON", async () => {
    await expect(execFileAsync(process.execPath, [
      "scripts/verify-provider-smoke.mjs",
      "--profile", "openai-compatible",
      "--base-url", "http://127.0.0.1:11434/v1",
      "--model", "local-chat",
      "--body-extra-json", "[]",
      "--dry-run",
      "--json"
    ], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("--body-extra-json must be a JSON object")
    });
  });

  it("rejects malformed provider body-extra JSON", async () => {
    await expect(execFileAsync(process.execPath, [
      "scripts/verify-provider-smoke.mjs",
      "--profile", "openai-compatible",
      "--base-url", "http://127.0.0.1:11434/v1",
      "--model", "local-chat",
      "--body-extra-json", "{",
      "--dry-run",
      "--json"
    ], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("--body-extra-json must be valid JSON")
    });
  });

  it("allows local OpenAI-compatible endpoints without API credentials", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--model", "local-chat",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_chat",
        endpoint: `${baseURL}/v1/chat/completions`,
        text: "OK local"
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBeUndefined();
      expect(requests[0].body).toMatchObject({ model: "local-chat" });
    }, { responseBody: { choices: [{ message: { content: "OK local" } }] } });
  });

  it("still requires credentials for remote provider endpoints", async () => {
    await expect(execFileAsync(process.execPath, [
      "scripts/verify-provider-smoke.mjs",
      "--profile", "openai-compatible",
      "--base-url", "https://router.example/v1",
      "--model", "remote-model",
      "--dry-run",
      "--json"
    ], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("API key or explicit auth header is required")
    });
  });

  it("calls an OpenAI Responses endpoint with input items", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "smoke-secret",
        "--model", "mock-responses",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "openai_responses",
        endpoint: `${baseURL}/v1/responses`,
        text: "OK responses"
      });
      expect(requests[0]).toMatchObject({
        method: "POST",
        path: "/v1/responses",
        authorization: "Bearer smoke-secret",
        body: {
          model: "mock-responses",
          max_output_tokens: 64,
          stream: false
        }
      });
      expect(requests[0].body.input[0].content.map((part: any) => part.type)).toEqual(["input_text", "input_text"]);
    }, { responseBody: { output_text: "OK responses" } });
  });

  it("calls an Anthropic Messages endpoint with Anthropic headers", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "anthropic",
        "--base-url", baseURL,
        "--api-key", "anthropic-secret",
        "--model", "mock-anthropic",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "anthropic_messages",
        endpoint: `${baseURL}/v1/messages`,
        text: "OK anthropic"
      });
      expect(requests[0]).toMatchObject({
        method: "POST",
        path: "/v1/messages",
        xApiKey: "anthropic-secret",
        anthropicVersion: "2023-06-01",
        body: {
          model: "mock-anthropic",
          max_tokens: 64,
          stream: false,
          messages: [
            { role: "user" }
          ]
        }
      });
      expect(requests[0].body.messages[0].content.map((part: any) => part.type)).toEqual(["text"]);
    }, { responseBody: { content: [{ type: "text", text: "OK anthropic" }] } });
  });

  it("calls an Anthropic-compatible endpoint with bearer auth", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "anthropic-compatible",
        "--base-url", baseURL,
        "--api-key", "anthropic-compatible-secret",
        "--model", "mock-anthropic-compatible",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        protocol: "anthropic_messages",
        endpoint: `${baseURL}/v1/messages`,
        text: "OK anthropic compatible"
      });
      expect(requests[0]).toMatchObject({
        method: "POST",
        path: "/v1/messages",
        authorization: "Bearer anthropic-compatible-secret",
        anthropicVersion: "2023-06-01",
        body: {
          model: "mock-anthropic-compatible",
          max_tokens: 64,
          stream: false
        }
      });
      expect(requests[0].xApiKey).toBeUndefined();
    }, { responseBody: { content: [{ type: "text", text: "OK anthropic compatible" }] } });
  });

  it("prints a sanitized dry-run request without calling the endpoint", async () => {
    await withMockProvider(async (baseURL, requests) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--api-key", "dry-run-secret",
        "--model", "mock-chat",
        "--dry-run",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        dryRun: true,
        endpoint: `${baseURL}/v1/chat/completions`
      });
      expect(report.request.headerNames).toContain("authorization");
      expect(JSON.stringify(report)).not.toContain("dry-run-secret");
      expect(requests).toEqual([]);
    });
  });

  it("runs built-in mock smoke checks across provider protocols", async () => {
    const report = await runSmoke(["--mock", "--json"]);

    expect(report.ok).toBe(true);
    expect(report.mock).toBe(true);
    expect(report.results.map((result: any) => [result.profile, result.protocol, result.text])).toEqual([
      ["openai-compatible", "openai_chat", "OK chat"],
      ["openai", "openai_responses", "OK responses"],
      ["openai-responses-compatible", "openai_responses", "OK responses"],
      ["anthropic", "anthropic_messages", "OK anthropic"]
    ]);
    expect(report.requests.map((request: any) => request.path)).toEqual([
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/responses",
      "/v1/messages"
    ]);
    expect(JSON.stringify(report)).not.toContain("mock-secret");
  });

  it("runs built-in mock stream checks across provider protocols", async () => {
    const report = await runSmoke(["--mock", "--stream", "--json"]);

    expect(report.ok).toBe(true);
    expect(report).toMatchObject({
      mock: true,
      inputMode: "text"
    });
    expect(report.results.map((result: any) => [result.profile, result.protocol, result.stream, result.text])).toEqual([
      ["openai-compatible", "openai_chat", true, "OK chat"],
      ["openai", "openai_responses", true, "OK responses"],
      ["openai-responses-compatible", "openai_responses", true, "OK responses"],
      ["anthropic", "anthropic_messages", true, "OK anthropic"]
    ]);
    expect(report.results.map((result: any) => result.usage)).toEqual([
      { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    ]);
    expect(report.requests.map((request: any) => [request.path, request.bodyKeys.includes("stream")])).toEqual([
      ["/v1/chat/completions", true],
      ["/v1/responses", true],
      ["/v1/responses", true],
      ["/v1/messages", true]
    ]);
    expect(report.requests.map((request: any) => [request.path, request.bodyKeys.includes("stream_options")])).toEqual([
      ["/v1/chat/completions", true],
      ["/v1/responses", false],
      ["/v1/responses", false],
      ["/v1/messages", false]
    ]);
    expect(JSON.stringify(report)).not.toContain("mock-secret");
  });

  it("runs built-in mock image checks across provider protocols", async () => {
    const report = await runSmoke(["--mock", "--image", "--json"]);

    expect(report.ok).toBe(true);
    expect(report).toMatchObject({
      mock: true,
      inputMode: "image"
    });
    expect(report.results.map((result: any) => [result.profile, result.protocol, result.contentTypes])).toEqual([
      ["openai-compatible", "openai_chat", ["text", "image_url"]],
      ["openai", "openai_responses", ["input_text", "input_text", "input_image"]],
      ["openai-responses-compatible", "openai_responses", ["input_text", "input_text", "input_image"]],
      ["anthropic", "anthropic_messages", ["image", "text"]]
    ]);
    expect(report.requests.map((request: any) => request.contentTypes)).toEqual([
      ["text", "image_url"],
      ["input_text", "input_text", "input_image"],
      ["input_text", "input_text", "input_image"],
      ["image", "text"]
    ]);
    expect(JSON.stringify(report)).not.toContain("mock-secret");
  });

  it("runs built-in mock PDF checks for raw-document provider protocols", async () => {
    const report = await runSmoke(["--mock", "--pdf", "--json"]);

    expect(report.ok).toBe(true);
    expect(report).toMatchObject({
      mock: true,
      inputMode: "pdf"
    });
    expect(report.results.map((result: any) => [result.profile, result.protocol, result.contentTypes])).toEqual([
      ["openai", "openai_responses", ["input_file", "input_text"]],
      ["openai-responses-compatible", "openai_responses", ["input_file", "input_text"]],
      ["anthropic", "anthropic_messages", ["document", "text"]],
      ["anthropic-compatible", "anthropic_messages", ["document", "text"]]
    ]);
    expect(report.requests.map((request: any) => request.path)).toEqual([
      "/v1/responses",
      "/v1/responses",
      "/v1/messages",
      "/v1/messages"
    ]);
    expect(report.requests.map((request: any) => request.contentTypes)).toEqual([
      ["input_file", "input_text"],
      ["input_file", "input_text"],
      ["document", "text"],
      ["document", "text"]
    ]);
    expect(JSON.stringify(report)).not.toContain("mock-secret");
  });

  it("runs built-in mock model-list checks across provider protocols", async () => {
    const report = await runSmoke(["--mock", "--models", "--json"]);

    expect(report.ok).toBe(true);
    expect(report.mock).toBe(true);
    expect(report.models).toBe(true);
    expect(report.results.map((result: any) => [result.profile, result.protocol, result.modelCount, result.pages])).toEqual([
      ["openai-compatible", "openai_chat", 3, 2],
      ["openai", "openai_responses", 3, 2],
      ["openai-responses-compatible", "openai_responses", 3, 2],
      ["anthropic", "anthropic_messages", 3, 2]
    ]);
    expect(report.results[0].modelIds).toEqual(["mock-model-a", "mock-model-b", "mock-model-c"]);
    expect(report.results[0].modelOptions.find((option: any) => option.id === "mock-model-c").label).toBe("Mock Model C");
    expect(report.requests.map((request: any) => request.path)).toEqual([
      "/v1/models",
      "/v1/models?after_id=mock-model-b",
      "/v1/models",
      "/v1/models?after_id=mock-model-b",
      "/v1/models",
      "/v1/models?after_id=mock-model-b",
      "/v1/models",
      "/v1/models?after_id=mock-model-b"
    ]);
    expect(JSON.stringify(report)).not.toContain("mock-secret");
  });

  it("checks default provider catalog request shapes offline without leaking placeholder auth", async () => {
    const report = await runSmoke(["--catalog", "--json"]);

    expect(report).toMatchObject({
      ok: true,
      catalog: true,
      profileCount: 34,
      checked: 33,
      skipped: 1
    });
    expect(report.results.find((result: any) => result.id === "local-agents")).toMatchObject({
      ok: true,
      skipped: true
    });
    expect(report.results.find((result: any) => result.id === "openai")).toMatchObject({
      ok: true,
      protocol: "openai_responses",
      endpoint: "https://api.openai.com/v1/responses",
      modelsEndpoint: "https://api.openai.com/v1/models",
      authHeaderNames: ["authorization"],
      bodyKeys: expect.arrayContaining(["input", "max_output_tokens"]),
      inputChecks: [
        { mode: "text", supported: true, ok: true, contentTypes: ["input_text", "input_text"], issues: [] },
        { mode: "image", supported: true, ok: true, contentTypes: ["input_text", "input_text", "input_image"], issues: [] },
        { mode: "pdf", supported: true, ok: true, contentTypes: ["input_file", "input_text"], issues: [] }
      ]
    });
    expect(report.results.find((result: any) => result.id === "github-models")).toMatchObject({
      ok: true,
      protocol: "openai_chat",
      endpoint: "https://models.github.ai/inference/chat/completions",
      modelsEndpoint: "",
      authHeaderNames: ["authorization"],
      inputChecks: [
        { mode: "text", supported: true, ok: true, contentTypes: [], issues: [] },
        { mode: "image", supported: true, ok: true, contentTypes: ["text", "image_url"], issues: [] },
        { mode: "pdf", supported: false, ok: true, contentTypes: [], issues: [] }
      ]
    });
    expect(report.results.find((result: any) => result.id === "openai-compatible")).toMatchObject({
      ok: true,
      protocol: "openai_chat",
      inputChecks: [
        { mode: "text", supported: true, ok: true, contentTypes: [], issues: [] },
        { mode: "image", supported: true, ok: true, contentTypes: ["text", "image_url"], issues: [] },
        { mode: "pdf", supported: false, ok: true, rejected: true, contentTypes: [], issues: [] }
      ]
    });
    expect(report.results.find((result: any) => result.id === "openai-responses-compatible")).toMatchObject({
      ok: true,
      protocol: "openai_responses",
      endpoint: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1/responses",
      modelsEndpoint: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1/models",
      authHeaderNames: ["authorization"],
      bodyKeys: expect.arrayContaining(["input", "max_output_tokens"]),
      inputChecks: expect.arrayContaining([
        expect.objectContaining({ mode: "image", supported: true, ok: true, contentTypes: ["input_text", "input_text", "input_image"] }),
        expect.objectContaining({ mode: "pdf", supported: true, ok: true, contentTypes: ["input_file", "input_text"] })
      ])
    });
    expect(report.results.find((result: any) => result.id === "anthropic")).toMatchObject({
      ok: true,
      protocol: "anthropic_messages",
      endpoint: "https://api.anthropic.com/v1/messages",
      authHeaderNames: ["x-api-key"],
      bodyKeys: expect.arrayContaining(["messages", "max_tokens"]),
      inputChecks: [
        { mode: "text", supported: true, ok: true, contentTypes: ["text"], issues: [] },
        { mode: "image", supported: true, ok: true, contentTypes: ["image", "text"], issues: [] },
        { mode: "pdf", supported: true, ok: true, contentTypes: ["document", "text"], issues: [] }
      ]
    });
    expect(report.results.find((result: any) => result.id === "anthropic-compatible")).toMatchObject({
      ok: true,
      protocol: "anthropic_messages",
      endpoint: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT/v1/messages",
      authHeaderNames: ["authorization"],
      bodyKeys: expect.arrayContaining(["messages", "max_tokens"]),
      inputChecks: expect.arrayContaining([
        expect.objectContaining({ mode: "image", supported: true, ok: true, contentTypes: ["image", "text"] }),
        expect.objectContaining({ mode: "pdf", supported: false, ok: true, rejected: true })
      ])
    });
    expect(report.results.find((result: any) => result.id === "perplexity")).toMatchObject({
      ok: true,
      modelList: true,
      modelsEndpoint: "https://api.perplexity.ai/models"
    });
    expect(report.results.find((result: any) => result.id === "ollama")).toMatchObject({
      ok: true,
      localEndpoint: true,
      authHeaderNames: []
    });
    expect(JSON.stringify(report)).not.toContain("catalog-secret");
  });

  it("prints a sanitized model-list dry run without requiring a model", async () => {
    const report = await runSmoke([
      "--profile", "anthropic",
      "--api-key", "models-secret",
      "--models",
      "--dry-run",
      "--json"
    ]);

    expect(report).toMatchObject({
      ok: true,
      dryRun: true,
      models: true,
      protocol: "anthropic_messages",
      endpoint: "https://api.anthropic.com/v1/models"
    });
    expect(report.request.method).toBe("GET");
    expect(report.request.headerNames).toContain("x-api-key");
    expect(JSON.stringify(report)).not.toContain("models-secret");
  });

  it("allows local model-list dry runs without API credentials", async () => {
    await withMockProvider(async (baseURL) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--models",
        "--dry-run",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        dryRun: true,
        models: true,
        endpoint: `${baseURL}/v1/models`
      });
      expect(report.request.headerNames).not.toContain("authorization");
    });
  });

  it("loads wrapped local model-list responses without API credentials", async () => {
    await withMockProvider(async (baseURL) => {
      const report = await runSmoke([
        "--profile", "openai-compatible",
        "--base-url", `${baseURL}/v1`,
        "--models",
        "--json"
      ]);

      expect(report).toMatchObject({
        ok: true,
        models: true,
        modelCount: 5,
        modelIds: ["local-model-a", "local-model-b", "local-model-name", "slug-model", "value-model"]
      });
      expect(report.modelOptions.find((option: any) => option.id === "local-model-a").label).toBe("Local Model A");
      expect(report.modelOptions.find((option: any) => option.id === "local-model-name").label).toBe("Local Model Name");
      expect(report.modelOptions.find((option: any) => option.id === "value-model").label).toBe("Value Model");
    }, {
      responseBody: {
        message: {
          list: [
            { id: "local-model-b" },
            { id: "local-model-a", display_name: "Local Model A" },
            { model_name: "local-model-name", title: "Local Model Name" },
            { value: "value-model", label: "Value Model" },
            { slug: "slug-model" }
          ]
        }
      }
    });
  });

  it("fails model-list checks when a 200 response contains a provider error", async () => {
    await withMockProvider(async (baseURL) => {
      let error: any;
      try {
        await runSmoke([
          "--profile", "openai-compatible",
          "--base-url", `${baseURL}/v1`,
          "--models",
          "--json"
        ]);
      } catch (err) {
        error = err;
      }

      expect(error?.stdout).toContain("invalid_api_key");
      expect(error?.stdout).toContain("Bad key [redacted]");
      expect(error?.stdout).not.toContain("sk-test-secret");
      expect(error?.stdout).not.toContain("gsk_test-secret");
    }, {
      responseBody: {
        error: {
          code: "invalid_api_key",
          message: "Bad key sk-test-secret and gsk_test-secret"
        }
      }
    });

    await withMockProvider(async (baseURL) => {
      let error: any;
      try {
        await runSmoke([
          "--profile", "openai-compatible",
          "--base-url", `${baseURL}/v1`,
          "--models",
          "--json"
        ]);
      } catch (err) {
        error = err;
      }

      expect(error?.stdout).toContain("invalid_api_key");
      expect(error?.stdout).toContain("error");
      expect(error?.stdout).toContain("Bad key [redacted]");
      expect(error?.stdout).not.toContain("sk-test-secret");
    }, {
      responseBody: {
        payload: {
          status: "error",
          code: "invalid_api_key",
          message: "Bad key sk-test-secret"
        }
      }
    });
  });

  it("skips live provider checks when required env config is missing", async () => {
    const report = await runLive(["--json"], scrubProviderEnv());

    expect(report).toMatchObject({
      ok: true,
      live: true,
      counts: {
        passed: 0,
        skipped: ALL_LIVE_CASE_IDS.length,
        failed: 0
      }
    });
    expect(report.results.map((result: any) => [result.id, result.status])).toEqual(
      ALL_LIVE_CASE_IDS.map((id) => [id, "skipped"])
    );
    expect(report.results.find((result: any) => result.id === "openai-responses-compatible").missing).toContain("OPENAI_RESPONSES_COMPATIBLE_BASE_URL");
    expect(report.results.find((result: any) => result.id === "anthropic-compatible").missing).toContain("ANTHROPIC_COMPATIBLE_BASE_URL");
    expect(report.results.find((result: any) => result.id === "openai-compatible").missing).toContain("OPENAI_COMPATIBLE_BASE_URL");
    expect(report.results.find((result: any) => result.id === "github-models").missing).toContain("GITHUB_MODELS_API_KEY");
    expect(report.results.find((result: any) => result.id === "minimax").missing).toEqual(["MINIMAX_API_KEY"]);
    expect(report.results.find((result: any) => result.id === "azure-openai").missing).toEqual(["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_MODEL", "AZURE_OPENAI_BASE_URL"]);
    expect(report.results.find((result: any) => result.id === "deepseek").missing).toContain("DEEPSEEK_API_KEY");
    expect(report.results.find((result: any) => result.id === "openrouter").missing).toContain("OPENROUTER_API_KEY");
    expect(report.results.find((result: any) => result.id === "sambanova-anthropic").missing).toContain("SAMBANOVA_ANTHROPIC_API_KEY");
    expect(report.results.find((result: any) => result.id === "ollama").missing).toEqual(["OLLAMA_MODEL", "OLLAMA_BASE_URL"]);
    expect(report.results.find((result: any) => result.id === "lm-studio").missing).toEqual(["LM_STUDIO_MODEL", "LM_STUDIO_BASE_URL"]);
  });

  it("skips live provider model-list checks without requiring model names", async () => {
    const report = await runLive(["--models", "--json"], scrubProviderEnv());

    expect(report).toMatchObject({
      ok: true,
      live: true,
      models: true,
      counts: {
        passed: 0,
        skipped: ALL_LIVE_CASE_IDS.length,
        failed: 0
      }
    });
    expect(report.results.map((result: any) => result.id)).toEqual(ALL_LIVE_CASE_IDS);
    expect(report.results.find((result: any) => result.id === "openai").missing).toEqual(["OPENAI_API_KEY"]);
    expect(report.results.find((result: any) => result.id === "openai-responses-compatible").missing).toEqual(["OPENAI_RESPONSES_COMPATIBLE_API_KEY", "OPENAI_RESPONSES_COMPATIBLE_BASE_URL"]);
    expect(report.results.find((result: any) => result.id === "anthropic-compatible").missing).toEqual(["ANTHROPIC_COMPATIBLE_API_KEY", "ANTHROPIC_COMPATIBLE_BASE_URL"]);
    expect(report.results.find((result: any) => result.id === "openai-compatible").missing).toEqual(["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"]);
    expect(report.results.find((result: any) => result.id === "github-models").missing).toEqual([]);
    expect(report.results.find((result: any) => result.id === "github-models").reason).toContain("Model-list checks are not supported");
    expect(report.results.find((result: any) => result.id === "minimax").missing).toEqual(["MINIMAX_API_KEY"]);
    expect(report.results.find((result: any) => result.id === "azure-openai").missing).toEqual(["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL"]);
    expect(report.results.find((result: any) => result.id === "deepseek").missing).toEqual(["DEEPSEEK_API_KEY"]);
    expect(report.results.find((result: any) => result.id === "sambanova-anthropic").missing).toEqual(["SAMBANOVA_ANTHROPIC_API_KEY"]);
    expect(report.results.find((result: any) => result.id === "ollama").missing).toEqual(["OLLAMA_BASE_URL"]);
    expect(report.results.find((result: any) => result.id === "lm-studio").missing).toEqual(["LM_STUDIO_BASE_URL"]);
  });

  it("lists live provider cases and environment variables", async () => {
    const report = await runLive(["--list", "--json"], scrubProviderEnv());

    expect(report).toMatchObject({
      liveProviderCases: true,
      count: ALL_LIVE_CASE_IDS.length
    });
    expect(report.cases.map((entry: any) => entry.id)).toEqual(ALL_LIVE_CASE_IDS);
    expect(report.cases.find((entry: any) => entry.id === "openai-compatible")).toMatchObject({
      profile: "openai-compatible",
      protocol: "openai_chat",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      modelEnv: "OPENAI_COMPATIBLE_MODEL",
      baseURLEnv: "OPENAI_COMPATIBLE_BASE_URL",
      headersEnv: "OPENAI_COMPATIBLE_HEADERS_JSON",
      bodyExtraEnv: "OPENAI_COMPATIBLE_BODY_EXTRA_JSON",
      requireBaseURL: true,
      allowLocalNoAuth: true,
      modelList: true,
      imageInput: true,
      pdfInput: false
    });
    expect(report.cases.find((entry: any) => entry.id === "anthropic-compatible")).toMatchObject({
      protocol: "anthropic_messages",
      apiKeyEnv: "ANTHROPIC_COMPATIBLE_API_KEY",
      modelEnv: "ANTHROPIC_COMPATIBLE_MODEL",
      baseURLEnv: "ANTHROPIC_COMPATIBLE_BASE_URL",
      imageInput: true,
      pdfInput: false
    });
    expect(report.cases.find((entry: any) => entry.id === "openai")).toMatchObject({
      imageInput: true,
      pdfInput: true
    });
    expect(report.cases.find((entry: any) => entry.id === "gemini")).toMatchObject({
      protocol: "openai_chat",
      imageInput: true,
      pdfInput: false
    });
    expect(report.cases.find((entry: any) => entry.id === "github-models")).toMatchObject({
      modelList: false
    });
    expect(report.cases.find((entry: any) => entry.id === "ollama")).toMatchObject({
      profile: "ollama",
      protocol: "openai_chat",
      apiKeyEnv: "OLLAMA_API_KEY",
      modelEnv: "OLLAMA_MODEL",
      baseURLEnv: "OLLAMA_BASE_URL",
      apiKeyOptional: true,
      requireBaseURL: true,
      allowLocalNoAuth: true
    });
    expect(report.cases.find((entry: any) => entry.id === "lm-studio")).toMatchObject({
      profile: "lm-studio",
      apiKeyEnv: "LM_STUDIO_API_KEY",
      modelEnv: "LM_STUDIO_MODEL",
      baseURLEnv: "LM_STUDIO_BASE_URL",
      apiKeyOptional: true,
      requireBaseURL: true,
      allowLocalNoAuth: true
    });

    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/verify-provider-live.mjs",
      "--list",
      "--include",
      "openai,gemini,anthropic-compatible"
    ], {
      cwd: process.cwd(),
      env: scrubProviderEnv()
    });
    expect(stdout).toContain("id\tprotocol\timageInput\tpdfInput\tmodelList\tapiKeyEnv\tmodelEnv\tbaseURLEnv\theadersEnv\tbodyExtraEnv");
    expect(stdout).toContain("openai\topenai_responses\tyes\tyes\tyes\tOPENAI_API_KEY\tOPENAI_MODEL\tOPENAI_BASE_URL\tOPENAI_HEADERS_JSON\tOPENAI_BODY_EXTRA_JSON");
    expect(stdout).toContain("gemini\topenai_chat\tyes\tno\tyes\tGEMINI_API_KEY\tGEMINI_MODEL\tGEMINI_BASE_URL\tGEMINI_HEADERS_JSON\tGEMINI_BODY_EXTRA_JSON");
    expect(stdout).toContain("anthropic-compatible\tanthropic_messages\tyes\tno\tyes\tANTHROPIC_COMPATIBLE_API_KEY\tANTHROPIC_COMPATIBLE_MODEL\tANTHROPIC_COMPATIBLE_BASE_URL\tANTHROPIC_COMPATIBLE_HEADERS_JSON\tANTHROPIC_COMPATIBLE_BODY_EXTRA_JSON");
  });

  it("prints live provider environment templates", async () => {
    const report = await runLive(["--env-template", "--include", "openai-compatible,anthropic-compatible,ollama,lm-studio", "--json"], scrubProviderEnv());

    expect(report).toMatchObject({
      liveProviderEnvTemplate: true,
      count: 4
    });
    const openaiCompatible = report.cases.find((entry: any) => entry.id === "openai-compatible");
    expect(openaiCompatible).toMatchObject({
      protocol: "openai_chat",
      requiredEnv: ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_MODEL", "OPENAI_COMPATIBLE_BASE_URL"],
      requiredEnvValues: {
        OPENAI_COMPATIBLE_API_KEY: "...",
        OPENAI_COMPATIBLE_MODEL: "...",
        OPENAI_COMPATIBLE_BASE_URL: "https://api.openai.com/v1"
      },
      modelListRequiredEnv: ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"],
      modelListRequiredEnvValues: {
        OPENAI_COMPATIBLE_API_KEY: "...",
        OPENAI_COMPATIBLE_BASE_URL: "https://api.openai.com/v1"
      },
      generationCommand: "npm run verify:provider:live -- --include openai-compatible",
      imageCommand: "npm run verify:provider:image:live -- --include openai-compatible",
      pdfCommand: "",
      modelListCommand: "npm run verify:provider:models:live -- --include openai-compatible"
    });
    expect(openaiCompatible.optionalEnv).toEqual(["OPENAI_COMPATIBLE_HEADERS_JSON", "OPENAI_COMPATIBLE_BODY_EXTRA_JSON"]);
    expect(openaiCompatible.optionalEnvValues).toEqual({
      OPENAI_COMPATIBLE_HEADERS_JSON: "{}",
      OPENAI_COMPATIBLE_BODY_EXTRA_JSON: "{}"
    });
    const anthropicCompatible = report.cases.find((entry: any) => entry.id === "anthropic-compatible");
    expect(anthropicCompatible.requiredEnv).toEqual(["ANTHROPIC_COMPATIBLE_API_KEY", "ANTHROPIC_COMPATIBLE_MODEL", "ANTHROPIC_COMPATIBLE_BASE_URL"]);
    expect(anthropicCompatible.requiredEnvValues).toEqual({
      ANTHROPIC_COMPATIBLE_API_KEY: "...",
      ANTHROPIC_COMPATIBLE_MODEL: "...",
      ANTHROPIC_COMPATIBLE_BASE_URL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT"
    });
    expect(anthropicCompatible.modelListRequiredEnv).toEqual(["ANTHROPIC_COMPATIBLE_API_KEY", "ANTHROPIC_COMPATIBLE_BASE_URL"]);
    expect(anthropicCompatible.imageCommand).toBe("npm run verify:provider:image:live -- --include anthropic-compatible");
    expect(anthropicCompatible.pdfCommand).toBe("");
    const ollama = report.cases.find((entry: any) => entry.id === "ollama");
    expect(ollama.requiredEnv).toEqual(["OLLAMA_MODEL", "OLLAMA_BASE_URL"]);
    expect(ollama.requiredEnvValues).toEqual({
      OLLAMA_MODEL: "...",
      OLLAMA_BASE_URL: "http://localhost:11434/v1"
    });
    expect(ollama.modelListRequiredEnv).toEqual(["OLLAMA_BASE_URL"]);
    expect(ollama.optionalEnv).toEqual(["OLLAMA_API_KEY", "OLLAMA_HEADERS_JSON", "OLLAMA_BODY_EXTRA_JSON"]);
    expect(ollama.generationCommand).toBe("npm run verify:provider:live -- --include ollama");
    expect(ollama.imageCommand).toBe("npm run verify:provider:image:live -- --include ollama");
    expect(ollama.pdfCommand).toBe("");
    const lmStudio = report.cases.find((entry: any) => entry.id === "lm-studio");
    expect(lmStudio.requiredEnv).toEqual(["LM_STUDIO_MODEL", "LM_STUDIO_BASE_URL"]);
    expect(lmStudio.modelListRequiredEnv).toEqual(["LM_STUDIO_BASE_URL"]);
    expect(lmStudio.optionalEnv).toEqual(["LM_STUDIO_API_KEY", "LM_STUDIO_HEADERS_JSON", "LM_STUDIO_BODY_EXTRA_JSON"]);

    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/verify-provider-live.mjs",
      "--env-template",
      "--include",
      "anthropic-compatible"
    ], {
      cwd: process.cwd(),
      env: scrubProviderEnv()
    });
    expect(stdout).toContain("Provider live verification env templates:");
    expect(stdout).toContain("ANTHROPIC_COMPATIBLE_API_KEY=...");
    expect(stdout).toContain("ANTHROPIC_COMPATIBLE_BASE_URL=https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT");
    expect(stdout).toContain("# ANTHROPIC_COMPATIBLE_HEADERS_JSON={}");
    expect(stdout).toContain("npm run verify:provider:live -- --include anthropic-compatible");
    expect(stdout).toContain("# Image input check");
    expect(stdout).toContain("npm run verify:provider:image:live -- --include anthropic-compatible");
  });

  it("runs live provider env checks against mock endpoints without leaking secrets", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", BASIC_LIVE_CASES, "--json"], scrubProviderEnv({
        OPENAI_API_KEY: "live-openai-secret",
        OPENAI_MODEL: "live-responses",
        OPENAI_BASE_URL: `${baseURL}/v1`,
        OPENAI_RESPONSES_COMPATIBLE_API_KEY: "live-responses-compatible-secret",
        OPENAI_RESPONSES_COMPATIBLE_MODEL: "live-responses-compatible",
        OPENAI_RESPONSES_COMPATIBLE_BASE_URL: `${baseURL}/v1`,
        ANTHROPIC_API_KEY: "live-anthropic-secret",
        ANTHROPIC_MODEL: "live-anthropic",
        ANTHROPIC_BASE_URL: baseURL,
        ANTHROPIC_COMPATIBLE_API_KEY: "live-anthropic-compatible-secret",
        ANTHROPIC_COMPATIBLE_MODEL: "live-anthropic-compatible",
        ANTHROPIC_COMPATIBLE_BASE_URL: baseURL,
        OPENAI_COMPATIBLE_API_KEY: "live-compatible-secret",
        OPENAI_COMPATIBLE_MODEL: "live-compatible",
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        counts: {
          passed: 5,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results.map((result: any) => [result.id, result.report.text])).toEqual([
        ["openai", "OK live responses"],
        ["openai-responses-compatible", "OK live responses"],
        ["anthropic", "OK live anthropic"],
        ["anthropic-compatible", "OK live anthropic"],
        ["openai-compatible", "OK live chat"]
      ]);
      expect(requests.map((request) => request.path)).toEqual([
        "/v1/responses",
        "/v1/responses",
        "/v1/messages",
        "/v1/messages",
        "/v1/chat/completions"
      ]);
      expect(requests[0].authorization).toBe("Bearer live-openai-secret");
      expect(requests[1].authorization).toBe("Bearer live-responses-compatible-secret");
      expect(requests[2].xApiKey).toBe("live-anthropic-secret");
      expect(requests[3].authorization).toBe("Bearer live-anthropic-compatible-secret");
      expect(requests[3].xApiKey).toBeUndefined();
      expect(requests[4].authorization).toBe("Bearer live-compatible-secret");
      expect(JSON.stringify(report)).not.toContain("live-openai-secret");
      expect(JSON.stringify(report)).not.toContain("live-responses-compatible-secret");
      expect(JSON.stringify(report)).not.toContain("live-anthropic-secret");
      expect(JSON.stringify(report)).not.toContain("live-anthropic-compatible-secret");
      expect(JSON.stringify(report)).not.toContain("live-compatible-secret");
    });
  });

  it("loads live provider credentials from a local env file without leaking secrets", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const tempDir = mkdtempSync(join(tmpdir(), "zms-provider-env-"));
      const envPath = join(tempDir, ".env.local");
      try {
        writeFileSync(envPath, [
          "# local live check config",
          "OPENAI_COMPATIBLE_API_KEY=env-file-compatible-secret",
          "OPENAI_COMPATIBLE_MODEL=env-file-model",
          `OPENAI_COMPATIBLE_BASE_URL=${baseURL}/v1`,
          "OPENAI_COMPATIBLE_HEADERS_JSON={\"X-Router\":\"env-file-header-secret\"}",
          ""
        ].join("\n"));

        const report = await runLive([
          "--include",
          "openai-compatible",
          "--env-file",
          envPath,
          "--json"
        ], scrubProviderEnv({
          OPENAI_COMPATIBLE_MODEL: "shell-model"
        }));

        expect(report).toMatchObject({
          ok: true,
          live: true,
          envFileLoaded: true,
          counts: {
            passed: 1,
            skipped: 0,
            failed: 0
          }
        });
        expect(requests).toHaveLength(1);
        expect(requests[0].authorization).toBe("Bearer env-file-compatible-secret");
        expect(requests[0].xRouter).toBe("env-file-header-secret");
        expect(requests[0].body.model).toBe("shell-model");
        expect(JSON.stringify(report)).not.toContain("env-file-compatible-secret");
        expect(JSON.stringify(report)).not.toContain("env-file-header-secret");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  it("runs named mainstream provider live checks against mock endpoints", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", NAMED_LIVE_CASES, "--json"], scrubProviderEnv(namedProviderEnv(baseURL)));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        counts: {
          passed: NAMED_LIVE_CASE_IDS.length,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results.map((result: any) => [result.id, result.report.protocol, result.report.text])).toEqual([
        ...NAMED_LIVE_SPECS.map((entry) => [entry.id, entry.protocol, liveTextForProtocol(entry.protocol)])
      ]);
      expect(requests.map((request) => request.path)).toEqual(
        NAMED_LIVE_SPECS.map((entry) => namedLiveRequestPath(entry))
      );
      const githubRequest = requests[NAMED_LIVE_CASE_IDS.indexOf("github-models")];
      expect(githubRequest.authorization).toBe("Bearer live-github-secret");
      expect(githubRequest.accept).toBe("application/vnd.github+json");
      expect(githubRequest.githubApiVersion).toBe("2022-11-28");
      for (const entry of NAMED_LIVE_SPECS.filter((item) => item.protocol === "anthropic_messages")) {
        const request = requests[NAMED_LIVE_CASE_IDS.indexOf(entry.id)];
        expect(request.authorization).toBe(`Bearer ${entry.secret}`);
        expect(request.xApiKey).toBeUndefined();
      }
      for (const entry of NAMED_LIVE_SPECS) {
        expect(JSON.stringify(report)).not.toContain(entry.secret);
      }
    });
  });

  it("runs named local provider live checks without API credentials", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", "ollama,lm-studio", "--json"], scrubProviderEnv({
        OLLAMA_MODEL: "llama3.1",
        OLLAMA_BASE_URL: `${baseURL}/ollama/v1`,
        LM_STUDIO_MODEL: "local-model",
        LM_STUDIO_BASE_URL: `${baseURL}/lm-studio/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        counts: {
          passed: 2,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results.map((result: any) => [result.id, result.report.text])).toEqual([
        ["ollama", "OK live chat"],
        ["lm-studio", "OK live chat"]
      ]);
      expect(requests.map((request) => [request.path, request.authorization, request.body.model])).toEqual([
        ["/ollama/v1/chat/completions", undefined, "llama3.1"],
        ["/lm-studio/v1/chat/completions", undefined, "local-model"]
      ]);
    });
  });

  it("runs live provider stream checks against mock endpoints", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", BASIC_LIVE_CASES, "--stream", "--json"], scrubProviderEnv({
        OPENAI_API_KEY: "live-openai-stream-secret",
        OPENAI_MODEL: "live-responses-stream",
        OPENAI_BASE_URL: `${baseURL}/v1`,
        OPENAI_RESPONSES_COMPATIBLE_API_KEY: "live-responses-compatible-stream-secret",
        OPENAI_RESPONSES_COMPATIBLE_MODEL: "live-responses-compatible-stream",
        OPENAI_RESPONSES_COMPATIBLE_BASE_URL: `${baseURL}/v1`,
        ANTHROPIC_API_KEY: "live-anthropic-stream-secret",
        ANTHROPIC_MODEL: "live-anthropic-stream",
        ANTHROPIC_BASE_URL: baseURL,
        ANTHROPIC_COMPATIBLE_API_KEY: "live-anthropic-compatible-stream-secret",
        ANTHROPIC_COMPATIBLE_MODEL: "live-anthropic-compatible-stream",
        ANTHROPIC_COMPATIBLE_BASE_URL: baseURL,
        OPENAI_COMPATIBLE_API_KEY: "live-compatible-stream-secret",
        OPENAI_COMPATIBLE_MODEL: "live-compatible-stream",
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        stream: true,
        counts: {
          passed: 5,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results.map((result: any) => [result.id, result.report.stream, result.report.text])).toEqual([
        ["openai", true, "OK live responses"],
        ["openai-responses-compatible", true, "OK live responses"],
        ["anthropic", true, "OK live anthropic"],
        ["anthropic-compatible", true, "OK live anthropic"],
        ["openai-compatible", true, "OK live chat"]
      ]);
      expect(requests.map((request) => [request.path, request.body.stream])).toEqual([
        ["/v1/responses", true],
        ["/v1/responses", true],
        ["/v1/messages", true],
        ["/v1/messages", true],
        ["/v1/chat/completions", true]
      ]);
      expect(JSON.stringify(report)).not.toContain("live-openai-stream-secret");
      expect(JSON.stringify(report)).not.toContain("live-anthropic-stream-secret");
      expect(JSON.stringify(report)).not.toContain("live-compatible-stream-secret");
    });
  });

  it("runs live provider image checks against mock endpoints", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", BASIC_LIVE_CASES, "--image", "--json"], scrubProviderEnv({
        OPENAI_API_KEY: "live-openai-image-secret",
        OPENAI_MODEL: "live-responses-image",
        OPENAI_BASE_URL: `${baseURL}/v1`,
        OPENAI_RESPONSES_COMPATIBLE_API_KEY: "live-responses-compatible-image-secret",
        OPENAI_RESPONSES_COMPATIBLE_MODEL: "live-responses-compatible-image",
        OPENAI_RESPONSES_COMPATIBLE_BASE_URL: `${baseURL}/v1`,
        ANTHROPIC_API_KEY: "live-anthropic-image-secret",
        ANTHROPIC_MODEL: "live-anthropic-image",
        ANTHROPIC_BASE_URL: baseURL,
        ANTHROPIC_COMPATIBLE_API_KEY: "live-anthropic-compatible-image-secret",
        ANTHROPIC_COMPATIBLE_MODEL: "live-anthropic-compatible-image",
        ANTHROPIC_COMPATIBLE_BASE_URL: baseURL,
        OPENAI_COMPATIBLE_API_KEY: "live-compatible-image-secret",
        OPENAI_COMPATIBLE_MODEL: "live-compatible-image",
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        inputMode: "image",
        counts: {
          passed: 5,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results.map((result: any) => [result.id, result.report.inputMode, result.report.contentTypes])).toEqual([
        ["openai", "image", ["input_text", "input_text", "input_image"]],
        ["openai-responses-compatible", "image", ["input_text", "input_text", "input_image"]],
        ["anthropic", "image", ["image", "text"]],
        ["anthropic-compatible", "image", ["image", "text"]],
        ["openai-compatible", "image", ["text", "image_url"]]
      ]);
      expect(requests.map((request) => request.path)).toEqual([
        "/v1/responses",
        "/v1/responses",
        "/v1/messages",
        "/v1/messages",
        "/v1/chat/completions"
      ]);
      expect(JSON.stringify(report)).not.toContain("live-openai-image-secret");
      expect(JSON.stringify(report)).not.toContain("live-anthropic-image-secret");
    });
  });

  it("runs live provider PDF checks against raw-document protocols and skips OpenAI Chat", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", BASIC_LIVE_CASES, "--pdf", "--json"], scrubProviderEnv({
        OPENAI_API_KEY: "live-openai-pdf-secret",
        OPENAI_MODEL: "live-responses-pdf",
        OPENAI_BASE_URL: `${baseURL}/v1`,
        OPENAI_RESPONSES_COMPATIBLE_API_KEY: "live-responses-compatible-pdf-secret",
        OPENAI_RESPONSES_COMPATIBLE_MODEL: "live-responses-compatible-pdf",
        OPENAI_RESPONSES_COMPATIBLE_BASE_URL: `${baseURL}/v1`,
        ANTHROPIC_API_KEY: "live-anthropic-pdf-secret",
        ANTHROPIC_MODEL: "live-anthropic-pdf",
        ANTHROPIC_BASE_URL: baseURL,
        ANTHROPIC_COMPATIBLE_API_KEY: "live-anthropic-compatible-pdf-secret",
        ANTHROPIC_COMPATIBLE_MODEL: "live-anthropic-compatible-pdf",
        ANTHROPIC_COMPATIBLE_BASE_URL: baseURL,
        OPENAI_COMPATIBLE_API_KEY: "live-compatible-pdf-secret",
        OPENAI_COMPATIBLE_MODEL: "live-compatible-pdf",
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        inputMode: "pdf",
        counts: {
          passed: 4,
          skipped: 1,
          failed: 0
        }
      });
      expect(report.results.map((result: any) => [result.id, result.status])).toEqual([
        ["openai", "passed"],
        ["openai-responses-compatible", "passed"],
        ["anthropic", "passed"],
        ["anthropic-compatible", "passed"],
        ["openai-compatible", "skipped"]
      ]);
      expect(report.results.at(-1).reason).toContain("OpenAI-compatible Chat profiles use extracted text input");
      expect(report.results.slice(0, 4).map((result: any) => [result.id, result.report.inputMode, result.report.contentTypes])).toEqual([
        ["openai", "pdf", ["input_file", "input_text"]],
        ["openai-responses-compatible", "pdf", ["input_file", "input_text"]],
        ["anthropic", "pdf", ["document", "text"]],
        ["anthropic-compatible", "pdf", ["document", "text"]]
      ]);
      expect(requests.map((request) => request.path)).toEqual([
        "/v1/responses",
        "/v1/responses",
        "/v1/messages",
        "/v1/messages"
      ]);
      expect(JSON.stringify(report)).not.toContain("live-openai-pdf-secret");
      expect(JSON.stringify(report)).not.toContain("live-anthropic-pdf-secret");
    });
  });

  it("rejects live model-list checks with generation input flags", async () => {
    await expect(execFileAsync(process.execPath, [
      "scripts/verify-provider-live.mjs",
      "--models",
      "--image",
      "--json"
    ], {
      cwd: process.cwd(),
      env: scrubProviderEnv(),
      maxBuffer: 1024 * 1024
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("--image and --pdf verify generation inputs")
    });
  });

  it("rejects live model-list checks with streaming output flags", async () => {
    await expect(execFileAsync(process.execPath, [
      "scripts/verify-provider-live.mjs",
      "--models",
      "--stream",
      "--json"
    ], {
      cwd: process.cwd(),
      env: scrubProviderEnv(),
      maxBuffer: 1024 * 1024
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("--stream verifies generation output")
    });
  });

  it("runs live provider model-list env checks against mock endpoints without model env vars", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", BASIC_LIVE_CASES, "--models", "--json"], scrubProviderEnv({
        OPENAI_API_KEY: "live-openai-models-secret",
        OPENAI_BASE_URL: `${baseURL}/v1`,
        OPENAI_RESPONSES_COMPATIBLE_API_KEY: "live-responses-compatible-models-secret",
        OPENAI_RESPONSES_COMPATIBLE_BASE_URL: `${baseURL}/v1`,
        ANTHROPIC_API_KEY: "live-anthropic-models-secret",
        ANTHROPIC_BASE_URL: baseURL,
        ANTHROPIC_COMPATIBLE_API_KEY: "live-anthropic-compatible-models-secret",
        ANTHROPIC_COMPATIBLE_BASE_URL: baseURL,
        OPENAI_COMPATIBLE_API_KEY: "live-compatible-models-secret",
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        models: true,
        counts: {
          passed: 5,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results.map((result: any) => [result.id, result.report.modelCount])).toEqual([
        ["openai", 2],
        ["openai-responses-compatible", 2],
        ["anthropic", 2],
        ["anthropic-compatible", 2],
        ["openai-compatible", 2]
      ]);
      expect(requests.map((request) => request.path)).toEqual([
        "/v1/models",
        "/v1/models",
        "/v1/models",
        "/v1/models",
        "/v1/models"
      ]);
      expect(requests[0].authorization).toBe("Bearer live-openai-models-secret");
      expect(requests[1].authorization).toBe("Bearer live-responses-compatible-models-secret");
      expect(requests[2].xApiKey).toBe("live-anthropic-models-secret");
      expect(requests[3].authorization).toBe("Bearer live-anthropic-compatible-models-secret");
      expect(requests[3].xApiKey).toBeUndefined();
      expect(requests[4].authorization).toBe("Bearer live-compatible-models-secret");
      expect(JSON.stringify(report)).not.toContain("live-openai-models-secret");
      expect(JSON.stringify(report)).not.toContain("live-responses-compatible-models-secret");
      expect(JSON.stringify(report)).not.toContain("live-anthropic-models-secret");
      expect(JSON.stringify(report)).not.toContain("live-anthropic-compatible-models-secret");
      expect(JSON.stringify(report)).not.toContain("live-compatible-models-secret");
    });
  });

  it("runs live OpenAI-compatible checks against local endpoints without API credentials", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", "openai-compatible", "--json"], scrubProviderEnv({
        OPENAI_COMPATIBLE_MODEL: "local-compatible",
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        counts: {
          passed: 1,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results[0]).toMatchObject({
        id: "openai-compatible",
        status: "passed",
        skipped: false
      });
      expect(report.results[0].report).toMatchObject({
        protocol: "openai_chat",
        text: "OK live chat"
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBeUndefined();
      expect(requests[0].body.model).toBe("local-compatible");
    });
  });

  it("runs live OpenAI-compatible model-list checks against local endpoints without API credentials or model names", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--models", "--include", "openai-compatible", "--json"], scrubProviderEnv({
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        models: true,
        counts: {
          passed: 1,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results[0]).toMatchObject({
        id: "openai-compatible",
        status: "passed",
        skipped: false
      });
      expect(report.results[0].report).toMatchObject({
        protocol: "openai_chat",
        modelCount: 2
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBeUndefined();
      expect(requests[0].body).toEqual({});
    });
  });

  it("runs live OpenAI Responses-compatible checks against local endpoints without API credentials", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--include", "openai-responses-compatible", "--json"], scrubProviderEnv({
        OPENAI_RESPONSES_COMPATIBLE_MODEL: "local-responses-compatible",
        OPENAI_RESPONSES_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        counts: {
          passed: 1,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results[0]).toMatchObject({
        id: "openai-responses-compatible",
        status: "passed",
        skipped: false
      });
      expect(report.results[0].report).toMatchObject({
        protocol: "openai_responses",
        text: "OK live responses"
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBeUndefined();
      expect(requests[0].body.model).toBe("local-responses-compatible");
    });
  });

  it("runs live OpenAI Responses-compatible model-list checks against local endpoints without API credentials or model names", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive(["--models", "--include", "openai-responses-compatible", "--json"], scrubProviderEnv({
        OPENAI_RESPONSES_COMPATIBLE_BASE_URL: `${baseURL}/v1`
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        models: true,
        counts: {
          passed: 1,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results[0]).toMatchObject({
        id: "openai-responses-compatible",
        status: "passed",
        skipped: false
      });
      expect(report.results[0].report).toMatchObject({
        protocol: "openai_responses",
        modelCount: 2
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBeUndefined();
      expect(requests[0].body).toEqual({});
    });
  });

  it("passes live body-extra settings from env and CLI into generation smoke checks", async () => {
    await withLiveMockProvider(async (baseURL, requests) => {
      const report = await runLive([
        "--include", "openai-compatible",
        "--stream",
        "--header", "x-global=from-cli",
        "--body-extra-json", JSON.stringify({ metadata: { suite: "live-smoke" } }),
        "--json"
      ], scrubProviderEnv({
        OPENAI_COMPATIBLE_API_KEY: "live-compatible-body-extra-secret",
        OPENAI_COMPATIBLE_MODEL: "live-compatible-body-extra",
        OPENAI_COMPATIBLE_BASE_URL: `${baseURL}/v1`,
        OPENAI_COMPATIBLE_HEADERS_JSON: JSON.stringify({
          Authorization: "Bearer compatible-header-secret",
          "x-router": "paper-router"
        }),
        OPENAI_COMPATIBLE_BODY_EXTRA_JSON: JSON.stringify({
          response_format: { type: "json_object" },
          omitFields: ["stream", "temperature", "max_tokens"]
        })
      }));

      expect(report).toMatchObject({
        ok: true,
        live: true,
        stream: true,
        counts: {
          passed: 1,
          skipped: 0,
          failed: 0
        }
      });
      expect(report.results[0]).toMatchObject({
        id: "openai-compatible",
        status: "passed",
        report: {
          stream: false,
          text: "OK live chat"
        }
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toMatchObject({
        model: "live-compatible-body-extra",
        metadata: { suite: "live-smoke" },
        response_format: { type: "json_object" }
      });
      expect(requests[0].body).not.toHaveProperty("stream");
      expect(requests[0].body).not.toHaveProperty("temperature");
      expect(requests[0].body).not.toHaveProperty("max_tokens");
      expect(requests[0].body).not.toHaveProperty("omitFields");
      expect(requests[0].authorization).toBe("Bearer compatible-header-secret");
      expect(requests[0].xRouter).toBe("paper-router");
      expect(requests[0].xGlobal).toBe("from-cli");
      expect(JSON.stringify(report)).not.toContain("live-compatible-body-extra-secret");
      expect(JSON.stringify(report)).not.toContain("compatible-header-secret");
    });
  });

  it("uses live custom auth headers to satisfy remote credential requirements", async () => {
    const report = await runLive([
      "--include", "openai-compatible",
      "--dry-run",
      "--json"
    ], scrubProviderEnv({
      OPENAI_COMPATIBLE_MODEL: "remote-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://router.example/v1",
      OPENAI_COMPATIBLE_HEADERS_JSON: JSON.stringify({
        Authorization: "Bearer remote-header-secret",
        "x-router": "paper-router"
      })
    }));

    expect(report).toMatchObject({
      ok: true,
      live: true,
      dryRun: true,
      counts: {
        passed: 1,
        skipped: 0,
        failed: 0
      }
    });
    expect(report.results[0]).toMatchObject({
      id: "openai-compatible",
      status: "passed",
      report: {
        dryRun: true,
        endpoint: "https://router.example/v1/chat/completions"
      }
    });
    expect(report.results[0].report.request.headerNames).toEqual(expect.arrayContaining(["Authorization", "content-type", "x-router"]));
    expect(JSON.stringify(report)).not.toContain("remote-header-secret");
  });
});

async function runSmoke(args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/verify-provider-smoke.mjs", ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function runLive(args: string[], env: NodeJS.ProcessEnv) {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/verify-provider-live.mjs", ...args], {
    cwd: process.cwd(),
    env,
    maxBuffer: 1024 * 1024
  });
  return JSON.parse(stdout);
}

function namedProviderEnv(baseURL: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of NAMED_LIVE_SPECS) {
    env[`${entry.envPrefix}_API_KEY`] = entry.secret;
    env[`${entry.envPrefix}_MODEL`] = entry.model;
    env[`${entry.envPrefix}_BASE_URL`] = `${baseURL}${entry.basePath}`;
  }
  return env;
}

function namedLiveRequestPath(entry: { id: string; protocol: string; basePath: string }) {
  if (entry.protocol === "openai_responses") return `${entry.basePath}/responses`;
  if (entry.protocol === "anthropic_messages") return `${entry.basePath}/v1/messages`;
  if (["github-models", "perplexity", "deepseek"].includes(entry.id)) {
    return `${entry.basePath}/v1/chat/completions`;
  }
  return `${entry.basePath}/chat/completions`;
}

function liveTextForProtocol(protocol: string) {
  if (protocol === "openai_responses") return "OK live responses";
  if (protocol === "anthropic_messages") return "OK live anthropic";
  return "OK live chat";
}

function scrubProviderEnv(overrides: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const prefixes = [
    "OPENAI",
    "OPENAI_RESPONSES_COMPATIBLE",
    "ANTHROPIC",
    "ANTHROPIC_COMPATIBLE",
    "OPENAI_COMPATIBLE",
    ...NAMED_LIVE_SPECS.map((entry) => entry.envPrefix)
  ];
  for (const prefix of prefixes) {
    env[`${prefix}_API_KEY`] = "";
    env[`${prefix}_MODEL`] = "";
    env[`${prefix}_BASE_URL`] = "";
    env[`${prefix}_HEADERS_JSON`] = "";
    env[`${prefix}_BODY_EXTRA_JSON`] = "";
  }
  return { ...env, ...overrides };
}

async function withMockProvider(
  run: (baseURL: string, requests: any[]) => Promise<void>,
  options: { responseBody?: any; status?: number; handler?: (requestData: any, response: any) => void } = {}
) {
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    const bodyText = await readRequestBody(request);
    const requestData = {
      method: request.method,
      path: new URL(request.url || "/", "http://127.0.0.1").pathname,
      authorization: request.headers.authorization,
      xApiKey: request.headers["x-api-key"],
      anthropicVersion: request.headers["anthropic-version"],
      body: bodyText ? JSON.parse(bodyText) : {}
    };
    requests.push(requestData);
    if (options.handler) {
      options.handler(requestData, response);
      return;
    }
    response.writeHead(options.status || 200, { "content-type": "application/json" });
    response.end(JSON.stringify(options.responseBody || { choices: [{ message: { content: "OK" } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock provider server did not bind to a TCP port");
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function withLiveMockProvider(
  run: (baseURL: string, requests: any[]) => Promise<void>
) {
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    const bodyText = await readRequestBody(request);
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const body = bodyText ? JSON.parse(bodyText) : {};
    requests.push({
      method: request.method,
      path,
      authorization: request.headers.authorization,
      xApiKey: request.headers["x-api-key"],
      accept: request.headers.accept,
      githubApiVersion: request.headers["x-github-api-version"],
      xRouter: request.headers["x-router"],
      xGlobal: request.headers["x-global"],
      body
    });
    if (body?.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(liveMockStreamResponse(path));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(liveMockResponse(path)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock provider server did not bind to a TCP port");
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function liveMockResponse(path: string) {
  if (path.endsWith("/models")) {
    return {
      result: {
        data: [
          { id: "live-model-a", display_name: "Live Model A" },
          { id: "live-model-b", display_name: "Live Model B" }
        ],
        has_more: false
      }
    };
  }
  if (path.endsWith("/responses")) return { output_text: "OK live responses" };
  if (path.endsWith("/messages")) return { content: [{ type: "text", text: "OK live anthropic" }] };
  return { choices: [{ message: { content: "OK live chat" } }] };
}

function liveMockStreamResponse(path: string) {
  if (path.endsWith("/responses")) {
    return [
      "event: response.output_text.delta",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK live \"}",
      "",
      "event: response.output_text.delta",
      "data: {",
      "data: \"type\":\"response.output_text.delta\",",
      "data: \"delta\":\"responses\"",
      "data: }",
      "",
      "data: [DONE]",
      ""
    ].join("\n");
  }
  if (path.endsWith("/messages")) {
    return [
      "event: content_block_delta",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"OK live \"}}",
      "",
      "event: content_block_delta",
      "data: {",
      "data: \"type\":\"content_block_delta\",",
      "data: \"delta\":{\"type\":\"text_delta\",\"text\":\"anthropic\"}",
      "data: }",
      "",
      "data: [DONE]",
      ""
    ].join("\n");
  }
  return [
    "data: {\"choices\":[{\"delta\":{\"content\":\"OK live \"}}]}",
    "data: {\"choices\":[{\"delta\":{\"content\":\"chat\"}}]}",
    "data: [DONE]",
    ""
  ].join("\n");
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
