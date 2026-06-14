var chromeHandle;
var registeredMenus = [];
var preferencePaneID = "";
var rootURI = "";
var pluginID = "";
var mainWindowObserver = null;

const PREF_PREFIX = "extensions.zoteroMarkdownSummary";
const CHROME_NAME = "zotero-markdown-summary";
const TOOLBAR_BUTTON_ID = "zotero-markdown-summary-toolbar-button";
const SIDENAV_BUTTON_ID = "zotero-markdown-summary-sidenav-button";
const WORKBENCH_PANEL_ID = "zotero-markdown-summary-workbench-panel";
const WORKBENCH_FRAME_ID = "zotero-markdown-summary-workbench-frame";
const WORKBENCH_STYLE_ID = "zotero-markdown-summary-workbench-style";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const SYSTEM_PROMPT = "你是学术论文阅读助手，输出中文 Markdown 摘要。";
const USER_PROMPT = "请按研究问题、方法、实验、结论、局限、可借鉴点总结。";
var UI_MESSAGES = typeof ZMS_I18N === "undefined" ? {} : ZMS_I18N;

async function startup({ id, rootURI: startupRootURI }) {
  pluginID = id;
  rootURI = startupRootURI;
  await Zotero.initializationPromise;
  await Zotero.unlockPromise;
  await Zotero.uiReadyPromise;
  loadSharedMessages();
  loadBootstrapProviderModule();
  loadBootstrapSettingsModule();
  loadBootstrapSummaryStoreModule();
  loadBootstrapZoteroItemModule();
  loadBootstrapUiModule();
  registerChrome();
  preferencePaneID = await registerPreferencePane();
  registerMenus();
  registerToolbarButtons();
  registerSidenavButtons();
  installMainWindowObserver();
}

function shutdown() {
  uninstallMainWindowObserver();
  for (const menuID of registeredMenus) {
    try {
      Zotero.MenuManager.unregisterMenu(menuID);
    } catch (err) {
      Zotero.debug(`[Markdown Summary] Failed to unregister menu: ${safeError(err)}`);
    }
  }
  registeredMenus = [];
  unregisterToolbarButtons();
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
  preferencePaneID = "";
}

function install() {}
function uninstall() {}

function onMainWindowLoad(window) {
  registerMenus();
  if (isMainWindow(window)) {
    registerToolbarButton(window);
    registerSidenavButton(window);
    return;
  }
  registerToolbarButtons();
  registerSidenavButtons();
}

function onMainWindowUnload(window) {
  if (window?.document) {
    unregisterToolbarButtons(window.document);
    return;
  }
  unregisterToolbarButtons();
}

function installMainWindowObserver() {
  if (mainWindowObserver || !Services.ww?.registerNotification) return;
  mainWindowObserver = {
    observe(subject, topic) {
      if (topic === "domwindowopened" || topic === "domwindowclosed") {
        const window = subject?.document
          ? subject
          : subject?.QueryInterface?.(Ci.nsIInterfaceRequestor)?.getInterface?.(Ci.nsIDOMWindow);
        if (!isMainWindow(window)) return;
        if (topic === "domwindowopened") {
          const attach = () => onMainWindowLoad(window);
          if (window?.document?.readyState === "complete") {
            attach();
          } else {
            window.addEventListener("load", attach, { once: true });
          }
          return;
        }
        onMainWindowUnload(window);
      }
    }
  };
  Services.ww.registerNotification(mainWindowObserver);
}

function uninstallMainWindowObserver() {
  if (!mainWindowObserver || !Services.ww?.unregisterNotification) return;
  Services.ww.unregisterNotification(mainWindowObserver);
  mainWindowObserver = null;
}

function isMainWindow(window) {
  const doc = window?.document;
  return !!doc && doc.documentElement?.getAttribute?.("windowtype") === "navigator:browser";
}

function registerChrome() {
  if (chromeHandle) return;
  const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [["content", CHROME_NAME, "content/"]]);
}

function registerPreferencePane() {
  return Zotero.PreferencePanes.register({
    pluginID,
    id: "zotero-prefpane-markdown-summary",
    src: rootURI + "content/preferences.xhtml",
    label: "Literature Review with LLM",
    defaultXUL: true,
    scripts: [rootURI + "content/preferences.js"],
    stylesheets: [rootURI + "content/preferences.css"]
  });
}

function registerMenus() {
  if (registeredMenus.length) return;
  const common = {
    pluginID,
    target: "main/library/item"
  };
  registeredMenus.push(Zotero.MenuManager.registerMenu({
    ...common,
    menuID: "zotero-markdown-summary-item-actions",
    menus: [
      menuItem(t("openWorkbench"), (event, context) => openWorkbenchForContext(context), { requireWorkbenchItems: true }),
      menuItem(t("selfCheck"), (event, context) => runSelfCheckForContext(context), { requireRegularItems: true }),
      menuItem(t("generateSummary"), (event, context) => runForContext(context, false), { requireRegularItems: true }),
      menuItem(t("updateSummary"), (event, context) => runForContext(context, true), { requireRegularItems: true }),
      menuItem(t("openSummary"), (event, context) => openForContext(context), { requireRegularItems: true }),
      menuItem(t("openMarkdownReader"), (event, context) => openMarkdownReaderForContext(context), { requireRegularItems: true })
    ]
  }));
  registeredMenus.push(Zotero.MenuManager.registerMenu({
    pluginID,
    target: "main/menubar/tools",
    menuID: "zotero-markdown-summary-tools",
    menus: [
      menuItem(t("openWorkbench"), () => openWorkbenchForContext(), { disableWithoutWorkbenchItems: true }),
      menuItem(t("selfCheck"), () => runSelfCheckForContext()),
      menuItem(t("batchSelected"), () => batchGenerateSelected(false), { disableWithoutRegularItems: true }),
      menuItem(t("batchAll"), () => batchGenerateCurrentList(false)),
      menuItem(t("batchAllUpdate"), () => batchGenerateCurrentList(true)),
      menuItem(t("settings"), () => openPreferences())
    ]
  }));
}

