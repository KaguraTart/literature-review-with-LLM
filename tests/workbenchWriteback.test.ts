import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadWorkbenchHelpers(files = new Map<string, string>(), ioOverrides: Record<string, any> = {}, prefValues: Record<string, any> = {}) {
  const code = readFileSync(resolve(process.cwd(), "addon/content/workbench.js"), "utf8");
  const writes = new Map<string, string>();
  const linkedAttachments: any[] = [];
  const urlAttachments: any[] = [];
  const zoteroItems = new Map<number, any>();
  const zoteroCollections = new Map<number, any>();
  const createdItems: any[] = [];
  const searchResults: number[] = [];
  let nextItemID = 1000;
  class FakeZoteroItem {
    itemType: string;
    id = 0;
    key = "";
    libraryID = 0;
    fields: Record<string, string> = {};
    creators: any[] = [];
    collections: any[] = [];
    constructor(itemType: string) {
      this.itemType = itemType;
      createdItems.push(this);
    }
    setField(field: string, value: string) {
      this.fields[field] = value;
    }
    getField(field: string) {
      return this.fields[field] || "";
    }
    setCreators(creators: any[]) {
      this.creators = creators;
    }
    addToCollection(collectionID: any) {
      this.collections.push(collectionID);
    }
    async saveTx() {
      if (!this.id) {
        this.id = nextItemID++;
        this.key = `NEW${this.id}`;
        zoteroItems.set(this.id, this);
      }
      return this.id;
    }
  }
  const sandbox: any = {
    window: {
      parent: undefined,
      IOUtils: {
        readUTF8: async (path: string) => files.get(path) || "",
        exists: async (path: string) => files.has(path),
        makeDirectory: async () => undefined,
        writeUTF8: async (path: string, text: string) => {
          files.set(path, text);
          writes.set(path, text);
        },
        move: async (from: string, to: string) => {
          files.set(to, files.get(from) || "");
          files.delete(from);
        },
        remove: async (path: string) => {
          files.delete(path);
        },
        ...ioOverrides
      },
      PathUtils: {
        join: (...parts: string[]) => parts.filter(Boolean).join("/")
      },
      Zotero: {
        File: {},
        Item: FakeZoteroItem,
        Search: class {
          libraryID = 0;
          conditions: any[] = [];
          addCondition(field: string, operator: string, value: string) {
            this.conditions.push({ field, operator, value });
          }
          async search() {
            return [...searchResults];
          }
        },
        Libraries: {
          userLibraryID: 1
        },
        Items: {
          get: (id: number) => zoteroItems.get(id),
          getByLibraryAndKey: (_libraryID: number, key: string) => {
            for (const item of zoteroItems.values()) {
              if (item.key === key) return item;
            }
            return null;
          }
        },
        Collections: {
          get: (id: number) => zoteroCollections.get(id)
        },
        Attachments: {
          linkFromFile: async (payload: any) => {
            linkedAttachments.push(payload);
            return payload;
          },
          importFromURL: async (payload: any) => {
            const id = nextItemID++;
            const attachment = {
              id,
              key: `ATT${id}`,
              parentItemID: payload.parentItemID,
              attachmentContentType: payload.contentType,
              fields: {
                title: payload.title,
                url: payload.url
              } as Record<string, string>,
              getField(field: string) {
                return this.fields[field] || "";
              }
            };
            zoteroItems.set(id, attachment);
            urlAttachments.push(payload);
            return attachment;
          }
        },
        Prefs: {
          get: (key: string) => prefValues[key.replace(/^extensions\.zoteroMarkdownSummary\./, "")] ?? ""
        },
        Promise: {
          delay: () => Promise.resolve()
        }
      }
    },
    navigator: {
      clipboard: {
        writeText() {}
      }
    },
    TextDecoder,
    AbortController,
    ReadableStream,
    console
  };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "workbench.js" });
  (context as any).__writes = writes;
  (context as any).__linkedAttachments = linkedAttachments;
  (context as any).__urlAttachments = urlAttachments;
  (context as any).__zoteroItems = zoteroItems;
  (context as any).__zoteroCollections = zoteroCollections;
  (context as any).__createdItems = createdItems;
  (context as any).__searchResults = searchResults;
  return context as {
    applyMarkdownEdit: (original: string, request: any) => any;
    assertWritePreviewCurrent: (preview: any, currentText: string, staleMessage?: string) => void;
    commitWritePreview: (summaryPath: string, preview: any) => Promise<void>;
    assertRemoteProfileReady: (profile: any, translate?: (key: string) => string) => void;
    normalizeSkillId: (value: string) => string;
    providerBodyExtra: (bodyExtra: any) => Record<string, any>;
    ensureSummaryFile: (item: any, pdf: any, outputDir: string, options?: any) => Promise<any>;
    findPdfAttachment: (item: any) => Promise<any>;
    buildPaperContext: (item: any, pdf: any, outputDir: string) => Promise<any>;
    contextForPrompt: (context: any, query: string) => string;
    contextDiagnosticsText: (diagnostics: any, translate?: (key: string) => string) => string;
    writePreviewSummary: (preview: any, options?: any) => string;
    requestInputStatusText: (requestInput: any, translate?: (key: string) => string) => string;
    profileStatusText: (profile: any, translate?: (key: string) => string) => string;
    profileMessageMetadata: (profile: any) => any;
    providerErrorText: (status: number, text: string) => string;
    extractResponseText: (protocol: string, data: any) => string;
    getProfiles: () => any[];
    requestMessagesWithHistory: (messages: any[], latestUserText: string, requestPrompt: string, limit?: number) => any[];
    bodyForProfile: (profile: any, messages: any[], outputLanguage: string, systemPrompt: string, requestInput?: any, streamEnabled?: boolean) => any;
    shouldStream: (profile: any, streamEnabled?: boolean) => boolean;
    normalizeBoolean: (value: any, fallback?: boolean) => boolean;
    headersForProfile: (profile: any) => Record<string, string>;
    requestModelWithRetry: (profile: any, messages: any[], outputLanguage: string, systemPrompt: string, requestInput: any, streamEnabled: boolean, signal?: AbortSignal) => Promise<any>;
    readStream: (response: any, protocol: string, onDelta: (delta: string) => void) => Promise<string>;
    sessionFilenameFor: (sessionId: string) => string;
    sessionIdFromPath: (path: string) => string;
    recentSessionFiles: (paths: string[]) => string[];
    candidateJsonlPath: (outputDir: string, item: any) => string;
    importLedgerJsonlPath: (outputDir: string, item: any) => string;
    importableCandidateRecords: (records: any[]) => any[];
    importCandidateIntoZotero: (record: any, contextItem: any, now?: string) => Promise<any>;
    applyCandidateImportResults: (records: any[], resultById: Map<string, any>, now?: string) => any[];
    importResultLedgerEntries: (records: any[], resultById: Map<string, any>, now?: string) => any[];
    pdfAttachableCandidateRecords: (records: any[]) => any[];
    attachCandidatePdfToZotero: (record: any, contextItem: any, now?: string) => Promise<any>;
    applyCandidatePdfAttachmentResults: (records: any[], resultById: Map<string, any>, now?: string) => any[];
    pdfAttachmentLedgerEntries: (records: any[], resultById: Map<string, any>, now?: string) => any[];
    reconcileCandidateDuplicateRecords: (records: any[], now?: string) => any;
    parseCandidateJsonl: (text: string) => any[];
    renderCandidateJsonl: (records: any[]) => string;
    renderImportLedgerJsonl: (entries: any[]) => string;
    candidateDecisionCounts: (records: any[]) => any;
    candidateStatusText: (records: any[], path: string, translate?: (key: string) => string) => string;
    applyCandidateDecisions: (records: any[], decisions: Record<string, string>, now: string) => any[];
    discoveredLedgerEntries: (records: any[], existingCandidateIds: Set<string>, now?: string) => any[];
    decisionLedgerEntries: (records: any[], previousDecisions: Map<string, string>, changedDecisions: Record<string, string>, now?: string) => any[];
    loadCandidateRecords: (path: string) => Promise<any[]>;
    saveCandidateRecords: (path: string, records: any[]) => Promise<void>;
    __writes: Map<string, string>;
    __linkedAttachments: any[];
    __urlAttachments: any[];
    __zoteroItems: Map<number, any>;
    __zoteroCollections: Map<number, any>;
    __createdItems: any[];
    __searchResults: number[];
    ZoteroMarkdownSummaryWorkbench: {
      state: any;
      loadSession: (path: string) => Promise<void>;
      renderMessages: () => void;
      renderSessions: () => Promise<void>;
      setStatus: (message: string) => void;
      saveSession: () => Promise<void>;
      searchCandidates: () => Promise<void>;
      t: (key: string) => string;
      sessionDir: () => string;
      sessionPath: () => string;
    };
  };
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

function fakeDocument(values: Record<string, string> = {}) {
  const elements = new Map<string, any>();
  const ensure = (id: string) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: values[id] || "",
        textContent: "",
        dataset: {},
        focusCalls: 0,
        lastFocusOptions: null as any,
        eventListeners: new Map<string, Array<(event?: any) => void>>(),
        children: [] as any[],
        addEventListener(type: string, listener: (event?: any) => void) {
          const listeners = this.eventListeners.get(type) || [];
          listeners.push(listener);
          this.eventListeners.set(type, listeners);
        },
        focus(options?: any) {
          this.focusCalls += 1;
          this.lastFocusOptions = options || null;
        },
        setAttribute(name: string, value: string) {
          this[name] = value;
        },
        append(...children: any[]) {
          this.children.push(...children);
        },
        appendChild(child: any) {
          this.children.push(child);
          return child;
        }
      });
    }
    return elements.get(id);
  };
  const createElement = (tagName: string) => ({
    tagName,
    localName: tagName,
    value: "",
    textContent: "",
    className: "",
    dataset: {},
    focusCalls: 0,
    lastFocusOptions: null as any,
    eventListeners: new Map<string, Array<(event?: any) => void>>(),
    children: [] as any[],
    addEventListener(type: string, listener: (event?: any) => void) {
      const listeners = this.eventListeners.get(type) || [];
      listeners.push(listener);
      this.eventListeners.set(type, listeners);
    },
    focus(options?: any) {
      this.focusCalls += 1;
      this.lastFocusOptions = options || null;
    },
    setAttribute(name: string, value: string) {
      (this as any)[name] = value;
    },
    append(...children: any[]) {
      this.children.push(...children);
    },
    appendChild(child: any) {
      this.children.push(child);
      return child;
    }
  });
  return {
    elements,
    getElementById: ensure,
    createElement,
    createElementNS: (_namespace: string, tagName: string) => createElement(tagName),
    createTextNode: (text: string) => ({ tagName: "#text", localName: "#text", textContent: text, children: [] }),
    querySelectorAll: () => []
  };
}

