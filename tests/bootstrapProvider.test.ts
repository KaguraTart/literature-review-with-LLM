import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadBootstrapProviderHelpers(fetchResponse: any = { output_text: "ok" }, prefOverrides: Record<string, any> = {}) {
  const fetchCalls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const zoteroItems = new Map<number, any>();
  const prefs: Record<string, any> = {
    provider: "minimax",
    baseURL: "https://api.minimaxi.com/v1",
    apiKey: "legacy-secret",
    model: "MiniMax-M2.7",
    profilesJson: "[]",
    activeProfileId: "",
    outputDir: "/out",
    inputMode: "text",
    maxOutputTokens: 8192,
    temperature: 1,
    stream: true,
    summaryVersion: "1",
    outputLanguage: "zh-CN",
    systemPrompt: "system",
    userPrompt: "user",
    ...prefOverrides
  };
  const providerCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-provider.js"), "utf8");
  const settingsCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-settings.js"), "utf8");
  const summaryStoreCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-summary-store.js"), "utf8");
  const zoteroItemCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-zotero-item.js"), "utf8");
  const uiCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-ui.js"), "utf8");
  const code = readFileSync(resolve(process.cwd(), "addon/bootstrap.js"), "utf8");
  const sandbox: any = {
    ZMS_I18N: {},
    Zotero: {
      File: {},
      Items: {
        get: (id: number) => zoteroItems.get(id)
      },
      debug() {},
      Prefs: {
        get: (key: string) => {
          const name = String(key || "").replace(/^extensions\.zoteroMarkdownSummary\./, "");
          return prefs[name];
        }
      },
      Promise: {
        delay: () => Promise.resolve()
      }
    },
    Services: {
      wm: {
        getMostRecentWindow: () => null
      },
      ww: {},
      io: {}
    },
    Cc: {},
    Ci: {},
    PathUtils: {
      join: (...parts: string[]) => parts.filter(Boolean).join("/")
    },
    IOUtils: {
      exists: async () => false,
      makeDirectory: async () => undefined,
      writeUTF8: async () => undefined,
      read: async () => new Uint8Array([37, 80, 68, 70])
    },
    fetch: async (url: string, init: any) => {
      const responseIndex = fetchCalls.length;
      const responsePayload = Array.isArray(fetchResponse?.__responses)
        ? fetchResponse.__responses[Math.min(responseIndex, fetchResponse.__responses.length - 1)]
        : fetchResponse;
      fetchCalls.push({
        url,
        body: JSON.parse(init.body),
        headers: init.headers
      });
      const status = Number(responsePayload?.__status || 200);
      const streamText = responsePayload?.__streamText;
      const streamLines = responsePayload?.__streamLines;
      return {
        ok: status >= 200 && status < 300,
        status,
        body: streamText ? streamFromText(streamText) : streamLines ? streamFromLines(streamLines) : undefined,
        json: async () => responsePayload,
        text: async () => JSON.stringify(responsePayload)
      };
    },
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    console
  };
  const context = createContext(sandbox);
  runInContext(providerCode, context, { filename: "bootstrap-provider.js" });
  runInContext(settingsCode, context, { filename: "bootstrap-settings.js" });
  runInContext(summaryStoreCode, context, { filename: "bootstrap-summary-store.js" });
  runInContext(zoteroItemCode, context, { filename: "bootstrap-zotero-item.js" });
  runInContext(code, context, { filename: "bootstrap.js" });
  runInContext(uiCode, context, { filename: "bootstrap-ui.js" });
  return {
    fetchCalls,
    zoteroItems,
    helpers: context as {
      callOpenAICompatible: (summaryRequest: any, sourceHash: string, nativeOpenAI: boolean) => Promise<any>;
      callAnthropic: (summaryRequest: any, sourceHash: string) => Promise<any>;
      callProvider: (summaryRequest: any, sourceHash: string) => Promise<any>;
      getSettings: () => any;
      normalizedActiveProfile: () => any;
      settingsRequiresModel: (settings: any) => boolean;
      extractOpenAIStreamText: (chunk: any) => string;
      menuItem: (label: string, onCommand: (...args: any[]) => void, options?: Record<string, boolean>) => any;
      regularItemContextAvailable: (context: any) => boolean;
      findMarkdownAttachment: (item: any) => Promise<any>;
      isLocalAgentProfile: (profile: any) => boolean;
      localAgentEndpointForProfile: (profile: any) => string;
      checkLocalAgentBridge: (endpoint: string) => Promise<{ ok: boolean; label: string }>;
      providerErrorText: (status: number, text: string) => string;
      settingsProviderDefaults: (provider: string) => any;
      settingsProviderFromProfile: (profile: any) => string;
      settingsHasUsableAuth: (settings: any) => boolean;
      canUsePdfBase64Input: (settings: any) => boolean;
      buildInput: (pdf: any, pdfPath: string, settings: any) => Promise<any>;
      backupSummaryPath: (path: string, timestamp: string) => string;
      pathExists: (path: string) => Promise<boolean>;
      summaryTitlePrefix: (item: any) => string;
      uniqueRegularItems: (items: any[]) => any[];
      selectedWorkbenchItems: (context?: any) => any[];
      findPdfAttachment: (item: any) => Promise<any>;
      openEmbeddedReader: (payload: any) => boolean;
      summaryPromptsForSettings: (settings: any) => { system: string; user: string };
      promptPackInstruction: (promptPackId: string, outputLanguage: string) => string;
    }
  };
}