async function runSelfCheckForContext(context) {
  const settings = getSettings();
  const profile = normalizedActiveProfile();
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const doc = win?.document;
  let item = null;
  try {
    item = selectedRegularItems(context)[0] || null;
  } catch (_err) {
    item = null;
  }

  const lines = [];
  lines.push(`[${t("selfCheckRuntime")}]`);
  lines.push(reportLine(t("selfCheckToolbar"), yesNo(!!doc?.getElementById(TOOLBAR_BUTTON_ID)), !!doc?.getElementById(TOOLBAR_BUTTON_ID)));
  lines.push(reportLine(t("selfCheckSidenav"), yesNo(!!doc?.getElementById(SIDENAV_BUTTON_ID)), !!doc?.getElementById(SIDENAV_BUTTON_ID)));
  lines.push(reportLine(t("selfCheckEmbeddedPanel"), yesNo(!!doc?.getElementById(WORKBENCH_PANEL_ID)), undefined));

  lines.push("");
  lines.push(`[${t("selfCheckProvider")}]`);
  lines.push(reportLine(t("selfCheckProfile"), profile?.id || pref("activeProfileId") || t("selfCheckMissing"), !!(profile?.id || pref("activeProfileId"))));
  lines.push(reportLine(t("selfCheckProtocol"), settings.protocol || t("selfCheckMissing"), !!settings.protocol));
  lines.push(reportLine(t("selfCheckEndpoint"), profileEndpoint(profile, settings) || t("selfCheckMissing"), !!profileEndpoint(profile, settings)));
  const localAgentProfile = isLocalAgentProfile(profile);
  lines.push(reportLine(t("selfCheckApiKey"), localAgentProfile ? t("selfCheckNotRequired") : (settings.apiKey ? t("selfCheckYes") : t("selfCheckNo")), localAgentProfile || !!settings.apiKey));
  lines.push(reportLine(t("selfCheckModel"), localAgentProfile ? t("selfCheckNotRequired") : (settings.model || t("selfCheckMissing")), localAgentProfile || !!settings.model));
  if (localAgentProfile) {
    const localAgentEndpoint = localAgentEndpointForProfile(profile);
    const bridgeStatus = await checkLocalAgentBridge(localAgentEndpoint);
    lines.push(reportLine(t("selfCheckLocalAgentEndpoint"), bridgeStatus.label, bridgeStatus.ok));
  }
  lines.push(reportLine(t("selfCheckCustomHeaders"), objectKeyCount(profile?.customHeaders), undefined));
  lines.push(reportLine(t("selfCheckBodyExtra"), objectKeyCount(profile?.bodyExtra), undefined));

  const outputDir = settings.outputDir || "";
  const outputDirExists = outputDir ? await pathExists(outputDir) : false;
  const skillsDir = outputDir ? PathUtils.join(outputDir, "skills") : "";
  const skillsDirExists = skillsDir ? await pathExists(skillsDir) : false;
  const skillCount = skillsDirExists ? await countMarkdownFiles(skillsDir) : 0;

  lines.push("");
  lines.push(`[${t("selfCheckFiles")}]`);
  lines.push(reportLine(t("selfCheckOutputDir"), outputDir || t("selfCheckMissing"), outputDirExists));
  lines.push(reportLine(t("selfCheckSkillsDir"), skillsDir ? `${skillsDir} (${skillCount})` : t("selfCheckMissing"), skillsDirExists));

  lines.push("");
  lines.push(`[${t("selfCheckItem")}]`);
  if (!item) {
    lines.push(t("selfCheckNoItem"));
    showSelfCheckReport(lines.join("\n"));
    return;
  }

  lines.push(reportLine("Title", item.getField("title") || item.key, true));
  lines.push(reportLine("Item Key", item.key || t("selfCheckMissing"), !!item.key));
  const pdf = await findPdfAttachment(item).catch(() => null);
  lines.push(reportLine(t("selfCheckPdf"), pdf?.attachmentFilename || pdf?.key || t("selfCheckMissing"), !!pdf));
  const pdfPath = pdf ? await pdf.getFilePathAsync().catch(() => "") : "";
  lines.push(reportLine(t("selfCheckPdfPath"), pdfPath || t("selfCheckMissing"), !!pdfPath && await pathExists(pdfPath)));
  const indexedLength = pdf ? await indexedTextLength(pdf) : 0;
  lines.push(reportLine(t("selfCheckIndexedText"), indexedLength, indexedLength > 0));
  lines.push(reportLine(t("selfCheckAnnotations"), annotationCount(pdf), undefined));
  lines.push(reportLine(t("selfCheckNotes"), noteCount(item), undefined));
  const summary = await findExistingSummaryAttachment(item, settings).catch(() => null);
  const summaryPath = summary ? await summary.getFilePathAsync().catch(() => "") : "";
  lines.push(reportLine(t("selfCheckSummaryFile"), summaryPath || summary?.getField?.("title") || t("selfCheckMissing"), !!summary));

  showSelfCheckReport(lines.join("\n"));
}

async function runForContext(context, force) {
  const items = selectedRegularItems(context);
  if (!items.length) {
    showAlert(t("selectItem"));
    return;
  }
  const settings = getSettings();
  if (!settingsHasUsableAuth(settings)) {
    showAlert(t("apiKeyMissing"));
    return;
  }
  if (settingsRequiresModel(settings) && !settings.model) {
    showAlert(t("modelMissing"));
    return;
  }
  for (const item of items) {
    try {
      await generateForItem(item, settings, force);
      showProgress(`${t("generated")}: ${item.getField("title") || item.key}`);
    } catch (err) {
      showAlert(`${t("failed")}: ${safeError(err)}`);
      Zotero.debug(`[Markdown Summary] ${safeError(err)}`);
    }
  }
}

async function batchGenerateSelected(force) {
  await batchGenerateItems(selectedRegularItems(), force);
}

async function batchGenerateCurrentList(force) {
  const pane = Zotero.getActiveZoteroPane();
  const collection = pane?.getSelectedCollection?.() || null;
  const items = await currentListRegularItems(collection);
  const context = collection ? collectionContextFromItem(collection, pane) : null;
  await batchGenerateItems(items, force, context);
}

async function batchGenerateItems(items, force, collectionContext) {
  const uniqueItems = uniqueRegularItems(items);
  if (!uniqueItems.length) {
    showAlert(t("selectItem"));
    return;
  }
  const settings = getSettings();
  if (!settingsHasUsableAuth(settings)) {
    showAlert(t("apiKeyMissing"));
    return;
  }
  if (settingsRequiresModel(settings) && !settings.model) {
    showAlert(t("modelMissing"));
    return;
  }
  let generated = 0;
  let skippedNoPdf = 0;
  let skippedExisting = 0;
  let failed = 0;
  const results = [];
  for (const item of uniqueItems) {
    try {
      const pdf = await findPdfAttachment(item);
      if (!pdf) {
        skippedNoPdf++;
        results.push(paperBatchRecord(item, "skipped_no_pdf"));
        continue;
      }
      const result = await generateForItem(item, settings, force);
      if (result.status === "generated") generated++;
      if (result.status === "skipped_existing") skippedExisting++;
      results.push(result);
    } catch (err) {
      failed++;
      results.push(paperBatchRecord(item, "failed", { error: safeError(err) }));
      Zotero.debug(`[Markdown Summary] Batch item failed (${item?.key || "unknown"}): ${safeError(err)}`);
    }
  }
  const collectionArtifacts = collectionContext
    ? await writeCollectionWorkspace(settings, collectionContext, results)
    : null;
  const papersIndexPath = collectionArtifacts?.papersIndexPath || "";
  const batchReportPath = await writeBatchRunReport(settings, collectionContext, results, { force });
  const indexMessage = papersIndexPath ? `; papers.json: ${papersIndexPath}` : "";
  const matrixMessage = collectionArtifacts?.methodMatrixPath ? `; method-matrix: ${collectionArtifacts.methodMatrixPath}` : "";
  const draftMessage = collectionArtifacts?.reviewDraftPath ? `; review-draft: ${collectionArtifacts.reviewDraftPath}` : "";
  const reportMessage = batchReportPath ? `; ${t("batchReport")}: ${batchReportPath}` : "";
  const skipped = skippedNoPdf + skippedExisting;
  const extraParts = [];
  if (skippedNoPdf > 0) extraParts.push(`${t("batchSkippedNoPdf")}: ${skippedNoPdf}`);
  if (skippedExisting > 0) extraParts.push(`${t("batchSkippedExisting")}: ${skippedExisting}`);
  const skippedSuffix = extraParts.length ? ` (${extraParts.join("; ")})` : "";
  showProgress(`${t("batchDone")}: ${generated}; ${t("batchSkipped")}: ${skipped}${skippedSuffix}; ${t("batchFailed")}: ${failed}${indexMessage}${matrixMessage}${draftMessage}${reportMessage}`);
}

