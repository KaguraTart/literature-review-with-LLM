import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadPreferencesHelpers() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/preferences.js"), "utf8");
  const context = createContext({
    window: {},
    document: {
      getElementById: () => ({ checked: false })
    },
    URL,
    console
  });
  runInContext(code, context, { filename: "preferences.js" });
  return context as {
    parseLocalAgentConfig: (raw: any) => any;
    providerBodyExtra: (bodyExtra: any) => Record<string, any>;
    connectionTestRequestForProfile: (profile: any) => any;
    localAgentConnectionTestRequestForProfile: (profile: any) => any;
    localAgentToolsListRequestForProfile: (profile: any) => any;
    localAgentToolNamesFromResponse: (data: any) => string[];
    isLocalAgentProfile: (profile: any) => boolean;
    headersForProfile: (profile: any) => Record<string, string>;
    profileHasUsableAuth: (profile: any) => boolean;
    modelListRequestForProfile: (profile: any) => any;
    modelIdsFromResponse: (data: any) => string[];
    modelOptionsFromResponse: (data: any) => Array<{ id: string; label: string }>;
    providerErrorText: (status: number, text: string) => string;
    localAgentErrorText: (status: number, text: string) => string;
    extractProviderConnectionText: (protocol: string, text: string) => string;
    normalizeProfileId: (value: string) => string;
    providerFromProfile: (profile: any) => string;
    builtInSkillTemplate: (skillId: string, outputLanguage: string) => string;
    providerDefaults: (provider: string) => any;
    providerSetupGuide: (profile: any, language?: string) => string;
    providerConfigDoctor: (profile: any, language?: string) => any;
    applyProviderEnvTextToProfile: (profile: any, raw: string, provider?: string) => any;
    defaultProviderProfiles: () => any[];
    mergeDefaultProviderProfiles: (profiles: any[]) => any[];
    normalizeProviderProfile: (profile: any) => any;
  };
}

function loadPreferencesController(options: {
  fetchResponse?: any;
  fetchResponses?: any[];
  fetchOk?: boolean;
  fetchStatus?: number;
  initialModel?: string;
  skillFiles?: string[];
  filePickerPath?: string;
  filePickerFile?: any;
  filePickerFiles?: any;
  filePickerFileURL?: any;
  filePickerUseShow?: boolean;
  filePickerInitThrowsWithWindow?: boolean;
  filePickerOpenThrowsWithWindow?: boolean;
  filePickerOpenReturnsPromise?: boolean;
  filePickerDisplayDirectoryThrows?: boolean;
  filePickerReturn?: number;
  filePickerExistingPaths?: string[];
  filePickerExtraProps?: Record<string, any>;
  filePickerWindowBrowsingContext?: boolean;
  filePickerUseZoteroWrapper?: boolean;
  noZmsMessage?: boolean;
  makeDirectoryThrows?: boolean;
} = {}) {
  const code = readFileSync(resolve(process.cwd(), "addon/content/preferences.js"), "utf8");
  const elements = new Map<string, any>();
  const fetchCalls: Array<{ url: string; init: any }> = [];
  const skillFiles = new Set(options.skillFiles || []);
  const filePickerConstants = {
    modeGetFolder: 2,
    returnOK: 0,
    returnCancel: 1,
    returnReplace: 2
  };
  const filePickerCalls: Array<{ title: string; mode: number; parent?: string | null; displayDirectory?: string }> = [];
  const messageMap: Record<string, string> = {
    apiKeyMissing: "API key missing",
    chooseOutputDir: "Choose Folder...",
    chooseOutputDirTitle: "Choose output folder",
    chooseOutputDirTooltip: "Choose an output folder with the system file manager",
    jsonInvalid: "Invalid JSON",
    modelListEmpty: "No models",
    modelListLoaded: "Models loaded",
    modelListUnavailable: "Model list unavailable",
    modelRecommendationsLoaded: "Recommended models loaded",
    profilesReset: "Default provider profiles restored",
    resetProfiles: "Reset default profiles",
    testOk: "Connection OK",
    testFailed: "Connection failed",
    doctorOk: "Configuration preflight passed",
    doctorFailed: "Configuration preflight failed",
    providerEnvApplied: "Config imported",
    providerEnvNoInput: "Paste KEY=value config first",
    providerEnvNoMatch: "No matching environment variables for this profile",
    noProfile: "No profile",
    profileProtocolStatus: "Protocol",
    profileModelStatus: "Model",
    profileEndpointStatus: "Endpoint",
    profileEndpointMissing: "Not configured",
    profileModelMissing: "Not configured",
    profileModelOptional: "Optional",
    profileAuthReady: "Authentication configured",
    profileAuthMissing: "Missing authentication",
    profilePdfReady: "Raw PDF input supported",
    profilePdfTextOnly: "Text input only",
    profileImageReady: "Image input supported",
    profileImageOff: "Image input disabled",
    profileStreamReady: "Streaming supported",
    profileStreamOff: "Streaming disabled",
    profileLocalAgentReady: "Local agent configured",
    outputDirSaved: "Output directory saved",
    saveOutputDir: "Save",
    saveOutputDirTooltip: "Save the current output directory",
    outputDirChooseFailed: "Output directory picker failed",
    outputDirCreateFailed: "Output directory failed"
  };
  const prefValues = new Map<string, any>();
  const madeDirectories: string[] = [];
  const createElement = (id: string, props: Record<string, any> = {}) => {
    let text = props.textContent || "";
    const eventListeners = new Map<string, Array<(event?: any) => void>>();
    const element: any = {
      id,
      localName: props.localName || "input",
      value: props.value || "",
      checked: !!props.checked,
      children: [] as any[],
      attributes: {} as Record<string, string>,
      dataset: {},
      eventListeners,
      appendChild(child: any) {
        this.children.push(child);
      },
      addEventListener(type: string, listener: (event?: any) => void) {
        const listeners = eventListeners.get(type) || [];
        listeners.push(listener);
        eventListeners.set(type, listeners);
      },
      setAttribute(name: string, value: string) {
        this.attributes[name] = String(value);
        this[name] = String(value);
      },
      get textContent() {
        return text;
      },
      set textContent(value: string) {
        text = String(value);
        if (value === "") this.children = [];
      }
    };
    for (const [key, value] of Object.entries(props)) {
      if (key !== "textContent") element[key] = value;
    }
    elements.set(id, element);
    return element;
  };
  const setValue = (id: string, value: string) => createElement(id, { value });
  const setChecked = (id: string, checked: boolean) => createElement(id, { checked });

  setValue("zms-uiLanguage", "en-US");
  setValue("zms-provider", "openai");
  setValue("zms-activeProfileId", "openai");
  setValue("zms-profileName", "OpenAI");
  setValue("zms-profileProtocol", "openai_responses");
  setValue("zms-profileEndpointMode", "base_url");
  setValue("zms-baseURL", "https://api.openai.com/v1");
  setValue("zms-profileFullURL", "");
  setValue("zms-apiKey", "sk-test-secret");
  setValue("zms-model", options.initialModel || "");
  setValue("zms-outputDir", "/tmp/out");
  setValue("zms-inputMode", "text");
  setValue("zms-maxOutputTokens", "8192");
  setValue("zms-temperature", "1");
  setValue("zms-systemPrompt", "");
  setValue("zms-userPrompt", "");
  setValue("zms-outputLanguage", "zh-CN");
  setValue("zms-profilesJson", "[]");
  setValue("zms-skillId", "paper-deep-summary");
  setValue("zms-skillTemplate", "");
  setValue("zms-profileCustomHeaders", "{\"x-route\":\"paper\"}");
  setValue("zms-profileBodyExtra", "{}");
  setValue("zms-profileLocalAgentTimeout", "");
  setValue("zms-profileLocalAgentEndpoint", "");
  setValue("zms-profileLocalAgentTool", "");
  setValue("zms-profileLocalAgentPayloadMode", "jsonrpc");
  setValue("zms-profileLocalAgentHeaders", "{}");
  setValue("zms-profileLocalAgentSkills", "{}");
  createElement("zms-status", { localName: "label" });
  createElement("zms-choose-outputDir-button", { localName: "button" });
  createElement("zms-save-outputDir-button", { localName: "button" });
  createElement("zms-model-select", { localName: "select" });
  createElement("zms-model-options", { localName: "datalist" });
  createElement("zms-profile-options", { localName: "datalist" });
  createElement("zms-profileStatus", { localName: "pre" });
  createElement("zms-providerGuide", { localName: "pre" });
  createElement("zms-providerEnvText", { localName: "textarea" });
  createElement("zms-apply-provider-env-button", { localName: "button" });
  createElement("zms-doctor-button", { localName: "button" });
  setChecked("zms-stream", false);
  setChecked("zms-profileLocalAgentFallback", false);
  setChecked("zms-profileLocalAgentEnabled", false);
  setChecked("zms-cap-text", true);
  setChecked("zms-cap-pdfBase64", true);
  setChecked("zms-cap-imageBase64", true);
  setChecked("zms-cap-streaming", false);
  setChecked("zms-cap-fileReference", false);
  setChecked("zms-cap-embeddings", false);
  setChecked("zms-cap-jsonMode", false);
  setChecked("zms-cap-toolUse", false);
  setChecked("zms-cap-modelList", true);

  const makeLocalFile = (initialPath = ""): any => ({
    path: initialPath,
    initWithPath(path: string) {
      this.path = path;
    },
    get parent() {
      const parentPath = this.path.replace(/[\\/][^\\/]*$/, "") || this.path;
      return parentPath && parentPath !== this.path ? makeLocalFile(parentPath) : null;
    },
    exists() {
      return !options.filePickerExistingPaths || options.filePickerExistingPaths.includes(this.path);
    },
    isDirectory: () => true
  });

  const windowObject: any = {};
  if (options.filePickerWindowBrowsingContext) {
    windowObject.browsingContext = { zmsKind: "browsingContext" };
  }
  const contextValues: Record<string, any> = {
    window: windowObject,
    document: {
      getElementById(id: string) {
        return elements.get(id) || createElement(id);
      },
      createElement(tag: string) {
        return createElement("", { localName: tag });
      }
    },
    URL,
    fetch: async (url: string, init: any) => {
      const responseIndex = fetchCalls.length;
      fetchCalls.push({ url, init });
      const rawPayload = options.fetchResponses
        ? options.fetchResponses[Math.min(responseIndex, options.fetchResponses.length - 1)]
        : options.fetchResponse || { data: [] };
      const payload = rawPayload && typeof rawPayload === "object" && "__fetchBody" in rawPayload
        ? rawPayload.__fetchBody
        : rawPayload;
      return {
        ok: rawPayload && typeof rawPayload === "object" && "__fetchOk" in rawPayload
          ? rawPayload.__fetchOk
          : options.fetchOk ?? true,
        status: rawPayload && typeof rawPayload === "object" && "__fetchStatus" in rawPayload
          ? rawPayload.__fetchStatus
          : options.fetchStatus ?? 200,
        text: async () => JSON.stringify(payload)
      };
    },
    IOUtils: {
      exists: async (path: string) => path === "/tmp/out/skills",
      getChildren: async (path: string) => path === "/tmp/out/skills" ? [...skillFiles] : [],
      makeDirectory: async (path: string) => {
        if (options.makeDirectoryThrows) throw new Error("cannot create output directory");
        madeDirectories.push(path);
      },
      writeUTF8: async (path: string) => {
        if (path.startsWith("/tmp/out/skills/")) skillFiles.add(path);
      }
    },
    PathUtils: {
      join: (...parts: string[]) => parts.filter(Boolean).join("/")
    },
    Cc: {
      "@mozilla.org/filepicker;1": {
        createInstance: () => {
          let initializedParent: string | null = null;
          const picker: any = {
            file: options.filePickerFile ?? { path: options.filePickerPath || "/tmp/chosen output" },
            files: options.filePickerFiles,
            fileURL: options.filePickerFileURL,
            init: (parent: any, title: string, mode: number) => {
              if (options.filePickerInitThrowsWithWindow && parent && parent.zmsKind !== "browsingContext") {
                throw new Error("window parent unsupported");
              }
              initializedParent = parent?.zmsKind || (parent ? "window" : null);
              filePickerCalls.push({ title, mode, parent: initializedParent });
            }
          };
          Object.assign(picker, options.filePickerExtraProps || {});
          if (options.filePickerUseShow) {
            picker.show = () => {
              if (options.filePickerOpenThrowsWithWindow && initializedParent === "window") {
                throw new Error("window parent open unsupported");
              }
              return options.filePickerReturn ?? filePickerConstants.returnOK;
            };
          } else if (options.filePickerOpenReturnsPromise) {
            picker.open = () => {
              if (options.filePickerOpenThrowsWithWindow && initializedParent === "window") {
                throw new Error("window parent open unsupported");
              }
              return Promise.resolve(options.filePickerReturn ?? filePickerConstants.returnOK);
            };
          } else {
            picker.open = (callback: (result: number) => void) => {
              if (options.filePickerOpenThrowsWithWindow && initializedParent === "window") {
                throw new Error("window parent open unsupported");
              }
              callback(options.filePickerReturn ?? filePickerConstants.returnOK);
            };
          }
          Object.defineProperty(picker, "displayDirectory", {
            set(value: any) {
              if (options.filePickerDisplayDirectoryThrows) throw new Error("display directory unsupported");
              const last = filePickerCalls[filePickerCalls.length - 1];
              if (last) last.displayDirectory = value?.path || "";
            }
          });
          return picker;
        }
      },
      "@mozilla.org/file/local;1": {
        createInstance: () => makeLocalFile("")
      }
    },
    Ci: {
      nsIFilePicker: filePickerConstants,
      nsIFile: function nsIFile() {},
      nsIFileURL: function nsIFileURL() {}
    },
    Zotero: {
      DataDirectory: {
        dir: "/tmp/zotero-data"
      },
      Prefs: {
        get: (key: string) => prefValues.get(key),
        set: (key: string, value: any) => {
          prefValues.set(key, value);
        }
      }
    },
    console
  };
  if (!options.noZmsMessage) {
    contextValues.zmsMessage = (_scope: string, key: string) => messageMap[key] || key;
  }
  if (options.filePickerUseZoteroWrapper) {
    contextValues.ChromeUtils = {
      importESModule: () => ({
        FilePicker: class FilePicker {
          modeGetFolder = filePickerConstants.modeGetFolder;
          returnOK = filePickerConstants.returnOK;
          returnCancel = filePickerConstants.returnCancel;
          returnReplace = filePickerConstants.returnReplace;
          filterAll = 1;
          file = options.filePickerPath || "/tmp/zotero wrapper output";
          _displayDirectory = "";
          init(parent: any, title: string, mode: number) {
            if (!parent?.browsingContext) throw new Error("missing browsing context");
            filePickerCalls.push({ title, mode, parent: "zoteroWindow", displayDirectory: this._displayDirectory });
          }
          set displayDirectory(value: string) {
            this._displayDirectory = value;
            const last = filePickerCalls[filePickerCalls.length - 1];
            if (last) last.displayDirectory = value;
          }
          appendFilters() {}
          async show() {
            return options.filePickerReturn ?? filePickerConstants.returnOK;
          }
        }
      })
    };
    windowObject.browsingContext = { zmsKind: "browsingContext" };
  }
  const context = createContext(contextValues);
  runInContext(code, context, { filename: "preferences.js" });
  return {
    controller: (context as any).window.ZoteroMarkdownSummaryPrefs,
    elements,
    fetchCalls,
    prefValues,
    madeDirectories,
    filePickerCalls
  };
}