function streamFromLines(lines: string[]) {
  return streamFromText(lines.map((line) => `${line}\n`).join(""));
}

function streamFromText(text: string) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

function openAIResponsesSummaryRequest() {
  return {
    provider: "openai",
    protocol: "openai_responses",
    endpointMode: "base_url",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-test-secret",
    model: "m",
    customHeaders: {},
    bodyExtra: {},
    request: {
      system: "system",
      prompt: "prompt",
      input: { type: "text", text: "paper text" },
      temperature: 0.2,
      maxOutputTokens: 1024,
      stream: false
    }
  };
}

function loadBootstrapWithoutPreloadedMessages() {
  const code = readFileSync(resolve(process.cwd(), "addon/bootstrap.js"), "utf8");
  const sandbox: any = {
    Zotero: {
      File: {},
      debug() {},
      Prefs: {
        get: () => "auto"
      },
      Promise: {
        delay: () => Promise.resolve()
      }
    },
    Services: {
      locale: {
        appLocaleAsBCP47: "zh-CN"
      },
      scriptloader: {
        loadSubScript: () => {
          sandbox.ZMS_I18N = {
            "zh-CN": { bootstrap: { openWorkbench: "打开论文聊天工作台" } },
            "en-US": { bootstrap: { openWorkbench: "Open Paper Chat Workbench" } }
          };
          sandbox.zmsResolveUiLanguage = (setting: string, locale: string) =>
            setting === "zh-CN" || setting === "en-US" ? setting : (String(locale || "").startsWith("zh") ? "zh-CN" : "en-US");
        }
      },
      wm: {},
      ww: {},
      io: {}
    },
    Cc: {},
    Ci: {},
    PathUtils: {
      join: (...parts: string[]) => parts.filter(Boolean).join("/")
    },
    IOUtils: {},
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    console
  };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "bootstrap.js" });
  return context as {
    rootURI: string;
    loadSharedMessages: () => void;
    t: (key: string) => string;
  };
}

