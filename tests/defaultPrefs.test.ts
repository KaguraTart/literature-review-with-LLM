import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function defaultProfiles() {
  const prefs = readFileSync("addon/prefs.js", "utf8");
  const match = prefs.match(/pref\("profilesJson",\s*"((?:\\"|[^"])*)"\);/);
  if (!match) throw new Error("profilesJson pref not found");
  return JSON.parse(JSON.parse(`"${match[1]}"`));
}

describe("default provider profiles", () => {
  it("does not ship a machine-specific output directory", () => {
    const prefs = readFileSync("addon/prefs.js", "utf8");
    expect(prefs).toContain('pref("outputDir", "")');
    expect(prefs).toContain('pref("autoUpdateEnabled", true)');
    expect(prefs).not.toMatch(/\/Users\/[^/]+\/Library\/CloudStorage/);
    expect(prefs).not.toMatch(/OneDrive-[^/]+\/Zotero_PDFs/);
  });

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
      "vercel-ai-chat",
      "vercel-ai-responses",
      "vercel-ai-anthropic",
      "cline-api",
      "litellm-proxy-chat",
      "litellm-proxy-responses",
      "litellm-proxy-anthropic",
      "cloudflare-ai-chat",
      "cloudflare-ai-responses",
      "cloudflare-ai-anthropic",
      "github-models",
      "huggingface",
      "deepinfra",
      "fireworks",
      "cerebras",
      "nvidia-nim",
      "sambanova",
      "sambanova-responses",
      "sambanova-anthropic",
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
      model: "MiniMax-M3"
    });
    expect(profiles.find((profile: any) => profile.id === "openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-5.4-mini",
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
      model: "claude-sonnet-4-6",
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
      model: "gemini-3.1-pro",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "azure-openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1",
      model: "",
      customHeaders: {},
      capabilities: { pdfBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "vercel-ai-chat")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      capabilities: { pdfBase64: false, imageBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "vercel-ai-responses")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      capabilities: { pdfBase64: true, imageBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "vercel-ai-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh",
      capabilities: { pdfBase64: true, imageBase64: true, streaming: true, modelList: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile: any) => profile.id === "cline-api")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cline.bot/api/v1",
      model: "anthropic/claude-sonnet-4-6",
      capabilities: { pdfBase64: false, imageBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "litellm-proxy-chat")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://localhost:4000",
      model: "openai/gpt-4o-mini",
      capabilities: { pdfBase64: false, imageBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "litellm-proxy-responses")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "http://localhost:4000",
      model: "openai/gpt-4o-mini",
      capabilities: { pdfBase64: true, imageBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "litellm-proxy-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "http://localhost:4000",
      model: "anthropic/claude-sonnet-4-6",
      capabilities: { pdfBase64: true, imageBase64: true, streaming: true, modelList: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile: any) => profile.id === "cloudflare-ai-chat")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { pdfBase64: false, imageBase64: false, streaming: true, modelList: false }
    });
    expect(profiles.find((profile: any) => profile.id === "cloudflare-ai-responses")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { pdfBase64: false, imageBase64: false, streaming: true, modelList: false }
    });
    expect(profiles.find((profile: any) => profile.id === "cloudflare-ai-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { pdfBase64: false, imageBase64: false, streaming: true, modelList: false },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile: any) => profile.id === "github-models")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://models.github.ai/inference",
      customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      capabilities: { pdfBase64: false, streaming: true, modelList: false }
    });
    expect(profiles.find((profile: any) => profile.id === "huggingface")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.huggingface.co/v1",
      capabilities: { pdfBase64: false, imageBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "deepinfra")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepinfra.com/v1/openai",
      capabilities: { pdfBase64: false, imageBase64: true, streaming: true, modelList: true }
    });
    expect(profiles.find((profile: any) => profile.id === "fireworks")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.fireworks.ai/inference/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "cerebras")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.cerebras.ai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "nvidia-nim")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://integrate.api.nvidia.com/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "sambanova")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "sambanova-responses")).toMatchObject({
      protocol: "openai_responses",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(profiles.find((profile: any) => profile.id === "sambanova-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      baseURL: "https://api.sambanova.ai/v1",
      bodyExtra: { authHeader: "authorization" }
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
      model: "deepseek-v4-flash",
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
      model: "",
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
          "check-local-agents": { tool: "check_local_agents" },
          "extract-pdf-pages": { tool: "extract_pdf_pages" }
        }
      }
    });
  });
});