function loadCandidateSourcesRuntime() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/candidate-sources.js"), "utf8");
  const sandbox: any = { window: {}, URLSearchParams, console };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "candidate-sources.js" });
  return (context as any).ZMSCandidateSources;
}

function providerProfile() {
  return {
    id: "openai",
    name: "OpenAI",
    protocol: "openai_responses",
    endpointMode: "base_url",
    baseURL: "https://api.openai.com/v1",
    fullURL: "",
    apiKey: "sk-test-secret",
    model: "model-a",
    capabilities: {
      text: true,
      pdfBase64: true,
      fileReference: false,
      streaming: true,
      embeddings: false,
      jsonMode: false,
      toolUse: false,
      modelList: true
    },
    customHeaders: {},
    bodyExtra: {}
  };
}

describe("workbench writeback helpers", () => {
  const helpers = loadWorkbenchHelpers();

  it("creates backup and temp paths for atomic writeback", () => {
    const preview = helpers.applyMarkdownEdit("# Paper\n\n## Notes\n\nOld\n", {
      summaryPath: "/tmp/paper.md",
      chatSessionId: "chat-1",
      action: "append_section",
      targetSection: "Notes",
      replacementText: "New note.",
      skillId: "paper-deep-summary",
      now: "2026-06-12T22:00:00.000Z"
    });

    expect(preview.backupPath).toBe("/tmp/.bak/paper.md.2026-06-12T22-00-00-000Z.md");
    expect(preview.tempPath).toBe("/tmp/.paper.md.2026-06-12T22-00-00-000Z.tmp");
    expect(preview.after).toContain("New note.");
  });

  it("renders a human-checkable write preview summary", () => {
    const preview = helpers.applyMarkdownEdit("# Paper\n\n## Notes\n\nOld\n", {
      summaryPath: "/tmp/paper.md",
      chatSessionId: "chat-1",
      action: "replace_section",
      targetSection: "Notes",
      replacementText: "New note.",
      skillId: "paper-deep-summary",
      now: "2026-06-12T22:00:00.000Z"
    });
    const summary = helpers.writePreviewSummary(preview, {
      summaryPath: "/tmp/paper.md",
      action: "replace_section",
      targetSection: "Notes",
      translate: (key: string) => ({
        writeTarget: "目标文件",
        writeBackup: "备份文件",
        writeAction: "写入动作",
        writeSection: "目标章节",
        writeSectionNone: "无",
        writeSize: "字符数",
        writeFrontmatter: "更新元数据",
        replaceSection: "替换章节"
      }[key] || key)
    });

    expect(summary).toContain("目标文件: /tmp/paper.md");
    expect(summary).toContain("备份文件: /tmp/.bak/paper.md.2026-06-12T22-00-00-000Z.md");
    expect(summary).toContain("写入动作: 替换章节");
    expect(summary).toContain("目标章节: Notes");
    expect(summary).toContain("更新元数据: lastEditedAt, lastEditSource, chatSessionId, skillId, editCount");
  });

  it("rejects stale writeback previews", () => {
    const preview = { before: "original", after: "updated" };
    expect(() => helpers.assertWritePreviewCurrent(preview, "changed", "stale")).toThrow("stale");
    expect(() => helpers.assertWritePreviewCurrent(preview, "original", "stale")).not.toThrow();
  });

  it("restores the original summary text if final writeback fails after backup", async () => {
    const files = new Map<string, string>([
      ["/tmp/paper.md", "# Paper\n\n## Notes\n\nOld\n"]
    ]);
    let failTargetMove = true;
    const loaded = loadWorkbenchHelpers(files, {
      move: async (from: string, to: string) => {
        if (to === "/tmp/paper.md" && failTargetMove) {
          failTargetMove = false;
          files.set(to, "partial write");
          throw new Error("move failed");
        }
        files.set(to, files.get(from) || "");
        files.delete(from);
      }
    });
    const preview = loaded.applyMarkdownEdit(files.get("/tmp/paper.md") || "", {
      summaryPath: "/tmp/paper.md",
      chatSessionId: "chat-1",
      action: "append_section",
      targetSection: "Notes",
      replacementText: "New note.",
      skillId: "paper-deep-summary",
      now: "2026-06-12T22:00:00.000Z"
    });

    await expect(loaded.commitWritePreview("/tmp/paper.md", preview)).rejects.toThrow("move failed");
    expect(files.get("/tmp/paper.md")).toBe(preview.before);
    expect(files.get(preview.backupPath)).toBe(preview.before);
  });

  it("normalizes skill ids before using them as template filenames", () => {
    expect(helpers.normalizeSkillId("../My Custom:Audit?.md")).toBe("My-Custom-Audit");
    expect(helpers.normalizeSkillId("  local review  ")).toBe("local-review");
  });

  it("filters internal local-agent config out of provider body extras", () => {
    expect(helpers.providerBodyExtra({
      response_format: { type: "json_object" },
      localAgent: { endpoint: "http://127.0.0.1:3333/mcp" },
      agent: { endpoint: "http://127.0.0.1:3334/mcp" },
      subagent: { endpoint: "http://127.0.0.1:3335/mcp" },
      directBrowserAccess: true,
      anthropicDirectBrowserAccess: false
    })).toEqual({ response_format: { type: "json_object" } });
  });

  it("uses OpenAI-compatible Chat capabilities for legacy workbench settings", () => {
    const loaded = loadWorkbenchHelpers(new Map(), {}, {
      profilesJson: "",
      provider: "openai_compatible",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "router-model"
    });
    const profile = loaded.getProfiles()[0];

    expect(profile).toMatchObject({
      id: "openai-compatible",
      protocol: "openai_chat",
      baseURL: "https://router.example/v1",
      capabilities: { pdfBase64: false, streaming: true, modelList: true },
      bodyExtra: {}
    });
  });

  it("falls back to legacy workbench settings when profiles JSON is malformed", () => {
    const loaded = loadWorkbenchHelpers(new Map(), {}, {
      profilesJson: "{not valid json",
      provider: "anthropic",
      baseURL: "https://anthropic.example",
      apiKey: "anthropic-secret",
      model: "claude-test"
    });
    const profiles = loaded.getProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: "anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://anthropic.example",
      apiKey: "anthropic-secret",
      model: "claude-test",
      isDefault: true
    });
  });

  it("adds missing default provider profiles to existing workbench profile lists", () => {
    const loaded = loadWorkbenchHelpers(new Map(), {}, {
      profilesJson: JSON.stringify([
        {
          id: "openai",
          name: "OpenAI",
          protocol: "openai_responses",
          endpointMode: "base_url",
          baseURL: "https://api.openai.com/v1",
          apiKey: "kept-secret",
          model: "kept-model",
          customHeaders: { "x-route": "kept" },
          capabilities: { pdfBase64: true, streaming: true },
          bodyExtra: {},
          isDefault: true
        },
        {
          id: "custom-router",
          name: "Custom Router",
          protocol: "openai_chat",
          endpointMode: "base_url",
          baseURL: "https://router.example/v1",
          apiKey: "custom-secret",
          model: "custom-model",
          capabilities: { streaming: true },
          bodyExtra: {},
          isDefault: false
        }
      ])
    });
    const profiles = loaded.getProfiles();

    expect(profiles.find((profile) => profile.id === "openai")).toMatchObject({
      apiKey: "kept-secret",
      model: "kept-model",
      customHeaders: { "x-route": "kept" },
      isDefault: true
    });
    expect(profiles.find((profile) => profile.id === "custom-router")).toMatchObject({
      apiKey: "custom-secret",
      model: "custom-model"
    });
    expect(profiles.map((profile) => profile.id)).toEqual(expect.arrayContaining([
      "gemini",
      "azure-openai",
      "xai",
      "groq",
      "mistral",
      "together",
      "kimi",
      "perplexity",
      "deepseek",
      "zai-anthropic",
      "zhipu",
      "volcengine",
      "qianfan",
      "hunyuan",
      "ollama",
      "lm-studio",
      "local-agents"
    ]));
    expect(profiles.find((profile) => profile.id === "local-agents")?.bodyExtra?.localAgent).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      "ask-gemini": { tool: "ask_gemini" },
      "ask-claude": { tool: "ask_claude" },
      "ask-opencode": { tool: "ask_opencode" },
      "ask-all-agents": { tool: "ask_all_agents" },
      "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } }
    });
    expect(profiles.filter((profile) => profile.isDefault)).toHaveLength(1);
  });

  it("normalizes damaged workbench provider profiles before use", () => {
    const loaded = loadWorkbenchHelpers(new Map(), {}, {
      profilesJson: JSON.stringify([
        {
          id: "../ Custom Router:Profile? ",
          name: "",
          protocol: "bad_protocol",
          endpointMode: "streaming_url",
          baseURL: " https://router.example/v1/chat/completions/ ",
          apiKey: "  routed-secret  ",
          model: "  routed-model  ",
          capabilities: { streaming: "false", pdfBase64: "yes", modelList: "0", jsonMode: "on" },
          customHeaders: ["broken"],
          bodyExtra: ["broken"],
          isDefault: true
        }
      ])
    });
    const profile = loaded.getProfiles()[0];

    expect(profile).toMatchObject({
      id: "Custom-Router-Profile",
      name: "OpenAI Compatible Chat",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1/chat/completions/",
      apiKey: "routed-secret",
      model: "routed-model",
      customHeaders: {},
      bodyExtra: {},
      isDefault: true
    });
    expect(profile.capabilities).toMatchObject({
      streaming: false,
      pdfBase64: true,
      modelList: false,
      jsonMode: true
    });
    expect(loaded.profileStatusText(profile)).toContain("https://router.example/v1/chat/completions");
  });

  it("honors the runtime stream setting when building provider request bodies", () => {
    const profile = {
      protocol: "openai_responses",
      model: "model-a",
      capabilities: { streaming: true },
      bodyExtra: {}
    };
    const messages = [{ role: "user", content: "prompt" }];

    expect(helpers.bodyForProfile(profile, messages, "zh-CN", "system", {}, false).stream).toBe(false);
    expect(helpers.bodyForProfile(profile, messages, "zh-CN", "system", {}, true).stream).toBe(true);
    expect(helpers.shouldStream({ ...profile, capabilities: { streaming: false } }, true)).toBe(false);
    expect(helpers.normalizeBoolean("", true)).toBe(true);
    expect(helpers.normalizeBoolean("false", true)).toBe(false);
  });

  it("adds protocol-specific JSON mode defaults in workbench request bodies", () => {
    const messages = [{ role: "user", content: "Return JSON." }];
    expect(helpers.bodyForProfile({
      protocol: "openai_chat",
      model: "model-a",
      capabilities: { streaming: true, jsonMode: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", {}, false)).toMatchObject({
      response_format: { type: "json_object" }
    });

    expect(helpers.bodyForProfile({
      protocol: "openai_responses",
      model: "model-a",
      capabilities: { streaming: true, jsonMode: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", {}, false)).toMatchObject({
      text: { format: { type: "json_object" } }
    });

    expect(helpers.bodyForProfile({
      protocol: "openai_responses",
      model: "model-a",
      capabilities: { streaming: true, jsonMode: true },
      bodyExtra: { text: { format: { type: "json_schema", name: "paper" } } }
    }, messages, "zh-CN", "system", {}, false)).toMatchObject({
      text: { format: { type: "json_schema", name: "paper" } }
    });
  });

  it("passes PDF base64 request input into workbench provider request bodies", () => {
    const messages = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" }
    ];
    const requestInput = {
      type: "pdf_base64",
      source: "pdf_base64",
      base64: "abc123",
      filename: "paper.pdf"
    };

    const openaiBody = helpers.bodyForProfile({
      protocol: "openai_responses",
      model: "model-a",
      capabilities: { streaming: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", requestInput, false);
    expect(openaiBody.input.map((message: any) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(openaiBody.input[1].content[0]).toMatchObject({ type: "output_text", text: "first answer" });
    expect(openaiBody.input[2].content).toEqual(expect.arrayContaining([
      { type: "input_text", text: "second question" },
      expect.objectContaining({
        type: "input_file",
        filename: "paper.pdf",
        file_data: "data:application/pdf;base64,abc123"
      })
    ]));

    const anthropicBody = helpers.bodyForProfile({
      protocol: "anthropic_messages",
      model: "model-a",
      capabilities: { streaming: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", requestInput, false);
    expect(anthropicBody.messages.map((message: any) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(anthropicBody.messages[2].content).toEqual(expect.arrayContaining([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "abc123" }
      },
      expect.objectContaining({ type: "text" })
    ]));
    expect(anthropicBody).not.toHaveProperty("temperature");
    expect(helpers.bodyForProfile({
      protocol: "anthropic_messages",
      model: "model-a",
      capabilities: { streaming: true },
      bodyExtra: { temperature: 0.2 }
    }, messages, "zh-CN", "system", requestInput, false)).toMatchObject({ temperature: 0.2 });
  });

  it("merges consecutive Anthropic workbench messages before sending", () => {
    const body = helpers.bodyForProfile({
      protocol: "anthropic_messages",
      model: "model-a",
      capabilities: { streaming: true },
      bodyExtra: {}
    }, [
      { role: "user", content: "first question" },
      { role: "user", content: "follow-up question" },
      { role: "assistant", content: "first answer" },
      { role: "assistant", content: "second answer" },
      { role: "user", content: "final question" }
    ], "zh-CN", "system", {
      type: "pdf_base64",
      source: "pdf_base64",
      base64: "abc123",
      filename: "paper.pdf"
    }, false);

    expect(body.messages.map((message: any) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(body.messages[0].content).toEqual([{ type: "text", text: "first question\n\nfollow-up question" }]);
    expect(body.messages[1].content).toEqual([{ type: "text", text: "first answer\n\nsecond answer" }]);
    expect(body.messages[2].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "document" }),
      expect.objectContaining({ type: "text" })
    ]));
  });

  it("validates remote profile credentials before sending provider requests", () => {
    const translate = (key: string) => ({ apiKeyMissing: "missing key", modelMissing: "missing model" }[key] || key);
    expect(() => helpers.assertRemoteProfileReady({ apiKey: "", model: "m" }, translate)).toThrow("missing key");
    expect(() => helpers.assertRemoteProfileReady({ apiKey: "sk-test", model: "" }, translate)).toThrow("missing model");
    expect(() => helpers.assertRemoteProfileReady({ apiKey: "sk-test", model: "model-a" }, translate)).not.toThrow();
    expect(() => helpers.assertRemoteProfileReady({
      apiKey: "",
      model: "model-a",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      customHeaders: { Authorization: "Bearer routed-secret" }
    }, translate)).not.toThrow();
    expect(() => helpers.assertRemoteProfileReady({
      apiKey: "",
      model: "deployment-a",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://azure-resource.openai.azure.com/openai/v1",
      customHeaders: { "api-key": "azure-secret" }
    }, translate)).not.toThrow();
    expect(() => helpers.assertRemoteProfileReady({
      apiKey: "",
      model: "local-model",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:11434/v1",
      customHeaders: {}
    }, translate)).not.toThrow();
  });

  it("summarizes the active workbench profile without exposing credentials", () => {
    const translate = (key: string) => ({
      profileProtocolStatus: "协议",
      profileModelStatus: "模型",
      profileEndpointStatus: "Endpoint",
      profileEndpointMissing: "未配置",
      profileModelMissing: "未配置",
      profileModelOptional: "可选",
      profileAuthReady: "鉴权已配置",
      profileAuthMissing: "缺少鉴权",
      profilePdfReady: "支持 PDF 原文输入",
      profilePdfTextOnly: "仅使用文本输入",
      profileStreamReady: "支持流式输出",
      profileStreamOff: "未启用流式输出",
      profileLocalAgentReady: "本地代理已配置",
      noProfile: "无档案"
    }[key] || key);
    const summary = helpers.profileStatusText({
      id: "openai",
      name: "OpenAI",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-4.1",
      capabilities: { pdfBase64: true, streaming: true },
      customHeaders: { Authorization: "Bearer routed-secret" },
      bodyExtra: {}
    }, translate);

    expect(summary).toContain("协议: openai_responses");
    expect(summary).toContain("模型: gpt-4.1");
    expect(summary).toContain("Endpoint: https://api.openai.com/v1/responses");
    expect(summary).toContain("支持 PDF 原文输入");
    expect(summary).toContain("支持流式输出");
    expect(summary).toContain("鉴权已配置");
    expect(summary).not.toContain("sk-test-secret");
    expect(summary).not.toContain("routed-secret");
    expect(helpers.profileStatusText({
      id: "openai",
      name: "OpenAI",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1/responses",
      apiKey: "sk-test-secret",
      model: "response-model",
      capabilities: { pdfBase64: true, streaming: true },
      customHeaders: {},
      bodyExtra: {}
    }, translate)).toContain("Endpoint: https://api.openai.com/v1/responses");
    expect(helpers.profileStatusText({
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com/v1/messages",
      apiKey: "anthropic-secret",
      model: "claude-model",
      capabilities: { pdfBase64: true, streaming: true },
      customHeaders: {},
      bodyExtra: {}
    }, translate)).toContain("Endpoint: https://api.anthropic.com/v1/messages");
    expect(helpers.profileMessageMetadata({ id: "p", name: "P", protocol: "openai_chat", model: "m" }))
      .toEqual({ profileId: "p", profileName: "P", protocol: "openai_chat", model: "m" });
    expect(helpers.profileStatusText({
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test-secret",
      model: "deepseek-chat",
      capabilities: { pdfBase64: false, streaming: true },
      customHeaders: {},
      bodyExtra: {}
    }, translate)).toContain("Endpoint: https://api.deepseek.com/v1/chat/completions");
    expect(helpers.profileStatusText({
      id: "perplexity",
      name: "Perplexity Sonar",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.perplexity.ai",
      apiKey: "pplx-secret",
      model: "sonar-pro",
      capabilities: { pdfBase64: false, streaming: true, modelList: false },
      customHeaders: {},
      bodyExtra: {}
    }, translate)).toContain("Endpoint: https://api.perplexity.ai/chat/completions");
    const localAgentSummary = helpers.profileStatusText({
      id: "local-agents",
      name: "Local Agents",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:3333/v1",
      apiKey: "",
      model: "",
      capabilities: { pdfBase64: false, streaming: false, modelList: false },
      customHeaders: {},
      bodyExtra: { localAgent: { endpoint: "http://127.0.0.1:3333/mcp" } }
    }, translate);
    expect(localAgentSummary).toContain("模型: 可选");
    expect(localAgentSummary).toContain("鉴权已配置");
    expect(localAgentSummary).toContain("本地代理已配置");
  });

  it("keeps custom auth headers when building workbench provider headers", () => {
    expect(helpers.headersForProfile({
      protocol: "openai_chat",
      apiKey: "",
      customHeaders: { Authorization: "Bearer routed-secret" }
    })).toMatchObject({ Authorization: "Bearer routed-secret" });
    expect(helpers.headersForProfile({
      protocol: "openai_chat",
      apiKey: "",
      customHeaders: {}
    })).not.toHaveProperty("authorization");
    expect(helpers.headersForProfile({
      protocol: "openai_chat",
      apiKey: "sk-test-secret",
      customHeaders: { Authorization: "" }
    })).toMatchObject({ Authorization: "Bearer sk-test-secret" });
    expect(helpers.headersForProfile({
      protocol: "openai_responses",
      apiKey: "sk-test-secret",
      customHeaders: { "api-key": "azure-secret" }
    })).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.headersForProfile({
      id: "azure-openai",
      protocol: "openai_responses",
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      customHeaders: { "api-key": "" }
    })).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.headersForProfile({
      protocol: "openai_responses",
      apiKey: "sk-test-secret",
      customHeaders: { "api-key": "azure-secret" }
    })).not.toHaveProperty("authorization");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: { "x-api-key": "" }
    })).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      apiKey: "",
      customHeaders: { "x-api-key": "anthropic-routed-secret" }
    })).toMatchObject({
      "x-api-key": "anthropic-routed-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      apiKey: "sk-test-secret",
      customHeaders: { Authorization: "Bearer routed-secret" }
    })).not.toHaveProperty("x-api-key");
    expect(helpers.headersForProfile({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer deepseek-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.headersForProfile({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer zai-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization" }
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization", directBrowserAccess: true }
    })).toMatchObject({
      authorization: "Bearer routed-secret",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: {},
      bodyExtra: { directBrowserAccess: false }
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
  });

  it("flushes the final workbench stream event without a trailing newline", async () => {
    const response = {
      body: streamFromText("data: {\"type\":\"response.output_text.delta\",\"delta\":\"tail\"}")
    };
    const deltas: string[] = [];
    const text = await helpers.readStream(response, "openai_responses", (delta) => deltas.push(delta));

    expect(text).toBe("tail");
    expect(deltas).toEqual(["tail"]);
  });

  it("does not duplicate OpenAI Responses done snapshots in workbench streams", async () => {
    const response = {
      body: streamFromText([
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"streamed\"}",
        "data: {\"type\":\"response.content_part.done\",\"part\":{\"type\":\"output_text\",\"text\":\"streamed\"}}"
      ].join("\n"))
    };
    const deltas: string[] = [];
    const text = await helpers.readStream(response, "openai_responses", (delta) => deltas.push(delta));

    expect(text).toBe("streamed");
    expect(deltas).toEqual(["streamed"]);
  });

  it("uses OpenAI Responses done snapshots as a workbench stream fallback", async () => {
    const response = {
      body: streamFromText("data: {\"type\":\"response.output_item.done\",\"item\":{\"content\":[{\"type\":\"output_text\",\"text\":\"snapshot\"}]}}")
    };
    const deltas: string[] = [];
    const text = await helpers.readStream(response, "openai_responses", (delta) => deltas.push(delta));

    expect(text).toBe("snapshot");
    expect(deltas).toEqual(["snapshot"]);
  });

  it("extracts compatible chat stream text without leaking reasoning tokens", async () => {
    const response = {
      body: streamFromText([
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hidden\"}}]}",
        "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"reasoning\",\"text\":\"hidden\"},{\"type\":\"text\",\"text\":\"visible\"}]}}]}",
        "data: {\"choices\":[{\"message\":{\"content\":[{\"type\":\"output_text\",\"text\":\" tail\"}]}}]}"
      ].join("\n"))
    };
    const deltas: string[] = [];
    const text = await helpers.readStream(response, "openai_chat", (delta) => deltas.push(delta));

    expect(text).toBe("visible tail");
    expect(deltas).toEqual(["visible", " tail"]);
  });

  it("throws redacted errors from workbench stream error events", async () => {
    const response = {
      body: streamFromText("data: {\"type\":\"error\",\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"Too many requests for sk-test-secret\"}}\n")
    };

    await expect(helpers.readStream(response, "openai_responses", () => undefined)).rejects.toThrow("rate_limit_exceeded - Too many requests for [redacted]");
  });

  it("throws redacted errors from workbench non-stream response bodies", () => {
    expect(() => helpers.extractResponseText("openai_responses", {
      error: { code: "rate_limit_exceeded", message: "Too many requests for sk-test-secret" }
    })).toThrow("rate_limit_exceeded - Too many requests for [redacted]");
    expect(() => helpers.extractResponseText("anthropic_messages", {
      type: "error",
      error: { type: "overloaded_error", message: "Bearer routed-secret overloaded" }
    })).toThrow("overloaded_error - Bearer [redacted] overloaded");
  });

  it("extracts OpenAI-compatible non-stream response text variants in workbench", () => {
    expect(helpers.extractResponseText("openai_chat", {
      choices: [{ text: "legacy completion text" }]
    })).toBe("legacy completion text");
    expect(helpers.extractResponseText("openai_chat", {
      choices: [{ delta: { content: [{ type: "text", text: "delta content" }] } }]
    })).toBe("delta content");
    expect(helpers.extractResponseText("openai_chat", {
      content: [{ type: "text", text: "top-level content" }]
    })).toBe("top-level content");
    expect(helpers.extractResponseText("openai_responses", {
      response: { output_text: "wrapped response text" }
    })).toBe("wrapped response text");
    expect(helpers.extractResponseText("anthropic_messages", {
      content: "compatible anthropic text"
    })).toBe("compatible anthropic text");
  });

  it("normalizes session file paths for item-key scoped JSONL history", () => {
    expect(helpers.sessionFilenameFor("../chat one.jsonl")).toBe("chat-one.jsonl");
    expect(helpers.sessionIdFromPath("/tmp/zms/sessions/ITEM/chat-42.jsonl")).toBe("chat-42");
    expect(helpers.recentSessionFiles([
      "/tmp/chat-01.jsonl",
      "/tmp/readme.md",
      "/tmp/chat-10.jsonl",
      "/tmp/chat-02.jsonl"
    ])).toEqual([
      "/tmp/chat-01.jsonl",
      "/tmp/chat-02.jsonl",
      "/tmp/chat-10.jsonl"
    ]);
  });

  it("builds collection-scoped candidate JSONL paths", () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroCollections.set(10, { key: "COL: A/B" });

    expect(loaded.candidateJsonlPath("/tmp/out", {
      key: "ITEM",
      getCollections: () => [10]
    })).toBe("/tmp/out/collections/COL A B/sources/candidates.jsonl");
    expect(loaded.candidateJsonlPath("/tmp/out", { key: "ITEM" }))
      .toBe("/tmp/out/collections/ITEM/sources/candidates.jsonl");
  });

  it("parses, renders, and updates candidate decision JSONL", () => {
    const records = [
      {
        candidateId: "doi:10.1000/a",
        title: "Candidate A",
        decision: "user_pending",
        updatedAt: "2026-06-13T00:00:00.000Z",
        sources: ["crossref"],
        quality: { dedupeStatus: "new" }
      },
      {
        candidateId: "doi:10.1000/b",
        title: "Candidate B",
        decision: "exclude",
        updatedAt: "2026-06-13T00:00:00.000Z",
        sources: ["semantic_scholar"],
        quality: { dedupeStatus: "new" }
      }
    ];

    const parsed = helpers.parseCandidateJsonl(`${helpers.renderCandidateJsonl(records)}\n`);
    const updated = helpers.applyCandidateDecisions(parsed, { "doi:10.1000/a": "include" }, "2026-06-13T00:01:00.000Z");

    expect(updated[0]).toMatchObject({
      candidateId: "doi:10.1000/a",
      decision: "include",
      updatedAt: "2026-06-13T00:01:00.000Z"
    });
    expect(helpers.candidateDecisionCounts(updated)).toEqual({
      include: 1,
      exclude: 1,
      to_read: 0,
      user_pending: 0
    });
    expect(helpers.candidateStatusText(updated, "/tmp/candidates.jsonl", (key) => key))
      .toContain("candidateInclude: 1");
    expect(() => helpers.parseCandidateJsonl("{bad json}\n")).toThrow("Invalid candidates.jsonl line 1");
  });

  it("creates import ledger entries for discovery and decision changes", () => {
    const record = {
      candidateId: "doi:10.1000/a",
      title: "Candidate A",
      decision: "include",
      discoveredAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:01:00.000Z",
      collectionKey: "COL",
      sourceUrl: "https://doi.org/10.1000/a",
      ids: { doi: "10.1000/a", arxivId: "2401.00001" },
      sources: ["crossref"],
      quality: { dedupeStatus: "new" }
    };

    expect(helpers.importLedgerJsonlPath("/tmp/out", { key: "ITEM" }))
      .toBe("/tmp/out/collections/ITEM/sources/import-ledger.jsonl");
    expect(helpers.discoveredLedgerEntries([record], new Set())).toEqual([
      expect.objectContaining({
        id: "doi:10.1000/a:discovered:2026-06-13T00:00:00.000Z",
        action: "discovered",
        candidateId: "doi:10.1000/a",
        doi: "10.1000/a",
        arxivId: "2401.00001",
        dedupeStatus: "new"
      })
    ]);
    expect(helpers.discoveredLedgerEntries([record], new Set(["doi:10.1000/a"]))).toEqual([]);
    expect(helpers.decisionLedgerEntries(
      [record],
      new Map([["doi:10.1000/a", "user_pending"]]),
      { "doi:10.1000/a": "include" },
      "2026-06-13T00:02:00.000Z"
    )).toEqual([
      expect.objectContaining({
        id: "doi:10.1000/a:confirmed:2026-06-13T00:02:00.000Z",
        action: "confirmed",
        decision: "include"
      })
    ]);
    expect(helpers.renderImportLedgerJsonl(helpers.discoveredLedgerEntries([record], new Set())))
      .toContain("\"action\":\"discovered\"");
  });

  it("imports included candidates as metadata-only Zotero items", async () => {
    const loaded = loadWorkbenchHelpers();
    const record = {
      candidateId: "doi:10.1000/a",
      title: "Candidate A",
      authors: ["Ada One", "Turing, Alan"],
      year: 2024,
      venue: "Journal A",
      abstract: "Abstract text.",
      sourceUrl: "https://doi.org/10.1000/a",
      pdfUrl: "https://example.test/a.pdf",
      decision: "include",
      collectionKey: "COL",
      ids: { doi: "10.1000/a", arxivId: "2401.00001", semanticScholarId: "S2-A" },
      sources: ["crossref", "semantic_scholar"],
      quality: { dedupeStatus: "new", isAbstractOnly: false }
    };
    const contextItem = {
      libraryID: 7,
      getCollections: () => [10]
    };

    const result = await loaded.importCandidateIntoZotero(record, contextItem, "2026-06-13T00:03:00.000Z");

    expect(result).toMatchObject({
      candidateId: "doi:10.1000/a",
      action: "imported",
      zoteroItemID: 1000,
      zoteroItemKey: "NEW1000"
    });
    expect(loaded.__createdItems).toHaveLength(1);
    const item = loaded.__createdItems[0];
    expect(item.libraryID).toBe(7);
    expect(item.fields).toMatchObject({
      title: "Candidate A",
      date: "2024",
      DOI: "10.1000/a",
      url: "https://doi.org/10.1000/a",
      abstractNote: "Abstract text.",
      publicationTitle: "Journal A"
    });
    expect(item.fields.extra).toContain("Open PDF: https://example.test/a.pdf");
    expect(item.fields.extra).toContain("Candidate Sources: crossref, semantic_scholar");
    expect(item.creators).toEqual([
      { creatorType: "author", firstName: "Ada", lastName: "One", fieldMode: 0 },
      { creatorType: "author", firstName: "Alan", lastName: "Turing", fieldMode: 0 }
    ]);
    expect(item.collections).toEqual([10]);
  });

  it("skips existing Zotero DOI matches before candidate import", async () => {
    const loaded = loadWorkbenchHelpers();
    const existing = {
      id: 42,
      key: "EXISTING",
      collections: [] as any[],
      addToCollection(collectionID: any) {
        this.collections.push(collectionID);
      },
      async saveTx() {
        return this.id;
      }
    };
    loaded.__zoteroItems.set(42, existing);
    loaded.__searchResults.push(42);

    const result = await loaded.importCandidateIntoZotero({
      candidateId: "doi:10.1000/a",
      title: "Candidate A",
      decision: "include",
      ids: { doi: "10.1000/a" },
      sources: ["crossref"],
      quality: { dedupeStatus: "new" }
    }, {
      libraryID: 7,
      getCollections: () => [10]
    }, "2026-06-13T00:03:00.000Z");

    expect(result).toMatchObject({
      action: "skipped_duplicate",
      zoteroItemID: 42,
      zoteroItemKey: "EXISTING"
    });
    expect(existing.collections).toEqual([10]);
    expect(loaded.__createdItems).toHaveLength(0);
  });

  it("skips existing Zotero title matches when candidate has no DOI", async () => {
    const loaded = loadWorkbenchHelpers();
    const existing = {
      id: 43,
      key: "TITLEMATCH",
      fields: { title: "Low Altitude UAV Conflict Resolution" } as Record<string, string>,
      collections: [] as any[],
      getField(field: string) {
        return this.fields[field] || "";
      },
      addToCollection(collectionID: any) {
        this.collections.push(collectionID);
      },
      async saveTx() {
        return this.id;
      }
    };
    loaded.__zoteroItems.set(43, existing);
    loaded.__searchResults.push(43);

    const result = await loaded.importCandidateIntoZotero({
      candidateId: "title:low-altitude-uav-conflict-resolution",
      title: "Low-Altitude UAV: Conflict Resolution",
      decision: "include",
      ids: {},
      sources: ["arxiv"],
      quality: { dedupeStatus: "new" }
    }, {
      libraryID: 7,
      getCollections: () => [10]
    }, "2026-06-13T00:03:00.000Z");

    expect(result).toMatchObject({
      action: "skipped_duplicate",
      zoteroItemID: 43,
      zoteroItemKey: "TITLEMATCH"
    });
    expect(existing.collections).toEqual([10]);
    expect(loaded.__createdItems).toHaveLength(0);
  });

  it("filters importable candidates and records import result metadata", () => {
    const loaded = loadWorkbenchHelpers();
    const records = [
      { candidateId: "a", decision: "include", quality: { dedupeStatus: "new", isAbstractOnly: false }, ids: {}, sources: [] },
      { candidateId: "b", decision: "include", quality: { dedupeStatus: "duplicate", isAbstractOnly: false }, ids: {}, sources: [] },
      { candidateId: "c", decision: "include", quality: { dedupeStatus: "new", isAbstractOnly: true }, ids: {}, sources: [] },
      { candidateId: "d", decision: "to_read", quality: { dedupeStatus: "new", isAbstractOnly: false }, ids: {}, sources: [] }
    ];
    const resultById = new Map([
      ["a", { candidateId: "a", action: "imported", zoteroItemID: 1000, zoteroItemKey: "NEW1000", at: "2026-06-13T00:03:00.000Z" }]
    ]);
    const updated = loaded.applyCandidateImportResults(records, resultById, "2026-06-13T00:04:00.000Z");

    expect(loaded.importableCandidateRecords(records).map((record: any) => record.candidateId)).toEqual(["a"]);
    expect(updated[0]).toMatchObject({
      importStatus: "imported",
      zoteroItemID: 1000,
      zoteroItemKey: "NEW1000",
      importedAt: "2026-06-13T00:03:00.000Z",
      updatedAt: "2026-06-13T00:04:00.000Z"
    });
    expect(loaded.importResultLedgerEntries(updated, resultById, "2026-06-13T00:04:00.000Z")).toEqual([
      expect.objectContaining({
        candidateId: "a",
        action: "imported",
        zoteroItemKey: "NEW1000"
      })
    ]);
  });

  it("attaches candidate PDFs to imported Zotero items", async () => {
    const loaded = loadWorkbenchHelpers();
    const item = {
      id: 42,
      key: "ITEM42",
      libraryID: 7,
      getAttachments: () => []
    };
    loaded.__zoteroItems.set(42, item);

    const result = await loaded.attachCandidatePdfToZotero({
      candidateId: "doi:10.1000/a",
      title: "Candidate A",
      decision: "include",
      importStatus: "imported",
      zoteroItemID: 42,
      zoteroItemKey: "ITEM42",
      pdfUrl: "https://example.test/a.pdf",
      ids: { doi: "10.1000/a" },
      sources: ["crossref"],
      quality: { dedupeStatus: "new" }
    }, {
      libraryID: 7
    }, "2026-06-13T00:05:00.000Z");

    expect(result).toMatchObject({
      candidateId: "doi:10.1000/a",
      action: "attached_pdf",
      zoteroItemID: 42,
      zoteroItemKey: "ITEM42",
      attachmentKey: "ATT1000"
    });
    expect(loaded.__urlAttachments).toEqual([
      expect.objectContaining({
        url: "https://example.test/a.pdf",
        parentItemID: 42,
        libraryID: 7,
        contentType: "application/pdf",
        title: "Candidate A.pdf"
      })
    ]);
  });

  it("uses existing PDF attachments before downloading candidate PDFs", async () => {
    const loaded = loadWorkbenchHelpers();
    const item = {
      id: 42,
      key: "ITEM42",
      libraryID: 7,
      getAttachments: () => [77]
    };
    const pdf = {
      id: 77,
      key: "PDF77",
      attachmentContentType: "application/pdf",
      getField: (field: string) => field === "url" ? "https://example.test/a.pdf" : ""
    };
    loaded.__zoteroItems.set(42, item);
    loaded.__zoteroItems.set(77, pdf);

    const result = await loaded.attachCandidatePdfToZotero({
      candidateId: "doi:10.1000/a",
      title: "Candidate A",
      decision: "include",
      importStatus: "skipped_duplicate",
      zoteroItemID: 42,
      zoteroItemKey: "ITEM42",
      pdfUrl: "https://example.test/a.pdf",
      ids: { doi: "10.1000/a" },
      sources: ["crossref"],
      quality: { dedupeStatus: "new" }
    }, {
      libraryID: 7
    }, "2026-06-13T00:05:00.000Z");

    expect(result).toMatchObject({
      action: "attached_pdf",
      attachmentKey: "PDF77",
      message: "Existing PDF attachment found"
    });
    expect(loaded.__urlAttachments).toHaveLength(0);
  });

  it("filters PDF attachable candidates and records PDF attachment metadata", () => {
    const loaded = loadWorkbenchHelpers();
    const records = [
      { candidateId: "a", title: "A", decision: "include", importStatus: "imported", zoteroItemID: 42, zoteroItemKey: "ITEM42", pdfUrl: "https://example.test/a.pdf", ids: {}, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "b", title: "B", decision: "include", importStatus: "imported", zoteroItemID: 43, zoteroItemKey: "ITEM43", ids: {}, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "c", title: "C", decision: "include", pdfUrl: "https://example.test/c.pdf", ids: {}, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "d", title: "D", decision: "include", importStatus: "imported", pdfUrl: "https://example.test/d.pdf", pdfAttachmentStatus: "attached_pdf", ids: {}, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "e", title: "E", decision: "to_read", importStatus: "imported", pdfUrl: "https://example.test/e.pdf", ids: {}, sources: [], quality: { dedupeStatus: "new" } }
    ];
    const resultById = new Map([
      ["a", { candidateId: "a", action: "attached_pdf", zoteroItemID: 42, zoteroItemKey: "ITEM42", attachmentKey: "ATT1000", at: "2026-06-13T00:05:00.000Z" }],
      ["b", { candidateId: "b", action: "missing_pdf", zoteroItemID: 43, zoteroItemKey: "ITEM43", at: "2026-06-13T00:05:00.000Z", message: "No PDF URL available" }]
    ]);
    const updated = loaded.applyCandidatePdfAttachmentResults(records, resultById, "2026-06-13T00:06:00.000Z");

    expect(loaded.pdfAttachableCandidateRecords(records).map((record: any) => record.candidateId)).toEqual(["a", "b"]);
    expect(updated[0]).toMatchObject({
      pdfAttachmentStatus: "attached_pdf",
      pdfAttachmentKey: "ATT1000",
      pdfAttachedAt: "2026-06-13T00:05:00.000Z",
      updatedAt: "2026-06-13T00:06:00.000Z"
    });
    expect(updated[1]).toMatchObject({
      pdfAttachmentStatus: "missing_pdf",
      pdfAttachmentError: "",
      updatedAt: "2026-06-13T00:06:00.000Z"
    });
    expect(loaded.pdfAttachmentLedgerEntries(updated, resultById, "2026-06-13T00:06:00.000Z")).toEqual([
      expect.objectContaining({
        candidateId: "a",
        action: "attached_pdf",
        attachmentKey: "ATT1000"
      }),
      expect.objectContaining({
        candidateId: "b",
        action: "missing_pdf",
        message: "No PDF URL available"
      })
    ]);
  });

  it("marks post-import candidate duplicates by DOI, Zotero item key, and normalized title", () => {
    const loaded = loadWorkbenchHelpers();
    const records = [
      { candidateId: "a", title: "Low Altitude UAV Conflict Resolution", year: 2024, decision: "include", importStatus: "imported", zoteroItemID: 42, zoteroItemKey: "ITEM42", ids: { doi: "10.1000/A" }, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "b", title: "Another title", year: 2024, decision: "include", importStatus: "imported", zoteroItemID: 43, zoteroItemKey: "ITEM43", ids: { doi: "https://doi.org/10.1000/a" }, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "c", title: "Shared Zotero Item", year: 2025, decision: "include", importStatus: "skipped_duplicate", zoteroItemID: 44, zoteroItemKey: "ITEM44", ids: {}, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "d", title: "Shared Zotero Item Variant", year: 2025, decision: "include", importStatus: "skipped_duplicate", zoteroItemID: 44, zoteroItemKey: "ITEM44", ids: {}, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "e", title: "A Very Specific Low Altitude UAV Conflict Resolution Method", year: 2026, decision: "include", importStatus: "imported", ids: {}, sources: [], quality: { dedupeStatus: "new" } },
      { candidateId: "f", title: "A very-specific low altitude UAV: conflict resolution method", year: 2026, decision: "include", importStatus: "imported", ids: {}, sources: [], quality: { dedupeStatus: "new" } }
    ];

    const result = loaded.reconcileCandidateDuplicateRecords(records, "2026-06-13T00:07:00.000Z");

    expect(result.duplicateCount).toBe(3);
    expect(result.records[1]).toMatchObject({
      quality: {
        dedupeStatus: "duplicate",
        matchedCandidateId: "a",
        matchedItemKey: "ITEM42"
      },
      updatedAt: "2026-06-13T00:07:00.000Z"
    });
    expect(result.records[3]).toMatchObject({
      quality: {
        dedupeStatus: "duplicate",
        matchedCandidateId: "c",
        matchedItemKey: "ITEM44"
      }
    });
    expect(result.records[5]).toMatchObject({
      quality: {
        dedupeStatus: "duplicate",
        matchedCandidateId: "e"
      }
    });
    expect(result.ledgerEntries).toEqual([
      expect.objectContaining({ candidateId: "b", action: "skipped_duplicate", zoteroItemKey: "ITEM42" }),
      expect.objectContaining({ candidateId: "d", action: "skipped_duplicate", zoteroItemKey: "ITEM44" }),
      expect.objectContaining({ candidateId: "f", action: "skipped_duplicate" })
    ]);
  });

  it("loads and saves candidate records through the workbench file helpers", async () => {
    const path = "/tmp/out/collections/COL/sources/candidates.jsonl";
    const files = new Map<string, string>([
      [path, "{\"candidateId\":\"doi:10.1000/a\",\"title\":\"Candidate A\",\"decision\":\"user_pending\",\"sources\":[\"crossref\"],\"quality\":{\"dedupeStatus\":\"new\"}}\n"]
    ]);
    const loaded = loadWorkbenchHelpers(files);

    const records = await loaded.loadCandidateRecords(path);
    const updated = loaded.applyCandidateDecisions(records, { "doi:10.1000/a": "to_read" }, "2026-06-13T00:02:00.000Z");
    await loaded.saveCandidateRecords(path, updated);

    expect(JSON.parse((files.get(path) || "").trim())).toMatchObject({
      candidateId: "doi:10.1000/a",
      decision: "to_read",
      updatedAt: "2026-06-13T00:02:00.000Z"
    });
    await expect(loaded.loadCandidateRecords("/tmp/out/missing.jsonl")).rejects.toThrow("/tmp/out/missing.jsonl");
  });

  it("searches candidate sources from the workbench and writes candidates.jsonl", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument({
      "zms-candidate-query": "low altitude UAV conflict",
      "zms-candidate-limit": "5",
      "zms-candidate-email": "",
      "zms-candidate-semantic-key": ""
    });
    (loaded as any).document = dom;
    (loaded as any).window.ZMSCandidateSources = loadCandidateSourcesRuntime();
    (loaded as any).fetch = async (url: string) => {
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () => `<feed xmlns:arxiv="http://arxiv.org/schemas/atom">
            <entry>
              <id>https://arxiv.org/abs/2401.00001</id>
              <published>2024-01-01T00:00:00Z</published>
              <title>Low Altitude UAV Conflict Resolution</title>
              <author><name>A One</name></author>
              <arxiv:doi>10.1000/uav</arxiv:doi>
              <summary>Arxiv abstract.</summary>
              <link href="https://arxiv.org/pdf/2401.00001" rel="related" title="pdf"/>
            </entry>
          </feed>`
        };
      }
      if (url.includes("semanticscholar.org")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [] })
        };
      }
      if (url.includes("crossref.org")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ message: { items: [] } })
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    };
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.item = {
      key: "ITEM",
      getField: (field: string) => field === "title" ? "Paper Title" : "",
      getCollections: () => [10]
    };
    workbench.state.candidates = [];
    workbench.t = (key: string) => key;

    await workbench.searchCandidates();

    const path = "/tmp/out/collections/COL/sources/candidates.jsonl";
    const ledgerPath = "/tmp/out/collections/COL/sources/import-ledger.jsonl";
    const lines = (files.get(path) || "").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const ledgerLines = (files.get(ledgerPath) || "").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      candidateId: "doi:10.1000/uav",
      title: "Low Altitude UAV Conflict Resolution",
      decision: "user_pending",
      query: "low altitude UAV conflict",
      collectionKey: "COL"
    });
    expect(ledgerLines).toHaveLength(1);
    expect(ledgerLines[0]).toMatchObject({
      candidateId: "doi:10.1000/uav",
      action: "discovered",
      collectionKey: "COL",
      doi: "10.1000/uav"
    });
    expect(dom.elements.get("zms-status").textContent).toContain("candidateSearchDone: 1");
    expect(dom.elements.get("zms-candidate-list").children).toHaveLength(1);
  });

  it("continues saving to the loaded JSONL session file", async () => {
    const files = new Map([
      ["/tmp/out/sessions/ITEM/chat-older.jsonl", "{\"role\":\"user\",\"content\":\"old\"}\n"]
    ]);
    const loaded = loadWorkbenchHelpers(files);
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.item = { key: "ITEM" };
    workbench.state.sessionId = "chat-new";
    workbench.renderMessages = () => undefined;
    workbench.setStatus = () => undefined;
    workbench.t = (key: string) => key;

    await workbench.loadSession("/tmp/out/sessions/ITEM/chat-older.jsonl");

    expect(workbench.state.sessionId).toBe("chat-older");
    expect(workbench.sessionPath()).toBe("/tmp/out/sessions/ITEM/chat-older.jsonl");
    expect(workbench.state.messages).toEqual([{ role: "user", content: "old" }]);
  });

  it("keeps per-message provider metadata when saving a mixed-profile session", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.item = { key: "ITEM" };
    workbench.state.sessionId = "chat-1";
    workbench.state.profile = {
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic_messages",
      model: "claude-3-5"
    };
    workbench.state.uiLanguage = "en-US";
    workbench.state.outputLanguage = "zh-CN";
    workbench.state.messages = [
      {
        role: "user",
        content: "old",
        profileId: "openai",
        profileName: "OpenAI",
        protocol: "openai_responses",
        model: "gpt-4.1"
      },
      { role: "assistant", content: "new" }
    ];
    workbench.renderSessions = async () => undefined;
    workbench.setStatus = () => undefined;
    workbench.t = (key: string) => key;

    await workbench.saveSession();

    const lines = (files.get("/tmp/out/sessions/ITEM/chat-1.jsonl") || "").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({
      role: "user",
      profileId: "openai",
      profileName: "OpenAI",
      protocol: "openai_responses",
      model: "gpt-4.1"
    });
    expect(lines[1]).toMatchObject({
      role: "assistant",
      profileId: "anthropic",
      profileName: "Anthropic",
      protocol: "anthropic_messages",
      model: "claude-3-5"
    });
  });

  it("binds workbench actions from script instead of relying on inline handlers", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument();
    (loaded as any).document = dom;
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    let sends = 0;
    workbench.send = async () => {
      sends += 1;
    };

    workbench.bindActions();
    workbench.bindActions();

    const sendButton = dom.elements.get("zms-send");
    const input = dom.elements.get("zms-input");
    expect(sendButton.eventListeners.get("click")).toHaveLength(1);
    expect(input.eventListeners.get("keydown")).toHaveLength(1);
    await sendButton.eventListeners.get("click")[0]({ preventDefault() {} });
    expect(sends).toBe(1);
    expect(sendButton.dataset.zmsBound).toBe("1");
    expect(input.dataset.zmsShortcutBound).toBe("1");
    expect(input.dataset.zmsFocusBound).toBe("1");

    await input.eventListeners.get("click")[0]();
    expect(input.focusCalls).toBe(1);
    expect(input.lastFocusOptions).toEqual({ preventScroll: true });

    let prevented = 0;
    await input.eventListeners.get("keydown")[0]({
      key: "Enter",
      metaKey: true,
      ctrlKey: false,
      preventDefault() {
        prevented += 1;
      }
    });
    expect(sends).toBe(2);
    expect(prevented).toBe(1);

    await input.eventListeners.get("keydown")[0]({
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      preventDefault() {
        prevented += 1;
      }
    });
    expect(sends).toBe(2);
    expect(prevented).toBe(1);
  });

  it("opens the settings drawer from the single settings control", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument();
    (loaded as any).document = dom;
    const rootAttrs: Record<string, string> = {};
    const documentListeners = new Map<string, Array<(event?: any) => void>>();
    (loaded as any).document.documentElement = {
      setAttribute(name: string, value: string) {
        rootAttrs[name] = value;
      }
    };
    (loaded as any).document.addEventListener = (type: string, listener: (event?: any) => void) => {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    };
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;

    workbench.bindActions();
    await dom.elements.get("zms-settings-toggle").eventListeners.get("click")[0]({ preventDefault() {} });

    expect(rootAttrs["data-settings-open"]).toBe("true");
    expect(dom.elements.get("zms-settings-panel")["aria-hidden"]).toBe("false");
    expect(dom.elements.get("zms-settings-toggle")["aria-expanded"]).toBe("true");

    await dom.elements.get("zms-settings-close").eventListeners.get("click")[0]({ preventDefault() {} });
    expect(rootAttrs["data-settings-open"]).toBe("false");
    expect(dom.elements.get("zms-settings-panel")["aria-hidden"]).toBe("true");

    await dom.elements.get("zms-settings-toggle").eventListeners.get("click")[0]({ preventDefault() {} });
    expect(rootAttrs["data-settings-open"]).toBe("true");
    await documentListeners.get("keydown")?.[0]?.({ key: "Escape", preventDefault() {} });
    expect(rootAttrs["data-settings-open"]).toBe("false");
  });

  it("copies assistant Markdown from the prominent answer button", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument();
    (loaded as any).document = dom;
    let copiedText = "";
    (loaded as any).navigator.clipboard.writeText = async (text: string) => {
      copiedText = text;
    };
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    const labels: Record<string, string> = {
      copyAnswer: "Copy Markdown",
      copyAnswerTitle: "Copy raw Markdown",
      copied: "Copied",
      retry: "Retry",
      write: "Write"
    };
    workbench.t = (key: string) => labels[key] || key;
    (loaded as any).window.ZMSMarkdownRenderer = {
      renderMarkdown(markdown: string) {
        const node = dom.createElementNS("http://www.w3.org/1999/xhtml", "div");
        node.className = "rendered";
        node.textContent = markdown;
        return node;
      }
    };

    workbench.appendMessageElement({
      id: "assistant-copy",
      role: "assistant",
      content: "<think>private reasoning</think>\n\n## Result\n\nInline $x^2$"
    });

    const assistant = dom.elements.get("zms-messages").children[0];
    const toolbar = assistant.children[0];
    const copyButton = toolbar.children[0];
    await copyButton.onclick();

    expect(copyButton.className).toBe("zms-message-copy");
    expect(copiedText).toBe("## Result\n\nInline $x^2$");
    expect(copyButton.textContent).toBe("Copied");
    expect(dom.elements.get("zms-chat-status").textContent).toBe("Copied");
    const body = assistant.children[1];
    expect(body.children[0].className).toBe("zms-think");
    expect(body.children[0].children[1].textContent).toBe("private reasoning");
    expect(assistant.children[2].children.map((child: any) => child.textContent)).toEqual(["Retry", "Write"]);
  });

  it("renders assistant streaming output through the markdown renderer", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument({
      "zms-input": "question",
      "zms-skill": ""
    });
    (loaded as any).document = dom;
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    workbench.state.item = { key: "ITEM" };
    workbench.state.profile = providerProfile();
    workbench.state.messages = [];
    workbench.state.outputLanguage = "zh-CN";
    workbench.state.uiLanguage = "en-US";
    workbench.t = (key: string) => key;
    workbench.saveSession = async () => undefined;
    const rendered: string[] = [];
    (loaded as any).window.ZMSMarkdownRenderer = {
      renderMarkdown(markdown: string) {
        rendered.push(markdown);
        const node = dom.createElementNS("http://www.w3.org/1999/xhtml", "div");
        node.className = "rendered";
        node.textContent = markdown;
        return node;
      }
    };
    workbench.callModel = async (_content: string, _skillId: string, onDelta: (delta: string) => void) => {
      onDelta("## Result\n");
      onDelta("Inline $x^2$");
      return "";
    };

    await workbench.send();

    expect(rendered).toContain("## Result");
    expect(rendered).toContain("## Result\nInline $x^2$");
    const assistant = dom.elements.get("zms-messages").children.find((child: any) => child.className.includes("zms-message-assistant"));
    const body = assistant.children.find((child: any) => child.className === "zms-message-body");
    expect(body.children.at(-1).className).toContain("zms-markdown");
  });

  it("prevents overlapping send requests from replacing the active abort controller", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument({
      "zms-input": "first question",
      "zms-skill": ""
    });
    (loaded as any).document = dom;
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    workbench.state.item = { key: "ITEM" };
    workbench.state.profile = providerProfile();
    workbench.state.messages = [];
    workbench.state.outputLanguage = "zh-CN";
    workbench.state.uiLanguage = "en-US";
    workbench.t = (key: string) => key;
    workbench.saveSession = async () => undefined;

    let resolveFirst!: (value: string) => void;
    const firstResponse = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    let calls = 0;
    workbench.callModel = async () => {
      calls += 1;
      return calls === 1 ? firstResponse : "second answer";
    };

    const firstSend = workbench.send();
    expect(workbench.state.requestInFlight).toBe(true);
    expect(dom.elements.get("zms-send").disabled).toBe(true);
    expect(dom.elements.get("zms-stop").disabled).toBe(false);
    dom.elements.get("zms-input").value = "second question";
    await workbench.send();

    expect(calls).toBe(1);
    expect(workbench.state.messages).toHaveLength(2);
    expect(dom.elements.get("zms-status").textContent).toBe("thinking");

    resolveFirst("first answer");
    await firstSend;
    expect(workbench.state.requestInFlight).toBe(false);
    expect(dom.elements.get("zms-send").disabled).toBe(false);
    expect(dom.elements.get("zms-stop").disabled).toBe(true);

    dom.elements.get("zms-input").value = "third question";
    await workbench.send();
    expect(calls).toBe(2);
    expect(workbench.state.messages).toHaveLength(4);
  });

  it("creates a new writable summary when an existing summary attachment has no file path", async () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroItems.set(1, {
      getField: () => "Markdown 摘要 - ITEM.md",
      getFilePathAsync: async () => ""
    });
    const item = {
      id: 7,
      key: "ITEM",
      isRegularItem: () => true,
      getField: (field: string) => field === "title" ? "Paper Title" : "",
      getAttachments: () => [1]
    };

    const summary = await loaded.ensureSummaryFile(item, { key: "PDF" }, "/tmp/out", {
      outputLanguage: "zh-CN",
      inputMode: "text",
      sourceHash: "hash",
      summaryVersion: "1",
      provider: "openai",
      model: "model-a"
    });

    expect(summary).toEqual({ path: "/tmp/out/ITEM.zh-CN.summary.md", created: true });
    expect(loaded.__writes.get(summary.path)).toContain("zoteroItemKey: ITEM");
    expect(loaded.__writes.get(summary.path)).toContain("inputMode: text");
    expect(loaded.__writes.get(summary.path)).toContain("summaryType: paper-chat");
    expect(loaded.__writes.get(summary.path)).toContain("evidenceLevel: fulltext_or_indexed_text");
    expect(loaded.__writes.get(summary.path)).toContain("outputLanguage: zh-CN");
    expect(loaded.__writes.get(summary.path)).toContain("sourceLanguage: auto");
    expect(loaded.__writes.get(summary.path)).toContain("templateVersion: workbench-v1");
    expect(loaded.__linkedAttachments[0]).toMatchObject({
      file: summary.path,
      parentItemID: 7,
      contentType: "text/markdown",
      title: "Markdown 摘要 - ITEM.md"
    });
  });

  it("repairs a stale writable summary attachment instead of linking a duplicate", async () => {
    const loaded = loadWorkbenchHelpers();
    let saved = false;
    const attachment = {
      attachmentPath: "",
      attachmentContentType: "",
      fields: { title: "Markdown 摘要 - ITEM.md" } as Record<string, string>,
      getField(field: string) {
        return this.fields[field] || "";
      },
      setField(field: string, value: string) {
        this.fields[field] = value;
      },
      getFilePathAsync: async () => "/tmp/out/missing.zh-CN.summary.md",
      saveTx: async () => {
        saved = true;
      }
    };
    loaded.__zoteroItems.set(1, attachment);
    const item = {
      id: 7,
      key: "ITEM",
      isRegularItem: () => true,
      getField: (field: string) => field === "title" ? "Paper Title" : "",
      getAttachments: () => [1]
    };

    const summary = await loaded.ensureSummaryFile(item, { key: "PDF" }, "/tmp/out", {
      outputLanguage: "zh-CN",
      inputMode: "text",
      provider: "openai",
      model: "model-a"
    });

    expect(summary).toEqual({ path: "/tmp/out/ITEM.zh-CN.summary.md", created: true });
    expect(saved).toBe(true);
    expect(attachment.attachmentPath).toBe(summary.path);
    expect(attachment.attachmentContentType).toBe("text/markdown");
    expect(attachment.fields.title).toBe("Markdown 摘要 - ITEM.md");
    expect(loaded.__linkedAttachments).toHaveLength(0);
  });

  it("falls back to a new linked summary and restores stale attachment fields when repair fails", async () => {
    const loaded = loadWorkbenchHelpers();
    const attachment = {
      attachmentPath: "/tmp/out/missing.zh-CN.summary.md",
      attachmentContentType: "text/plain",
      fields: { title: "Markdown 摘要 - ITEM.md" } as Record<string, string>,
      getField(field: string) {
        return this.fields[field] || "";
      },
      setField(field: string, value: string) {
        this.fields[field] = value;
      },
      getFilePathAsync: async () => "/tmp/out/missing.zh-CN.summary.md",
      saveTx: async () => {
        throw new Error("save failed");
      }
    };
    loaded.__zoteroItems.set(1, attachment);
    const item = {
      id: 7,
      key: "ITEM",
      isRegularItem: () => true,
      getField: (field: string) => field === "title" ? "Paper Title" : "",
      getAttachments: () => [1]
    };

    const summary = await loaded.ensureSummaryFile(item, { key: "PDF" }, "/tmp/out", {
      outputLanguage: "zh-CN",
      inputMode: "text"
    });

    expect(summary).toEqual({ path: "/tmp/out/ITEM.zh-CN.summary.md", created: true });
    expect(attachment.attachmentPath).toBe("/tmp/out/missing.zh-CN.summary.md");
    expect(attachment.attachmentContentType).toBe("text/plain");
    expect(loaded.__linkedAttachments[0]).toMatchObject({
      file: summary.path,
      parentItemID: 7,
      contentType: "text/markdown",
      title: "Markdown 摘要 - ITEM.md"
    });
  });

  it("includes relevant existing summary chunks in prompt context", () => {
    const prompt = helpers.contextForPrompt({
      metadata: {
        title: "Paper Title",
        authors: ["A. Author"],
        year: "2026",
        doi: "10.123/example"
      },
      chunks: [
        {
          chunkId: "fulltext-0001",
          sourceType: "fulltext",
          locator: "fulltext:1",
          sourceHash: "fullhash",
          text: "Method details without the target term."
        },
        {
          chunkId: "summary-0001",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "sumhash",
          text: "Existing Markdown summary lists validation limitations and caveats."
        }
      ]
    }, "limitations");

    expect(prompt).toContain("Title: Paper Title");
    expect(prompt).toContain("[chunk:summary-0001 source=summary locator=summary:1 hash=sumhash] Existing Markdown summary lists validation limitations and caveats.");
  });

  it("renders context diagnostics with clear missing-source warnings", () => {
    const text = helpers.contextDiagnosticsText({
      hasPdf: false,
      pdfPathAvailable: true,
      fulltextChars: 0,
      annotationCount: 0,
      noteCount: 2,
      summaryChars: 120,
      chunkCount: 3
    }, (key) => ({
      contextQuality: "上下文状态",
      contextChunks: "片段",
      contextFulltextChars: "全文字符",
      contextAnnotations: "注释",
      contextNotes: "笔记",
      contextSummary: "已有摘要字符",
      contextPdfMissing: "未找到 PDF",
      contextPdfPathMissing: "PDF 路径不可用",
      contextFulltextMissing: "PDF 全文索引为空"
    }[key] || key));

    expect(text).toContain("上下文状态: 片段 3; 全文字符 0; 注释 0; 笔记 2; 已有摘要字符 120");
    expect(text).toContain("未找到 PDF");
    expect(text).not.toContain("PDF 全文索引为空");
  });

  it("builds diagnostics while reading paper context sources", async () => {
    const item = {
      key: "ITEM",
      getField: (field: string) => ({
        title: "Paper Title",
        date: "2026",
        DOI: "10.123/example",
        abstractNote: "Abstract text."
      }[field] || ""),
      getCreators: () => [{ firstName: "A.", lastName: "Author" }],
      getNotes: () => [],
      getAttachments: () => []
    };
    const pdf = {
      key: "PDF",
      attachmentText: "Fulltext method paragraph.",
      getFilePathAsync: async () => "/tmp/paper.pdf",
      getAnnotations: () => [
        { annotationType: "highlight", annotationPageLabel: "3", annotationText: "Important claim" }
      ]
    };

    const context = await helpers.buildPaperContext(item, pdf, "/tmp/out");

    expect(context.diagnostics).toMatchObject({
      hasPdf: true,
      pdfPathAvailable: true,
      fulltextChars: "Fulltext method paragraph.".length,
      annotationCount: 1,
      noteCount: 0
    });
    expect(context.chunks.some((chunk: any) => chunk.sourceType === "annotation")).toBe(true);
  });

  it("builds paper context from a top-level PDF attachment", async () => {
    const pdf = {
      id: 12,
      key: "PDF12",
      attachmentContentType: "application/pdf",
      attachmentText: "Top-level PDF full text.",
      getField: (field: string) => field === "title" ? "Standalone PDF" : "",
      getFilePathAsync: async () => "/tmp/standalone.pdf",
      getAnnotations: () => []
    };

    await expect(helpers.findPdfAttachment(pdf)).resolves.toBe(pdf);
    const context = await helpers.buildPaperContext(pdf, pdf, "/tmp/out");

    expect(context.metadata.title).toBe("Standalone PDF");
    expect(context.diagnostics).toMatchObject({
      hasPdf: true,
      pdfPathAvailable: true,
      fulltextChars: "Top-level PDF full text.".length
    });
  });

  it("links writable summaries as top-level files for standalone PDF attachments", async () => {
    const loaded = loadWorkbenchHelpers();
    const pdf = {
      id: 12,
      key: "PDF12",
      libraryID: 1,
      attachmentContentType: "application/pdf",
      isRegularItem: () => false,
      getField: (field: string) => field === "title" ? "Standalone PDF" : ""
    };

    const summary = await loaded.ensureSummaryFile(pdf, pdf, "/tmp/out", {
      outputLanguage: "zh-CN",
      inputMode: "text",
      sourceHash: "hash"
    });

    expect(summary).toEqual({ path: "/tmp/out/PDF12.zh-CN.summary.md", created: true });
    expect(loaded.__linkedAttachments[0]).toMatchObject({
      file: summary.path,
      libraryID: 1,
      contentType: "text/markdown",
      title: "Markdown 摘要 - PDF12.md"
    });
    expect(loaded.__linkedAttachments[0].parentItemID).toBeUndefined();
  });

  it("warns when a PDF exists but path or full-text index is unavailable", () => {
    const text = helpers.contextDiagnosticsText({
      hasPdf: true,
      pdfPathAvailable: false,
      fulltextChars: 0,
      annotationCount: 1,
      noteCount: 0,
      summaryChars: 0,
      chunkCount: 2
    }, (key) => key);

    expect(text).toContain("contextPdfPathMissing");
    expect(text).toContain("contextFulltextMissing");
    expect(text).not.toContain("contextPdfMissing");
  });

  it("describes the effective request input mode and PDF fallback reason", () => {
    const translate = (key: string) => ({
      inputTextMode: "输入：提取文本",
      inputPdfBase64: "输入：PDF 原文",
      inputFallbackUnsupported: "PDF 原文未直传，已使用提取文本：当前接口档案不支持 PDF/base64",
      inputFallbackNoPdf: "PDF 原文未直传，已使用提取文本：未找到 PDF",
      inputFallbackNoPath: "PDF 原文未直传，已使用提取文本：PDF 路径不可用",
      inputFallbackReadFailed: "PDF 原文未直传，已使用提取文本：PDF 读取失败"
    }[key] || key);

    expect(helpers.requestInputStatusText({ type: "text", source: "text_mode" }, translate)).toBe("输入：提取文本");
    expect(helpers.requestInputStatusText({ type: "pdf_base64", source: "pdf_base64" }, translate)).toBe("输入：PDF 原文");
    expect(helpers.requestInputStatusText({ type: "text", source: "unsupported_profile" }, translate))
      .toContain("不支持 PDF/base64");
    expect(helpers.requestInputStatusText({ type: "text", source: "no_pdf" }, translate))
      .toContain("未找到 PDF");
    expect(helpers.requestInputStatusText({ type: "text", source: "no_pdf_path" }, translate))
      .toContain("PDF 路径不可用");
    expect(helpers.requestInputStatusText({ type: "text", source: "read_failed" }, translate))
      .toContain("PDF 读取失败");
  });

  it("formats provider JSON errors without leaking credentials", () => {
    const formatted = helpers.providerErrorText(401, JSON.stringify({
      error: {
        code: "invalid_api_key",
        type: "invalid_request_error",
        message: "Invalid API key sk-test-secret. Authorization: Bearer abc123"
      }
    }));

    expect(formatted).toContain("HTTP 401");
    expect(formatted).toContain("invalid_api_key");
    expect(formatted).toContain("invalid_request_error");
    expect(formatted).toContain("Invalid API key [redacted]");
    expect(formatted).toContain("Bearer [redacted]");
    expect(formatted).not.toContain("sk-test-secret");
    expect(formatted).not.toContain("Bearer abc123");
  });

  it("does not retry non-retryable provider HTTP errors in the workbench request path", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: any[] = [];
    loaded.fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, init });
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({
          error: {
            code: "invalid_api_key",
            message: "Invalid API key sk-test-secret"
          }
        })
      };
    };

    await expect(loaded.requestModelWithRetry(providerProfile(), [
      { role: "user", content: "hello" }
    ], "zh-CN", "system", { type: "text", text: "context" }, false)).rejects.toThrow("invalid_api_key");
    expect(fetchCalls).toHaveLength(1);
  });

  it("retries retryable provider HTTP errors in the workbench request path", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: any[] = [];
    loaded.fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({
            error: {
              code: "rate_limit_exceeded",
              message: "Too many requests for sk-test-secret"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ output_text: "ok" })
      };
    };

    const response = await loaded.requestModelWithRetry(providerProfile(), [
      { role: "user", content: "hello" }
    ], "zh-CN", "system", { type: "text", text: "context" }, false);

    expect(response.ok).toBe(true);
    expect(fetchCalls).toHaveLength(2);
  });

  it("builds request messages from recent conversation without duplicating the latest user message", () => {
    const requestMessages = helpers.requestMessagesWithHistory([
      { role: "system", content: "ignored" },
      { role: "user", content: "old question 1" },
      { role: "assistant", content: "old answer 1" },
      { role: "user", content: "old question 2" },
      { role: "assistant", content: "old answer 2" },
      { role: "user", content: "latest question" }
    ], "latest question", "latest question\n\nPaper metadata...", { limit: 4 });

    expect(requestMessages).toEqual([
      { role: "assistant", content: "old answer 1" },
      { role: "user", content: "old question 2" },
      { role: "assistant", content: "old answer 2" },
      { role: "user", content: "latest question\n\nPaper metadata..." }
    ]);
  });
});