describe("bootstrap provider helpers", () => {
  it("loads provider, settings, summary-store, and Zotero item helpers from split bootstrap modules", async () => {
    const { helpers } = loadBootstrapProviderHelpers();
    expect(helpers.settingsProviderDefaults("anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      capabilities: { pdfBase64: true, streaming: true }
    });
    expect(helpers.settingsProviderDefaults("gemini")).toMatchObject({
      protocol: "openai_chat",
      capabilities: { pdfBase64: false, streaming: true }
    });
    expect(helpers.settingsProviderDefaults("azure_openai")).toMatchObject({
      protocol: "openai_responses",
      capabilities: { pdfBase64: true, streaming: true }
    });
    expect(helpers.settingsProviderDefaults("xai")).toMatchObject({
      protocol: "openai_chat",
      capabilities: { pdfBase64: false, streaming: true }
    });
    expect(helpers.settingsProviderDefaults("perplexity")).toMatchObject({
      protocol: "openai_chat",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(helpers.settingsProviderDefaults("zai_anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      capabilities: { pdfBase64: false, streaming: true, modelList: true }
    });
    expect(helpers.settingsProviderDefaults("local_agents")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:3333/v1",
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          "ask-gemini": { tool: "ask_gemini" },
          "ask-claude": { tool: "ask_claude" },
          "ask-opencode": { tool: "ask_opencode" },
          "ask-all-agents": { tool: "ask_all_agents" },
          "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } },
          "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } }
        }
      }
    });
    expect(helpers.settingsProviderDefaults("openai_responses_compatible")).toMatchObject({
      protocol: "openai_responses",
      baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
      capabilities: { pdfBase64: true, streaming: true, modelList: true }
    });
    expect(helpers.settingsProviderFromProfile({
      id: "gemini",
      protocol: "openai_chat",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
    })).toBe("gemini");
    expect(helpers.settingsProviderFromProfile({
      id: "azure-openai",
      protocol: "openai_responses",
      baseURL: "https://resource.openai.azure.com/openai/v1"
    })).toBe("azure_openai");
    expect(helpers.settingsProviderFromProfile({
      id: "moonshot",
      protocol: "openai_chat",
      baseURL: "https://api.moonshot.ai/v1"
    })).toBe("kimi");
    expect(helpers.settingsProviderFromProfile({
      protocol: "openai_chat",
      baseURL: "https://api.x.ai/v1"
    })).toBe("xai");
    expect(helpers.settingsProviderFromProfile({
      protocol: "openai_chat",
      baseURL: "https://api.perplexity.ai"
    })).toBe("perplexity");
    expect(helpers.settingsProviderFromProfile({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic/v1"
    })).toBe("zai_anthropic");
    expect(helpers.settingsProviderFromProfile({
      protocol: "openai_responses",
      baseURL: "https://router.example/v1"
    })).toBe("openai_responses_compatible");
    expect(helpers.settingsHasUsableAuth({
      apiKey: "",
      customHeaders: { Authorization: "Bearer routed-secret" },
      endpointMode: "base_url",
      baseURL: "https://router.example/v1"
    })).toBe(true);
    expect(helpers.backupSummaryPath("/out/paper.md", "2026-06-13T01:02:03.004Z"))
      .toBe("/out/.bak/paper.md.2026-06-13T01-02-03-004Z.md");
    await expect(helpers.pathExists("")).resolves.toBe(false);
    expect(helpers.summaryTitlePrefix({ key: "ITEM" })).toBe("Markdown 摘要 - ITEM");
    expect(helpers.uniqueRegularItems([
      { id: 1, isRegularItem: () => true },
      { id: 1, isRegularItem: () => true },
      { id: 2, isRegularItem: () => false }
    ])).toHaveLength(1);
    expect(helpers.openEmbeddedReader({})).toBe(false);
  });

  it("uses the same PDF/base64 capability rule in bootstrap batch input as the workbench", async () => {
    const { helpers } = loadBootstrapProviderHelpers();
    const pdf = { attachmentFilename: "paper.pdf", attachmentText: "indexed text" };

    expect(helpers.canUsePdfBase64Input({
      protocol: "openai_responses",
      capabilities: { pdfBase64: true }
    })).toBe(true);
    expect(helpers.canUsePdfBase64Input({
      protocol: "openai_chat",
      capabilities: { pdfBase64: true }
    })).toBe(false);
    expect(helpers.canUsePdfBase64Input({
      protocol: "anthropic_messages",
      capabilities: { pdfBase64: "yes" }
    })).toBe(false);

    await expect(helpers.buildInput(pdf, "/paper.pdf", {
      inputMode: "pdf_base64",
      protocol: "openai_responses",
      capabilities: { pdfBase64: true }
    })).resolves.toMatchObject({
      type: "pdf_base64",
      filename: "paper.pdf",
      base64: "JVBERg=="
    });

    await expect(helpers.buildInput(pdf, "/paper.pdf", {
      inputMode: "pdf_base64",
      protocol: "openai_chat",
      capabilities: { pdfBase64: true }
    })).rejects.toThrow("pdfBase64Unsupported");

    await expect(helpers.buildInput(pdf, "/paper.pdf", {
      inputMode: "text",
      protocol: "openai_chat",
      capabilities: { pdfBase64: true }
    })).resolves.toMatchObject({
      type: "text",
      text: "indexed text"
    });
  });

  it("keeps bootstrap legacy provider fallback usable when profile JSON is unavailable", () => {
    const anthropic = loadBootstrapProviderHelpers({ output_text: "ok" }, {
      provider: "anthropic",
      baseURL: "",
      apiKey: "sk-test-secret",
      model: "claude-sonnet",
      profilesJson: "not-json",
      activeProfileId: ""
    }).helpers.getSettings();

    expect(anthropic).toMatchObject({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "claude-sonnet",
      capabilities: { pdfBase64: true, modelList: true }
    });

    const localAgents = loadBootstrapProviderHelpers({ output_text: "ok" }, {
      provider: "local_agents",
      baseURL: "",
      apiKey: "",
      model: "",
      profilesJson: "not-json",
      activeProfileId: ""
    }).helpers;
    const settings = localAgents.getSettings();

    expect(settings).toMatchObject({
      provider: "local_agents",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:3333/v1",
      model: "",
      capabilities: { streaming: false, modelList: false },
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } }
        }
      }
    });
    expect(localAgents.settingsRequiresModel(settings)).toBe(false);
    expect(localAgents.settingsHasUsableAuth(settings)).toBe(true);
  });

  it("normalizes active bootstrap profiles without inheriting legacy model secrets", () => {
    const profiles = [{
      id: "../ Anthropic Router? ",
      name: "",
      protocol: "bad_protocol",
      endpointMode: "bad_mode",
      baseURL: " https://anthropic-router.example/v1/messages/ ",
      apiKey: "",
      model: "",
      capabilities: { streaming: "false", pdfBase64: "yes", modelList: "0" },
      customHeaders: ["broken"],
      bodyExtra: ["broken"],
      isDefault: true
    }];
    const { helpers } = loadBootstrapProviderHelpers({ output_text: "ok" }, {
      provider: "minimax",
      apiKey: "legacy-secret",
      model: "legacy-model",
      profilesJson: JSON.stringify(profiles),
      activeProfileId: "Anthropic-Router"
    });

    const profile = helpers.normalizedActiveProfile();
    const settings = helpers.getSettings();

    expect(profile).toMatchObject({
      id: "Anthropic-Router",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1/messages/",
      apiKey: "",
      model: "",
      customHeaders: {},
      bodyExtra: {}
    });
    expect(settings).toMatchObject({
      provider: "openai-compatible",
      protocol: "openai_chat",
      apiKey: "",
      model: "",
      customHeaders: {},
      bodyExtra: {}
    });
    expect(settings.capabilities).toMatchObject({
      streaming: false,
      pdfBase64: true,
      modelList: false
    });
    expect(settings.apiKey).not.toBe("legacy-secret");
    expect(settings.model).not.toBe("legacy-model");
  });

  it("keeps tools menu entries visible when no item is selected", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    const labels: string[] = [];
    const visibleCalls: boolean[] = [];
    const enabledCalls: boolean[] = [];
    const context = {
      items: [],
      menuElem: { setAttribute: (_name: string, value: string) => labels.push(value) },
      setVisible: (value: boolean) => visibleCalls.push(value),
      setEnabled: (value: boolean) => enabledCalls.push(value)
    };

    helpers.menuItem("Settings", () => undefined).onShowing({}, context);
    helpers.menuItem("Batch Selected", () => undefined, { disableWithoutRegularItems: true }).onShowing({}, context);
    helpers.menuItem("Item Action", () => undefined, { requireRegularItems: true }).onShowing({}, context);

    expect(labels).toEqual(["Settings", "Batch Selected", "Item Action"]);
    expect(enabledCalls).toEqual([false]);
    expect(visibleCalls).toEqual([false]);
  });

  it("formats provider errors for batch generation without leaking credentials", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    const formatted = helpers.providerErrorText(429, JSON.stringify({
      error: {
        code: "rate_limit_exceeded",
        type: "rate_limit_error",
        message: "Too many requests for sk-test-secret with Authorization: Bearer routed-secret"
      }
    }));

    expect(formatted).toContain("HTTP 429");
    expect(formatted).toContain("rate_limit_exceeded");
    expect(formatted).toContain("rate_limit_error");
    expect(formatted).toContain("[redacted]");
    expect(formatted).toContain("Bearer [redacted]");
    expect(formatted).not.toContain("sk-test-secret");
    expect(formatted).not.toContain("routed-secret");
  });

  it("recognizes regular item menu contexts", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    expect(helpers.regularItemContextAvailable({ items: [{ isRegularItem: () => true }] })).toBe(true);
    expect(helpers.regularItemContextAvailable({ items: [] })).toBe(false);
    expect(helpers.regularItemContextAvailable({ items: [{ isRegularItem: () => false }] })).toBe(false);
  });

  it("recognizes local-agent profiles for self-check without remote credentials", async () => {
    const { helpers } = loadBootstrapProviderHelpers({
      result: { serverInfo: { name: "local-agent-mcp" } }
    });
    const profile = {
      id: "local-agents",
      apiKey: "",
      model: "",
      bodyExtra: {
        localAgent: {
          endpoint: "127.0.0.1:3333/mcp",
          payloadMode: "jsonrpc"
        }
      }
    };

    expect(helpers.isLocalAgentProfile(profile)).toBe(true);
    expect(helpers.localAgentEndpointForProfile(profile)).toBe("http://127.0.0.1:3333/mcp");
    expect(helpers.settingsRequiresModel(profile)).toBe(false);
    expect(helpers.settingsHasUsableAuth({
      ...profile,
      endpointMode: "base_url",
      baseURL: "https://router.example/v1"
    })).toBe(true);
    expect(helpers.settingsRequiresModel({ bodyExtra: {}, endpointMode: "base_url", baseURL: "https://router.example/v1" })).toBe(true);
    await expect(helpers.checkLocalAgentBridge("http://127.0.0.1:3333/mcp")).resolves.toEqual({
      ok: true,
      label: "local-agent-mcp"
    });
  });

  it("recognizes local OpenAI-compatible profiles without remote credentials", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    const ollamaProfile = {
      id: "ollama",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://localhost:11434/v1",
      apiKey: "",
      model: "llama3.1",
      bodyExtra: {}
    };
    const lmStudioProfile = {
      id: "lm-studio",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:1234/v1",
      apiKey: "",
      model: "local-model",
      bodyExtra: {}
    };

    expect(helpers.settingsProviderFromProfile(ollamaProfile)).toBe("ollama");
    expect(helpers.settingsProviderFromProfile(lmStudioProfile)).toBe("lm_studio");
    expect(helpers.settingsHasUsableAuth(ollamaProfile)).toBe(true);
    expect(helpers.settingsHasUsableAuth(lmStudioProfile)).toBe(true);
  });

  it("recognizes common OpenAI-compatible hosted provider profiles", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    const profiles = [
      ["zhipu", "https://open.bigmodel.cn/api/paas/v4", "zhipu"],
      ["volcengine", "https://ark.cn-beijing.volces.com/api/v3", "volcengine"],
      ["qianfan", "https://qianfan.baidubce.com/v2", "qianfan"],
      ["hunyuan", "https://api.hunyuan.cloud.tencent.com/v1", "hunyuan"]
    ];

    for (const [id, baseURL, expectedProvider] of profiles) {
      const profile = {
        id,
        protocol: "openai_chat",
        endpointMode: "base_url",
        baseURL,
        apiKey: "provider-key",
        model: "provider-model",
        bodyExtra: {}
      };

      expect(helpers.settingsProviderFromProfile(profile)).toBe(expectedProvider);
      expect(helpers.settingsHasUsableAuth(profile)).toBe(true);
    }
  });

  it("routes bootstrap summary generation through Local Agents MCP profiles", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      result: {
        content: [{ type: "text", text: "local agent summary" }]
      }
    });

    const result = await helpers.callProvider({
      provider: "local-agents",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:3333/v1",
      apiKey: "",
      model: "",
      capabilities: { pdfBase64: false, streaming: false },
      customHeaders: {},
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          timeoutSeconds: 77,
          "ask-all-agents": { tool: "ask_all_agents" }
        }
      },
      request: {
        system: "system prompt",
        prompt: "summary prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(result).toMatchObject({
      markdown: "local agent summary",
      provider: "local-agents",
      model: "ask_all_agents",
      sourceHash: "hash"
    });
    expect(fetchCalls[0].url).toBe("http://127.0.0.1:3333/mcp");
    expect(fetchCalls[0].body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "ask_all_agents",
        arguments: {
          timeoutSeconds: 77
        }
      }
    });
    expect(fetchCalls[0].body.params.arguments.prompt).toContain("system prompt");
    expect(fetchCalls[0].body.params.arguments.prompt).toContain("summary prompt");
    expect(fetchCalls[0].body.params.arguments.prompt).toContain("paper text");
  });

  it("finds arbitrary Markdown attachments for the reader entry", async () => {
    const { helpers, zoteroItems } = loadBootstrapProviderHelpers();
    const pdfAttachment = {
      attachmentContentType: "application/pdf",
      getField: () => "paper.pdf",
      getFilePathAsync: async () => "/tmp/paper.pdf"
    };
    const titledMarkdownAttachment = {
      attachmentContentType: "text/plain",
      getField: () => "reading-notes.md",
      getFilePathAsync: async () => "/tmp/reading-notes.txt"
    };
    const pathMarkdownAttachment = {
      attachmentContentType: "text/plain",
      getField: () => "notes",
      getFilePathAsync: async () => "/tmp/notes.MD"
    };
    zoteroItems.set(1, pdfAttachment);
    zoteroItems.set(2, titledMarkdownAttachment);
    zoteroItems.set(3, pathMarkdownAttachment);

    await expect(helpers.findMarkdownAttachment({ getAttachments: () => [1, 2, 3] })).resolves.toBe(titledMarkdownAttachment);
    await expect(helpers.findMarkdownAttachment({ getAttachments: () => [1, 3] })).resolves.toBe(pathMarkdownAttachment);
  });

  it("resolves workbench selections from parented attachments and top-level PDFs", async () => {
    const { helpers, zoteroItems } = loadBootstrapProviderHelpers();
    const parent = {
      id: 10,
      key: "ITEM10",
      isRegularItem: () => true
    };
    const childAttachment = {
      id: 11,
      key: "PDF11",
      parentItemID: 10,
      attachmentContentType: "application/pdf",
      isRegularItem: () => false
    };
    const topLevelPdf = {
      id: 12,
      key: "PDF12",
      attachmentContentType: "application/pdf",
      isRegularItem: () => false
    };
    zoteroItems.set(10, parent);

    expect(helpers.selectedWorkbenchItems({ items: [childAttachment] })).toEqual([parent]);
    expect(helpers.selectedWorkbenchItems({ items: [topLevelPdf] })).toEqual([topLevelPdf]);
    await expect(helpers.findPdfAttachment(topLevelPdf)).resolves.toBe(topLevelPdf);
  });

  it("loads bootstrap before shared messages are injected", () => {
    const helpers = loadBootstrapWithoutPreloadedMessages();
    helpers.rootURI = "chrome://zotero-markdown-summary/";
    helpers.loadSharedMessages();
    expect(helpers.t("openWorkbench")).toBe("打开论文聊天工作台");
  });

  it("localizes direct summary prompts for bootstrap batch generation", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    const english = helpers.summaryPromptsForSettings({
      outputLanguage: "en-US",
      systemPrompt: "你是学术论文阅读助手，输出中文 Markdown 摘要。",
      userPrompt: "请按研究问题、方法、实验、结论、局限、可借鉴点总结。"
    });
    expect(english.system).toContain("English");
    expect(english.user).toContain("research question");

    const japanese = helpers.summaryPromptsForSettings({
      outputLanguage: "ja-JP",
      systemPrompt: "你是学术论文阅读助手，输出中文 Markdown 摘要。",
      userPrompt: "请按研究问题、方法、实验、结论、局限、可借鉴点总结。"
    });
    expect(japanese.system).toContain("日本語");
    expect(japanese.user).toContain("研究課題");

    const custom = helpers.summaryPromptsForSettings({
      outputLanguage: "en-US",
      systemPrompt: "Custom system.",
      userPrompt: "Custom summary prompt."
    });
    expect(custom.system).toContain("Custom system.");
    expect(custom.system).toContain("Write the output in English.");
    expect(custom.user).toContain("Custom summary prompt.");
    expect(custom.user).toContain("Write the output in English.");
  });

  it("adds prompt pack instructions to direct summary prompts", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    const prompts = helpers.summaryPromptsForSettings({
      outputLanguage: "zh-CN",
      promptPackId: "transportation",
      systemPrompt: "system",
      userPrompt: "user"
    });

    expect(helpers.promptPackInstruction("transportation", "zh-CN")).toContain("交通场景");
    expect(prompts.system).toContain("system");
    expect(prompts.user).toContain("研究领域提示模板包");
    expect(prompts.user).toContain("交通场景");
    expect(prompts.user).toContain("user");
  });

  it("uses Responses instructions and filters local-agent config from request body", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({ output_text: "summary", usage: { total_tokens: 1 } });
    const result = await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: { "x-test": "1" },
      bodyExtra: {
        response_format: { type: "json_object" },
        localAgent: { endpoint: "http://127.0.0.1:3333/mcp" },
        agent: { endpoint: "http://127.0.0.1:3334/mcp" },
        subagent: { endpoint: "http://127.0.0.1:3335/mcp" }
      },
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);

    expect(result.markdown).toBe("summary");
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(fetchCalls[0].headers).toMatchObject({ authorization: "Bearer sk-test-secret", "x-test": "1" });
    expect(fetchCalls[0].body).toMatchObject({
      instructions: "system",
      response_format: { type: "json_object" }
    });
    expect(fetchCalls[0].body.input[0].content).toEqual([
      { type: "input_text", text: "prompt" },
      { type: "input_text", text: "CONTEXT:\npaper text" }
    ]);
    expect(fetchCalls[0].body).not.toHaveProperty("localAgent");
    expect(fetchCalls[0].body).not.toHaveProperty("agent");
    expect(fetchCalls[0].body).not.toHaveProperty("subagent");
  });

  it("uses Responses done snapshots only as a bootstrap stream fallback", async () => {
    const { helpers } = loadBootstrapProviderHelpers({
      __streamLines: [
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"streamed\"}",
        "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"output_text\",\"text\":\"streamed\"}}",
        "data: [DONE]"
      ]
    });
    const result = await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: true
      }
    }, "hash", true);

    expect(result.markdown).toBe("streamed");
  });

  it("uses Chat Completions without MiniMax extras for OpenAI-compatible bootstrap profiles", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      choices: [{ message: { content: "chat summary" } }]
    });
    const result = await helpers.callOpenAICompatible({
      provider: "openai-compatible",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "router-model",
      capabilities: { pdfBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false);

    expect(result.markdown).toBe("chat summary");
    expect(fetchCalls[0].url).toBe("https://router.example/v1/chat/completions");
    expect(fetchCalls[0].body).toMatchObject({
      model: "router-model",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "prompt\n\npaper text" }
      ],
      max_tokens: 1024
    });
    expect(fetchCalls[0].body).not.toHaveProperty("extra_body");
    expect(fetchCalls[0].body).not.toHaveProperty("input");
  });

  it("sends image attachments through bootstrap OpenAI-compatible chat bodies", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      choices: [{ message: { content: "chat image summary" } }]
    });

    const result = await helpers.callOpenAICompatible({
      provider: "openai-compatible",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "router-model",
      capabilities: { pdfBase64: false, imageBase64: true, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: {
          type: "text",
          text: "paper text",
          images: [{ name: "figure.png", mimeType: "image/png", base64: "aW1hZ2U=" }]
        },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false);

    expect(result.markdown).toBe("chat image summary");
    expect(fetchCalls[0].body.messages[1].content).toEqual([
      { type: "text", text: "prompt\n\npaper text" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }
    ]);
  });

  it("sends image attachments through bootstrap OpenAI Responses PDF bodies", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({ output_text: "responses image summary" });

    await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "response-model",
      capabilities: { pdfBase64: true, imageBase64: true, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: {
          type: "pdf_base64",
          base64: "cGRm",
          filename: "paper.pdf",
          images: [{ name: "figure.jpg", mimeType: "image/jpeg", base64: "aW1hZ2U=" }]
        },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);

    expect(fetchCalls[0].body.input[0].content).toEqual([
      { type: "input_file", filename: "paper.pdf", file_data: "data:application/pdf;base64,cGRm" },
      { type: "input_text", text: "prompt" },
      { type: "input_image", image_url: "data:image/jpeg;base64,aW1hZ2U=" }
    ]);
  });

  it("sends image attachments through bootstrap Anthropic message bodies", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      content: [{ type: "text", text: "anthropic image summary" }]
    });

    await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "claude-model",
      capabilities: { pdfBase64: true, imageBase64: true, streaming: true },
      customHeaders: {},
      bodyExtra: { directBrowserAccess: false },
      request: {
        system: "system",
        prompt: "prompt",
        input: {
          type: "pdf_base64",
          base64: "cGRm",
          filename: "paper.pdf",
          images: [{ name: "figure.png", mimeType: "image/png", base64: "aW1hZ2U=" }]
        },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(fetchCalls[0].body.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } },
      { type: "text", text: "prompt" }
    ]);
  });

  it("rejects bootstrap image attachments when the provider profile disables image input", async () => {
    const { helpers } = loadBootstrapProviderHelpers();

    await expect(helpers.callOpenAICompatible({
      provider: "openai-compatible",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "router-model",
      capabilities: { pdfBase64: false, imageBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: {
          type: "text",
          text: "paper text",
          images: [{ name: "figure.png", mimeType: "image/png", base64: "aW1hZ2U=" }]
        },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false)).rejects.toThrow("不支持图片输入");
  });

  it("normalizes OpenAI-compatible endpoints in the bootstrap provider path", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      choices: [{ message: { content: "chat summary" } }]
    });
    await helpers.callOpenAICompatible({
      provider: "deepseek",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test-secret",
      model: "deepseek-chat",
      capabilities: { pdfBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false);

    await helpers.callOpenAICompatible({
      provider: "gemini",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "sk-test-secret",
      model: "gemini-2.5-flash",
      capabilities: { pdfBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false);

    await helpers.callOpenAICompatible({
      provider: "azure_openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://azure-resource.openai.azure.com/openai/v1",
      apiKey: "sk-test-secret",
      model: "deployment-a",
      capabilities: { pdfBase64: true, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);

    await helpers.callOpenAICompatible({
      provider: "perplexity",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.perplexity.ai",
      apiKey: "sk-test-secret",
      model: "sonar-pro",
      capabilities: { pdfBase64: false, streaming: true, modelList: false },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false);

    await helpers.callOpenAICompatible({
      provider: "openai-compatible",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1/chat/completions",
      apiKey: "sk-test-secret",
      model: "router-model",
      capabilities: { pdfBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false);

    await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1/responses",
      apiKey: "sk-test-secret",
      model: "response-model",
      capabilities: { pdfBase64: true, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);

    expect(fetchCalls[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(fetchCalls[1].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(fetchCalls[2].url).toBe("https://azure-resource.openai.azure.com/openai/v1/responses");
    expect(fetchCalls[3].url).toBe("https://api.perplexity.ai/chat/completions");
    expect(fetchCalls[4].url).toBe("https://router.example/v1/chat/completions");
    expect(fetchCalls[5].url).toBe("https://api.openai.com/v1/responses");
    expect(fetchCalls[2].headers).toMatchObject({ "api-key": "sk-test-secret" });
    expect(fetchCalls[2].headers).not.toHaveProperty("authorization");
  });

  it("extracts OpenAI-compatible non-stream response text variants in bootstrap provider", async () => {
    const { helpers } = loadBootstrapProviderHelpers({
      choices: [{ text: "legacy completion text" }]
    });
    await expect(helpers.callOpenAICompatible({
      provider: "openai-compatible",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "router-model",
      capabilities: { pdfBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false)).resolves.toMatchObject({ markdown: "legacy completion text" });

    const nested = loadBootstrapProviderHelpers({
      choices: [{ delta: { content: [{ type: "text", text: "delta content" }] } }]
    });
    await expect(nested.helpers.callOpenAICompatible({
      provider: "openai-compatible",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "router-model",
      capabilities: { pdfBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false)).resolves.toMatchObject({ markdown: "delta content" });
  });

  it("adds JSON mode defaults in bootstrap OpenAI provider requests", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({ output_text: "summary" });
    await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "m",
      capabilities: { jsonMode: true },
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "Return JSON.",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);

    expect(fetchCalls[0].body).toMatchObject({
      text: { format: { type: "json_object" } }
    });

    await helpers.callOpenAICompatible({
      provider: "minimax",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.minimaxi.com/v1",
      apiKey: "sk-test-secret",
      model: "m",
      capabilities: { jsonMode: true },
      customHeaders: {},
      bodyExtra: { response_format: { type: "json_schema", json_schema: { name: "paper" } } },
      request: {
        system: "system",
        prompt: "Return JSON.",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", false);

    expect(fetchCalls[1].body).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "paper" } }
    });
  });

  it("throws redacted errors from bootstrap provider stream error events", async () => {
    const { helpers } = loadBootstrapProviderHelpers({
      __streamText: "data: {\"type\":\"error\",\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"Too many requests for sk-test-secret\"}}\n"
    });

    await expect(helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: true
      }
    }, "hash", true)).rejects.toThrow("rate_limit_exceeded - Too many requests for [redacted]");
  });

  it("throws redacted errors from bootstrap OpenAI non-stream response bodies", async () => {
    const { helpers } = loadBootstrapProviderHelpers({
      __status: 429,
      error: { code: "rate_limit_exceeded", message: "Too many requests for sk-test-secret" }
    });

    await expect(helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true)).rejects.toThrow("rate_limit_exceeded - Too many requests for [redacted]");
  });

  it("does not retry non-retryable bootstrap provider HTTP errors", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      __status: 401,
      error: { code: "invalid_api_key", message: "Invalid API key sk-test-secret" }
    });

    await expect(helpers.callOpenAICompatible(openAIResponsesSummaryRequest(), "hash", true))
      .rejects.toThrow("invalid_api_key");
    expect(fetchCalls).toHaveLength(1);
  });

  it("retries retryable bootstrap provider HTTP errors", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      __responses: [
        {
          __status: 429,
          error: { code: "rate_limit_exceeded", message: "Too many requests for sk-test-secret" }
        },
        {
          output_text: "summary after retry"
        }
      ]
    });

    const result = await helpers.callOpenAICompatible(openAIResponsesSummaryRequest(), "hash", true);

    expect(result.markdown).toBe("summary after retry");
    expect(fetchCalls).toHaveLength(2);
  });

  it("keeps custom OpenAI-compatible authorization headers in the bootstrap provider path", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({ output_text: "summary" });
    await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "",
      model: "m",
      customHeaders: { Authorization: "Bearer routed-secret" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);

    expect(fetchCalls[0].headers).toMatchObject({ Authorization: "Bearer routed-secret" });
    expect(fetchCalls[0].headers).not.toHaveProperty("authorization");

    await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://azure-resource.openai.azure.com/openai/v1",
      apiKey: "sk-test-secret",
      model: "deployment-a",
      customHeaders: { "api-key": "azure-secret" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);

    expect(fetchCalls[1].headers).toMatchObject({ "api-key": "azure-secret" });
    expect(fetchCalls[1].headers).not.toHaveProperty("authorization");
  });

  it("fills bootstrap provider auth from API keys when custom auth headers are blank", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({ output_text: "summary" });
    await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: { Authorization: "" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);
    expect(fetchCalls[0].headers).toMatchObject({ Authorization: "Bearer sk-test-secret" });

    await helpers.callOpenAICompatible({
      provider: "openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://azure-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      model: "deployment-a",
      customHeaders: { "api-key": "" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash", true);
    expect(fetchCalls[1].headers).toMatchObject({ "api-key": "azure-secret" });
  });

  it("posts Anthropic messages without duplicating v1 or leaking local-agent config", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      content: [{ type: "text", text: "anthropic summary" }],
      usage: { input_tokens: 1 }
    });
    const result = await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com/v1/messages",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: { "anthropic-version": "2023-06-01" },
      bodyExtra: {
        metadata: { source: "zotero" },
        localAgent: { endpoint: "http://127.0.0.1:3333/mcp" },
        authHeader: "x-api-key"
      },
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: true
      }
    }, "hash");

    expect(result.markdown).toBe("anthropic summary");
    expect(fetchCalls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(fetchCalls[0].headers).toMatchObject({ "x-api-key": "sk-test-secret", "anthropic-version": "2023-06-01" });
    expect(fetchCalls[0].headers).toMatchObject({ "anthropic-dangerous-direct-browser-access": "true" });
    expect(fetchCalls[0].body).toMatchObject({
      system: "system",
      stream: true,
      metadata: { source: "zotero" }
    });
    expect(fetchCalls[0].body.messages[0].content[0].text).toContain("prompt");
    expect(fetchCalls[0].body.messages[0].content[0].text).toContain("paper text");
    expect(fetchCalls[0].body).not.toHaveProperty("temperature");
    expect(fetchCalls[0].body).not.toHaveProperty("localAgent");
    expect(fetchCalls[0].body).not.toHaveProperty("authHeader");
  });

  it("allows disabling official Anthropic direct browser access in the bootstrap provider path", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      content: [{ type: "text", text: "anthropic summary" }]
    });
    await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: { directBrowserAccess: false, anthropicDirectBrowserAccess: false },
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(fetchCalls[0].headers).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(fetchCalls[0].body).not.toHaveProperty("directBrowserAccess");
    expect(fetchCalls[0].body).not.toHaveProperty("anthropicDirectBrowserAccess");
  });

  it("throws redacted errors from bootstrap Anthropic non-stream response bodies", async () => {
    const { helpers } = loadBootstrapProviderHelpers({
      type: "error",
      error: { type: "overloaded_error", message: "Bearer routed-secret overloaded" }
    });

    await expect(helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: { "anthropic-version": "2023-06-01" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash")).rejects.toThrow("overloaded_error - Bearer [redacted] overloaded");
  });

  it("keeps custom Anthropic x-api-key headers in the bootstrap provider path", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      content: [{ type: "text", text: "anthropic summary" }]
    });
    await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "",
      model: "m",
      customHeaders: { "x-api-key": "anthropic-routed-secret" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(fetchCalls[0].headers).toMatchObject({
      "x-api-key": "anthropic-routed-secret",
      "anthropic-version": "2023-06-01"
    });

    await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: { Authorization: "Bearer routed-secret" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(fetchCalls[1].headers).toMatchObject({
      Authorization: "Bearer routed-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(fetchCalls[1].headers).not.toHaveProperty("x-api-key");
  });

  it("fills bootstrap Anthropic x-api-key when the custom header is blank", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      content: [{ type: "text", text: "anthropic summary" }]
    });
    await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "anthropic-secret",
      model: "m",
      customHeaders: { "x-api-key": "" },
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(fetchCalls[0].headers).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-version": "2023-06-01"
    });
  });

  it("uses Bearer auth for known Anthropic-compatible coding endpoints", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      content: [{ type: "text", text: "compatible summary" }]
    });
    await helpers.callAnthropic({
      provider: "zai_anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(fetchCalls[0].headers).toMatchObject({
      authorization: "Bearer zai-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(fetchCalls[0].headers).not.toHaveProperty("x-api-key");
    expect(fetchCalls[0].headers).not.toHaveProperty("anthropic-dangerous-direct-browser-access");

    await helpers.callAnthropic({
      provider: "custom-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization", directBrowserAccess: true },
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: false
      }
    }, "hash");

    expect(fetchCalls[1].headers).toMatchObject({
      authorization: "Bearer routed-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(fetchCalls[1].body).not.toHaveProperty("authHeader");
    expect(fetchCalls[1].body).not.toHaveProperty("directBrowserAccess");
  });

  it("parses Anthropic stream deltas in the bootstrap provider path", async () => {
    const { fetchCalls, helpers } = loadBootstrapProviderHelpers({
      __streamLines: [
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"anthropic \"}}",
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"stream\"}}",
        "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":2}}",
        "data: [DONE]"
      ]
    });
    const result = await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: true
      }
    }, "hash");

    expect(fetchCalls[0].body).toMatchObject({ stream: true });
    expect(result.markdown).toBe("anthropic stream");
    expect(result.usage).toEqual({ output_tokens: 2 });
  });

  it("flushes a final Anthropic stream event without a trailing newline", async () => {
    const { helpers } = loadBootstrapProviderHelpers({
      __streamText: [
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"tail\"}}"
      ].join("")
    });
    const result = await helpers.callAnthropic({
      provider: "anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "m",
      customHeaders: {},
      bodyExtra: {},
      request: {
        system: "system",
        prompt: "prompt",
        input: { type: "text", text: "paper text" },
        temperature: 0.2,
        maxOutputTokens: 1024,
        stream: true
      }
    }, "hash");

    expect(result.markdown).toBe("tail");
  });

  it("extracts Responses stream deltas used by the legacy bootstrap path", () => {
    const { helpers } = loadBootstrapProviderHelpers();
    expect(helpers.extractOpenAIStreamText({ type: "response.output_text.delta", delta: "streamed" })).toBe("streamed");
    expect(helpers.extractOpenAIStreamText({ type: "response.content_part.done", part: { type: "output_text", text: "snapshot part" } })).toBe("snapshot part");
    expect(helpers.extractOpenAIStreamText({ type: "response.completed", response: { output_text: "snapshot response" } })).toBe("snapshot response");
    expect(helpers.extractOpenAIStreamText({ delta: { content: [{ text: "nested" }] } })).toBe("nested");
    expect(helpers.extractOpenAIStreamText({ choices: [{ delta: { reasoning_content: "hidden" } }] })).toBe("");
    expect(helpers.extractOpenAIStreamText({
      choices: [{
        delta: {
          content: [
            { type: "reasoning", text: "hidden" },
            { type: "text", text: "visible" }
          ]
        }
      }]
    })).toBe("visible");
    expect(helpers.extractOpenAIStreamText({
      choices: [{ message: { content: [{ type: "output_text", text: "message text" }] } }]
    })).toBe("message text");
  });
});