async function generateForItem(item, settings, force) {
  const pdf = await findPdfAttachment(item);
  if (!pdf) throw new Error(t("noPdf"));
  const pdfPath = await pdf.getFilePathAsync();
  if (!pdfPath) throw new Error(t("noPdfPath"));
  const input = await buildInput(pdf, pdfPath, settings);
  const sourceHash = hashString(`${item.key}:${pdf.key}:${input.text || input.base64 || ""}`);
  const outputPath = buildOutputPath(item, pdf, settings, sourceHash);
  const existing = await findExistingSummaryAttachment(item, settings);
  if (!force && existing && await IOUtils.exists(outputPath)) {
    showProgress(t("existing"));
    return paperBatchRecord(item, "skipped_existing", {
      pdfKey: pdf.key,
      year: item.getField("date") || "",
      summaryPath: outputPath,
      sourceHash
    });
  }
  const prompts = summaryPromptsForSettings(settings);
  const result = await callProvider({
    provider: settings.provider,
    endpointMode: settings.endpointMode,
    customHeaders: settings.customHeaders,
    bodyExtra: settings.bodyExtra,
    fullURL: settings.fullURL,
    protocol: settings.protocol,
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    model: settings.model,
    capabilities: settings.capabilities,
    request: {
      system: prompts.system,
      prompt: prompts.user,
      input,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      stream: settings.stream
    }
  }, sourceHash);
  const markdown = renderMarkdown(item, pdf, settings, result);
  await ensureDirectory(settings.outputDir);
  await writeSummaryMarkdown(outputPath, markdown);
  await linkOrUpdateAttachment(item, outputPath, existing);
  return paperBatchRecord(item, "generated", {
    pdfKey: pdf.key,
    year: item.getField("date") || "",
    summaryPath: outputPath,
    sourceHash,
    provider: result.provider,
    model: result.model
  });
}

async function buildInput(pdf, pdfPath, settings) {
  if (settings.inputMode === "pdf_base64") {
    if (!canUsePdfBase64Input(settings)) {
      throw new Error(t("pdfBase64Unsupported"));
    }
    const bytes = await IOUtils.read(pdfPath);
    return {
      type: "pdf_base64",
      base64: bytesToBase64(bytes),
      filename: pdf.attachmentFilename || "paper.pdf"
    };
  }
  const text = (await pdf.attachmentText) || "";
  if (!text.trim()) throw new Error(t("emptyText"));
  return { type: "text", text };
}

function canUsePdfBase64Input(settings) {
  return settings?.capabilities?.pdfBase64 === true && settings.protocol !== "openai_chat";
}

async function callProvider(summaryRequest, sourceHash) {
  const { provider, protocol } = summaryRequest;
  if (isLocalAgentProfile(summaryRequest)) {
    return callLocalAgentSummary(summaryRequest, sourceHash);
  }
  if (protocol === "anthropic_messages" || provider === "anthropic") {
    return callAnthropic(summaryRequest, sourceHash);
  }
  return callOpenAICompatible(summaryRequest, sourceHash, provider === "openai");
}

async function callOpenAICompatible(summaryRequest, sourceHash, nativeOpenAI) {
  const { baseURL, fullURL, endpointMode = "base_url", customHeaders = {}, bodyExtra = {}, apiKey, model, request } = summaryRequest;
  const isPdf = request.input.type === "pdf_base64";
  const useResponses = summaryRequest.protocol === "openai_responses" || isPdf;
  if (isPdf && summaryRequest.protocol !== "openai_responses") {
    throw new Error("当前兼容接口不支持 PDF base64 输入");
  }
  const protocol = useResponses ? "openai_responses" : "openai_chat";
  const url = endpointMode === "full_url" ? (fullURL || baseURL) : endpointForProtocol(protocol, baseURL);
  const body = useResponses ? {
    model,
    instructions: request.system,
    input: openaiResponsesInputForSummary(request),
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    stream: request.stream
  } : {
    model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: `${request.prompt}\n\n${request.input.text}` }
    ],
    temperature: request.temperature,
    max_tokens: request.maxOutputTokens,
    stream: request.stream,
    n: 1
  };
  const merged = withProviderBodyDefaults(summaryRequest, body);
  if (summaryRequest.provider === "minimax" && merged.extra_body === undefined) {
    merged.extra_body = { reasoning_split: true };
  }
  const headers = {
    "content-type": "application/json",
    ...customHeaders
  };
  if (usesAzureOpenAIAuth(summaryRequest)) {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "api-key", apiKey);
  } else {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "authorization", apiKey ? `Bearer ${apiKey}` : "");
  }
  const data = await requestJSON(url, headers, merged, request.stream, summaryRequest.protocol || protocol);
  return {
    markdown: extractOpenAIText(data),
    usage: data.usage,
    provider: summaryRequest.provider,
    model,
    sourceHash
  };
}

async function callAnthropic(summaryRequest, sourceHash) {
  const { baseURL, fullURL, endpointMode = "base_url", customHeaders = {}, bodyExtra = {}, apiKey, model, request } = summaryRequest;
  const content = [];
  if (request.input.type === "pdf_base64") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: request.input.base64
      }
    });
  }
  content.push({
    type: "text",
    text: request.input.type === "text" ? `${request.prompt}\n\n${request.input.text}` : request.prompt
  });
  const headers = {
    "content-type": "application/json",
    ...customHeaders
  };
  if (!hasExplicitAuthHeader(headers)) {
    const authHeader = anthropicAuthHeaderName(summaryRequest);
    setHeaderIfMissing(headers, authHeader, authHeader === "authorization" && apiKey ? `Bearer ${apiKey}` : apiKey);
  }
  setHeaderIfMissing(headers, "anthropic-version", "2023-06-01");
  if (shouldAddAnthropicDirectBrowserAccess(summaryRequest)) {
    setHeaderIfMissing(headers, "anthropic-dangerous-direct-browser-access", "true");
  }
  const messageUrl = endpointMode === "full_url" ? (fullURL || baseURL) : endpointForProtocol("anthropic_messages", baseURL);
  const data = await requestJSON(messageUrl, headers, {
    model,
    system: request.system,
    messages: [{ role: "user", content }],
    max_tokens: request.maxOutputTokens,
    stream: request.stream,
    ...providerBodyExtra(bodyExtra)
  }, request.stream, "anthropic_messages");
  return {
    markdown: extractAnthropicText(data),
    usage: data.usage,
    provider: summaryRequest.provider,
    model,
    sourceHash
  };
}

