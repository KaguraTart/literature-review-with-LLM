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
          get: (key: string) => prefValues[key.replace(/^extensions\.zoteroMarkdownSummary\./, "")] ?? "",
          set: (key: string, value: any) => {
            prefValues[key.replace(/^extensions\.zoteroMarkdownSummary\./, "")] = value;
          }
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
    URL,
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
    builtInSkillTemplate: (skillId: string, outputLanguage: string) => string;
    defaultImageQuestion: (outputLanguage: string) => string;
    normalizePromptPackId: (value: string) => string;
    promptPackInstruction: (promptPackId: string, outputLanguage: string) => string;
    promptPackInstructionBlock: (promptPackId: string, outputLanguage: string) => string;
    promptTextForRequest: (skillTemplate: string, savedSummaryPrompt: string, userText: string, promptPackId: string, outputLanguage: string) => string;
    userTextForSend: (rawContent: string, skillId: string, imageCount: number, outputLanguage: string) => string;
    displayTextForSend: (rawContent: string, skillId: string, imageCount: number, outputLanguage: string, labelFor?: (id: string) => string) => string;
    providerBodyExtra: (bodyExtra: any) => Record<string, any>;
    ensureSummaryFile: (item: any, pdf: any, outputDir: string, options?: any) => Promise<any>;
    findPdfAttachment: (item: any) => Promise<any>;
    buildPaperContext: (item: any, pdf: any, outputDir: string) => Promise<any>;
    contextForPrompt: (context: any, query: string) => string;
    contextDiagnosticsText: (diagnostics: any, translate?: (key: string) => string) => string;
    writePreviewSummary: (preview: any, options?: any) => string;
    requestInputStatusText: (requestInput: any, translate?: (key: string) => string) => string;
    profileStatusText: (profile: any, translate?: (key: string) => string) => string;
    renderProviderDiagnosticsMarkdown: (profile: any, options?: any) => string;
    providerDiagnosticsMarkdownPath: (outputDir: string, profile: any) => string;
    profileMessageMetadata: (profile: any) => any;
    providerErrorText: (status: number, text: string) => string;
    extractResponseText: (protocol: string, data: any) => string;
    extractProviderConnectionText: (protocol: string, text: string) => string;
    answerTextForMessage: (message: any) => string;
    getProfiles: () => any[];
    requestMessagesWithHistory: (messages: any[], latestUserText: string, requestPrompt: string, options?: { limit?: number; compaction?: any }) => any[];
    bodyForProfile: (profile: any, messages: any[], outputLanguage: string, systemPrompt: string, requestInput?: any, streamEnabled?: boolean) => any;
    connectionTestBodyForProfile: (profile: any) => any;
    shouldStream: (profile: any, streamEnabled?: boolean) => boolean;
    normalizeBoolean: (value: any, fallback?: boolean) => boolean;
    headersForProfile: (profile: any) => Record<string, string>;
    requestModelWithRetry: (profile: any, messages: any[], outputLanguage: string, systemPrompt: string, requestInput: any, streamEnabled: boolean, signal?: AbortSignal) => Promise<any>;
    workbenchFetchModelOptions: (request: { url: string; headers: Record<string, string> }) => Promise<Array<{ id: string; label: string }>>;
    readStream: (response: any, protocol: string, onDelta: (delta: string) => void) => Promise<string>;
    sessionFilenameFor: (sessionId: string) => string;
    sessionIdFromPath: (path: string) => string;
    recentSessionFiles: (paths: string[]) => string[];
    latestSessionForItem: (item: any, outputDir: string) => Promise<any>;
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
    candidateRecommendationUpdates: (records: any[], currentUpdates?: Record<string, any>) => Record<string, any>;
    candidateReviewUpdateMapFromDom: () => Record<string, any>;
    candidateElement: (record: any, translate?: (key: string) => string) => any;
    candidateReviewMarkdownPath: (outputDir: string, item: any) => string;
    renderCandidateReviewMarkdown: (records: any[], options?: any) => string;
    candidateReviewLabels: (outputLanguage: string) => any;
    candidateReviewScreeningRows: (records: any[], labels: any) => Array<{ metric: string; count: number; action: string }>;
    candidateReviewEvidenceRows: (records: any[], labels: any) => Array<{ title: string; state: string; gap: string; check: string; source: string }>;
    candidateReviewSourceEvidenceRows: (records: any[], labels: any) => Array<{ title: string; label: string; type: string; locator: string; snippet: string; followUp: string }>;
    enrichCandidatesWithFullTextEvidence: (records: any[], contextItem: any, now?: string) => Promise<any[]>;
    candidateFullTextEvidenceSnippets: (text: string, record: any, pdf?: any) => any[];
    reviewDraftMarkdownPath: (outputDir: string, item: any) => string;
    renderReviewDraftMarkdown: (context: any, options?: any) => string;
    proposalNoteMarkdownPath: (outputDir: string, item: any) => string;
    renderProposalNoteMarkdown: (context: any, options?: any) => string;
    journalOutlineMarkdownPath: (outputDir: string, item: any) => string;
    renderJournalOutlineMarkdown: (context: any, options?: any) => string;
    applyCitationNetworkPolicyToDom: (policy: string) => void;
    citationNetworkOptionsFromDom: () => any;
    citationNetworkPolicyDefaults: (policy: string) => any;
    readingLogMarkdownPath: (outputDir: string, item: any) => string;
    renderReadingLogMarkdown: (context: any, options?: any) => string;
    comparisonReportMarkdownPath: (outputDir: string, item: any) => string;
    renderComparisonReportMarkdown: (context: any, options?: any) => string;
    visualExtractionReportMarkdownPath: (outputDir: string, item: any) => string;
    renderVisualExtractionReportMarkdown: (payload: any, options?: any) => string;
    citationNetworkSeedsForWorkbench: (records: any[], item: any, limit?: number) => any[];
    citationNetworkMetaText: (record: any) => string;
    applyCandidateDecisions: (records: any[], decisions: Record<string, any>, now: string) => any[];
    discoveredLedgerEntries: (records: any[], existingCandidateIds: Set<string>, now?: string) => any[];
    decisionLedgerEntries: (records: any[], previousDecisions: Map<string, any>, changedDecisions: Record<string, any>, now?: string) => any[];
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
      exportReadingLog: () => Promise<void>;
      exportComparisonReport: () => Promise<void>;
      exportReviewDraft: () => Promise<void>;
      exportProposalNote: () => Promise<void>;
      exportJournalOutline: () => Promise<void>;
      searchCandidates: () => Promise<void>;
      applyCandidateRecommendations: () => Promise<void>;
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

