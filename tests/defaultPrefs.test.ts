import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function defaultProfiles() {
  const prefs = readFileSync("addon/prefs.js", "utf8");
  const match = prefs.match(/pref\("profilesJson",\s*"((?:\\"|[^"])*)"\);/);
  if (!match) throw new Error("profilesJson pref not found");
  return JSON.parse(JSON.parse(`"${match[1]}"`));
}

describe("default provider profiles", () => {
  it("includes mainstream OpenAI and Anthropic profile formats", () => {
    const profiles = defaultProfiles();
    expect(profiles.map((profile: any) => profile.id)).toEqual([
      "minimax",
      "openai",
      "openai-compatible",
      "openai-responses-compatible",
      "anthropic",
      "anthropic-compatible",
      "gemini",
      "azure-openai",
      "xai",
      "groq",
      "mistral",
      "together",
      "kimi",
      "perplexity",
      "deepseek",
      "deepseek-anthropic",
      "zai-anthropic",
      "openrouter",
      "dashscope",
      "siliconflow",
      "zhipu",
      "volcengine",
      "qianfan",
      "hunyuan",
      "ollama",
      "lm-studio",
      "local-agents"
    ]);
    expect(profiles.find((profile: any) => profile.id === "minimax")).toMatchObject({
      isDefault: true,
      model: "MiniMax-M2.7"
    });
    expect(profiles.find((profile: any) => profile.id === "openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      capabilities: { pdfBase64: true, streaming: true }
    });
    expect(profiles.find((profile: any) => profile.id === "openai-compatible")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "openai-responses-compatible")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
      capabilities: { pdfBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      capabilities: { pdfBase64: true, streaming: true }
    });
    expect(profiles.find((profile: any) => profile.id === "anthropic-compatible")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT",
      capabilities: { pdfBase64: false, streaming: true, modelList: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile: any) => profile.id === "gemini")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "azure-openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1",
      customHeaders: {},
      capabilities: { pdfBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "xai")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.x.ai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "groq")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.groq.com/openai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "mistral")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.mistral.ai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "together")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.together.ai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "kimi")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.moonshot.ai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "perplexity")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.perplexity.ai",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "deepseek")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.deepseek.com",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "deepseek-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      baseURL: "https://api.deepseek.com/anthropic",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "zai-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "openrouter")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://openrouter.ai/api/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "dashscope")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "siliconflow")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.siliconflow.com/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "zhipu")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "volcengine")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "qianfan")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://qianfan.baidubce.com/v2",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "hunyuan")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "ollama")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "http://localhost:11434/v1",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "lm-studio")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:1234/v1",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "local-agents")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:3333/v1",
      capabilities: { modelList: false, streaming: false },
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          payloadMode: "jsonrpc",
          "ask-gemini": { tool: "ask_gemini" },
          "ask-claude": { tool: "ask_claude" },
          "ask-opencode": { tool: "ask_opencode" },
          "ask-all-agents": { tool: "ask_all_agents" },
          "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } },
          "check-local-agents": { tool: "check_local_agents" }
        }
      }
    });
  });
});