async function callLocalAgentSummary(summaryRequest, sourceHash) {
  if (summaryRequest.request.input.type !== "text") {
    throw new Error("Local Agents profiles use extracted text input");
  }
  const localAgent = localAgentSummaryConfig(summaryRequest);
  if (!localAgent.endpoint) throw new Error("Local Agents endpoint is missing");
  const argumentsPayload = {
    prompt: localAgentSummaryPrompt(summaryRequest.request),
    ...(summaryRequest.model || localAgent.model ? { model: localAgent.model || summaryRequest.model } : {}),
    ...(localAgent.timeoutSeconds ? { timeoutSeconds: localAgent.timeoutSeconds } : {}),
    ...(localAgent.cwd ? { cwd: localAgent.cwd } : {})
  };
  const response = await fetch(localAgent.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...localAgent.headers
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `summary-${Date.now()}`,
      method: "tools/call",
      params: {
        name: localAgent.tool,
        arguments: argumentsPayload
      }
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(providerErrorText(response.status, text));
  const payload = safeParseJSON(text);
  if (payload?.error) throw new Error(redact(payload.error.message || "Local Agents request failed"));
  const markdown = localAgentTextFromResponse(payload);
  if (!markdown) throw new Error("Local Agents returned empty response");
  return {
    markdown,
    usage: undefined,
    provider: summaryRequest.provider,
    model: localAgent.tool,
    sourceHash
  };
}

function localAgentSummaryConfig(summaryRequest) {
  const raw = localAgentRawConfig(summaryRequest);
  if (typeof raw === "string") {
    return { endpoint: normalizeLocalAgentEndpoint(raw), tool: "ask_all_agents", headers: {}, timeoutSeconds: 180 };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.enabled === false) return { endpoint: "", tool: "ask_all_agents", headers: {} };
  const preset = raw["paper-deep-summary"] || raw.summary || raw.default || raw["ask-all-agents"] || {};
  const endpoint = normalizeLocalAgentEndpoint(preset.endpoint || raw.endpoint || raw.url || raw.mcpUrl || raw.baseUrl);
  const timeoutSeconds = toFinitePositiveInt(preset.timeoutSeconds, raw.timeoutSeconds, preset.timeoutSec, raw.timeoutSec, preset.timeout, raw.timeout) || 180;
  return {
    endpoint,
    tool: normalizeLocalAgentTool(preset.tool || preset.toolName || preset.tool_id || raw.tool || raw.toolName || raw.tool_id || "ask_all_agents"),
    headers: normalizeObjectStringMap(preset.headers) || normalizeObjectStringMap(raw.headers) || {},
    timeoutSeconds,
    model: preset.model || raw.model || "",
    cwd: preset.cwd || raw.cwd || raw.workdir || raw.workingDirectory || raw.working_directory || ""
  };
}

function localAgentSummaryPrompt(request) {
  return [
    request.system,
    request.prompt,
    "CONTEXT:",
    request.input.text
  ].filter(Boolean).join("\n\n");
}

function localAgentTextFromResponse(payload) {
  const content = payload?.result?.content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === "text")
      .map((item) => String(item.text || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof payload?.result?.text === "string") return payload.result.text.trim();
  if (typeof payload?.text === "string") return payload.text.trim();
  return "";
}

function normalizeLocalAgentTool(value) {
  const tool = String(value || "").trim();
  return tool || "ask_all_agents";
}

async function requestJSON(url, headers, body, stream, protocol = "openai_chat") {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const text = await response.text();
        const error = providerHTTPError(response.status, text);
        if (error.retryableProviderError && attempt < 3) {
          await Zotero.Promise.delay(500 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      if (stream && response.body) {
        return await readProviderStream(response, protocol);
      }
      return await response.json();
    } catch (err) {
      if (err?.retryableProviderError === false) throw err;
      lastError = err;
      if (attempt < 3) {
        await Zotero.Promise.delay(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError;
}

function providerHTTPError(status, text) {
  const error = new Error(providerErrorText(status, text));
  error.retryableProviderError = status === 429 || status >= 500;
  return error;
}

async function readProviderStream(response, protocol) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const parsed = parseProviderStreamLine(protocol, line);
      if (parsed.usage) usage ||= parsed.usage;
      if (parsed.text && (!parsed.snapshot || !text)) text += parsed.text;
    }
  }
  const tail = parseProviderStreamLine(protocol, buffer);
  if (tail.usage) usage ||= tail.usage;
  if (tail.text && (!tail.snapshot || !text)) text += tail.text;
  if (protocol === "anthropic_messages") {
    return { content: [{ type: "text", text }], usage };
  }
  return { choices: [{ message: { content: text } }], output_text: text, usage };
}

function parseProviderStreamLine(protocol, line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("data:")) return { text: "" };
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return { text: "" };
  const chunk = safeParseJSON(payload);
  if (!chunk) return { text: "" };
  const errorText = streamErrorText(chunk);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  return {
    text: extractProviderStreamText(protocol, chunk),
    snapshot: isProviderStreamSnapshot(protocol, chunk),
    usage: streamUsage(chunk)
  };
}

function renderMarkdown(item, pdf, settings, result) {
  const title = item.getField("title") || item.key;
  const frontmatter = [
    "---",
    `zoteroItemKey: ${item.key}`,
    `pdfAttachmentKey: ${pdf.key}`,
    `sourceHash: ${result.sourceHash}`,
    `summaryVersion: ${settings.summaryVersion}`,
    `inputMode: ${settings.inputMode}`,
    `summaryType: paper-deep-summary`,
    `evidenceLevel: ${settings.inputMode === "text" ? "fulltext_or_indexed_text" : "pdf_base64"}`,
    `outputLanguage: ${settings.outputLanguage}`,
    `sourceLanguage: auto`,
    `templateVersion: summary-v1`,
    `provider: ${result.provider}`,
    `model: ${result.model}`,
    `generatedAt: ${new Date().toISOString()}`,
    "---"
  ].join("\n");
  return `${frontmatter}\n\n# ${title}\n\n${result.markdown.trim()}\n`;
}

function buildOutputPath(item, pdf, settings, sourceHash) {
  const base = `${sanitizeFilename(item.getField("date") || "no-date")}-${sanitizeFilename(item.getField("title") || item.key)}-${pdf.key}-${settings.summaryVersion}-${sourceHash.slice(0, 8)}.md`;
  return PathUtils.join(settings.outputDir, base);
}

function summaryPromptsForSettings(settings) {
  const outputLanguage = normalizeSummaryOutputLanguage(settings?.outputLanguage);
  return {
    system: summarySystemPromptForLanguage(settings?.systemPrompt, outputLanguage),
    user: summaryUserPromptForLanguage(settings?.userPrompt, outputLanguage)
  };
}

function summarySystemPromptForLanguage(prompt, outputLanguage) {
  const value = String(prompt || "").trim();
  if (!value || value === SYSTEM_PROMPT) return defaultSummarySystemPrompt(outputLanguage);
  return `${value}\n${summaryLanguageInstruction(outputLanguage)}`;
}

function summaryUserPromptForLanguage(prompt, outputLanguage) {
  const value = String(prompt || "").trim();
  if (!value || value === USER_PROMPT) return defaultSummaryUserPrompt(outputLanguage);
  return `${value}\n\n${summaryLanguageInstruction(outputLanguage)}`;
}

function defaultSummarySystemPrompt(outputLanguage) {
  if (outputLanguage === "en-US") {
    return "You are an academic paper reading assistant. Output an evidence-grounded Markdown summary in English.";
  }
  if (outputLanguage === "ja-JP") {
    return "あなたは学術論文の読解アシスタントです。根拠に基づく Markdown 要約を日本語で出力してください。";
  }
  return SYSTEM_PROMPT;
}

function defaultSummaryUserPrompt(outputLanguage) {
  if (outputLanguage === "en-US") {
    return "Create a deep paper reading report with Markdown sections for basic information, background, research question, method, experiments and validation, findings, contributions, limitations, and follow-up ideas. Keep every section evidence-grounded and mark unsupported points as low-confidence.";
  }
  if (outputLanguage === "ja-JP") {
    return "単一論文の詳細読解レポートを作成してください。Markdown の章立ては、基本情報、研究背景、研究課題、手法、実験と検証、主な知見、貢献、限界、次の検討事項にしてください。根拠のある内容だけを書き、根拠が弱い箇所は低信頼として明記してください。";
  }
  return USER_PROMPT;
}

function summaryLanguageInstruction(outputLanguage) {
  if (outputLanguage === "en-US") return "Write the output in English.";
  if (outputLanguage === "ja-JP") return "日本語で出力してください。";
  return "请使用中文输出。";
}

function normalizeSummaryOutputLanguage(value) {
  if (value === "en-US" || value === "ja-JP") return value;
  return "zh-CN";
}

async function writeBatchPapersIndex(settings, collectionContext, results) {
  const baseDir = collectionContext.outputDir || PathUtils.join(settings.outputDir, "collections", sanitizeFilename(collectionContext.key));
  const indexPath = PathUtils.join(baseDir, "papers.json");
  const payload = {
    collection: {
      key: collectionContext.key,
      name: collectionContext.name,
      type: collectionContext.type,
      parentLibraryID: collectionContext.parentLibraryID
    },
    generatedAt: new Date().toISOString(),
    outputLanguage: settings.outputLanguage || "zh-CN",
    summaryVersion: settings.summaryVersion || "1",
    outputDir: settings.outputDir,
    stats: batchStats(results),
    items: results
      .filter((item) => item)
      .map((item) => {
        if (item.status === "generated" || item.status === "skipped_existing") {
          const source = item.sourceHash ? { sourceHash: item.sourceHash } : {};
          return {
            status: item.status,
            itemKey: item.itemKey,
            title: item.title,
            year: item.year,
            pdfKey: item.pdfKey,
            summaryPath: item.summaryPath,
            provider: item.provider || "",
            model: item.model || "",
            ...source
          };
        }
        return {
          status: item.status,
          itemKey: item.itemKey,
          title: item.title,
          year: item.year,
          pdfKey: item.pdfKey || "",
          summaryPath: item.summaryPath || "",
          error: item.error || ""
        };
      })
  };
  await writeText(indexPath, JSON.stringify(payload, null, 2));
  return indexPath;
}

async function writeCollectionWorkspace(settings, collectionContext, results) {
  const baseDir = collectionContext.outputDir || PathUtils.join(settings.outputDir, "collections", sanitizeFilename(collectionContext.key));
  const dirs = collectionWorkspaceDirs(baseDir);
  await Promise.all(Object.values(dirs).map((path) => ensureDirectory(path)));
  const outputLanguage = collectionOutputLanguage(settings);
  const summaryInsights = await loadBatchSummaryInsights(results);
  const papersIndexPath = await writeBatchPapersIndex(settings, { ...collectionContext, outputDir: baseDir }, results);
  const artifacts = collectionWorkspaceArtifactPaths(dirs, outputLanguage);
  const paperNotesIndexPath = artifacts.paperNotesIndexPath;
  const methodMatrixPath = artifacts.methodMatrixPath;
  const gapMatrixPath = artifacts.gapMatrixPath;
  const researchQuestionCardsPath = artifacts.researchQuestionCardsPath;
  const reviewDraftPath = artifacts.reviewDraftPath;
  const ideaListPath = artifacts.ideaListPath;
  await writeText(paperNotesIndexPath, renderPaperNotesIndex(collectionContext, results, outputLanguage));
  await writeText(methodMatrixPath, renderMethodMatrix(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(gapMatrixPath, renderResearchGapMatrix(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(researchQuestionCardsPath, renderResearchQuestionCards(collectionContext, results, outputLanguage));
  await writeText(reviewDraftPath, renderManualReviewDraft(collectionContext, results, outputLanguage));
  await writeText(ideaListPath, renderIdeaList(collectionContext, results, outputLanguage, summaryInsights));
  return {
    baseDir,
    papersIndexPath,
    paperNotesIndexPath,
    methodMatrixPath,
    gapMatrixPath,
    researchQuestionCardsPath,
    reviewDraftPath,
    ideaListPath
  };
}

function collectionWorkspaceDirs(baseDir) {
  return {
    base: baseDir,
    paperNotes: PathUtils.join(baseDir, "paper-notes"),
    knowledge: PathUtils.join(baseDir, "knowledge"),
    writing: PathUtils.join(baseDir, "writing")
  };
}

function collectionWorkspaceArtifactPaths(dirs, outputLanguage) {
  const language = collectionOutputLanguage({ outputLanguage });
  return {
    paperNotesIndexPath: PathUtils.join(dirs.paperNotes, `index.${language}.md`),
    methodMatrixPath: PathUtils.join(dirs.knowledge, `method-matrix.${language}.md`),
    gapMatrixPath: PathUtils.join(dirs.knowledge, `research-gaps.${language}.md`),
    researchQuestionCardsPath: PathUtils.join(dirs.knowledge, `research-question-cards.${language}.md`),
    reviewDraftPath: PathUtils.join(dirs.writing, `manual-review-draft.${language}.md`),
    ideaListPath: PathUtils.join(dirs.writing, `idea-list.${language}.md`)
  };
}

async function loadBatchSummaryInsights(results) {
  const entries = await Promise.all(batchReportItems(results)
    .filter((item) => item.status === "generated" || item.status === "skipped_existing")
    .map(async (item) => {
      const markdown = await summaryMarkdownForBatchItem(item);
      return [item.itemKey, extractSummaryInsights(markdown, item)];
    }));
  return new Map(entries.filter(([, insight]) => insight.hasEvidence));
}

async function summaryMarkdownForBatchItem(item) {
  if (item.summaryText) return String(item.summaryText);
  if (item.markdown) return String(item.markdown);
  if (!item.summaryPath) return "";
  try {
    if (!await IOUtils.exists(item.summaryPath)) return "";
    return await readText(item.summaryPath);
  } catch (_err) {
    return "";
  }
}

function extractSummaryInsights(markdown, item = {}) {
  const sections = markdownSections(stripMarkdownFrontmatter(markdown));
  const method = firstInsight(sections, [/方法|手法|method|approach|model|算法|框架|framework/i]);
  const dataScenario = firstInsight(sections, [/实验|验证|场景|数据|数据集|experiment|validation|scenario|dataset|case|evaluation|評価|検証/i]);
  const metrics = firstInsight(sections, [/指标|评价指标|评估|metrics?|evaluation|measure|評価指標/i]);
  const limitations = insightList(sections, [/局限|限制|不足|limitation|threat|weakness|限界|課題/i], 2);
  const missingEvidence = insightList(sections, [/缺失证据|证据不足|missing evidence|evidence gap|不足証拠|低置信|low-confidence/i], 2);
  const validationNeeds = insightList(sections, [/验证需求|验证|实验|下一步|next step|future|follow-up|検証|次の検討/i], 2);
  const ideas = insightList(sections, [/研究想法|想法|idea|future work|follow-up|后续|下一步|次の検討|検討事項/i], 2);
  const rejectConditions = insightList(sections, [/推翻|反证|reject|falsif|棄却|反証/i], 1);
  const evidence = [item.summaryPath, firstInsight(sections, [/贡献|发现|结论|contribution|finding|知見|貢献/i])].filter(Boolean).join("; ");
  return {
    hasEvidence: !!(method || dataScenario || metrics || limitations.length || missingEvidence.length || validationNeeds.length || ideas.length || rejectConditions.length),
    method,
    dataScenario,
    metrics,
    limitations,
    missingEvidence,
    validationNeeds,
    ideas,
    rejectConditions,
    evidence
  };
}

function stripMarkdownFrontmatter(markdown) {
  const text = String(markdown || "");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  return end === -1 ? text : text.slice(end + 4);
}

function markdownSections(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let current = { title: "", lines: [] };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current.title || current.lines.some((item) => item.trim())) sections.push(current);
      current = { title: heading[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.title || current.lines.some((item) => item.trim())) sections.push(current);
  return sections;
}

function firstInsight(sections, titlePatterns) {
  return insightList(sections, titlePatterns, 1)[0] || "";
}

function insightList(sections, titlePatterns, limit = 2) {
  const matchedSections = (sections || []).filter((section) => titlePatterns.some((pattern) => pattern.test(section.title)));
  const lines = [];
  for (const section of matchedSections) {
    for (const line of section.lines) {
      const cleaned = cleanupInsightLine(line);
      if (cleaned) lines.push(cleaned);
      if (lines.length >= limit) return uniqueInsightLines(lines).slice(0, limit);
    }
  }
  return uniqueInsightLines(lines).slice(0, limit);
}

function cleanupInsightLine(line) {
  const text = String(line || "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^\s*>\s*/, "")
    .replace(/\[[^\]]+\]\([^)]*\)/g, (match) => match.replace(/\]\([^)]*\)/, "]"))
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^[-|:]+$/.test(text) || /^#+\s/.test(text)) return "";
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function uniqueInsightLines(lines) {
  const seen = new Set();
  const unique = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }
  return unique;
}

function renderPaperNotesIndex(collectionContext, results, outputLanguage = "zh-CN") {
  const labels = collectionTemplateLabels(outputLanguage);
  const rows = batchReportItems(results)
    .map((item) => `| ${escapeMarkdownTable(item.itemKey)} | ${escapeMarkdownTable(item.title)} | ${escapeMarkdownTable(item.year)} | ${escapeMarkdownTable(item.status)} | ${escapeMarkdownTable(item.summaryPath)} |`)
    .join("\n") || "|  |  |  |  |  |";
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.paperNotes}`,
    "",
    "| Item Key | Title | Year | Status | Summary Path |",
    "| --- | --- | --- | --- | --- |",
    rows,
    ""
  ].join("\n");
}

function renderMethodMatrix(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const rows = batchReportItems(results)
    .filter((item) => item.status === "generated" || item.status === "skipped_existing")
    .map((item) => {
      const insight = summaryInsights.get(item.itemKey) || {};
      return [
      escapeMarkdownTable(item.title || item.itemKey),
      escapeMarkdownTable(item.year),
      escapeMarkdownTable(insight.method || labels.pendingInsight),
      escapeMarkdownTable(insight.dataScenario || labels.pendingInsight),
      escapeMarkdownTable(insight.metrics || labels.pendingInsight),
      escapeMarkdownTable(item.summaryPath)
      ].join(" | ");
    })
    .map((row) => `| ${row} |`)
    .join("\n") || "|  |  |  |  |  |  |";
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.methodMatrix}`,
    "",
    labels.methodMatrixNote,
    "",
    "| Paper | Year | Method | Data / Scenario | Metrics | Summary |",
    "| --- | --- | --- | --- | --- | --- |",
    rows,
    ""
  ].join("\n");
}