describe("preferences local-agent config helpers", () => {
  const helpers = loadPreferencesHelpers();

  it("preserves root-level advanced local-agent fields", () => {
    const parsed = helpers.parseLocalAgentConfig({
      endpoint: "http://127.0.0.1:3333/mcp",
      method: "root.call",
      model: "local-model",
      timeoutSeconds: 180,
      args: { route: "default" },
      body: { shared: true },
      "ask-gemini": {
        method: "gemini.call",
        args: { provider: "gemini" }
      }
    });

    expect(parsed).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      method: "root.call",
      model: "local-model",
      timeoutSeconds: 180,
      args: { route: "default" },
      body: { shared: true },
      "ask-gemini": {
        method: "gemini.call",
        args: { provider: "gemini" }
      }
    });
  });

  it("normalizes profile ids before storing provider profiles", () => {
    expect(helpers.normalizeProfileId("../ My OpenAI:Profile?.md ")).toBe("My-OpenAI-Profile-.md");
    expect(helpers.normalizeProfileId("  local agents  ")).toBe("local-agents");
    expect(helpers.normalizeProfileId("...")).toBe("");
  });

  it("filters local-agent config from provider body extras", () => {
    expect(helpers.providerBodyExtra({
      extra_body: { reasoning_split: true },
      localAgent: { endpoint: "http://127.0.0.1:3333/mcp" },
      agent: { endpoint: "http://127.0.0.1:3334/mcp" },
      subagent: { endpoint: "http://127.0.0.1:3335/mcp" },
      directBrowserAccess: true,
      anthropicDirectBrowserAccess: false,
      omitAnthropicVersion: true,
      pdfInputFileField: "file_url",
      omitAnthropicDocument: true,
      imageURLFormat: "string",
      anthropicTextContentFormat: "blocks"
    })).toEqual({ extra_body: { reasoning_split: true } });
  });

  it("converts Anthropic string messages to text blocks in preferences fallback helpers", () => {
    const body = {
      model: "claude-compatible",
      messages: [{ role: "user", content: "ping" }]
    };
    const fields = (helpers as any).providerCompatibilityFallbackFields(
      "anthropic_messages",
      body,
      422,
      JSON.stringify({
        detail: [
          { type: "list_type", loc: ["body", "messages", 0, "content"], msg: "Input should be a valid list" }
        ]
      })
    );
    expect(fields).toEqual(["messages.content"]);
    expect((helpers as any).omitProviderRequestBodyFields(body, fields)).toMatchObject({
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }]
    });
    expect((helpers as any).providerCompatibilityFallbackFields(
      "anthropic_messages",
      body,
      400,
      "Unsupported header: anthropic-version"
    )).toEqual(["headers.anthropic-version"]);
  });

  it("converts OpenAI Chat image URL objects to strings in preferences fallback helpers", () => {
    const body = {
      model: "router-model",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
          ]
        }
      ]
    };
    const fields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      422,
      JSON.stringify({
        detail: [
          { type: "string_type", loc: ["body", "messages", 0, "content", 1, "image_url"], msg: "Input should be a valid string" }
        ]
      })
    );
    expect(fields).toEqual(["image_url.url"]);
    expect((helpers as any).omitProviderRequestBodyFields(body, fields).messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: "data:image/png;base64,abc"
    });
  });

  it("removes Responses input files in preferences fallback helpers after both PDF fields fail", () => {
    const body = {
      model: "responses-model",
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", filename: "paper.pdf", file_url: "data:application/pdf;base64,abc" },
            { type: "input_text", text: "ping" }
          ]
        }
      ]
    };
    const fields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_responses",
      body,
      400,
      "Unsupported parameter: file_url",
      ["input_file.file_data"]
    );
    expect(fields).toEqual(["input_file.file_url"]);
    expect((helpers as any).omitProviderRequestBodyFields(body, fields, ["input_file.file_data"]).input[0].content).toEqual([
      { type: "input_text", text: "ping" }
    ]);
  });

  it("removes Anthropic document blocks in preferences fallback helpers", () => {
    const body = {
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
    const fields = (helpers as any).providerCompatibilityFallbackFields(
      "anthropic_messages",
      body,
      422,
      JSON.stringify({
        detail: [
          { type: "unsupported_media_type", loc: ["body", "messages", 0, "content", 0, "source", "media_type"], msg: "Unsupported media_type application/pdf" }
        ]
      })
    );
    expect(fields).toEqual(["messages.content.document"]);
    expect((helpers as any).omitProviderRequestBodyFields(body, fields).messages[0].content).toEqual([
      { type: "text", text: "ping" }
    ]);
  });

  it("removes image inputs in preferences fallback helpers when providers reject vision content", () => {
    const openAIChatBody = {
      model: "router-model",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: "data:image/png;base64,abc" }
          ]
        }
      ]
    };
    const chatFields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      openAIChatBody,
      400,
      "image_url is not supported by this model"
    );
    expect(chatFields).toEqual(["messages.content.image_url"]);
    expect((helpers as any).omitProviderRequestBodyFields(openAIChatBody, chatFields).messages[0].content).toEqual([
      { type: "text", text: "describe" }
    ]);

    const responsesBody = {
      model: "responses-model",
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: "data:image/png;base64,abc" },
            { type: "input_text", text: "describe" }
          ]
        }
      ]
    };
    const responsesFields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_responses",
      responsesBody,
      422,
      "input_image is not supported"
    );
    expect(responsesFields).toEqual(["input.content.input_image"]);
    expect((helpers as any).omitProviderRequestBodyFields(responsesBody, responsesFields).input[0].content).toEqual([
      { type: "input_text", text: "describe" }
    ]);

    const anthropicBody = {
      model: "claude-compatible",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
            { type: "text", text: "describe" }
          ]
        }
      ]
    };
    const anthropicFields = (helpers as any).providerCompatibilityFallbackFields(
      "anthropic_messages",
      anthropicBody,
      422,
      "Unsupported image content block"
    );
    expect(anthropicFields).toEqual(["messages.content.image"]);
    expect((helpers as any).omitProviderRequestBodyFields(anthropicBody, anthropicFields).messages[0].content).toEqual([
      { type: "text", text: "describe" }
    ]);
  });

  it("omits rejected optional router body fields in preferences fallback helpers", () => {
    const body = {
      model: "router-model",
      messages: [{ role: "user", content: "ping" }],
      modalities: ["text"],
      safety_settings: [{ category: "test" }]
    };
    const fields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      400,
      "Unsupported parameters: modalities and safety_settings"
    );
    expect(fields).toEqual(["modalities", "safety_settings"]);
    expect((helpers as any).omitProviderRequestBodyFields(body, fields)).toEqual({
      model: "router-model",
      messages: [{ role: "user", content: "ping" }]
    });
    const streamingBody = {
      model: "router-model",
      messages: [],
      stream: true,
      stream_options: { include_usage: true }
    };
    const detailedFields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      streamingBody,
      200,
      JSON.stringify({
        error: {
          message: "Invalid request body",
          details: [
            { loc: ["body", "stream_options"], msg: "Extra inputs are not permitted" }
          ]
        }
      })
    );
    expect(detailedFields).toEqual(["stream_options"]);
    expect((helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      streamingBody,
      400,
      JSON.stringify({
        errors: [
          { dataPath: ".stream_options", message: "must NOT have additional properties" }
        ]
      })
    )).toEqual(["stream_options"]);
    expect((helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      streamingBody,
      400,
      JSON.stringify({
        errors: [
          {
            instancePath: "",
            keyword: "additionalProperties",
            params: { additionalProperty: "stream_options" },
            message: "must NOT have additional properties"
          }
        ]
      })
    )).toEqual(["stream_options"]);
    expect((helpers as any).omitProviderRequestBodyFields(streamingBody, detailedFields)).toEqual({
      model: "router-model",
      messages: [],
      stream: true
    });
  });

  it("omits rejected custom body-extra fields in preferences fallback helpers", () => {
    const body = {
      model: "router-model",
      messages: [],
      router_extra: { trace: true }
    };
    const fields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      422,
      JSON.stringify({
        error: {
          message: "Forbidden request field",
          forbidden_fields: ["router_extra"]
        }
      })
    );
    expect(fields).toEqual(["router_extra"]);
    expect((helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      400,
      "Unsupported parameter: router_extra"
    )).toEqual(["router_extra"]);
    expect((helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      200,
      JSON.stringify({ error: { message: "Unsupported parameter: router_extra" } })
    )).toEqual(["router_extra"]);
    expect((helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      {
        model: "router-model",
        messages: [],
        "route-hint": true
      },
      400,
      "Unknown argument route hint"
    )).toEqual(["route-hint"]);
    expect((helpers as any).omitProviderRequestBodyFields(body, fields)).toEqual({
      model: "router-model",
      messages: []
    });
    expect((helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      422,
      JSON.stringify({
        detail: [
          { type: "extra_forbidden", loc: ["body", "model"], msg: "Extra inputs are not permitted" }
        ]
      })
    )).toEqual([]);
  });

  it("moves rejected OpenAI Chat system role into the user message in preferences fallback helpers", () => {
    const body = {
      model: "router-model",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "ping" }
      ]
    };
    const fields = (helpers as any).providerCompatibilityFallbackFields(
      "openai_chat",
      body,
      422,
      JSON.stringify({
        detail: [
          { type: "literal_error", loc: ["body", "messages", 0, "role"], msg: "Input should be 'user' or 'assistant'" }
        ]
      })
    );
    expect(fields).toEqual(["messages.role.system"]);
    expect((helpers as any).omitProviderRequestBodyFields(body, fields)).toEqual({
      model: "router-model",
      messages: [{ role: "user", content: "SYSTEM:\nsystem\n\nping" }]
    });
  });

  it("builds a Responses connection test request from the edited profile", () => {
    const request = helpers.connectionTestRequestForProfile({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "model-a",
      customHeaders: { "x-route": "paper" },
      bodyExtra: {
        response_format: { type: "json_object" },
        pdfInputFileField: "file_url",
        localAgent: { endpoint: "http://127.0.0.1:3333/mcp" }
      }
    });

    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.headers).toMatchObject({ authorization: "Bearer sk-test-secret", "x-route": "paper" });
    expect(request.body).toMatchObject({
      model: "model-a",
      instructions: expect.stringContaining("connection test endpoint"),
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "ping" }]
        }
      ],
      max_output_tokens: 32,
      stream: false,
      response_format: { type: "json_object" }
    });
    expect(request.body).not.toHaveProperty("localAgent");
    expect(request.body).not.toHaveProperty("pdfInputFileField");

    const fallbackRequest = helpers.connectionTestRequestForProfile({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "responses-compatible",
      customHeaders: {},
      bodyExtra: { instructionsFallbackToUser: true }
    });
    expect(fallbackRequest.body).not.toHaveProperty("instructions");
    expect(fallbackRequest.body.input[0].content).toEqual([
      { type: "input_text", text: expect.stringContaining("SYSTEM:\nYou are a provider connection test endpoint") },
      { type: "input_text", text: "ping" }
    ]);

    const azureRequest = helpers.connectionTestRequestForProfile({
      id: "azure-openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://example-resource.openai.azure.com/openai/v1?api-version=preview",
      apiKey: "azure-secret",
      model: "azure-model",
      capabilities: { modelList: true },
      customHeaders: {},
      bodyExtra: {}
    });
    expect(azureRequest.url).toBe("https://example-resource.openai.azure.com/openai/v1/responses?api-version=preview");
    expect(azureRequest.headers).toMatchObject({ "api-key": "azure-secret" });
    expect(azureRequest.headers).not.toHaveProperty("authorization");
    expect(helpers.modelListRequestForProfile({
      id: "azure-openai",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://example-resource.openai.azure.com/openai/v1?api-version=preview",
      apiKey: "azure-secret",
      model: "azure-model",
      capabilities: { modelList: true },
      customHeaders: {},
      bodyExtra: {}
    })?.url).toBe("https://example-resource.openai.azure.com/openai/v1/models?api-version=preview");
  });

  it("adds JSON mode defaults to settings connection test requests", () => {
    expect(helpers.connectionTestRequestForProfile({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "model-a",
      capabilities: { jsonMode: true },
      customHeaders: {},
      bodyExtra: {}
    }).body).toMatchObject({
      text: { format: { type: "json_object" } }
    });

    expect(helpers.connectionTestRequestForProfile({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "sk-test-secret",
      model: "model-a",
      capabilities: { jsonMode: true },
      customHeaders: {},
      bodyExtra: {
        response_format: { type: "json_schema", json_schema: { name: "paper" } }
      }
    }).body).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "paper" } }
    });
  });

  it("builds OpenAI-compatible Chat connection and model-list requests without provider-specific extras", () => {
    const profile = {
      ...helpers.providerDefaults("openai_compatible"),
      apiKey: "sk-test-secret",
      model: "router-model",
      customHeaders: { "x-route": "paper" }
    };
    const request = helpers.connectionTestRequestForProfile(profile);
    const modelList = helpers.modelListRequestForProfile(profile);

    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.headers).toMatchObject({ authorization: "Bearer sk-test-secret", "x-route": "paper" });
    expect(request.body).toMatchObject({
      model: "router-model",
      messages: [
        { role: "system", content: expect.stringContaining("connection test endpoint") },
        { role: "user", content: "ping" }
      ],
      max_tokens: 32,
      stream: true,
      stream_options: { include_usage: true },
      n: 1
    });
    expect(request.body).not.toHaveProperty("extra_body");
    expect(modelList?.url).toBe("https://api.openai.com/v1/models");

    const nonStreamingRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      capabilities: { ...profile.capabilities, streaming: false }
    });
    expect(nonStreamingRequest.body).toMatchObject({ stream: false });
    expect(nonStreamingRequest.body).not.toHaveProperty("stream_options");

    const streamOptionOverride = helpers.connectionTestRequestForProfile({
      ...profile,
      bodyExtra: { stream_options: { include_usage: false } }
    });
    expect(streamOptionOverride.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: false }
    });

    const streamOptionOmitted = helpers.connectionTestRequestForProfile({
      ...profile,
      bodyExtra: { omitFields: ["stream_options"] }
    });
    expect(streamOptionOmitted.body).toMatchObject({ stream: true });
    expect(streamOptionOmitted.body).not.toHaveProperty("stream_options");

    const reasoningRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      model: "o1-preview"
    });
    expect(reasoningRequest.body).toMatchObject({ max_completion_tokens: 32 });
    expect(reasoningRequest.body).not.toHaveProperty("max_tokens");

    const explicitLegacyRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      model: "o3-mini",
      bodyExtra: { tokenLimitField: "max_tokens" }
    });
    expect(explicitLegacyRequest.body).toMatchObject({ max_tokens: 32 });
    expect(explicitLegacyRequest.body).not.toHaveProperty("max_completion_tokens");
    expect(explicitLegacyRequest.body).not.toHaveProperty("tokenLimitField");

    const strippedRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      bodyExtra: {
        response_format: { type: "json_object" },
        omitFields: ["temperature", "n", "max_tokens"]
      }
    });
    expect(strippedRequest.body).toMatchObject({ response_format: { type: "json_object" } });
    expect(strippedRequest.body).not.toHaveProperty("temperature");
    expect(strippedRequest.body).not.toHaveProperty("n");
    expect(strippedRequest.body).not.toHaveProperty("max_tokens");
    expect(strippedRequest.body).not.toHaveProperty("omitFields");

    const systemFallbackRequest = helpers.connectionTestRequestForProfile({
      ...profile,
      bodyExtra: { systemFallbackToUser: true }
    });
    expect(systemFallbackRequest.body.messages.some((message: any) => message.role === "system")).toBe(false);
    expect(systemFallbackRequest.body.messages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("SYSTEM:")
    });
    const anthropicSystemFallbackRequest = helpers.connectionTestRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://router.example",
      apiKey: "anthropic-secret",
      model: "claude-compatible",
      capabilities: { streaming: true, modelList: true },
      customHeaders: {},
      bodyExtra: { systemFallbackToUser: true }
    });
    expect(anthropicSystemFallbackRequest.body).not.toHaveProperty("system");
    expect(anthropicSystemFallbackRequest.body.messages[0].content).toContain("SYSTEM:\nYou are a provider connection test endpoint");
    expect(anthropicSystemFallbackRequest.body.messages[0].content).toContain("ping");

    const pastedChatEndpointProfile = {
      ...profile,
      baseURL: "https://api.openai.com/v1/chat/completions"
    };
    expect(helpers.connectionTestRequestForProfile(pastedChatEndpointProfile).url)
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(helpers.modelListRequestForProfile(pastedChatEndpointProfile)?.url)
      .toBe("https://api.openai.com/v1/models");
    const pastedChatModelsProfile = {
      ...profile,
      baseURL: "https://api.openai.com/v1/models"
    };
    expect(helpers.connectionTestRequestForProfile(pastedChatModelsProfile).url)
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(helpers.modelListRequestForProfile(pastedChatModelsProfile)?.url)
      .toBe("https://api.openai.com/v1/models");

    const noVersionProfile = {
      ...helpers.providerDefaults("deepseek"),
      apiKey: "sk-test-secret",
      model: "deepseek-chat"
    };
    expect(helpers.connectionTestRequestForProfile(noVersionProfile).url)
      .toBe("https://api.deepseek.com/v1/chat/completions");
    expect(helpers.modelListRequestForProfile(noVersionProfile)?.url)
      .toBe("https://api.deepseek.com/v1/models");

    const geminiProfile = {
      ...helpers.providerDefaults("gemini"),
      apiKey: "gemini-secret",
      model: "gemini-model"
    };
    expect(helpers.connectionTestRequestForProfile(geminiProfile).url)
      .toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(helpers.modelListRequestForProfile(geminiProfile)?.url)
      .toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");

    const azureProfile = {
      ...helpers.providerDefaults("azure_openai"),
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      model: "deployment-a"
    };
    expect(helpers.connectionTestRequestForProfile(azureProfile).url)
      .toBe("https://example-resource.openai.azure.com/openai/v1/responses");
    expect(helpers.connectionTestRequestForProfile(azureProfile).headers).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.connectionTestRequestForProfile(azureProfile).headers).not.toHaveProperty("authorization");

    const pastedResponsesEndpointProfile = {
      ...helpers.providerDefaults("openai"),
      baseURL: "https://api.openai.com/v1/responses",
      apiKey: "sk-test-secret",
      model: "response-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedResponsesEndpointProfile).url)
      .toBe("https://api.openai.com/v1/responses");
    expect(helpers.modelListRequestForProfile(pastedResponsesEndpointProfile)?.url)
      .toBe("https://api.openai.com/v1/models");
    const pastedResponsesModelsProfile = {
      ...helpers.providerDefaults("openai"),
      baseURL: "https://api.openai.com/v1/models",
      apiKey: "sk-test-secret",
      model: "response-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedResponsesModelsProfile).url)
      .toBe("https://api.openai.com/v1/responses");
    expect(helpers.modelListRequestForProfile(pastedResponsesModelsProfile)?.url)
      .toBe("https://api.openai.com/v1/models");

    const pastedAnthropicEndpointProfile = {
      ...helpers.providerDefaults("anthropic"),
      baseURL: "https://api.anthropic.com/v1/messages",
      apiKey: "anthropic-secret",
      model: "claude-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedAnthropicEndpointProfile).url)
      .toBe("https://api.anthropic.com/v1/messages");
    expect(helpers.modelListRequestForProfile(pastedAnthropicEndpointProfile)?.url)
      .toBe("https://api.anthropic.com/v1/models");
    const pastedAnthropicModelsProfile = {
      ...helpers.providerDefaults("anthropic"),
      baseURL: "https://api.anthropic.com/v1/models",
      apiKey: "anthropic-secret",
      model: "claude-model"
    };
    expect(helpers.connectionTestRequestForProfile(pastedAnthropicModelsProfile).url)
      .toBe("https://api.anthropic.com/v1/messages");
    expect(helpers.modelListRequestForProfile(pastedAnthropicModelsProfile)?.url)
      .toBe("https://api.anthropic.com/v1/models");

    const perplexityProfile = {
      ...helpers.providerDefaults("perplexity"),
      apiKey: "perplexity-secret",
      model: "sonar-pro"
    };
    expect(helpers.connectionTestRequestForProfile(perplexityProfile).url)
      .toBe("https://api.perplexity.ai/chat/completions");
    expect(helpers.modelListRequestForProfile(perplexityProfile)?.url)
      .toBe("https://api.perplexity.ai/models");
  });

  it("keeps settings custom auth headers and allows auth-header-only profiles", () => {
    const openaiProfile = {
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1",
      apiKey: "",
      customHeaders: { Authorization: "Bearer routed-secret" }
    };
    expect(helpers.profileHasUsableAuth(openaiProfile)).toBe(true);
    expect(helpers.headersForProfile(openaiProfile)).toMatchObject({ Authorization: "Bearer routed-secret" });
    expect(helpers.headersForProfile({ ...openaiProfile, customHeaders: {} })).not.toHaveProperty("authorization");
    expect(helpers.headersForProfile({ ...openaiProfile, apiKey: "sk-test-secret", customHeaders: { Authorization: "" } })).toMatchObject({ Authorization: "Bearer sk-test-secret" });
    expect(helpers.profileHasUsableAuth({ ...openaiProfile, apiKey: "", customHeaders: { "api-key": "azure-secret" } })).toBe(true);
    expect(helpers.headersForProfile({ ...openaiProfile, id: "azure-openai", apiKey: "azure-secret", customHeaders: { "api-key": "" } })).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.headersForProfile({ ...openaiProfile, apiKey: "sk-test-secret", customHeaders: { "api-key": "azure-secret" } })).toMatchObject({ "api-key": "azure-secret" });
    expect(helpers.headersForProfile({ ...openaiProfile, apiKey: "sk-test-secret", customHeaders: { "api-key": "azure-secret" } })).not.toHaveProperty("authorization");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: { "x-api-key": "" }
    })).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "",
      customHeaders: { "x-api-key": "anthropic-routed-secret" }
    })).toMatchObject({
      "x-api-key": "anthropic-routed-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "sk-test-secret",
      customHeaders: { Authorization: "Bearer routed-secret" }
    })).not.toHaveProperty("x-api-key");
    expect(helpers.headersForProfile({
      id: "anthropic-compatible",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example",
      apiKey: "anthropic-compatible-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer anthropic-compatible-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer deepseek-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.headersForProfile({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer zai-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      customHeaders: {}
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {}
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: { "x-api-key": "" }
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: { "x-api-key": "" }
    })).not.toHaveProperty("x-api-key");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization" }
    })).toMatchObject({ authorization: "Bearer routed-secret", "anthropic-version": "2023-06-01" });
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
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
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "anthropic-secret",
      customHeaders: {},
      bodyExtra: { directBrowserAccess: false }
    })).not.toHaveProperty("anthropic-dangerous-direct-browser-access");
    expect(helpers.headersForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://anthropic-router.example/v1",
      apiKey: "routed-secret",
      customHeaders: {},
      bodyExtra: { authHeader: "authorization", omitAnthropicVersion: true }
    })).not.toHaveProperty("anthropic-version");
    expect(helpers.profileHasUsableAuth({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:11434/v1",
      apiKey: "",
      customHeaders: {}
    })).toBe(true);
  });

  it("builds an Anthropic connection test request without duplicating v1", () => {
    const request = helpers.connectionTestRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "sk-test-secret",
      model: "model-b",
      customHeaders: {},
      bodyExtra: { metadata: { source: "settings" } }
    });

    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers).toMatchObject({
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });
    expect(request.body).toMatchObject({
      model: "model-b",
      system: expect.stringContaining("connection test endpoint"),
      max_tokens: 32,
      stream: false,
      metadata: { source: "settings" },
      messages: [{ role: "user", content: "ping" }]
    });
  });

  it("builds a local-agent connection test request without API credentials", () => {
    const profile = {
      bodyExtra: {
        localAgent: {
          endpoint: "127.0.0.1:3333/mcp",
          headers: { "x-local": "1" }
        }
      }
    };
    const request = helpers.localAgentConnectionTestRequestForProfile(profile);
    const toolsRequest = helpers.localAgentToolsListRequestForProfile(profile);

    expect(helpers.isLocalAgentProfile(profile)).toBe(true);
    expect(request.url).toBe("http://127.0.0.1:3333/mcp");
    expect(request.headers).toMatchObject({ "content-type": "application/json", "x-local": "1" });
    expect(request.body).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "zotero-markdown-summary-settings" }
      }
    });
    expect(toolsRequest.url).toBe("http://127.0.0.1:3333/mcp");
    expect(toolsRequest.headers).toMatchObject({ "content-type": "application/json", "x-local": "1" });
    expect(toolsRequest.body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list"
    });
    expect(helpers.localAgentToolNamesFromResponse({
      result: { tools: [{ name: "ask_gemini" }, { name: "ask_claude" }] }
    })).toEqual(["ask_gemini", "ask_claude"]);
  });

  it("builds model-list requests for OpenAI-compatible and Anthropic profiles", () => {
    const openai = helpers.modelListRequestForProfile({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true },
      customHeaders: { "x-route": "paper" }
    });
    expect(openai.url).toBe("https://api.openai.com/v1/models");
    expect(openai.headers).toMatchObject({ authorization: "Bearer sk-test-secret", "x-route": "paper" });

    const anthropic = helpers.modelListRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true },
      customHeaders: {}
    });
    expect(anthropic.url).toBe("https://api.anthropic.com/v1/models");
    expect(anthropic.headers).toMatchObject({
      "x-api-key": "sk-test-secret",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });

    const zaiAnthropic = helpers.modelListRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      apiKey: "zai-secret",
      capabilities: { modelList: true },
      customHeaders: {}
    });
    expect(zaiAnthropic.url).toBe("https://api.z.ai/api/anthropic/v1/models");
    expect(zaiAnthropic.headers).toMatchObject({ authorization: "Bearer zai-secret", "anthropic-version": "2023-06-01" });
    expect(zaiAnthropic.headers).not.toHaveProperty("anthropic-dangerous-direct-browser-access");

    expect(helpers.modelListRequestForProfile({
      protocol: "openai_chat",
      endpointMode: "full_url",
      baseURL: "https://example.test/custom",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true }
    })).toBeNull();
  });

  it("extracts model ids from common model-list response shapes", () => {
    expect(helpers.modelIdsFromResponse({
      data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }]
    })).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(helpers.modelIdsFromResponse({
      models: [{ name: "custom-a" }, "custom-b", { model: "custom-c" }]
    })).toEqual(["custom-a", "custom-b", "custom-c"]);
    expect(helpers.modelIdsFromResponse({
      result: { data: [{ id: "wrapped-a" }] }
    })).toEqual(["wrapped-a"]);
    expect(helpers.modelIdsFromResponse({
      payload: { models: [{ id: "wrapped-b" }] }
    })).toEqual(["wrapped-b"]);
    expect(helpers.modelIdsFromResponse({
      body: { model_list: [{ id: "wrapped-body" }] }
    })).toEqual(["wrapped-body"]);
    expect(helpers.modelIdsFromResponse({
      message: { models: { data: [{ id: "nested-models-data" }] } }
    })).toEqual(["nested-models-data"]);
    expect(helpers.modelIdsFromResponse({
      completion: { list: [{ name: "completion-list-model" }] }
    })).toEqual(["completion-list-model"]);
    expect(helpers.modelIdsFromResponse({
      result: { available_models: [{ model_name: "router-model-name" }, { modelId: "router-model-id" }] }
    })).toEqual(["router-model-id", "router-model-name"]);
    expect(helpers.modelIdsFromResponse({
      payload: { modelNames: ["string-model-name", { value: "value-model" }, { slug: "slug-model" }] }
    })).toEqual(["slug-model", "string-model-name", "value-model"]);
    expect(helpers.modelIdsFromResponse({ data: [{ id: "same" }, { id: "same" }] })).toEqual(["same"]);
    expect(helpers.modelOptionsFromResponse({
      data: [
        { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
        { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" }
      ],
      has_more: false
    })).toEqual([
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }
    ]);
    expect(helpers.modelOptionsFromResponse({
      data: [
        { model: "router-model", displayName: "Router Model" },
        { model_name: "model-name-field", title: "Model Name Field" },
        { value: "value-field", label: "Value Field" },
        { slug: "slug-field" },
        { id: "id-only-model" },
        { name: "name-only-model" },
        "string-model"
      ]
    })).toEqual([
      { id: "id-only-model", label: "id-only-model" },
      { id: "model-name-field", label: "Model Name Field" },
      { id: "name-only-model", label: "name-only-model" },
      { id: "router-model", label: "Router Model" },
      { id: "slug-field", label: "slug-field" },
      { id: "string-model", label: "string-model" },
      { id: "value-field", label: "Value Field" }
    ]);
  });

  it("formats settings provider errors without leaking API credentials", () => {
    const formatted = helpers.providerErrorText(401, JSON.stringify({
      error: {
        code: "invalid_api_key",
        type: "invalid_request_error",
        message: "Invalid API key sk-test-secret with Authorization: Bearer routed-secret and gsk_test-secret"
      }
    }));

    expect(formatted).toContain("HTTP 401");
    expect(formatted).toContain("invalid_api_key");
    expect(formatted).toContain("invalid_request_error");
    expect(formatted).toContain("Invalid API key [redacted]");
    expect(formatted).toContain("Bearer [redacted]");
    expect(formatted).not.toContain("sk-test-secret");
    expect(formatted).not.toContain("routed-secret");
    expect(formatted).not.toContain("gsk_test-secret");
    const wrapped = helpers.providerErrorText(401, JSON.stringify({
      payload: {
        status: "failed",
        code: "invalid_api_key",
        message: "Invalid API key sk-test-secret"
      }
    }));
    expect(wrapped).toContain("invalid_api_key");
    expect(wrapped).toContain("failed");
    expect(wrapped).toContain("Invalid API key [redacted]");
    expect(wrapped).not.toContain("sk-test-secret");
    expect(helpers.localAgentErrorText(200, JSON.stringify({
      error: { code: "tool_failed", message: "Tool failed with Bearer local-secret" }
    }))).toBe("tool_failed - Tool failed with Bearer [redacted]");
  });

  it("provides a local-agents preset for callable local skills", () => {
    expect(helpers.providerDefaults("openai")).toMatchObject({
      protocol: "openai_responses",
      capabilities: { streaming: true, pdfBase64: true }
    });
    expect(helpers.providerDefaults("openai_compatible")).toMatchObject({
      id: "openai-compatible",
      protocol: "openai_chat",
      baseURL: "https://api.openai.com/v1",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("openai_responses_compatible")).toMatchObject({
      id: "openai-responses-compatible",
      protocol: "openai_responses",
      baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
      capabilities: { streaming: true, pdfBase64: true, modelList: true }
    });
    expect(helpers.providerDefaults("anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      capabilities: { streaming: true, pdfBase64: true }
    });
    expect(helpers.providerDefaults("anthropic_compatible")).toMatchObject({
      id: "anthropic-compatible",
      protocol: "anthropic_messages",
      baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT",
      capabilities: { streaming: true, pdfBase64: false, modelList: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(helpers.providerDefaults("vercel_ai_chat")).toMatchObject({
      id: "vercel-ai-chat",
      protocol: "openai_chat",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      capabilities: { streaming: true, pdfBase64: false, imageBase64: true, modelList: true }
    });
    expect(helpers.providerDefaults("vercel_ai_responses")).toMatchObject({
      id: "vercel-ai-responses",
      protocol: "openai_responses",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      capabilities: { streaming: true, pdfBase64: true, imageBase64: true, modelList: true }
    });
    expect(helpers.providerDefaults("vercel_ai_anthropic")).toMatchObject({
      id: "vercel-ai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://ai-gateway.vercel.sh",
      capabilities: { streaming: true, pdfBase64: true, imageBase64: true, modelList: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(helpers.providerDefaults("cloudflare_ai_chat")).toMatchObject({
      id: "cloudflare-ai-chat",
      protocol: "openai_chat",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { streaming: true, pdfBase64: false, imageBase64: false, modelList: false }
    });
    expect(helpers.providerDefaults("cloudflare_ai_responses")).toMatchObject({
      id: "cloudflare-ai-responses",
      protocol: "openai_responses",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { streaming: true, pdfBase64: false, imageBase64: false, modelList: false }
    });
    expect(helpers.providerDefaults("cloudflare_ai_anthropic")).toMatchObject({
      id: "cloudflare-ai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { streaming: true, pdfBase64: false, imageBase64: false, modelList: false },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(helpers.providerDefaults("github_models")).toMatchObject({
      id: "github-models",
      protocol: "openai_chat",
      baseURL: "https://models.github.ai/inference",
      customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      capabilities: { streaming: true, pdfBase64: false, modelList: false }
    });
    expect(helpers.providerDefaults("huggingface")).toMatchObject({
      id: "huggingface",
      protocol: "openai_chat",
      baseURL: "https://router.huggingface.co/v1",
      capabilities: { streaming: true, pdfBase64: false, imageBase64: true, modelList: true }
    });
    expect(helpers.providerDefaults("deepinfra")).toMatchObject({
      id: "deepinfra",
      protocol: "openai_chat",
      baseURL: "https://api.deepinfra.com/v1/openai",
      capabilities: { streaming: true, pdfBase64: false, imageBase64: true, modelList: true }
    });
    expect(helpers.providerDefaults("fireworks")).toMatchObject({
      id: "fireworks",
      protocol: "openai_chat",
      baseURL: "https://api.fireworks.ai/inference/v1"
    });
    expect(helpers.providerDefaults("cerebras")).toMatchObject({
      id: "cerebras",
      protocol: "openai_chat",
      baseURL: "https://api.cerebras.ai/v1"
    });
    expect(helpers.providerDefaults("nvidia_nim")).toMatchObject({
      id: "nvidia-nim",
      protocol: "openai_chat",
      baseURL: "https://integrate.api.nvidia.com/v1"
    });
    expect(helpers.providerDefaults("sambanova")).toMatchObject({
      id: "sambanova",
      protocol: "openai_chat",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(helpers.providerDefaults("sambanova_responses")).toMatchObject({
      id: "sambanova-responses",
      protocol: "openai_responses",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(helpers.providerDefaults("sambanova_anthropic")).toMatchObject({
      id: "sambanova-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.sambanova.ai/v1",
      bodyExtra: { authHeader: "authorization" }
    });
    expect(helpers.providerDefaults("xai")).toMatchObject({
      id: "xai",
      protocol: "openai_chat",
      baseURL: "https://api.x.ai/v1"
    });
    expect(helpers.providerDefaults("groq")).toMatchObject({
      id: "groq",
      protocol: "openai_chat",
      baseURL: "https://api.groq.com/openai/v1"
    });
    expect(helpers.providerDefaults("mistral")).toMatchObject({
      id: "mistral",
      protocol: "openai_chat",
      baseURL: "https://api.mistral.ai/v1"
    });
    expect(helpers.providerDefaults("together")).toMatchObject({
      id: "together",
      protocol: "openai_chat",
      baseURL: "https://api.together.ai/v1"
    });
    expect(helpers.providerDefaults("kimi")).toMatchObject({
      id: "kimi",
      protocol: "openai_chat",
      baseURL: "https://api.moonshot.ai/v1"
    });
    expect(helpers.providerDefaults("perplexity")).toMatchObject({
      id: "perplexity",
      protocol: "openai_chat",
      baseURL: "https://api.perplexity.ai",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("deepseek")).toMatchObject({
      id: "deepseek",
      protocol: "openai_chat",
      baseURL: "https://api.deepseek.com",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("deepseek_anthropic")).toMatchObject({
      id: "deepseek-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.deepseek.com/anthropic",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("zai_anthropic")).toMatchObject({
      id: "zai-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("openrouter")).toMatchObject({
      id: "openrouter",
      protocol: "openai_chat",
      baseURL: "https://openrouter.ai/api/v1"
    });
    expect(helpers.providerDefaults("dashscope")).toMatchObject({
      id: "dashscope",
      protocol: "openai_chat",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    expect(helpers.providerDefaults("siliconflow")).toMatchObject({
      id: "siliconflow",
      protocol: "openai_chat",
      baseURL: "https://api.siliconflow.com/v1"
    });
    expect(helpers.providerDefaults("zhipu")).toMatchObject({
      id: "zhipu",
      protocol: "openai_chat",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("volcengine")).toMatchObject({
      id: "volcengine",
      protocol: "openai_chat",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("qianfan")).toMatchObject({
      id: "qianfan",
      protocol: "openai_chat",
      baseURL: "https://qianfan.baidubce.com/v2",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("hunyuan")).toMatchObject({
      id: "hunyuan",
      protocol: "openai_chat",
      baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
      capabilities: { modelList: true }
    });
    expect(helpers.providerDefaults("ollama")).toMatchObject({
      id: "ollama",
      protocol: "openai_chat",
      baseURL: "http://localhost:11434/v1",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    expect(helpers.providerDefaults("lm_studio")).toMatchObject({
      id: "lm-studio",
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:1234/v1",
      capabilities: { streaming: true, pdfBase64: false, modelList: true }
    });
    const localAgentsPreset = {
      id: "local-agents",
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:3333/v1",
      capabilities: { streaming: false, modelList: false },
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          payloadMode: "jsonrpc",
          timeoutSeconds: 180,
          "ask-gemini": { tool: "ask_gemini" },
          "ask-claude": { tool: "ask_claude" },
          "ask-opencode": { tool: "ask_opencode" },
          "ask-all-agents": { tool: "ask_all_agents" },
          "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } },
          "check-local-agents": { tool: "check_local_agents" }
        }
      }
    };
    expect(helpers.providerDefaults("local_agents")).toMatchObject(localAgentsPreset);
    expect(helpers.providerDefaults("local-agents")).toMatchObject(localAgentsPreset);
  });

  it("builds restorable default provider profiles for major provider protocols", () => {
    const profiles = helpers.defaultProviderProfiles();

    expect(profiles.map((profile) => profile.id)).toEqual([
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
    expect(profiles.map((profile) => profile.isDefault)).toEqual(profiles.map((_, index) => index === 0));
    expect(profiles.every((profile) => profile.apiKey === "")).toBe(true);
    expect(profiles.find((profile) => profile.id === "openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1"
    });
    expect(profiles.find((profile) => profile.id === "openai-compatible")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      bodyExtra: {}
    });
    expect(profiles.find((profile) => profile.id === "openai-responses-compatible")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
      bodyExtra: {}
    });
    expect(profiles.find((profile) => profile.id === "anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com"
    });
    expect(profiles.find((profile) => profile.id === "anthropic-compatible")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT",
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile) => profile.id === "gemini")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
    });
    expect(profiles.find((profile) => profile.id === "azure-openai")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1",
      customHeaders: {}
    });
    expect(profiles.find((profile) => profile.id === "vercel-ai-chat")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      capabilities: { imageBase64: true, pdfBase64: false, modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "vercel-ai-responses")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      capabilities: { imageBase64: true, pdfBase64: true, modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "vercel-ai-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh",
      capabilities: { imageBase64: true, pdfBase64: true, modelList: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile) => profile.id === "cloudflare-ai-chat")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { imageBase64: false, modelList: false }
    });
    expect(profiles.find((profile) => profile.id === "cloudflare-ai-responses")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { imageBase64: false, modelList: false }
    });
    expect(profiles.find((profile) => profile.id === "cloudflare-ai-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      capabilities: { imageBase64: false, modelList: false },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    });
    expect(profiles.find((profile) => profile.id === "github-models")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://models.github.ai/inference",
      customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      capabilities: { modelList: false }
    });
    expect(profiles.find((profile) => profile.id === "huggingface")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.huggingface.co/v1",
      capabilities: { imageBase64: true, modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "deepinfra")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepinfra.com/v1/openai",
      capabilities: { imageBase64: true, modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "fireworks")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.fireworks.ai/inference/v1"
    });
    expect(profiles.find((profile) => profile.id === "cerebras")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cerebras.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "nvidia-nim")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://integrate.api.nvidia.com/v1"
    });
    expect(profiles.find((profile) => profile.id === "sambanova")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "sambanova-responses")).toMatchObject({
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "sambanova-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1",
      bodyExtra: { authHeader: "authorization" }
    });
    expect(profiles.find((profile) => profile.id === "xai")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.x.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "groq")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.groq.com/openai/v1"
    });
    expect(profiles.find((profile) => profile.id === "mistral")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.mistral.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "together")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.together.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "kimi")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.moonshot.ai/v1"
    });
    expect(profiles.find((profile) => profile.id === "perplexity")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.perplexity.ai",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "deepseek")).toMatchObject({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com"
    });
    expect(profiles.find((profile) => profile.id === "deepseek-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com/anthropic"
    });
    expect(profiles.find((profile) => profile.id === "zai-anthropic")).toMatchObject({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "openrouter")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://openrouter.ai/api/v1"
    });
    expect(profiles.find((profile) => profile.id === "dashscope")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    expect(profiles.find((profile) => profile.id === "siliconflow")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.siliconflow.com/v1"
    });
    expect(profiles.find((profile) => profile.id === "zhipu")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "volcengine")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "qianfan")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://qianfan.baidubce.com/v2",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "hunyuan")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
      capabilities: { modelList: true }
    });
    expect(profiles.find((profile) => profile.id === "ollama")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "http://localhost:11434/v1"
    });
    expect(profiles.find((profile) => profile.id === "lm-studio")).toMatchObject({
      protocol: "openai_chat",
      baseURL: "http://127.0.0.1:1234/v1"
    });
    expect(profiles.find((profile) => profile.id === "local-agents")).toMatchObject({
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

  it("merges missing default provider profiles without overwriting user profiles", () => {
    const profiles = helpers.mergeDefaultProviderProfiles([
      {
        id: "openai",
        name: "OpenAI",
        protocol: "openai_responses",
        baseURL: "https://api.openai.com/v1",
        apiKey: "kept-secret",
        model: "kept-model",
        customHeaders: { "x-route": "kept" },
        isDefault: true
      },
      {
        id: "custom-router",
        name: "Custom Router",
        protocol: "openai_chat",
        baseURL: "https://router.example/v1",
        apiKey: "custom-secret",
        isDefault: false
      }
    ]);

    expect(profiles.find((profile) => profile.id === "openai")).toMatchObject({
      apiKey: "kept-secret",
      model: "kept-model",
      customHeaders: { "x-route": "kept" },
      isDefault: true
    });
    expect(profiles.find((profile) => profile.id === "custom-router")).toMatchObject({
      apiKey: "custom-secret"
    });
    expect(profiles.map((profile) => profile.id)).toEqual(expect.arrayContaining([
      "gemini",
      "azure-openai",
      "vercel-ai-chat",
      "vercel-ai-responses",
      "vercel-ai-anthropic",
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
      "local-agents"
    ]));
    expect(profiles.filter((profile) => profile.isDefault)).toHaveLength(1);
  });

  it("normalizes imported provider profiles before merging defaults", () => {
    const profiles = helpers.mergeDefaultProviderProfiles([
      {
        id: "../ Custom Router:Profile? ",
        name: "",
        protocol: "bad_protocol",
        endpointMode: "streaming_url",
        baseURL: " https://router.example/v1/responses/ ",
        apiKey: "  sk-custom  ",
        model: "  model-a  ",
        capabilities: { streaming: "false", pdfBase64: "yes", modelList: "0", jsonMode: "on" },
        customHeaders: ["broken"],
        bodyExtra: ["broken"],
        isDefault: true
      }
    ]);
    const profile = profiles[0];

    expect(profile).toMatchObject({
      id: "Custom-Router-Profile",
      name: "OpenAI Compatible Chat",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1/responses/",
      apiKey: "sk-custom",
      model: "model-a",
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
    expect(profiles.filter((candidate) => candidate.isDefault)).toHaveLength(1);
    expect(profiles.map((candidate) => candidate.id)).toContain("openai");
  });

  it("keeps OpenAI-compatible chat profiles out of the MiniMax preset", () => {
    expect(helpers.providerFromProfile({
      id: "openai-compatible",
      protocol: "openai_chat",
      baseURL: "https://api.openai.com/v1",
      bodyExtra: {}
    })).toBe("openai_compatible");
    expect(helpers.providerFromProfile({
      id: "router",
      protocol: "openai_chat",
      baseURL: "https://router.example/v1",
      bodyExtra: {}
    })).toBe("openai_compatible");
    expect(helpers.providerFromProfile({
      id: "responses-router",
      protocol: "openai_responses",
      baseURL: "https://router.example/v1",
      bodyExtra: {}
    })).toBe("openai_responses_compatible");
    expect(helpers.providerFromProfile({
      id: "official-openai",
      protocol: "openai_responses",
      baseURL: "https://api.openai.com/v1",
      bodyExtra: {}
    })).toBe("openai");
    expect(helpers.providerFromProfile({
      id: "minimax",
      protocol: "openai_chat",
      baseURL: "https://api.minimaxi.com/v1",
      bodyExtra: { extra_body: { reasoning_split: true } }
    })).toBe("minimax");
    expect(helpers.providerFromProfile({
      id: "moonshot",
      protocol: "openai_chat",
      baseURL: "https://api.moonshot.ai/v1",
      bodyExtra: {}
    })).toBe("kimi");
    expect(helpers.providerFromProfile({
      id: "custom-perplexity",
      protocol: "openai_chat",
      baseURL: "https://api.perplexity.ai",
      bodyExtra: {}
    })).toBe("perplexity");
    expect(helpers.providerFromProfile({
      id: "custom-zai",
      protocol: "anthropic_messages",
      baseURL: "https://api.z.ai/api/anthropic/v1/messages",
      bodyExtra: {}
    })).toBe("zai_anthropic");
    expect(helpers.providerFromProfile({
      id: "hf",
      protocol: "openai_chat",
      baseURL: "https://router.huggingface.co/v1",
      bodyExtra: {}
    })).toBe("huggingface");
    expect(helpers.providerFromProfile({
      id: "deep_infra",
      protocol: "openai_chat",
      baseURL: "https://api.deepinfra.com/v1/openai",
      bodyExtra: {}
    })).toBe("deepinfra");
    expect(helpers.providerFromProfile({
      id: "vercel-ai-gateway",
      protocol: "openai_chat",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      bodyExtra: {}
    })).toBe("vercel_ai_chat");
    expect(helpers.providerFromProfile({
      id: "custom-vercel-responses",
      protocol: "openai_responses",
      baseURL: "https://ai-gateway.vercel.sh/v1/responses",
      bodyExtra: {}
    })).toBe("vercel_ai_responses");
    expect(helpers.providerFromProfile({
      id: "custom-vercel-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://ai-gateway.vercel.sh/v1/messages",
      bodyExtra: {}
    })).toBe("vercel_ai_anthropic");
    expect(helpers.providerFromProfile({
      id: "cloudflare_workers_ai",
      protocol: "openai_chat",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1",
      bodyExtra: {}
    })).toBe("cloudflare_ai_chat");
    expect(helpers.providerFromProfile({
      id: "custom-cloudflare-responses",
      protocol: "openai_responses",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/responses",
      bodyExtra: {}
    })).toBe("cloudflare_ai_responses");
    expect(helpers.providerFromProfile({
      id: "custom-cloudflare-anthropic",
      protocol: "anthropic_messages",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/messages",
      bodyExtra: {}
    })).toBe("cloudflare_ai_anthropic");
  });

  it("keeps local-agent skill reset templates specific to their tools", () => {
    expect(helpers.builtInSkillTemplate("figure-table-extractor", "en-US")).toContain("[image]");
    expect(helpers.builtInSkillTemplate("figure-table-extractor", "zh-CN")).toContain("图表");
    expect(helpers.builtInSkillTemplate("literature-matrix-builder", "en-US")).toContain("literature matrix");
    expect(helpers.builtInSkillTemplate("literature-matrix-builder", "zh-CN")).toContain("[paper2:<id>]");
    expect(helpers.builtInSkillTemplate("literature-review-synthesis", "zh-CN")).toContain("跨论文综合");
    expect(helpers.builtInSkillTemplate("literature-review-synthesis", "en-US")).toContain("cross-paper synthesis");
    expect(helpers.builtInSkillTemplate("ask-all-agents", "en-US")).toContain("Gemini, Claude, and opencode");
    expect(helpers.builtInSkillTemplate("ask-gemini-claude", "en-US")).toContain("Gemini and Claude");
    expect(helpers.builtInSkillTemplate("check-local-agents", "en-US")).toContain("availability");
    expect(helpers.builtInSkillTemplate("check-local-agents", "zh-CN")).toContain("请使用中文输出。");
  });

  it("discovers custom skill templates from the output skills directory", async () => {
    const { controller, elements } = loadPreferencesController({
      skillFiles: [
        "/tmp/out/skills/roadmap-audit.md",
        "/tmp/out/skills/readme.txt",
        "/tmp/out/skills/../unsafe.md"
      ]
    });

    await controller.refreshSkillMenu();

    const values = elements.get("zms-skillId").children.map((item: any) => item.value);
    expect(values).toContain("paper-deep-summary");
    expect(values).toContain("roadmap-audit");
    expect(values).toContain("unsafe");
    expect(values).not.toContain("readme");
  });

  it("adds a newly saved custom skill back into the skill menu", async () => {
    const { controller, elements } = loadPreferencesController();
    elements.get("zms-skillId").value = " my custom/skill ";
    elements.get("zms-skillTemplate").value = "Custom skill prompt.";

    await controller.saveSkillTemplateEditor();

    expect(elements.get("zms-skillId").value).toBe("my-custom-skill");
    expect(elements.get("zms-skillId").children.map((item: any) => item.value)).toContain("my-custom-skill");
  });

  it("saves provider profiles with a normalized profile id", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "model-a" });
    elements.get("zms-activeProfileId").value = "../ My Router:OpenAI? ";
    elements.get("zms-profileName").value = "My Router OpenAI";

    controller.saveProfileFromEditor();

    const profiles = JSON.parse(elements.get("zms-profilesJson").value);
    expect(elements.get("zms-activeProfileId").value).toBe("My-Router-OpenAI");
    expect(elements.get("zms-profile-options").children.map((option: any) => option.value)).toContain("My-Router-OpenAI");
    expect(profiles[0]).toMatchObject({
      id: "My-Router-OpenAI",
      name: "My Router OpenAI",
      isDefault: true,
      protocol: "openai_responses"
    });
  });

  it("loads the active provider profile into simple and advanced editor fields", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "stale-model" });
    elements.get("zms-provider").value = "openai";
    elements.get("zms-baseURL").value = "https://api.openai.com/v1";
    elements.get("zms-apiKey").value = "stale-secret";
    elements.get("zms-activeProfileId").value = "perplexity";
    elements.get("zms-profilesJson").value = JSON.stringify([
      {
        id: "openai",
        name: "OpenAI",
        protocol: "openai_responses",
        endpointMode: "base_url",
        baseURL: "https://api.openai.com/v1",
        apiKey: "openai-secret",
        model: "openai-model",
        capabilities: { pdfBase64: true, streaming: true, modelList: true },
        customHeaders: {},
        bodyExtra: {},
        isDefault: true
      },
      {
        id: "perplexity",
        name: "Perplexity Sonar",
        protocol: "openai_chat",
        endpointMode: "base_url",
        baseURL: "https://api.perplexity.ai",
        apiKey: "perplexity-secret",
        model: "sonar-pro",
        capabilities: { pdfBase64: false, streaming: true, modelList: true },
        customHeaders: { "x-route": "sonar" },
        bodyExtra: {},
        isDefault: false
      }
    ]);

    controller.loadProfileEditor();

    expect(elements.get("zms-activeProfileId").value).toBe("perplexity");
    expect(elements.get("zms-provider").value).toBe("perplexity");
    expect(elements.get("zms-baseURL").value).toBe("https://api.perplexity.ai");
    expect(elements.get("zms-apiKey").value).toBe("perplexity-secret");
    expect(elements.get("zms-model").value).toBe("sonar-pro");
    expect(elements.get("zms-profileName").value).toBe("Perplexity Sonar");
    expect(elements.get("zms-profileProtocol").value).toBe("openai_chat");
    expect(elements.get("zms-cap-modelList").checked).toBe(true);
    expect(elements.get("zms-profileCustomHeaders").value).toContain("x-route");
  });

  it("renders provider readiness status in settings without exposing credentials", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "gpt-4.1" });
    elements.get("zms-profileCustomHeaders").value = "{\"Authorization\":\"Bearer routed-secret\"}";

    const summary = controller.refreshProfileStatus();

    expect(summary).toContain("Protocol: openai_responses");
    expect(summary).toContain("Model: gpt-4.1");
    expect(summary).toContain("Endpoint: https://api.openai.com/v1/responses");
    expect(summary).toContain("Raw PDF input supported");
    expect(summary).toContain("Authentication configured");
    expect(summary).not.toContain("sk-test-secret");
    expect(summary).not.toContain("routed-secret");
  });

  it("runs a no-network provider config preflight from the current settings form", () => {
    const { controller, elements, fetchCalls } = loadPreferencesController();
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";

    expect(controller.checkProviderConfig()).toBe(false);
    expect(fetchCalls).toHaveLength(0);
    expect(elements.get("zms-status").value).toContain("Configuration preflight failed");
    expect(elements.get("zms-profileStatus").textContent).toContain("Configuration preflight: failed");
    expect(elements.get("zms-profileStatus").textContent).toContain("Missing: API key or custom auth header, model name");
    expect(elements.get("zms-profileStatus").textContent).toContain("Next: npm run verify:provider:live -- --doctor --include openai --provider-env-file .env.local");
    expect(elements.get("zms-profileStatus").textContent).not.toContain("sk-test-secret");

    elements.get("zms-apiKey").value = "doctor-secret";
    elements.get("zms-model").value = "paper-model";
    expect(controller.checkProviderConfig()).toBe(true);
    expect(fetchCalls).toHaveLength(0);
    expect(elements.get("zms-status").value).toContain("Configuration preflight passed");
    expect(elements.get("zms-profileStatus").textContent).toContain("Configuration preflight: passed");
    expect(elements.get("zms-profileStatus").textContent).not.toContain("doctor-secret");
  });

  it("renders a provider setup guide with endpoint and live-check commands", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("openai"),
      apiKey: "sk-test-secret",
      model: "gpt-4.1"
    }, "en-US");

    expect(guide).toContain("Protocol: OpenAI Responses");
    expect(guide).toContain("Request endpoint: https://api.openai.com/v1/responses");
    expect(guide).toContain("OPENAI_API_KEY=...");
    expect(guide).toContain("OPENAI_MODEL=gpt-4.1");
    expect(guide).toContain("Copy env template: npm run verify:provider:live -- --env-template --include openai");
    expect(guide).toContain("Draft .env.local: npm run verify:provider:live -- --env-template --dotenv-template --include openai > .env.local");
    expect(guide).toContain(".env.local config doctor: npm run verify:provider:live -- --doctor --include openai --provider-env-file .env.local");
    expect(guide).toContain("Env-file live check: npm run verify:provider:live -- --include openai --provider-env-file .env.local");
    expect(guide).toContain("npm run verify:provider:live -- --include openai");
    expect(guide).toContain("npm run verify:provider:models:live -- --include openai");
    expect(guide).not.toContain("sk-test-secret");
  });

  it("uses compatible live-check variables for Anthropic-style routers", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("anthropic_compatible"),
      apiKey: "anthropic-secret",
      model: "claude-router",
      baseURL: "https://router.example/anthropic"
    }, "en-US");

    expect(guide).toContain("Protocol: Anthropic Messages");
    expect(guide).toContain("ANTHROPIC_COMPATIBLE_API_KEY=...");
    expect(guide).toContain("ANTHROPIC_COMPATIBLE_MODEL=claude-router");
    expect(guide).toContain("ANTHROPIC_COMPATIBLE_BASE_URL=https://router.example/anthropic");
    expect(guide).toContain("Copy env template: npm run verify:provider:live -- --env-template --include anthropic-compatible");
    expect(guide).toContain("Draft .env.local: npm run verify:provider:live -- --env-template --dotenv-template --include anthropic-compatible > .env.local");
    expect(guide).toContain(".env.local config doctor: npm run verify:provider:live -- --doctor --include anthropic-compatible --provider-env-file .env.local");
    expect(guide).toContain("Env-file live check: npm run verify:provider:live -- --include anthropic-compatible --provider-env-file .env.local");
    expect(guide).toContain("--include anthropic-compatible");
    expect(guide).toContain("Image capability override check: ANTHROPIC_COMPATIBLE_API_KEY=... ANTHROPIC_COMPATIBLE_MODEL=claude-router ANTHROPIC_COMPATIBLE_BASE_URL=https://router.example/anthropic ANTHROPIC_COMPATIBLE_CAPABILITIES_JSON='{\"imageBase64\":true}' npm run verify:provider:image:live -- --include anthropic-compatible");
    expect(guide).toContain("PDF capability override check: ANTHROPIC_COMPATIBLE_API_KEY=... ANTHROPIC_COMPATIBLE_MODEL=claude-router ANTHROPIC_COMPATIBLE_BASE_URL=https://router.example/anthropic ANTHROPIC_COMPATIBLE_CAPABILITIES_JSON='{\"pdfBase64\":true}' npm run verify:provider:pdf:live -- --include anthropic-compatible");
    expect(guide).not.toContain("anthropic-secret");
  });

  it("treats local OpenAI-compatible endpoints as API-key optional in setup guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("openai_compatible"),
      baseURL: "http://127.0.0.1:11434/v1",
      apiKey: "",
      model: "qwen3"
    }, "en-US");

    expect(guide).toContain("Local endpoint; API key is usually optional");
    expect(guide).toContain("OPENAI_COMPATIBLE_MODEL=qwen3");
    expect(guide).toContain("OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1");
    expect(guide).toContain("--include openai-compatible");
    expect(guide).toContain("Image capability override check: OPENAI_COMPATIBLE_MODEL=qwen3 OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1 OPENAI_COMPATIBLE_CAPABILITIES_JSON='{\"imageBase64\":true}' npm run verify:provider:image:live -- --include openai-compatible");
    expect(guide).not.toContain("PDF capability override check");
    expect(guide).not.toContain("OPENAI_COMPATIBLE_API_KEY=...");
  });

  it("uses named live-check variables for local Ollama and LM Studio guides", () => {
    const helpers = loadPreferencesHelpers();
    const ollamaGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("ollama"),
      model: "llama3.1"
    }, "en-US");
    const lmStudioGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("lm_studio"),
      model: "local-model"
    }, "en-US");

    expect(ollamaGuide).toContain("Local endpoint; API key is usually optional");
    expect(ollamaGuide).toContain("OLLAMA_MODEL=llama3.1");
    expect(ollamaGuide).toContain("OLLAMA_BASE_URL=http://localhost:11434/v1");
    expect(ollamaGuide).toContain("--include ollama");
    expect(ollamaGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(ollamaGuide).not.toContain("OLLAMA_API_KEY=...");
    expect(lmStudioGuide).toContain("Local endpoint; API key is usually optional");
    expect(lmStudioGuide).toContain("LM_STUDIO_MODEL=local-model");
    expect(lmStudioGuide).toContain("LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1");
    expect(lmStudioGuide).toContain("--include lm-studio");
    expect(lmStudioGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(lmStudioGuide).not.toContain("LM_STUDIO_API_KEY=...");
  });

  it("uses named live-check variables for GitHub Models setup guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("github_models"),
      apiKey: "github-model-secret",
      model: "openai/gpt-4.1-mini"
    }, "en-US");

    expect(guide).toContain("Active profile: GitHub Models");
    expect(guide).toContain("GITHUB_MODELS_API_KEY=...");
    expect(guide).toContain("GITHUB_MODELS_MODEL=openai/gpt-4.1-mini");
    expect(guide).toContain("--include github-models");
    expect(guide).not.toContain("GITHUB_MODELS_BASE_URL=");
    expect(guide).not.toContain("github-model-secret");
  });

  it("uses named live-check variables for Hugging Face setup guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("huggingface"),
      apiKey: "hf_test-secret",
      model: "Qwen/Qwen2.5-VL-7B-Instruct"
    }, "en-US");

    expect(guide).toContain("Active profile: Hugging Face");
    expect(guide).toContain("HUGGINGFACE_API_KEY=...");
    expect(guide).toContain("HUGGINGFACE_MODEL=Qwen/Qwen2.5-VL-7B-Instruct");
    expect(guide).toContain("--include huggingface");
    expect(guide).not.toContain("hf_test-secret");
  });

  it("uses named live-check variables for DeepInfra setup guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("deepinfra"),
      apiKey: "deepinfra_test-secret",
      model: "meta-llama/Meta-Llama-3.1-8B-Instruct"
    }, "en-US");

    expect(guide).toContain("Active profile: DeepInfra");
    expect(guide).toContain("DEEPINFRA_API_KEY=...");
    expect(guide).toContain("DEEPINFRA_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct");
    expect(guide).toContain("--include deepinfra");
    expect(guide).not.toContain("deepinfra_test-secret");
  });

  it("uses named live-check variables for Cloudflare AI setup guides", () => {
    const helpers = loadPreferencesHelpers();
    const chatGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("cloudflare_ai_chat"),
      baseURL: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1",
      apiKey: "cloudflare_test-secret",
      model: "@cf/meta/llama-3.1-8b-instruct"
    }, "en-US");
    const responsesGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("cloudflare_ai_responses"),
      baseURL: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1",
      apiKey: "cf_responses-test-secret",
      model: "@cf/meta/llama-3.1-8b-instruct"
    }, "en-US");
    const anthropicGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("cloudflare_ai_anthropic"),
      baseURL: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1",
      apiKey: "cf_anthropic-test-secret",
      model: "claude-3-5-sonnet-20241022"
    }, "en-US");

    expect(chatGuide).toContain("CLOUDFLARE_API_KEY=...");
    expect(chatGuide).toContain("CLOUDFLARE_MODEL=@cf/meta/llama-3.1-8b-instruct");
    expect(chatGuide).toContain("CLOUDFLARE_BASE_URL=https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1");
    expect(chatGuide).toContain("--include cloudflare-ai-chat");
    expect(chatGuide).not.toContain("cloudflare_test-secret");
    expect(responsesGuide).toContain("CLOUDFLARE_RESPONSES_API_KEY=...");
    expect(responsesGuide).toContain("CLOUDFLARE_RESPONSES_MODEL=@cf/meta/llama-3.1-8b-instruct");
    expect(responsesGuide).toContain("CLOUDFLARE_RESPONSES_BASE_URL=https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1");
    expect(responsesGuide).toContain("--include cloudflare-ai-responses");
    expect(responsesGuide).not.toContain("cf_responses-test-secret");
    expect(anthropicGuide).toContain("CLOUDFLARE_ANTHROPIC_API_KEY=...");
    expect(anthropicGuide).toContain("CLOUDFLARE_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022");
    expect(anthropicGuide).toContain("CLOUDFLARE_ANTHROPIC_BASE_URL=https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1");
    expect(anthropicGuide).toContain("--include cloudflare-ai-anthropic");
    expect(anthropicGuide).not.toContain("cf_anthropic-test-secret");
  });

  it("includes edited Base URL for named provider live-check commands", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("github_models"),
      baseURL: "https://router.example/github/inference",
      model: "openai/gpt-4.1-mini"
    }, "en-US");

    expect(guide).toContain("GITHUB_MODELS_BASE_URL=https://router.example/github/inference");
    expect(guide).toContain("--include github-models");
  });

  it("uses named live-check variables and bearer auth for SambaNova Anthropic guides", () => {
    const helpers = loadPreferencesHelpers();
    const guide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("sambanova_anthropic"),
      apiKey: "sambanova-anthropic-secret",
      model: "Meta-Llama-3.1-8B-Instruct"
    }, "en-US");

    expect(guide).toContain("Protocol: Anthropic Messages");
    expect(guide).toContain("Auth: API key is sent as Authorization: Bearer; anthropic-version is included.");
    expect(guide).toContain("SAMBANOVA_ANTHROPIC_API_KEY=...");
    expect(guide).toContain("SAMBANOVA_ANTHROPIC_MODEL=Meta-Llama-3.1-8B-Instruct");
    expect(guide).toContain("--include sambanova-anthropic");
    expect(guide).not.toContain("sambanova-anthropic-secret");
  });

  it("uses named live-check variables for older built-in OpenAI-compatible providers", () => {
    const helpers = loadPreferencesHelpers();
    const deepseekGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("deepseek"),
      apiKey: "deepseek-secret",
      model: "deepseek-chat"
    }, "en-US");
    const openrouterGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("openrouter"),
      apiKey: "openrouter-secret",
      model: "openai/gpt-4.1-mini"
    }, "en-US");
    const groqGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("groq"),
      apiKey: "groq-secret",
      model: "llama-3.3-70b-versatile"
    }, "en-US");

    expect(deepseekGuide).toContain("DEEPSEEK_API_KEY=...");
    expect(deepseekGuide).toContain("DEEPSEEK_MODEL=deepseek-chat");
    expect(deepseekGuide).toContain("--include deepseek");
    expect(deepseekGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(deepseekGuide).not.toContain("deepseek-secret");
    expect(openrouterGuide).toContain("OPENROUTER_API_KEY=...");
    expect(openrouterGuide).toContain("OPENROUTER_MODEL=openai/gpt-4.1-mini");
    expect(openrouterGuide).toContain("--include openrouter");
    expect(openrouterGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(openrouterGuide).not.toContain("openrouter-secret");
    expect(groqGuide).toContain("GROQ_API_KEY=...");
    expect(groqGuide).toContain("GROQ_MODEL=llama-3.3-70b-versatile");
    expect(groqGuide).toContain("--include groq");
    expect(groqGuide).not.toContain("OPENAI_COMPATIBLE_API_KEY");
    expect(groqGuide).not.toContain("groq-secret");
  });

  it("uses named live-check variables for MiniMax, Gemini, Azure, and Vercel guides", () => {
    const helpers = loadPreferencesHelpers();
    const minimaxGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("minimax"),
      apiKey: "minimax-secret",
      model: "MiniMax-M2.7-highspeed"
    }, "en-US");
    const geminiGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("gemini"),
      apiKey: "gemini-secret",
      model: "gemini-2.5-flash"
    }, "en-US");
    const azureGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("azure_openai"),
      baseURL: "https://example-resource.openai.azure.com/openai/v1",
      apiKey: "azure-secret",
      model: "gpt-4.1"
    }, "en-US");
    const vercelChatGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("vercel_ai_chat"),
      apiKey: "vercel-secret",
      model: "openai/gpt-4.1-mini"
    }, "en-US");
    const vercelResponsesGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("vercel_ai_responses"),
      apiKey: "vercel-responses-secret",
      model: "openai/gpt-4.1-mini"
    }, "en-US");
    const vercelAnthropicGuide = helpers.providerSetupGuide({
      ...helpers.providerDefaults("vercel_ai_anthropic"),
      apiKey: "vercel-anthropic-secret",
      model: "anthropic/claude-sonnet-4.5"
    }, "en-US");

    expect(minimaxGuide).toContain("MINIMAX_API_KEY=...");
    expect(minimaxGuide).toContain("MINIMAX_MODEL=MiniMax-M2.7-highspeed");
    expect(minimaxGuide).toContain("--include minimax");
    expect(minimaxGuide).not.toContain("minimax-secret");
    expect(geminiGuide).toContain("GEMINI_API_KEY=...");
    expect(geminiGuide).toContain("GEMINI_MODEL=gemini-2.5-flash");
    expect(geminiGuide).toContain("--include gemini");
    expect(geminiGuide).toContain("Image live check: GEMINI_API_KEY=... GEMINI_MODEL=gemini-2.5-flash npm run verify:provider:image:live -- --include gemini");
    expect(geminiGuide).toContain("PDF live check: uses Zotero extracted text");
    expect(geminiGuide).not.toContain("gemini-secret");
    expect(azureGuide).toContain("AZURE_OPENAI_API_KEY=...");
    expect(azureGuide).toContain("AZURE_OPENAI_MODEL=gpt-4.1");
    expect(azureGuide).toContain("AZURE_OPENAI_BASE_URL=https://example-resource.openai.azure.com/openai/v1");
    expect(azureGuide).toContain("--include azure-openai");
    expect(azureGuide).toContain("Image live check: AZURE_OPENAI_API_KEY=... AZURE_OPENAI_MODEL=gpt-4.1 AZURE_OPENAI_BASE_URL=https://example-resource.openai.azure.com/openai/v1 npm run verify:provider:image:live -- --include azure-openai");
    expect(azureGuide).toContain("PDF live check: AZURE_OPENAI_API_KEY=... AZURE_OPENAI_MODEL=gpt-4.1 AZURE_OPENAI_BASE_URL=https://example-resource.openai.azure.com/openai/v1 npm run verify:provider:pdf:live -- --include azure-openai");
    expect(azureGuide).not.toContain("azure-secret");
    expect(vercelChatGuide).toContain("VERCEL_AI_API_KEY=...");
    expect(vercelChatGuide).toContain("VERCEL_AI_MODEL=openai/gpt-4.1-mini");
    expect(vercelChatGuide).toContain("--include vercel-ai-chat");
    expect(vercelChatGuide).toContain("Image live check: VERCEL_AI_API_KEY=... VERCEL_AI_MODEL=openai/gpt-4.1-mini npm run verify:provider:image:live -- --include vercel-ai-chat");
    expect(vercelChatGuide).toContain("PDF live check: uses Zotero extracted text");
    expect(vercelChatGuide).not.toContain("vercel-secret");
    expect(vercelResponsesGuide).toContain("VERCEL_AI_RESPONSES_API_KEY=...");
    expect(vercelResponsesGuide).toContain("VERCEL_AI_RESPONSES_MODEL=openai/gpt-4.1-mini");
    expect(vercelResponsesGuide).toContain("--include vercel-ai-responses");
    expect(vercelResponsesGuide).toContain("PDF live check: VERCEL_AI_RESPONSES_API_KEY=... VERCEL_AI_RESPONSES_MODEL=openai/gpt-4.1-mini npm run verify:provider:pdf:live -- --include vercel-ai-responses");
    expect(vercelResponsesGuide).not.toContain("vercel-responses-secret");
    expect(vercelAnthropicGuide).toContain("VERCEL_AI_ANTHROPIC_API_KEY=...");
    expect(vercelAnthropicGuide).toContain("VERCEL_AI_ANTHROPIC_MODEL=anthropic/claude-sonnet-4.5");
    expect(vercelAnthropicGuide).toContain("--include vercel-ai-anthropic");
    expect(vercelAnthropicGuide).toContain("Auth: API key is sent as Authorization: Bearer; anthropic-version is included.");
    expect(vercelAnthropicGuide).not.toContain("vercel-anthropic-secret");
  });

  it("imports pasted provider env text into a settings profile", () => {
    const helpers = loadPreferencesHelpers();
    const result = helpers.applyProviderEnvTextToProfile({
      ...helpers.providerDefaults("openai_compatible"),
      apiKey: "old-secret",
      model: "old-model",
      customHeaders: { "x-existing": "yes" },
      capabilities: { imageBase64: false, pdfBase64: false, streaming: true }
    }, [
      "export OPENAI_COMPATIBLE_API_KEY=\"sk-new-secret\"",
      "OPENAI_COMPATIBLE_MODEL=router-model",
      "OPENAI_COMPATIBLE_BASE_URL=https://router.example/v1 # comment",
      "OPENAI_COMPATIBLE_CAPABILITIES_JSON='{\"imageBase64\":true}'",
      "OPENAI_COMPATIBLE_HEADERS_JSON='{\"x-route\":\"paper\"}'",
      "OPENAI_COMPATIBLE_BODY_EXTRA_JSON='{\"response_format\":{\"type\":\"json_object\"}}'"
    ].join("\n"), "openai_compatible");

    expect(result.changed).toEqual(["apiKey", "model", "baseURL", "capabilities", "customHeaders", "bodyExtra"]);
    expect(result.profile).toMatchObject({
      apiKey: "sk-new-secret",
      model: "router-model",
      baseURL: "https://router.example/v1",
      capabilities: { imageBase64: true },
      customHeaders: { "x-existing": "yes", "x-route": "paper" },
      bodyExtra: { response_format: { type: "json_object" } }
    });
  });

  it("accepts Vercel AI Gateway env aliases in settings imports", () => {
    const helpers = loadPreferencesHelpers();
    const result = helpers.applyProviderEnvTextToProfile({
      ...helpers.providerDefaults("vercel_ai_anthropic"),
      apiKey: "",
      model: ""
    }, [
      "AI_GATEWAY_API_KEY=vercel-gateway-secret",
      "AI_GATEWAY_MODEL=anthropic/claude-sonnet-4.5"
    ].join("\n"), "vercel_ai_anthropic");

    expect(result.changed).toEqual(["apiKey", "model"]);
    expect(result.profile).toMatchObject({
      apiKey: "vercel-gateway-secret",
      model: "anthropic/claude-sonnet-4.5",
      protocol: "anthropic_messages"
    });
  });

  it("updates the settings provider guide from edited fields", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "gpt-4.1" });
    elements.get("zms-profileCustomHeaders").value = "{\"Authorization\":\"Bearer routed-secret\"}";

    const guide = controller.refreshProviderGuide();

    expect(guide).toContain("Active profile: OpenAI");
    expect(guide).toContain("Request endpoint: https://api.openai.com/v1/responses");
    expect(guide).toContain("OPENAI_API_KEY=...");
    expect(elements.get("zms-providerGuide").textContent).toBe(guide);
    expect(guide).not.toContain("sk-test-secret");
    expect(guide).not.toContain("routed-secret");
  });

  it("saves edited API key and model into the active provider profile", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "old-model" });
    elements.get("zms-profilesJson").value = JSON.stringify([
      {
        id: "openai",
        name: "OpenAI",
        protocol: "openai_responses",
        endpointMode: "base_url",
        baseURL: "https://api.openai.com/v1",
        apiKey: "old-secret",
        model: "old-model",
        capabilities: { pdfBase64: true, imageBase64: true, streaming: true, modelList: true },
        customHeaders: {},
        bodyExtra: {},
        isDefault: true
      }
    ]);
    elements.get("zms-apiKey").value = "new-secret";
    elements.get("zms-model").value = "new-model";
    elements.get("zms-baseURL").value = "https://new.example/v1";

    expect(controller.save()).toBe(true);

    const profiles = JSON.parse(elements.get("zms-profilesJson").value);
    expect(profiles[0]).toMatchObject({
      id: "openai",
      apiKey: "new-secret",
      model: "new-model",
      baseURL: "https://new.example/v1",
      isDefault: true
    });
  });

  it("applies pasted env config and persists it through the settings controller", () => {
    const { controller, elements, prefValues } = loadPreferencesController({ initialModel: "old-model" });
    elements.get("zms-profilesJson").value = JSON.stringify([
      {
        id: "openai",
        name: "OpenAI",
        protocol: "openai_responses",
        endpointMode: "base_url",
        baseURL: "https://api.openai.com/v1",
        apiKey: "old-secret",
        model: "old-model",
        capabilities: { pdfBase64: true, imageBase64: true, streaming: true, modelList: true },
        customHeaders: {},
        bodyExtra: {},
        isDefault: true
      }
    ]);
    elements.get("zms-providerEnvText").value = [
      "OPENAI_API_KEY=sk-env-secret",
      "OPENAI_MODEL=gpt-4.1-mini",
      "OPENAI_BODY_EXTRA_JSON='{\"metadata\":{\"source\":\"settings\"}}'"
    ].join("\n");

    const result = controller.applyProviderEnvFromText();

    expect(result.changed).toEqual(["apiKey", "model", "bodyExtra"]);
    const profiles = JSON.parse(elements.get("zms-profilesJson").value);
    expect(profiles[0]).toMatchObject({
      id: "openai",
      apiKey: "sk-env-secret",
      model: "gpt-4.1-mini",
      bodyExtra: { metadata: { source: "settings" } },
      isDefault: true
    });
    expect(prefValues.get("extensions.zoteroMarkdownSummary.apiKey")).toBe("sk-env-secret");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.model")).toBe("gpt-4.1-mini");
    expect(elements.get("zms-status").value).toContain("Config imported");
  });

  it("persists edited output directory and creates it from the top settings field", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController();
    elements.get("zms-outputDir").value = "/tmp/new out";

    await expect(controller.saveOutputDir()).resolves.toBe(true);

    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("/tmp/new out");
    expect(madeDirectories).toContain("/tmp/new out");
    expect(elements.get("zms-status").value).toContain("Output directory saved");
  });

  it("does not persist a changed output directory when creation fails", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      makeDirectoryThrows: true
    });
    elements.get("zms-outputDir").value = "/tmp/bad out";

    await expect(controller.saveOutputDir()).resolves.toBe(false);

    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBeUndefined();
    expect(madeDirectories).not.toContain("/tmp/bad out");
    expect(elements.get("zms-status").value).toContain("Output directory failed");
  });

  it("localizes output directory button labels and tooltips", () => {
    const { controller, elements } = loadPreferencesController();

    controller.applyLanguage();

    expect(elements.get("zms-choose-outputDir-button").label).toBe("Choose Folder...");
    expect(elements.get("zms-choose-outputDir-button").tooltiptext).toBe("Choose an output folder with the system file manager");
    expect(elements.get("zms-save-outputDir-button").label).toBe("Save");
    expect(elements.get("zms-save-outputDir-button").tooltiptext).toBe("Save the current output directory");
  });

  it("falls back to fully localized Chinese labels when the message bundle is unavailable", () => {
    const { controller, elements } = loadPreferencesController({ noZmsMessage: true });
    elements.get("zms-uiLanguage").value = "zh-CN";

    controller.applyLanguage();

    expect(elements.get("zms-provider-label").value).toBe("模型厂商");
    expect(elements.get("zms-baseURL-label").value).toBe("接口地址");
    expect(elements.get("zms-model-label").value).toBe("模型");
    expect(elements.get("zms-profileEndpointMode-label").value).toBe("接口模式");
    expect(elements.get("zms-outputDir-label").value).toBe("输出目录");
    expect(elements.get("zms-choose-outputDir-button").label).toBe("选择文件夹...");
  });

  it("preloads recommended provider models without requiring an API key", async () => {
    const { controller, elements } = loadPreferencesController();
    elements.get("zms-provider").value = "deepseek";
    elements.get("zms-activeProfileId").value = "deepseek";
    elements.get("zms-profileName").value = "DeepSeek";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "https://api.deepseek.com";
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";

    await controller.loadModels();

    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toContain("deepseek-chat");
    expect(elements.get("zms-model-select").children.map((option: any) => option.value)).toContain("deepseek-chat");
    expect(elements.get("zms-status").value).toBe("Recommended models loaded: 2");
  });

  it("updates the model field from the recommended model dropdown", () => {
    const { controller, elements } = loadPreferencesController();
    elements.get("zms-provider").value = "deepseek";
    elements.get("zms-profileName").value = "DeepSeek";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "https://api.deepseek.com";
    elements.get("zms-model").value = "";

    controller.refreshModelRecommendations();
    elements.get("zms-model-select").value = "deepseek-reasoner";
    controller.selectModelFromDropdown();

    expect(elements.get("zms-model").value).toBe("deepseek-reasoner");
  });

  it("chooses an output directory with the native folder picker and saves it", async () => {
    const { controller, elements, prefValues, madeDirectories, filePickerCalls } = loadPreferencesController({
      filePickerPath: "/tmp/picked output"
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      displayDirectory: "/tmp/out"
    });
    expect(elements.get("zms-outputDir").value).toBe("/tmp/picked output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("/tmp/picked output");
    expect(madeDirectories).toContain("/tmp/picked output");
  });

  it("chooses an output directory through Zotero's FilePicker wrapper when available", async () => {
    const { controller, elements, prefValues, madeDirectories, filePickerCalls } = loadPreferencesController({
      filePickerUseZoteroWrapper: true,
      filePickerPath: "/tmp/wrapper output"
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      parent: "zoteroWindow",
      displayDirectory: "/tmp/out"
    });
    expect(elements.get("zms-outputDir").value).toBe("/tmp/wrapper output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("/tmp/wrapper output");
    expect(madeDirectories).toContain("/tmp/wrapper output");
  });

  it("uses a Windows file URL when the native folder picker does not expose file.path", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { spec: "file:///C:/Users/tart/Documents/Literature%20Review%20with%20LLM" }
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe("C:\\Users\\tart\\Documents\\Literature Review with LLM");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("C:\\Users\\tart\\Documents\\Literature Review with LLM");
    expect(madeDirectories).toContain("C:\\Users\\tart\\Documents\\Literature Review with LLM");
  });

  it("normalizes Windows slash-drive paths from the native folder picker", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { path: "/C:/Users/tart/Documents/Literature Review with LLM" }
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe("C:\\Users\\tart\\Documents\\Literature Review with LLM");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("C:\\Users\\tart\\Documents\\Literature Review with LLM");
    expect(madeDirectories).toContain("C:\\Users\\tart\\Documents\\Literature Review with LLM");
  });

  it("uses a promised picker result from the native folder picker", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { spec: "file:///C:/Users/tart/Documents/Review%20Output" },
      filePickerOpenReturnsPromise: true
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(madeDirectories).toContain("C:\\Users\\tart\\Documents\\Review Output");
  });

  it("initializes the native folder picker with a browsing context in current Zotero runtimes", async () => {
    const { controller, elements, filePickerCalls } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { spec: "file:///Users/tart/Zotero/Literature%20Review%20with%20LLM" },
      filePickerWindowBrowsingContext: true,
      filePickerInitThrowsWithWindow: true
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      parent: "browsingContext",
      displayDirectory: "/tmp/out"
    });
    expect(elements.get("zms-outputDir").value).toBe("/Users/tart/Zotero/Literature Review with LLM");
  });

  it("uses selected file wrapper fields from the native folder picker", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerExtraProps: {
        selectedFile: { path: "" },
        domFileOrDirectory: {
          fileURL: { spec: "file:///C:/Users/tart/Documents/Review%20Output" }
        }
      }
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(madeDirectories).toContain("C:\\Users\\tart\\Documents\\Review Output");
  });

  it("normalizes Windows paths returned through nsIFileURL QueryInterface", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: {
        QueryInterface: () => ({
          file: { path: "" },
          filePath: "/C:/Users/tart/Documents/Review%20Output"
        })
      }
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(madeDirectories).toContain("C:\\Users\\tart\\Documents\\Review Output");
  });

  it("normalizes nonstandard Windows drive file URLs from the native folder picker", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { spec: "file://C:/Users/tart/Documents/Review%20Output" }
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("C:\\Users\\tart\\Documents\\Review Output");
    expect(madeDirectories).toContain("C:\\Users\\tart\\Documents\\Review Output");
  });

  it("normalizes Windows UNC file URLs from the native folder picker", async () => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { spec: "file://server/share/Review%20Output" }
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe("\\\\server\\share\\Review Output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("\\\\server\\share\\Review Output");
    expect(madeDirectories).toContain("\\\\server\\share\\Review Output");
  });

  it.each([
    [
      "encoded drive-colon file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file:///C%3A/Users/tart/Documents/Review%20Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "raw backslash Windows file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file:C:\\Users\\tart\\Documents\\Review%20Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "localhost UNC file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file://localhost//server/share/Review%20Output" }
      },
      "\\\\server\\share\\Review Output"
    ],
    [
      "localhost pipe-drive file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file://localhost/C|/Users/tart/Documents/Review%20Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "over-slashed UNC file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file://///server/share/Review%20Output" }
      },
      "\\\\server\\share\\Review Output"
    ],
    [
      "Windows long-path nsIFile path",
      {
        filePickerFile: { path: "\\\\?\\C:\\Users\\tart\\Documents\\Review Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "encoded Windows long-path file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file:///%5C%5C%3F%5CC%3A%5CUsers%5Ctart%5CDocuments%5CReview%20Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "encoded Windows long-path UNC file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file:///%5C%5C%3F%5CUNC%5Cserver%5Cshare%5CReview%20Output" }
      },
      "\\\\server\\share\\Review Output"
    ],
    [
      "slash-question drive file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file://?/C:/Users/tart/Documents/Review%20Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "slash-question UNC file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file:////?/UNC/server/share/Review%20Output" }
      },
      "\\\\server\\share\\Review Output"
    ],
    [
      "encoded backslash UNC file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file:///%5C%5Cserver%5Cshare%5CReview%20Output" }
      },
      "\\\\server\\share\\Review Output"
    ],
    [
      "picker.files enumerator fallback",
      {
        filePickerFile: { path: "" },
        filePickerFiles: {
          used: false,
          hasMoreElements() {
            return !this.used;
          },
          getNext() {
            this.used = true;
            return { path: "C:\\Users\\tart\\Documents\\Review Output" };
          }
        }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "quoted file path",
      {
        filePickerFile: { path: "\"C:\\Users\\tart\\Documents\\Review Output\"" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "quoted file URL from file.path",
      {
        filePickerFile: { path: "\"file:///C:/Users/tart/Documents/Review%20Output\"" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "drive-pipe host file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file://C|/Users/tart/Documents/Review%20Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "over-slashed drive file URL",
      {
        filePickerFile: { path: "" },
        filePickerFileURL: { spec: "file:////C:/Users/tart/Documents/Review%20Output" }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ],
    [
      "targetFile fallback when nsIFile.path getter throws",
      {
        filePickerFile: {
          get path() {
            throw new Error("path getter unavailable");
          },
          targetFile: { path: "C:\\Users\\tart\\Documents\\Review Output" }
        }
      },
      "C:\\Users\\tart\\Documents\\Review Output"
    ]
  ])("normalizes Windows %s from the native folder picker", async (_name, pickerOptions, expected) => {
    const { controller, elements, prefValues, madeDirectories } = loadPreferencesController(pickerOptions);

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(elements.get("zms-outputDir").value).toBe(expected);
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe(expected);
    expect(madeDirectories).toContain(expected);
  });

  it("uses a macOS file URL and retries folder picker initialization without a window parent", async () => {
    const { controller, elements, filePickerCalls } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { spec: "file:///Users/tart/Zotero/Literature%20Review%20with%20LLM" },
      filePickerUseShow: true,
      filePickerInitThrowsWithWindow: true
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      parent: null,
      displayDirectory: "/tmp/out"
    });
    expect(elements.get("zms-outputDir").value).toBe("/Users/tart/Zotero/Literature Review with LLM");
  });

  it("retries the folder picker without a window parent when opening fails", async () => {
    const { controller, elements, filePickerCalls } = loadPreferencesController({
      filePickerFile: { path: "" },
      filePickerFileURL: { spec: "file:///Users/tart/Zotero/Literature%20Review%20with%20LLM" },
      filePickerOpenThrowsWithWindow: true
    });

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(filePickerCalls).toHaveLength(2);
    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      parent: "window",
      displayDirectory: "/tmp/out"
    });
    expect(filePickerCalls[1]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      parent: null,
      displayDirectory: "/tmp/out"
    });
    expect(elements.get("zms-outputDir").value).toBe("/Users/tart/Zotero/Literature Review with LLM");
  });

  it("opens the native folder picker at the nearest existing output directory", async () => {
    const { controller, elements, filePickerCalls } = loadPreferencesController({
      filePickerPath: "/tmp/picked output",
      filePickerExistingPaths: ["/tmp"]
    });
    elements.get("zms-outputDir").value = "/tmp/missing/deep/output";

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      displayDirectory: "/tmp"
    });
  });

  it("still opens and saves when the native folder picker rejects the display directory", async () => {
    const { controller, elements, prefValues, madeDirectories, filePickerCalls } = loadPreferencesController({
      filePickerPath: "/tmp/picked output",
      filePickerDisplayDirectoryThrows: true
    });
    elements.get("zms-outputDir").value = "/tmp/current output";

    await expect(controller.chooseOutputDir()).resolves.toBe(true);

    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2
    });
    expect(elements.get("zms-outputDir").value).toBe("/tmp/picked output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("/tmp/picked output");
    expect(madeDirectories).toContain("/tmp/picked output");
  });

  it("keeps the current output directory when folder picking is cancelled", async () => {
    const { controller, elements, prefValues, madeDirectories, filePickerCalls } = loadPreferencesController({
      filePickerPath: "/tmp/ignored output",
      filePickerReturn: 1
    });
    elements.get("zms-outputDir").value = "/tmp/current output";

    await expect(controller.chooseOutputDir()).resolves.toBe(false);

    expect(filePickerCalls[0]).toMatchObject({
      title: "Choose output folder",
      mode: 2,
      displayDirectory: "/tmp/current output"
    });
    expect(elements.get("zms-outputDir").value).toBe("/tmp/current output");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBeUndefined();
    expect(madeDirectories).not.toContain("/tmp/ignored output");
  });

  it("migrates the packaged local output directory to the Zotero data directory", () => {
    const { controller, elements, prefValues } = loadPreferencesController();
    prefValues.set(
      "extensions.zoteroMarkdownSummary.outputDir",
      "/Users/example/Library/CloudStorage/OneDrive-Personal/Zotero_PDFs/Zotero_MD_Summaries"
    );

    controller.init();

    expect(elements.get("zms-outputDir").value).toBe("/tmp/zotero-data/Literature Review with LLM");
    expect(prefValues.get("extensions.zoteroMarkdownSummary.outputDir")).toBe("/tmp/zotero-data/Literature Review with LLM");
  });

  it("marks local-agent settings profiles as model-optional", () => {
    const { controller, elements } = loadPreferencesController();
    elements.get("zms-activeProfileId").value = "local-agents";
    elements.get("zms-profileName").value = "Local Agents";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "http://127.0.0.1:3333/v1";
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";
    elements.get("zms-profileLocalAgentEnabled").checked = true;
    elements.get("zms-profileLocalAgentEndpoint").value = "127.0.0.1:3333/mcp";
    elements.get("zms-cap-pdfBase64").checked = false;
    elements.get("zms-cap-streaming").checked = false;

    const summary = controller.refreshProfileStatus();

    expect(summary).toContain("Model: Optional");
    expect(summary).toContain("Authentication configured");
    expect(summary).toContain("Local agent configured");
    expect(summary).toContain("Text input only");
  });

  it("restores damaged provider profiles to the default profile set", () => {
    const { controller, elements } = loadPreferencesController({ initialModel: "damaged-model" });
    elements.get("zms-activeProfileId").value = "../broken";
    elements.get("zms-provider").value = "custom";
    elements.get("zms-baseURL").value = "https://broken.example/v1";
    elements.get("zms-apiKey").value = "should-be-cleared";
    elements.get("zms-profilesJson").value = "[{\"id\":\"broken\",\"apiKey\":\"should-be-cleared\",\"isDefault\":true}]";

    controller.resetProfilesToDefaults();

    const profiles = JSON.parse(elements.get("zms-profilesJson").value);
    expect(elements.get("zms-activeProfileId").value).toBe("minimax");
    expect(elements.get("zms-profile-options").children.map((option: any) => option.value)).toEqual([
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
    expect(elements.get("zms-provider").value).toBe("minimax");
    expect(elements.get("zms-baseURL").value).toBe("https://api.minimaxi.com/v1");
    expect(elements.get("zms-apiKey").value).toBe("");
    expect(elements.get("zms-status").value).toBe("Default provider profiles restored");
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
    expect(profiles.every((profile: any) => profile.apiKey === "")).toBe(true);
    expect(profiles[0]).toMatchObject({
      id: "minimax",
      isDefault: true,
      protocol: "openai_chat"
    });
  });

  it("loads model options into the settings datalist and fills an empty model field", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponse: {
        data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }]
      }
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/models");
    expect(fetchCalls[0].init).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer sk-test-secret", "x-route": "paper" }
    });
    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(elements.get("zms-model-select").children.map((option: any) => option.value)).toEqual(["", "model-a", "model-b", "__custom"]);
    expect(elements.get("zms-model-select").value).toBe("model-a");
    expect(elements.get("zms-model").value).toBe("model-a");
    expect(elements.get("zms-status").value).toBe("Models loaded: 2");
  });

  it("keeps an existing model when refreshing model options", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "manual-model",
      fetchResponse: { models: ["model-a", "model-b"] }
    });

    await controller.loadModels();

    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(elements.get("zms-model").value).toBe("manual-model");
    expect(elements.get("zms-model-select").value).toBe("__custom");
  });

  it("renders model display names from Anthropic-compatible model lists", async () => {
    const { controller, elements } = loadPreferencesController({
      fetchResponse: {
        data: [
          { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
          { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" }
        ],
        has_more: false
      }
    });
    elements.get("zms-profileProtocol").value = "anthropic_messages";
    elements.get("zms-baseURL").value = "https://api.anthropic.com";
    elements.get("zms-profileCustomHeaders").value = "{}";

    await controller.loadModels();

    const options = elements.get("zms-model-options").children;
    expect(options.map((option: any) => option.value)).toEqual(["claude-opus-4-8", "claude-sonnet-4-5"]);
    expect(options.map((option: any) => option.label)).toEqual(["Claude Opus 4.8", "Claude Sonnet 4.5"]);
    expect(elements.get("zms-model-select").children.map((option: any) => option.value)).toEqual(["", "claude-opus-4-8", "claude-sonnet-4-5", "__custom"]);
    expect(elements.get("zms-model-select").value).toBe("claude-opus-4-8");
    expect(elements.get("zms-model").value).toBe("claude-opus-4-8");
  });

  it("retries settings model lists without a rejected Anthropic version header", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          __fetchOk: false,
          __fetchStatus: 400,
          __fetchBody: { error: { message: "Unsupported header: anthropic-version" } }
        },
        { data: [{ id: "claude-compatible", display_name: "Claude Compatible" }] }
      ]
    });
    elements.get("zms-profileProtocol").value = "anthropic_messages";
    elements.get("zms-baseURL").value = "https://router.example";
    elements.get("zms-profileCustomHeaders").value = "{}";

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(fetchCalls[1].init.headers["anthropic-version"]).toBeUndefined();
    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toEqual(["claude-compatible"]);
    expect(elements.get("zms-status").value).toBe("Models loaded: 1");
  });

  it("follows bounded model-list pagination cursors in settings", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          data: [{ id: "model-b" }],
          has_more: true,
          last_id: "model-b"
        },
        {
          data: [{ id: "model-c" }, { id: "model-a" }],
          has_more: false
        }
      ]
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/models");
    expect(fetchCalls[1].url).toBe("https://api.openai.com/v1/models?after_id=model-b");
    expect(elements.get("zms-model-options").children.map((option: any) => option.value)).toEqual(["model-a", "model-b", "model-c"]);
    expect(elements.get("zms-status").value).toBe("Models loaded: 3");
  });

  it("loads wrapped model-list pages in settings", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          result: {
            data: [{ id: "model-b" }],
            has_more: true,
            last_id: "model-b"
          }
        },
        {
          payload: {
            models: [{ id: "model-a", display_name: "Model A" }]
          }
        }
      ]
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].url).toBe("https://api.openai.com/v1/models?after_id=model-b");
    const options = elements.get("zms-model-options").children;
    expect(options.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(options.find((option: any) => option.value === "model-a")?.label).toBe("Model A");
    expect(elements.get("zms-status").value).toBe("Models loaded: 2");
  });

  it("loads body-wrapped model-list pages in settings", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
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
      ]
    });

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].url).toBe("https://api.openai.com/v1/models?after_id=model-b");
    const options = elements.get("zms-model-options").children;
    expect(options.map((option: any) => option.value)).toEqual(["model-a", "model-b"]);
    expect(options.find((option: any) => option.value === "model-a")?.label).toBe("Model A");
  });

  it("loads model options with a custom authorization header and empty API key", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponse: { data: [{ id: "model-a" }] }
    });
    elements.get("zms-apiKey").value = "";
    elements.get("zms-profileCustomHeaders").value = "{\"Authorization\":\"Bearer routed-secret\"}";

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].init.headers).toMatchObject({ Authorization: "Bearer routed-secret" });
    expect(fetchCalls[0].init.headers).not.toHaveProperty("authorization");
    expect(elements.get("zms-status").value).toBe("Models loaded: 1");
  });

  it("shows parsed provider errors when a settings connection test fails", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "model-a",
      fetchOk: false,
      fetchStatus: 401,
      fetchResponse: {
        error: {
          code: "invalid_api_key",
          type: "invalid_request_error",
          message: "Invalid API key sk-test-secret"
        }
      }
    });

    await controller.testConnection();

    expect(elements.get("zms-status").value).toContain("Connection failed: HTTP 401");
    expect(elements.get("zms-status").value).toContain("invalid_api_key");
    expect(elements.get("zms-status").value).toContain("invalid_request_error");
    expect(elements.get("zms-status").value).toContain("Invalid API key [redacted]");
    expect(elements.get("zms-status").value).not.toContain("sk-test-secret");
  });

  it("marks settings connection tests OK only after extracting model text", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponse: {
        output: [
          {
            content: [
              { type: "reasoning", text: "hidden" },
              { type: "output_text", text: "pong" }
            ]
          }
        ]
      }
    });

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("retries settings OpenAI Chat tests with the alternate token limit field first", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      initialModel: "o3-mini",
      fetchResponses: [
        {
          __fetchOk: false,
          __fetchStatus: 400,
          __fetchBody: {
            error: { message: "Unsupported parameter: maxCompletionTokens" }
          }
        },
        {
          choices: [{ message: { content: "pong" } }]
        }
      ]
    });
    elements.get("zms-provider").value = "openai_compatible";
    elements.get("zms-activeProfileId").value = "openai-compatible";
    elements.get("zms-profileName").value = "OpenAI Compatible";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "https://router.example/v1";
    elements.get("zms-model").value = "o3-mini";

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(JSON.parse(fetchCalls[0].init.body)).toMatchObject({ max_completion_tokens: 32 });
    expect(JSON.parse(fetchCalls[1].init.body)).toMatchObject({ max_tokens: 32 });
    expect(JSON.parse(fetchCalls[1].init.body)).not.toHaveProperty("max_completion_tokens");
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("retries settings connection tests after stripping unsupported Responses fields", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponses: [
        {
          __fetchOk: false,
          __fetchStatus: 400,
          __fetchBody: {
            error: {
              message: "Unsupported parameters: instructions, text.verbosity, max_output_tokens, stream, presence_penalty, frequency_penalty, seed, top_logprobs, logprobs, parallel_tool_calls, reasoning_effort, reasoning, verbosity, stop"
            }
          }
        },
        { output_text: "pong" }
      ]
    });
    elements.get("zms-cap-jsonMode").checked = true;
    elements.get("zms-profileBodyExtra").value = JSON.stringify({
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
      seed: 42,
      top_logprobs: 3,
      logprobs: true,
      parallel_tool_calls: false,
      reasoning_effort: "low",
      reasoning: { effort: "low" },
      verbosity: "low",
      text: { verbosity: "low" },
      stop: ["END"]
    });

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(JSON.parse(fetchCalls[0].init.body)).toMatchObject({
      text: { verbosity: "low" },
      max_output_tokens: 32,
      stream: false,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
      seed: 42,
      top_logprobs: 3,
      logprobs: true,
      parallel_tool_calls: false,
      reasoning_effort: "low",
      reasoning: { effort: "low" },
      verbosity: "low",
      stop: ["END"]
    });
    expect(JSON.parse(fetchCalls[0].init.body)).toHaveProperty("instructions");
    const retriedBody = JSON.parse(fetchCalls[1].init.body);
    expect(retriedBody).not.toHaveProperty("instructions");
    expect(retriedBody).not.toHaveProperty("text");
    expect(retriedBody).not.toHaveProperty("max_output_tokens");
    expect(retriedBody).not.toHaveProperty("stream");
    expect(retriedBody).not.toHaveProperty("presence_penalty");
    expect(retriedBody).not.toHaveProperty("frequency_penalty");
    expect(retriedBody).not.toHaveProperty("seed");
    expect(retriedBody).not.toHaveProperty("top_logprobs");
    expect(retriedBody).not.toHaveProperty("logprobs");
    expect(retriedBody).not.toHaveProperty("parallel_tool_calls");
    expect(retriedBody).not.toHaveProperty("reasoning_effort");
    expect(retriedBody).not.toHaveProperty("reasoning");
    expect(retriedBody).not.toHaveProperty("verbosity");
    expect(retriedBody).not.toHaveProperty("stop");
    expect(retriedBody.input[0].content).toEqual([
      { type: "input_text", text: expect.stringContaining("SYSTEM:\nYou are a provider connection test endpoint") },
      { type: "input_text", text: "ping" }
    ]);
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("retries settings connection tests when a 200 response wraps an unsupported-parameter error", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponses: [
        {
          __fetchOk: true,
          __fetchStatus: 200,
          __fetchBody: {
            error: {
              code: "unsupported_parameter",
              message: "Unsupported request parameter",
              param: "max_output_tokens"
            }
          }
        },
        { output_text: "pong" }
      ]
    });

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(JSON.parse(fetchCalls[0].init.body)).toHaveProperty("max_output_tokens");
    expect(JSON.parse(fetchCalls[1].init.body)).not.toHaveProperty("max_output_tokens");
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("retries settings connection tests after stripping unsupported Anthropic fields", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      initialModel: "claude-compatible",
      fetchResponses: [
        {
          __fetchOk: false,
          __fetchStatus: 422,
          __fetchBody: {
            error: {
              message: "Unsupported parameters: stream, system prompt, metadata, top_p"
            }
          }
        },
        { content: [{ type: "text", text: "pong" }] }
      ]
    });
    elements.get("zms-provider").value = "anthropic_compatible";
    elements.get("zms-activeProfileId").value = "anthropic-compatible";
    elements.get("zms-profileName").value = "Anthropic Compatible";
    elements.get("zms-profileProtocol").value = "anthropic_messages";
    elements.get("zms-baseURL").value = "https://router.example";
    elements.get("zms-profileBodyExtra").value = JSON.stringify({
      metadata: { source: "settings" },
      top_p: 0.4
    });

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toBe("https://router.example/v1/messages");
    expect(JSON.parse(fetchCalls[0].init.body)).toMatchObject({
      system: expect.stringContaining("connection test endpoint"),
      stream: false,
      metadata: { source: "settings" },
      top_p: 0.4
    });
    const retriedBody = JSON.parse(fetchCalls[1].init.body);
    expect(retriedBody).not.toHaveProperty("system");
    expect(retriedBody).not.toHaveProperty("stream");
    expect(retriedBody).not.toHaveProperty("metadata");
    expect(retriedBody).not.toHaveProperty("top_p");
    expect(retriedBody).toMatchObject({ max_tokens: 32 });
    expect(retriedBody.messages[0].content).toContain("SYSTEM:\nYou are a provider connection test endpoint");
    expect(retriedBody.messages[0].content).toContain("ping");
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("retries settings connection tests without Anthropic version headers when rejected", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      initialModel: "claude-compatible",
      fetchResponses: [
        {
          __fetchOk: false,
          __fetchStatus: 400,
          __fetchBody: {
            error: {
              message: "Unsupported header: anthropic-version"
            }
          }
        },
        { content: [{ type: "text", text: "pong" }] }
      ]
    });
    elements.get("zms-provider").value = "anthropic_compatible";
    elements.get("zms-activeProfileId").value = "anthropic-compatible";
    elements.get("zms-profileName").value = "Anthropic Compatible";
    elements.get("zms-profileProtocol").value = "anthropic_messages";
    elements.get("zms-baseURL").value = "https://router.example";

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].init.headers).toMatchObject({ "anthropic-version": "2023-06-01" });
    expect(fetchCalls[1].init.headers).not.toHaveProperty("anthropic-version");
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("fails settings connection tests when a 200 response still contains a provider error", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponse: {
        body: {
          error: {
            code: "invalid_api_key",
            type: "authentication_error",
            message: "Invalid API key sk-test-secret"
          }
        }
      }
    });

    await controller.testConnection();

    expect(elements.get("zms-status").value).toContain("Connection failed: Provider error");
    expect(elements.get("zms-status").value).toContain("invalid_api_key");
    expect(elements.get("zms-status").value).toContain("authentication_error");
    expect(elements.get("zms-status").value).toContain("Invalid API key [redacted]");
    expect(elements.get("zms-status").value).not.toContain("sk-test-secret");

    const wrapped = loadPreferencesController({
      fetchResponse: {
        result: {
          status: "error",
          code: "invalid_api_key",
          message: "Invalid API key sk-test-secret"
        }
      }
    });
    await wrapped.controller.loadModels();
    expect(wrapped.elements.get("zms-status").value).toContain("Connection failed: Provider error");
    expect(wrapped.elements.get("zms-status").value).toContain("invalid_api_key");
    expect(wrapped.elements.get("zms-status").value).toContain("Invalid API key [redacted]");
    expect(wrapped.elements.get("zms-status").value).not.toContain("sk-test-secret");
  });

  it("fails settings connection tests when a 200 response has no model text", async () => {
    const { controller, elements } = loadPreferencesController({
      initialModel: "model-a",
      fetchResponse: { data: [] }
    });

    await controller.testConnection();

    expect(elements.get("zms-status").value).toBe("Connection failed: No text returned from model");
  });

  it("extracts provider connection text variants from settings test responses", () => {
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      choices: [{ message: { content: [{ type: "reasoning", text: "hidden" }, { type: "text", text: "chat ok" }] } }]
    }))).toBe("chat ok");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: { value: "chat value ok", annotations: [] } }] } }]
    }))).toBe("chat value ok");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      choices: [{ message: { content: null, parsed: { answer: "structured chat ok", evidence: ["metadata"] } } }]
    }))).toBe("{\n  \"answer\": \"structured chat ok\",\n  \"evidence\": [\n    \"metadata\"\n  ]\n}");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      choices: [{ message: { content: null } }, { message: { content: "second choice ok" } }]
    }))).toBe("second choice ok");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      choices: [{ delta: { reasoning_content: "hidden" } }, { delta: { refusal: "second refusal ok" } }]
    }))).toBe("second refusal ok");
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      response: { output: [{ content: [{ type: "output_text", text: "responses ok" }] }] }
    }))).toBe("responses ok");
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      response: { output: [{ content: [{ type: "output_text", text: { value: "responses value ok" } }] }] }
    }))).toBe("responses value ok");
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      output: [{ content: [{ type: "output_text", output_parsed: { answer: "structured responses ok" } }] }]
    }))).toBe("{\n  \"answer\": \"structured responses ok\"\n}");
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      type: "response.refusal.done",
      refusal: "responses refusal ok"
    }))).toBe("responses refusal ok");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      refusal: "top-level refusal ok"
    }))).toBe("top-level refusal ok");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      data: { choices: [{ message: { content: "wrapped chat ok" } }] }
    }))).toBe("wrapped chat ok");
    expect(helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      choices: [{ message: { content: "<think>hidden setup\n\nAnswer: settings test ok" } }]
    }))).toBe("settings test ok");
    expect(helpers.extractProviderConnectionText("openai_responses", JSON.stringify({
      result: { output_text: "wrapped responses ok" }
    }))).toBe("wrapped responses ok");
    expect(helpers.extractProviderConnectionText("anthropic_messages", JSON.stringify({
      content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "anthropic ok" }]
    }))).toBe("anthropic ok");
    expect(helpers.extractProviderConnectionText("anthropic_messages", JSON.stringify({
      content: [{ type: "text", json: { answer: "structured anthropic ok" } }]
    }))).toBe("{\n  \"answer\": \"structured anthropic ok\"\n}");
    expect(helpers.extractProviderConnectionText("anthropic_messages", JSON.stringify({
      content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: { value: "anthropic value ok" } }]
    }))).toBe("anthropic value ok");
    expect(helpers.extractProviderConnectionText("anthropic_messages", JSON.stringify({
      data: { content: [{ type: "text", text: "wrapped anthropic ok" }] }
    }))).toBe("wrapped anthropic ok");
    expect(helpers.extractProviderConnectionText("openai_chat", [
      "data: {\"choices\":[{\"delta\":{\"content\":\"stream \"}}]}",
      "",
      "data: {\"choices\":[{\"delta\":{\"content\":\"chat\"}}]}",
      "data: [DONE]"
    ].join("\n"))).toBe("stream chat");
    expect(helpers.extractProviderConnectionText("openai_responses", [
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"stream \"}",
      "",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":{\"text\":\"object \"}}",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"responses\"}",
      "data: [DONE]"
    ].join("\n"))).toBe("stream object responses");
    expect(helpers.extractProviderConnectionText("openai_responses", [
      "data: {\"type\":\"response.output_text.done\",\"text\":\"done responses\"}",
      "data: {\"delta\":{\"output_text\":\" router delta\"}}",
      "data: [DONE]"
    ].join("\n"))).toBe("done responses router delta");
    expect(helpers.extractProviderConnectionText("anthropic_messages", [
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"stream \"}}",
      "",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"anthropic\"}}"
    ].join("\n"))).toBe("stream anthropic");
    expect(() => helpers.extractProviderConnectionText("openai_chat", [
      "data: {\"type\":\"error\",\"error\":{\"code\":\"rate_limit\",\"message\":\"Too many requests for sk-test-secret\"}}"
    ].join("\n"))).toThrow("Too many requests for [redacted]");
    expect(() => helpers.extractProviderConnectionText("openai_chat", JSON.stringify({
      completion: { error: { code: "invalid_api_key", message: "Bad key sk-test-secret" } }
    }))).toThrow("invalid_api_key - Bad key [redacted]");
  });

  it("shows parsed provider errors when model listing fails", async () => {
    const { controller, elements } = loadPreferencesController({
      fetchOk: false,
      fetchStatus: 429,
      fetchResponse: {
        error: {
          code: "rate_limit_exceeded",
          type: "rate_limit_error",
          message: "Too many requests for Bearer routed-secret"
        }
      }
    });

    await controller.loadModels();

    expect(elements.get("zms-status").value).toContain("Connection failed: HTTP 429");
    expect(elements.get("zms-status").value).toContain("rate_limit_exceeded");
    expect(elements.get("zms-status").value).toContain("rate_limit_error");
    expect(elements.get("zms-status").value).toContain("Bearer [redacted]");
    expect(elements.get("zms-status").value).not.toContain("routed-secret");
  });

  it("shows provider errors when a 200 model-list response contains an error body", async () => {
    const { controller, elements } = loadPreferencesController({
      fetchResponse: {
        error: {
          code: "invalid_api_key",
          type: "authentication_error",
          message: "Invalid API key sk-test-secret"
        }
      }
    });

    await controller.loadModels();

    expect(elements.get("zms-status").value).toContain("Connection failed: Provider error");
    expect(elements.get("zms-status").value).toContain("invalid_api_key");
    expect(elements.get("zms-status").value).toContain("authentication_error");
    expect(elements.get("zms-status").value).toContain("Invalid API key [redacted]");
    expect(elements.get("zms-status").value).not.toContain("sk-test-secret");
  });

  it("does not test a stale saved profile when edited profile JSON is invalid", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({ initialModel: "model-a" });
    elements.get("zms-profileCustomHeaders").value = "{";

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(0);
    expect(elements.get("zms-status").value).toBe("Invalid JSON");
  });

  it("does not load models from a stale saved profile when edited profile JSON is invalid", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController();
    elements.get("zms-profileBodyExtra").value = "{";

    await controller.loadModels();

    expect(fetchCalls).toHaveLength(0);
    expect(elements.get("zms-status").value).toBe("Invalid JSON");
  });

  it("tests local-agent profiles through the MCP endpoint without requiring API key or model", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          result: {
            serverInfo: { name: "local-agent-mcp" }
          }
        },
        {
          result: {
            tools: [
              { name: "ask_gemini" },
              { name: "ask_claude" },
              { name: "ask_opencode" },
              { name: "ask_all_agents" },
              { name: "check_local_agents" },
              { name: "extract_pdf_pages" }
            ]
          }
        }
      ]
    });
    elements.get("zms-activeProfileId").value = "local-agents";
    elements.get("zms-profileName").value = "Local Agents";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "http://127.0.0.1:3333/v1";
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";
    elements.get("zms-profileLocalAgentEnabled").checked = true;
    elements.get("zms-profileLocalAgentEndpoint").value = "127.0.0.1:3333/mcp";
    elements.get("zms-cap-modelList").checked = false;

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toBe("http://127.0.0.1:3333/mcp");
    expect(JSON.parse(fetchCalls[0].init.body)).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize"
    });
    expect(JSON.parse(fetchCalls[1].init.body)).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list"
    });
    expect(elements.get("zms-status").value).toBe("Connection OK");
  });

  it("fails local-agent settings tests when required MCP tools are not registered", async () => {
    const { controller, elements, fetchCalls } = loadPreferencesController({
      fetchResponses: [
        {
          result: {
            serverInfo: { name: "local-agent-mcp" }
          }
        },
        {
          result: {
            tools: [
              { name: "ask_gemini" },
              { name: "ask_claude" }
            ]
          }
        }
      ]
    });
    elements.get("zms-activeProfileId").value = "local-agents";
    elements.get("zms-profileName").value = "Local Agents";
    elements.get("zms-profileProtocol").value = "openai_chat";
    elements.get("zms-baseURL").value = "http://127.0.0.1:3333/v1";
    elements.get("zms-apiKey").value = "";
    elements.get("zms-model").value = "";
    elements.get("zms-profileLocalAgentEnabled").checked = true;
    elements.get("zms-profileLocalAgentEndpoint").value = "127.0.0.1:3333/mcp";
    elements.get("zms-cap-modelList").checked = false;

    await controller.testConnection();

    expect(fetchCalls).toHaveLength(2);
    expect(elements.get("zms-status").value).toContain("Connection failed");
    expect(elements.get("zms-status").value).toContain("ask_opencode");
    expect(elements.get("zms-status").value).toContain("ask_all_agents");
    expect(elements.get("zms-status").value).toContain("check_local_agents");
    expect(elements.get("zms-status").value).toContain("extract_pdf_pages");
  });
});