function findNode(root: any, predicate: (node: any) => boolean): any {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
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
    const prefs = {
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
    };
    const loaded = loadWorkbenchHelpers(new Map(), {}, prefs);
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
      "openai-compatible",
      "openai-responses-compatible",
      "gemini",
      "azure-openai",
      "github-models",
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
      "anthropic-compatible",
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
    const persistedProfiles = JSON.parse(prefs.profilesJson);
    expect(persistedProfiles.map((profile: any) => profile.id)).toContain("openai-responses-compatible");
    expect(persistedProfiles.find((profile: any) => profile.id === "openai")).toMatchObject({
      apiKey: "kept-secret",
      model: "kept-model"
    });
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

    const chatProfile = {
      protocol: "openai_chat",
      model: "model-a",
      capabilities: { streaming: true },
      bodyExtra: {}
    };
    expect(helpers.bodyForProfile(chatProfile, messages, "zh-CN", "system", {}, true)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true }
    });
    expect(helpers.bodyForProfile(chatProfile, messages, "zh-CN", "system", {}, false)).not.toHaveProperty("stream_options");
    expect(helpers.bodyForProfile({
      ...chatProfile,
      bodyExtra: { stream_options: { include_usage: false } }
    }, messages, "zh-CN", "system", {}, true)).toMatchObject({
      stream_options: { include_usage: false }
    });
    expect(helpers.bodyForProfile({
      ...chatProfile,
      bodyExtra: { omitFields: ["stream_options"] }
    }, messages, "zh-CN", "system", {}, true)).not.toHaveProperty("stream_options");
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

    const reasoningChatBody = helpers.bodyForProfile({
      protocol: "openai_chat",
      model: "o1-preview",
      capabilities: { streaming: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", {}, false);
    expect(reasoningChatBody).toMatchObject({ max_completion_tokens: 8192 });
    expect(reasoningChatBody).not.toHaveProperty("max_tokens");
    expect(reasoningChatBody).not.toHaveProperty("temperature");
    expect(reasoningChatBody).not.toHaveProperty("n");

    const explicitCompletionBody = helpers.bodyForProfile({
      protocol: "openai_chat",
      model: "router-model",
      capabilities: { streaming: true },
      bodyExtra: { tokenLimitField: "max_completion_tokens", max_completion_tokens: 2048 }
    }, messages, "zh-CN", "system", {}, false);
    expect(explicitCompletionBody).toMatchObject({ max_completion_tokens: 2048 });
    expect(explicitCompletionBody).not.toHaveProperty("max_tokens");
    expect(explicitCompletionBody).not.toHaveProperty("temperature");
    expect(explicitCompletionBody).not.toHaveProperty("n");
    expect(explicitCompletionBody).not.toHaveProperty("tokenLimitField");

    expect(helpers.bodyForProfile({
      protocol: "openai_chat",
      model: "o3-mini",
      capabilities: { streaming: true },
      bodyExtra: { temperature: 0.2, n: 2 }
    }, messages, "zh-CN", "system", {}, false)).toMatchObject({
      max_completion_tokens: 8192,
      temperature: 0.2,
      n: 2
    });

    const strippedChatBody = helpers.bodyForProfile({
      protocol: "openai_chat",
      model: "router-model",
      capabilities: { streaming: true },
      bodyExtra: {
        response_format: { type: "json_object" },
        omitFields: "temperature,n,max_tokens"
      }
    }, messages, "zh-CN", "system", {}, false);
    expect(strippedChatBody).toMatchObject({ response_format: { type: "json_object" } });
    expect(strippedChatBody).not.toHaveProperty("temperature");
    expect(strippedChatBody).not.toHaveProperty("n");
    expect(strippedChatBody).not.toHaveProperty("max_tokens");
    expect(strippedChatBody).not.toHaveProperty("omitFields");

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

  it("passes image attachments into workbench provider request bodies", () => {
    const messages = [
      { role: "user", content: "请解释这张图" }
    ];
    const requestInput = {
      type: "text",
      source: "text_mode",
      images: [
        { name: "figure.png", mimeType: "image/png", base64: "aW1hZ2U=" }
      ]
    };

    const chatBody = helpers.bodyForProfile({
      protocol: "openai_chat",
      model: "model-a",
      capabilities: { streaming: true, imageBase64: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", requestInput, false);
    expect(chatBody.messages[1].content).toEqual([
      { type: "text", text: "请解释这张图" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }
    ]);

    const responsesBody = helpers.bodyForProfile({
      protocol: "openai_responses",
      model: "model-a",
      capabilities: { streaming: true, imageBase64: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", requestInput, false);
    expect(responsesBody.input[0].content).toEqual([
      { type: "input_text", text: "请解释这张图" },
      { type: "input_image", image_url: "data:image/png;base64,aW1hZ2U=" }
    ]);

    const anthropicBody = helpers.bodyForProfile({
      protocol: "anthropic_messages",
      model: "model-a",
      capabilities: { streaming: true, imageBase64: true },
      bodyExtra: {}
    }, messages, "zh-CN", "system", requestInput, false);
    expect(anthropicBody.messages[0].content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" }
      },
      { type: "text", text: "USER: 请解释这张图" }
    ]);

    expect(() => helpers.bodyForProfile({
      protocol: "openai_chat",
      model: "model-a",
      capabilities: { streaming: true, imageBase64: false },
      bodyExtra: {}
    }, messages, "zh-CN", "system", requestInput, false)).toThrow("does not support image input");
  });

  it("builds a default prompt for image-only sends", () => {
    expect(helpers.defaultImageQuestion("zh-CN")).toContain("请解析这张图片");
    expect(helpers.defaultImageQuestion("en-US")).toContain("Analyze this image");
    expect(helpers.userTextForSend("", "", 1, "zh-CN")).toContain("当前论文");
    expect(helpers.userTextForSend("  解释图  ", "", 1, "zh-CN")).toBe("解释图");
    expect(helpers.userTextForSend("", "figure-table-extractor", 1, "zh-CN")).toBe("");
    expect(helpers.displayTextForSend("", "figure-table-extractor", 1, "zh-CN", (id) => `label:${id}`))
      .toBe("label:figure-table-extractor");
  });

  it("uses a structured visual OCR and table reconstruction contract for figure/table extraction", () => {
    const zh = helpers.builtInSkillTemplate("figure-table-extractor", "zh-CN");
    expect(zh).toContain("## 视觉 OCR 文本");
    expect(zh).toContain("## 表格/数据重建");
    expect(zh).toContain("项目、数值/文本、单位、来源、置信度、备注");
    expect(zh).toContain("不要把文本上下文推断伪装成图片观察");

    const en = helpers.builtInSkillTemplate("figure-table-extractor", "en-US");
    expect(en).toContain("## Visual OCR Text");
    expect(en).toContain("## Reconstructed Data Table");
    expect(en).toContain("Item, Value/Text, Unit, Source, Confidence, Notes");
    expect(en).toContain("do not present text-context inference as direct image observation");

    const ja = helpers.builtInSkillTemplate("figure-table-extractor", "ja-JP");
    expect(ja).toContain("視覚 OCR テキスト");
    expect(ja).toContain("表/データ再構成");
    expect(ja).toContain("[illegible]");
  });

  it("builds domain-specific prompt pack instructions for workbench requests", () => {
    expect(helpers.normalizePromptPackId("transportation")).toBe("transportation");
    expect(helpers.normalizePromptPackId("unknown")).toBe("general");
    expect(helpers.promptPackInstruction("transportation", "zh-CN")).toContain("道路/空域");
    expect(helpers.promptPackInstruction("ai-ml", "en-US")).toContain("model architecture");
    expect(helpers.promptPackInstructionBlock("review-writing", "en-US")).toContain("Research domain prompt pack");
    expect(helpers.promptPackInstructionBlock("general", "zh-CN")).toBe("");
    const prompt = helpers.promptTextForRequest("Skill template", "", "Question", "transportation", "zh-CN");
    expect(prompt).toContain("研究领域提示模板包");
    expect(prompt).toContain("交通场景");
    expect(prompt).toContain("Skill template");
    expect(prompt).toContain("Question");
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

  it("builds workbench settings connection tests with generation-compatible request bodies", () => {
    expect(helpers.connectionTestBodyForProfile({
      protocol: "openai_chat",
      model: "chat-model"
    })).toMatchObject({
      model: "chat-model",
      messages: [
        { role: "system", content: expect.stringContaining("connection test endpoint") },
        { role: "user", content: "ping" }
      ],
      max_tokens: 32,
      stream: false,
      n: 1
    });

    expect(helpers.connectionTestBodyForProfile({
      protocol: "openai_responses",
      model: "responses-model"
    })).toMatchObject({
      model: "responses-model",
      instructions: expect.stringContaining("connection test endpoint"),
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "ping" }]
        }
      ],
      max_output_tokens: 32,
      stream: false
    });

    expect(helpers.connectionTestBodyForProfile({
      protocol: "anthropic_messages",
      model: "claude-model"
    })).toMatchObject({
      model: "claude-model",
      system: expect.stringContaining("connection test endpoint"),
      max_tokens: 32,
      stream: false,
      messages: [{ role: "user", content: "ping" }]
    });
  });

  it("validates workbench settings connection responses before marking them usable", () => {
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      output: [{ content: [{ type: "output_text", text: "pong" }] }]
    }))).toBe("pong");

    expect(() => helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      error: { code: "invalid_api_key", message: "Bad key sk-test-secret" }
    }))).toThrow("invalid_api_key - Bad key [redacted]");
    expect(() => helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      body: { error: { code: "invalid_api_key", message: "Bad key sk-test-secret" } }
    }))).toThrow("invalid_api_key - Bad key [redacted]");

    expect(() => helpers.extractProviderConnectionText("anthropic_messages", JSON.stringify({ content: [] })))
      .toThrow("No text returned from model");
  });

  it("fails workbench model listing when a 200 response contains a provider error", async () => {
    const loaded: any = loadWorkbenchHelpers();
    loaded.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        error: {
          code: "invalid_api_key",
          message: "Bad key sk-test-secret"
        }
      })
    });

    await expect(loaded.workbenchFetchModelOptions({
      url: "https://api.openai.com/v1/models",
      headers: { authorization: "Bearer sk-test-secret" }
    })).rejects.toThrow("Provider error: invalid_api_key - Bad key [redacted]");
  });

  it("retries workbench provider requests without unsupported advanced optional fields", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: Array<{ url: string; body: any }> = [];
    loaded.fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, body: JSON.parse(init.body) });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              message: "Unsupported parameters: presence_penalty, frequency_penalty, seed, top_logprobs, logprobs, parallel_tool_calls, reasoning_effort, stop"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "pong" } }] })
      };
    };

    const profile = {
      id: "router",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "router-model",
      capabilities: { text: true, imageBase64: true, pdfBase64: false, streaming: false },
      bodyExtra: {
        presence_penalty: 0.2,
        frequency_penalty: 0.1,
        seed: 42,
        top_logprobs: 3,
        logprobs: true,
        parallel_tool_calls: false,
        reasoning_effort: "low",
        stop: ["END"]
      }
    };

    const response = await loaded.requestModelWithRetry(
      profile,
      [{ role: "user", content: "ping" }],
      "en-US",
      "system",
      { type: "text", text: "paper text" },
      false
    );

    expect(response.ok).toBe(true);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].body).toMatchObject({
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
      seed: 42,
      top_logprobs: 3,
      logprobs: true,
      parallel_tool_calls: false,
      reasoning_effort: "low",
      stop: ["END"]
    });
    expect(fetchCalls[1].body).not.toHaveProperty("presence_penalty");
    expect(fetchCalls[1].body).not.toHaveProperty("frequency_penalty");
    expect(fetchCalls[1].body).not.toHaveProperty("seed");
    expect(fetchCalls[1].body).not.toHaveProperty("top_logprobs");
    expect(fetchCalls[1].body).not.toHaveProperty("logprobs");
    expect(fetchCalls[1].body).not.toHaveProperty("parallel_tool_calls");
    expect(fetchCalls[1].body).not.toHaveProperty("reasoning_effort");
    expect(fetchCalls[1].body).not.toHaveProperty("stop");
  });

  it("loads wrapped model-list pages in the workbench", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: string[] = [];
    const responses = [
      {
        body: {
          models: {
            data: [{ id: "model-b" }]
          },
          has_more: true,
          last_id: "model-b"
        }
      },
      {
        message: {
          model_list: [{ id: "model-a", display_name: "Model A" }]
        }
      }
    ];
    loaded.fetch = async (url: string) => {
      fetchCalls.push(url);
      const payload = responses[Math.min(fetchCalls.length - 1, responses.length - 1)];
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload)
      };
    };

    await expect(loaded.workbenchFetchModelOptions({
      url: "https://api.openai.com/v1/models",
      headers: { authorization: "Bearer sk-test-secret" }
    })).resolves.toEqual([
      { id: "model-a", label: "Model A" },
      { id: "model-b", label: "" }
    ]);
    expect(fetchCalls).toEqual([
      "https://api.openai.com/v1/models",
      "https://api.openai.com/v1/models?after_id=model-b"
    ]);
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

  it("renders provider diagnostics without exposing credentials", () => {
    const report = helpers.renderProviderDiagnosticsMarkdown({
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test-secret",
      model: "deepseek-chat",
      capabilities: { text: true, imageBase64: true, pdfBase64: false, streaming: true, modelList: true },
      customHeaders: { Authorization: "Bearer routed-secret", "X-Trace": "trace-value" },
      bodyExtra: {
        api_key: "body-secret",
        metadata: { token: "nested-secret" },
        extra_body: { reasoning_split: true }
      }
    }, {
      outputLanguage: "en-US",
      generatedAt: "2026-06-20T00:00:00.000Z",
      reportPath: "/tmp/out/diagnostics/provider-deepseek.md",
      statusText: "Endpoint: https://api.deepseek.com/v1/chat/completions"
    });

    expect(report).toContain("templateVersion: provider-diagnostics-v1");
    expect(report).toContain("# Provider Configuration Diagnostics");
    expect(report).toContain("https://api.deepseek.com/v1/chat/completions");
    expect(report).toContain("https://api.deepseek.com/v1/models");
    expect(report).toContain("DEEPSEEK_API_KEY=...");
    expect(report).toContain("DEEPSEEK_MODEL=deepseek-chat");
    expect(report).toContain("npm run verify:provider:live -- --include deepseek");
    expect(report).toContain("`Authorization`");
    expect(report).toContain("## Redacted Request Preview");
    expect(report).toContain("### text");
    expect(report).toContain("### image");
    expect(report).toContain("\"messages\"");
    expect(report).toContain("\"image_url\"");
    expect(report).toContain("data:image/png;base64,[omitted]");
    expect(report).toContain("\"api_key\": \"[redacted]\"");
    expect(report).toContain("\"token\": \"[redacted]\"");
    expect(report).toContain("\"reasoning_split\": true");
    expect(report).not.toContain("sk-test-secret");
    expect(report).not.toContain("routed-secret");
    expect(report).not.toContain("body-secret");
    expect(report).not.toContain("nested-secret");
    expect(report).not.toContain("trace-value");
  });

  it("renders raw PDF request previews for Responses and Anthropic profiles", () => {
    const openAIReport = helpers.renderProviderDiagnosticsMarkdown({
      id: "openai",
      name: "OpenAI",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "response-model",
      capabilities: { text: true, imageBase64: true, pdfBase64: true, streaming: true, modelList: true },
      customHeaders: {},
      bodyExtra: {}
    }, {
      outputLanguage: "en-US",
      generatedAt: "2026-06-20T00:00:00.000Z"
    });

    expect(openAIReport).toContain("### raw PDF");
    expect(openAIReport).toContain("\"input_file\"");
    expect(openAIReport).toContain("data:application/pdf;base64,[omitted]");
    expect(openAIReport).not.toContain("JVBERi0=");
    expect(openAIReport).not.toContain("sk-test-secret");

    const anthropicReport = helpers.renderProviderDiagnosticsMarkdown({
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      model: "claude-model",
      capabilities: { text: true, imageBase64: true, pdfBase64: true, streaming: true, modelList: true },
      customHeaders: {},
      bodyExtra: {}
    }, {
      outputLanguage: "en-US",
      generatedAt: "2026-06-20T00:00:00.000Z"
    });

    expect(anthropicReport).toContain("### raw PDF");
    expect(anthropicReport).toContain("\"document\"");
    expect(anthropicReport).toContain("\"media_type\": \"application/pdf\"");
    expect(anthropicReport).toContain("\"data\": \"[omitted]\"");
    expect(anthropicReport).not.toContain("JVBERi0=");
    expect(anthropicReport).not.toContain("anthropic-secret");
  });

  it("exports provider diagnostics from the latest workbench settings", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument({
      "zms-profile-name": "DeepSeek",
      "zms-profile-base-url": "https://api.deepseek.com",
      "zms-profile-api-key": "new-secret",
      "zms-profile-model": "deepseek-chat"
    });
    (loaded as any).document = dom;
    const imageInput = dom.elements.get("zms-profile-image-input") || dom.getElementById("zms-profile-image-input");
    imageInput.checked = true;
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    const profile = {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com",
      apiKey: "old-secret",
      model: "",
      capabilities: { text: true, imageBase64: true, pdfBase64: false, streaming: true, modelList: true },
      customHeaders: {},
      bodyExtra: {},
      isDefault: true
    };
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "zh-CN";
    workbench.state.profile = profile;
    workbench.state.profiles = [profile];
    workbench.t = (key: string) => key;

    await (workbench as any).exportProviderDiagnostics();

    const reportPath = "/tmp/out/diagnostics/provider-deepseek.md";
    const report = files.get(reportPath) || "";
    expect(report).toContain("# 模型厂商配置诊断");
    expect(report).toContain("deepseek-chat");
    expect(report).toContain("DEEPSEEK_API_KEY=...");
    expect(report).toContain("DEEPSEEK_MODEL=deepseek-chat");
    expect(report).not.toContain("new-secret");
    expect(report).not.toContain("old-secret");
    expect(workbench.state.profile.apiKey).toBe("new-secret");
    expect(dom.elements.get("zms-status").textContent).toContain(`providerDiagnosticsDone: ${reportPath}`);
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
      id: "anthropic-compatible",
      protocol: "anthropic_messages",
      baseURL: "https://anthropic-router.example",
      apiKey: "anthropic-compatible-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer anthropic-compatible-secret", "anthropic-version": "2023-06-01" });
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

  it("parses standard SSE event records in workbench streams", async () => {
    const response = {
      body: streamFromText([
        "event: response.output_text.delta",
        "data: {",
        "data: \"type\":\"response.output_text.delta\",",
        "data: \"delta\":\"split\"",
        "data: }",
        "",
        "event: response.output_text.delta",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\" stream\"}",
        ""
      ].join("\n"))
    };
    const deltas: string[] = [];
    const text = await helpers.readStream(response, "openai_responses", (delta) => deltas.push(delta));

    expect(text).toBe("split stream");
    expect(deltas).toEqual(["split", " stream"]);
  });

  it("keeps newline-only workbench streams compatible", async () => {
    const response = {
      body: streamFromText([
        "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}",
        "data: {\"choices\":[{\"delta\":{\"content\":\" second\"}}]}"
      ].join("\n"))
    };
    const deltas: string[] = [];
    const text = await helpers.readStream(response, "openai_chat", (delta) => deltas.push(delta));

    expect(text).toBe("first second");
    expect(deltas).toEqual(["first", " second"]);
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

  it("captures provider usage metadata from workbench streams", async () => {
    const response: any = {
      body: streamFromText([
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"streamed\"}",
        "data: {\"response\":{\"usage\":{\"input_tokens\":12,\"output_tokens\":6,\"total_tokens\":18}}}"
      ].join("\n"))
    };
    const deltas: string[] = [];
    const text = await helpers.readStream(response, "openai_responses", (delta) => deltas.push(delta));

    expect(text).toBe("streamed");
    expect(deltas).toEqual(["streamed"]);
    expect(response.zmsUsage).toEqual({
      inputTokens: 12,
      outputTokens: 6,
      totalTokens: 18
    });
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
    expect(() => helpers.extractResponseText("openai_chat", {
      body: { error: { code: "invalid_api_key", message: "Bad key sk-test-secret" } }
    })).toThrow("invalid_api_key - Bad key [redacted]");
    expect(() => helpers.extractResponseText("anthropic_messages", {
      type: "error",
      error: { type: "overloaded_error", message: "Bearer routed-secret overloaded" }
    })).toThrow("overloaded_error - Bearer [redacted] overloaded");
    expect(() => helpers.extractResponseText("anthropic_messages", {
      payload: { type: "error", error: { type: "authentication_error", message: "Bearer routed-secret rejected" } }
    })).toThrow("authentication_error - Bearer [redacted] rejected");
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
    expect(helpers.extractResponseText("openai_chat", {
      body: { message: { content: [{ type: "output_text", text: "wrapped body message" }] } }
    })).toBe("wrapped body message");
    expect(helpers.extractResponseText("openai_chat", {
      candidates: [{ content: { parts: [{ text: "candidate part text" }] } }]
    })).toBe("candidate part text");
    expect(helpers.extractResponseText("anthropic_messages", {
      content: "compatible anthropic text"
    })).toBe("compatible anthropic text");
    expect(helpers.extractResponseText("anthropic_messages", {
      payload: { message: { content: [{ type: "redacted_thinking", text: "hidden" }, { type: "text", text: "anthropic message text" }] } }
    })).toBe("anthropic message text");
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

  it("returns no latest session when the item session directory is missing", async () => {
    const loaded = loadWorkbenchHelpers();

    await expect(loaded.latestSessionForItem({ key: "ITEM" }, "/tmp/zms")).resolves.toBeNull();
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

  it("builds recommendation updates only for pending high-confidence candidates", () => {
    const records = [
      {
        candidateId: "doi:10.1000/include",
        title: "Recommended Include",
        decision: "user_pending",
        priority: { tier: "high", recommendedDecision: "include" },
        quality: { dedupeStatus: "new" }
      },
      {
        candidateId: "doi:10.1000/manual",
        title: "Manual Decision",
        decision: "user_pending",
        priority: { tier: "high", recommendedDecision: "exclude" },
        quality: { dedupeStatus: "new" }
      },
      {
        candidateId: "doi:10.1000/low",
        title: "Low Priority",
        decision: "user_pending",
        priority: { tier: "low", recommendedDecision: "exclude" },
        quality: { dedupeStatus: "new" }
      },
      {
        candidateId: "doi:10.1000/dup",
        title: "Duplicate",
        decision: "user_pending",
        priority: { tier: "duplicate", recommendedDecision: "exclude" },
        quality: { dedupeStatus: "duplicate" }
      }
    ];

    expect(helpers.candidateRecommendationUpdates(records, {
      "doi:10.1000/manual": { decision: "include" }
    })).toEqual({
      "doi:10.1000/include": { decision: "include" },
      "doi:10.1000/dup": { decision: "exclude" }
    });
  });

  it("builds candidate screening board rows for manual review triage", () => {
    const labels = helpers.candidateReviewLabels("en-US");
    const rows = helpers.candidateReviewScreeningRows([
      {
        candidateId: "doi:10.1000/high",
        title: "High Pending",
        decision: "user_pending",
        priority: { tier: "high", recommendedDecision: "include" },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      },
      {
        candidateId: "doi:10.1000/medium",
        title: "Medium Pending",
        decision: "user_pending",
        priority: { tier: "medium", recommendedDecision: "to_read" },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      },
      {
        candidateId: "doi:10.1000/include",
        title: "Included Missing PDF",
        decision: "include",
        priority: { tier: "high", recommendedDecision: "include" },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      },
      {
        candidateId: "doi:10.1000/dup",
        title: "Duplicate",
        decision: "include",
        priority: { tier: "duplicate", recommendedDecision: "exclude" },
        quality: { dedupeStatus: "duplicate", isAbstractOnly: false }
      },
      {
        candidateId: "doi:10.1000/import",
        title: "Import Failed",
        decision: "include",
        importStatus: "failed",
        pdfAttachmentStatus: "attached_pdf",
        priority: { tier: "medium", recommendedDecision: "include" },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      },
      {
        candidateId: "title:abstract",
        title: "Abstract Only",
        decision: "include",
        priority: { tier: "low", recommendedDecision: "include" },
        quality: { dedupeStatus: "new", isAbstractOnly: true }
      }
    ], labels);

    const counts = Object.fromEntries(rows.map((row) => [row.metric, row.count]));
    expect(counts["High-priority pending"]).toBe(1);
    expect(counts["Medium-priority pending"]).toBe(1);
    expect(counts["Recommendation differs from current decision"]).toBe(3);
    expect(counts["Duplicate or possible duplicate"]).toBe(1);
    expect(counts["Ready for Zotero import"]).toBe(2);
    expect(counts["Included but missing PDF"]).toBe(1);
    expect(counts["Import issues"]).toBe(1);
    expect(counts["PDF attached"]).toBe(1);
    expect(counts["Abstract-only records"]).toBe(1);
  });

  it("builds candidate evidence-chain follow-up rows from screening state and source gaps", () => {
    const labels = helpers.candidateReviewLabels("en-US");
    const rows = helpers.candidateReviewEvidenceRows([
      {
        candidateId: "doi:10.1000/include",
        title: "Included Missing PDF",
        decision: "include",
        priority: { tier: "high", score: 90, recommendedDecision: "include" },
        quality: { dedupeStatus: "new", isAbstractOnly: false },
        sources: ["semantic_scholar"]
      },
      {
        candidateId: "doi:10.1000/abstract",
        title: "Abstract Only",
        decision: "to_read",
        priority: { tier: "medium", score: 72, recommendedDecision: "to_read" },
        review: { screeningStage: "full_text_needed" },
        quality: { dedupeStatus: "new", isAbstractOnly: true },
        sources: ["crossref"]
      },
      {
        candidateId: "doi:10.1000/exclude",
        title: "Excluded Without Reason",
        decision: "exclude",
        priority: { tier: "low", score: 20, recommendedDecision: "exclude" },
        quality: { dedupeStatus: "new", isAbstractOnly: false },
        sources: ["arxiv"]
      },
      {
        candidateId: "doi:10.1000/done",
        title: "Already Screened",
        decision: "include",
        pdfUrl: "https://example.test/done.pdf",
        review: { screeningStage: "full_text_screened" },
        priority: { tier: "high", score: 88, recommendedDecision: "include" },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      },
      {
        candidateId: "doi:10.1000/dup",
        title: "Duplicate",
        decision: "include",
        priority: { tier: "duplicate", score: 0, recommendedDecision: "exclude" },
        quality: { dedupeStatus: "duplicate", isAbstractOnly: false }
      }
    ], labels);

    expect(rows.map((row) => row.title)).toEqual([
      "Included Missing PDF",
      "Abstract Only",
      "Excluded Without Reason"
    ]);
    expect(rows[0]).toMatchObject({
      state: "Source only",
      gap: "Included record is missing PDF or full-text evidence",
      check: "Find an open-access PDF or attach local full text, then update the screening stage.",
      source: "Search source: semantic_scholar"
    });
    expect(rows[1]).toMatchObject({
      state: "Full text needed",
      gap: "Full text is needed before judging evidence strength"
    });
    expect(rows[2]).toMatchObject({
      gap: "Excluded record is missing a structured exclusion reason",
      check: "Add an exclusion reason and note the evidence location."
    });
  });

  it("builds candidate source-evidence snippets with stable labels", () => {
    const labels = helpers.candidateReviewLabels("en-US");
    const rows = helpers.candidateReviewSourceEvidenceRows([
      {
        candidateId: "doi:10.1000/source",
        title: "Source Evidence Candidate",
        year: 2026,
        abstract: "This paper studies an evidence-backed method and reports evaluation metrics.",
        sourceUrl: "https://doi.org/10.1000/source",
        pdfUrl: "https://example.test/source.pdf",
        ids: { doi: "10.1000/source", semanticScholarId: "S2-SOURCE" },
        sources: ["semantic_scholar", "crossref"],
        networkOrigins: [{ direction: "citations", seedId: "S2-Seed", seedTitle: "Seed Paper", hop: 2 }],
        decision: "include",
        priority: { tier: "high", score: 91, recommendedDecision: "include" },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      },
      {
        candidateId: "doi:10.1000/dup",
        title: "Duplicate Candidate",
        decision: "include",
        abstract: "Duplicate abstract should not become a source snippet.",
        priority: { tier: "duplicate", score: 0, recommendedDecision: "exclude" },
        quality: { dedupeStatus: "duplicate", isAbstractOnly: false }
      }
    ], labels);

    expect(rows.map((row) => row.label)).toEqual([
      "[candidate:doi:10.1000:source:abstract]",
      "[candidate:doi:10.1000:source:pdf]",
      "[candidate:doi:10.1000:source:network]",
      "[candidate:doi:10.1000:source:source]",
      "[candidate:doi:10.1000:source:identifier]"
    ]);
    expect(rows[0]).toMatchObject({
      type: "Abstract",
      locator: "abstract",
      snippet: "This paper studies an evidence-backed method and reports evaluation metrics.",
      followUp: "Check full text to confirm whether the abstract covers question, method, experiments, and limitations."
    });
    expect(rows[1]).toMatchObject({
      type: "PDF",
      locator: "pdf-url",
      snippet: "https://example.test/source.pdf"
    });
    expect(rows[2].snippet).toContain("citations from Seed Paper from hop 2");
    expect(rows[3].snippet).toContain("semantic_scholar, crossref; https://doi.org/10.1000/source");
    expect(rows[4].snippet).toContain("DOI: 10.1000/source; Semantic Scholar: S2-SOURCE");
  });

  it("extracts candidate full-text evidence snippets from imported Zotero PDF text", async () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroItems.set(42, {
      id: 42,
      key: "ITEM42",
      getAttachments: () => [43]
    });
    loaded.__zoteroItems.set(43, {
      id: 43,
      key: "PDF43",
      attachmentContentType: "application/pdf",
      attachmentText: [
        "The proposed method uses graph attention to model route conflicts and scheduler state.",
        "Experiments evaluate benchmark scenarios with delay, conflict, and throughput metrics.",
        "Limitations include synthetic traffic assumptions and missing weather robustness checks.",
        "The main contribution is an evidence-backed workflow for reusable candidate screening."
      ].join(" "),
      getAnnotations: () => [
        {
          key: "ANN43",
          annotationType: "highlight",
          annotationPageLabel: "7",
          annotationText: "The proposed method uses graph attention to model route conflicts and scheduler state."
        }
      ]
    });

    const enriched = await loaded.enrichCandidatesWithFullTextEvidence([
      {
        candidateId: "doi:10.1000/full",
        title: "Full Text Candidate",
        decision: "include",
        importStatus: "imported",
        zoteroItemID: 42,
        zoteroItemKey: "ITEM42",
        pdfAttachmentStatus: "attached_pdf",
        quality: { dedupeStatus: "new", isAbstractOnly: false },
        priority: { tier: "high", score: 90, recommendedDecision: "include" }
      }
    ], { libraryID: 1 }, "2026-06-20T00:00:00.000Z");

    expect(enriched[0].review.fullTextEvidenceUpdatedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(enriched[0].review.fullTextEvidence.map((item: any) => item.label)).toEqual([
      "[candidate:doi:10.1000:full:fulltext-method]",
      "[candidate:doi:10.1000:full:fulltext-experiment]",
      "[candidate:doi:10.1000:full:fulltext-limitation]",
      "[candidate:doi:10.1000:full:fulltext-contribution]"
    ]);
    expect(enriched[0].review.fullTextEvidence[0]).toMatchObject({
      topic: "method",
      locator: expect.stringContaining("indexed-text:"),
      sourceHash: expect.stringMatching(/^[a-f0-9]{8,12}$/),
      attachmentKey: "PDF43"
    });

    const rows = loaded.candidateReviewSourceEvidenceRows(enriched, loaded.candidateReviewLabels("en-US"));
    expect(rows[0]).toMatchObject({
      label: "[candidate:doi:10.1000:full:fulltext-method]",
      type: "Full-text index",
      locator: expect.stringContaining("indexed-text:")
    });
    expect(rows[0].locator).toContain("hash:");
    expect(rows[0].locator).toContain("attachment:PDF43");
    expect(rows[0].snippet).toContain("Hit: The proposed method uses graph attention");
    expect(rows[0].snippet).toContain("Context after:");
    expect(enriched[0].review.fullTextEvidence[0]).toMatchObject({
      quote: expect.stringContaining("proposed method uses graph attention"),
      contextAfter: expect.stringContaining("Experiments evaluate"),
      pageLabel: "7",
      annotationKey: "ANN43",
      annotationType: "highlight"
    });
    expect(rows[0].locator).toContain("page-label:7");
    expect(rows[0].locator).toContain("annotation:ANN43");
  });

  it("adds best-effort page hints for candidate evidence extracted from paged indexed text", () => {
    const loaded = loadWorkbenchHelpers();
    const snippets = loaded.candidateFullTextEvidenceSnippets([
      "Opening context without the target terms.",
      "A baseline paragraph remains on page one.",
      "\f",
      "The proposed method uses graph attention to model route conflicts.",
      "Experiments evaluate benchmark scenarios with delay and throughput metrics."
    ].join(" "), {
      candidateId: "doi:10.1000/paged",
      title: "Paged Candidate",
      decision: "include",
      quality: { dedupeStatus: "new" }
    }, { key: "PDFPAGE" });

    expect(snippets[0]).toMatchObject({
      topic: "method",
      page: 2,
      locator: expect.stringContaining("page:2"),
      quote: expect.stringContaining("proposed method uses graph attention"),
      contextAfter: expect.stringContaining("Experiments evaluate"),
      attachmentKey: "PDFPAGE"
    });
    expect(snippets[0].locator).toContain("page-span:");
  });

  it("uses standalone indexed-text page markers as candidate evidence locators", () => {
    const loaded = loadWorkbenchHelpers();
    const snippets = loaded.candidateFullTextEvidenceSnippets([
      "--- Page 1 ---",
      "Opening context without the target terms.",
      "Page 12",
      "The proposed method uses graph attention to model route conflicts.",
      "Experiments evaluate benchmark scenarios with delay and throughput metrics."
    ].join("\n"), {
      candidateId: "doi:10.1000/page-marker",
      title: "Page Marker Candidate",
      decision: "include",
      quality: { dedupeStatus: "new" }
    }, { key: "PDFMARKER" });

    expect(snippets[0]).toMatchObject({
      topic: "method",
      page: 12,
      pageLabel: "12",
      locator: expect.stringContaining("page:12"),
      quote: expect.stringContaining("proposed method uses graph attention"),
      attachmentKey: "PDFMARKER"
    });
    expect(snippets[0].locator).toContain("page-label:12");
    expect(snippets[0].locator).toContain("page-span:");

    const singleMarkedPage = loaded.candidateFullTextEvidenceSnippets([
      "[Page 9]",
      "The proposed method uses graph attention to model route conflicts."
    ].join("\n"), {
      candidateId: "doi:10.1000/single-page-marker",
      title: "Single Page Marker Candidate",
      decision: "include",
      quality: { dedupeStatus: "new" }
    }, { key: "PDFSINGLE" });
    expect(singleMarkedPage[0]).toMatchObject({
      page: 9,
      pageLabel: "9",
      locator: expect.stringContaining("page-label:9")
    });
  });

  it("prefers substantive indexed-text evidence over table-of-contents keyword hits", () => {
    const loaded = loadWorkbenchHelpers();
    const snippets = loaded.candidateFullTextEvidenceSnippets([
      "Page 1",
      "Table of contents",
      "1 Introduction ........ 1",
      "2 Methods ........ 3",
      "3 Experiments ........ 7",
      "Page 3",
      "The proposed method uses graph attention to model route conflicts and update route-choice states.",
      "The framework then estimates delay propagation across benchmark scenarios."
    ].join("\n"), {
      candidateId: "doi:10.1000/toc-noise",
      title: "TOC Noise Candidate",
      decision: "include",
      quality: { dedupeStatus: "new" }
    }, { key: "PDFTOC" });

    expect(snippets[0]).toMatchObject({
      topic: "method",
      page: 3,
      locator: expect.stringContaining("page:3"),
      quote: expect.stringContaining("proposed method uses graph attention"),
      attachmentKey: "PDFTOC"
    });
    expect(snippets[0].text).not.toContain("Table of contents");
    expect(snippets[0].text).not.toContain("Methods ........ 3");
  });

  it("cleans repeated PDF page headers, footers, and line-break hyphenation from indexed evidence", () => {
    const loaded = loadWorkbenchHelpers();
    const snippets = loaded.candidateFullTextEvidenceSnippets([
      "Journal of Airspace Review",
      "1",
      "Opening context without the target terms.",
      "© 2026 Example Publisher",
      "\f",
      "Journal of Airspace Review",
      "2",
      "The meth-",
      "od uses graph attention to model route conflicts.",
      "Experiments evaluate benchmark scenarios with delay and throughput metrics.",
      "© 2026 Example Publisher"
    ].join("\n"), {
      candidateId: "doi:10.1000/clean-paged",
      title: "Clean Paged Candidate",
      decision: "include",
      quality: { dedupeStatus: "new" }
    }, { key: "PDFCLEAN" });

    expect(snippets[0]).toMatchObject({
      topic: "method",
      page: 2,
      locator: expect.stringContaining("page:2"),
      quote: expect.stringContaining("The method uses graph attention"),
      attachmentKey: "PDFCLEAN"
    });
    expect(snippets[0].text).not.toContain("Journal of Airspace Review");
    expect(snippets[0].text).not.toContain("Example Publisher");
    expect(snippets[0].text).not.toContain("meth- od");
    expect(snippets[0].locator).toContain("page-span:");
  });

  it("persists candidate review notes with decisions and can clear old notes", () => {
    const records = [
      {
        candidateId: "doi:10.1000/a",
        title: "Candidate A",
        decision: "user_pending",
        sources: ["crossref"],
        quality: { dedupeStatus: "new" }
      },
      {
        candidateId: "doi:10.1000/b",
        title: "Candidate B",
        decision: "include",
        review: {
          note: "Old inclusion note",
          screeningStage: "full_text_screened",
          exclusionReason: "off_topic",
          updatedAt: "2026-06-13T00:00:00.000Z"
        },
        sources: ["semantic_scholar"],
        quality: { dedupeStatus: "new" }
      }
    ];

    const updated = helpers.applyCandidateDecisions(records, {
      "doi:10.1000/a": {
        decision: "include",
        note: "Include because it shares the evaluation scenario.",
        screeningStage: "abstract_screened",
        exclusionReason: ""
      },
      "doi:10.1000/b": {
        decision: "exclude",
        note: "",
        screeningStage: "not_started",
        exclusionReason: ""
      }
    }, "2026-06-13T00:01:00.000Z");

    expect(updated[0]).toMatchObject({
      decision: "include",
      review: {
        note: "Include because it shares the evaluation scenario.",
        screeningStage: "abstract_screened",
        updatedAt: "2026-06-13T00:01:00.000Z"
      },
      updatedAt: "2026-06-13T00:01:00.000Z"
    });
    expect(updated[1]).toMatchObject({
      decision: "exclude",
      updatedAt: "2026-06-13T00:01:00.000Z"
    });
    expect(updated[1].review?.note).toBeUndefined();
    expect(updated[1].review?.screeningStage).toBeUndefined();
    expect(updated[1].review?.exclusionReason).toBeUndefined();
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

  it("records candidate review-note changes in the import ledger", () => {
    const record = {
      candidateId: "doi:10.1000/a",
      title: "Candidate A",
      decision: "include",
      review: { note: "New reviewer note" },
      sources: ["crossref"],
      quality: { dedupeStatus: "new" }
    };

    const entries = helpers.decisionLedgerEntries(
      [record],
      new Map([["doi:10.1000/a", { decision: "include", note: "Old reviewer note" }]]),
      { "doi:10.1000/a": { decision: "include", note: "New reviewer note" } },
      "2026-06-13T00:03:00.000Z"
    );

    expect(entries).toEqual([
      expect.objectContaining({
        id: "doi:10.1000/a:review_note:2026-06-13T00:03:00.000Z",
        action: "review_note",
        decision: "include",
        reviewNote: "New reviewer note",
        previousReviewNote: "Old reviewer note",
        decisionChanged: false,
        noteChanged: true
      })
    ]);
  });

  it("records candidate screening-stage and exclusion-reason changes in the import ledger", () => {
    const record = {
      candidateId: "doi:10.1000/a",
      title: "Candidate A",
      decision: "exclude",
      review: {
        screeningStage: "full_text_screened",
        exclusionReason: "weak_evidence"
      },
      sources: ["semantic_scholar"],
      quality: { dedupeStatus: "new" }
    };

    const entries = helpers.decisionLedgerEntries(
      [record],
      new Map([["doi:10.1000/a", {
        decision: "exclude",
        note: "",
        screeningStage: "abstract_screened",
        exclusionReason: "off_topic"
      }]]),
      { "doi:10.1000/a": { screeningStage: "full_text_screened", exclusionReason: "weak_evidence" } },
      "2026-06-13T00:04:00.000Z"
    );

    expect(entries).toEqual([
      expect.objectContaining({
        id: "doi:10.1000/a:review_screening:2026-06-13T00:04:00.000Z",
        action: "review_screening",
        screeningStage: "full_text_screened",
        previousScreeningStage: "abstract_screened",
        exclusionReason: "weak_evidence",
        previousExclusionReason: "off_topic",
        decisionChanged: false,
        screeningChanged: true,
        exclusionReasonChanged: true
      })
    ]);
  });

  it("reads candidate decision, screening stage, exclusion reason, and note updates from the DOM", () => {
    const loaded = loadWorkbenchHelpers();
    const nodes = [
      { dataset: { candidateDecision: "doi:10.1000/a" }, value: "exclude" },
      { dataset: { candidateScreening: "doi:10.1000/a" }, value: "full_text_screened" },
      { dataset: { candidateExclusionReason: "doi:10.1000/a" }, value: "weak_evidence" },
      { dataset: { candidateNote: "doi:10.1000/a" }, value: "Too weak after full-text review." }
    ];
    (loaded as any).document = {
      querySelectorAll(selector: string) {
        if (selector === "[data-candidate-decision]") return [nodes[0]];
        if (selector === "[data-candidate-screening]") return [nodes[1]];
        if (selector === "[data-candidate-exclusion-reason]") return [nodes[2]];
        if (selector === "[data-candidate-note]") return [nodes[3]];
        return [];
      }
    };

    expect(loaded.candidateReviewUpdateMapFromDom()).toEqual({
      "doi:10.1000/a": {
        decision: "exclude",
        screeningStage: "full_text_screened",
        exclusionReason: "weak_evidence",
        note: "Too weak after full-text review."
      }
    });
  });

  it("applies candidate recommendations from the workbench and records ledger changes", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.item = {
      key: "ITEM",
      getCollections: () => [10]
    };
    workbench.state.candidates = [
      {
        candidateId: "doi:10.1000/a",
        title: "Candidate A",
        decision: "user_pending",
        priority: { tier: "high", recommendedDecision: "include" },
        quality: { dedupeStatus: "new" }
      },
      {
        candidateId: "doi:10.1000/b",
        title: "Candidate B",
        decision: "include",
        priority: { tier: "high", recommendedDecision: "exclude" },
        quality: { dedupeStatus: "new" }
      },
      {
        candidateId: "doi:10.1000/c",
        title: "Candidate C",
        decision: "user_pending",
        priority: { tier: "duplicate", recommendedDecision: "exclude" },
        quality: { dedupeStatus: "duplicate" }
      }
    ];
    workbench.t = (key: string) => key;

    await workbench.applyCandidateRecommendations();

    const candidatePath = "/tmp/out/collections/COL/sources/candidates.jsonl";
    const ledgerPath = "/tmp/out/collections/COL/sources/import-ledger.jsonl";
    expect(files.get(candidatePath)).toContain("\"candidateId\":\"doi:10.1000/a\",\"title\":\"Candidate A\",\"decision\":\"include\"");
    expect(files.get(candidatePath)).toContain("\"candidateId\":\"doi:10.1000/b\",\"title\":\"Candidate B\",\"decision\":\"include\"");
    expect(files.get(candidatePath)).toContain("\"candidateId\":\"doi:10.1000/c\",\"title\":\"Candidate C\",\"decision\":\"exclude\"");
    expect(files.get(ledgerPath)).toContain("\"action\":\"confirmed\"");
    expect(files.get(ledgerPath)).toContain("\"action\":\"excluded\"");
    expect(dom.elements.get("zms-status").textContent).toContain("candidateRecommendationsApplied: 2");
  });

  it("renders a candidate review Markdown report for manual screening", () => {
    const report = helpers.renderCandidateReviewMarkdown([
      {
        candidateId: "doi:10.1000/a",
        title: "Candidate A",
        authors: ["Ada One", "Bo Two"],
        year: 2025,
        venue: "Journal A",
        abstract: "A useful paper for the current review.",
        sourceUrl: "https://doi.org/10.1000/a",
        pdfUrl: "https://example.test/a.pdf",
        decision: "include",
        collectionKey: "COL",
        ids: { doi: "10.1000/a", semanticScholarId: "S2-A" },
        sources: ["semantic_scholar"],
        priority: { tier: "high", score: 82, recommendedDecision: "include", reasons: ["PDF available", "citation-network relation"] },
        networkOrigins: [{ direction: "citations", seedId: "S2-Seed", seedTitle: "Seed Paper" }],
        quality: { dedupeStatus: "new", isAbstractOnly: false },
        review: {
          note: "Read first for shared datasets and metrics.",
          screeningStage: "full_text_screened"
        }
      },
      {
        candidateId: "doi:10.1000/dup",
        title: "Duplicate Candidate",
        decision: "include",
        ids: { doi: "10.1000/dup" },
        sources: ["crossref"],
        priority: { tier: "duplicate", score: 0, recommendedDecision: "exclude", reasons: ["duplicate candidate"] },
        quality: { dedupeStatus: "duplicate", isAbstractOnly: false },
        review: { exclusionReason: "duplicate" }
      },
      {
        candidateId: "title:abstract-only",
        title: "Abstract Only Candidate",
        year: 2024,
        abstract: "Only the abstract is currently available.",
        decision: "to_read",
        sources: ["crossref"],
        priority: { tier: "medium", score: 64, recommendedDecision: "to_read", reasons: ["abstract overlap"] },
        quality: { dedupeStatus: "new", isAbstractOnly: true },
        review: { screeningStage: "full_text_needed" }
      }
    ], {
      item: { key: "ITEM", getField: (field: string) => field === "title" ? "Current Paper" : "" },
      outputLanguage: "zh-CN",
      generatedAt: "2026-06-20T00:00:00.000Z",
      candidatePath: "/tmp/out/collections/COL/sources/candidates.jsonl",
      ledgerPath: "/tmp/out/collections/COL/sources/import-ledger.jsonl",
      reviewPath: "/tmp/out/collections/COL/writing/candidate-review.md"
    });

    expect(report).toContain("templateVersion: candidate-review-v1");
    expect(report).toContain("# 候选论文审阅报告");
    expect(report).toContain("## 审阅状态看板");
    expect(report).toContain("| 审阅状态 | 数量 | 建议处理 |");
    expect(report).toContain("高优先级待确认");
    expect(report).toContain("可导入 Zotero");
    expect(report).toContain("## 证据链复核队列");
    expect(report).toContain("| 候选论文 | 证据状态 | 证据缺口 | 建议核验 | 可用来源 |");
    expect(report).toContain("Abstract Only Candidate (2024)");
    expect(report).toContain("需要全文后才能判断证据强度");
    expect(report).toContain("## 来源证据摘录");
    expect(report).toContain("| 候选论文 | 证据标签 | 类型 | 定位 | 摘录 | 下一步核验 |");
    expect(report).toContain("[candidate:doi:10.1000:a:abstract]");
    expect(report).toContain("[candidate:doi:10.1000:a:pdf]");
    expect(report).toContain("| Candidate A (2025) | [candidate:doi:10.1000:a:pdf] | PDF | pdf-url |");
    expect(report).toContain("[candidate:doi:10.1000:a:network]");
    expect(report).toContain("对照全文确认研究问题、方法、实验和局限是否被摘要充分覆盖。");
    expect(report).toContain("## 人工复核清单");
    expect(report).toContain("## 筛选协议");
    expect(report).toContain("纳入标准");
    expect(report).toContain("## 决策行动队列");
    expect(report).toContain("| 候选论文 | 决策 | 建议 | 优先级 | 下一步 |");
    expect(report).toContain("### 纳入");
    expect(report).toContain("**Candidate A** (2025)");
    expect(report).toContain("优先级: high 82");
    expect(report).toContain("引用网络来源: citations from Seed Paper");
    expect(report).toContain("筛选阶段: 已筛全文");
    expect(report).toContain("[PDF](https://example.test/a.pdf)");
    expect(report).toContain("已保存备注: Read first for shared datasets and metrics.");
    expect(report).toContain("下一步: 无需立即处理");
    expect(report).toContain("### 重复项");
    expect(report).toContain("Duplicate Candidate");
    expect(report).toContain("排除理由: 重复项");
    expect(report).toContain("核对重复项");
  });

  it("exports a candidate review report from the workbench queue", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "en-US";
    workbench.state.item = {
      key: "ITEM",
      getField: (field: string) => field === "title" ? "Current Paper" : "",
      getCollections: () => [10]
    };
    workbench.state.candidates = [
      {
        candidateId: "doi:10.1000/a",
        title: "Candidate A",
        year: 2025,
        decision: "include",
        sourceUrl: "https://doi.org/10.1000/a",
        ids: { doi: "10.1000/a" },
        sources: ["semantic_scholar"],
        importStatus: "imported",
        zoteroItemID: 42,
        zoteroItemKey: "ITEM42",
        pdfAttachmentStatus: "attached_pdf",
        priority: { tier: "high", score: 81, recommendedDecision: "include", reasons: ["stable DOI or arXiv identifier"] },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      },
      {
        candidateId: "doi:10.1000/b",
        title: "Candidate B",
        year: 2024,
        decision: "user_pending",
        ids: { doi: "10.1000/b" },
        sources: ["crossref"],
        priority: { tier: "high", score: 77, recommendedDecision: "include", reasons: ["related method"] },
        quality: { dedupeStatus: "new", isAbstractOnly: false }
      }
    ];
    loaded.__zoteroItems.set(42, {
      id: 42,
      key: "ITEM42",
      getAttachments: () => [43]
    });
    loaded.__zoteroItems.set(43, {
      id: 43,
      key: "PDF43",
      attachmentContentType: "application/pdf",
      attachmentText: "The method uses graph attention. Experiments report delay metrics. Limitations include synthetic data."
    });
    workbench.t = (key: string) => key;

    await (workbench as any).exportCandidateReview();

    const candidatePath = "/tmp/out/collections/COL/sources/candidates.jsonl";
    const reviewPath = "/tmp/out/collections/COL/writing/candidate-review.md";
    expect(files.get(candidatePath)).toContain("\"candidateId\":\"doi:10.1000/a\"");
    expect(files.get(reviewPath)).toContain("# Candidate Paper Review");
    expect(files.get(reviewPath)).toContain("## Screening Board");
    expect(files.get(reviewPath)).toContain("| Review state | Count | Suggested handling |");
    expect(files.get(reviewPath)).toContain("## Evidence-chain Follow-up");
    expect(files.get(reviewPath)).toContain("## Source Evidence Snippets");
    expect(files.get(reviewPath)).toContain("| Candidate paper | Evidence label | Type | Locator | Snippet | Next check |");
    expect(files.get(reviewPath)).toContain("[candidate:doi:10.1000:a:fulltext-method]");
    expect(files.get(reviewPath)).toContain("indexed-text:");
    expect(files.get(reviewPath)).toContain("hash:");
    expect(files.get(candidatePath)).toContain("\"fullTextEvidence\"");
    expect(files.get(reviewPath)).toContain("## Screening Protocol");
    expect(files.get(reviewPath)).toContain("## Decision Action Queue");
    expect(files.get(reviewPath)).toContain("| Candidate paper | Decision | Recommended | Priority | Next action |");
    expect(files.get(reviewPath)).toContain("**Candidate A** (2025)");
    expect(dom.elements.get("zms-status").textContent).toContain(`candidateReviewDone: ${reviewPath}`);
  });

  it("renders a paper reading log with context evidence labels", () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const item = {
      key: "ITEM",
      getCollections: () => [10]
    };
    const report = loaded.renderReadingLogMarkdown({
      metadata: {
        title: "Reading Log Paper",
        authors: ["Ada One", "Bo Two"],
        year: "2026",
        doi: "10.1000/log"
      },
      chunks: [
        {
          chunkId: "summary-method",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "methodhash",
          text: "The paper proposes a graph attention method and reports experiment results."
        },
        {
          chunkId: "note-limit",
          sourceType: "note",
          locator: "note:1",
          sourceHash: "limithash",
          text: "Manual note: limitations include sparse scenario failures."
        }
      ],
      diagnostics: { chunkCount: 2, fulltextChars: 1600, annotationCount: 1, noteCount: 1, summaryChars: 300 }
    }, {
      item,
      outputLanguage: "zh-CN",
      generatedAt: "2026-06-20T00:00:00.000Z",
      logPath: "/tmp/out/collections/COL/writing/reading-log-ITEM.md",
      contextSourceHash: "sourcehash"
    });

    expect(report).toContain("templateVersion: paper-reading-log-v1");
    expect(report).toContain("# 论文阅读日志");
    expect(report).toContain("- 题名: Reading Log Paper");
    expect(report).toContain("## 阅读核对清单");
    expect(report).toContain("### 方法/模型");
    expect(report).toContain("[chunk:summary-method source=summary locator=summary:1 hash=methodhash]");
    expect(report).toContain("[chunk:note-limit source=note locator=note:1 hash=limithash]");
    expect(report).toContain("## 复用计划");
  });

  it("exports a paper reading log from the workbench context", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "en-US";
    workbench.state.item = {
      key: "ITEM",
      getCollections: () => [10]
    };
    workbench.state.contextSourceHash = "sourcehash";
    workbench.state.context = {
      metadata: { title: "Reading Log Paper", authors: ["Ada One"], year: "2026", doi: "10.1000/log" },
      chunks: [
        {
          chunkId: "summary-method",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "methodhash",
          text: "The paper proposes a method and reports experiment results."
        }
      ],
      diagnostics: { chunkCount: 1, fulltextChars: 900, annotationCount: 0, noteCount: 0, summaryChars: 100 }
    };
    workbench.t = (key: string) => key;

    await (workbench as any).exportReadingLog();

    const logPath = "/tmp/out/collections/COL/writing/reading-log-ITEM.md";
    expect(files.get(logPath)).toContain("# Paper Reading Log");
    expect(files.get(logPath)).toContain("Reading Log Paper");
    expect(files.get(logPath)).toContain("[chunk:summary-method source=summary locator=summary:1 hash=methodhash]");
    expect(dom.elements.get("zms-status").textContent).toContain(`readingLogDone: ${logPath}`);
  });

  it("renders a literature matrix report with comparison evidence labels", () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const item = {
      key: "FOC",
      getCollections: () => [10]
    };
    const report = loaded.renderComparisonReportMarkdown({
      metadata: {
        title: "Focal Paper",
        authors: ["Ada One"],
        year: "2026",
        doi: "10.1000/focal"
      },
      chunks: [
        {
          chunkId: "summary-focal",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "focalhash",
          text: "The focal method uses graph attention and reports limitations in sparse scenarios."
        }
      ],
      diagnostics: { chunkCount: 1, fulltextChars: 1200, annotationCount: 1, noteCount: 0 },
      comparisonContexts: [
        {
          itemKey: "CMP",
          metadata: {
            title: "Comparison Paper",
            authors: ["Bo Two"],
            year: "2025",
            doi: "10.1000/compare"
          },
          chunks: [
            {
              chunkId: "summary-compare",
              sourceType: "summary",
              locator: "summary:1",
              sourceHash: "comparehash",
              text: "The comparison model evaluates transformer attention on a larger dataset."
            }
          ],
          diagnostics: { chunkCount: 1, fulltextChars: 900, annotationCount: 0, noteCount: 1 }
        }
      ]
    }, {
      item,
      outputLanguage: "zh-CN",
      generatedAt: "2026-06-20T00:00:00.000Z",
      reportPath: "/tmp/out/collections/COL/writing/literature-matrix-FOC.md",
      contextSourceHash: "sourcehash"
    });

    expect(report).toContain("templateVersion: literature-matrix-v1");
    expect(report).toContain("# 文献对比矩阵");
    expect(report).toContain("| 焦点论文 | [chunk:metadata itemKey=FOC]");
    expect(report).toContain("| 对比论文 1 | [paper2:metadata itemKey=CMP]");
    expect(report).toContain("### 方法/模型");
    expect(report).toContain("[chunk:summary-focal source=summary locator=summary:1 hash=focalhash]");
    expect(report).toContain("[paper2:summary-compare source=summary locator=summary:1 hash=comparehash]");
    expect(report).toContain("## 横向分析清单");
    expect(report).toContain("## 证据摘录索引");
  });

  it("exports a literature matrix report from comparison contexts", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "en-US";
    workbench.state.item = {
      key: "FOC",
      getCollections: () => [10]
    };
    workbench.state.contextSourceHash = "sourcehash";
    workbench.state.context = {
      metadata: { title: "Focal Paper", authors: ["Ada One"], year: "2026", doi: "10.1000/focal" },
      chunks: [
        {
          chunkId: "summary-focal",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "focalhash",
          text: "The focal paper defines the research question and method."
        }
      ],
      diagnostics: { chunkCount: 1, fulltextChars: 1200, annotationCount: 0, noteCount: 0 },
      comparisonContexts: [
        {
          itemKey: "CMP",
          metadata: { title: "Comparison Paper", authors: ["Bo Two"], year: "2025", doi: "" },
          chunks: [
            {
              chunkId: "summary-compare",
              sourceType: "summary",
              locator: "summary:1",
              sourceHash: "comparehash",
              text: "The comparison paper reports experiment metrics and limitations."
            }
          ],
          diagnostics: { chunkCount: 1, fulltextChars: 1000, annotationCount: 0, noteCount: 0 }
        }
      ]
    };
    workbench.t = (key: string) => key;

    await (workbench as any).exportComparisonReport();

    const reportPath = "/tmp/out/collections/COL/writing/literature-matrix-FOC.md";
    expect(files.get(reportPath)).toContain("# Literature Matrix");
    expect(files.get(reportPath)).toContain("Comparison Paper");
    expect(files.get(reportPath)).toContain("[paper2:summary-compare source=summary locator=summary:1 hash=comparehash]");
    expect(dom.elements.get("zms-status").textContent).toContain(`comparisonReportDone: ${reportPath}`);
  });

  it("renders a figure/table extraction report from the latest visual answer", () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const item = {
      key: "IMG",
      getCollections: () => [10]
    };
    const report = loaded.renderVisualExtractionReportMarkdown({
      item,
      context: {
        metadata: { title: "Visual Paper" }
      },
      messages: [
        {
          id: "user-1",
          role: "user",
          skillId: "figure-table-extractor",
          content: "Analyze this image",
          images: [{
            name: "figure.png",
            mimeType: "image/png",
            size: 1234,
            localOcr: { status: "ok", engine: "tesseract", language: "eng", text: "Axis Delay 12 ms" }
          }]
        },
        {
          id: "assistant-1",
          role: "assistant",
          skillId: "figure-table-extractor",
          profileName: "MiniMax",
          content: [
            "## Visual OCR Text",
            "- Axis: Delay [image]",
            "",
            "## Reconstructed Data Table",
            "| Item | Value | Source |",
            "| --- | --- | --- |",
            "| Delay | 12 ms | [image] |",
            "",
            "## Interpretation And Evidence Map",
            "- Supported by [chunk:summary-method source=summary locator=summary:1 hash=abc123]"
          ].join("\n")
        }
      ]
    }, {
      item,
      outputLanguage: "en-US",
      generatedAt: "2026-06-20T00:00:00.000Z",
      reportPath: "/tmp/out/collections/COL/writing/visual-extraction-IMG.md",
      contextSourceHash: "sourcehash"
    });

    expect(report).toContain('templateVersion: "visual-extraction-report-v2"');
    expect(report).toContain("# Figure/Table Extraction Report");
    expect(report).toContain("| figure.png | image/png | 1234 |");
    expect(report).toContain("recognized: Axis Delay 12 ms");
    expect(report).toContain("## Structured Extraction Index");
    expect(report).toContain("Visual OCR Text");
    expect(report).toContain("## Reconstructed Tables / Data");
    expect(report).toContain("| Delay | 12 ms | [image] |");
    expect(report).toContain("## Machine-Readable Data");
    expect(report).toContain("| 1 | 1 | Value | 12 ms | not labeled |");
    expect(report).toContain("`[image]`");
    expect(report).toContain("`[chunk:summary-method source=summary locator=summary:1 hash=abc123]`");
    expect(report).toContain("## Original Model Answer");
  });

  it("exports a figure/table extraction report from workbench messages", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "zh-CN";
    workbench.state.item = {
      key: "IMG",
      getCollections: () => [10]
    };
    workbench.state.contextSourceHash = "sourcehash";
    workbench.state.context = {
      metadata: { title: "视觉论文" }
    };
    workbench.state.messages = [
      {
        id: "user-visual",
        role: "user",
        skillId: "",
        content: "请解析图片",
        images: [{ name: "chart.png", mimeType: "image/png", size: 77 }]
      },
      {
        id: "assistant-visual",
        role: "assistant",
        skillId: "",
        profileName: "MiniMax",
        content: "## 视觉 OCR 文本\n- 坐标轴: delay [image]\n\n## 重建表格\n| 指标 | 数值 |\n| --- | --- |\n| delay | 12 ms |"
      }
    ];
    workbench.t = (key: string) => key;

    await (workbench as any).exportVisualExtractionReport();

    const reportPath = "/tmp/out/collections/COL/writing/visual-extraction-IMG.md";
    expect(files.get(reportPath)).toContain("# 图表/截图解析报告");
    expect(files.get(reportPath)).toContain("视觉论文");
    expect(files.get(reportPath)).toContain("| chart.png | image/png | 77 |");
    expect(files.get(reportPath)).toContain("## 重建表格/数据");
    expect(files.get(reportPath)).toContain("| delay | 12 ms |");
    expect(files.get(reportPath)).toContain("## 机器可读数据");
    expect(files.get(reportPath)).toContain("| 1 | 1 | 指标 | delay | 未标注 |");
    const jsonPath = "/tmp/out/collections/COL/writing/visual-extraction-IMG.json";
    const csvPath = "/tmp/out/collections/COL/writing/visual-extraction-IMG.csv";
    const parsed = JSON.parse(files.get(jsonPath) || "{}");
    expect(parsed).toMatchObject({
      templateVersion: "visual-extraction-report-v2",
      itemKey: "IMG",
      reportPath,
      jsonPath,
      csvPath,
      images: [{ name: "chart.png", mimeType: "image/png", size: 77 }]
    });
    expect(parsed.tables[0]).toMatchObject({
      tableIndex: 1,
      columns: ["指标", "数值"],
      rows: [{ "指标": "delay", "数值": "12 ms" }]
    });
    expect(files.get(csvPath)).toContain("tableIndex,rowIndex,column,value,evidenceLabels,sourceAssistantMessageId,imageNames");
    expect(files.get(csvPath)).toContain("1,1,指标,delay,,assistant-visual,chart.png");
    expect(files.get(csvPath)).toContain("1,1,数值,12 ms,,assistant-visual,chart.png");
    expect(dom.elements.get("zms-status").textContent).toContain(`visualReportDone: ${reportPath}`);
  });

  it("renders a formal review draft with evidence-backed writing sections", () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const item = {
      key: "FOC",
      getCollections: () => [10]
    };
    const draft = loaded.renderReviewDraftMarkdown({
      metadata: {
        title: "Focal Review Paper",
        authors: ["Ada One"],
        year: "2026",
        doi: "10.1000/focal"
      },
      chunks: [
        {
          chunkId: "focal-method",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "focalhash",
          text: "The method taxonomy separates graph attention models from optimization baselines."
        },
        {
          chunkId: "focal-limit",
          sourceType: "note",
          locator: "note:1",
          sourceHash: "limithash",
          text: "Limitations include missing ablations and weak evidence for sparse scenarios."
        }
      ],
      diagnostics: { chunkCount: 2, fulltextChars: 1200, annotationCount: 0, noteCount: 1 },
      comparisonContexts: [
        {
          itemKey: "CMP",
          metadata: { title: "Comparison Evidence Paper", authors: ["Bo Two"], year: "2025", doi: "" },
          chunks: [
            {
              chunkId: "compare-results",
              sourceType: "summary",
              locator: "summary:1",
              sourceHash: "comparehash",
              text: "The comparison paper reports dataset metrics and a stronger experiment setup."
            }
          ],
          diagnostics: { chunkCount: 1, fulltextChars: 800, annotationCount: 0, noteCount: 0 }
        }
      ]
    }, {
      item,
      outputLanguage: "zh-CN",
      generatedAt: "2026-06-20T00:00:00.000Z",
      draftPath: "/tmp/out/collections/COL/writing/review-draft-FOC.md",
      contextSourceHash: "sourcehash"
    });

    expect(draft).toContain("templateVersion: formal-review-draft-v1");
    expect(draft).toContain("# 正式综述草稿");
    expect(draft).toContain("## 写作定位");
    expect(draft).toContain("## 方法分类与证据矩阵");
    expect(draft).toContain("## 证据综合草稿");
    expect(draft).toContain("### 方法谱系");
    expect(draft).toContain("[chunk:focal-method source=summary locator=summary:1 hash=focalhash]");
    expect(draft).toContain("[paper2:compare-results source=summary locator=summary:1 hash=comparehash]");
    expect(draft).toContain("## 风险与核查点");
    expect(draft).toContain("## 证据摘录索引");
  });

  it("exports a formal review draft from the workbench context", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "en-US";
    workbench.state.item = {
      key: "FOC",
      getCollections: () => [10]
    };
    workbench.state.contextSourceHash = "sourcehash";
    workbench.state.context = {
      metadata: { title: "Focal Review Paper", authors: ["Ada One"], year: "2026", doi: "10.1000/focal" },
      chunks: [
        {
          chunkId: "focal-method",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "focalhash",
          text: "The focal paper defines the research question and method taxonomy."
        }
      ],
      diagnostics: { chunkCount: 1, fulltextChars: 900, annotationCount: 0, noteCount: 0 },
      comparisonContexts: [
        {
          itemKey: "CMP",
          metadata: { title: "Comparison Evidence Paper", authors: ["Bo Two"], year: "2025", doi: "" },
          chunks: [
            {
              chunkId: "compare-results",
              sourceType: "summary",
              locator: "summary:1",
              sourceHash: "comparehash",
              text: "The comparison paper reports experiment metrics and limitations."
            }
          ],
          diagnostics: { chunkCount: 1, fulltextChars: 1000, annotationCount: 0, noteCount: 0 }
        }
      ]
    };
    workbench.t = (key: string) => key;

    await (workbench as any).exportReviewDraft();

    const draftPath = "/tmp/out/collections/COL/writing/review-draft-FOC.md";
    expect(files.get(draftPath)).toContain("# Formal Review Draft");
    expect(files.get(draftPath)).toContain("Focal Review Paper");
    expect(files.get(draftPath)).toContain("[paper2:compare-results source=summary locator=summary:1 hash=comparehash]");
    expect(dom.elements.get("zms-status").textContent).toContain(`reviewDraftDone: ${draftPath}`);
  });

  it("renders a proposal note with evidence-backed proposal sections", () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const item = {
      key: "ITEM",
      getCollections: () => [10]
    };
    const note = loaded.renderProposalNoteMarkdown({
      metadata: {
        title: "Proposal Source Paper",
        authors: ["Ada One"],
        year: "2026",
        doi: "10.1000/proposal"
      },
      chunks: [
        {
          chunkId: "proposal-method",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "methodhash",
          text: "The method model and algorithm framework define a technical route for the proposal."
        },
        {
          chunkId: "proposal-limit",
          sourceType: "note",
          locator: "note:1",
          sourceHash: "limithash",
          text: "The limitation and feasibility risks require additional experiment evidence."
        }
      ],
      diagnostics: { chunkCount: 2, fulltextChars: 1200, annotationCount: 0, noteCount: 1 }
    }, {
      item,
      outputLanguage: "zh-CN",
      promptPackId: "transportation",
      generatedAt: "2026-06-20T00:00:00.000Z",
      notePath: "/tmp/out/collections/COL/writing/proposal-note-ITEM.md",
      contextSourceHash: "sourcehash"
    });

    expect(note).toContain("templateVersion: proposal-note-v1");
    expect(note).toContain('promptPackId: "transportation"');
    expect(note).toContain("# 开题与课题申报笔记");
    expect(note).toContain("## 选题框架");
    expect(note).toContain("## 领域化写作格式");
    expect(note).toContain("交通与城市空域");
    expect(note).toContain("明确道路/空域/网络约束");
    expect(note).toContain("### 技术路线与方法基础");
    expect(note).toContain("[chunk:proposal-method source=summary locator=summary:1 hash=methodhash]");
    expect(note).toContain("## 风险核查");
    expect(note).toContain("## 证据摘录索引");
  });

  it("exports a proposal note from the workbench context", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "en-US";
    workbench.state.promptPackId = "biomedicine";
    workbench.state.item = {
      key: "ITEM",
      getCollections: () => [10]
    };
    workbench.state.contextSourceHash = "sourcehash";
    workbench.state.context = {
      metadata: { title: "Proposal Source Paper", authors: ["Ada One"], year: "2026", doi: "10.1000/proposal" },
      chunks: [
        {
          chunkId: "proposal-method",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "methodhash",
          text: "The method model and algorithm framework define a technical route for the proposal."
        }
      ],
      diagnostics: { chunkCount: 1, fulltextChars: 900, annotationCount: 0, noteCount: 0 }
    };
    workbench.t = (key: string) => key;

    await workbench.exportProposalNote();

    const notePath = "/tmp/out/collections/COL/writing/proposal-note-ITEM.md";
    expect(files.get(notePath)).toContain("# Proposal Note");
    expect(files.get(notePath)).toContain('promptPackId: "biomedicine"');
    expect(files.get(notePath)).toContain("Biomedicine and life sciences");
    expect(files.get(notePath)).toContain("Define study design, sample or cohort");
    expect(files.get(notePath)).toContain("Proposal Source Paper");
    expect(files.get(notePath)).toContain("[chunk:proposal-method source=summary locator=summary:1 hash=methodhash]");
    expect(dom.elements.get("zms-status").textContent).toContain(`proposalNoteDone: ${notePath}`);
  });

  it("renders a journal outline with focal and comparison evidence", () => {
    const loaded = loadWorkbenchHelpers();
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const item = {
      key: "FOC",
      getCollections: () => [10]
    };
    const outline = loaded.renderJournalOutlineMarkdown({
      metadata: {
        title: "Focal Writing Paper",
        authors: ["Ada One"],
        year: "2026",
        doi: "10.1000/focal"
      },
      chunks: [
        {
          chunkId: "focal-abstract",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "focalhash",
          text: "The abstract states the contribution, method, result, and research problem."
        }
      ],
      diagnostics: { chunkCount: 1, fulltextChars: 1000, annotationCount: 0, noteCount: 0 },
      comparisonContexts: [
        {
          itemKey: "CMP",
          metadata: { title: "Comparison Evidence Paper", authors: ["Bo Two"], year: "2025", doi: "" },
          chunks: [
            {
              chunkId: "compare-results",
              sourceType: "summary",
              locator: "summary:1",
              sourceHash: "comparehash",
              text: "The comparison paper reports experiment metrics and limitations."
            }
          ],
          diagnostics: { chunkCount: 1, fulltextChars: 800, annotationCount: 0, noteCount: 0 }
        }
      ]
    }, {
      item,
      outputLanguage: "zh-CN",
      promptPackId: "ai-ml",
      generatedAt: "2026-06-20T00:00:00.000Z",
      outlinePath: "/tmp/out/collections/COL/writing/journal-outline-FOC.md",
      contextSourceHash: "sourcehash"
    });

    expect(outline).toContain("templateVersion: journal-outline-v1");
    expect(outline).toContain('promptPackId: "ai-ml"');
    expect(outline).toContain("# 期刊/报告写作提纲");
    expect(outline).toContain("## 投稿/报告定位");
    expect(outline).toContain("## 领域化写作格式");
    expect(outline).toContain("AI/ML/系统");
    expect(outline).toContain("模型类别、数据与评价协议");
    expect(outline).toContain("## 正文提纲");
    expect(outline).toContain("标题与摘要");
    expect(outline).toContain("[chunk:focal-abstract source=summary locator=summary:1 hash=focalhash]");
    expect(outline).toContain("[paper2:compare-results source=summary locator=summary:1 hash=comparehash]");
    expect(outline).toContain("## 投稿/报告核查清单");
  });

  it("exports a journal outline from the workbench context", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument();
    (loaded as any).document = dom;
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.outputLanguage = "en-US";
    workbench.state.promptPackId = "review-writing";
    workbench.state.item = {
      key: "FOC",
      getCollections: () => [10]
    };
    workbench.state.contextSourceHash = "sourcehash";
    workbench.state.context = {
      metadata: { title: "Focal Writing Paper", authors: ["Ada One"], year: "2026", doi: "10.1000/focal" },
      chunks: [
        {
          chunkId: "focal-abstract",
          sourceType: "summary",
          locator: "summary:1",
          sourceHash: "focalhash",
          text: "The abstract states the contribution, method, result, and research problem."
        }
      ],
      diagnostics: { chunkCount: 1, fulltextChars: 1000, annotationCount: 0, noteCount: 0 },
      comparisonContexts: [
        {
          itemKey: "CMP",
          metadata: { title: "Comparison Evidence Paper", authors: ["Bo Two"], year: "2025", doi: "" },
          chunks: [
            {
              chunkId: "compare-results",
              sourceType: "summary",
              locator: "summary:1",
              sourceHash: "comparehash",
              text: "The comparison paper reports experiment metrics and limitations."
            }
          ],
          diagnostics: { chunkCount: 1, fulltextChars: 800, annotationCount: 0, noteCount: 0 }
        }
      ]
    };
    workbench.t = (key: string) => key;

    await workbench.exportJournalOutline();

    const outlinePath = "/tmp/out/collections/COL/writing/journal-outline-FOC.md";
    expect(files.get(outlinePath)).toContain("# Journal / Report Outline");
    expect(files.get(outlinePath)).toContain('promptPackId: "review-writing"');
    expect(files.get(outlinePath)).toContain("Literature-review writing");
    expect(files.get(outlinePath)).toContain("Organize related work by taxonomy dimensions");
    expect(files.get(outlinePath)).toContain("Comparison Evidence Paper");
    expect(files.get(outlinePath)).toContain("[paper2:compare-results source=summary locator=summary:1 hash=comparehash]");
    expect(dom.elements.get("zms-status").textContent).toContain(`journalOutlineDone: ${outlinePath}`);
  });

  it("chooses citation-network seeds from the current item and high-value candidates", () => {
    const loaded = loadWorkbenchHelpers();
    const item = {
      key: "ITEM",
      getField: (field: string) => {
        if (field === "title") return "Current Paper";
        if (field === "DOI") return "10.1000/current";
        return "";
      }
    };
    const seeds = loaded.citationNetworkSeedsForWorkbench([
      {
        candidateId: "title:title-only:2026",
        title: "Title Only",
        decision: "include",
        ids: {},
        quality: { dedupeStatus: "new" },
        priority: { tier: "high" }
      },
      {
        candidateId: "doi:10.1000/dup",
        title: "Duplicate",
        decision: "include",
        ids: { doi: "10.1000/dup" },
        quality: { dedupeStatus: "duplicate" },
        priority: { tier: "high" }
      },
      {
        candidateId: "doi:10.1000/a",
        title: "Candidate A",
        decision: "to_read",
        ids: { doi: "10.1000/a", semanticScholarId: "S2-A" },
        sourceIds: { semantic_scholar: "S2-A" },
        quality: { dedupeStatus: "new" },
        priority: { tier: "medium" }
      }
    ], item, 3);

    expect(seeds).toEqual([
      expect.objectContaining({ candidateId: "ITEM", title: "Current Paper", doi: "10.1000/current" }),
      expect.objectContaining({ candidateId: "doi:10.1000/a", semanticScholarId: "S2-A" })
    ]);
    expect(loaded.citationNetworkMetaText({
      networkOrigins: [{ direction: "references", seedId: "S2-A", seedTitle: "Candidate A" }]
    })).toBe("network:references:Candidate A");
  });

  it("reads configurable citation-network policy options from the workbench controls", () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument({
      "zms-citation-policy": "broad",
      "zms-citation-direction": "citations",
      "zms-citation-hops": "3",
      "zms-citation-max-requests": "30",
      "zms-citation-per-seed": "7",
      "zms-citation-seed-limit": "6"
    });
    (loaded as any).document = dom;

    expect(loaded.citationNetworkOptionsFromDom()).toMatchObject({
      policy: "broad",
      directions: ["citations"],
      maxHops: 3,
      maxNetworkRequests: 30,
      perSeedLimit: 7,
      seedLimit: 6,
      nextHopSeedLimit: 6
    });

    loaded.applyCitationNetworkPolicyToDom("precise");

    expect(dom.elements.get("zms-citation-hops").value).toBe("1");
    expect(dom.elements.get("zms-citation-max-requests").value).toBe("6");
    expect(dom.elements.get("zms-citation-per-seed").value).toBe("3");
    expect(dom.elements.get("zms-citation-seed-limit").value).toBe("3");
  });

  it("passes custom citation-network policy settings into the workbench expansion request", async () => {
    const files = new Map<string, string>();
    const loaded = loadWorkbenchHelpers(files);
    const dom = fakeDocument({
      "zms-candidate-query": "graph attention traffic",
      "zms-candidate-limit": "10",
      "zms-candidate-email": "",
      "zms-candidate-semantic-key": "s2-key",
      "zms-citation-policy": "broad",
      "zms-citation-direction": "references",
      "zms-citation-hops": "3",
      "zms-citation-max-requests": "25",
      "zms-citation-per-seed": "9",
      "zms-citation-seed-limit": "5"
    });
    (loaded as any).document = dom;
    const calls: any[] = [];
    (loaded as any).window.ZMSCandidateSources = {
      expandCandidateCitationNetwork: async (_fetchImpl: any, options: any, existing: any[]) => {
        calls.push({ options, existing });
        return { records: [], papers: [], errors: [], requests: [], hops: 3 };
      },
      mergeCandidateRecords: (existing: any[], records: any[]) => [...existing, ...records]
    };
    (loaded as any).fetch = async () => ({ ok: true, status: 200, text: async () => "{}" });
    loaded.__zoteroCollections.set(10, { key: "COL" });
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench;
    workbench.state.outputDir = "/tmp/out";
    workbench.state.item = {
      key: "ITEM",
      getCollections: () => [10],
      getField: (field: string) => {
        if (field === "title") return "Current Paper";
        if (field === "DOI") return "10.1000/current";
        return "";
      }
    };
    workbench.state.candidates = [
      {
        candidateId: "doi:10.1000/a",
        title: "Candidate A",
        decision: "to_read",
        ids: { doi: "10.1000/a", semanticScholarId: "S2-A" },
        sourceIds: { semantic_scholar: "S2-A" },
        quality: { dedupeStatus: "new" },
        priority: { tier: "high" }
      }
    ];
    workbench.t = (key: string) => key;

    await (workbench as any).expandCandidateCitationNetwork();

    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({
      query: "graph attention traffic",
      semanticScholarApiKey: "s2-key",
      directions: ["references"],
      maxHops: 3,
      maxNetworkRequests: 25,
      perSeedLimit: 9,
      nextHopSeedLimit: 5,
      networkPolicy: "broad"
    });
    expect(calls[0].options.seeds).toHaveLength(2);
    expect(dom.elements.get("zms-status").textContent).toContain("candidateCitationNetworkDone: 0; seeds 2; hops 3; policy broad");
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
    const renderedCandidate = dom.elements.get("zms-candidate-list").children[0];
    const reviewControls = renderedCandidate.children.find((child: any) => child.className === "zms-candidate-review-controls");
    expect(reviewControls.children.map((child: any) => child.dataset)).toEqual([
      { candidateDecision: "doi:10.1000/uav" },
      { candidateScreening: "doi:10.1000/uav" },
      { candidateExclusionReason: "doi:10.1000/uav" }
    ]);
    const noteInput = renderedCandidate.children.find((child: any) => child.dataset?.candidateNote === "doi:10.1000/uav");
    expect(noteInput).toMatchObject({
      className: "zms-candidate-note",
      placeholder: "candidateReviewNotePlaceholder"
    });
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
      content: "<think type=\"reasoning\">private reasoning</think>\n\n## Result\n\nInline $x^2$"
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

  it("keeps malformed think blocks out of copied and written answer text", () => {
    const loaded = loadWorkbenchHelpers();
    const assistant = {
      role: "assistant",
      content: "## Result\n\nVisible answer.\n\n<think data-source=\"router\">private reasoning without a closing tag"
    };

    expect(loaded.answerTextForMessage(assistant)).toBe("## Result\n\nVisible answer.");
  });

  it("renders editable OCR review controls on user image messages", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument();
    (loaded as any).document = dom;
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    const labels: Record<string, string> = {
      ocrReview: "OCR Review",
      ocrStatus: "Status",
      ocrText: "OCR text",
      saveOcr: "Save OCR",
      ocrSaved: "OCR saved",
      ocrCorrected: "corrected"
    };
    workbench.t = (key: string) => labels[key] || key;
    let saved = 0;
    workbench.saveSession = async () => {
      saved += 1;
    };
    const message = {
      id: "user-image",
      role: "user",
      content: "Please inspect this figure.",
      images: [
        {
          name: "figure.png",
          mimeType: "image/png",
          size: 12,
          localOcr: { status: "ok", engine: "tesseract", language: "eng", text: "Axis Delay 12 ms" }
        }
      ]
    };

    workbench.appendMessageElement(message);

    const user = dom.elements.get("zms-messages").children[0];
    const reviewPanel = user.children.find((child: any) => child.className === "zms-user-image-review");
    expect(reviewPanel.children[0].textContent).toBe("OCR Review");
    const textarea = findNode(reviewPanel, (node) => node.className === "zms-user-image-review-text");
    const save = findNode(reviewPanel, (node) => node.className === "zms-user-image-review-save");
    expect(textarea.value).toBe("Axis Delay 12 ms");

    textarea.value = "Corrected Axis Delay 10 ms";
    await save.onclick();

    expect(message.images[0].localOcr).toMatchObject({
      status: "corrected",
      text: "Corrected Axis Delay 10 ms",
      error: ""
    });
    expect(saved).toBe(1);
    expect(dom.elements.get("zms-chat-status").textContent).toBe("OCR saved");
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

  it("stores provider usage metadata on assistant messages without changing answer text", async () => {
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
    workbench.callModel = async () => ({
      text: "answer body",
      usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 }
    });

    await workbench.send();

    const assistant = workbench.state.messages.find((message: any) => message.role === "assistant");
    expect(assistant.content).toBe("answer body");
    expect(assistant.usage).toEqual({ inputTokens: 12, outputTokens: 6, totalTokens: 18 });
    expect(loaded.answerTextForMessage(assistant)).toBe("answer body");
  });

  it("sends image-only messages with a localized default prompt", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument({
      "zms-input": "",
      "zms-skill": ""
    });
    (loaded as any).document = dom;
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    workbench.state.item = { key: "ITEM" };
    workbench.state.profile = {
      ...providerProfile(),
      capabilities: { ...providerProfile().capabilities, imageBase64: true }
    };
    workbench.state.messages = [];
    workbench.state.pendingImages = [
      { id: "img-1", name: "figure.png", mimeType: "image/png", base64: "aW1hZ2U=", size: 5 }
    ];
    workbench.state.outputLanguage = "zh-CN";
    workbench.state.uiLanguage = "zh-CN";
    workbench.t = (key: string) => key;
    workbench.saveSession = async () => undefined;
    let captured: any = null;
    workbench.callModel = async (content: string, skillId: string, _onDelta: (delta: string) => void, images: any[]) => {
      captured = { content, skillId, images };
      return "answer";
    };

    await workbench.send();

    expect(captured.content).toContain("请解析这张图片");
    expect(captured.skillId).toBe("");
    expect(captured.images).toHaveLength(1);
    expect(workbench.state.messages[0].content).toContain("请解析这张图片");
    expect(workbench.state.messages[0].images).toEqual([
      { name: "figure.png", mimeType: "image/png", size: 5 }
    ]);
    expect(workbench.state.pendingImages).toEqual([]);
  });

  it("stores optional local OCR metadata on image messages without sending it to the remote model", async () => {
    const loaded = loadWorkbenchHelpers();
    const dom = fakeDocument({
      "zms-input": "",
      "zms-skill": "",
      "zms-local-ocr-endpoint": "http://127.0.0.1:3333/mcp",
      "zms-local-ocr-tool": "ocr_image",
      "zms-local-ocr-language": "eng+chi_sim"
    });
    (loaded as any).document = dom;
    (loaded as any).fetch = async (url: string, options: any) => {
      expect(url).toBe("http://127.0.0.1:3333/mcp");
      const body = JSON.parse(options.body);
      expect(body.params.name).toBe("ocr_image");
      expect(body.params.arguments.image.base64).toBe("aW1hZ2U=");
      expect(body.params.arguments.language).toBe("eng+chi_sim");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          result: {
            content: [
              { type: "text", text: JSON.stringify({ engine: "tesseract", language: "eng+chi_sim", text: "Axis Delay 12 ms" }) }
            ]
          }
        })
      };
    };
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    workbench.state.item = { key: "ITEM" };
    workbench.state.profile = {
      ...providerProfile(),
      capabilities: { ...providerProfile().capabilities, imageBase64: true }
    };
    workbench.state.messages = [];
    workbench.state.pendingImages = [
      { id: "img-1", name: "figure.png", mimeType: "image/png", base64: "aW1hZ2U=", size: 5 }
    ];
    workbench.state.outputLanguage = "en-US";
    workbench.state.uiLanguage = "en-US";
    const localOcrInput = dom.getElementById("zms-local-ocr-input") as HTMLInputElement;
    localOcrInput.checked = true;
    workbench.t = (key: string) => key;
    workbench.saveSession = async () => undefined;
    let capturedImages: any[] = [];
    workbench.callModel = async (_content: string, _skillId: string, _onDelta: (delta: string) => void, images: any[]) => {
      capturedImages = images;
      return "answer";
    };

    await workbench.send();

    expect(capturedImages).toEqual([
      { id: "img-1", name: "figure.png", mimeType: "image/png", base64: "aW1hZ2U=", size: 5 }
    ]);
    expect(workbench.state.messages[0].images[0]).toMatchObject({
      name: "figure.png",
      mimeType: "image/png",
      size: 5,
      localOcr: {
        status: "ok",
        tool: "ocr_image",
        engine: "tesseract",
        language: "eng+chi_sim",
        text: "Axis Delay 12 ms"
      }
    });
  });

  it("persists workbench local OCR endpoint, tool, and language settings", () => {
    const prefs: Record<string, any> = {};
    const loaded = loadWorkbenchHelpers(new Map(), {}, prefs);
    const dom = fakeDocument({
      "zms-local-ocr-endpoint": "http://127.0.0.1:4444/mcp",
      "zms-local-ocr-tool": "custom_ocr",
      "zms-local-ocr-language": "eng+chi_sim"
    });
    (loaded as any).document = dom;
    const workbench = loaded.ZoteroMarkdownSummaryWorkbench as any;
    const localOcrInput = dom.getElementById("zms-local-ocr-input") as HTMLInputElement;
    localOcrInput.checked = true;

    expect(workbench.syncLocalOcrPreference()).toBe(true);

    expect(workbench.state).toMatchObject({
      localOcrEnabled: true,
      localOcrEndpoint: "http://127.0.0.1:4444/mcp",
      localOcrTool: "custom_ocr",
      localOcrLanguage: "eng+chi_sim"
    });
    expect(prefs).toMatchObject({
      localOcrEnabled: true,
      localOcrEndpoint: "http://127.0.0.1:4444/mcp",
      localOcrTool: "custom_ocr",
      localOcrLanguage: "eng+chi_sim"
    });
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

  it("includes comparison papers and evidence labels in prompt context", () => {
    const prompt = helpers.contextForPrompt({
      metadata: {
        title: "Focal Paper",
        authors: ["A. Author"],
        year: "2026",
        doi: "10.123/focal"
      },
      chunks: [
        {
          chunkId: "fulltext-0001",
          sourceType: "fulltext",
          locator: "fulltext:1",
          sourceHash: "focalhash",
          text: "The focal method uses graph attention for risk prediction."
        }
      ],
      comparisonContexts: [
        {
          itemKey: "COMPARE1",
          metadata: {
            title: "Comparison Paper",
            authors: ["B. Author"],
            year: "2025",
            doi: "10.123/compare"
          },
          chunks: [
            {
              chunkId: "summary-compare",
              sourceType: "summary",
              locator: "summary:2",
              sourceHash: "comparehash",
              text: "The comparison method uses transformer attention and reports limitation cases."
            }
          ]
        }
      ]
    }, "compare attention limitations");

    expect(prompt).toContain("Title: Focal Paper");
    expect(prompt).toContain("Cross-paper comparison task:");
    expect(prompt).toContain("Comparison paper 1:");
    expect(prompt).toContain("Title: Comparison Paper");
    expect(prompt).toContain("[paper2:summary-compare source=summary locator=summary:2 hash=comparehash] The comparison method uses transformer attention and reports limitation cases.");
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
        message: "Invalid API key sk-test-secret. Authorization: Bearer abc123. Perplexity pplx-test-secret"
      }
    }));

    expect(formatted).toContain("HTTP 401");
    expect(formatted).toContain("invalid_api_key");
    expect(formatted).toContain("invalid_request_error");
    expect(formatted).toContain("Invalid API key [redacted]");
    expect(formatted).toContain("Bearer [redacted]");
    expect(formatted).not.toContain("sk-test-secret");
    expect(formatted).not.toContain("Bearer abc123");
    expect(formatted).not.toContain("pplx-test-secret");
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

  it("downgrades unsupported OpenAI Chat stream options once in the workbench request path", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: any[] = [];
    loaded.fetch = async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push({ url, body });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              code: "invalid_request_error",
              message: "Unrecognized request argument supplied: stream_options"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        body: {},
        json: async () => ({ choices: [{ message: { content: "ok" } }] })
      };
    };

    const response = await loaded.requestModelWithRetry({
      ...providerProfile(),
      protocol: "openai_chat",
      capabilities: { ...providerProfile().capabilities, streaming: true }
    }, [
      { role: "user", content: "hello" }
    ], "zh-CN", "system", { type: "text", text: "context" }, true);

    expect(response.ok).toBe(true);
    expect(response.zmsRequestedStream).toBe(true);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true }
    });
    expect(fetchCalls[1].body).toMatchObject({ stream: true });
    expect(fetchCalls[1].body).not.toHaveProperty("stream_options");
  });

  it("downgrades unsupported OpenAI Chat JSON and token fields in the workbench request path", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: any[] = [];
    loaded.fetch = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push({ body });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              code: "unsupported_parameter",
              message: "response_format and max_completion_tokens are not supported"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] })
      };
    };

    const response = await loaded.requestModelWithRetry({
      ...providerProfile(),
      protocol: "openai_chat",
      model: "o3-mini",
      capabilities: { ...providerProfile().capabilities, jsonMode: true }
    }, [
      { role: "user", content: "hello" }
    ], "zh-CN", "system", { type: "text", text: "context" }, false);

    expect(response.ok).toBe(true);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].body).toMatchObject({
      response_format: { type: "json_object" },
      max_completion_tokens: 8192
    });
    expect(fetchCalls[1].body).not.toHaveProperty("response_format");
    expect(fetchCalls[1].body).not.toHaveProperty("max_completion_tokens");
  });

  it("downgrades OpenAI Responses optional fields across multiple workbench attempts", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: any[] = [];
    loaded.fetch = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push({ body });
      if (body.text) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              code: "unsupported_parameter",
              message: "Unsupported parameter: text.format"
            }
          })
        };
      }
      if (body.max_output_tokens) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              code: "unsupported_parameter",
              message: "Unsupported parameter: max_output_tokens"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: "ok" })
      };
    };

    const response = await loaded.requestModelWithRetry({
      ...providerProfile(),
      protocol: "openai_responses",
      capabilities: { ...providerProfile().capabilities, jsonMode: true }
    }, [
      { role: "user", content: "hello" }
    ], "zh-CN", "system", { type: "text", text: "context" }, false);

    expect(response.ok).toBe(true);
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[0].body).toMatchObject({
      text: { format: { type: "json_object" } },
      max_output_tokens: 8192
    });
    expect(fetchCalls[1].body).not.toHaveProperty("text");
    expect(fetchCalls[1].body).toMatchObject({ max_output_tokens: 8192 });
    expect(fetchCalls[2].body).not.toHaveProperty("text");
    expect(fetchCalls[2].body).not.toHaveProperty("max_output_tokens");
  });

  it("downgrades Anthropic-compatible optional fields across multiple workbench attempts", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: any[] = [];
    loaded.fetch = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push({ body });
      if (body.metadata) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "Unsupported parameter: metadata"
            }
          })
        };
      }
      if (Object.prototype.hasOwnProperty.call(body, "stream")) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "Unsupported parameter: stream"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: "ok" }] })
      };
    };

    const response = await loaded.requestModelWithRetry({
      ...providerProfile(),
      id: "anthropic-compatible",
      protocol: "anthropic_messages",
      baseURL: "https://router.example/v1",
      capabilities: { ...providerProfile().capabilities, pdfBase64: false },
      bodyExtra: { metadata: { source: "zotero" } }
    }, [
      { role: "user", content: "hello" }
    ], "zh-CN", "system", { type: "text", text: "context" }, false);

    expect(response.ok).toBe(true);
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[0].body).toMatchObject({
      metadata: { source: "zotero" },
      stream: false
    });
    expect(fetchCalls[1].body).not.toHaveProperty("metadata");
    expect(fetchCalls[1].body).toMatchObject({ stream: false });
    expect(fetchCalls[2].body).not.toHaveProperty("metadata");
    expect(fetchCalls[2].body).not.toHaveProperty("stream");
  });

  it("falls back to non-streaming when an OpenAI Chat route rejects streaming", async () => {
    const loaded: any = loadWorkbenchHelpers();
    const fetchCalls: any[] = [];
    loaded.fetch = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push({ body });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 422,
          text: async () => JSON.stringify({
            error: {
              code: "unsupported_parameter",
              message: "stream is not supported by this model"
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] })
      };
    };

    const response = await loaded.requestModelWithRetry({
      ...providerProfile(),
      protocol: "openai_chat",
      capabilities: { ...providerProfile().capabilities, streaming: true }
    }, [
      { role: "user", content: "hello" }
    ], "zh-CN", "system", { type: "text", text: "context" }, true);

    expect(response.ok).toBe(true);
    expect(response.zmsRequestedStream).toBe(false);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].body).toMatchObject({ stream: true });
    expect(fetchCalls[1].body).not.toHaveProperty("stream");
    expect(fetchCalls[1].body).not.toHaveProperty("stream_options");
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