function renderResearchQuestionCards(collectionContext, results, outputLanguage = "zh-CN") {
  const labels = collectionTemplateLabels(outputLanguage);
  const sources = batchReportItems(results)
    .filter((item) => item.status === "generated" || item.status === "skipped_existing")
    .map((item) => `- ${item.title || item.itemKey} (${item.year || "n.d."})：${item.summaryPath || labels.pendingSummaryPath}`)
    .join("\n") || `- ${labels.noSummary}`;
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.researchQuestionCards}`,
    "",
    `## ${labels.cardTemplate}`,
    "",
    labels.researchQuestionTemplate,
    "",
    `## ${labels.candidateSources}`,
    "",
    sources,
    ""
  ].join("\n");
}

function renderResearchGapMatrix(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const rows = batchReportItems(results)
    .filter((item) => item.status === "generated" || item.status === "skipped_existing")
    .map((item) => {
      const insight = summaryInsights.get(item.itemKey) || {};
      return [
      escapeMarkdownTable(item.title || item.itemKey),
      escapeMarkdownTable(item.year),
      escapeMarkdownTable(insight.limitations?.join("; ") || labels.gapMatrixPendingLimitation),
      escapeMarkdownTable(insight.missingEvidence?.join("; ") || labels.gapMatrixPendingEvidence),
      escapeMarkdownTable(insight.validationNeeds?.join("; ") || labels.gapMatrixPendingValidation),
      escapeMarkdownTable(item.summaryPath)
      ].join(" | ");
    })
    .map((row) => `| ${row} |`)
    .join("\n") || "|  |  |  |  |  |  |";
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.gapMatrix}`,
    "",
    labels.gapMatrixNote,
    "",
    `| ${labels.paperColumn} | ${labels.yearColumn} | ${labels.limitationColumn} | ${labels.missingEvidenceColumn} | ${labels.validationColumn} | ${labels.summaryColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    rows,
    ""
  ].join("\n");
}

function renderIdeaList(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const generatedItems = batchReportItems(results).filter((item) => item.status === "generated" || item.status === "skipped_existing");
  const ideas = generatedItems.map((item, index) => {
    const insight = summaryInsights.get(item.itemKey) || {};
    const candidateIdea = insight.ideas?.[0] || labels.pendingInsight;
    const existingEvidence = insight.evidence || item.summaryPath || labels.pendingSummaryPath;
    const missingEvidence = insight.missingEvidence?.[0] || labels.gapMatrixPendingEvidence;
    const minimalExperiment = insight.validationNeeds?.[0] || labels.gapMatrixPendingValidation;
    const rejectCondition = insight.rejectConditions?.[0] || labels.pendingRejectCondition;
    return [
      `## ${labels.idea} ${index + 1}`,
    "",
    `- ${labels.seedPaper}: ${item.title || item.itemKey} (${item.year || "n.d."})`,
    `- ${labels.summaryColumn}: ${item.summaryPath || labels.pendingSummaryPath}`,
      `- ${labels.candidateIdea}: ${candidateIdea}`,
      `- ${labels.existingEvidence}: ${existingEvidence}`,
      `- ${labels.missingEvidenceItem}: ${missingEvidence}`,
      `- ${labels.minimalExperiment}: ${minimalExperiment}`,
      `- ${labels.rejectCondition}: ${rejectCondition}`
    ].join("\n");
  }).join("\n\n") || `- ${labels.noSummary}`;
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.ideaList}`,
    "",
    labels.ideaListNote,
    "",
    ideas,
    ""
  ].join("\n");
}

function renderManualReviewDraft(collectionContext, results, outputLanguage = "zh-CN") {
  const labels = collectionTemplateLabels(outputLanguage);
  const stats = batchStats(results);
  const generatedItems = batchReportItems(results).filter((item) => item.status === "generated" || item.status === "skipped_existing");
  const bullets = generatedItems
    .map((item) => `- ${item.title || item.itemKey} (${item.year || "n.d."})：${item.summaryPath || labels.pendingSummaryPath}`)
    .join("\n") || `- ${labels.noSummary}`;
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.reviewDraft}`,
    "",
    `## ${labels.scope}`,
    "",
    labels.statsLine(stats),
    "",
    `## ${labels.availableSummaries}`,
    "",
    bullets,
    "",
    `## ${labels.methodSignals}`,
    "",
    labels.methodSignalTodo,
    "",
    `## ${labels.researchGaps}`,
    "",
    labels.gapTodo,
    "",
    `## ${labels.nextSteps}`,
    "",
    labels.nextStepTodos,
    ""
  ].join("\n");
}

function collectionOutputLanguage(settings) {
  const language = String(settings?.outputLanguage || "zh-CN");
  if (language === "en-US" || language === "ja-JP") return language;
  return "zh-CN";
}

function collectionTemplateLabels(outputLanguage) {
  if (outputLanguage === "en-US") {
    return {
      paperNotes: "Paper Notes",
      methodMatrix: "Method Matrix",
      methodMatrixNote: "Use this matrix to manually consolidate methods, data, metrics, and limitations after single-paper summaries are available.",
      gapMatrix: "Research Gap Matrix",
      gapMatrixNote: "Use this matrix to consolidate limitations, missing evidence, and validation needs before moving claims into writing.",
      gapMatrixPendingLimitation: "Pending limitation extraction",
      gapMatrixPendingEvidence: "Pending missing-evidence extraction",
      gapMatrixPendingValidation: "Pending validation design",
      pendingInsight: "Pending extraction from single-paper summary",
      pendingRejectCondition: "Pending falsification condition",
      paperColumn: "Paper",
      yearColumn: "Year",
      limitationColumn: "Observed Limitation",
      missingEvidenceColumn: "Missing Evidence",
      validationColumn: "Validation Need",
      summaryColumn: "Summary",
      researchQuestionCards: "Research Question Cards",
      cardTemplate: "Card Template",
      researchQuestionTemplate: [
        "- Question:",
        "- Existing evidence:",
        "- Missing evidence:",
        "- Supporting findings:",
        "- Falsifying findings:",
        "- Minimum next action:"
      ].join("\n"),
      candidateSources: "Candidate Sources",
      pendingSummaryPath: "summary path pending",
      noSummary: "No single-paper summary is available for review yet.",
      reviewDraft: "Manual Review Draft",
      ideaList: "Idea List",
      ideaListNote: "Use this list to turn evidence-backed gaps into concrete research ideas. Keep speculative ideas marked until evidence is added.",
      idea: "Idea",
      seedPaper: "Seed paper",
      candidateIdea: "Candidate idea",
      existingEvidence: "Existing evidence",
      missingEvidenceItem: "Missing evidence",
      minimalExperiment: "Minimal experiment or check",
      rejectCondition: "Reject condition",
      ideaTemplate: [
        "- Candidate idea:",
        "- Existing evidence:",
        "- Missing evidence:",
        "- Minimal experiment or check:",
        "- Reject condition:"
      ].join("\n"),
      scope: "Scope",
      statsLine: (stats) => `This draft is based on the current collection batch run. Total ${stats.total}, generated ${stats.generated}, existing ${stats.skippedExisting}, skipped without PDF ${stats.skippedNoPdf}, failed ${stats.failed}.`,
      availableSummaries: "Available Single-Paper Summaries",
      methodSignals: "Method Signals",
      methodSignalTodo: "- Consolidate major method categories from `../knowledge/method-matrix.md`.",
      researchGaps: "Research Gaps",
      gapTodo: "- Synthesize limitations and low-confidence notes from single-paper summaries.",
      nextSteps: "Next Steps",
      nextStepTodos: [
        "- Fill Method, Data / Scenario, and Metrics in the method matrix.",
        "- Move evidence-backed cross-paper claims into the formal review draft."
      ].join("\n")
    };
  }
  if (outputLanguage === "ja-JP") {
    return {
      paperNotes: "論文ノート",
      methodMatrix: "手法マトリクス",
      methodMatrixNote: "単一論文の要約が揃った後、手法、データ、評価指標、限界を手動で統合するためのマトリクスです。",
      gapMatrix: "研究ギャップマトリクス",
      gapMatrixNote: "執筆に入る前に、限界、不足している証拠、検証ニーズを整理するためのマトリクスです。",
      gapMatrixPendingLimitation: "限界の抽出待ち",
      gapMatrixPendingEvidence: "不足証拠の抽出待ち",
      gapMatrixPendingValidation: "検証設計待ち",
      pendingInsight: "単一論文要約からの抽出待ち",
      pendingRejectCondition: "棄却条件の抽出待ち",
      paperColumn: "論文",
      yearColumn: "年",
      limitationColumn: "観察された限界",
      missingEvidenceColumn: "不足している証拠",
      validationColumn: "検証ニーズ",
      summaryColumn: "要約",
      researchQuestionCards: "研究課題カード",
      cardTemplate: "カードテンプレート",
      researchQuestionTemplate: [
        "- 問い:",
        "- 既存の証拠:",
        "- 不足している証拠:",
        "- 支持する結果:",
        "- 反証になり得る結果:",
        "- 最小の次アクション:"
      ].join("\n"),
      candidateSources: "候補ソース",
      pendingSummaryPath: "要約パス未設定",
      noSummary: "レビューに使える単一論文要約はまだありません。",
      reviewDraft: "手動レビュー草稿",
      ideaList: "アイデアリスト",
      ideaListNote: "証拠に基づくギャップを具体的な研究アイデアへ変換するためのリストです。証拠が不足するアイデアは仮説として扱います。",
      idea: "アイデア",
      seedPaper: "起点論文",
      candidateIdea: "候補アイデア",
      existingEvidence: "既存の証拠",
      missingEvidenceItem: "不足している証拠",
      minimalExperiment: "最小実験または確認",
      rejectCondition: "棄却条件",
      ideaTemplate: [
        "- 候補アイデア:",
        "- 既存の証拠:",
        "- 不足している証拠:",
        "- 最小実験または確認:",
        "- 棄却条件:"
      ].join("\n"),
      scope: "範囲",
      statsLine: (stats) => `この草稿は現在の collection のバッチ実行結果に基づきます。合計 ${stats.total} 件、生成 ${stats.generated} 件、既存 ${stats.skippedExisting} 件、PDF なしでスキップ ${stats.skippedNoPdf} 件、失敗 ${stats.failed} 件。`,
      availableSummaries: "利用可能な単一論文要約",
      methodSignals: "手法の手がかり",
      methodSignalTodo: "- `../knowledge/method-matrix.md` から主要な手法カテゴリを整理する。",
      researchGaps: "研究ギャップ",
      gapTodo: "- 単一論文要約の限界と低信頼メモを統合する。",
      nextSteps: "次のステップ",
      nextStepTodos: [
        "- 手法マトリクスの Method、Data / Scenario、Metrics を補完する。",
        "- 証拠に支えられた横断的な主張を正式なレビュー草稿へ移す。"
      ].join("\n")
    };
  }
  return {
    paperNotes: "论文笔记",
    methodMatrix: "方法矩阵",
    methodMatrixNote: "此矩阵用于在单篇总结完成后手动汇总方法、数据、指标和局限。",
    gapMatrix: "研究空白矩阵",
    gapMatrixNote: "此矩阵用于在进入写作前整理局限、缺失证据和验证需求。",
    gapMatrixPendingLimitation: "待抽取局限",
    gapMatrixPendingEvidence: "待抽取缺失证据",
    gapMatrixPendingValidation: "待设计验证",
    pendingInsight: "待从单篇总结抽取",
    pendingRejectCondition: "待抽取推翻条件",
    paperColumn: "论文",
    yearColumn: "年份",
    limitationColumn: "已观察局限",
    missingEvidenceColumn: "缺失证据",
    validationColumn: "验证需求",
    summaryColumn: "总结",
    researchQuestionCards: "研究问题卡",
    cardTemplate: "卡片模板",
    researchQuestionTemplate: [
      "- 问题：",
      "- 现有证据：",
      "- 缺失证据：",
      "- 支持它的结果：",
      "- 可推翻它的结果：",
      "- 最小下一步动作："
    ].join("\n"),
    candidateSources: "候选来源",
    pendingSummaryPath: "待补充总结路径",
    noSummary: "暂无可用于综述的单篇总结。",
    reviewDraft: "手动综述草稿",
    ideaList: "研究想法列表",
    ideaListNote: "此列表用于把有证据支撑的空白转成可执行研究想法；证据不足的想法先保留为假设。",
    idea: "想法",
    seedPaper: "起点论文",
    candidateIdea: "候选想法",
    existingEvidence: "现有证据",
    missingEvidenceItem: "缺失证据",
    minimalExperiment: "最小实验或检查",
    rejectCondition: "推翻条件",
    ideaTemplate: [
      "- 候选想法：",
      "- 现有证据：",
      "- 缺失证据：",
      "- 最小实验或检查：",
      "- 推翻条件："
    ].join("\n"),
    scope: "范围",
    statsLine: (stats) => `本草稿基于当前 collection 的批量运行结果生成。总计 ${stats.total} 篇，已生成 ${stats.generated} 篇，已存在 ${stats.skippedExisting} 篇，无 PDF 跳过 ${stats.skippedNoPdf} 篇，失败 ${stats.failed} 篇。`,
    availableSummaries: "已有单篇总结",
    methodSignals: "方法线索",
    methodSignalTodo: "- 待从 `../knowledge/method-matrix.md` 汇总主要方法类别。",
    researchGaps: "研究空白",
    gapTodo: "- 待结合单篇总结中的局限和低置信度标记整理。",
    nextSteps: "下一步",
    nextStepTodos: [
      "- 补全方法矩阵中的 Method、Data / Scenario、Metrics 字段。",
      "- 将有证据支持的共性结论迁移到正式综述正文。"
    ].join("\n")
  };
}

function escapeMarkdownTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

async function writeBatchRunReport(settings, collectionContext, results, options = {}) {
  const now = options.now || new Date().toISOString();
  const reportPath = PathUtils.join(settings.outputDir, "batch-runs", `batch-${now.replace(/[:.]/g, "-")}.json`);
  await writeText(reportPath, JSON.stringify(batchRunReportPayload(settings, collectionContext, results, {
    force: !!options.force,
    generatedAt: now
  }), null, 2));
  return reportPath;
}

function batchRunReportPayload(settings, collectionContext, results, options = {}) {
  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    force: !!options.force,
    outputLanguage: settings.outputLanguage || "zh-CN",
    summaryVersion: settings.summaryVersion || "1",
    outputDir: settings.outputDir,
    collection: collectionContext ? {
      key: collectionContext.key,
      name: collectionContext.name,
      type: collectionContext.type,
      parentLibraryID: collectionContext.parentLibraryID
    } : null,
    stats: batchStats(results),
    items: batchReportItems(results)
  };
}

function batchReportItems(results) {
  return (results || [])
    .filter((item) => item)
    .map((item) => ({
      status: item.status,
      itemKey: item.itemKey,
      title: item.title,
      year: item.year,
      pdfKey: item.pdfKey || "",
      summaryPath: item.summaryPath || "",
      provider: item.provider || "",
      model: item.model || "",
      sourceHash: item.sourceHash || "",
      error: item.error || "",
      updatedAt: item.updatedAt || ""
    }));
}

function batchStats(results) {
  const stats = {
    total: 0,
    generated: 0,
    skippedNoPdf: 0,
    skippedExisting: 0,
    failed: 0
  };
  for (const item of results || []) {
    if (!item) continue;
    stats.total++;
    if (item.status === "generated") stats.generated++;
    else if (item.status === "skipped_no_pdf") stats.skippedNoPdf++;
    else if (item.status === "skipped_existing") stats.skippedExisting++;
    else if (item.status === "failed") stats.failed++;
  }
  return stats;
}

function objectKeyCount(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function isLocalAgentProfile(profile) {
  return !!localAgentRawConfig(profile);
}

function settingsRequiresModel(settings) {
  return !isLocalAgentProfile(settings);
}

function localAgentRawConfig(profile) {
  return profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent || null;
}

function localAgentEndpointForProfile(profile) {
  const raw = localAgentRawConfig(profile);
  if (typeof raw === "string") return normalizeLocalAgentEndpoint(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.enabled === false) return "";
  return normalizeLocalAgentEndpoint(raw.endpoint || raw.url || raw.mcpUrl || raw.baseUrl);
}

function normalizeLocalAgentEndpoint(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:localhost|127\.0\.0\.1):\d+(?:\/|$)/.test(value)) return `http://${value}`;
  if (value.startsWith("/")) return value;
  return "";
}

function toFinitePositiveInt(...values) {
  for (const value of values) {
    const normalized = Number(value);
    if (Number.isFinite(normalized) && normalized > 0) return Math.round(normalized);
  }
  return null;
}

async function checkLocalAgentBridge(endpoint) {
  if (!endpoint) return { ok: false, label: t("selfCheckMissing") };
  if (typeof fetch !== "function") return { ok: false, label: "fetch unavailable" };
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 2000) : null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "self-check",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "zotero-markdown-summary", version: "0.1.1" }
        }
      }),
      ...(controller ? { signal: controller.signal } : {})
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, label: `HTTP ${response.status}` };
    const payload = safeParseJSON(text);
    if (payload?.error) return { ok: false, label: payload.error.message || "MCP error" };
    const serverName = payload?.result?.serverInfo?.name || payload?.result?.serverInfo?.title || "";
    return { ok: true, label: serverName || t("selfCheckOk") };
  } catch (err) {
    return { ok: false, label: safeError(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function yesNo(value) {
  return value ? t("selfCheckYes") : t("selfCheckNo");
}

function reportLine(label, value, ok) {
  const status = typeof ok === "boolean" ? ` [${ok ? t("selfCheckOk") : t("selfCheckMissing")}]` : "";
  return `- ${label}: ${String(value ?? "")}${status}`;
}

function profileEndpoint(profile, settings) {
  if (profile?.endpointMode === "full_url") return profile.fullURL || profile.baseURL || "";
  const baseURL = profile?.baseURL || settings.baseURL || "";
  if (!baseURL) return "";
  const protocol = profile?.protocol || settings.protocol || "openai_chat";
  return endpointForProtocol(protocol, baseURL);
}

function joinURL(baseURL, path) {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function leafName(path) {
  const slashIndex = Math.max(String(path).lastIndexOf("/"), String(path).lastIndexOf("\\"));
  return slashIndex === -1 ? String(path) : String(path).slice(slashIndex + 1);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function sanitizeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function redact(value) {
  return String(value).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]").slice(0, 800);
}

function providerErrorText(status, text) {
  return `HTTP ${status}: ${redact(providerErrorDetail(text))}`;
}

function providerErrorDetail(text) {
  const parsed = safeParseJSON(text);
  if (parsed) {
    const error = parsed.error;
    if (typeof error === "string") return error;
    const message = error?.message || parsed.message || parsed.detail || parsed.error_description;
    const code = error?.code || parsed.code;
    const type = error?.type || parsed.type;
    const detail = [code, type, message].filter(Boolean).join(" - ");
    if (detail) return detail;
    return truncateErrorText(JSON.stringify(parsed));
  }
  return truncateErrorText(String(text || "").replace(/\s+/g, " ").trim() || "Request failed");
}

function truncateErrorText(text, limit = 1200) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function stripThink(value) {
  return value.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function safeError(err) {
  return redact(err?.message || err || "未知错误");
}

function t(key) {
  const lang = resolveUiLanguage(typeof pref === "function" ? pref("uiLanguage") : "auto", runtimeLocale());
  return UI_MESSAGES?.[lang]?.bootstrap?.[key]
    || UI_MESSAGES?.[lang]?.[key]
    || UI_MESSAGES?.["en-US"]?.bootstrap?.[key]
    || UI_MESSAGES?.["en-US"]?.[key]
    || key;
}

function resolveUiLanguage(setting, locale) {
  if (typeof zmsResolveUiLanguage === "function") return zmsResolveUiLanguage(setting, locale);
  if (setting === "zh-CN" || setting === "en-US") return setting;
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function loadSharedMessages() {
  if (typeof ZMS_I18N !== "undefined") {
    UI_MESSAGES = ZMS_I18N || {};
    return;
  }
  if (rootURI && typeof Services?.scriptloader?.loadSubScript === "function") {
    try {
      Services.scriptloader.loadSubScript(`${rootURI}content/messages.js`);
    } catch (_err) {
      // Keep fallback message keys if script loading fails.
    }
  }
  if (typeof ZMS_I18N !== "undefined") {
    UI_MESSAGES = ZMS_I18N || {};
  }
}

function loadBootstrapProviderModule() {
  if (typeof extractOpenAIText === "function" && typeof endpointForProtocol === "function") return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  Services.scriptloader.loadSubScript(`${rootURI}content/bootstrap-provider.js`);
}

function loadBootstrapSettingsModule() {
  if (typeof getSettings === "function" && typeof settingsHasUsableAuth === "function") return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  Services.scriptloader.loadSubScript(`${rootURI}content/bootstrap-settings.js`);
}

function loadBootstrapSummaryStoreModule() {
  if (typeof writeSummaryMarkdown === "function" && typeof pathExists === "function") return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  Services.scriptloader.loadSubScript(`${rootURI}content/bootstrap-summary-store.js`);
}

function loadBootstrapZoteroItemModule() {
  if (typeof findPdfAttachment === "function" && typeof selectedRegularItems === "function") return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  Services.scriptloader.loadSubScript(`${rootURI}content/bootstrap-zotero-item.js`);
}

function loadBootstrapUiModule() {
  if (typeof openEmbeddedWorkbench === "function" && typeof menuItem === "function") return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  Services.scriptloader.loadSubScript(`${rootURI}content/bootstrap-ui.js`);
}

function runtimeLocale() {
  try {
    return Services.locale.appLocaleAsBCP47 || Services.locale.requestedLocale || "";
  } catch (_err) {
    return "";
  }
}
