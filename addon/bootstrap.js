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
const ITEM_PANE_SECTION_ID = "zotero-markdown-summary-workbench-section";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const SYSTEM_PROMPT = "你是学术论文阅读助手，输出中文 Markdown 摘要。";
const USER_PROMPT = "请按研究问题、方法、实验、结论、局限、可借鉴点总结。";
const PROVIDER_RETRY_DELAY_MAX_MS = 10000;
const PROMPT_PACK_IDS = ["general", "ai-ml", "transportation", "biomedicine", "social-science", "review-writing"];
var UI_MESSAGES = typeof ZMS_I18N === "undefined" ? {} : ZMS_I18N;

async function startup({ id, rootURI: startupRootURI }) {
  pluginID = id;
  rootURI = startupRootURI;
  await Zotero.initializationPromise;
  await Zotero.unlockPromise;
  await Zotero.uiReadyPromise;
  loadSharedMessages();
  loadAutoUpdatePolicyModule();
  loadProviderModelCatalog();
  loadCandidateSourcesModule();
  loadBootstrapProviderModule();
  loadBootstrapSettingsModule();
  loadBootstrapSummaryStoreModule();
  loadBootstrapZoteroItemModule();
  loadBootstrapUiModule();
  registerChrome();
  preferencePaneID = await registerPreferencePane();
  registerMenus();
  registerItemPaneSection();
  registerToolbarButtons();
  registerSidenavButtons();
  installMainWindowObserver();
  await applyConfiguredAddonAutoUpdatePolicy();
}

function shutdown() {
  uninstallMainWindowObserver();
  unregisterItemPaneSection();
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
      menuItem(t("openConversation"), (event, context) => openWorkbenchForContext(context), { requireWorkbenchItems: true }),
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
      menuItem(t("collectionReview"), () => generateCollectionReview(false), { disableWithoutCollection: true }),
      menuItem(t("collectionReviewUpdate"), () => generateCollectionReview(true), { disableWithoutCollection: true }),
      menuItem(t("settings"), () => openPreferences())
    ]
  }));
  try {
    registeredMenus.push(Zotero.MenuManager.registerMenu({
      pluginID,
      target: "main/library/collection",
      menuID: "zotero-markdown-summary-collection-actions",
      menus: [
        menuItem(t("collectionReview"), (event, context) => generateCollectionReview(false, context), { requireCollection: true }),
        menuItem(t("collectionReviewUpdate"), (event, context) => generateCollectionReview(true, context), { requireCollection: true })
      ]
    }));
  } catch (err) {
    Zotero.debug(`[Markdown Summary] Failed to register collection menu: ${safeError(err)}`);
  }
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
  const itemPaneEntryRegistered = typeof registeredItemPaneSectionID !== "undefined" && !!registeredItemPaneSectionID;
  lines.push(reportLine(t("selfCheckItemPane"), yesNo(itemPaneEntryRegistered), itemPaneEntryRegistered));
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

async function generateCollectionReview(force, context) {
  const pane = Zotero.getActiveZoteroPane?.();
  const collection = collectionFromContext(context, pane);
  if (!collection) {
    showAlert(t("collectionReviewNoCollection"));
    return;
  }
  const items = await currentListRegularItems(collection);
  const collectionContext = collectionContextFromItem(collection, pane);
  await batchGenerateItems(items, force, collectionContext);
}

function collectionFromContext(context, pane = Zotero.getActiveZoteroPane?.()) {
  const direct = context?.collection || context?.target?.collection;
  if (direct) return direct;
  const fromList = Array.isArray(context?.collections) ? context.collections.find(Boolean) : null;
  if (fromList) return fromList;
  const id = Number(context?.collectionID || context?.target?.collectionID || 0);
  if (id && Zotero.Collections?.get) return Zotero.Collections.get(id);
  return pane?.getSelectedCollection?.() || null;
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
    ? await writeCollectionWorkspace(settings, collectionContext, results, { modelReview: true, onlineSearch: true })
    : null;
  const linkedCollectionArtifacts = collectionContext && collectionArtifacts
    ? await linkCollectionWorkspaceMarkdownArtifacts(collectionContext, collectionArtifacts).catch((err) => {
      Zotero.debug(`[Markdown Summary] Failed to link collection artifacts: ${safeError(err)}`);
      return [];
    })
    : [];
  const papersIndexPath = collectionArtifacts?.papersIndexPath || "";
  const batchReportPath = await writeBatchRunReport(settings, collectionContext, results, { force });
  const indexMessage = papersIndexPath ? `; papers.json: ${papersIndexPath}` : "";
  const matrixMessage = collectionArtifacts?.methodMatrixPath ? `; method-matrix: ${collectionArtifacts.methodMatrixPath}` : "";
  const clusterMessage = collectionArtifacts?.topicClustersPath ? `; topic-clusters: ${collectionArtifacts.topicClustersPath}` : "";
  const synthesisMessage = collectionArtifacts?.synthesisClaimsPath ? `; synthesis-claims: ${collectionArtifacts.synthesisClaimsPath}` : "";
  const conflictMessage = collectionArtifacts?.synthesisConflictsPath ? `; synthesis-conflicts: ${collectionArtifacts.synthesisConflictsPath}` : "";
  const draftMessage = collectionArtifacts?.reviewDraftPath ? `; review-draft: ${collectionArtifacts.reviewDraftPath}` : "";
  const reviewReportMessage = collectionArtifacts?.reviewReportPath ? `; formal-report: ${collectionArtifacts.reviewReportPath}` : "";
  const searchEvidenceMessage = collectionArtifacts?.literatureSearchEvidencePath ? `; search-evidence: ${collectionArtifacts.literatureSearchEvidencePath}` : "";
  const modelReviewMessage = collectionArtifacts?.modelReviewPath ? `; model-review: ${collectionArtifacts.modelReviewPath}` : "";
  const collectionReviewMessage = collectionArtifacts?.collectionReviewPath ? `; collection-review: ${collectionArtifacts.collectionReviewPath}` : "";
  const linkedMessage = linkedCollectionArtifacts.length ? `; ${t("collectionArtifactsLinked")}: ${linkedCollectionArtifacts.length}` : "";
  const reportMessage = batchReportPath ? `; ${t("batchReport")}: ${batchReportPath}` : "";
  const skipped = skippedNoPdf + skippedExisting;
  const extraParts = [];
  if (skippedNoPdf > 0) extraParts.push(`${t("batchSkippedNoPdf")}: ${skippedNoPdf}`);
  if (skippedExisting > 0) extraParts.push(`${t("batchSkippedExisting")}: ${skippedExisting}`);
  const skippedSuffix = extraParts.length ? ` (${extraParts.join("; ")})` : "";
  showProgress(`${t("batchDone")}: ${generated}; ${t("batchSkipped")}: ${skipped}${skippedSuffix}; ${t("batchFailed")}: ${failed}${indexMessage}${matrixMessage}${clusterMessage}${synthesisMessage}${conflictMessage}${draftMessage}${reviewReportMessage}${searchEvidenceMessage}${modelReviewMessage}${collectionReviewMessage}${linkedMessage}${reportMessage}`);
}

async function generateForItem(item, settings, force) {
  const pdf = await findPdfAttachment(item);
  if (!pdf) throw new Error(t("noPdf"));
  const pdfPath = await attachmentFilePath(pdf);
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
    id: settings.id,
    name: settings.name,
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
  applyEffectiveProviderProfile(settings, result.effectiveProfile);
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
    const base64 = await pdfBase64Input(pdf, pdfPath);
    if (!base64) throw new Error(t("noPdfPath"));
    return {
      type: "pdf_base64",
      base64,
      filename: attachmentDisplayName(pdf) || "paper.pdf"
    };
  }
  const text = (await pdf.attachmentText) || "";
  if (!text.trim()) throw new Error(t("emptyText"));
  return { type: "text", text };
}

async function attachmentFilePath(attachment) {
  if (!attachment) return "";
  try {
    if (typeof attachment.getFilePathAsync === "function") return await attachment.getFilePathAsync();
  } catch (_err) {
    // Try the synchronous and direct path fallbacks below.
  }
  if (typeof attachment.getFilePath === "function") {
    try {
      return attachment.getFilePath();
    } catch (_err) {
      // Keep fallback fields.
    }
  }
  return attachment.path || attachment.filePath || attachment.attachmentPath || "";
}

function attachmentDisplayName(attachment) {
  return attachment?.getField?.("title") || attachment?.attachmentFilename || attachment?.filename || "";
}

async function pdfBase64Input(pdf, pdfPath) {
  if (pdfPath) {
    try {
      const bytes = await IOUtils.read(pdfPath);
      const encoded = pdfBytesToBase64(bytes);
      if (encoded) return encoded;
    } catch (_err) {
      // Try in-memory attachment accessors below.
    }
  }
  return attachmentPdfBase64(pdf);
}

async function attachmentPdfBase64(pdf) {
  const direct = normalizedPdfBase64(
    pdf?.pdfBase64
    || pdf?.attachmentBase64
    || pdf?.base64
    || pdf?.data
    || pdf?.dataURL
  );
  if (direct) return direct;
  const directBytes = pdfBytesToBase64(pdf?.bytes || pdf?.fileBytes || pdf?.attachmentBytes);
  if (directBytes) return directBytes;
  for (const method of ["getPdfBase64", "getBase64", "getDataURL", "getData", "getFileDataAsync", "getBytes", "getArrayBuffer"]) {
    if (typeof pdf?.[method] !== "function") continue;
    try {
      const value = await pdf[method]();
      const encoded = normalizedPdfBase64(value) || pdfBytesToBase64(value);
      if (encoded) return encoded;
    } catch (_err) {
      // Try the next accessor.
    }
  }
  for (const method of ["getBlob", "getFile", "getFileAsync"]) {
    if (typeof pdf?.[method] !== "function") continue;
    try {
      const blob = await pdf[method]();
      if (blob && typeof blob.arrayBuffer === "function") {
        const encoded = pdfBytesToBase64(await blob.arrayBuffer());
        if (encoded) return encoded;
      }
    } catch (_err) {
      // Try the next accessor.
    }
  }
  return "";
}

function normalizedPdfBase64(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/^data:application\/pdf[^,]*,/i, "").trim();
  if (!text || !/^[A-Za-z0-9+/=\r\n]+$/.test(text)) return "";
  return text.replace(/\s+/g, "");
}

function pdfBytesToBase64(value) {
  if (!value) return "";
  if (Array.isArray(value)) return bytesToBase64(Uint8Array.from(value));
  if (typeof ArrayBuffer !== "undefined") {
    if (typeof ArrayBuffer.isView === "function" && ArrayBuffer.isView(value)) {
      return bytesToBase64(new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.length || 0));
    }
    if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
      return bytesToBase64(new Uint8Array(value));
    }
  }
  return "";
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
  const hasImages = requestInputImages(request.input).length > 0;
  if (hasImages && summaryRequest.capabilities?.imageBase64 !== true) {
    throw new Error("当前接口档案不支持图片输入");
  }
  const useResponses = summaryRequest.protocol === "openai_responses" || isPdf;
  if (isPdf && summaryRequest.protocol !== "openai_responses") {
    throw new Error("当前兼容接口不支持 PDF base64 输入");
  }
  const protocol = useResponses ? "openai_responses" : "openai_chat";
  const url = endpointMode === "full_url" ? (fullURL || baseURL) : endpointForProtocol(protocol, baseURL);
  const responsesInstructionsInUser = isTrueValue(bodyExtra?.instructionsFallbackToUser);
  const body = useResponses ? {
    model,
    ...(responsesInstructionsInUser ? {} : { instructions: request.system }),
    input: openaiResponsesInputForSummary(request, summaryRequest, responsesInstructionsInUser ? request.system : ""),
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    stream: request.stream
  } : {
    model,
    messages: openAIChatSummaryMessages(request, summaryRequest),
    ...openAIChatOptionalDefaults(summaryRequest, {
      temperature: request.temperature,
      n: 1
    }),
    ...openAIChatTokenLimit(summaryRequest, request.maxOutputTokens),
    stream: request.stream
  };
  const merged = useResponses ? withProviderBodyDefaults(summaryRequest, body) : withOpenAIChatBodyDefaults(summaryRequest, body);
  if (summaryRequest.provider === "minimax" && merged.extra_body === undefined && !providerBodyOmitFields(bodyExtra).has("extra_body")) {
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
  const data = await requestJSON(url, withoutBlankHeaders(headers), merged, merged.stream === true, summaryRequest.protocol || protocol, summaryRequest);
  const effectiveProfile = persistBootstrapProviderCompatibilityFallback(summaryRequest, data);
  return {
    markdown: extractOpenAIText(data),
    usage: providerUsageFromResponse(data),
    provider: summaryRequest.provider,
    model,
    sourceHash,
    effectiveProfile: effectiveProfile || data?.zmsEffectiveProfile || null
  };
}

async function callAnthropic(summaryRequest, sourceHash) {
  const { baseURL, fullURL, endpointMode = "base_url", customHeaders = {}, bodyExtra = {}, apiKey, model, request } = summaryRequest;
  const content = [];
  const images = shouldOmitAnthropicImage(summaryRequest) ? [] : requestInputImages(request.input);
  if (images.length && summaryRequest.capabilities?.imageBase64 !== true) {
    throw new Error("当前接口档案不支持图片输入");
  }
  for (const image of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType || "image/png",
        data: image.base64 || ""
      }
    });
  }
  if (request.input.type === "pdf_base64" && !shouldOmitAnthropicDocument(summaryRequest)) {
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
    text: [
      isTrueValue(bodyExtra?.systemFallbackToUser) ? fallbackSystemText(request.system) : "",
      request.input.type === "text" ? `${request.prompt}\n\n${request.input.text}` : request.prompt
    ].filter(Boolean).join("\n\n")
  });
  const headers = {
    "content-type": "application/json",
    ...customHeaders
  };
  if (!hasExplicitAuthHeader(headers)) {
    const authHeader = anthropicAuthHeaderName(summaryRequest);
    setHeaderIfMissing(headers, authHeader, authHeader === "authorization" && apiKey ? `Bearer ${apiKey}` : apiKey);
  }
  if (!shouldOmitAnthropicVersion(summaryRequest)) {
    setHeaderIfMissing(headers, "anthropic-version", "2023-06-01");
  }
  if (shouldAddAnthropicDirectBrowserAccess(summaryRequest)) {
    setHeaderIfMissing(headers, "anthropic-dangerous-direct-browser-access", "true");
  }
  const messageUrl = endpointMode === "full_url" ? (fullURL || baseURL) : endpointForProtocol("anthropic_messages", baseURL);
  const merged = withProviderBodyDefaults(summaryRequest, {
    model,
    ...(isTrueValue(bodyExtra?.systemFallbackToUser) ? {} : { system: request.system }),
    messages: [{ role: "user", content }],
    max_tokens: request.maxOutputTokens,
    stream: request.stream
  });
  const data = await requestJSON(messageUrl, withoutBlankHeaders(headers), merged, merged.stream === true, "anthropic_messages", summaryRequest);
  const effectiveProfile = persistBootstrapProviderCompatibilityFallback(summaryRequest, data);
  return {
    markdown: extractAnthropicText(data),
    usage: providerUsageFromResponse(data),
    provider: summaryRequest.provider,
    model,
    sourceHash,
    effectiveProfile: effectiveProfile || data?.zmsEffectiveProfile || null
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
  const markdown = stripThink(localAgentTextFromResponse(payload));
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

async function requestJSON(url, headers, body, stream, protocol = "openai_chat", profile = null) {
  let lastError;
  let requestBody = body;
  let requestHeaders = headers;
  let requestStream = stream;
  let usedCompatibilityFallbackFields = [];
  let effectiveProfile = profile ? normalizeBootstrapProviderProfile(profile) : null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        const text = await response.text();
        const fallbackFields = providerCompatibilityFallbackFields(protocol, requestBody, response.status, text, usedCompatibilityFallbackFields);
        if (fallbackFields.length && attempt < 3) {
          effectiveProfile = profileWithBootstrapProviderConnectionFallback(effectiveProfile || profile, requestBody, fallbackFields, usedCompatibilityFallbackFields);
          requestBody = omitProviderRequestBodyFields(requestBody, fallbackFields, usedCompatibilityFallbackFields);
          requestHeaders = providerRequestHeadersWithFallback(requestHeaders, fallbackFields);
          requestStream = requestBody.stream === true;
          usedCompatibilityFallbackFields = Array.from(new Set([...usedCompatibilityFallbackFields, ...fallbackFields]));
          continue;
        }
        const error = providerHTTPError(response.status, text, response.headers);
        if (error.retryableProviderError && attempt < 3) {
          await Zotero.Promise.delay(providerRetryDelayMs(error, attempt));
          continue;
        }
        throw error;
      }
      if (shouldInspectBootstrapOkResponse(response, requestStream)) {
        const text = await response.text();
        const fallbackFields = providerCompatibilityFallbackFields(protocol, requestBody, response.status, text, usedCompatibilityFallbackFields);
        if (fallbackFields.length && attempt < 3) {
          effectiveProfile = profileWithBootstrapProviderConnectionFallback(effectiveProfile || profile, requestBody, fallbackFields, usedCompatibilityFallbackFields);
          requestBody = omitProviderRequestBodyFields(requestBody, fallbackFields, usedCompatibilityFallbackFields);
          requestHeaders = providerRequestHeadersWithFallback(requestHeaders, fallbackFields);
          requestStream = requestBody.stream === true;
          usedCompatibilityFallbackFields = Array.from(new Set([...usedCompatibilityFallbackFields, ...fallbackFields]));
          continue;
        }
        const data = safeParseJSON(text);
        if (data) return attachBootstrapCompatibilityFallback(data, effectiveProfile, usedCompatibilityFallbackFields);
        return attachBootstrapCompatibilityFallback(JSON.parse(text), effectiveProfile, usedCompatibilityFallbackFields);
      }
      if (requestStream && response.body) {
        return attachBootstrapCompatibilityFallback(await readProviderStream(response, protocol), effectiveProfile, usedCompatibilityFallbackFields);
      }
      return attachBootstrapCompatibilityFallback(await response.json(), effectiveProfile, usedCompatibilityFallbackFields);
    } catch (err) {
      if (err?.retryableProviderError === false) throw err;
      lastError = err;
      if (attempt < 3) {
        await Zotero.Promise.delay(providerRetryDelayMs(err, attempt));
        continue;
      }
    }
  }
  throw lastError;
}

function attachBootstrapCompatibilityFallback(data, effectiveProfile, fields) {
  const normalizedFields = normalizeProviderFallbackFieldList(fields);
  if (data && typeof data === "object") {
    if (effectiveProfile) data.zmsEffectiveProfile = effectiveProfile;
    if (normalizedFields.length) data.zmsCompatibilityFallbackFields = normalizedFields;
  }
  return data;
}

function persistBootstrapProviderCompatibilityFallback(summaryRequest, data) {
  const fields = normalizeProviderFallbackFieldList(data?.zmsCompatibilityFallbackFields);
  if (!fields.length || !data?.zmsEffectiveProfile || isLocalAgentProfile(summaryRequest)) return null;
  if (typeof persistSettingsActiveProfile !== "function") return null;
  return persistSettingsActiveProfile(data.zmsEffectiveProfile);
}

function applyEffectiveProviderProfile(settings, effectiveProfile) {
  if (!settings || !effectiveProfile) return;
  if (effectiveProfile.bodyExtra && typeof effectiveProfile.bodyExtra === "object") {
    settings.bodyExtra = effectiveProfile.bodyExtra;
  }
  if (effectiveProfile.capabilities && typeof effectiveProfile.capabilities === "object") {
    settings.capabilities = effectiveProfile.capabilities;
  }
}

function profileWithBootstrapProviderConnectionFallback(profile, body, fields, usedFallback = []) {
  const normalizedFields = normalizeProviderFallbackFieldList(fields);
  const base = normalizeBootstrapProviderProfile({
    ...(profile || {}),
    bodyExtra: mergeProviderFallbackBodyExtra(profile?.bodyExtra, body, normalizedFields, usedFallback)
  });
  return profileWithBootstrapProviderCompatibilityFallback(profile, base, normalizedFields);
}

function profileWithBootstrapProviderCompatibilityFallback(currentProfile, effectiveProfile, fields) {
  const normalizedFields = normalizeProviderFallbackFieldList(fields);
  const base = normalizeBootstrapProviderProfile({
    ...(currentProfile || {}),
    ...(effectiveProfile || {}),
    id: effectiveProfile?.id || currentProfile?.id,
    isDefault: currentProfile?.isDefault !== false
  });
  const downgrades = providerCapabilityDowngradesFromFallback(base, normalizedFields);
  if (!Object.keys(downgrades).length) return base;
  return normalizeBootstrapProviderProfile({
    ...base,
    capabilities: {
      ...(base.capabilities || {}),
      ...downgrades
    }
  });
}

function providerCapabilityDowngradesFromFallback(profile, fields) {
  const fieldSet = new Set(normalizeProviderFallbackFieldList(fields));
  const downgrades = {};
  if (
    fieldSet.has("messages.content.image_url")
    || fieldSet.has("input.content.input_image")
    || fieldSet.has("messages.content.image")
  ) {
    downgrades.imageBase64 = false;
  }
  if (
    fieldSet.has("messages.content.document")
    || (fieldSet.has("input_file.file_data") && fieldSet.has("input_file.file_url"))
    || isTrueValue(profile?.bodyExtra?.omitPdfInputFile)
  ) {
    downgrades.pdfBase64 = false;
  }
  if (fieldSet.has("stream")) {
    downgrades.streaming = false;
  }
  return downgrades;
}

function normalizeProviderFallbackFieldList(fields) {
  return Array.from(new Set((Array.isArray(fields) ? fields : [])
    .map((field) => String(field || "").trim())
    .filter(Boolean)));
}

function mergeProviderFallbackBodyExtra(bodyExtra, body, fields, usedFallback = []) {
  const nextExtra = { ...(bodyExtra || {}) };
  const omitFields = [...fields];
  const usedFields = new Set(Array.isArray(usedFallback) ? usedFallback : []);
  if (fields.includes("instructions") && body?.instructions !== undefined) {
    nextExtra.instructionsFallbackToUser = true;
  }
  if (fields.includes("system") && body?.system !== undefined) {
    nextExtra.systemFallbackToUser = true;
  }
  if (fields.includes("messages.role.system") && openAIChatHasSystemMessage(body)) {
    nextExtra.systemFallbackToUser = true;
    removeFromArray(omitFields, "messages.role.system");
  }
  if (fields.includes("max_completion_tokens") && !usedFields.has("max_tokens") && body?.max_completion_tokens !== undefined && body?.max_tokens === undefined) {
    nextExtra.tokenLimitField = "max_tokens";
    removeFromArray(omitFields, "max_completion_tokens");
  }
  if (fields.includes("max_tokens") && !usedFields.has("max_completion_tokens") && body?.max_tokens !== undefined && body?.max_completion_tokens === undefined) {
    nextExtra.tokenLimitField = "max_completion_tokens";
    removeFromArray(omitFields, "max_tokens");
  }
  if (fields.includes("input_file.file_data")) {
    if (usedFields.has("input_file.file_url")) nextExtra.omitPdfInputFile = true;
    else nextExtra.pdfInputFileField = "file_url";
    removeFromArray(omitFields, "input_file.file_data");
  }
  if (fields.includes("input_file.file_url")) {
    if (usedFields.has("input_file.file_data")) nextExtra.omitPdfInputFile = true;
    else nextExtra.pdfInputFileField = "file_data";
    removeFromArray(omitFields, "input_file.file_url");
  }
  if (fields.includes("image_url.url")) {
    nextExtra.imageURLFormat = "string";
    removeFromArray(omitFields, "image_url.url");
  }
  if (fields.includes("messages.content.image_url")) {
    nextExtra.omitOpenAIChatImage = true;
    removeFromArray(omitFields, "messages.content.image_url");
  }
  if (fields.includes("input.content.input_image")) {
    nextExtra.omitOpenAIResponsesImage = true;
    removeFromArray(omitFields, "input.content.input_image");
  }
  if (fields.includes("messages.content")) {
    if (openAIChatHasArrayContent(body)) {
      nextExtra.openAIChatTextContentFormat = "string";
      if (openAIChatHasImagePart(body)) nextExtra.omitOpenAIChatImage = true;
    } else {
      nextExtra.anthropicTextContentFormat = "blocks";
    }
    removeFromArray(omitFields, "messages.content");
  }
  if (fields.includes("messages.content.document")) {
    nextExtra.omitAnthropicDocument = true;
    removeFromArray(omitFields, "messages.content.document");
  }
  if (fields.includes("messages.content.image")) {
    nextExtra.omitAnthropicImage = true;
    removeFromArray(omitFields, "messages.content.image");
  }
  const authHeader = typeof providerFallbackAuthHeaderName === "function" ? providerFallbackAuthHeaderName(fields) : "";
  if (authHeader) {
    nextExtra.authHeader = authHeader;
    removeFromArray(omitFields, "headers.authorization");
    removeFromArray(omitFields, "headers.x-api-key");
    removeFromArray(omitFields, "headers.api-key");
  }
  if (fields.includes("headers.anthropic-version")) {
    nextExtra.omitAnthropicVersion = true;
    removeFromArray(omitFields, "headers.anthropic-version");
  }
  return mergeProviderBodyOmitFields(nextExtra, omitFields);
}

function removeFromArray(values, value) {
  let index = values.indexOf(value);
  while (index >= 0) {
    values.splice(index, 1);
    index = values.indexOf(value);
  }
}

function mergeProviderBodyOmitFields(bodyExtra, fields) {
  const current = Array.from(providerBodyOmitFields(bodyExtra));
  return { ...(bodyExtra || {}), omitFields: Array.from(new Set([...current, ...fields])) };
}

function normalizeBootstrapProviderProfile(profile) {
  if (typeof normalizeSettingsProfile === "function") return normalizeSettingsProfile(profile);
  return profile || null;
}

function shouldInspectBootstrapOkResponse(response, requestedStream) {
  if (typeof response?.text !== "function") return false;
  if (!requestedStream) return true;
  const contentType = responseHeaderValue(response, "content-type").toLowerCase();
  if (!response.body) return true;
  return /json|problem\+json|text\/plain/.test(contentType);
}

function responseHeaderValue(response, name) {
  const headers = response?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const normalized = String(name || "").toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalized);
  return entry ? String(entry[1] || "") : "";
}

function providerHTTPError(status, text, headers) {
  const error = new Error(providerErrorText(status, text));
  error.retryableProviderError = status === 429 || status >= 500;
  const retryAfterMs = providerRetryAfterMs(headers);
  if (retryAfterMs != null) {
    error.providerRetryAfterMs = retryAfterMs;
  }
  return error;
}

function providerRetryDelayMs(error, attempt) {
  const headerDelay = clampProviderRetryDelayMs(error?.providerRetryAfterMs);
  if (headerDelay != null) return headerDelay;
  return clampProviderRetryDelayMs(500 * 2 ** attempt) || 0;
}

function providerRetryAfterMs(headers) {
  const retryAfterMs = numericProviderHeaderMs(
    responseHeaderMapValue(headers, "retry-after-ms")
      || responseHeaderMapValue(headers, "x-retry-after-ms")
  );
  if (retryAfterMs != null) return retryAfterMs;

  const retryAfter = responseHeaderMapValue(headers, "retry-after");
  if (retryAfter) {
    const numericSeconds = Number(String(retryAfter).trim());
    if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
      return clampProviderRetryDelayMs(numericSeconds * 1000);
    }
    const dateDelay = Date.parse(String(retryAfter)) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay >= 0) {
      return clampProviderRetryDelayMs(dateDelay);
    }
  }

  const reset = responseHeaderMapValue(headers, "x-ratelimit-reset")
    || responseHeaderMapValue(headers, "x-rate-limit-reset");
  if (!reset) return null;
  const resetText = String(reset).trim();
  const resetNumber = Number(resetText);
  if (Number.isFinite(resetNumber) && resetNumber > 0) {
    const epochMs = resetNumber > 100000000000 ? resetNumber : resetNumber * 1000;
    const delayMs = epochMs - Date.now();
    return delayMs >= 0 ? clampProviderRetryDelayMs(delayMs) : null;
  }
  const resetDateDelay = Date.parse(resetText) - Date.now();
  return Number.isFinite(resetDateDelay) && resetDateDelay >= 0 ? clampProviderRetryDelayMs(resetDateDelay) : null;
}

function numericProviderHeaderMs(value) {
  if (value == null || value === "") return null;
  const ms = Number(String(value).trim());
  return Number.isFinite(ms) && ms >= 0 ? clampProviderRetryDelayMs(ms) : null;
}

function responseHeaderMapValue(headers, name) {
  if (!headers || !name) return "";
  const lower = name.toLowerCase();
  if (typeof headers.get === "function") {
    try {
      return headers.get(name) || headers.get(lower) || "";
    } catch (_err) {
      return "";
    }
  }
  if (headers instanceof Map) {
    return headers.get(name) || headers.get(lower) || "";
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return "";
}

function clampProviderRetryDelayMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(Math.ceil(ms), PROVIDER_RETRY_DELAY_MAX_MS);
}

async function readProviderStream(response, protocol) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let recordLines = [];
  let text = "";
  let usage;
  const consumeRecord = (record) => {
    const parsed = parseProviderStreamLine(protocol, record);
    usage = mergeStreamUsage(usage, parsed.usage);
    if (parsed.text && (!parsed.snapshot || !text)) text += parsed.text;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (isBlankStreamLine(line)) {
        if (recordLines.length) consumeRecord(recordLines.join("\n"));
        recordLines = [];
        continue;
      }
      if (shouldStartNewStreamRecord(recordLines, line)) {
        consumeRecord(recordLines.join("\n"));
        recordLines = [];
      }
      recordLines.push(line);
    }
  }
  if (buffer) {
    if (shouldStartNewStreamRecord(recordLines, buffer)) {
      consumeRecord(recordLines.join("\n"));
      recordLines = [];
    }
    recordLines.push(buffer);
  }
  if (recordLines.length) consumeRecord(recordLines.join("\n"));
  if (protocol === "anthropic_messages") {
    return { content: [{ type: "text", text }], usage };
  }
  return { choices: [{ message: { content: text } }], output_text: text, usage };
}

function parseProviderStreamLine(protocol, line) {
  const payloads = streamPayloads(line);
  if (!payloads.length) return { text: "" };
  let text = "";
  let usage;
  let snapshot = false;
  for (const payload of payloads) {
    const parsed = parseProviderStreamPayload(protocol, payload);
    usage = mergeStreamUsage(usage, parsed.usage);
    if (parsed.snapshot) snapshot = true;
    if (parsed.text && (!parsed.snapshot || !text)) text += parsed.text;
  }
  return { text, snapshot, usage };
}

function mergeStreamUsage(left, right) {
  if (!left) return right || undefined;
  if (!right) return left;
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const leftNumber = numericUsageValue(merged[key]);
    const rightNumber = numericUsageValue(value);
    merged[key] = leftNumber !== undefined && rightNumber !== undefined
      ? Math.max(leftNumber, rightNumber)
      : value;
  }
  const inputTokens = numericUsageValue(merged.inputTokens);
  const outputTokens = numericUsageValue(merged.outputTokens);
  if (inputTokens !== undefined || outputTokens !== undefined) {
    const computedTotal = (inputTokens || 0) + (outputTokens || 0);
    const existingTotal = numericUsageValue(merged.totalTokens);
    merged.totalTokens = existingTotal !== undefined ? Math.max(existingTotal, computedTotal) : computedTotal;
  }
  return merged;
}

function numericUsageValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function providerUsageFromResponse(data, depth = 0) {
  if (!data || typeof data !== "object" || depth > 5) return undefined;
  if (Array.isArray(data)) {
    return data
      .map((item) => providerUsageFromResponse(item, depth + 1))
      .filter(Boolean)
      .reduce((merged, usage) => mergeStreamUsage(merged, usage), undefined);
  }
  const direct = directProviderUsage(data);
  let nested;
  for (const key of PROVIDER_USAGE_CONTAINER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object") continue;
    nested = mergeStreamUsage(nested, providerUsageFromResponse(value, depth + 1));
  }
  return mergeStreamUsage(direct, nested);
}

function directProviderUsage(data) {
  const candidates = [
    data?.usage,
    data?.token_usage,
    data?.tokenUsage,
    data?.usage_metadata,
    data?.usageMetadata,
    data?.token_counts,
    data?.tokenCounts,
    data?.message?.usage,
    data?.delta?.usage,
    data?.metadata?.usage,
    data?.metadata?.usage_metadata,
    data?.metadata?.usageMetadata
  ];
  return candidates
    .map((candidate) => normalizeProviderUsage(candidate))
    .filter(Boolean)
    .reduce((merged, usage) => mergeStreamUsage(merged, usage), undefined);
}

function normalizeProviderUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const inputTokens = providerUsageFirstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.promptTokens,
    usage.inputTokenCount,
    usage.promptTokenCount,
    usage.input_token_count,
    usage.prompt_token_count,
    usage.promptTokensCount,
    usage.inputTokensCount,
    usage.token_usage?.prompt_tokens,
    usage.tokenUsage?.promptTokens,
    usage.billing_details?.input_tokens,
    usage.billingDetails?.inputTokens
  );
  const outputTokens = providerUsageFirstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.completionTokens,
    usage.outputTokenCount,
    usage.candidatesTokenCount,
    usage.output_token_count,
    usage.candidates_token_count,
    usage.completionTokensCount,
    usage.outputTokensCount,
    usage.token_usage?.completion_tokens,
    usage.tokenUsage?.completionTokens,
    usage.billing_details?.output_tokens,
    usage.billingDetails?.outputTokens
  );
  const totalTokens = providerUsageFirstNumber(
    usage.total_tokens,
    usage.totalTokens,
    usage.totalTokenCount,
    usage.total_token_count,
    usage.tokens_total,
    usage.tokenTotal,
    usage.token_usage?.total_tokens,
    usage.tokenUsage?.totalTokens,
    usage.billing_details?.total_tokens,
    usage.billingDetails?.totalTokens,
    inputTokens !== undefined || outputTokens !== undefined ? (inputTokens || 0) + (outputTokens || 0) : undefined
  );
  const cachedInputTokens = providerUsageSumNumbers(
    usage.cachedInputTokens,
    usage.cached_input_tokens,
    usage.cachedContentTokens,
    usage.cachedContentTokenCount,
    usage.cached_content_tokens,
    usage.cached_content_token_count,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_tokens,
    usage.cache_creation_tokens,
    usage.cacheReadInputTokens,
    usage.cacheCreationInputTokens,
    usage.cacheReadTokens,
    usage.cacheCreationTokens,
    usage.prompt_cache_hit_tokens,
    usage.promptCacheHitTokens,
    usage.cached_prompt_tokens,
    usage.cachedPromptTokens,
    usage.cache_read?.input_tokens,
    usage.cache_read?.tokens,
    usage.cacheRead?.inputTokens,
    usage.cacheRead?.tokens,
    usage.cache_creation?.input_tokens,
    usage.cache_creation?.tokens,
    usage.cacheCreation?.inputTokens,
    usage.cacheCreation?.tokens,
    usage.input_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cachedTokens,
    usage.input_tokens_details?.cache_read_tokens,
    usage.input_tokens_details?.cache_creation_tokens,
    usage.inputTokensDetails?.cached_tokens,
    usage.inputTokensDetails?.cachedTokens,
    usage.inputTokensDetails?.cacheReadTokens,
    usage.inputTokensDetails?.cacheCreationTokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.prompt_tokens_details?.cachedTokens,
    usage.prompt_tokens_details?.cache_read_tokens,
    usage.prompt_tokens_details?.cache_creation_tokens,
    usage.promptTokensDetails?.cached_tokens,
    usage.promptTokensDetails?.cachedTokens,
    usage.promptTokensDetails?.cacheReadTokens,
    usage.promptTokensDetails?.cacheCreationTokens,
    usage.billing_details?.cached_tokens,
    usage.billing_details?.cached_input_tokens,
    usage.billing_details?.input_tokens_details?.cached_tokens,
    usage.billingDetails?.cachedTokens,
    usage.billingDetails?.cachedInputTokens,
    usage.billingDetails?.inputTokensDetails?.cachedTokens
  );
  const reasoningTokens = providerUsageFirstNumber(
    usage.output_tokens_details?.reasoning_tokens,
    usage.output_tokens_details?.reasoningTokens,
    usage.output_token_details?.reasoning_tokens,
    usage.output_token_details?.reasoningTokens,
    usage.outputTokensDetails?.reasoning_tokens,
    usage.outputTokensDetails?.reasoningTokens,
    usage.completion_tokens_details?.reasoning_tokens,
    usage.completion_tokens_details?.reasoningTokens,
    usage.completion_token_details?.reasoning_tokens,
    usage.completion_token_details?.reasoningTokens,
    usage.completionTokensDetails?.reasoning_tokens,
    usage.completionTokensDetails?.reasoningTokens,
    usage.reasoning_tokens,
    usage.reasoningTokens,
    usage.reasoningTokenCount,
    usage.reasoning_token_count,
    usage.thoughtsTokenCount,
    usage.thoughts_token_count,
    usage.thinkingTokenCount,
    usage.thinking_token_count,
    usage.thinkingTokens,
    usage.thinking_tokens,
    usage.reasoning?.tokens,
    usage.reasoning?.token_count,
    usage.reasoning?.tokenCount,
    usage.thinking?.tokens,
    usage.thinking?.token_count,
    usage.thinking?.tokenCount,
    usage.billing_details?.output_tokens_details?.reasoning_tokens,
    usage.billingDetails?.outputTokensDetails?.reasoningTokens
  );
  const normalized = {};
  if (inputTokens !== undefined) normalized.inputTokens = inputTokens;
  if (outputTokens !== undefined) normalized.outputTokens = outputTokens;
  if (totalTokens !== undefined) normalized.totalTokens = totalTokens;
  if (cachedInputTokens !== undefined) normalized.cachedInputTokens = cachedInputTokens;
  if (reasoningTokens !== undefined) normalized.reasoningTokens = reasoningTokens;
  return Object.keys(normalized).length ? normalized : undefined;
}

function providerUsageFirstNumber(...values) {
  for (const value of values) {
    const number = numericUsageValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function providerUsageSumNumbers(...values) {
  const numbers = values.map((value) => numericUsageValue(value)).filter((value) => value !== undefined);
  if (!numbers.length) return undefined;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function parseProviderStreamPayload(protocol, payload) {
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

function streamPayloads(record) {
  const dataLines = String(record || "")
    .split(/\r?\n/)
    .map((line) => sseFieldValue(line, "data"))
    .filter((value) => value !== undefined);
  if (!dataLines.length) return [];
  const joined = dataLines.join("\n").trim();
  if (!joined) return [];
  if (dataLines.length === 1 || joined === "[DONE]" || safeParseJSON(joined)) return [joined];
  return dataLines.map((line) => String(line || "").trim()).filter(Boolean);
}

function sseFieldValue(line, field) {
  const text = String(line || "");
  const index = text.indexOf(":");
  if (index < 0 || text.slice(0, index).trim() !== field) return undefined;
  const value = text.slice(index + 1);
  return value.startsWith(" ") ? value.slice(1) : value;
}

function shouldStartNewStreamRecord(recordLines, nextLine) {
  if (!recordLines.length || !isStreamFieldLine(nextLine)) return false;
  return streamPayloads(recordLines.join("\n")).some((payload) => payload === "[DONE]" || !!safeParseJSON(payload));
}

function isBlankStreamLine(line) {
  return !String(line || "").trim();
}

function isStreamFieldLine(line) {
  return /^(?:data|event|id|retry):/i.test(String(line || "").trim());
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
  const promptPack = promptPackInstructionBlock(settings?.promptPackId, outputLanguage);
  return {
    system: summarySystemPromptForLanguage(settings?.systemPrompt, outputLanguage),
    user: [promptPack, summaryUserPromptForLanguage(settings?.userPrompt, outputLanguage)].filter(Boolean).join("\n\n")
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

function normalizePromptPackId(value) {
  const id = String(value || "").trim();
  return PROMPT_PACK_IDS.includes(id) ? id : "general";
}

function promptPackInstructionBlock(promptPackId, outputLanguage) {
  const instruction = promptPackInstruction(promptPackId, outputLanguage);
  if (!instruction) return "";
  if (outputLanguage === "zh-CN") return `研究领域提示模板包：\n${instruction}`;
  if (outputLanguage === "ja-JP") return `研究分野プロンプトパック:\n${instruction}`;
  return `Research domain prompt pack:\n${instruction}`;
}

function promptPackInstruction(promptPackId, outputLanguage) {
  const id = normalizePromptPackId(promptPackId);
  if (id === "general") return "";
  if (outputLanguage === "zh-CN") {
    if (id === "ai-ml") return "聚焦模型架构、训练目标、数据集、指标、baseline 公平性、消融实验、复现成本、算力假设和失败模式。";
    if (id === "transportation") return "聚焦交通场景、道路/空域/网络约束、需求与流量、安全风险、路径规划或控制策略、仿真设置、可扩展性和运行管理含义。";
    if (id === "biomedicine") return "聚焦研究设计、样本/队列、干预或暴露、终点指标、偏倚来源、统计不确定性、生物或临床合理性；不要给出医疗建议。";
    if (id === "social-science") return "聚焦理论框架、变量构造、测量有效性、样本代表性、因果识别、混杂因素、外部有效性和政策含义。";
    if (id === "review-writing") return "聚焦综述写作：提炼研究空白、分类维度、可比较指标、证据强弱、代表性论文位置和后续研究路线。";
  }
  if (outputLanguage === "ja-JP") {
    if (id === "ai-ml") return "モデル構造、学習目標、データセット、評価指標、ベースラインの公平性、アブレーション、再現コスト、計算資源の仮定、失敗モードに注目してください。";
    if (id === "transportation") return "交通シナリオ、道路・空域・ネットワーク制約、需要と流量、安全リスク、経路計画または制御、シミュレーション設定、拡張性、運用上の意味に注目してください。";
    if (id === "biomedicine") return "研究デザイン、サンプルまたはコホート、介入または曝露、エンドポイント、バイアス、不確実性、生物学的または臨床的妥当性に注目してください。医療助言は行わないでください。";
    if (id === "social-science") return "理論枠組み、構成概念、測定妥当性、サンプル代表性、因果識別、交絡、外的妥当性、政策的含意に注目してください。";
    if (id === "review-writing") return "レビュー執筆に向けて、研究ギャップ、分類軸、比較可能な指標、証拠の強さ、代表論文の位置づけ、今後の研究ルートを抽出してください。";
  }
  if (id === "ai-ml") return "Focus on model architecture, training objective, datasets, metrics, baseline fairness, ablations, reproducibility cost, compute assumptions, and failure modes.";
  if (id === "transportation") return "Focus on traffic or airspace scenario, road/airspace/network constraints, demand and flow, safety risk, routing or control policy, simulation setup, scalability, and operational implications.";
  if (id === "biomedicine") return "Focus on study design, sample or cohort, intervention or exposure, endpoints, bias sources, statistical uncertainty, biological or clinical plausibility; do not provide medical advice.";
  if (id === "social-science") return "Focus on theory, constructs, measurement validity, sample representativeness, causal identification, confounders, external validity, and policy implications.";
  if (id === "review-writing") return "Focus on literature-review writing: research gaps, taxonomy dimensions, comparable measures, evidence strength, representative-paper positioning, and future research routes.";
  return "";
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

async function writeCollectionWorkspace(settings, collectionContext, results, options = {}) {
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
  const topicClustersPath = artifacts.topicClustersPath;
  const synthesisClaimsPath = artifacts.synthesisClaimsPath;
  const synthesisConflictsPath = artifacts.synthesisConflictsPath;
  const synthesisRoadmapPath = artifacts.synthesisRoadmapPath;
  const researchQuestionCardsPath = artifacts.researchQuestionCardsPath;
  const reviewDraftPath = artifacts.reviewDraftPath;
  const reviewReportPath = artifacts.reviewReportPath;
  const literatureSearchEvidencePath = artifacts.literatureSearchEvidencePath;
  const literatureSearchRecordsPath = artifacts.literatureSearchRecordsPath;
  const modelReviewPath = artifacts.modelReviewPath;
  const collectionReviewPath = artifacts.collectionReviewPath;
  const ideaListPath = artifacts.ideaListPath;
  const chartReviewBatchIndexPath = artifacts.chartReviewBatchIndexPath;
  await writeText(paperNotesIndexPath, renderPaperNotesIndex(collectionContext, results, outputLanguage));
  await writeText(methodMatrixPath, renderMethodMatrix(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(gapMatrixPath, renderResearchGapMatrix(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(topicClustersPath, renderTopicClusters(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(synthesisClaimsPath, renderSynthesisClaimsMatrix(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(synthesisConflictsPath, renderSynthesisConflictLedger(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(synthesisRoadmapPath, renderSynthesisRoadmap(collectionContext, results, outputLanguage, summaryInsights));
  await writeText(researchQuestionCardsPath, renderResearchQuestionCards(collectionContext, results, outputLanguage));
  await writeText(reviewDraftPath, renderManualReviewDraft(collectionContext, results, outputLanguage));
  await writeText(reviewReportPath, renderFormalReviewReport(collectionContext, results, outputLanguage, summaryInsights));
  let literatureSearchEvidence = null;
  if (options?.onlineSearch) {
    literatureSearchEvidence = await collectionLiteratureSearchEvidence(settings, { ...collectionContext, outputDir: baseDir }, results, outputLanguage, summaryInsights)
      .catch((err) => collectionLiteratureSearchFailure({ ...collectionContext, outputDir: baseDir }, results, outputLanguage, err));
    await writeText(literatureSearchEvidencePath, renderCollectionLiteratureSearchEvidence({ ...collectionContext, outputDir: baseDir }, outputLanguage, literatureSearchEvidence));
    await writeText(literatureSearchRecordsPath, JSON.stringify(literatureSearchEvidence, null, 2));
  }
  if (options?.modelReview) {
    await writeCollectionModelReview(settings, { ...collectionContext, outputDir: baseDir }, results, outputLanguage, summaryInsights, {
      modelReviewPath,
      collectionReviewPath
    }, literatureSearchEvidence);
  }
  await writeText(ideaListPath, renderIdeaList(collectionContext, results, outputLanguage, summaryInsights));
  const chartReviewBatchIndex = await loadCollectionChartReviewBatchIndex(
    { ...collectionContext, outputDir: baseDir },
    results,
    artifacts,
    outputLanguage
  );
  await writeText(chartReviewBatchIndexPath, renderCollectionChartReviewBatchIndex(chartReviewBatchIndex, outputLanguage));
  const crossCollectionArtifacts = await writeCrossCollectionSynthesisIndex(
    settings,
    { ...collectionContext, outputDir: baseDir },
    results,
    outputLanguage,
    summaryInsights,
    {
      baseDir,
      papersIndexPath,
      paperNotesIndexPath,
      methodMatrixPath,
      gapMatrixPath,
      topicClustersPath,
      synthesisClaimsPath,
      synthesisConflictsPath,
      synthesisRoadmapPath,
      researchQuestionCardsPath,
      reviewDraftPath,
      reviewReportPath,
      literatureSearchEvidencePath,
      literatureSearchRecordsPath,
      modelReviewPath,
      collectionReviewPath,
      ideaListPath,
      chartReviewBatchIndexPath,
      chartReviewBatchIndex
    }
  );
  return {
    baseDir,
    papersIndexPath,
    paperNotesIndexPath,
    methodMatrixPath,
    gapMatrixPath,
    topicClustersPath,
    synthesisClaimsPath,
    synthesisConflictsPath,
    synthesisRoadmapPath,
    researchQuestionCardsPath,
    reviewDraftPath,
    reviewReportPath,
    literatureSearchEvidencePath,
    literatureSearchRecordsPath,
    modelReviewPath,
    collectionReviewPath,
    ideaListPath,
    chartReviewBatchIndexPath,
    ...crossCollectionArtifacts
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
    topicClustersPath: PathUtils.join(dirs.knowledge, `topic-clusters.${language}.md`),
    synthesisClaimsPath: PathUtils.join(dirs.knowledge, `synthesis-claims.${language}.md`),
    synthesisConflictsPath: PathUtils.join(dirs.knowledge, `synthesis-conflicts.${language}.md`),
    synthesisRoadmapPath: PathUtils.join(dirs.knowledge, `synthesis-roadmap.${language}.md`),
    researchQuestionCardsPath: PathUtils.join(dirs.knowledge, `research-question-cards.${language}.md`),
    literatureSearchEvidencePath: PathUtils.join(dirs.knowledge, `literature-search-evidence.${language}.md`),
    literatureSearchRecordsPath: PathUtils.join(dirs.knowledge, "literature-search-candidates.json"),
    reviewDraftPath: PathUtils.join(dirs.writing, `manual-review-draft.${language}.md`),
    reviewReportPath: PathUtils.join(dirs.writing, `formal-review-report.${language}.md`),
    modelReviewPath: PathUtils.join(dirs.writing, `model-literature-review.${language}.md`),
    collectionReviewPath: PathUtils.join(dirs.writing, `collection-literature-review.${language}.md`),
    ideaListPath: PathUtils.join(dirs.writing, `idea-list.${language}.md`),
    chartReviewBatchIndexPath: PathUtils.join(dirs.writing, `chart-review-batch-index.${language}.md`)
  };
}

async function loadCollectionChartReviewBatchIndex(collectionContext, results, artifacts = {}, outputLanguage = "zh-CN") {
  const reports = await loadCollectionVisualExtractionReports(collectionContext, results, artifacts);
  const rows = collectionChartReviewBatchRows(reports);
  return {
    templateVersion: "collection-chart-review-batch-index-v1",
    generatedAt: new Date().toISOString(),
    outputLanguage: collectionOutputLanguage({ outputLanguage }),
    collection: {
      key: collectionContext.key || "",
      name: collectionContext.name || collectionContext.key || "",
      type: collectionContext.type || "collection",
      parentLibraryID: collectionContext.parentLibraryID || null
    },
    stats: collectionChartReviewBatchStats(reports, rows),
    reports,
    rows
  };
}

async function loadCollectionVisualExtractionReports(collectionContext, results, artifacts = {}) {
  const reports = [];
  const seen = new Set();
  for (const item of batchReportItems(results)) {
    const itemKey = item.itemKey || "";
    if (!itemKey || seen.has(itemKey)) continue;
    seen.add(itemKey);
    const jsonPath = collectionVisualExtractionJsonPath(collectionContext, itemKey);
    try {
      if (!await IOUtils.exists(jsonPath)) continue;
      const parsed = JSON.parse(await readText(jsonPath));
      reports.push(normalizeCollectionVisualExtractionReport(parsed, item, jsonPath));
    } catch (err) {
      reports.push(collectionVisualExtractionReportFailure(item, jsonPath, err));
    }
  }
  if (artifacts?.chartReviewBatchIndexPath) {
    reports.sort((left, right) => String(left.itemKey || "").localeCompare(String(right.itemKey || "")));
  }
  return reports;
}

function collectionVisualExtractionJsonPath(collectionContext, itemKey) {
  const baseDir = collectionContext.outputDir || "";
  return PathUtils.join(baseDir, "writing", `visual-extraction-${sanitizeFilename(itemKey || "paper")}.json`);
}

function normalizeCollectionVisualExtractionReport(parsed, item, jsonPath) {
  const actions = Array.isArray(parsed?.chartReviewActions) ? parsed.chartReviewActions : [];
  const batchRows = Array.isArray(parsed?.chartBatchReviewBoard)
    ? parsed.chartBatchReviewBoard
    : collectionChartReviewRowsFromActions(actions);
  return {
    itemKey: parsed?.itemKey || item.itemKey || "",
    title: parsed?.metadata?.title || item.title || parsed?.itemKey || item.itemKey || "",
    generatedAt: parsed?.generatedAt || "",
    reportPath: parsed?.reportPath || jsonPath.replace(/\.json$/i, ".md"),
    jsonPath,
    chartQualityStatus: parsed?.chartQualityReview?.status || "",
    chartReviewActionCount: actions.length,
    chartReviewBatchCount: batchRows.length,
    batchRows: batchRows.map((row) => ({
      priority: row.priority || "medium",
      reviewState: normalizeCollectionChartReviewState(row.reviewState || "todo"),
      count: Number(row.count) || 0,
      blockingIssue: row.blockingIssue || "",
      batchAction: row.batchAction || row.nextStep || "",
      doneCriteria: row.doneCriteria || ""
    }))
  };
}

function collectionVisualExtractionReportFailure(item, jsonPath, err) {
  return {
    itemKey: item.itemKey || "",
    title: item.title || item.itemKey || "",
    generatedAt: "",
    reportPath: jsonPath.replace(/\.json$/i, ".md"),
    jsonPath,
    chartQualityStatus: "unreadable-report",
    chartReviewActionCount: 1,
    chartReviewBatchCount: 1,
    batchRows: [{
      priority: "high",
      reviewState: "blocked",
      count: 1,
      blockingIssue: safeError(err),
      batchAction: "Repair or regenerate the visual extraction JSON before chart review.",
      doneCriteria: "The visual extraction JSON opens and exposes chart review rows."
    }]
  };
}

function collectionChartReviewRowsFromActions(actions = []) {
  const groups = new Map();
  for (const action of actions || []) {
    const priority = action?.priority || "medium";
    const reviewState = normalizeCollectionChartReviewState(action?.reviewState || "todo");
    const actionId = action?.actionId || "manual-review";
    const batchAction = action?.nextStep || actionId;
    const doneCriteria = action?.doneCriteria || "";
    const key = [priority, reviewState, actionId, batchAction, doneCriteria].join("::");
    if (!groups.has(key)) {
      groups.set(key, {
        priority,
        reviewState,
        count: 0,
        blockingIssues: [],
        batchAction,
        doneCriteria
      });
    }
    const group = groups.get(key);
    group.count += 1;
    const relatedCheck = `${action?.checkId || ""}${action?.status ? ` (${action.status})` : ""}`;
    const issue = [actionId, relatedCheck, action?.detail || ""].filter(Boolean).join(" - ");
    if (issue && !group.blockingIssues.includes(issue)) group.blockingIssues.push(issue);
  }
  return Array.from(groups.values()).map((group) => ({
    priority: group.priority,
    reviewState: group.reviewState,
    count: group.count,
    blockingIssue: collectionChartReviewIssueSummary(group.blockingIssues),
    batchAction: group.batchAction,
    doneCriteria: group.doneCriteria
  }));
}

function collectionChartReviewBatchRows(reports = []) {
  const groups = new Map();
  for (const report of reports || []) {
    for (const row of report.batchRows || []) {
      const priority = row.priority || "medium";
      const reviewState = normalizeCollectionChartReviewState(row.reviewState || "todo");
      const batchAction = row.batchAction || "";
      const doneCriteria = row.doneCriteria || "";
      const key = [priority, reviewState, batchAction, doneCriteria].join("::");
      if (!groups.has(key)) {
        groups.set(key, {
          priority,
          reviewState,
          count: 0,
          paperKeys: new Set(),
          papers: [],
          sourceReports: [],
          blockingIssues: [],
          batchAction,
          doneCriteria
        });
      }
      const group = groups.get(key);
      const count = Number(row.count) || 1;
      group.count += count;
      if (report.itemKey && !group.paperKeys.has(report.itemKey)) {
        group.paperKeys.add(report.itemKey);
        group.papers.push(report.title || report.itemKey);
      }
      if (report.reportPath && !group.sourceReports.includes(report.reportPath)) group.sourceReports.push(report.reportPath);
      if (row.blockingIssue && !group.blockingIssues.includes(row.blockingIssue)) group.blockingIssues.push(row.blockingIssue);
    }
  }
  return Array.from(groups.values()).map((group) => ({
    priority: group.priority,
    reviewState: group.reviewState,
    count: group.count,
    paperCount: group.paperKeys.size,
    papers: group.papers.slice(0, 8),
    blockingIssue: collectionChartReviewIssueSummary(group.blockingIssues),
    batchAction: group.batchAction,
    doneCriteria: group.doneCriteria,
    sourceReports: group.sourceReports.slice(0, 8)
  })).sort(collectionChartReviewBatchSort);
}

function collectionChartReviewIssueSummary(issues = []) {
  const visible = (issues || []).filter(Boolean).slice(0, 3);
  const hidden = Math.max(0, (issues || []).filter(Boolean).length - visible.length);
  return hidden ? `${visible.join("; ")}; +${hidden} more` : visible.join("; ");
}

function collectionChartReviewBatchSort(left, right) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const stateRank = { todo: 0, blocked: 1, "in-review": 2, done: 3, discarded: 4 };
  const priorityDelta = (priorityRank[left?.priority] ?? 9) - (priorityRank[right?.priority] ?? 9);
  if (priorityDelta) return priorityDelta;
  const stateDelta = (stateRank[left?.reviewState] ?? 9) - (stateRank[right?.reviewState] ?? 9);
  if (stateDelta) return stateDelta;
  return (Number(right?.count) || 0) - (Number(left?.count) || 0);
}

function normalizeCollectionChartReviewState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "in_review" || normalized === "in review" || normalized === "reviewing") return "in-review";
  if (normalized === "complete" || normalized === "completed") return "done";
  if (["todo", "in-review", "done", "blocked", "discarded"].includes(normalized)) return normalized;
  return "todo";
}

function collectionChartReviewBatchStats(reports = [], rows = []) {
  const actionCount = rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const openActionCount = rows
    .filter((row) => !["done", "discarded"].includes(normalizeCollectionChartReviewState(row.reviewState)))
    .reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  return {
    visualReports: reports.length,
    batchRows: rows.length,
    chartReviewActions: actionCount,
    openChartReviewActions: openActionCount,
    highPriorityActions: rows.filter((row) => row.priority === "high").reduce((sum, row) => sum + (Number(row.count) || 0), 0),
    blockedActions: rows.filter((row) => normalizeCollectionChartReviewState(row.reviewState) === "blocked").reduce((sum, row) => sum + (Number(row.count) || 0), 0)
  };
}

function renderCollectionChartReviewBatchIndex(index, outputLanguage = "zh-CN") {
  const labels = collectionChartReviewBatchLabels(outputLanguage);
  const stats = index?.stats || collectionChartReviewBatchStats(index?.reports || [], index?.rows || []);
  const rows = Array.isArray(index?.rows) ? index.rows : [];
  const reports = Array.isArray(index?.reports) ? index.reports : [];
  return [
    "---",
    `templateVersion: ${frontmatterScalar(index?.templateVersion || "collection-chart-review-batch-index-v1")}`,
    `collectionKey: ${frontmatterScalar(index?.collection?.key || "")}`,
    `outputLanguage: ${frontmatterScalar(collectionOutputLanguage({ outputLanguage }))}`,
    `generatedAt: ${frontmatterScalar(index?.generatedAt || "")}`,
    `visualReportCount: ${stats.visualReports || 0}`,
    `chartReviewActionCount: ${stats.chartReviewActions || 0}`,
    `openChartReviewActionCount: ${stats.openChartReviewActions || 0}`,
    "---",
    "",
    `# ${index?.collection?.name || index?.collection?.key || ""} ${labels.title}`,
    "",
    labels.note,
    "",
    `- ${labels.visualReports}: ${stats.visualReports || 0}`,
    `- ${labels.batchRows}: ${stats.batchRows || 0}`,
    `- ${labels.chartReviewActions}: ${stats.chartReviewActions || 0}`,
    `- ${labels.openChartReviewActions}: ${stats.openChartReviewActions || 0}`,
    `- ${labels.highPriorityActions}: ${stats.highPriorityActions || 0}`,
    `- ${labels.blockedActions}: ${stats.blockedActions || 0}`,
    "",
    `## ${labels.batchBoard}`,
    "",
    rows.length ? collectionChartReviewBatchTable(rows, labels) : `- ${labels.noBatchRows}`,
    "",
    `## ${labels.sourceReports}`,
    "",
    reports.length ? collectionChartReviewSourceReportsTable(reports, labels) : `- ${labels.noReports}`,
    "",
    `## ${labels.reviewChecklist}`,
    "",
    labels.reviewChecklistItems,
    ""
  ].join("\n");
}

function collectionChartReviewBatchTable(rows, labels) {
  return [
    `| ${labels.priority} | ${labels.reviewState} | ${labels.count} | ${labels.papers} | ${labels.blockingIssue} | ${labels.batchAction} | ${labels.doneCriteria} | ${labels.sourceReports} |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => [
      escapeMarkdownTable(row.priority),
      escapeMarkdownTable(row.reviewState),
      Number(row.count) || 0,
      escapeMarkdownTable((row.papers || []).join("; ")),
      escapeMarkdownTable(row.blockingIssue || ""),
      escapeMarkdownTable(row.batchAction || ""),
      escapeMarkdownTable(row.doneCriteria || ""),
      escapeMarkdownTable((row.sourceReports || []).join("; "))
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  ].join("\n");
}

function collectionChartReviewSourceReportsTable(reports, labels) {
  return [
    `| ${labels.paper} | ${labels.qualityStatus} | ${labels.batchRows} | ${labels.chartReviewActions} | ${labels.reportFile} | ${labels.jsonFile} |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...reports.map((report) => [
      escapeMarkdownTable(report.title || report.itemKey || ""),
      escapeMarkdownTable(report.chartQualityStatus || ""),
      Number(report.chartReviewBatchCount) || 0,
      Number(report.chartReviewActionCount) || 0,
      escapeMarkdownTable(report.reportPath || ""),
      escapeMarkdownTable(report.jsonPath || "")
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  ].join("\n");
}

function collectionChartReviewBatchLabels(outputLanguage) {
  if (outputLanguage === "en-US") {
    return {
      title: "Chart Review Batch Index",
      note: "This index aggregates chart review tasks from visual-extraction JSON reports in this collection. Use it to batch similar chart checks before reusing extracted values.",
      visualReports: "visual reports",
      batchRows: "batch rows",
      chartReviewActions: "chart review actions",
      openChartReviewActions: "open chart review actions",
      highPriorityActions: "high-priority actions",
      blockedActions: "blocked actions",
      batchBoard: "Cross-Report Batch Review Board",
      sourceReports: "Source Visual Reports",
      noBatchRows: "No chart review action was found in the current collection visual reports.",
      noReports: "No visual-extraction JSON report was found for the current batch items.",
      priority: "Priority",
      reviewState: "Review state",
      count: "Actions",
      papers: "Papers",
      blockingIssue: "Blocking issue",
      batchAction: "Batch action",
      doneCriteria: "Done criteria",
      paper: "Paper",
      qualityStatus: "Quality status",
      reportFile: "Report",
      jsonFile: "JSON",
      reviewChecklist: "Batch Review Checklist",
      reviewChecklistItems: [
        "- [ ] Work through high-priority and blocked rows before reusing chart data.",
        "- [ ] Open every source visual report listed in a row and check the original figure.",
        "- [ ] Mark completed rows back in each visual report before exporting again."
      ].join("\n")
    };
  }
  if (outputLanguage === "ja-JP") {
    return {
      title: "図表レビュー一括インデックス",
      note: "このインデックスは collection 内の visual-extraction JSON レポートから図表レビュータスクを集約します。抽出値を再利用する前に類似タスクをまとめて確認してください。",
      visualReports: "図表レポート数",
      batchRows: "一括行数",
      chartReviewActions: "図表レビュータスク数",
      openChartReviewActions: "未完了タスク数",
      highPriorityActions: "高優先度タスク数",
      blockedActions: "ブロック中タスク数",
      batchBoard: "レポート横断一括レビューボード",
      sourceReports: "元図表レポート",
      noBatchRows: "現在の collection 図表レポートにレビュータスクはありません。",
      noReports: "現在のバッチ項目に対応する visual-extraction JSON レポートは見つかりません。",
      priority: "優先度",
      reviewState: "レビュー状態",
      count: "タスク数",
      papers: "論文",
      blockingIssue: "阻害要因",
      batchAction: "一括処理",
      doneCriteria: "完了条件",
      paper: "論文",
      qualityStatus: "品質状態",
      reportFile: "レポート",
      jsonFile: "JSON",
      reviewChecklist: "一括レビュー確認リスト",
      reviewChecklistItems: [
        "- [ ] 図表データを再利用する前に高優先度・ブロック中の行を処理する。",
        "- [ ] 各行の元図表レポートを開き、原図を確認する。",
        "- [ ] 完了した状態を各図表レポートに戻してから再エクスポートする。"
      ].join("\n")
    };
  }
  return {
    title: "图表复核批量索引",
    note: "本索引汇总当前 collection 内 visual-extraction JSON 报告里的图表复核任务，用于在复用抽取数值前批量处理相似问题。",
    visualReports: "图表报告数",
    batchRows: "批量行数",
    chartReviewActions: "图表复核任务数",
    openChartReviewActions: "未完成复核任务数",
    highPriorityActions: "高优先级任务数",
    blockedActions: "阻塞任务数",
    batchBoard: "跨报告批量复核看板",
    sourceReports: "来源图表报告",
    noBatchRows: "当前 collection 的图表报告里没有检测到复核任务。",
    noReports: "当前批量条目没有找到对应的 visual-extraction JSON 报告。",
    priority: "优先级",
    reviewState: "复核状态",
    count: "任务数",
    papers: "论文",
    blockingIssue: "阻塞问题",
    batchAction: "批量处理动作",
    doneCriteria: "完成条件",
    paper: "论文",
    qualityStatus: "质量状态",
    reportFile: "报告",
    jsonFile: "JSON",
    reviewChecklist: "批量复核清单",
    reviewChecklistItems: [
      "- [ ] 先处理高优先级和阻塞状态的行，再复用图表数据。",
      "- [ ] 打开每一行列出的来源图表报告，并回到原图核对。",
      "- [ ] 在各图表报告里回填完成状态后再重新导出。"
    ].join("\n")
  };
}

async function collectionLiteratureSearchEvidence(settings, collectionContext, results, outputLanguage, summaryInsights) {
  const generatedAt = new Date().toISOString();
  const queries = collectionLiteratureSearchQueries(collectionContext, results, outputLanguage, summaryInsights);
  const evidence = {
    templateVersion: "collection-literature-search-v1",
    collectionKey: collectionContext.key || "",
    collectionName: collectionContext.name || collectionContext.key || "",
    outputLanguage,
    generatedAt,
    enabled: false,
    queries,
    records: [],
    recordCount: 0,
    errors: [],
    requests: []
  };
  if (!queries.length) {
    return {
      ...evidence,
      errors: [{ source: "collection_query", error: "No collection search query could be built from the current papers." }]
    };
  }
  const candidateSources = collectionCandidateSourcesModule();
  if (!candidateSources?.searchCandidateSources) {
    return {
      ...evidence,
      errors: [{ source: "candidate_sources", error: "Candidate source module is unavailable in the background runtime." }]
    };
  }
  const fetchImpl = typeof fetch === "function"
    ? fetch.bind(typeof globalThis !== "undefined" ? globalThis : null)
    : null;
  if (!fetchImpl) {
    return {
      ...evidence,
      errors: [{ source: "fetch", error: "Fetch API is unavailable in the background runtime." }]
    };
  }
  let records = [];
  const errors = [];
  const requests = [];
  const existingRecords = collectionExistingCandidateRecords(results);
  const semanticScholarApiKey = settings.semanticScholarApiKey || settings.semanticScholarKey || "";
  const email = settings.candidateEmail || settings.email || "";
  for (const query of queries.slice(0, 5)) {
    try {
      const result = await candidateSources.searchCandidateSources(fetchImpl, {
        query,
        collectionKey: collectionContext.key || "",
        limit: 6,
        email,
        semanticScholarApiKey,
        now: generatedAt
      }, [...existingRecords, ...records]);
      records = mergeCollectionCandidateRecords(candidateSources, records, result.records || []);
      errors.push(...(result.errors || []).map((entry) => ({ ...entry, query })));
      requests.push(...(result.requests || []).map((request) => ({
        source: request.source,
        query,
        url: request.url
      })));
    } catch (err) {
      errors.push({ source: "collection_search", query, error: safeError(err) });
    }
  }
  const sortedRecords = candidateSources.sortCandidateRecords
    ? candidateSources.sortCandidateRecords(records)
    : records;
  return {
    ...evidence,
    enabled: true,
    records: sortedRecords.slice(0, 24),
    recordCount: sortedRecords.length,
    errors,
    requests: requests.slice(0, 40)
  };
}

function collectionLiteratureSearchFailure(collectionContext, results, outputLanguage, err) {
  return {
    templateVersion: "collection-literature-search-v1",
    collectionKey: collectionContext.key || "",
    collectionName: collectionContext.name || collectionContext.key || "",
    outputLanguage,
    generatedAt: new Date().toISOString(),
    enabled: false,
    queries: collectionLiteratureSearchQueries(collectionContext, results, outputLanguage, new Map()),
    records: [],
    recordCount: 0,
    errors: [{ source: "collection_search", error: safeError(err) }],
    requests: []
  };
}

function collectionCandidateSourcesModule() {
  if (typeof ZMSCandidateSources !== "undefined" && ZMSCandidateSources?.searchCandidateSources) return ZMSCandidateSources;
  loadCandidateSourcesModule();
  if (typeof ZMSCandidateSources !== "undefined" && ZMSCandidateSources?.searchCandidateSources) return ZMSCandidateSources;
  return null;
}

function mergeCollectionCandidateRecords(candidateSources, existing, incoming) {
  if (candidateSources?.mergeCandidateRecords) return candidateSources.mergeCandidateRecords(existing, incoming);
  const byId = new Map();
  for (const record of [...(existing || []), ...(incoming || [])]) {
    const key = record?.candidateId || `${record?.title || ""}:${record?.year || ""}`;
    if (key) byId.set(key, record);
  }
  return [...byId.values()];
}

function collectionExistingCandidateRecords(results) {
  return batchReportItems(results).map((item) => ({
    title: item.title || item.itemKey || "",
    year: item.year || "",
    itemKey: item.itemKey || "",
    doi: item.doi || "",
    arxivId: item.arxivId || ""
  })).filter((item) => item.title || item.doi || item.arxivId);
}

function collectionLiteratureSearchQueries(collectionContext, results, outputLanguage, summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const items = batchReportItems(results);
  const clusters = topicClusterEntries(results, summaryInsights, labels).slice(0, 4);
  const roadmap = synthesisRoadmapEntries(results, summaryInsights, labels).slice(0, 4);
  const titleTerms = items
    .map((item) => item.title)
    .filter(Boolean)
    .slice(0, 4);
  const clusterQueries = clusters.map((cluster) => {
    const methods = uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean)).slice(0, 2);
    const gaps = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence))).slice(0, 2);
    return [cluster.label, ...methods, ...gaps, "literature review"].filter(Boolean).join(" ");
  });
  const roadmapQueries = roadmap.map((entry) => entry.candidateQuery).filter(Boolean);
  const collectionName = collectionContext.name || collectionContext.key || "";
  return uniqueInsightLines([
    [collectionName, titleTerms.slice(0, 2).join(" "), "survey literature review"].filter(Boolean).join(" "),
    ...clusterQueries,
    ...roadmapQueries,
    ...titleTerms.slice(0, 2)
  ])
    .map((query) => String(query || "").replace(/\s+/g, " ").trim().slice(0, 220))
    .filter((query) => query.length >= 8)
    .slice(0, 6);
}

function renderCollectionLiteratureSearchEvidence(collectionContext, outputLanguage, evidence) {
  const labels = collectionLiteratureSearchLabels(outputLanguage);
  const records = evidence?.records || [];
  const errors = evidence?.errors || [];
  return [
    "---",
    "summaryType: collection-literature-search-evidence",
    `templateVersion: ${frontmatterScalar(evidence?.templateVersion || "collection-literature-search-v1")}`,
    `collectionKey: ${frontmatterScalar(collectionContext.key || "")}`,
    `collectionName: ${frontmatterScalar(collectionContext.name || "")}`,
    `recordCount: ${Number(evidence?.recordCount || records.length || 0)}`,
    `generatedAt: ${frontmatterScalar(evidence?.generatedAt || new Date().toISOString())}`,
    "---",
    "",
    `# ${collectionContext.name || collectionContext.key} ${labels.title}`,
    "",
    labels.explain,
    "",
    `## ${labels.queries}`,
    "",
    ...(evidence?.queries || []).map((query) => `- ${query}`),
    "",
    `## ${labels.candidates}`,
    "",
    records.length ? labels.tableHeader : labels.noCandidates,
    ...records.map((record) => labels.tableRow(record)),
    "",
    `## ${labels.errors}`,
    "",
    errors.length ? errors.map((entry) => `- ${entry.source || "source"}${entry.query ? ` (${entry.query})` : ""}: ${safeError(entry.error)}`).join("\n") : labels.noErrors,
    ""
  ].join("\n");
}

function collectionLiteratureSearchLabels(outputLanguage) {
  if (outputLanguage === "en-US") {
    return {
      title: "Online Literature Search Evidence",
      explain: "This file records online search evidence used as external context for collection-level review writing. External candidates are not treated as fully read in-collection papers.",
      queries: "Search Queries",
      candidates: "External Candidate Papers",
      errors: "Search Errors",
      noCandidates: "No external candidates were collected.",
      noErrors: "No search errors were reported.",
      tableHeader: "| Title | Year | Sources | Venue | Duplicate Risk | Why useful |\n| --- | --- | --- | --- | --- | --- |",
      tableRow: (record) => `| ${escapeMarkdownTable(record.title || "")} | ${escapeMarkdownTable(record.year || "n.d.")} | ${escapeMarkdownTable((record.sources || []).join(", "))} | ${escapeMarkdownTable(record.venue || "")} | ${escapeMarkdownTable(record.quality?.dedupeStatus || "")} | ${escapeMarkdownTable((record.priority?.reasons || []).slice(0, 3).join("; ") || record.quality?.reason || "")} |`
    };
  }
  if (outputLanguage === "ja-JP") {
    return {
      title: "オンライン文献検索証拠",
      explain: "このファイルは collection レビュー用の外部検索証拠を記録します。外部候補は、精読済みの collection 内論文とは区別して扱います。",
      queries: "検索クエリ",
      candidates: "外部候補論文",
      errors: "検索エラー",
      noCandidates: "外部候補は取得されませんでした。",
      noErrors: "検索エラーはありません。",
      tableHeader: "| タイトル | 年 | ソース | 掲載先 | 重複リスク | 有用性 |\n| --- | --- | --- | --- | --- | --- |",
      tableRow: (record) => `| ${escapeMarkdownTable(record.title || "")} | ${escapeMarkdownTable(record.year || "n.d.")} | ${escapeMarkdownTable((record.sources || []).join(", "))} | ${escapeMarkdownTable(record.venue || "")} | ${escapeMarkdownTable(record.quality?.dedupeStatus || "")} | ${escapeMarkdownTable((record.priority?.reasons || []).slice(0, 3).join("; ") || record.quality?.reason || "")} |`
    };
  }
  return {
    title: "联网文献检索证据",
    explain: "本文件记录分类级文献综述使用的联网检索证据。外部候选文献只作为背景、空白校验和后续补充线索，不等同于分类内已精读论文。",
    queries: "检索式",
    candidates: "外部候选文献",
    errors: "检索错误",
    noCandidates: "未收集到外部候选文献。",
    noErrors: "未报告检索错误。",
    tableHeader: "| 标题 | 年份 | 来源 | 期刊/会议 | 重复风险 | 可用线索 |\n| --- | --- | --- | --- | --- | --- |",
    tableRow: (record) => `| ${escapeMarkdownTable(record.title || "")} | ${escapeMarkdownTable(record.year || "n.d.")} | ${escapeMarkdownTable((record.sources || []).join(", "))} | ${escapeMarkdownTable(record.venue || "")} | ${escapeMarkdownTable(record.quality?.dedupeStatus || "")} | ${escapeMarkdownTable((record.priority?.reasons || []).slice(0, 3).join("; ") || record.quality?.reason || "")} |`
  };
}

function collectionLiteratureSearchPromptBlock(evidence, outputLanguage) {
  if (!evidence) return "";
  const heading = outputLanguage === "en-US"
    ? "## Online Literature Search Evidence"
    : outputLanguage === "ja-JP"
      ? "## オンライン文献検索証拠"
      : "## 联网文献检索证据";
  const guidance = outputLanguage === "en-US"
    ? "Treat the following records as external candidates and search context, not as already read collection papers."
    : outputLanguage === "ja-JP"
      ? "以下は外部候補と検索文脈です。精読済み collection 内論文として扱わないでください。"
      : "以下记录是外部候选文献和检索背景，不要当作分类内已精读论文。";
  const records = (evidence.records || []).slice(0, 16);
  const errors = (evidence.errors || []).slice(0, 8);
  const parts = [
    heading,
    guidance,
    "",
    "Search queries:",
    ...(evidence.queries || []).map((query) => `- ${query}`),
    "",
    "External candidates:"
  ];
  if (!records.length) parts.push("- none");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    parts.push([
      `### [external:${index + 1}] ${record.title || "Untitled"}`,
      `- year: ${record.year || "n.d."}`,
      `- sources: ${(record.sources || []).join(", ")}`,
      `- venue: ${record.venue || ""}`,
      `- query: ${record.query || ""}`,
      `- doi: ${record.ids?.doi || ""}`,
      `- arxivId: ${record.ids?.arxivId || ""}`,
      `- semanticScholarId: ${record.ids?.semanticScholarId || ""}`,
      `- duplicateRisk: ${record.quality?.dedupeStatus || ""}`,
      `- priority: ${record.priority?.tier || ""}; ${(record.priority?.reasons || []).slice(0, 3).join("; ")}`,
      `- abstract: ${truncateText(record.abstract || "", 700)}`
    ].join("\n"));
  }
  if (errors.length) {
    parts.push("", "Search errors:", ...errors.map((entry) => `- ${entry.source || "source"}${entry.query ? ` (${entry.query})` : ""}: ${safeError(entry.error)}`));
  }
  return parts.join("\n");
}

async function writeCollectionModelReview(settings, collectionContext, results, outputLanguage, summaryInsights, artifactPaths, literatureSearchEvidence = null) {
  const modelReviewPath = typeof artifactPaths === "string" ? artifactPaths : artifactPaths?.modelReviewPath;
  const collectionReviewPath = typeof artifactPaths === "string" ? "" : artifactPaths?.collectionReviewPath;
  const writeReviewOutputs = async (text) => {
    if (modelReviewPath) await writeText(modelReviewPath, text);
    if (collectionReviewPath && collectionReviewPath !== modelReviewPath) await writeText(collectionReviewPath, text);
  };
  try {
    if (!settingsHasUsableAuth(settings) || (settingsRequiresModel(settings) && !settings.model)) {
      await writeReviewOutputs(renderCollectionModelReviewUnavailable(collectionContext, results, outputLanguage));
      return modelReviewPath;
    }
    const inputText = await collectionModelReviewContext(collectionContext, results, outputLanguage, summaryInsights, literatureSearchEvidence);
    const sourceHash = hashString(`${collectionContext.key}:${outputLanguage}:${inputText}`);
    const result = await callProvider({
      id: settings.id,
      name: settings.name,
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
        system: collectionModelReviewSystemPrompt(outputLanguage),
        prompt: collectionModelReviewSkillPrompt(outputLanguage),
        input: { type: "text", text: inputText },
        temperature: settings.temperature,
        maxOutputTokens: settings.maxOutputTokens,
        stream: settings.stream
      }
    }, sourceHash);
    applyEffectiveProviderProfile(settings, result.effectiveProfile);
    const markdown = stripThink(result.markdown || "");
    if (!markdown) throw new Error("Collection review returned empty content");
    await writeReviewOutputs(renderCollectionModelReviewFile(collectionContext, outputLanguage, result, markdown, literatureSearchEvidence));
    return modelReviewPath;
  } catch (err) {
    Zotero.debug(`[Markdown Summary] Collection model review failed: ${safeError(err)}`);
    await writeReviewOutputs(renderCollectionModelReviewFailure(collectionContext, results, outputLanguage, err));
    return modelReviewPath;
  }
}

function collectionModelReviewSystemPrompt(outputLanguage) {
  if (outputLanguage === "en-US") {
    return "You are an academic literature-review assistant. Produce evidence-aware Markdown synthesis for a Zotero collection.";
  }
  if (outputLanguage === "ja-JP") {
    return "あなたは学術文献レビュー支援者です。Zotero collection の論文群から、根拠を明示した Markdown の横断的レビューを作成してください。";
  }
  return "你是学术文献综述助手。请基于 Zotero 分类中的论文题录、单篇摘要和已抽取证据，生成可复核的 Markdown 跨论文综述。";
}

function collectionModelReviewSkillPrompt(outputLanguage) {
  if (outputLanguage === "en-US") {
    return [
      "Use the collection inventory and summaries below to write a literature review synthesis.",
      "Do not annotate papers one by one. Build a review structure by synthesis: theme, problem, method family, scenario, evidence strength, disagreement, and research gap.",
      "Group papers with related but smaller different directions under a larger framework; split completely unrelated papers into independent review sections.",
      "Explain research lineage and relationships: what each group inherits, extends, challenges, or leaves unresolved.",
      "Use online search evidence only as external context, gap hints, and follow-up candidates. Clearly separate in-collection papers from external candidates.",
      "Every important claim must cite item keys, summary paths, or evidence labels from the input. Mark weak evidence as low-confidence.",
      "Use Markdown sections: Review Scope, Synthesis Framework, Paper Groups And Lineage, Cross-Paper Comparison, Consensus And Disagreements, Critical Review, Research Gaps, Draft Review Paragraphs, Follow-up Search Plan."
    ].join("\n");
  }
  if (outputLanguage === "ja-JP") {
    return [
      "下の collection 一覧と単一論文要約を使い、文献レビュー用の横断的統合を作成してください。",
      "論文を 1 本ずつ要約するのではなく、テーマ、問題、手法ファミリー、シナリオ、証拠強度、相違点、研究ギャップで統合してください。",
      "近いが小方向が異なる論文は大きな枠組みの下にまとめ、完全に無関係な論文は独立したレビュー節として分けてください。",
      "研究系譜と関係を説明してください。何を継承、拡張、批判、未解決として残しているかを明示してください。",
      "オンライン検索証拠は外部文献候補、ギャップ確認、追加検索の手掛かりとしてのみ使い、collection 内論文とは明確に分けてください。",
      "重要な判断には item key、要約パス、入力中の根拠ラベルを付け、根拠が弱い場合は低信頼と明記してください。"
    ].join("\n");
  }
  return [
    "请基于下面的分类论文清单和单篇总结，写一份可直接服务于 literature review 的跨论文综合与评论。",
    "不要按论文逐篇流水账总结；请按主题、问题、方法族、应用场景、证据强弱、分歧和研究空白来综合。",
    "小方向不一样但问题相近的论文，请放到一个更大的分析框架下讨论；完全不相关的论文，请明确拆成独立分点或独立小节，不要强行合并。",
    "梳理论文关系和研究脉络：哪些工作继承了共同问题，哪些扩展了方法或场景，哪些相互冲突，哪些只是在相邻方向上提供背景。",
    "联网搜索证据只作为外部候选文献、研究空白和后续补充检索线索；必须区分分类内已处理论文和外部候选文献，不要把外部候选当作已精读论文。",
    "输出 Markdown，并固定包含：综述范围、综合框架、论文分组与研究谱系、跨论文对比、共识与分歧、批判性评论、研究空白、可写入正文的综述段落、后续检索计划。",
    "每个重要判断都要引用输入中的 item key、summaryPath 或证据标签；证据不足时标注低置信度，不要编造论文内容。"
  ].join("\n");
}

async function collectionModelReviewContext(collectionContext, results, outputLanguage, summaryInsights, literatureSearchEvidence = null) {
  const labels = collectionTemplateLabels(outputLanguage);
  const stats = batchStats(results);
  const entries = await Promise.all(batchReportItems(results).map(async (item) => {
    const markdown = await summaryMarkdownForBatchItem(item);
    const insight = summaryInsights.get(item.itemKey) || extractSummaryInsights(markdown, item);
    return collectionModelReviewEntry(item, markdown, insight);
  }));
  const header = [
    `# ${collectionContext.name || collectionContext.key}`,
    `collectionKey: ${collectionContext.key || ""}`,
    labels.statsLine(stats),
    "",
    "## Papers"
  ].join("\n");
  return limitCollectionReviewContext([
    header,
    entries.join("\n\n---\n\n"),
    collectionLiteratureSearchPromptBlock(literatureSearchEvidence, outputLanguage)
  ].filter(Boolean).join("\n\n"));
}

function collectionModelReviewEntry(item, markdown, insight) {
  const summary = truncateText(stripMarkdownFrontmatter(markdown), 2200);
  return [
    `### ${item.title || item.itemKey}`,
    `- itemKey: ${item.itemKey || ""}`,
    `- year: ${item.year || "n.d."}`,
    `- status: ${item.status || ""}`,
    `- summaryPath: ${item.summaryPath || ""}`,
    `- methodSignal: ${insight.method || ""}`,
    `- dataScenario: ${insight.dataScenario || ""}`,
    `- metrics: ${insight.metrics || ""}`,
    `- limitations: ${(insight.limitations || []).join("; ")}`,
    `- missingEvidence: ${(insight.missingEvidence || []).join("; ")}`,
    "",
    summary ? `Summary excerpt:\n${summary}` : "Summary excerpt: unavailable; use metadata only and mark low-confidence."
  ].join("\n");
}

function limitCollectionReviewContext(text, limit = 48000) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[context truncated for collection-level synthesis]`;
}

function truncateText(value, limit) {
  const text = String(value || "").replace(/\n{4,}/g, "\n\n\n").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 32)).trim()}\n[excerpt truncated]`;
}

function renderCollectionModelReviewFile(collectionContext, outputLanguage, result, markdown, literatureSearchEvidence = null) {
  const title = outputLanguage === "en-US"
    ? "Model Literature Review"
    : outputLanguage === "ja-JP"
      ? "モデル生成文献レビュー"
      : "模型生成的分类文献综述";
  return [
    "---",
    "summaryType: literature-review-synthesis",
    "reviewMode: collection-literature-review",
    "templateVersion: collection-model-review-v1",
    `collectionKey: ${frontmatterScalar(collectionContext.key || "")}`,
    `collectionName: ${frontmatterScalar(collectionContext.name || "")}`,
    `onlineSearchRecordCount: ${Number(literatureSearchEvidence?.recordCount || literatureSearchEvidence?.records?.length || 0)}`,
    `onlineSearchEvidence: ${frontmatterScalar(literatureSearchEvidence?.enabled ? "enabled" : literatureSearchEvidence ? "unavailable" : "not_requested")}`,
    `provider: ${frontmatterScalar(result.provider || "")}`,
    `model: ${frontmatterScalar(result.model || "")}`,
    `sourceHash: ${frontmatterScalar(result.sourceHash || "")}`,
    `generatedAt: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${collectionContext.name || collectionContext.key} ${title}`,
    "",
    markdown.trim(),
    ""
  ].join("\n");
}

function renderCollectionModelReviewUnavailable(collectionContext, results, outputLanguage) {
  const title = outputLanguage === "en-US"
    ? "Model review not generated"
    : outputLanguage === "ja-JP"
      ? "モデルレビュー未生成"
      : "未生成模型综述";
  return [
    `# ${collectionContext.name || collectionContext.key} ${title}`,
    "",
    outputLanguage === "en-US"
      ? "Provider authentication or model configuration is missing. Deterministic collection files were still generated."
      : outputLanguage === "ja-JP"
        ? "プロバイダー認証またはモデル設定が不足しています。決定的な collection ファイルは生成済みです。"
        : "模型接口鉴权或模型配置不完整。确定性的分类矩阵、主题聚类和正式草稿仍已生成。",
    "",
    `- total: ${batchStats(results).total}`
  ].join("\n");
}

function renderCollectionModelReviewFailure(collectionContext, results, outputLanguage, err) {
  const title = outputLanguage === "en-US"
    ? "Model review failed"
    : outputLanguage === "ja-JP"
      ? "モデルレビュー生成失敗"
      : "模型综述生成失败";
  return [
    `# ${collectionContext.name || collectionContext.key} ${title}`,
    "",
    outputLanguage === "en-US"
      ? "The model-generated collection review failed, but deterministic collection files were still generated."
      : outputLanguage === "ja-JP"
        ? "モデルによる collection レビュー生成に失敗しましたが、決定的な collection ファイルは生成済みです。"
        : "模型生成分类综述失败，但确定性的分类矩阵、主题聚类和正式草稿仍已生成。",
    "",
    `- error: ${safeError(err)}`,
    `- total: ${batchStats(results).total}`
  ].join("\n");
}

function frontmatterScalar(value) {
  return JSON.stringify(String(value || ""));
}

const COLLECTION_MARKDOWN_ARTIFACT_KEYS = [
  "collectionReviewPath",
  "modelReviewPath",
  "literatureSearchEvidencePath",
  "reviewReportPath",
  "reviewDraftPath",
  "topicClustersPath",
  "synthesisClaimsPath",
  "synthesisConflictsPath",
  "synthesisRoadmapPath",
  "gapMatrixPath",
  "ideaListPath",
  "chartReviewBatchIndexPath"
];

async function linkCollectionWorkspaceMarkdownArtifacts(collectionContext, artifacts) {
  const linked = [];
  for (const key of COLLECTION_MARKDOWN_ARTIFACT_KEYS) {
    const path = artifacts?.[key];
    if (!path || !await pathExists(path)) continue;
    const title = collectionArtifactAttachmentTitle(collectionContext, path);
    const existing = await findExistingCollectionMarkdownAttachment(collectionContext, title).catch(() => null);
    const attachment = await linkOrUpdateCollectionMarkdownAttachment(collectionContext, path, title, existing);
    if (attachment) linked.push(attachment);
  }
  return linked;
}

async function findExistingCollectionMarkdownAttachment(collectionContext, title) {
  const collection = collectionContext?.collection || collectionByContext(collectionContext);
  if (!collection) return null;
  const childItems = await collectionChildItems(collection);
  for (const item of childItems) {
    if (item?.isRegularItem?.()) continue;
    const itemTitle = item?.getField?.("title") || item?.title || "";
    if (itemTitle === title) return item;
  }
  return null;
}

async function collectionChildItems(collection) {
  if (typeof collection?.getChildItems === "function") {
    const items = await collection.getChildItems();
    return items.map((item) => typeof item === "number" ? Zotero.Items.get(item) : item).filter(Boolean);
  }
  if (typeof collection?.getChildItemsAsync === "function") {
    const items = await collection.getChildItemsAsync();
    return items.map((item) => typeof item === "number" ? Zotero.Items.get(item) : item).filter(Boolean);
  }
  return [];
}

function collectionByContext(collectionContext) {
  const id = Number(collectionContext?.id || collectionContext?.collectionID || 0);
  return id && Zotero.Collections?.get ? Zotero.Collections.get(id) : null;
}

async function linkOrUpdateCollectionMarkdownAttachment(collectionContext, path, title, existing) {
  if (existing) {
    if (typeof existing.setField === "function") existing.setField("title", title);
    else existing.title = title;
    existing.attachmentPath = path;
    existing.attachmentContentType = existing.attachmentContentType || "text/markdown";
    if (typeof existing.saveTx === "function") await existing.saveTx();
    return existing;
  }
  const payload = {
    file: path,
    contentType: "text/markdown",
    title
  };
  const libraryID = Number(collectionContext?.libraryID || collectionContext?.parentLibraryID || 0);
  if (libraryID) payload.libraryID = libraryID;
  const attachment = await Zotero.Attachments.linkFromFile(payload);
  const collectionID = Number(collectionContext?.id || collectionContext?.collectionID || 0);
  if (collectionID && typeof attachment?.addToCollection === "function") {
    attachment.addToCollection(collectionID);
    if (typeof attachment.saveTx === "function") await attachment.saveTx();
  }
  return attachment;
}

function collectionArtifactAttachmentTitle(collectionContext, path) {
  const collectionName = sanitizeFilename(collectionContext?.name || collectionContext?.key || "collection");
  return `Literature Review with LLM - ${collectionName} - ${leafName(path)}`;
}

async function writeCrossCollectionSynthesisIndex(settings, collectionContext, results, outputLanguage, summaryInsights, artifacts) {
  const indexPath = crossCollectionIndexPath(settings);
  const synthesisPath = crossCollectionSynthesisPath(settings, outputLanguage);
  const previous = await readCrossCollectionIndex(indexPath);
  const entry = crossCollectionEntry(collectionContext, results, outputLanguage, summaryInsights, artifacts);
  const collections = upsertCrossCollectionEntry(previous.collections, entry);
  const labels = collectionTemplateLabels(outputLanguage);
  const gapBoard = crossCollectionGapEntries(collections, labels);
  const themeBridgeBoard = crossCollectionThemeBridgeEntries(collections, labels);
  const themeMergeBoard = crossCollectionThemeMergeEntries(collections, labels);
  const clusterMap = crossCollectionClusterMapEntries(collections, labels);
  const layoutBoard = crossCollectionSynthesisLayoutEntries(clusterMap, labels);
  const clusterCalibrationBoard = crossCollectionClusterCalibrationEntries(clusterMap, labels);
  const chartReviewTriage = crossCollectionChartReviewTriageEntries(collections);
  const payload = {
    templateVersion: "cross-collection-index-v1",
    generatedAt: new Date().toISOString(),
    outputLanguage,
    stats: crossCollectionStats(collections),
    clusterMap,
    layoutBoard,
    clusterCalibrationBoard,
    gapBoard,
    themeBridgeBoard,
    themeMergeBoard,
    chartReviewTriage,
    priorityBoard: crossCollectionPriorityEntries(collections, gapBoard, labels, themeMergeBoard, clusterMap),
    collections
  };
  await writeText(indexPath, JSON.stringify(payload, null, 2));
  await writeText(synthesisPath, renderCrossCollectionSynthesis(payload, outputLanguage));
  return {
    crossCollectionIndexPath: indexPath,
    crossCollectionSynthesisPath: synthesisPath
  };
}

function crossCollectionIndexPath(settings) {
  return PathUtils.join(settings.outputDir, "collections", "index.json");
}

function crossCollectionSynthesisPath(settings, outputLanguage) {
  const language = collectionOutputLanguage({ outputLanguage });
  return PathUtils.join(settings.outputDir, "collections", `cross-collection-synthesis.${language}.md`);
}

async function readCrossCollectionIndex(indexPath) {
  try {
    if (!await IOUtils.exists(indexPath)) return { collections: [] };
    const parsed = JSON.parse(await readText(indexPath));
    return {
      collections: Array.isArray(parsed?.collections) ? parsed.collections : []
    };
  } catch (_err) {
    return { collections: [] };
  }
}

function crossCollectionEntry(collectionContext, results, outputLanguage, summaryInsights = new Map(), artifacts = {}) {
  const labels = collectionTemplateLabels(outputLanguage);
  const clusters = topicClusterEntries(results, summaryInsights, labels).slice(0, 8).map((cluster) => ({
    label: cluster.label,
    paperCount: cluster.items.length,
    papers: cluster.items.map(({ item }) => item.title || item.itemKey).slice(0, 8),
    methodSignals: uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean)).slice(0, 4),
    gapSignals: uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds))).slice(0, 4)
  }));
  const claims = synthesisClaimEntries(results, summaryInsights, labels).slice(0, 6).map((entry) => ({
    cluster: entry.cluster,
    claim: entry.claim,
    claimSupportScore: entry.claimSupportScore,
    claimRisk: entry.claimRisk,
    evidenceTrace: entry.evidenceTrace,
    supportingPapers: entry.supportingPapers.slice(0, 6),
    evidence: entry.evidence.slice(0, 6),
    gaps: entry.gaps.slice(0, 4),
    validations: entry.validations.slice(0, 4)
  }));
  const roadmap = synthesisRoadmapEntries(results, summaryInsights, labels).slice(0, 8);
  return {
    key: collectionContext.key,
    name: collectionContext.name || collectionContext.key,
    type: collectionContext.type || "collection",
    parentLibraryID: collectionContext.parentLibraryID || null,
    outputDir: collectionContext.outputDir || artifacts.baseDir || "",
    outputLanguage,
    generatedAt: new Date().toISOString(),
    stats: batchStats(results),
    artifacts: {
      papersIndexPath: artifacts.papersIndexPath || "",
      topicClustersPath: artifacts.topicClustersPath || "",
      synthesisClaimsPath: artifacts.synthesisClaimsPath || "",
      synthesisConflictsPath: artifacts.synthesisConflictsPath || "",
      synthesisRoadmapPath: artifacts.synthesisRoadmapPath || "",
      literatureSearchEvidencePath: artifacts.literatureSearchEvidencePath || "",
      reviewReportPath: artifacts.reviewReportPath || "",
      modelReviewPath: artifacts.modelReviewPath || "",
      collectionReviewPath: artifacts.collectionReviewPath || "",
      ideaListPath: artifacts.ideaListPath || "",
      chartReviewBatchIndexPath: artifacts.chartReviewBatchIndexPath || ""
    },
    chartReview: crossCollectionChartReviewSummary(artifacts.chartReviewBatchIndex, artifacts.chartReviewBatchIndexPath || ""),
    clusters,
    claims,
    openGaps: uniqueInsightLines(roadmap.map((entry) => entry.openGap).filter(Boolean)).slice(0, 8),
    candidateQueries: uniqueInsightLines(roadmap.map((entry) => entry.candidateQuery).filter(Boolean)).slice(0, 8)
  };
}

function upsertCrossCollectionEntry(collections = [], entry) {
  const byKey = new Map((collections || [])
    .filter((item) => item?.key && item.key !== entry.key)
    .map((item) => [item.key, item]));
  byKey.set(entry.key, entry);
  return Array.from(byKey.values()).sort((left, right) => String(left.name || left.key).localeCompare(String(right.name || right.key)));
}

function crossCollectionStats(collections = []) {
  return (collections || []).reduce((stats, collection) => {
    const itemStats = collection?.stats || {};
    stats.collections += 1;
    stats.totalPapers += Number(itemStats.total || 0);
    stats.availableSummaries += Number(itemStats.generated || 0) + Number(itemStats.skippedExisting || 0);
    stats.skippedNoPdf += Number(itemStats.skippedNoPdf || 0);
    stats.failed += Number(itemStats.failed || 0);
    return stats;
  }, { collections: 0, totalPapers: 0, availableSummaries: 0, skippedNoPdf: 0, failed: 0 });
}

function crossCollectionChartReviewSummary(chartReviewBatchIndex, path = "") {
  const rows = Array.isArray(chartReviewBatchIndex?.rows) ? chartReviewBatchIndex.rows : [];
  const stats = chartReviewBatchIndex?.stats || collectionChartReviewBatchStats(chartReviewBatchIndex?.reports || [], rows);
  return {
    path,
    stats: {
      visualReports: Number(stats.visualReports) || 0,
      batchRows: Number(stats.batchRows) || rows.length,
      chartReviewActions: Number(stats.chartReviewActions) || 0,
      openChartReviewActions: Number(stats.openChartReviewActions) || 0,
      highPriorityActions: Number(stats.highPriorityActions) || 0,
      blockedActions: Number(stats.blockedActions) || 0
    },
    rows: rows.slice(0, 12).map((row) => ({
      priority: row.priority || "medium",
      reviewState: normalizeCollectionChartReviewState(row.reviewState || "todo"),
      count: Number(row.count) || 0,
      paperCount: Number(row.paperCount) || 0,
      papers: Array.isArray(row.papers) ? row.papers.slice(0, 8) : [],
      blockingIssue: row.blockingIssue || "",
      batchAction: row.batchAction || "",
      doneCriteria: row.doneCriteria || "",
      sourceReports: Array.isArray(row.sourceReports) ? row.sourceReports.slice(0, 8) : []
    }))
  };
}

function crossCollectionChartReviewTriageEntries(collections = []) {
  const groups = new Map();
  for (const collection of collections || []) {
    const chartReview = collection?.chartReview || {};
    const rows = Array.isArray(chartReview.rows) ? chartReview.rows : [];
    for (const row of rows) {
      const priority = row.priority || "medium";
      const reviewState = normalizeCollectionChartReviewState(row.reviewState || "todo");
      const batchAction = row.batchAction || "";
      const doneCriteria = row.doneCriteria || "";
      const key = [priority, reviewState, batchAction, doneCriteria].join("::");
      if (!groups.has(key)) {
        groups.set(key, {
          priority,
          reviewState,
          count: 0,
          paperCount: 0,
          collectionKeys: new Set(),
          collections: [],
          sourceIndexes: [],
          blockingIssues: [],
          details: [],
          batchAction,
          doneCriteria
        });
      }
      const group = groups.get(key);
      const count = Number(row.count) || 1;
      group.count += count;
      group.paperCount += Number(row.paperCount) || 0;
      if (collection?.key && !group.collectionKeys.has(collection.key)) {
        group.collectionKeys.add(collection.key);
        group.collections.push(collection.name || collection.key);
      }
      if (chartReview.path && !group.sourceIndexes.includes(chartReview.path)) group.sourceIndexes.push(chartReview.path);
      if (row.blockingIssue && !group.blockingIssues.includes(row.blockingIssue)) group.blockingIssues.push(row.blockingIssue);
      group.details.push({
        collectionKey: collection?.key || "",
        collectionName: collection?.name || collection?.key || "",
        priority,
        reviewState,
        count,
        paperCount: Number(row.paperCount) || 0,
        papers: Array.isArray(row.papers) ? row.papers.slice(0, 8) : [],
        blockingIssue: row.blockingIssue || "",
        batchAction,
        doneCriteria,
        sourceReports: Array.isArray(row.sourceReports) ? row.sourceReports.slice(0, 8) : [],
        sourceIndex: chartReview.path || ""
      });
    }
  }
  return Array.from(groups.values()).map((group) => ({
    priority: group.priority,
    reviewState: group.reviewState,
    count: group.count,
    collectionCount: group.collectionKeys.size,
    paperCount: group.paperCount,
    collections: group.collections.slice(0, 8),
    blockingIssue: collectionChartReviewIssueSummary(group.blockingIssues),
    batchAction: group.batchAction,
    doneCriteria: group.doneCriteria,
    sourceIndexes: group.sourceIndexes.slice(0, 8),
    details: group.details.slice(0, 16),
    writebackTargets: crossCollectionChartReviewWritebackTargets({
      priority: group.priority,
      reviewState: group.reviewState,
      blockingIssue: collectionChartReviewIssueSummary(group.blockingIssues),
      batchAction: group.batchAction,
      doneCriteria: group.doneCriteria,
      details: group.details.slice(0, 16)
    })
  })).sort(collectionChartReviewBatchSort);
}

function crossCollectionChartReviewWritebackTargets(entry) {
  const details = Array.isArray(entry?.details) ? entry.details : [];
  return details.map((detail, index) => {
    const currentState = normalizeCollectionChartReviewState(detail.reviewState || entry.reviewState || "todo");
    const targetState = nextCollectionChartReviewWritebackState(currentState);
    const priority = detail.priority || entry.priority || "medium";
    const batchAction = detail.batchAction || entry.batchAction || "";
    const doneCriteria = detail.doneCriteria || entry.doneCriteria || "";
    const sourceReports = Array.isArray(detail.sourceReports) ? detail.sourceReports.slice(0, 8) : [];
    const notes = [
      `triagePriority=${priority}`,
      detail.blockingIssue || entry.blockingIssue || "",
      doneCriteria ? `doneCriteria=${doneCriteria}` : ""
    ].filter(Boolean).join("; ");
    return {
      targetId: `chart-review-status:${priority}:${currentState}:${detail.collectionKey || detail.collectionName || index + 1}:${index + 1}`,
      collectionKey: detail.collectionKey || "",
      collectionName: detail.collectionName || detail.collectionKey || "",
      priority,
      currentState,
      targetState,
      actionCount: Number(detail.count) || 0,
      paperCount: Number(detail.paperCount) || 0,
      papers: Array.isArray(detail.papers) ? detail.papers.slice(0, 8) : [],
      sourceIndex: detail.sourceIndex || "",
      sourceReports,
      match: {
        priority,
        reviewState: currentState,
        batchAction,
        doneCriteria,
        sourceReports
      },
      statusPatch: {
        reviewState: targetState,
        reviewer: "",
        due: "",
        notes
      }
    };
  });
}

function nextCollectionChartReviewWritebackState(reviewState) {
  const normalized = normalizeCollectionChartReviewState(reviewState || "todo");
  if (normalized === "done" || normalized === "discarded") return normalized;
  if (normalized === "in-review") return "done";
  return "in-review";
}

function renderCrossCollectionChartReviewTriageRows(entries, labels) {
  const rows = (entries || []).slice(0, 16).map((entry) => [
    escapeMarkdownTable(entry.priority || ""),
    escapeMarkdownTable(entry.reviewState || ""),
    Number(entry.count) || 0,
    Number(entry.collectionCount) || 0,
    Number(entry.paperCount) || 0,
    escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
    escapeMarkdownTable(entry.blockingIssue || labels.crossCollectionChartReviewNoIssue),
    escapeMarkdownTable(entry.batchAction || labels.crossCollectionChartReviewActionPending),
    escapeMarkdownTable(entry.doneCriteria || labels.crossCollectionChartReviewDonePending),
    escapeMarkdownTable((entry.sourceIndexes || []).join("; ") || labels.crossCollectionChartReviewIndexPending)
  ].join(" | ")).map((row) => `| ${row} |`);
  return [
    `| ${labels.crossCollectionPriorityColumn} | ${labels.crossCollectionChartReviewStateColumn} | ${labels.crossCollectionChartReviewActionCountColumn} | ${labels.crossCollectionChartReviewCollectionCountColumn || labels.collectionColumn} | ${labels.crossCollectionChartReviewPaperCountColumn || labels.paperColumn} | ${labels.crossCollectionChartReviewCollectionsColumn} | ${labels.crossCollectionChartReviewBlockingColumn} | ${labels.crossCollectionChartReviewBatchActionColumn} | ${labels.crossCollectionChartReviewDoneColumn} | ${labels.crossCollectionChartReviewIndexColumn} |`,
    "| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |",
    rows.join("\n") || `|  |  | 0 | 0 | 0 |  | ${escapeMarkdownTable(labels.crossCollectionChartReviewEmpty)} |  |  |  |`
  ].join("\n");
}

function renderCrossCollectionChartReviewDrilldown(entries, labels) {
  const visible = (entries || []).slice(0, 10);
  if (!visible.length) return `- ${labels.crossCollectionChartReviewEmpty}`;
  return visible.map((entry, index) => {
    const title = labels.crossCollectionChartReviewDrilldownSummary?.(index + 1, entry) || `${index + 1}. ${entry.priority || ""} ${entry.reviewState || ""}`;
    const details = Array.isArray(entry.details) ? entry.details : [];
    const writebackTargets = Array.isArray(entry.writebackTargets)
      ? entry.writebackTargets
      : crossCollectionChartReviewWritebackTargets(entry);
    const detailRows = details.map((detail) => [
      escapeMarkdownTable(detail.collectionName || detail.collectionKey || ""),
      Number(detail.count) || 0,
      Number(detail.paperCount) || 0,
      escapeMarkdownTable((detail.papers || []).join("; ") || labels.noSummary),
      escapeMarkdownTable(detail.blockingIssue || labels.crossCollectionChartReviewNoIssue),
      escapeMarkdownTable((detail.sourceReports || []).join("; ") || labels.pendingSummaryPath),
      escapeMarkdownTable(detail.sourceIndex || labels.crossCollectionChartReviewIndexPending)
    ].join(" | ")).map((row) => `| ${row} |`);
    const writebackRows = writebackTargets.map((target) => [
      escapeMarkdownTable(target.collectionName || target.collectionKey || ""),
      escapeMarkdownTable(target.currentState || ""),
      escapeMarkdownTable(target.targetState || ""),
      Number(target.actionCount) || 0,
      escapeMarkdownTable(crossCollectionChartReviewStatusPatchText(target.statusPatch, labels)),
      escapeMarkdownTable(crossCollectionChartReviewMatchText(target.match, labels)),
      escapeMarkdownTable(target.sourceIndex || labels.crossCollectionChartReviewIndexPending)
    ].join(" | ")).map((row) => `| ${row} |`);
    return [
      "<details>",
      `<summary>${escapeHtmlText(title)}</summary>`,
      "",
      `- ${labels.crossCollectionChartReviewBatchActionColumn}: ${entry.batchAction || labels.crossCollectionChartReviewActionPending}`,
      `- ${labels.crossCollectionChartReviewDoneColumn}: ${entry.doneCriteria || labels.crossCollectionChartReviewDonePending}`,
      `- ${labels.crossCollectionChartReviewBlockingColumn}: ${entry.blockingIssue || labels.crossCollectionChartReviewNoIssue}`,
      "",
      `| ${labels.collectionColumn} | ${labels.crossCollectionChartReviewActionCountColumn} | ${labels.crossCollectionChartReviewPaperCountColumn || labels.paperColumn} | ${labels.paperColumn} | ${labels.crossCollectionChartReviewBlockingColumn} | ${labels.reportColumn} | ${labels.crossCollectionChartReviewIndexColumn} |`,
      "| --- | ---: | ---: | --- | --- | --- | --- |",
      detailRows.join("\n") || `|  | 0 | 0 |  | ${escapeMarkdownTable(labels.crossCollectionChartReviewEmpty)} |  |  |`,
      "",
      `#### ${labels.crossCollectionChartReviewWritebackTargets}`,
      "",
      `| ${labels.collectionColumn} | ${labels.crossCollectionChartReviewCurrentStateColumn} | ${labels.crossCollectionChartReviewTargetStateColumn} | ${labels.crossCollectionChartReviewActionCountColumn} | ${labels.crossCollectionChartReviewStatusPatchColumn} | ${labels.crossCollectionChartReviewMatchColumn} | ${labels.crossCollectionChartReviewIndexColumn} |`,
      "| --- | --- | --- | ---: | --- | --- | --- |",
      writebackRows.join("\n") || `|  |  |  | 0 |  |  | ${escapeMarkdownTable(labels.crossCollectionChartReviewIndexPending)} |`,
      "",
      `- [ ] ${labels.crossCollectionChartReviewChecklistOpenIndexes}`,
      `- [ ] ${labels.crossCollectionChartReviewChecklistVerifyPapers}`,
      `- [ ] ${labels.crossCollectionChartReviewChecklistUpdateState}`,
      "",
      "</details>"
    ].join("\n");
  }).join("\n\n");
}

function crossCollectionChartReviewStatusPatchText(statusPatch = {}, labels = {}) {
  const state = statusPatch.reviewState || "";
  const reviewer = statusPatch.reviewer || "";
  const due = statusPatch.due || "";
  const notes = statusPatch.notes || "";
  return [
    `${labels.crossCollectionChartReviewStateColumn || "state"}=${state}`,
    `reviewer=${reviewer}`,
    `due=${due}`,
    notes ? `notes=${notes}` : ""
  ].filter(Boolean).join("; ");
}

function crossCollectionChartReviewMatchText(match = {}, labels = {}) {
  return [
    `priority=${match.priority || ""}`,
    `${labels.crossCollectionChartReviewStateColumn || "state"}=${match.reviewState || ""}`,
    `action=${match.batchAction || ""}`,
    match.doneCriteria ? `done=${match.doneCriteria}` : ""
  ].filter(Boolean).join("; ");
}

function renderCrossCollectionSynthesis(indexPayload, outputLanguage = "zh-CN") {
  const labels = collectionTemplateLabels(outputLanguage);
  const collections = Array.isArray(indexPayload?.collections) ? indexPayload.collections : [];
  const inventoryRows = collections.map((collection) => [
    escapeMarkdownTable(collection.name || collection.key),
    escapeMarkdownTable(collection.stats?.total || 0),
    escapeMarkdownTable((collection.clusters || []).map((cluster) => `${cluster.label} (${cluster.paperCount || 0})`).join("; ") || labels.noSummary),
    escapeMarkdownTable((collection.openGaps || []).slice(0, 3).join("; ") || labels.gapMatrixPendingEvidence),
    escapeMarkdownTable(collection.artifacts?.reviewReportPath || collection.outputDir || "")
  ].join(" | ")).map((row) => `| ${row} |`).join("\n") || "|  |  |  |  |  |";
  return [
    `# ${labels.crossCollectionSynthesis}`,
    "",
    labels.crossCollectionSynthesisNote,
    "",
    `## ${labels.crossCollectionInventory}`,
    "",
    labels.crossCollectionStatsLine(indexPayload?.stats || crossCollectionStats(collections)),
    "",
    `| ${labels.collectionColumn} | ${labels.paperColumn} | ${labels.clusterColumn} | ${labels.gapSignalColumn} | ${labels.reportColumn} |`,
    "| --- | --- | --- | --- | --- |",
    inventoryRows,
    "",
    `## ${labels.crossCollectionThemeMap}`,
    "",
    renderCrossCollectionThemeRows(collections, labels),
    "",
    `## ${labels.crossCollectionClusterMap}`,
    "",
    renderCrossCollectionClusterRows(indexPayload?.clusterMap || crossCollectionClusterMapEntries(collections, labels), labels),
    "",
    `## ${labels.crossCollectionSynthesisLayoutBoard}`,
    "",
    renderCrossCollectionSynthesisLayoutRows(indexPayload?.layoutBoard || crossCollectionSynthesisLayoutEntries(
      indexPayload?.clusterMap || crossCollectionClusterMapEntries(collections, labels),
      labels
    ), labels),
    "",
    `## ${labels.crossCollectionClusterCalibrationBoard}`,
    "",
    renderCrossCollectionClusterCalibrationRows(indexPayload?.clusterCalibrationBoard || crossCollectionClusterCalibrationEntries(
      indexPayload?.clusterMap || crossCollectionClusterMapEntries(collections, labels),
      labels
    ), labels),
    "",
    `## ${labels.crossCollectionClusterEvidenceCards}`,
    "",
    renderCrossCollectionClusterEvidenceCards(indexPayload?.clusterMap || crossCollectionClusterMapEntries(collections, labels), labels),
    "",
    `## ${labels.crossCollectionThemeMergeBoard}`,
    "",
    renderCrossCollectionThemeMergeRows(indexPayload?.themeMergeBoard || crossCollectionThemeMergeEntries(collections, labels), labels),
    "",
    `## ${labels.crossCollectionBridgeBoard}`,
    "",
    renderCrossCollectionBridgeRows(indexPayload?.themeBridgeBoard || crossCollectionThemeBridgeEntries(collections, labels), labels),
    "",
    `## ${labels.crossCollectionGapBoard}`,
    "",
    renderCrossCollectionGapRows(indexPayload?.gapBoard || crossCollectionGapEntries(collections, labels), labels),
    "",
    `## ${labels.crossCollectionPriorityBoard}`,
    "",
    renderCrossCollectionPriorityRows(indexPayload?.priorityBoard || crossCollectionPriorityEntries(
      collections,
      indexPayload?.gapBoard || crossCollectionGapEntries(collections, labels),
      labels,
      indexPayload?.themeMergeBoard || crossCollectionThemeMergeEntries(collections, labels),
      indexPayload?.clusterMap || crossCollectionClusterMapEntries(collections, labels)
    ), labels),
    "",
    `## ${labels.crossCollectionChartReviewTriage}`,
    "",
    renderCrossCollectionChartReviewTriageRows(indexPayload?.chartReviewTriage || crossCollectionChartReviewTriageEntries(collections), labels),
    "",
    `### ${labels.crossCollectionChartReviewDrilldown}`,
    "",
    renderCrossCollectionChartReviewDrilldown(indexPayload?.chartReviewTriage || crossCollectionChartReviewTriageEntries(collections), labels),
    "",
    `## ${labels.crossCollectionReviewPack}`,
    "",
    renderCrossCollectionReviewPack(indexPayload, labels),
    "",
    `## ${labels.reportNextActions}`,
    "",
    labels.crossCollectionNextActions,
    ""
  ].join("\n");
}

function renderCrossCollectionReviewPack(indexPayload, labels) {
  const collections = Array.isArray(indexPayload?.collections) ? indexPayload.collections : [];
  const mergeBoard = indexPayload?.themeMergeBoard || crossCollectionThemeMergeEntries(collections, labels);
  const clusterMap = indexPayload?.clusterMap || crossCollectionClusterMapEntries(collections, labels);
  const rankedClusterCards = crossCollectionClusterEvidenceCardEntries(clusterMap, labels);
  const priorityBoard = indexPayload?.priorityBoard || crossCollectionPriorityEntries(collections, indexPayload?.gapBoard || crossCollectionGapEntries(collections, labels), labels, mergeBoard, clusterMap);
  const bridgeBoard = indexPayload?.themeBridgeBoard || crossCollectionThemeBridgeEntries(collections, labels);
  const gapBoard = indexPayload?.gapBoard || crossCollectionGapEntries(collections, labels);
  const rows = [];
  for (const entry of (rankedClusterCards || []).filter((cluster) => Number(cluster?.collectionCount || 0) >= 2).slice(0, 4)) {
    const scope = entry.title || labels.clusterOther;
    const gap = uniqueInsightLines(entry.gapSignals || []).slice(0, 3).join("; ") || labels.gapMatrixPendingEvidence;
    rows.push(crossCollectionReviewPackRow({
      scope,
      collections: entry.collections || [],
      evidence: uniqueInsightLines([...(entry.themes || []), ...(entry.methodSignals || [])]).slice(0, 5),
      gap,
      prompt: entry.synthesisPrompt || labels.crossCollectionClusterPrompt(scope, entry.collectionCount || 0),
      manualReview: entry.reviewAction || labels.crossCollectionClusterReviewAction(scope)
    }, labels));
  }
  for (const entry of (priorityBoard || []).slice(0, 6)) {
    const scope = entry.priority || labels.crossCollectionPriorityPending;
    const gap = entry.reason || labels.crossCollectionPriorityReasonPending;
    rows.push(crossCollectionReviewPackRow({
      scope,
      collections: entry.collections || [],
      evidence: entry.evidence || [],
      gap,
      prompt: labels.crossCollectionReviewPrompt(scope, gap),
      manualReview: entry.nextAction || labels.crossCollectionReviewAction(scope)
    }, labels));
  }
  for (const entry of (bridgeBoard || []).slice(0, 4)) {
    const scope = entry.theme || labels.clusterOther;
    const gap = uniqueInsightLines(entry.gapSignals || []).slice(0, 3).join("; ") || labels.gapMatrixPendingEvidence;
    rows.push(crossCollectionReviewPackRow({
      scope,
      collections: entry.collections || [],
      evidence: uniqueInsightLines([...(entry.methodSignals || []), `papers: ${entry.paperCount || 0}`]).slice(0, 5),
      gap,
      prompt: entry.bridgeQuestion || labels.crossCollectionReviewPrompt(scope, gap),
      manualReview: entry.nextAction || labels.crossCollectionReviewAction(scope)
    }, labels));
  }
  for (const entry of (gapBoard || []).slice(0, 4)) {
    const scope = entry.gap || labels.gapMatrixPendingEvidence;
    rows.push(crossCollectionReviewPackRow({
      scope,
      collections: entry.collections || [],
      evidence: uniqueInsightLines([...(entry.themes || []), ...(entry.candidateQueries || [])]).slice(0, 5),
      gap: entry.gap || labels.gapMatrixPendingEvidence,
      prompt: labels.crossCollectionGapWritingPrompt(entry.gap || labels.gapMatrixPendingEvidence),
      manualReview: entry.nextAction || labels.crossCollectionReviewAction(scope)
    }, labels));
  }
  const uniqueRows = uniqueInsightLines(rows).slice(0, 12);
  return [
    `| ${labels.crossCollectionScopeColumn} | ${labels.collectionColumn} | ${labels.evidenceAnchorColumn} | ${labels.gapSignalColumn} | ${labels.modelDeepeningPromptColumn} | ${labels.manualReviewColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    uniqueRows.join("\n") || "|  |  |  |  |  |  |"
  ].join("\n");
}

function renderCrossCollectionClusterRows(clusterEntries, labels) {
  const rows = (clusterEntries || []).slice(0, 16)
    .map((entry) => [
      escapeMarkdownTable(entry.title || labels.clusterOther),
      escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
      escapeMarkdownTable(entry.paperCount || 0),
      escapeMarkdownTable((entry.themes || []).join("; ") || labels.clusterOther),
      escapeMarkdownTable(entry.clusterScore || 0),
      escapeMarkdownTable(entry.supportLevel || labels.crossCollectionClusterSupport(0, 0)),
      escapeMarkdownTable((entry.linkSignals || []).slice(0, 3).join("; ") || labels.crossCollectionClusterLinkPending),
      escapeMarkdownTable(entry.reviewAction || labels.crossCollectionClusterReviewAction(entry.title || labels.clusterOther))
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.crossCollectionClusterScopeColumn} | ${labels.collectionColumn} | ${labels.paperColumn} | ${labels.crossCollectionThemeCandidatesColumn} | ${labels.crossCollectionClusterScoreColumn} | ${labels.crossCollectionSupportColumn} | ${labels.crossCollectionClusterLinkColumn} | ${labels.reviewActionColumn} |`,
    "| --- | --- | --- | --- | ---: | --- | --- | --- |",
    rows.join("\n") || "|  |  |  |  |  |  |  |  |"
  ].join("\n");
}

function renderCrossCollectionSynthesisLayoutRows(layoutEntries, labels) {
  const rows = (layoutEntries || []).slice(0, 16)
    .map((entry) => [
      escapeMarkdownTable(entry.lane || labels.crossCollectionLayoutLaneSupport),
      escapeMarkdownTable(entry.order || ""),
      escapeMarkdownTable(entry.cluster || labels.clusterOther),
      escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
      escapeMarkdownTable(entry.layoutWeight || 0),
      escapeMarkdownTable((entry.evidence || []).join("; ") || labels.pendingInsight),
      escapeMarkdownTable(entry.nextAction || labels.crossCollectionClusterReviewAction(entry.cluster || labels.clusterOther))
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.crossCollectionLayoutLaneColumn} | ${labels.crossCollectionLayoutOrderColumn} | ${labels.crossCollectionClusterScopeColumn} | ${labels.collectionColumn} | ${labels.crossCollectionLayoutWeightColumn} | ${labels.evidenceColumn} | ${labels.reviewActionColumn} |`,
    "| --- | ---: | --- | --- | ---: | --- | --- |",
    rows.join("\n") || "|  |  |  |  | 0 |  |  |"
  ].join("\n");
}

function crossCollectionSynthesisLayoutEntries(clusterEntries = [], labels = collectionTemplateLabels("zh-CN")) {
  const laneOrder = {
    [labels.crossCollectionLayoutLaneCore]: 0,
    [labels.crossCollectionLayoutLaneBoundary]: 1,
    [labels.crossCollectionLayoutLaneGap]: 2,
    [labels.crossCollectionLayoutLaneSupport]: 3
  };
  const grouped = new Map();
  for (const cluster of crossCollectionClusterEvidenceCardEntries(clusterEntries, labels)) {
    const calibration = crossCollectionClusterCalibration(cluster, labels);
    const rank = Number(cluster.evidenceCardRank || 0);
    const collectionCount = Number(cluster.collectionCount || 0);
    const linkCount = (cluster.linkSignals || []).length;
    const gapCount = (cluster.gapSignals || []).length;
    const highRisk = /high|高|広/.test(String(cluster.reviewRisk || calibration.reviewRisk || "").toLowerCase());
    const lane = highRisk || calibration.key === "split"
      ? labels.crossCollectionLayoutLaneBoundary
      : (collectionCount >= 2 && calibration.key === "merge" && rank >= 120)
        ? labels.crossCollectionLayoutLaneCore
        : gapCount || calibration.key === "gather"
          ? labels.crossCollectionLayoutLaneGap
          : labels.crossCollectionLayoutLaneSupport;
    const layoutWeight = Math.round(
      rank
      + Math.min(Number(cluster.clusterScore || 0), 100)
      + Math.min(collectionCount, 6) * 12
      + Math.min(linkCount, 6) * 8
      + Math.min(gapCount, 6) * 3
    );
    const evidence = uniqueInsightLines([
      `${labels.crossCollectionEvidenceRankColumn}: ${rank}`,
      `${labels.crossCollectionClusterScoreColumn}: ${cluster.clusterScore || 0}`,
      `${labels.crossCollectionClusterLinkColumn}: ${(cluster.linkSignals || []).slice(0, 2).join("; ") || labels.crossCollectionClusterLinkPending}`,
      `${labels.crossCollectionClusterRecommendationColumn}: ${calibration.recommendation || labels.crossCollectionClusterCalibrationReview}`,
      gapCount ? `${labels.gapSignalColumn}: ${(cluster.gapSignals || []).slice(0, 2).join("; ")}` : ""
    ]).slice(0, 5);
    const entry = {
      lane,
      laneRank: laneOrder[lane] ?? 9,
      cluster: cluster.title || labels.clusterOther,
      collections: cluster.collections || [],
      layoutWeight,
      evidence,
      nextAction: labels.crossCollectionLayoutAction(lane, cluster.title || labels.clusterOther)
    };
    if (!grouped.has(lane)) grouped.set(lane, []);
    grouped.get(lane).push(entry);
  }
  const entries = [];
  for (const lane of Object.keys(laneOrder)) {
    const rows = (grouped.get(lane) || [])
      .sort((left, right) => Number(right.layoutWeight || 0) - Number(left.layoutWeight || 0) || String(left.cluster || "").localeCompare(String(right.cluster || "")));
    rows.forEach((entry, index) => entries.push({
      ...entry,
      order: index + 1
    }));
  }
  return entries
    .sort((left, right) => Number(left.laneRank || 0) - Number(right.laneRank || 0) || Number(left.order || 0) - Number(right.order || 0))
    .slice(0, 16)
    .map(({ laneRank: _laneRank, ...entry }) => entry);
}

function renderCrossCollectionClusterCalibrationRows(calibrationEntries, labels) {
  const rows = (calibrationEntries || []).slice(0, 16)
    .map((entry) => [
      escapeMarkdownTable(entry.cluster || labels.clusterOther),
      escapeMarkdownTable(entry.recommendation || labels.crossCollectionClusterCalibrationReview),
      escapeMarkdownTable(entry.thresholdBand || labels.crossCollectionClusterThresholdPending),
      escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
      escapeMarkdownTable((entry.evidence || []).join("; ") || labels.crossCollectionClusterLinkPending),
      escapeMarkdownTable(entry.nextAction || labels.crossCollectionClusterCalibrationAction(entry.cluster || labels.clusterOther, entry.recommendation || ""))
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.crossCollectionClusterScopeColumn} | ${labels.crossCollectionClusterRecommendationColumn} | ${labels.crossCollectionClusterThresholdColumn} | ${labels.collectionColumn} | ${labels.evidenceColumn} | ${labels.reviewActionColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    rows.join("\n") || "|  |  |  |  |  |  |"
  ].join("\n");
}

function renderCrossCollectionClusterEvidenceCards(clusterEntries, labels) {
  const cards = crossCollectionClusterEvidenceCardEntries(clusterEntries, labels).map((entry) => [
    `### ${entry.title || labels.clusterOther}`,
    "",
    `- ${labels.collectionColumn}: ${(entry.collections || []).join("; ") || labels.noSummary}`,
    `- ${labels.crossCollectionThemeCandidatesColumn}: ${(entry.themes || []).join("; ") || labels.clusterOther}`,
    `- ${labels.crossCollectionEvidenceRankColumn}: ${entry.evidenceCardRank || 0}`,
    `- ${labels.crossCollectionEvidenceRankSignalsColumn}: ${(entry.evidenceCardRankSignals || []).join("; ") || labels.crossCollectionClusterLinkPending}`,
    `- ${labels.crossCollectionClusterScoreColumn}: ${entry.clusterScore || 0}`,
    `- ${labels.supportLevelColumn}: ${entry.supportLevel || labels.crossCollectionClusterSupport(0, 0)}`,
    `- ${labels.crossCollectionClusterLinkColumn}: ${(entry.linkSignals || []).join("; ") || labels.crossCollectionClusterLinkPending}`,
    `- ${labels.crossCollectionClusterThresholdColumn}: ${entry.thresholdBand || labels.crossCollectionClusterThresholdPending}`,
    `- ${labels.crossCollectionClusterRecommendationColumn}: ${entry.calibrationRecommendation || labels.crossCollectionClusterCalibrationReview}`,
    `- ${labels.crossCollectionClusterRiskColumn}: ${entry.reviewRisk || labels.crossCollectionClusterRiskPending}`,
    `- ${labels.methodSignalColumn}: ${(entry.methodSignals || []).join("; ") || labels.pendingInsight}`,
    `- ${labels.gapSignalColumn}: ${(entry.gapSignals || []).join("; ") || labels.gapMatrixPendingEvidence}`,
    `- ${labels.roadmapCandidateQueryColumn}: ${(entry.candidateQueries || []).join("; ") || labels.roadmapCandidateQueryColumn}`,
    `- ${labels.evidenceAnchorColumn}: ${(entry.evidenceAnchors || []).join("; ") || labels.pendingSummaryPath}`,
    `- ${labels.modelDeepeningPromptColumn}: ${entry.synthesisPrompt || labels.crossCollectionClusterPrompt(entry.title || labels.clusterOther, entry.collectionCount || 0)}`,
    `- ${labels.reviewActionColumn}: ${entry.reviewAction || labels.crossCollectionClusterReviewAction(entry.title || labels.clusterOther)}`,
    ""
  ].join("\n"));
  return cards.join("\n") || labels.crossCollectionClusterNoEvidence;
}

function crossCollectionClusterEvidenceCardEntries(clusterEntries = [], labels = collectionTemplateLabels("zh-CN")) {
  return (clusterEntries || [])
    .map((entry) => {
      const ranking = crossCollectionClusterEvidenceCardRanking(entry, labels);
      return {
        ...entry,
        evidenceCardRank: ranking.score,
        evidenceCardRankSignals: ranking.signals
      };
    })
    .sort((left, right) => Number(right.evidenceCardRank || 0) - Number(left.evidenceCardRank || 0)
      || Number(right.clusterScore || 0) - Number(left.clusterScore || 0)
      || Number(right.collectionCount || 0) - Number(left.collectionCount || 0)
      || String(left.title || "").localeCompare(String(right.title || "")))
    .slice(0, 12);
}

function crossCollectionClusterEvidenceCardRanking(cluster = {}, labels = collectionTemplateLabels("zh-CN")) {
  const calibration = crossCollectionClusterCalibration(cluster, labels);
  const collectionCount = Number(cluster?.collectionCount || 0);
  const paperCount = Number(cluster?.paperCount || 0);
  const clusterScore = Number(cluster?.clusterScore || 0);
  const linkCount = (cluster?.linkSignals || []).length;
  const methodCount = (cluster?.methodSignals || []).length;
  const gapCount = (cluster?.gapSignals || []).length;
  const queryCount = (cluster?.candidateQueries || []).length;
  const riskText = String(cluster?.reviewRisk || calibration.reviewRisk || "").toLowerCase();
  const highRisk = /high|高|広/.test(riskText);
  const mediumRisk = /medium|中/.test(riskText);
  const recommendationKey = calibration.key || "review";
  const recommendationBonus = {
    merge: 28,
    review: 20,
    split: 16,
    gather: 6
  }[recommendationKey] || 12;
  const riskBonus = highRisk ? 14 : mediumRisk ? 9 : 3;
  const score = Math.round(
    clusterScore
    + Math.min(collectionCount, 6) * 14
    + Math.min(linkCount, 6) * 10
    + Math.min(paperCount, 20)
    + Math.min(methodCount, 6) * 3
    + Math.min(gapCount, 6) * 3
    + Math.min(queryCount, 4) * 2
    + recommendationBonus
    + riskBonus
  );
  const signals = uniqueInsightLines([
    labels.crossCollectionEvidenceRankCoverage(collectionCount, paperCount),
    labels.crossCollectionEvidenceRankLinks(linkCount),
    labels.crossCollectionEvidenceRankCalibration(calibration.recommendation),
    labels.crossCollectionEvidenceRankRisk(cluster?.reviewRisk || calibration.reviewRisk || labels.crossCollectionClusterRiskPending)
  ]).slice(0, 4);
  return { score, signals };
}

function crossCollectionReviewPackRow(entry, labels) {
  return `| ${[
    escapeMarkdownTable(entry.scope || labels.clusterOther),
    escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
    escapeMarkdownTable((entry.evidence || []).join("; ") || labels.pendingSummaryPath),
    escapeMarkdownTable(entry.gap || labels.gapMatrixPendingEvidence),
    escapeMarkdownTable(entry.prompt || labels.crossCollectionReviewPrompt(entry.scope || labels.clusterOther, entry.gap || labels.gapMatrixPendingEvidence)),
    escapeMarkdownTable(entry.manualReview || labels.crossCollectionReviewAction(entry.scope || labels.clusterOther))
  ].join(" | ")} |`;
}

function renderCrossCollectionBridgeRows(bridgeEntries, labels) {
  const rows = (bridgeEntries || []).slice(0, 12)
    .map((entry) => [
      escapeMarkdownTable(entry.theme || labels.clusterOther),
      escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
      escapeMarkdownTable(entry.paperCount || 0),
      escapeMarkdownTable((entry.methodSignals || []).join("; ") || labels.pendingInsight),
      escapeMarkdownTable((entry.gapSignals || []).join("; ") || labels.gapMatrixPendingEvidence),
      escapeMarkdownTable(entry.bridgeQuestion || labels.crossCollectionBridgeQuestion?.(entry.theme || labels.clusterOther, entry.collectionCount || 0) || labels.roadmapQuestionColumn),
      escapeMarkdownTable(entry.nextAction || labels.crossCollectionBridgeAction?.(entry.theme || labels.clusterOther) || labels.reviewActionColumn)
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.clusterColumn} | ${labels.collectionColumn} | ${labels.paperColumn} | ${labels.methodSignalColumn} | ${labels.gapSignalColumn} | ${labels.roadmapQuestionColumn} | ${labels.reviewActionColumn} |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    rows.join("\n") || "|  |  |  |  |  |  |  |"
  ].join("\n");
}

function renderCrossCollectionThemeMergeRows(mergeEntries, labels) {
  const rows = (mergeEntries || []).slice(0, 12)
    .map((entry) => [
      escapeMarkdownTable(entry.scope || labels.crossCollectionMergePending),
      escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
      escapeMarkdownTable((entry.themeCandidates || []).join("; ") || labels.clusterOther),
      escapeMarkdownTable((entry.sharedSignals || []).join("; ") || labels.pendingInsight),
      escapeMarkdownTable(entry.risk || labels.crossCollectionMergeRiskPending),
      escapeMarkdownTable(entry.reviewAction || labels.crossCollectionMergeAction(entry.scope || labels.crossCollectionMergePending))
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.crossCollectionMergeScopeColumn} | ${labels.collectionColumn} | ${labels.crossCollectionThemeCandidatesColumn} | ${labels.crossCollectionSharedSignalsColumn} | ${labels.crossCollectionMergeRiskColumn} | ${labels.reviewActionColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    rows.join("\n") || "|  |  |  |  |  |  |"
  ].join("\n");
}

function renderCrossCollectionPriorityRows(priorityEntries, labels) {
  const rows = (priorityEntries || []).slice(0, 12)
    .map((entry) => [
      escapeMarkdownTable(entry.priority || labels.crossCollectionPriorityPending),
      escapeMarkdownTable(entry.reason || labels.crossCollectionPriorityReasonPending),
      escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
      escapeMarkdownTable((entry.evidence || []).join("; ") || labels.pendingSummaryPath),
      escapeMarkdownTable(entry.nextAction || labels.reviewActionColumn)
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.crossCollectionPriorityColumn} | ${labels.crossCollectionReasonColumn} | ${labels.collectionColumn} | ${labels.evidenceColumn} | ${labels.reviewActionColumn} |`,
    "| --- | --- | --- | --- | --- |",
    rows.join("\n") || "|  |  |  |  |  |"
  ].join("\n");
}

function renderCrossCollectionGapRows(gapEntries, labels) {
  const rows = (gapEntries || []).slice(0, 12)
    .map((entry) => [
      escapeMarkdownTable(entry.gap || labels.gapMatrixPendingEvidence),
      escapeMarkdownTable(entry.gapPriorityScore || 0),
      escapeMarkdownTable((entry.gapPrioritySignals || []).join("; ") || labels.crossCollectionGapPriorityPending),
      escapeMarkdownTable((entry.collections || []).join("; ") || labels.noSummary),
      escapeMarkdownTable((entry.themes || []).join("; ") || labels.clusterOther),
      escapeMarkdownTable((entry.candidateQueries || []).slice(0, 3).join("; ") || labels.roadmapCandidateQueryColumn),
      escapeMarkdownTable(entry.nextAction || labels.crossCollectionGapAction?.(entry.collectionCount || 0, entry.gap || "") || labels.reviewActionColumn)
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.gapSignalColumn} | ${labels.crossCollectionGapPriorityColumn} | ${labels.crossCollectionGapPrioritySignalsColumn} | ${labels.collectionColumn} | ${labels.clusterColumn} | ${labels.roadmapCandidateQueryColumn} | ${labels.reviewActionColumn} |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    rows.join("\n") || "|  |  |  |  |  |  |  |"
  ].join("\n");
}

function crossCollectionGapEntries(collections = [], labels = collectionTemplateLabels("zh-CN")) {
  const byGap = new Map();
  for (const collection of collections || []) {
    const collectionName = collection?.name || collection?.key || "";
    const signals = crossCollectionGapSignals(collection, labels);
    for (const signal of signals) {
      const key = normalizedCrossCollectionGapKey(signal.gap);
      if (!key) continue;
      if (!byGap.has(key)) {
        byGap.set(key, {
          gap: signal.gap,
          collections: [],
          themes: [],
          candidateQueries: []
        });
      }
      const entry = byGap.get(key);
      entry.collections.push(collectionName);
      entry.themes.push(signal.theme || labels.clusterOther);
      entry.candidateQueries.push(...crossCollectionCandidateQueriesForGap(collection, signal, labels));
    }
  }
  return Array.from(byGap.values())
    .map((entry) => {
      const collections = uniqueInsightLines(entry.collections).slice(0, 8);
      const themes = uniqueInsightLines(entry.themes).slice(0, 8);
      const candidateQueries = uniqueInsightLines(entry.candidateQueries).slice(0, 5);
      const priorityRanking = crossCollectionGapPriorityRanking({
        ...entry,
        collectionCount: collections.length,
        collections,
        themes,
        candidateQueries
      }, labels);
      return {
        gap: entry.gap,
        collectionCount: collections.length,
        collections,
        themes,
        candidateQueries,
        gapPriorityScore: priorityRanking.score,
        gapPrioritySignals: priorityRanking.signals,
        nextAction: labels.crossCollectionGapAction(collections.length, entry.gap)
      };
    })
    .sort((left, right) => (right.gapPriorityScore || 0) - (left.gapPriorityScore || 0) || right.collectionCount - left.collectionCount || left.gap.localeCompare(right.gap))
    .slice(0, 20);
}

function crossCollectionGapPriorityRanking(gap = {}, labels = collectionTemplateLabels("zh-CN")) {
  const collectionCount = Number(gap.collectionCount || (gap.collections || []).length || 0);
  const themeCount = uniqueInsightLines(gap.themes || []).length;
  const queryCount = uniqueInsightLines(gap.candidateQueries || []).length;
  const recurringBonus = collectionCount >= 2 ? 12 : 0;
  const score = Math.min(100, Math.round(
    Math.min(collectionCount, 6) * 28
    + Math.min(themeCount, 8) * 4
    + Math.min(queryCount, 5) * 4
    + recurringBonus
  ));
  return {
    score,
    signals: uniqueInsightLines([
      labels.crossCollectionGapPriorityCoverage(collectionCount),
      labels.crossCollectionGapPriorityThemes(themeCount),
      labels.crossCollectionGapPriorityQueries(queryCount),
      collectionCount >= 2 ? labels.crossCollectionGapPriorityRecurring(collectionCount) : labels.crossCollectionGapPrioritySingle
    ]).filter(Boolean)
  };
}

function crossCollectionThemeBridgeEntries(collections = [], labels = collectionTemplateLabels("zh-CN")) {
  const byTheme = new Map();
  for (const collection of collections || []) {
    const collectionName = collection?.name || collection?.key || "";
    for (const cluster of collection?.clusters || []) {
      const theme = cluster?.label || labels.clusterOther;
      const key = normalizedCrossCollectionThemeKey(theme);
      if (!key) continue;
      if (!byTheme.has(key)) {
        byTheme.set(key, {
          theme,
          collections: [],
          paperCount: 0,
          methodSignals: [],
          gapSignals: []
        });
      }
      const entry = byTheme.get(key);
      entry.collections.push(collectionName);
      entry.paperCount += Number(cluster?.paperCount || 0);
      entry.methodSignals.push(...(cluster?.methodSignals || []));
      entry.gapSignals.push(...(cluster?.gapSignals || []));
    }
  }
  return Array.from(byTheme.values())
    .map((entry) => {
      const collections = uniqueInsightLines(entry.collections).slice(0, 8);
      if (collections.length < 2) return null;
      const methodSignals = uniqueInsightLines(entry.methodSignals).slice(0, 5);
      const gapSignals = uniqueInsightLines(entry.gapSignals).slice(0, 5);
      return {
        theme: entry.theme,
        collectionCount: collections.length,
        paperCount: entry.paperCount,
        collections,
        methodSignals,
        gapSignals,
        bridgeQuestion: labels.crossCollectionBridgeQuestion(entry.theme, collections.length),
        nextAction: labels.crossCollectionBridgeAction(entry.theme)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.collectionCount - left.collectionCount || right.paperCount - left.paperCount || left.theme.localeCompare(right.theme))
    .slice(0, 20);
}

function crossCollectionThemeMergeEntries(collections = [], labels = collectionTemplateLabels("zh-CN")) {
  const records = crossCollectionThemeRecords(collections, labels);
  const candidates = [];
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const left = records[i];
      const right = records[j];
      if (!left.collectionName || !right.collectionName || left.collectionName === right.collectionName) continue;
      if (left.themeKey === right.themeKey) continue;
      const sharedTokens = left.tokens.filter((token) => right.tokens.includes(token));
      if (!crossCollectionMergeCandidateStrongEnough(sharedTokens, left, right)) continue;
      const scope = labels.crossCollectionMergeScope(left.theme, right.theme);
      const collections = uniqueInsightLines([left.collectionName, right.collectionName]).slice(0, 6);
      const themeCandidates = uniqueInsightLines([left.theme, right.theme]).slice(0, 4);
      candidates.push({
        score: sharedTokens.length * 10 + collections.length + Math.min(left.paperCount + right.paperCount, 10),
        scope,
        collections,
        themeCandidates,
        sharedSignals: crossCollectionSharedSignals(left, right, sharedTokens, labels),
        risk: labels.crossCollectionMergeRisk(themeCandidates.join(" / "), sharedTokens.slice(0, 4).join(", ")),
        reviewAction: labels.crossCollectionMergeAction(scope)
      });
    }
  }
  return candidates
    .sort((left, right) => right.score - left.score || left.scope.localeCompare(right.scope))
    .filter(crossCollectionUniqueMergeCandidate())
    .slice(0, 20)
    .map(({ score: _score, ...entry }) => entry);
}

function crossCollectionThemeRecords(collections, labels) {
  const records = [];
  for (const collection of collections || []) {
    const collectionName = collection?.name || collection?.key || "";
    for (const cluster of collection?.clusters || []) {
      const theme = cluster?.label || labels.clusterOther;
      const signals = uniqueInsightLines([
        theme,
        ...(cluster?.papers || []),
        ...(cluster?.methodSignals || []),
        ...(cluster?.gapSignals || []),
        ...(collection?.openGaps || []),
        ...(collection?.candidateQueries || [])
      ]).slice(0, 24);
      records.push({
        collectionName,
        theme,
        themeKey: normalizedCrossCollectionThemeKey(theme),
        paperCount: Number(cluster?.paperCount || 0),
        methodSignals: uniqueInsightLines(cluster?.methodSignals || []).slice(0, 6),
        gapSignals: uniqueInsightLines(cluster?.gapSignals || []).slice(0, 6),
        candidateQueries: uniqueInsightLines(collection?.candidateQueries || []).slice(0, 6),
        signals,
        tokens: crossCollectionMergeTokens(signals)
      });
    }
  }
  return records;
}

function crossCollectionMergeTokens(values) {
  const stop = new Set([
    "and", "the", "for", "with", "from", "into", "onto", "this", "that", "these", "those", "paper", "papers", "model", "models", "method", "methods", "data", "study", "studies", "evidence", "analysis", "based", "using", "needs", "review", "collection", "collections",
    "以及", "基于", "方法", "模型", "论文", "研究", "证据", "集合", "主题", "综述",
    "手法", "証拠", "論文", "研究", "レビュー"
  ]);
  const text = values.map((value) => String(value || "").toLowerCase()).join(" ");
  const matches = text.match(/[\p{L}\p{N}]+/gu) || [];
  return uniqueInsightLines(matches
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stop.has(token))
  ).slice(0, 80);
}

function crossCollectionMergeCandidateStrongEnough(sharedTokens, left, right) {
  if (!sharedTokens.length) return false;
  const strong = sharedTokens.filter((token) => token.length >= 5);
  const hasMethodOverlap = crossCollectionSignalsShareToken(left.methodSignals, right.methodSignals, sharedTokens);
  const hasGapOverlap = crossCollectionSignalsShareToken(left.gapSignals, right.gapSignals, sharedTokens);
  const hasQueryOverlap = crossCollectionSignalsShareToken(left.candidateQueries, right.candidateQueries, sharedTokens);
  return sharedTokens.length >= 3 || strong.length >= 2 || (sharedTokens.length >= 2 && (hasMethodOverlap || hasGapOverlap || hasQueryOverlap));
}

function crossCollectionSignalsShareToken(leftSignals = [], rightSignals = [], tokens = []) {
  return tokens.some((token) => (
    leftSignals.some((signal) => normalizedCrossCollectionGapKey(signal).includes(token))
    && rightSignals.some((signal) => normalizedCrossCollectionGapKey(signal).includes(token))
  ));
}

function crossCollectionSharedSignals(left, right, sharedTokens, labels) {
  const tokenSet = new Set(sharedTokens);
  const signals = uniqueInsightLines([
    ...crossCollectionSignalsMatchingTokens(left.signals, tokenSet),
    ...crossCollectionSignalsMatchingTokens(right.signals, tokenSet)
  ]).slice(0, 6);
  return signals.length ? signals : sharedTokens.slice(0, 6).map((token) => `${labels.crossCollectionSharedToken}: ${token}`);
}

function crossCollectionSignalsMatchingTokens(signals = [], tokenSet = new Set()) {
  return uniqueInsightLines((signals || []).filter((signal) => {
    const normalized = normalizedCrossCollectionGapKey(signal);
    return Array.from(tokenSet).some((token) => normalized.includes(token));
  })).slice(0, 6);
}

function crossCollectionUniqueMergeCandidate() {
  const seen = new Set();
  return (entry) => {
    const key = [
      ...(entry.collections || []).map((item) => normalizedCrossCollectionGapKey(item)).sort(),
      ...(entry.themeCandidates || []).map((item) => normalizedCrossCollectionThemeKey(item)).sort()
    ].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function crossCollectionClusterMapEntries(collections = [], labels = collectionTemplateLabels("zh-CN")) {
  const records = crossCollectionThemeRecords(collections, labels).map((record, index) => ({ ...record, index }));
  if (!records.length) return [];
  const parents = records.map((_, index) => index);
  const linkEvidence = [];
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const connect = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const left = records[i];
      const right = records[j];
      if (!left.themeKey || !right.themeKey) continue;
      if (left.themeKey === right.themeKey) {
        linkEvidence.push(crossCollectionClusterLinkEvidence(left, right, [], labels, "same_theme"));
        connect(i, j);
        continue;
      }
      if (left.collectionName === right.collectionName) continue;
      const sharedTokens = left.tokens.filter((token) => right.tokens.includes(token));
      const evidence = crossCollectionClusterLinkEvidence(left, right, sharedTokens, labels, "shared_signals");
      if (evidence.strong) {
        linkEvidence.push(evidence);
        connect(i, j);
      }
    }
  }
  const groups = new Map();
  records.forEach((record, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  });
  return Array.from(groups.values())
    .map((group) => {
      const ids = new Set(group.map((record) => record.index));
      return crossCollectionClusterMapEntry(group, labels, linkEvidence.filter((link) => ids.has(link.leftIndex) && ids.has(link.rightIndex)));
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftCross = Number(left.collectionCount || 0) >= 2 ? 1 : 0;
      const rightCross = Number(right.collectionCount || 0) >= 2 ? 1 : 0;
      return rightCross - leftCross
        || right.clusterScore - left.clusterScore
        || right.collectionCount - left.collectionCount
        || right.paperCount - left.paperCount
        || right.themeCount - left.themeCount
        || left.title.localeCompare(right.title);
    })
    .slice(0, 30);
}

function crossCollectionClusterMapEntry(group, labels, links = []) {
  const collections = uniqueInsightLines(group.map((record) => record.collectionName).filter(Boolean)).slice(0, 12);
  const themes = uniqueInsightLines(group.map((record) => record.theme).filter(Boolean)).slice(0, 12);
  const paperCount = group.reduce((sum, record) => sum + Number(record.paperCount || 0), 0);
  const methodSignals = uniqueInsightLines(group.flatMap((record) => record.methodSignals || [])).slice(0, 8);
  const gapSignals = uniqueInsightLines(group.flatMap((record) => record.gapSignals || [])).slice(0, 8);
  const candidateQueries = uniqueInsightLines(group.flatMap((record) => record.candidateQueries || [])).slice(0, 8);
  const linkSignals = crossCollectionClusterLinkSignals(links, labels);
  const evidenceAnchors = uniqueInsightLines(group.map((record) => [
    record.collectionName,
    record.theme,
    record.paperCount ? `${record.paperCount} ${labels.paperColumn}` : ""
  ].filter(Boolean).join(": "))).slice(0, 10);
  const title = labels.crossCollectionClusterTitle(themes);
  const collectionCount = collections.length;
  const clusterScore = crossCollectionClusterScore({
    collectionCount,
    paperCount,
    themeCount: themes.length,
    methodSignals,
    gapSignals,
    candidateQueries,
    linkSignals
  });
  const reviewRisk = labels.crossCollectionClusterRisk(collectionCount, themes.length, linkSignals.length);
  const calibration = crossCollectionClusterCalibration({
    title,
    collectionCount,
    themeCount: themes.length,
    paperCount,
    clusterScore,
    linkSignals,
    reviewRisk
  }, labels);
  return {
    title,
    collectionCount,
    themeCount: themes.length,
    paperCount,
    collections,
    themes,
    methodSignals,
    gapSignals,
    candidateQueries,
    evidenceAnchors,
    linkSignals,
    clusterScore,
    thresholdBand: calibration.thresholdBand,
    calibrationRecommendation: calibration.recommendation,
    calibrationAction: calibration.nextAction,
    reviewRisk,
    supportLevel: labels.crossCollectionClusterSupport(collectionCount, paperCount),
    synthesisPrompt: labels.crossCollectionClusterPrompt(title, collectionCount),
    reviewAction: labels.crossCollectionClusterReviewAction(title)
  };
}

function crossCollectionClusterCalibrationEntries(clusterEntries = [], labels = collectionTemplateLabels("zh-CN")) {
  return (clusterEntries || []).map((cluster) => {
    const calibration = crossCollectionClusterCalibration(cluster, labels);
    return {
      cluster: cluster?.title || labels.clusterOther,
      recommendation: cluster?.calibrationRecommendation || calibration.recommendation,
      thresholdBand: cluster?.thresholdBand || calibration.thresholdBand,
      collections: cluster?.collections || [],
      evidence: uniqueInsightLines([
        `${labels.crossCollectionClusterScoreColumn}: ${Number(cluster?.clusterScore || 0)}`,
        `${labels.crossCollectionClusterThresholdColumn}: ${cluster?.thresholdBand || calibration.thresholdBand}`,
        `${labels.crossCollectionSupportColumn}: ${cluster?.supportLevel || labels.crossCollectionClusterSupport(Number(cluster?.collectionCount || 0), Number(cluster?.paperCount || 0))}`,
        `${labels.crossCollectionClusterLinkColumn}: ${(cluster?.linkSignals || []).slice(0, 2).join("; ") || labels.crossCollectionClusterLinkPending}`,
        `${labels.crossCollectionClusterRiskColumn}: ${cluster?.reviewRisk || calibration.reviewRisk || labels.crossCollectionClusterRiskPending}`
      ]).slice(0, 5),
      nextAction: cluster?.calibrationAction || calibration.nextAction,
      rankScore: calibration.rankScore
    };
  })
    .filter((entry) => entry.cluster)
    .sort((left, right) => Number(right.rankScore || 0) - Number(left.rankScore || 0) || left.cluster.localeCompare(right.cluster))
    .slice(0, 20)
    .map(({ rankScore: _rankScore, ...entry }) => entry);
}

function crossCollectionClusterCalibration(cluster = {}, labels = collectionTemplateLabels("zh-CN")) {
  const score = Number(cluster?.clusterScore || 0);
  const collectionCount = Number(cluster?.collectionCount || 0);
  const themeCount = Number(cluster?.themeCount || 0);
  const paperCount = Number(cluster?.paperCount || 0);
  const linkCount = (cluster?.linkSignals || []).length;
  const riskText = String(cluster?.reviewRisk || "").toLowerCase();
  const highRisk = /high|高|広/.test(riskText);
  const mediumRisk = /medium|中/.test(riskText);
  let key = "gather";
  if (collectionCount >= 2 && score >= 75 && linkCount >= 2 && !highRisk) {
    key = "merge";
  } else if (collectionCount >= 2 && score >= 55 && linkCount >= 1) {
    key = "review";
  } else if (collectionCount >= 2 && (themeCount >= 3 || highRisk || mediumRisk)) {
    key = "split";
  }
  const recommendation = labels.crossCollectionClusterCalibrationRecommendation(key);
  return {
    key,
    recommendation,
    thresholdBand: labels.crossCollectionClusterThresholdBand(score, collectionCount, linkCount),
    nextAction: labels.crossCollectionClusterCalibrationAction(cluster?.title || cluster?.cluster || labels.clusterOther, recommendation),
    reviewRisk: cluster?.reviewRisk || "",
    rankScore: score + collectionCount * 10 + linkCount * 8 + Math.min(paperCount, 20) + (key === "merge" ? 40 : key === "review" ? 25 : key === "split" ? 18 : 0)
  };
}

function crossCollectionClusterLinkEvidence(left, right, sharedTokens = [], labels = collectionTemplateLabels("zh-CN"), mode = "shared_signals") {
  const sameTheme = mode === "same_theme" || left.themeKey === right.themeKey;
  const strongTokens = (sharedTokens || []).filter((token) => token.length >= 5);
  const hasMethodOverlap = crossCollectionSignalsShareToken(left.methodSignals, right.methodSignals, sharedTokens);
  const hasGapOverlap = crossCollectionSignalsShareToken(left.gapSignals, right.gapSignals, sharedTokens);
  const hasQueryOverlap = crossCollectionSignalsShareToken(left.candidateQueries, right.candidateQueries, sharedTokens);
  const reasons = uniqueInsightLines([
    sameTheme ? labels.crossCollectionClusterLinkSameTheme(left.theme || right.theme || labels.clusterOther) : "",
    sharedTokens.length >= 3 ? labels.crossCollectionClusterLinkSharedTokens(sharedTokens.length) : "",
    strongTokens.length >= 2 ? labels.crossCollectionClusterLinkStrongTokens(strongTokens.slice(0, 4).join(", ")) : "",
    hasMethodOverlap ? labels.crossCollectionClusterLinkMethodOverlap : "",
    hasGapOverlap ? labels.crossCollectionClusterLinkGapOverlap : "",
    hasQueryOverlap ? labels.crossCollectionClusterLinkQueryOverlap : ""
  ]).filter(Boolean);
  return {
    leftIndex: left.index,
    rightIndex: right.index,
    strong: sameTheme || crossCollectionMergeCandidateStrongEnough(sharedTokens, left, right),
    reasons,
    tokens: sharedTokens.slice(0, 6),
    collections: uniqueInsightLines([left.collectionName, right.collectionName]).filter(Boolean),
    themes: uniqueInsightLines([left.theme, right.theme]).filter(Boolean)
  };
}

function crossCollectionClusterLinkSignals(links = [], labels = collectionTemplateLabels("zh-CN")) {
  const signals = [];
  for (const link of links || []) {
    const scope = (link.themes || []).join(" / ") || labels.clusterOther;
    const reason = (link.reasons || []).slice(0, 2).join("; ") || labels.crossCollectionClusterLinkPending;
    signals.push(`${scope}: ${reason}`);
  }
  return uniqueInsightLines(signals).slice(0, 8);
}

function crossCollectionClusterScore(entry = {}) {
  return Math.min(100, Math.round(
    Math.min(Number(entry.collectionCount || 0), 6) * 18
    + Math.min(Number(entry.paperCount || 0), 12) * 2
    + Math.min(Number(entry.themeCount || 0), 8) * 3
    + Math.min((entry.methodSignals || []).length, 6) * 2
    + Math.min((entry.gapSignals || []).length, 6) * 2
    + Math.min((entry.candidateQueries || []).length, 4)
    + Math.min((entry.linkSignals || []).length, 6) * 5
  ));
}

function crossCollectionPriorityEntries(collections = [], gapEntries = [], labels = collectionTemplateLabels("zh-CN"), themeMergeEntries = [], clusterMapEntries = []) {
  const entries = [];
  for (const merge of themeMergeEntries || []) {
    entries.push({
      kind: "theme_merge_review",
      score: 90 + (merge?.sharedSignals?.length || 0),
      priority: labels.crossCollectionPriorityMergeThemes((merge?.themeCandidates || []).join(" / ") || merge?.scope || labels.crossCollectionMergePending),
      reason: labels.crossCollectionPriorityMergeReason,
      collections: merge?.collections || [],
      evidence: merge?.sharedSignals || [],
      nextAction: merge?.reviewAction || labels.crossCollectionMergeAction(merge?.scope || labels.crossCollectionMergePending)
    });
  }
  for (const cluster of clusterMapEntries || []) {
    const count = Number(cluster?.collectionCount || 0);
    if (count < 2) continue;
    const cardRanking = crossCollectionClusterEvidenceCardRanking(cluster, labels);
    entries.push({
      kind: "cross_collection_cluster",
      score: 85 + Number(cardRanking.score || 0),
      priority: labels.crossCollectionPriorityCluster(cluster?.title || labels.clusterOther, count),
      reason: labels.crossCollectionPriorityClusterReason(count, cluster?.clusterScore || 0),
      collections: cluster?.collections || [],
      evidence: uniqueInsightLines([
        cardRanking.score ? `${labels.crossCollectionEvidenceRankColumn}: ${cardRanking.score}` : "",
        ...(cardRanking.signals || []).map((signal) => `${labels.crossCollectionEvidenceRankSignalsColumn}: ${signal}`),
        cluster?.clusterScore ? `${labels.crossCollectionClusterScoreColumn}: ${cluster.clusterScore}` : "",
        cluster?.calibrationRecommendation ? `${labels.crossCollectionClusterRecommendationColumn}: ${cluster.calibrationRecommendation}` : "",
        cluster?.thresholdBand ? `${labels.crossCollectionClusterThresholdColumn}: ${cluster.thresholdBand}` : "",
        ...(cluster?.linkSignals || []).map((signal) => `${labels.crossCollectionClusterLinkColumn}: ${signal}`),
        ...(cluster?.themes || []).map((theme) => `${labels.clusterColumn}: ${theme}`),
        ...(cluster?.gapSignals || []).map((gap) => `${labels.gapSignalColumn}: ${gap}`)
      ]).slice(0, 10),
      nextAction: cluster?.calibrationAction || cluster?.reviewAction || labels.crossCollectionClusterReviewAction(cluster?.title || labels.clusterOther)
    });
  }
  for (const gap of gapEntries || []) {
    const count = Number(gap?.collectionCount || 0);
    const priorityRanking = gap?.gapPriorityScore
      ? { score: gap.gapPriorityScore, signals: gap.gapPrioritySignals || [] }
      : crossCollectionGapPriorityRanking(gap, labels);
    const evidence = uniqueInsightLines([
      priorityRanking.score ? `${labels.crossCollectionGapPriorityColumn}: ${priorityRanking.score}` : "",
      ...(priorityRanking.signals || []).map((signal) => `${labels.crossCollectionGapPrioritySignalsColumn}: ${signal}`),
      ...(gap?.themes || []).map((theme) => `${labels.clusterColumn}: ${theme}`),
      ...(gap?.candidateQueries || []).map((query) => `${labels.roadmapCandidateQueryColumn}: ${query}`)
    ]).slice(0, 8);
    entries.push({
      kind: "recurring_gap",
      score: 70 + Number(priorityRanking.score || 0),
      priority: labels.crossCollectionPriorityGap(count, gap?.gap || labels.gapMatrixPendingEvidence),
      reason: count >= 2 ? labels.crossCollectionPriorityRecurringReason(count) : labels.crossCollectionPrioritySingleReason,
      collections: gap?.collections || [],
      evidence,
      nextAction: gap?.nextAction || labels.crossCollectionGapAction(count, gap?.gap || labels.gapMatrixPendingEvidence)
    });
  }
  for (const collection of collections || []) {
    const collectionName = collection?.name || collection?.key || "";
    for (const cluster of collection?.clusters || []) {
      const paperCount = Number(cluster?.paperCount || 0);
      const gapSignals = uniqueInsightLines(cluster?.gapSignals || []).slice(0, 4);
      if (paperCount >= 2 && !gapSignals.length) continue;
      entries.push({
        kind: "weak_theme",
        score: paperCount < 2 ? 60 + gapSignals.length : 40 + gapSignals.length,
        priority: labels.crossCollectionPriorityWeakTheme(cluster?.label || labels.clusterOther, paperCount),
        reason: paperCount < 2 ? labels.crossCollectionPriorityWeakThemeReason : labels.crossCollectionPriorityGapSignalReason,
        collections: [collectionName].filter(Boolean),
        evidence: uniqueInsightLines([
          ...(cluster?.methodSignals || []).map((method) => `${labels.methodSignalColumn}: ${method}`),
          ...gapSignals.map((gap) => `${labels.gapSignalColumn}: ${gap}`)
        ]).slice(0, 5),
        nextAction: labels.crossCollectionPriorityWeakThemeAction(cluster?.label || labels.clusterOther)
      });
    }
  }
  return entries
    .filter((entry) => entry.priority)
    .sort((left, right) => right.score - left.score || left.priority.localeCompare(right.priority))
    .slice(0, 20)
    .map(({ score: _score, ...entry }) => entry);
}

function crossCollectionGapSignals(collection, labels) {
  const rows = [];
  for (const gap of collection?.openGaps || []) {
    rows.push({ gap: crossCollectionGapText(gap), theme: "" });
  }
  for (const cluster of collection?.clusters || []) {
    for (const gap of cluster?.gapSignals || []) {
      rows.push({ gap: crossCollectionGapText(gap), theme: cluster.label || labels.clusterOther });
    }
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${normalizedCrossCollectionGapKey(row.gap)}::${row.theme || ""}`;
    if (!row.gap || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function crossCollectionCandidateQueriesForGap(collection, signal, labels) {
  const direct = (collection?.candidateQueries || []).filter((query) => normalizedCrossCollectionGapKey(query).includes(normalizedCrossCollectionGapKey(signal.gap).slice(0, 48)));
  const fallback = [signal.theme, signal.gap].filter(Boolean).join(" ");
  return uniqueInsightLines([...direct, fallback || labels.roadmapCandidateQueryColumn]).slice(0, 3);
}

function crossCollectionGapText(value) {
  return cleanupInsightLine(value).replace(/[.。．]+$/g, "").trim();
}

function normalizedCrossCollectionGapKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_~[\](){}<>]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCrossCollectionThemeKey(value) {
  return normalizedCrossCollectionGapKey(value);
}

function renderCrossCollectionThemeRows(collections, labels) {
  const themes = new Map();
  for (const collection of collections || []) {
    for (const cluster of collection.clusters || []) {
      const key = cluster.label || labels.clusterOther;
      if (!themes.has(key)) {
        themes.set(key, {
          label: key,
          collections: [],
          papers: 0,
          methods: [],
          gaps: [],
          queries: []
        });
      }
      const theme = themes.get(key);
      theme.collections.push(collection.name || collection.key);
      theme.papers += Number(cluster.paperCount || 0);
      theme.methods.push(...(cluster.methodSignals || []));
      theme.gaps.push(...(cluster.gapSignals || []));
      theme.queries.push(...(collection.candidateQueries || []));
    }
  }
  const rows = Array.from(themes.values())
    .sort((left, right) => right.papers - left.papers || left.label.localeCompare(right.label))
    .slice(0, 12)
    .map((theme) => [
      escapeMarkdownTable(theme.label),
      escapeMarkdownTable(uniqueInsightLines(theme.collections).join("; ")),
      escapeMarkdownTable(theme.papers),
      escapeMarkdownTable(uniqueInsightLines(theme.methods).slice(0, 4).join("; ") || labels.pendingInsight),
      escapeMarkdownTable(uniqueInsightLines(theme.gaps).slice(0, 4).join("; ") || labels.gapMatrixPendingEvidence),
      escapeMarkdownTable(uniqueInsightLines(theme.queries).slice(0, 3).join("; ") || labels.roadmapCandidateQueryColumn)
    ].join(" | "))
    .map((row) => `| ${row} |`);
  return [
    `| ${labels.clusterColumn} | ${labels.collectionColumn} | ${labels.paperColumn} | ${labels.methodSignalColumn} | ${labels.gapSignalColumn} | ${labels.roadmapCandidateQueryColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    rows.join("\n") || "|  |  |  |  |  |  |"
  ].join("\n");
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

function renderTopicClusters(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const clusters = topicClusterEntries(results, summaryInsights, labels);
  const sections = clusters.map((cluster) => {
    const methodSignals = uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean)).slice(0, 3);
    const gapSignals = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds))).slice(0, 3);
    const rows = cluster.items.map(({ item, insight }) => [
      escapeMarkdownTable(item.title || item.itemKey),
      escapeMarkdownTable(item.year),
      escapeMarkdownTable(insight.method || labels.pendingInsight),
      escapeMarkdownTable(insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds)[0] || labels.gapMatrixPendingEvidence),
      escapeMarkdownTable(item.summaryPath || labels.pendingSummaryPath)
    ].join(" | ")).map((row) => `| ${row} |`).join("\n");
    return [
      `## ${cluster.label} (${cluster.items.length})`,
      "",
      `- ${labels.clusterSynthesis}: ${labels.clusterSynthesisText(methodSignals.join("; ") || labels.pendingInsight, gapSignals.join("; ") || labels.gapMatrixPendingEvidence)}`,
      `- ${labels.clusterWritingEntry}: ${labels.clusterWritingText(cluster.label, methodSignals[0] || labels.pendingInsight, gapSignals[0] || labels.gapMatrixPendingEvidence)}`,
      "",
      `| ${labels.paperColumn} | ${labels.yearColumn} | ${labels.methodSignalColumn} | ${labels.gapSignalColumn} | ${labels.summaryColumn} |`,
      "| --- | --- | --- | --- | --- |",
      rows,
      ""
    ].join("\n");
  }).join("\n");
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.topicClusters}`,
    "",
    labels.topicClustersNote,
    "",
    sections || `- ${labels.noSummary}`,
    ""
  ].join("\n");
}

function renderSynthesisClaimsMatrix(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const entries = synthesisClaimEntries(results, summaryInsights, labels);
  const rows = entries.map((entry) => [
    escapeMarkdownTable(entry.cluster),
    escapeMarkdownTable(entry.claim),
    escapeMarkdownTable(entry.claimSupportScore),
    escapeMarkdownTable(entry.claimRisk),
    escapeMarkdownTable(entry.supportingPapers.join("; ") || labels.noSummary),
    escapeMarkdownTable(entry.evidenceTrace),
    escapeMarkdownTable(entry.evidence.join("; ") || labels.pendingSummaryPath),
    escapeMarkdownTable(entry.gaps.join("; ") || labels.gapMatrixPendingEvidence),
    escapeMarkdownTable(entry.validations.join("; ") || labels.gapMatrixPendingValidation)
  ].join(" | ")).map((row) => `| ${row} |`).join("\n") || "|  |  |  |  |  |  |  |  |";
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.synthesisClaims}`,
    "",
    labels.synthesisClaimsNote,
    "",
    `| ${labels.clusterColumn} | ${labels.claimColumn} | ${labels.claimSupportScoreColumn} | ${labels.claimRiskColumn} | ${labels.supportingPapersColumn} | ${labels.evidenceTraceColumn} | ${labels.evidenceColumn} | ${labels.counterGapColumn} | ${labels.validationColumn} |`,
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- |",
    rows,
    "",
    `## ${labels.claimRiskChecklist}`,
    "",
    labels.claimRiskChecklistItems,
    ""
  ].join("\n");
}

function renderSynthesisConflictLedger(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const entries = synthesisConflictEntries(results, summaryInsights, labels);
  const rows = entries.map((entry) => [
    escapeMarkdownTable(entry.cluster),
    escapeMarkdownTable(entry.claim),
    escapeMarkdownTable(entry.supportLevel),
    escapeMarkdownTable(entry.claimSupportScore),
    escapeMarkdownTable(entry.claimRisk),
    escapeMarkdownTable(entry.counterGap),
    escapeMarkdownTable(entry.validation),
    escapeMarkdownTable(entry.reviewAction)
  ].join(" | ")).map((row) => `| ${row} |`).join("\n") || "|  |  |  |  |  |  |  |  |";
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.synthesisConflictLedger}`,
    "",
    labels.synthesisConflictLedgerNote,
    "",
    `| ${labels.clusterColumn} | ${labels.claimColumn} | ${labels.supportLevelColumn} | ${labels.claimSupportScoreColumn} | ${labels.claimRiskColumn} | ${labels.counterGapColumn} | ${labels.validationColumn} | ${labels.reviewActionColumn} |`,
    "| --- | --- | --- | ---: | --- | --- | --- | --- |",
    rows,
    "",
    `## ${labels.conflictReviewChecklist}`,
    "",
    labels.conflictReviewChecklistItems,
    ""
  ].join("\n");
}

function renderSynthesisRoadmap(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const entries = synthesisRoadmapEntries(results, summaryInsights, labels);
  const readinessEntries = synthesisRoadmapReadinessEntries(entries, labels);
  const items = batchReportItems(results).filter((item) => item.status === "generated" || item.status === "skipped_existing");
  const routeRows = entries.map((entry) => [
    escapeMarkdownTable(entry.cluster),
    escapeMarkdownTable(entry.question),
    escapeMarkdownTable(entry.claimSupportScore),
    escapeMarkdownTable(entry.claimRisk),
    escapeMarkdownTable(entry.supportingPapers.join("; ") || labels.noSummary),
    escapeMarkdownTable(entry.methodSignal),
    escapeMarkdownTable(entry.openGap),
    escapeMarkdownTable(entry.nextValidation),
    escapeMarkdownTable(entry.candidateQuery)
  ].join(" | ")).map((row) => `| ${row} |`).join("\n") || "|  |  |  |  |  |  |  |  |  |";
  const outline = entries.map((entry, index) => `${index + 1}. ${entry.sectionPlan}`).join("\n") || `1. ${labels.roadmapSectionText(1, labels.clusterOther, labels.pendingInsight, labels.gapMatrixPendingEvidence)}`;
  const evidenceRows = items.map((item) => {
    const insight = summaryInsights.get(item.itemKey) || {};
    const cluster = topicClusterEntries([item], summaryInsights, labels)[0]?.label || labels.clusterOther;
    return [
      escapeMarkdownTable(item.title || item.itemKey),
      escapeMarkdownTable(item.year || ""),
      escapeMarkdownTable(cluster),
      escapeMarkdownTable(insight.method || labels.pendingInsight),
      escapeMarkdownTable(insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds)[0] || labels.gapMatrixPendingEvidence),
      escapeMarkdownTable(item.summaryPath || labels.pendingSummaryPath)
    ].join(" | ");
  }).map((row) => `| ${row} |`).join("\n") || "|  |  |  |  |  |  |";
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.synthesisRoadmap}`,
    "",
    labels.synthesisRoadmapNote,
    "",
    `## ${labels.roadmapEvidenceMap}`,
    "",
    `| ${labels.clusterColumn} | ${labels.roadmapQuestionColumn} | ${labels.claimSupportScoreColumn} | ${labels.claimRiskColumn} | ${labels.supportingPapersColumn} | ${labels.methodSignalColumn} | ${labels.gapSignalColumn} | ${labels.validationColumn} | ${labels.roadmapCandidateQueryColumn} |`,
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- |",
    routeRows,
    "",
    `## ${labels.roadmapSectionPlan}`,
    "",
    outline,
    "",
    `## ${labels.roadmapReadinessBoard}`,
    "",
    renderSynthesisRoadmapReadinessRows(readinessEntries, labels),
    "",
    `## ${labels.roadmapEvidenceIndex}`,
    "",
    `| ${labels.paperColumn} | ${labels.yearColumn} | ${labels.clusterColumn} | ${labels.methodSignalColumn} | ${labels.gapSignalColumn} | ${labels.summaryColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    evidenceRows,
    "",
    `## ${labels.reportRiskChecklist}`,
    "",
    labels.roadmapChecklistItems,
    ""
  ].join("\n");
}

function topicClusterEntries(results, summaryInsights = new Map(), labels = collectionTemplateLabels("zh-CN")) {
  const definitions = topicClusterDefinitions(labels);
  const clusters = new Map();
  for (const item of batchReportItems(results).filter((entry) => entry.status === "generated" || entry.status === "skipped_existing")) {
    const insight = summaryInsights.get(item.itemKey) || {};
    const text = topicClusterSourceText(item, insight);
    const definition = definitions.find((entry) => entry.pattern.test(text)) || definitions[definitions.length - 1];
    if (!clusters.has(definition.id)) clusters.set(definition.id, { id: definition.id, label: definition.label, items: [] });
    clusters.get(definition.id).items.push({ item, insight });
  }
  return Array.from(clusters.values()).sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
}

function synthesisClaimEntries(results, summaryInsights = new Map(), labels = collectionTemplateLabels("zh-CN")) {
  return topicClusterEntries(results, summaryInsights, labels).map((cluster) => {
    const methods = uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean)).slice(0, 3);
    const gaps = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence))).slice(0, 3);
    const validations = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.validationNeeds, insight.rejectConditions))).slice(0, 3);
    const supportingPapers = cluster.items.map(({ item }) => `${item.title || item.itemKey} (${item.year || "n.d."})`).slice(0, 8);
    const evidence = uniqueInsightLines(cluster.items.flatMap(({ item, insight }) => insightValues(insight.evidence, item.summaryPath))).slice(0, 6);
    const audit = synthesisClaimEvidenceAudit({ supportingPapers, evidence, gaps, validations }, labels);
    return {
      cluster: cluster.label,
      claim: labels.synthesisClaimText(cluster.label, methods.join("; ") || labels.pendingInsight, gaps[0] || labels.gapMatrixPendingEvidence),
      supportingPapers,
      evidence,
      gaps,
      validations,
      ...audit
    };
  });
}

function synthesisClaimEvidenceAudit(entry = {}, labels = collectionTemplateLabels("zh-CN")) {
  const supportCount = (entry.supportingPapers || []).length;
  const evidenceCount = (entry.evidence || []).length;
  const gapCount = (entry.gaps || []).length;
  const validationCount = (entry.validations || []).length;
  const score = Math.max(0, Math.min(100, Math.round(
    Math.min(supportCount, 4) * 24
    + Math.min(evidenceCount, 6) * 7
    + Math.min(validationCount, 4) * 5
    - Math.min(gapCount, 4) * 6
  )));
  const claimRisk = supportCount >= 2 && score >= 70
    ? labels.claimRiskLow
    : supportCount >= 2 && score >= 50
      ? labels.claimRiskMedium
      : labels.claimRiskHigh;
  const evidenceTrace = labels.claimEvidenceTrace(supportCount, evidenceCount, validationCount);
  return {
    claimSupportScore: score,
    claimRisk,
    evidenceTrace,
    claimAuditAction: labels.claimAuditAction(claimRisk, score)
  };
}

function synthesisConflictEntries(results, summaryInsights = new Map(), labels = collectionTemplateLabels("zh-CN")) {
  return synthesisClaimEntries(results, summaryInsights, labels).map((entry) => {
    const supportCount = entry.supportingPapers.length;
    const supportLevel = supportCount >= 2
      ? labels.supportLevelMultiPaper(supportCount)
      : supportCount === 1
        ? labels.supportLevelSinglePaper
        : labels.noSummary;
    const counterGap = entry.gaps[0] || labels.gapMatrixPendingEvidence;
    const validation = entry.validations.join("; ") || labels.gapMatrixPendingValidation;
    return {
      cluster: entry.cluster,
      claim: entry.claim,
      supportLevel,
      claimSupportScore: entry.claimSupportScore,
      claimRisk: entry.claimRisk,
      evidenceTrace: entry.evidenceTrace,
      counterGap,
      validation,
      reviewAction: `${labels.conflictReviewAction(supportCount, counterGap, validation)} ${entry.claimAuditAction || ""}`.trim()
    };
  });
}

function synthesisRoadmapEntries(results, summaryInsights = new Map(), labels = collectionTemplateLabels("zh-CN")) {
  const claimByCluster = new Map(synthesisClaimEntries(results, summaryInsights, labels).map((entry) => [entry.cluster, entry]));
  return topicClusterEntries(results, summaryInsights, labels).map((cluster, index) => {
    const methods = uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean)).slice(0, 3);
    const gaps = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence))).slice(0, 3);
    const validations = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.validationNeeds, insight.rejectConditions))).slice(0, 3);
    const supportingPapers = cluster.items.map(({ item }) => `${item.title || item.itemKey} (${item.year || "n.d."})`).slice(0, 8);
    const methodSignal = methods[0] || labels.pendingInsight;
    const openGap = gaps[0] || labels.gapMatrixPendingEvidence;
    const nextValidation = validations.join("; ") || labels.gapMatrixPendingValidation;
    const claim = claimByCluster.get(cluster.label) || synthesisClaimEvidenceAudit({ supportingPapers, evidence: [], gaps, validations }, labels);
    return {
      cluster: cluster.label,
      question: labels.roadmapQuestionText(cluster.label, methodSignal, openGap),
      claimSupportScore: claim.claimSupportScore,
      claimRisk: claim.claimRisk,
      supportingPapers,
      methodSignal,
      openGap,
      nextValidation,
      candidateQuery: roadmapCandidateQuery(cluster.label, methods, gaps, validations),
      sectionPlan: labels.roadmapSectionText(index + 1, cluster.label, methodSignal, openGap)
    };
  });
}

function synthesisRoadmapReadinessEntries(entries = [], labels = collectionTemplateLabels("zh-CN")) {
  return (entries || []).map((entry) => {
    const supportScore = Number(entry.claimSupportScore) || 0;
    const paperCount = Array.isArray(entry.supportingPapers) ? entry.supportingPapers.length : 0;
    const risk = String(entry.claimRisk || "");
    const hasHighRisk = risk === labels.claimRiskHigh || /high|高|高度|暫定|薄い/i.test(risk);
    const hasMediumRisk = risk === labels.claimRiskMedium || /medium|中/i.test(risk);
    const missingGap = !entry.openGap || entry.openGap === labels.gapMatrixPendingEvidence;
    const missingValidation = !entry.nextValidation || entry.nextValidation === labels.gapMatrixPendingValidation;
    const unresolvedGap = entry.openGap && !missingGap ? entry.openGap : "";
    const score = Math.max(0, Math.min(100, Math.round(
      supportScore
      + Math.min(paperCount, 4) * 5
      + (entry.candidateQuery ? 4 : 0)
      - (hasHighRisk ? 24 : hasMediumRisk ? 10 : 0)
      - (missingGap ? 14 : 6)
      - (missingValidation ? 12 : 4)
    )));
    const level = score >= 70 && paperCount >= 2 && !hasHighRisk
      ? labels.roadmapReadinessReady
      : paperCount < 2 || hasHighRisk
        ? labels.roadmapReadinessNeedsEvidence
        : missingValidation
          ? labels.roadmapReadinessNeedsValidation
          : score < 40
            ? labels.roadmapReadinessDefer
            : labels.roadmapReadinessNeedsValidation;
    const blockingIssue = level === labels.roadmapReadinessReady
      ? labels.roadmapReadinessNoBlocking
      : paperCount < 2 || hasHighRisk
        ? labels.roadmapReadinessBlockingEvidence(paperCount, risk)
        : missingValidation
          ? labels.roadmapReadinessBlockingValidation
          : unresolvedGap
            ? labels.roadmapReadinessBlockingGap(unresolvedGap)
            : labels.roadmapReadinessBlockingScore(score);
    return {
      ...entry,
      roadmapReadinessScore: score,
      roadmapReadinessLevel: level,
      roadmapBlockingIssue: blockingIssue,
      roadmapNextAction: labels.roadmapReadinessAction(level, entry.cluster, blockingIssue, entry.candidateQuery)
    };
  });
}

function renderSynthesisRoadmapReadinessRows(entries = [], labels = collectionTemplateLabels("zh-CN")) {
  const rows = (entries || []).map((entry) => [
    escapeMarkdownTable(entry.cluster),
    escapeMarkdownTable(entry.roadmapReadinessScore),
    escapeMarkdownTable(entry.roadmapReadinessLevel),
    escapeMarkdownTable(entry.claimSupportScore),
    escapeMarkdownTable(entry.claimRisk),
    escapeMarkdownTable(entry.roadmapBlockingIssue),
    escapeMarkdownTable(entry.candidateQuery),
    escapeMarkdownTable(entry.roadmapNextAction)
  ].join(" | ")).map((row) => `| ${row} |`).join("\n") || "|  |  |  |  |  |  |  |  |";
  return [
    `| ${labels.clusterColumn} | ${labels.roadmapReadinessScoreColumn} | ${labels.roadmapReadinessLevelColumn} | ${labels.claimSupportScoreColumn} | ${labels.claimRiskColumn} | ${labels.roadmapBlockingIssueColumn} | ${labels.roadmapCandidateQueryColumn} | ${labels.roadmapNextActionColumn} |`,
    "| --- | ---: | --- | ---: | --- | --- | --- | --- |",
    rows
  ].join("\n");
}

function roadmapCandidateQuery(clusterLabel, methods = [], gaps = [], validations = []) {
  const terms = uniqueInsightLines([
    clusterLabel,
    ...methods,
    ...gaps,
    ...validations
  ].filter(Boolean)).join(" ");
  return terms.length > 180 ? `${terms.slice(0, 177)}...` : terms;
}

function topicClusterDefinitions(labels) {
  return [
    { id: "transportation-airspace", label: labels.clusterTransportationAirspace, pattern: /traffic|transport|airspace|road|vehicle|route|routing|uam|uav|drone|flight|airport|mobility|交通|道路|空域|城市空中|无人机|航路|路径|车辆|机场|出行|飛行|空域|交通/i },
    { id: "safety-risk", label: labels.clusterSafetyRisk, pattern: /safety|risk|hazard|conflict|collision|robust|uncertainty|failure|安全|风险|冲突|碰撞|不确定|鲁棒|失效|危険|リスク|衝突/i },
    { id: "ai-methods", label: labels.clusterAiMethods, pattern: /transformer|attention|llm|language model|graph|neural|deep learning|machine learning|reinforcement|ppo|ctde|gnn|gat|baseline|ablation|模型|大模型|图神经|强化学习|深度学习|注意力|算法|消融|ベースライン|機械学習/i },
    { id: "data-evaluation", label: labels.clusterDataEvaluation, pattern: /dataset|benchmark|simulation|experiment|evaluation|metric|ablation|数据|数据集|仿真|实验|指标|评估|验证|ベンチマーク|データ|評価|実験/i },
    { id: "biomedicine", label: labels.clusterBiomedicine, pattern: /clinical|patient|cohort|biomed|medical|therapy|disease|trial|临床|患者|队列|医学|疾病|治疗|生物|臨床|患者|医学/i },
    { id: "human-policy", label: labels.clusterHumanPolicy, pattern: /policy|governance|human|social|user|behavior|regulation|privacy|政策|治理|人因|用户|行为|社会|监管|隐私|ポリシー|社会|規制/i },
    { id: "other", label: labels.clusterOther, pattern: /[\s\S]/ }
  ];
}

function topicClusterSourceText(item, insight = {}) {
  return insightValues(
    item.title,
    item.year,
    insight.method,
    insight.dataScenario,
    insight.metrics,
    insight.limitations,
    insight.missingEvidence,
    insight.validationNeeds,
    insight.ideas
  ).join(" ");
}

function insightValues(...values) {
  const lines = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      lines.push(...value.filter(Boolean).map((item) => String(item)));
    } else if (value) {
      lines.push(String(value));
    }
  }
  return lines;
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

function renderFormalReviewReport(collectionContext, results, outputLanguage = "zh-CN", summaryInsights = new Map()) {
  const labels = collectionTemplateLabels(outputLanguage);
  const stats = batchStats(results);
  const generatedItems = batchReportItems(results).filter((item) => item.status === "generated" || item.status === "skipped_existing");
  const clusters = topicClusterEntries(results, summaryInsights, labels);
  const synthesisClaims = synthesisClaimEntries(results, summaryInsights, labels);
  const synthesisConflicts = synthesisConflictEntries(results, summaryInsights, labels);
  const roadmapReadiness = synthesisRoadmapReadinessEntries(synthesisRoadmapEntries(results, summaryInsights, labels), labels);
  const methodSignals = uniqueInsightLines(generatedItems.map((item) => summaryInsights.get(item.itemKey)?.method).filter(Boolean)).slice(0, 6);
  const dataSignals = uniqueInsightLines(generatedItems.flatMap((item) => {
    const insight = summaryInsights.get(item.itemKey) || {};
    return insightValues(insight.dataScenario, insight.metrics);
  })).slice(0, 8);
  const gapSignals = uniqueInsightLines(generatedItems.flatMap((item) => {
    const insight = summaryInsights.get(item.itemKey) || {};
    return insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds);
  })).slice(0, 8);
  return [
    `# ${collectionContext.name || collectionContext.key} ${labels.formalReviewReport}`,
    "",
    `## ${labels.reportAbstract}`,
    "",
    labels.formalReportIntro(collectionContext.name || collectionContext.key, stats),
    "",
    `## ${labels.reportScopeAndEvidence}`,
    "",
    `- ${labels.scope}: ${collectionContext.name || collectionContext.key}`,
    `- ${labels.availableSummaries}: ${generatedItems.length}`,
    `- ${labels.summaryColumn}: ${labels.reportSourceFiles}`,
    labels.reportEvidenceWarning,
    "",
    `## ${labels.reportWritingReadinessGate}`,
    "",
    renderFormalReportWritingReadinessGate(synthesisClaims, roadmapReadiness, gapSignals, stats, labels),
    "",
    `## ${labels.reportPaperInventory}`,
    "",
    reportInventoryTable(generatedItems, summaryInsights, labels),
    "",
    `## ${labels.reportMethodTaxonomy}`,
    "",
    reportBulletList(methodSignals, labels.pendingInsight),
    "",
    `## ${labels.reportDataAndEvidence}`,
    "",
    reportBulletList(dataSignals, labels.pendingInsight),
    "",
    `## ${labels.reportTopicSynthesis}`,
    "",
    reportClusterSections(clusters, labels),
    "",
    `## ${labels.reportSynthesisClaims}`,
    "",
    reportSynthesisClaims(synthesisClaims, labels),
    "",
    `## ${labels.reportClaimEvidenceAudit}`,
    "",
    reportClaimEvidenceAudit(synthesisClaims, labels),
    "",
    `## ${labels.reportSynthesisConflicts}`,
    "",
    reportSynthesisConflicts(synthesisConflicts, labels),
    "",
    `## ${labels.reportResearchGaps}`,
    "",
    reportBulletList(gapSignals, labels.gapMatrixPendingEvidence),
    "",
    `## ${labels.reportDraftOutline}`,
    "",
    reportDraftOutline(clusters, labels),
    "",
    `## ${labels.roadmapReadinessBoard}`,
    "",
    renderSynthesisRoadmapReadinessRows(roadmapReadiness, labels),
    "",
    `## ${labels.reportSynthesisWritingPack}`,
    "",
    renderCollectionSynthesisWritingPack(collectionContext, clusters, synthesisClaims, synthesisConflicts, gapSignals, labels),
    "",
    `## ${labels.reportRiskChecklist}`,
    "",
    labels.reportRiskChecklistItems,
    "",
    `## ${labels.reportNextActions}`,
    "",
    labels.reportNextActionItems,
    ""
  ].join("\n");
}

function renderFormalReportWritingReadinessGate(synthesisClaims = [], roadmapReadiness = [], gapSignals = [], stats = {}, labels = collectionTemplateLabels("zh-CN")) {
  const summary = formalReportWritingReadinessSummary(synthesisClaims, roadmapReadiness, gapSignals, stats, labels);
  const rows = (summary.checks || []).map((check) => [
    escapeMarkdownTable(check.check),
    escapeMarkdownTable(check.status),
    escapeMarkdownTable(check.evidence),
    escapeMarkdownTable(check.action)
  ].join(" | ")).map((row) => `| ${row} |`);
  return [
    `- ${labels.reportWritingReadinessScore}: ${summary.score}/100`,
    `- ${labels.reportWritingReadinessLevel}: ${summary.level}`,
    `- ${labels.reportWritingReadinessBlockers}: ${summary.blockers.join("; ") || labels.reportWritingReadinessNoBlockers}`,
    "",
    `| ${labels.reportWritingReadinessCheckColumn} | ${labels.reportWritingReadinessStatusColumn} | ${labels.evidenceColumn} | ${labels.roadmapNextActionColumn} |`,
    "| --- | --- | --- | --- |",
    rows.join("\n") || `| ${escapeMarkdownTable(labels.reportWritingReadinessCheckColumn)} | ${escapeMarkdownTable(labels.reportReadinessBlocked)} | ${escapeMarkdownTable(labels.noSummary)} | ${escapeMarkdownTable(labels.reportReadinessDefaultAction(labels.reportReadinessBlocked))} |`
  ].join("\n");
}

function formalReportWritingReadinessSummary(synthesisClaims = [], roadmapReadiness = [], gapSignals = [], stats = {}, labels = collectionTemplateLabels("zh-CN")) {
  const available = Number(stats.generated || 0) + Number(stats.skippedExisting || 0);
  const skippedNoPdf = Number(stats.skippedNoPdf || 0);
  const failed = Number(stats.failed || 0);
  const scores = (synthesisClaims || []).map((entry) => Number(entry.claimSupportScore || 0)).filter((score) => Number.isFinite(score));
  const averageClaimScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
  const highRiskClaims = (synthesisClaims || []).filter((entry) => formalReportRiskMatches(entry?.claimRisk, labels.claimRiskHigh, /high|高|高度|暫定|薄い/i)).length;
  const mediumRiskClaims = (synthesisClaims || []).filter((entry) => formalReportRiskMatches(entry?.claimRisk, labels.claimRiskMedium, /medium|中/i)).length;
  const readyRoutes = (roadmapReadiness || []).filter((entry) => entry?.roadmapReadinessLevel === labels.roadmapReadinessReady).length;
  const evidenceThinRoutes = (roadmapReadiness || []).filter((entry) => entry?.roadmapReadinessLevel === labels.roadmapReadinessNeedsEvidence).length;
  const validationRoutes = (roadmapReadiness || []).filter((entry) => entry?.roadmapReadinessLevel === labels.roadmapReadinessNeedsValidation).length;
  const unresolvedGapCount = uniqueInsightLines(gapSignals || []).length;
  const score = Math.max(0, Math.min(100, Math.round(
    averageClaimScore * 0.45
    + Math.min(available, 8) * 4
    + readyRoutes * 8
    + Math.min(unresolvedGapCount, 6) * 2
    - highRiskClaims * 12
    - mediumRiskClaims * 4
    - evidenceThinRoutes * 6
    - validationRoutes * 4
    - skippedNoPdf * 3
    - failed * 5
  )));
  const level = score >= 75 && highRiskClaims === 0 && readyRoutes > 0
    ? labels.reportReadinessReady
    : score >= 50
      ? labels.reportReadinessRevise
      : labels.reportReadinessBlocked;
  const blockers = uniqueInsightLines([
    highRiskClaims ? labels.reportReadinessHighRiskBlocker(highRiskClaims) : "",
    evidenceThinRoutes ? labels.reportReadinessEvidenceBlocker(evidenceThinRoutes) : "",
    validationRoutes ? labels.reportReadinessValidationBlocker(validationRoutes) : "",
    skippedNoPdf || failed ? labels.reportReadinessCoverageBlocker(skippedNoPdf, failed) : "",
    !unresolvedGapCount ? labels.reportReadinessGapBlocker : ""
  ].filter(Boolean)).slice(0, 6);
  return {
    score,
    level,
    blockers,
    checks: [
      {
        check: labels.reportReadinessEvidenceBase,
        status: available >= 2 && skippedNoPdf === 0 ? labels.reportReadinessPass : available ? labels.reportReadinessReview : labels.reportReadinessFail,
        evidence: labels.reportReadinessEvidenceBaseEvidence(available, skippedNoPdf, failed),
        action: skippedNoPdf || failed ? labels.reportReadinessCoverageAction : labels.reportReadinessProceedAction
      },
      {
        check: labels.reportReadinessClaimRisk,
        status: highRiskClaims ? labels.reportReadinessFail : mediumRiskClaims ? labels.reportReadinessReview : labels.reportReadinessPass,
        evidence: labels.reportReadinessClaimRiskEvidence(highRiskClaims, mediumRiskClaims, averageClaimScore),
        action: highRiskClaims ? labels.reportReadinessClaimRiskAction : labels.reportReadinessProceedAction
      },
      {
        check: labels.reportReadinessRoadmap,
        status: readyRoutes ? labels.reportReadinessPass : roadmapReadiness.length ? labels.reportReadinessReview : labels.reportReadinessFail,
        evidence: labels.reportReadinessRoadmapEvidence(readyRoutes, evidenceThinRoutes, validationRoutes),
        action: labels.reportReadinessRoadmapAction
      },
      {
        check: labels.reportReadinessGapTrace,
        status: unresolvedGapCount ? labels.reportReadinessReview : labels.reportReadinessFail,
        evidence: labels.reportReadinessGapTraceEvidence(unresolvedGapCount),
        action: unresolvedGapCount ? labels.reportReadinessGapTraceAction : labels.reportReadinessGapBlocker
      }
    ]
  };
}

function formalReportRiskMatches(value, localizedValue, pattern) {
  const text = String(value || "");
  return !!text && (text === localizedValue || pattern.test(text));
}

function renderCollectionSynthesisWritingPack(collectionContext, clusters, synthesisClaims, synthesisConflicts, gapSignals, labels) {
  const claimByCluster = new Map((synthesisClaims || []).map((entry) => [entry.cluster, entry]));
  const conflictByCluster = new Map((synthesisConflicts || []).map((entry) => [entry.cluster, entry]));
  const rows = (clusters || []).slice(0, 8).map((cluster) => {
    const claim = claimByCluster.get(cluster.label) || {};
    const conflict = conflictByCluster.get(cluster.label) || {};
    const methods = uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean)).slice(0, 3);
    const gaps = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds))).slice(0, 3);
    const papers = cluster.items.map(({ item }) => `${item.title || item.itemKey} (${item.year || "n.d."})`).slice(0, 5);
    const evidence = uniqueInsightLines([
      ...(claim.supportingPapers || []),
      ...(claim.evidence || []),
      ...cluster.items.map(({ item }) => item.summaryPath).filter(Boolean)
    ]).slice(0, 6);
    const method = methods[0] || labels.pendingInsight;
    const gap = gaps[0] || claim.gaps?.[0] || gapSignals?.[0] || labels.gapMatrixPendingEvidence;
    const draftClaim = claim.claim || labels.synthesisClaimText(cluster.label, method, gap);
    return [
      escapeMarkdownTable(cluster.label),
      escapeMarkdownTable(labels.synthesisWritingTask(cluster.label, method, gap)),
      escapeMarkdownTable(evidence.join("; ") || papers.join("; ") || labels.pendingSummaryPath),
      escapeMarkdownTable(claim.claimAuditAction || conflict.reviewAction || labels.synthesisConflictCheck(draftClaim, gap)),
      escapeMarkdownTable(labels.synthesisModelPrompt(cluster.label, method, gap, draftClaim)),
      escapeMarkdownTable(labels.synthesisManualReview(collectionContext?.name || collectionContext?.key || "", cluster.label, papers.join("; ") || labels.noSummary))
    ].join(" | ");
  }).map((row) => `| ${row} |`);
  const fallback = [
    escapeMarkdownTable(labels.clusterOther),
    escapeMarkdownTable(labels.synthesisWritingTask(labels.clusterOther, labels.pendingInsight, labels.gapMatrixPendingEvidence)),
    escapeMarkdownTable(labels.pendingSummaryPath),
    escapeMarkdownTable(labels.synthesisConflictCheck(labels.pendingInsight, labels.gapMatrixPendingEvidence)),
    escapeMarkdownTable(labels.synthesisModelPrompt(labels.clusterOther, labels.pendingInsight, labels.gapMatrixPendingEvidence, labels.pendingInsight)),
    escapeMarkdownTable(labels.synthesisManualReview(collectionContext?.name || collectionContext?.key || "", labels.clusterOther, labels.noSummary))
  ].join(" | ");
  return [
    `| ${labels.clusterColumn} | ${labels.writingTaskColumn} | ${labels.evidenceAnchorColumn} | ${labels.conflictCheckColumn} | ${labels.modelDeepeningPromptColumn} | ${labels.manualReviewColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    rows.join("\n") || `| ${fallback} |`
  ].join("\n");
}

function reportInventoryTable(items, summaryInsights, labels) {
  const rows = items.map((item) => {
    const insight = summaryInsights.get(item.itemKey) || {};
    return [
      escapeMarkdownTable(item.title || item.itemKey),
      escapeMarkdownTable(item.year || ""),
      escapeMarkdownTable(insight.method || labels.pendingInsight),
      escapeMarkdownTable(insight.evidence || item.summaryPath || labels.pendingSummaryPath),
      escapeMarkdownTable(insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds)[0] || labels.gapMatrixPendingEvidence),
      escapeMarkdownTable(item.summaryPath || labels.pendingSummaryPath)
    ].join(" | ");
  }).map((row) => `| ${row} |`).join("\n") || "|  |  |  |  |  |  |";
  return [
    `| ${labels.paperColumn} | ${labels.yearColumn} | ${labels.methodSignalColumn} | ${labels.existingEvidence} | ${labels.gapSignalColumn} | ${labels.summaryColumn} |`,
    "| --- | --- | --- | --- | --- | --- |",
    rows
  ].join("\n");
}

function reportClusterSections(clusters, labels) {
  if (!clusters.length) return `- ${labels.noSummary}`;
  return clusters.map((cluster) => {
    const methods = uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean)).slice(0, 3);
    const gaps = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds))).slice(0, 3);
    const papers = cluster.items.map(({ item }) => item.title || item.itemKey).slice(0, 6).join("; ");
    return [
      `### ${cluster.label}`,
      "",
      `- ${labels.paperColumn}: ${papers || labels.noSummary}`,
      `- ${labels.methodSignalColumn}: ${methods.join("; ") || labels.pendingInsight}`,
      `- ${labels.gapSignalColumn}: ${gaps.join("; ") || labels.gapMatrixPendingEvidence}`,
      `- ${labels.clusterWritingEntry}: ${labels.clusterWritingText(cluster.label, methods[0] || labels.pendingInsight, gaps[0] || labels.gapMatrixPendingEvidence)}`
    ].join("\n");
  }).join("\n\n");
}

function reportSynthesisClaims(entries, labels) {
  if (!entries.length) return `- ${labels.noSummary}`;
  return entries.slice(0, 8).map((entry) => [
    `### ${entry.cluster}`,
    "",
    `- ${labels.claimColumn}: ${entry.claim}`,
    `- ${labels.claimSupportScoreColumn}: ${entry.claimSupportScore}`,
    `- ${labels.claimRiskColumn}: ${entry.claimRisk}`,
    `- ${labels.evidenceTraceColumn}: ${entry.evidenceTrace}`,
    `- ${labels.supportingPapersColumn}: ${entry.supportingPapers.join("; ") || labels.noSummary}`,
    `- ${labels.evidenceColumn}: ${entry.evidence.join("; ") || labels.pendingSummaryPath}`,
    `- ${labels.counterGapColumn}: ${entry.gaps.join("; ") || labels.gapMatrixPendingEvidence}`,
    `- ${labels.validationColumn}: ${entry.validations.join("; ") || labels.gapMatrixPendingValidation}`,
    `- ${labels.reviewActionColumn}: ${entry.claimAuditAction || labels.claimAuditAction(entry.claimRisk || labels.claimRiskHigh, entry.claimSupportScore || 0)}`
  ].join("\n")).join("\n\n");
}

function reportClaimEvidenceAudit(entries, labels) {
  const rows = (entries || []).slice(0, 12).map((entry) => [
    escapeMarkdownTable(entry.cluster),
    escapeMarkdownTable(entry.claimSupportScore),
    escapeMarkdownTable(entry.claimRisk),
    escapeMarkdownTable(entry.evidenceTrace),
    escapeMarkdownTable((entry.supportingPapers || []).join("; ") || labels.noSummary),
    escapeMarkdownTable(entry.claimAuditAction || labels.claimAuditAction(entry.claimRisk || labels.claimRiskHigh, entry.claimSupportScore || 0))
  ].join(" | ")).map((row) => `| ${row} |`);
  return [
    `| ${labels.clusterColumn} | ${labels.claimSupportScoreColumn} | ${labels.claimRiskColumn} | ${labels.evidenceTraceColumn} | ${labels.supportingPapersColumn} | ${labels.reviewActionColumn} |`,
    "| --- | ---: | --- | --- | --- | --- |",
    rows.join("\n") || "|  | 0 |  |  |  |  |"
  ].join("\n");
}

function reportSynthesisConflicts(entries, labels) {
  if (!entries.length) return `- ${labels.noSummary}`;
  return entries.slice(0, 8).map((entry) => [
    `### ${entry.cluster}`,
    "",
    `- ${labels.claimColumn}: ${entry.claim}`,
    `- ${labels.supportLevelColumn}: ${entry.supportLevel}`,
    `- ${labels.claimSupportScoreColumn}: ${entry.claimSupportScore}`,
    `- ${labels.claimRiskColumn}: ${entry.claimRisk}`,
    `- ${labels.evidenceTraceColumn}: ${entry.evidenceTrace}`,
    `- ${labels.counterGapColumn}: ${entry.counterGap}`,
    `- ${labels.validationColumn}: ${entry.validation}`,
    `- ${labels.reviewActionColumn}: ${entry.reviewAction}`
  ].join("\n")).join("\n\n");
}

function reportBulletList(items, fallback) {
  const values = uniqueInsightLines((items || []).filter(Boolean)).slice(0, 10);
  return values.length ? values.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function reportDraftOutline(clusters, labels) {
  const entries = (clusters || []).slice(0, 6).map((cluster, index) => {
    const method = uniqueInsightLines(cluster.items.map(({ insight }) => insight.method).filter(Boolean))[0] || labels.pendingInsight;
    const gap = uniqueInsightLines(cluster.items.flatMap(({ insight }) => insightValues(insight.limitations, insight.missingEvidence, insight.validationNeeds)))[0] || labels.gapMatrixPendingEvidence;
    return `${index + 1}. ${labels.reportOutlineEntry(cluster.label, method, gap)}`;
  });
  return entries.length ? entries.join("\n") : `1. ${labels.reportOutlineEntry(labels.clusterOther, labels.pendingInsight, labels.gapMatrixPendingEvidence)}`;
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
      topicClusters: "Topic Clusters",
      topicClustersNote: "Heuristic collection-level clusters built from titles and extracted summary signals. Treat them as a review starting point, not final taxonomy.",
      synthesisClaims: "Synthesis Claims Matrix",
      synthesisClaimsNote: "Draft cross-paper claims from topic clusters and single-paper summaries. Use this as a controlled claim ledger before writing prose.",
      synthesisConflictLedger: "Synthesis Conflict Ledger",
      synthesisConflictLedgerNote: "Track weak support, counter-evidence, missing evidence, and validation needs before moving claims into review prose.",
      synthesisRoadmap: "Synthesis Roadmap",
      synthesisRoadmapNote: "Turns topic clusters, claim drafts, and evidence gaps into a section-level roadmap for the next review-writing pass.",
      roadmapEvidenceMap: "Cross-theme Evidence Map",
      roadmapQuestionColumn: "Review Question",
      roadmapCandidateQueryColumn: "Candidate-search Query",
      roadmapSectionPlan: "Section Plan",
      roadmapEvidenceIndex: "Evidence Index",
      roadmapReadinessBoard: "Roadmap Readiness Board",
      roadmapReadinessScoreColumn: "Readiness Score",
      roadmapReadinessLevelColumn: "Readiness Level",
      roadmapBlockingIssueColumn: "Blocking Issue",
      roadmapNextActionColumn: "Next Action",
      roadmapReadinessReady: "Ready for draft",
      roadmapReadinessNeedsEvidence: "Needs evidence",
      roadmapReadinessNeedsValidation: "Needs validation",
      roadmapReadinessDefer: "Defer",
      roadmapReadinessNoBlocking: "No immediate blocker",
      roadmapReadinessBlockingEvidence: (count, risk) => `Evidence is thin: ${count || 0} supporting paper(s); ${risk || "risk pending"}`,
      roadmapReadinessBlockingValidation: "Validation plan is still pending",
      roadmapReadinessBlockingGap: (gap) => `Open gap must stay explicit: ${gap}`,
      roadmapReadinessBlockingScore: (score) => `Readiness score ${score || 0} is below the writing threshold`,
      roadmapReadinessAction: (level, cluster, issue, query) => `${level}: verify ${cluster}; ${issue}; next search/check: ${query || "candidate query pending"}.`,
      crossCollectionSynthesis: "Cross-Collection Synthesis Map",
      crossCollectionSynthesisNote: "Aggregates the latest collection workspaces into one review-planning surface. Use it to compare themes across collections before writing a broader review.",
      crossCollectionInventory: "Collection Inventory",
      crossCollectionThemeMap: "Cross-Collection Theme Map",
      crossCollectionClusterMap: "Cross-Collection Cluster Map",
      crossCollectionSynthesisLayoutBoard: "Cross-Collection Synthesis Layout Board",
      crossCollectionClusterCalibrationBoard: "Cluster Threshold Calibration Board",
      crossCollectionClusterEvidenceCards: "Cluster Evidence Cards",
      crossCollectionThemeMergeBoard: "Theme Merge Review Board",
      crossCollectionBridgeBoard: "Cross-Collection Bridge Board",
      crossCollectionGapBoard: "Cross-Collection Gap Board",
      crossCollectionPriorityBoard: "Cross-Collection Priority Board",
      crossCollectionChartReviewTriage: "Cross-Collection Chart Review Triage",
      crossCollectionReviewPack: "Cross-Collection Review Pack",
      crossCollectionClusterScopeColumn: "Cluster Scope",
      crossCollectionClusterScoreColumn: "Cluster Score",
      crossCollectionEvidenceRankColumn: "Evidence Card Rank",
      crossCollectionEvidenceRankSignalsColumn: "Rank Signals",
      crossCollectionGapPriorityColumn: "Gap Priority Score",
      crossCollectionGapPrioritySignalsColumn: "Gap Priority Signals",
      crossCollectionGapPriorityPending: "gap priority pending",
      crossCollectionClusterThresholdColumn: "Threshold Evidence",
      crossCollectionClusterRecommendationColumn: "Calibration Recommendation",
      crossCollectionClusterLinkColumn: "Link Evidence",
      crossCollectionClusterRiskColumn: "Review Risk",
      crossCollectionSupportColumn: "Cross-Collection Support",
      crossCollectionLayoutLaneColumn: "Layout Lane",
      crossCollectionLayoutOrderColumn: "Lane Order",
      crossCollectionLayoutWeightColumn: "Layout Weight",
      crossCollectionLayoutLaneCore: "Core shared section",
      crossCollectionLayoutLaneBoundary: "Boundary review before writing",
      crossCollectionLayoutLaneGap: "Evidence gap follow-up",
      crossCollectionLayoutLaneSupport: "Supporting context",
      crossCollectionPriorityColumn: "Priority",
      crossCollectionReasonColumn: "Reason",
      crossCollectionScopeColumn: "Review Scope",
      crossCollectionMergeScopeColumn: "Merge Scope",
      crossCollectionThemeCandidatesColumn: "Theme Candidates",
      crossCollectionSharedSignalsColumn: "Shared Signals",
      crossCollectionMergeRiskColumn: "Merge Risk",
      crossCollectionMergePending: "Pending theme merge review",
      crossCollectionMergeRiskPending: "Pending merge-risk review",
      crossCollectionSharedToken: "shared token",
      crossCollectionPriorityPending: "Pending priority review",
      crossCollectionPriorityReasonPending: "Pending reason",
      crossCollectionPriorityRecurringReason: (count) => `Gap repeats across ${count} collections`,
      crossCollectionPrioritySingleReason: "Collection-specific gap; verify scope before broadening",
      crossCollectionPriorityWeakThemeReason: "Weak theme support",
      crossCollectionPriorityGapSignalReason: "Theme has unresolved gap signals",
      crossCollectionPriorityGap: (count, gap) => count >= 2
        ? `Recurring gap: ${gap}`
        : `Scope check: ${gap}`,
      crossCollectionPriorityMergeThemes: (themes) => `Review possible theme merge: ${themes}`,
      crossCollectionPriorityMergeReason: "Different theme labels share evidence signals",
      crossCollectionPriorityCluster: (cluster, count) => `Write cross-collection section: ${cluster}`,
      crossCollectionPriorityClusterReason: (count, score) => `Cluster spans ${count} collections; score ${score || 0}`,
      crossCollectionPriorityWeakTheme: (theme, count) => count >= 2
        ? `Review theme gaps: ${theme}`
        : `Add support for theme: ${theme}`,
      crossCollectionPriorityWeakThemeAction: (theme) => `Open the collection report, verify ${theme}, and run candidate search if evidence is thin.`,
      crossCollectionClusterTitle: (themes) => (themes || []).slice(0, 3).join(" / ") || "Unlabeled cross-collection cluster",
      crossCollectionClusterSupport: (count, papers) => count >= 2
        ? `${count} collections, ${papers} papers`
        : `single collection, ${papers} papers`,
      crossCollectionEvidenceRankCoverage: (count, papers) => `coverage: ${count || 0} collections, ${papers || 0} papers`,
      crossCollectionEvidenceRankLinks: (links) => `link signals: ${links || 0}`,
      crossCollectionEvidenceRankCalibration: (recommendation) => `calibration: ${recommendation || "pending"}`,
      crossCollectionEvidenceRankRisk: (risk) => `risk: ${risk || "pending"}`,
      crossCollectionGapPriorityCoverage: (count) => `coverage: ${count || 0} collections`,
      crossCollectionGapPriorityThemes: (count) => `themes: ${count || 0}`,
      crossCollectionGapPriorityQueries: (count) => `candidate queries: ${count || 0}`,
      crossCollectionGapPriorityRecurring: (count) => `recurring gap across ${count || 0} collections`,
      crossCollectionGapPrioritySingle: "single-collection gap",
      crossCollectionLayoutAction: (lane, cluster) => `${lane}: verify source reports for ${cluster}, then draft or defer the review section according to the lane.`,
      crossCollectionClusterPrompt: (cluster, count) => `Turn ${cluster} into a review section plan across ${count || "the relevant"} collections; separate shared claims, scope-specific claims, and missing evidence.`,
      crossCollectionClusterReviewAction: (cluster) => `Verify the source collection reports for ${cluster}; keep only evidence-backed shared claims.`,
      crossCollectionClusterNoEvidence: "No cluster evidence cards are available yet.",
      crossCollectionClusterLinkPending: "link evidence pending",
      crossCollectionClusterRiskPending: "review risk pending",
      crossCollectionClusterRisk: (count, themes, links) => count >= 2 && links >= 2
        ? "medium: verify shared evidence before merging review sections"
        : themes > 2
          ? "high: broad theme mix; split if evidence is not comparable"
          : "low: narrow scope, still verify source summaries",
      crossCollectionClusterThresholdPending: "threshold evidence pending",
      crossCollectionClusterThresholdBand: (score, count, links) => `score ${score || 0}; ${count || 0} collections; ${links || 0} link signals`,
      crossCollectionClusterCalibrationRecommendation: (key) => ({
        merge: "Promote to shared review section",
        review: "Boundary review before merging",
        split: "Keep as neighboring or split scope",
        gather: "Gather more evidence before cross-collection claim"
      }[key] || "Boundary review before merging"),
      crossCollectionClusterCalibrationReview: "Boundary review before merging",
      crossCollectionClusterCalibrationAction: (cluster, recommendation) => `Apply threshold check for ${cluster}: ${recommendation || "review boundary, evidence comparability, and source reports"}.`,
      crossCollectionClusterLinkSameTheme: (theme) => `same normalized theme: ${theme}`,
      crossCollectionClusterLinkSharedTokens: (count) => `${count} shared evidence tokens`,
      crossCollectionClusterLinkStrongTokens: (tokens) => `strong shared tokens: ${tokens}`,
      crossCollectionClusterLinkMethodOverlap: "method-signal overlap",
      crossCollectionClusterLinkGapOverlap: "gap-signal overlap",
      crossCollectionClusterLinkQueryOverlap: "candidate-query overlap",
      crossCollectionChartReviewStateColumn: "Review State",
      crossCollectionChartReviewActionCountColumn: "Actions",
      crossCollectionChartReviewCollectionCountColumn: "Collections",
      crossCollectionChartReviewPaperCountColumn: "Papers",
      crossCollectionChartReviewCollectionsColumn: "Collections",
      crossCollectionChartReviewBlockingColumn: "Blocking Issue",
      crossCollectionChartReviewBatchActionColumn: "Batch Action",
      crossCollectionChartReviewDoneColumn: "Done Criteria",
      crossCollectionChartReviewIndexColumn: "Chart Review Index",
      crossCollectionChartReviewNoIssue: "No blocking issue recorded",
      crossCollectionChartReviewActionPending: "Batch action pending",
      crossCollectionChartReviewDonePending: "Done criteria pending",
      crossCollectionChartReviewIndexPending: "chart review index pending",
      crossCollectionChartReviewEmpty: "No collection-level chart review tasks are available yet.",
      crossCollectionChartReviewDrilldown: "Chart Review Drilldown",
      crossCollectionChartReviewWritebackTargets: "Batch Status Writeback Targets",
      crossCollectionChartReviewCurrentStateColumn: "Current State",
      crossCollectionChartReviewTargetStateColumn: "Suggested State",
      crossCollectionChartReviewStatusPatchColumn: "Status Patch",
      crossCollectionChartReviewMatchColumn: "Match Filter",
      crossCollectionChartReviewDrilldownSummary: (index, entry) => `${index}. ${entry.priority || "medium"} / ${entry.reviewState || "todo"} - ${entry.count || 0} action(s) across ${entry.collectionCount || 0} collection(s)`,
      crossCollectionChartReviewChecklistOpenIndexes: "Open each linked chart review index and inspect the source visual reports.",
      crossCollectionChartReviewChecklistVerifyPapers: "Verify the listed papers before reusing extracted chart values.",
      crossCollectionChartReviewChecklistUpdateState: "Update reviewer, due date, notes, and review state in the source workbench/export.",
      collectionColumn: "Collection",
      reportColumn: "Report",
      crossCollectionStatsLine: (stats) => `Collections ${stats.collections}, papers ${stats.totalPapers}, available summaries ${stats.availableSummaries}, skipped without PDF ${stats.skippedNoPdf}, failed ${stats.failed}.`,
      crossCollectionGapAction: (count, gap) => count >= 2
        ? `Prioritize candidate search; this gap recurs in ${count} collections: ${gap}`
        : `Check whether this gap is collection-specific before broadening: ${gap}`,
      crossCollectionBridgeQuestion: (theme, count) => `How should ${theme} connect evidence across ${count} collections without merging incompatible scopes?`,
      crossCollectionBridgeAction: (theme) => `Compare methods and gaps for ${theme}; promote only evidence-backed common claims.`,
      crossCollectionReviewPrompt: (scope, gap) => `Compare ${scope} across collections, separate shared evidence from scope-specific evidence, and list what papers or checks are still needed for ${gap}.`,
      crossCollectionGapWritingPrompt: (gap) => `Turn the recurring gap "${gap}" into a review subsection plan with evidence needed, candidate searches, and exclusion criteria.`,
      crossCollectionReviewAction: (scope) => `Open the linked collection reports, verify ${scope}, and cite only source-backed claims.`,
      crossCollectionMergeScope: (left, right) => `${left} <-> ${right}`,
      crossCollectionMergeRisk: (themes, signals) => `Possible over-merge or split: ${themes}; shared signals: ${signals || "pending"}.`,
      crossCollectionMergeAction: (scope) => `Open the source collection reports for ${scope}; decide whether to merge, split, or keep as neighboring review sections.`,
      crossCollectionNextActions: [
        "- [ ] Use the theme merge review board to decide whether similarly signaled clusters should be merged or kept separate.",
        "- [ ] Use the bridge board to decide which recurring themes can become cross-collection review sections.",
        "- [ ] Check whether similar clusters across collections should be merged or kept as separate review scopes.",
        "- [ ] Open each collection's formal report before moving claims into a cross-collection manuscript.",
        "- [ ] Run candidate-paper search for recurring gaps that appear in more than one collection."
      ].join("\n"),
      roadmapQuestionText: (cluster, method, gap) => `How should ${cluster} papers be compared around ${method}, and what evidence is still missing around ${gap}?`,
      roadmapSectionText: (index, cluster, method, gap) => `Section ${index}: use ${cluster} to compare ${method}; close or clearly mark ${gap}.`,
      roadmapChecklistItems: [
        "- [ ] Check whether each section has enough papers before writing synthesis prose.",
        "- [ ] Run candidate-paper search with the suggested query when a cluster has weak evidence.",
        "- [ ] Keep unresolved gaps visible instead of smoothing them into unsupported claims."
      ].join("\n"),
      gapMatrix: "Research Gap Matrix",
      gapMatrixNote: "Use this matrix to consolidate limitations, missing evidence, and validation needs before moving claims into writing.",
      gapMatrixPendingLimitation: "Pending limitation extraction",
      gapMatrixPendingEvidence: "Pending missing-evidence extraction",
      gapMatrixPendingValidation: "Pending validation design",
      pendingInsight: "Pending extraction from single-paper summary",
      pendingRejectCondition: "Pending falsification condition",
      paperColumn: "Paper",
      yearColumn: "Year",
      clusterColumn: "Cluster",
      claimColumn: "Draft Claim",
      claimSupportScoreColumn: "Claim Support Score",
      claimRiskColumn: "Claim Risk",
      evidenceTraceColumn: "Evidence Trace",
      supportingPapersColumn: "Supporting Papers",
      evidenceColumn: "Evidence Sources",
      evidenceAnchorColumn: "Evidence Anchors",
      counterGapColumn: "Counter-evidence / Gap",
      supportLevelColumn: "Support Level",
      reviewActionColumn: "Review Action",
      writingTaskColumn: "Writing Task",
      conflictCheckColumn: "Conflict Check",
      manualReviewColumn: "Manual Review",
      modelDeepeningPromptColumn: "Model Deepening Prompt",
      methodSignalColumn: "Method Signal",
      gapSignalColumn: "Gap / Validation Signal",
      limitationColumn: "Observed Limitation",
      missingEvidenceColumn: "Missing Evidence",
      validationColumn: "Validation Need",
      summaryColumn: "Summary",
      synthesisClaimText: (cluster, methods, gap) => `${cluster}: current summaries suggest ${methods}; the main unresolved gap is ${gap}.`,
      claimRiskLow: "low: multi-paper support with traceable evidence",
      claimRiskMedium: "medium: traceable evidence but unresolved gaps remain",
      claimRiskHigh: "high: single-paper or thin evidence",
      claimEvidenceTrace: (papers, evidence, validations) => `${papers || 0} paper(s), ${evidence || 0} evidence source(s), ${validations || 0} validation cue(s)`,
      claimAuditAction: (risk, score) => `Audit claim (${score || 0}/100): ${risk || "risk pending"}; verify trace before final writing.`,
      claimRiskChecklist: "Claim Risk Checklist",
      claimRiskChecklistItems: [
        "- [ ] Verify that every draft claim has at least two supporting papers or mark it as single-paper evidence.",
        "- [ ] Separate missing evidence from actual negative evidence.",
        "- [ ] Check whether methods, datasets, scenarios, and metrics are comparable before merging claims.",
        "- [ ] Move only verified claims into the formal review report or manuscript draft."
      ].join("\n"),
      conflictReviewChecklist: "Conflict Review Checklist",
      conflictReviewChecklistItems: [
        "- [ ] Do not turn single-paper support into a collection-level conclusion.",
        "- [ ] Separate true counter-evidence from untested scenarios or missing measurements.",
        "- [ ] Add candidate-paper searches for clusters whose validation need remains unresolved.",
        "- [ ] Keep the conflict ledger next to the formal report during manual revision."
      ].join("\n"),
      supportLevelMultiPaper: (count) => `${count} supporting papers`,
      supportLevelSinglePaper: "Single-paper support; keep claim tentative",
      conflictReviewAction: (count, gap, validation) => count >= 2
        ? `Check comparability and resolve: ${gap || validation}`
        : `Collect more supporting papers before writing; validation need: ${validation}`,
      clusterSynthesis: "Synthesis",
      clusterWritingEntry: "Writing entry",
      clusterSynthesisText: (methods, gaps) => `Method signals: ${methods}. Evidence gaps: ${gaps}.`,
      clusterWritingText: (cluster, method, gap) => `Use the ${cluster} cluster to compare ${method} against ${gap}.`,
      clusterTransportationAirspace: "Transportation / Urban Airspace",
      clusterSafetyRisk: "Safety / Risk",
      clusterAiMethods: "AI / Model Methods",
      clusterDataEvaluation: "Data / Evaluation",
      clusterBiomedicine: "Biomedicine",
      clusterHumanPolicy: "Human / Policy",
      clusterOther: "Other / Needs Manual Review",
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
      ].join("\n"),
      formalReviewReport: "Formal Review Report",
      reportAbstract: "Draft Abstract",
      formalReportIntro: (name, stats) => `This report drafts a collection-level review for ${name}. It is based on ${stats.generated + stats.skippedExisting} available single-paper summaries from the latest batch run, with ${stats.skippedNoPdf} skipped without PDF and ${stats.failed} failed items. Treat every synthesis claim as a draft until the cited summaries and original papers are checked.`,
      reportScopeAndEvidence: "Scope and Evidence Base",
      reportSourceFiles: "single-paper summaries, method matrix, research-gap matrix, topic clusters, and idea list in this collection workspace",
      reportEvidenceWarning: "- Evidence rule: keep claims tied to the listed summaries and mark unsupported cross-paper claims before external use.",
      reportPaperInventory: "Paper Inventory and Evidence Map",
      reportMethodTaxonomy: "Method Taxonomy",
      reportDataAndEvidence: "Data, Scenario, and Metric Evidence",
      reportTopicSynthesis: "Topic-level Synthesis",
      reportSynthesisClaims: "Evidence-backed Synthesis Claims",
      reportClaimEvidenceAudit: "Claim Evidence Audit",
      reportSynthesisConflicts: "Synthesis Conflicts and Evidence Gaps",
      reportResearchGaps: "Research Gaps and Validation Needs",
      reportDraftOutline: "Review Draft Outline",
      reportWritingReadinessGate: "Writing Readiness Gate",
      reportWritingReadinessScore: "Formal report readiness score",
      reportWritingReadinessLevel: "Readiness level",
      reportWritingReadinessBlockers: "Blocking items",
      reportWritingReadinessNoBlockers: "No blocking item from current summaries",
      reportWritingReadinessCheckColumn: "Gate Check",
      reportWritingReadinessStatusColumn: "Status",
      reportReadinessReady: "Ready for prose draft",
      reportReadinessRevise: "Revise before prose draft",
      reportReadinessBlocked: "Blocked until evidence is added",
      reportReadinessPass: "pass",
      reportReadinessReview: "review",
      reportReadinessFail: "fail",
      reportReadinessHighRiskBlocker: (count) => `${count || 0} high-risk claim(s) need evidence audit`,
      reportReadinessEvidenceBlocker: (count) => `${count || 0} roadmap topic(s) still need evidence`,
      reportReadinessValidationBlocker: (count) => `${count || 0} roadmap topic(s) still need validation design`,
      reportReadinessCoverageBlocker: (skipped, failed) => `Coverage issue: skipped without PDF ${skipped || 0}, failed ${failed || 0}`,
      reportReadinessGapBlocker: "No explicit gap trace is available; keep claims provisional",
      reportReadinessEvidenceBase: "Evidence base coverage",
      reportReadinessClaimRisk: "Claim risk calibration",
      reportReadinessRoadmap: "Roadmap readiness",
      reportReadinessGapTrace: "Gap traceability",
      reportReadinessEvidenceBaseEvidence: (available, skipped, failed) => `${available || 0} available summary(s), ${skipped || 0} skipped without PDF, ${failed || 0} failed`,
      reportReadinessClaimRiskEvidence: (high, medium, average) => `${high || 0} high-risk claim(s), ${medium || 0} medium-risk claim(s), average support ${average || 0}`,
      reportReadinessRoadmapEvidence: (ready, evidence, validation) => `${ready || 0} ready route(s), ${evidence || 0} evidence-thin route(s), ${validation || 0} validation-needed route(s)`,
      reportReadinessGapTraceEvidence: (count) => `${count || 0} explicit gap or validation signal(s)`,
      reportReadinessCoverageAction: "Recover missing PDFs or mark exclusions before treating coverage as complete.",
      reportReadinessClaimRiskAction: "Resolve high-risk claims in the claim evidence audit before writing final prose.",
      reportReadinessRoadmapAction: "Use the roadmap board to promote ready topics and defer evidence-thin topics.",
      reportReadinessGapTraceAction: "Keep each unresolved gap visible in the relevant subsection.",
      reportReadinessProceedAction: "Can move into the writing pack after source summaries are checked.",
      reportReadinessDefaultAction: (level) => `${level}: verify source summaries, claim risk, and roadmap blockers before prose writing.`,
      reportSynthesisWritingPack: "Synthesis Writing Pack",
      reportRiskChecklist: "Risk Checklist",
      reportRiskChecklistItems: [
        "- [ ] Check whether every cross-paper claim can be traced to a summary path or original PDF.",
        "- [ ] Separate deterministic topic clusters from the final manual taxonomy.",
        "- [ ] Mark incomparable datasets, scenarios, metrics, and experimental setups.",
        "- [ ] Add missing representative papers before treating this as a finished review."
      ].join("\n"),
      reportNextActions: "Next Actions",
      reportNextActionItems: [
        "- Update `method-matrix` and `research-gaps` after reading the source summaries.",
        "- Move stable paragraphs into `manual-review-draft` or a manuscript draft.",
        "- Run candidate-paper search for clusters with weak evidence."
      ].join("\n"),
      reportOutlineEntry: (cluster, method, gap) => `Section ${cluster}: compare ${method}; discuss evidence gap ${gap}.`,
      synthesisWritingTask: (cluster, method, gap) => `Draft a review subsection for ${cluster}: compare ${method}; keep ${gap} explicit.`,
      synthesisConflictCheck: (claim, gap) => `Check whether "${claim}" is still valid when ${gap} remains unresolved.`,
      synthesisModelPrompt: (cluster, method, gap, claim) => `Use the cited summaries to deepen ${cluster}: compare ${method}, test the claim "${claim}", and list evidence still needed for ${gap}.`,
      synthesisManualReview: (collection, cluster, papers) => `Open ${collection || "this collection"} summaries and original PDFs for ${cluster}; verify ${papers}.`
    };
  }
  if (outputLanguage === "ja-JP") {
    return {
      paperNotes: "論文ノート",
      methodMatrix: "手法マトリクス",
      methodMatrixNote: "単一論文の要約が揃った後、手法、データ、評価指標、限界を手動で統合するためのマトリクスです。",
      topicClusters: "トピッククラスタ",
      topicClustersNote: "タイトルと単一論文要約から抽出した手がかりに基づくヒューリスティックな collection レベルのクラスタです。最終分類ではなくレビューの出発点として扱ってください。",
      synthesisClaims: "統合主張マトリクス",
      synthesisClaimsNote: "トピッククラスタと単一論文要約から横断的な主張の草案を作ります。本文を書く前の管理された主張台帳として使ってください。",
      synthesisConflictLedger: "統合コンフリクト台帳",
      synthesisConflictLedgerNote: "主張をレビュー本文へ移す前に、弱い支持、反証、不足証拠、検証ニーズを記録します。",
      synthesisRoadmap: "統合ロードマップ",
      synthesisRoadmapNote: "トピッククラスタ、主張草案、証拠ギャップを次のレビュー執筆パスの節構成ロードマップへ変換します。",
      roadmapEvidenceMap: "テーマ横断エビデンスマップ",
      roadmapQuestionColumn: "レビュー問い",
      roadmapCandidateQueryColumn: "候補検索クエリ",
      roadmapSectionPlan: "節構成プラン",
      roadmapEvidenceIndex: "エビデンス索引",
      roadmapReadinessBoard: "ロードマップ準備度ボード",
      roadmapReadinessScoreColumn: "準備度スコア",
      roadmapReadinessLevelColumn: "準備度レベル",
      roadmapBlockingIssueColumn: "阻害要因",
      roadmapNextActionColumn: "次アクション",
      roadmapReadinessReady: "草稿化可能",
      roadmapReadinessNeedsEvidence: "証拠追加が必要",
      roadmapReadinessNeedsValidation: "検証が必要",
      roadmapReadinessDefer: "保留",
      roadmapReadinessNoBlocking: "直近の阻害要因なし",
      roadmapReadinessBlockingEvidence: (count, risk) => `証拠が薄い: 支持論文 ${count || 0} 件。${risk || "リスク未確認"}`,
      roadmapReadinessBlockingValidation: "検証計画が未設定",
      roadmapReadinessBlockingGap: (gap) => `未解決ギャップを明示する: ${gap}`,
      roadmapReadinessBlockingScore: (score) => `準備度スコア ${score || 0} が執筆しきい値未満`,
      roadmapReadinessAction: (level, cluster, issue, query) => `${level}: ${cluster} を確認する。${issue}。次の検索・確認: ${query || "候補クエリ未設定"}。`,
      crossCollectionSynthesis: "Collection 横断統合マップ",
      crossCollectionSynthesisNote: "最新の collection workspace を横断的なレビュー計画面に集約します。より広いレビューを書く前に、collection 間のテーマを比較するために使います。",
      crossCollectionInventory: "Collection 一覧",
      crossCollectionThemeMap: "Collection 横断テーママップ",
      crossCollectionClusterMap: "Collection 横断クラスタマップ",
      crossCollectionSynthesisLayoutBoard: "Collection 横断統合レイアウトボード",
      crossCollectionClusterCalibrationBoard: "クラスタしきい値確認ボード",
      crossCollectionClusterEvidenceCards: "クラスタ証拠カード",
      crossCollectionThemeMergeBoard: "テーマ統合確認ボード",
      crossCollectionBridgeBoard: "Collection 横断ブリッジボード",
      crossCollectionGapBoard: "Collection 横断ギャップボード",
      crossCollectionPriorityBoard: "Collection 横断優先度ボード",
      crossCollectionChartReviewTriage: "Collection 横断図表レビュートリアージ",
      crossCollectionReviewPack: "Collection 横断レビュー執筆パック",
      crossCollectionClusterScopeColumn: "クラスタ範囲",
      crossCollectionClusterScoreColumn: "クラスタスコア",
      crossCollectionEvidenceRankColumn: "証拠カード順位",
      crossCollectionEvidenceRankSignalsColumn: "順位シグナル",
      crossCollectionGapPriorityColumn: "ギャップ優先度スコア",
      crossCollectionGapPrioritySignalsColumn: "ギャップ優先度シグナル",
      crossCollectionGapPriorityPending: "ギャップ優先度未確認",
      crossCollectionClusterThresholdColumn: "しきい値根拠",
      crossCollectionClusterRecommendationColumn: "校正提案",
      crossCollectionClusterLinkColumn: "接続根拠",
      crossCollectionClusterRiskColumn: "確認リスク",
      crossCollectionSupportColumn: "横断支持",
      crossCollectionLayoutLaneColumn: "レイアウトレーン",
      crossCollectionLayoutOrderColumn: "レーン順",
      crossCollectionLayoutWeightColumn: "レイアウト重み",
      crossCollectionLayoutLaneCore: "中核共有節",
      crossCollectionLayoutLaneBoundary: "執筆前の境界確認",
      crossCollectionLayoutLaneGap: "不足証拠フォローアップ",
      crossCollectionLayoutLaneSupport: "補助的背景",
      crossCollectionPriorityColumn: "優先項目",
      crossCollectionReasonColumn: "理由",
      crossCollectionScopeColumn: "レビュー範囲",
      crossCollectionMergeScopeColumn: "統合範囲",
      crossCollectionThemeCandidatesColumn: "テーマ候補",
      crossCollectionSharedSignalsColumn: "共有シグナル",
      crossCollectionMergeRiskColumn: "統合リスク",
      crossCollectionMergePending: "テーマ統合確認待ち",
      crossCollectionMergeRiskPending: "統合リスク確認待ち",
      crossCollectionSharedToken: "共有語",
      crossCollectionPriorityPending: "優先度確認待ち",
      crossCollectionPriorityReasonPending: "理由の確認待ち",
      crossCollectionPriorityRecurringReason: (count) => `${count} 件の collection に反復するギャップ`,
      crossCollectionPrioritySingleReason: "Collection 固有の可能性があるギャップ。範囲拡張前に確認する",
      crossCollectionPriorityWeakThemeReason: "テーマを支える証拠が薄い",
      crossCollectionPriorityGapSignalReason: "テーマに未解決のギャップ手がかりがある",
      crossCollectionPriorityGap: (count, gap) => count >= 2
        ? `反復ギャップ: ${gap}`
        : `範囲確認: ${gap}`,
      crossCollectionPriorityMergeThemes: (themes) => `テーマ統合候補を確認: ${themes}`,
      crossCollectionPriorityMergeReason: "異なるテーマ名が証拠シグナルを共有している",
      crossCollectionPriorityCluster: (cluster, count) => `横断レビュー節を書く: ${cluster}`,
      crossCollectionPriorityClusterReason: (count, score) => `${count} 件の collection にまたがるクラスタ。スコア ${score || 0}`,
      crossCollectionPriorityWeakTheme: (theme, count) => count >= 2
        ? `テーマギャップを確認: ${theme}`
        : `テーマの支持を追加: ${theme}`,
      crossCollectionPriorityWeakThemeAction: (theme) => `Collection 報告書を開き、${theme} を確認し、証拠が薄い場合は候補論文検索を実行する。`,
      crossCollectionClusterTitle: (themes) => (themes || []).slice(0, 3).join(" / ") || "ラベル未設定の横断クラスタ",
      crossCollectionClusterSupport: (count, papers) => count >= 2
        ? `${count} 件の collection、${papers} 本の論文`
        : `単一 collection、${papers} 本の論文`,
      crossCollectionEvidenceRankCoverage: (count, papers) => `カバレッジ: collection ${count || 0} 件、論文 ${papers || 0} 本`,
      crossCollectionEvidenceRankLinks: (links) => `接続根拠: ${links || 0} 件`,
      crossCollectionEvidenceRankCalibration: (recommendation) => `校正提案: ${recommendation || "未確認"}`,
      crossCollectionEvidenceRankRisk: (risk) => `リスク: ${risk || "未確認"}`,
      crossCollectionGapPriorityCoverage: (count) => `カバレッジ: collection ${count || 0} 件`,
      crossCollectionGapPriorityThemes: (count) => `テーマ: ${count || 0} 件`,
      crossCollectionGapPriorityQueries: (count) => `候補検索クエリ: ${count || 0} 件`,
      crossCollectionGapPriorityRecurring: (count) => `${count || 0} 件の collection に反復`,
      crossCollectionGapPrioritySingle: "単一 collection ギャップ",
      crossCollectionLayoutAction: (lane, cluster) => `${lane}: ${cluster} の元レポートを確認し、このレーンに従ってレビュー節を書くか保留する。`,
      crossCollectionClusterPrompt: (cluster, count) => `${cluster} を ${count || "関連する"} 件の collection にまたがるレビュー節計画に変換し、共通主張、範囲固有の主張、不足証拠を分ける。`,
      crossCollectionClusterReviewAction: (cluster) => `${cluster} の元 collection 報告書を確認し、証拠で支えられる共通主張だけを残す。`,
      crossCollectionClusterNoEvidence: "利用できるクラスタ証拠カードはまだありません。",
      crossCollectionClusterLinkPending: "接続根拠未確認",
      crossCollectionClusterRiskPending: "確認リスク未設定",
      crossCollectionClusterRisk: (count, themes, links) => count >= 2 && links >= 2
        ? "中: レビュー節を統合する前に共有根拠を確認する"
        : themes > 2
          ? "高: テーマが広い。根拠が比較不能なら分割する"
          : "低: 範囲は狭いが元要約確認は必要",
      crossCollectionClusterThresholdPending: "しきい値根拠未確認",
      crossCollectionClusterThresholdBand: (score, count, links) => `スコア ${score || 0}; collection ${count || 0} 件; 接続根拠 ${links || 0} 件`,
      crossCollectionClusterCalibrationRecommendation: (key) => ({
        merge: "共有レビュー節へ昇格",
        review: "統合前に範囲を確認",
        split: "隣接節として保持または分割",
        gather: "横断主張の前に証拠を追加"
      }[key] || "統合前に範囲を確認"),
      crossCollectionClusterCalibrationReview: "統合前に範囲を確認",
      crossCollectionClusterCalibrationAction: (cluster, recommendation) => `${cluster} のしきい値確認を実施: ${recommendation || "範囲、証拠比較可能性、元レポートを確認"}。`,
      crossCollectionClusterLinkSameTheme: (theme) => `同じ正規化テーマ: ${theme}`,
      crossCollectionClusterLinkSharedTokens: (count) => `共有根拠語 ${count} 件`,
      crossCollectionClusterLinkStrongTokens: (tokens) => `強い共有語: ${tokens}`,
      crossCollectionClusterLinkMethodOverlap: "手法シグナルの重なり",
      crossCollectionClusterLinkGapOverlap: "ギャップシグナルの重なり",
      crossCollectionClusterLinkQueryOverlap: "候補検索クエリの重なり",
      crossCollectionChartReviewStateColumn: "レビュー状態",
      crossCollectionChartReviewActionCountColumn: "タスク数",
      crossCollectionChartReviewCollectionCountColumn: "Collection 数",
      crossCollectionChartReviewPaperCountColumn: "論文数",
      crossCollectionChartReviewCollectionsColumn: "Collections",
      crossCollectionChartReviewBlockingColumn: "阻害要因",
      crossCollectionChartReviewBatchActionColumn: "一括処理",
      crossCollectionChartReviewDoneColumn: "完了条件",
      crossCollectionChartReviewIndexColumn: "図表レビュー索引",
      crossCollectionChartReviewNoIssue: "阻害要因の記録なし",
      crossCollectionChartReviewActionPending: "一括処理未設定",
      crossCollectionChartReviewDonePending: "完了条件未設定",
      crossCollectionChartReviewIndexPending: "図表レビュー索引待ち",
      crossCollectionChartReviewEmpty: "Collection レベルの図表レビュータスクはまだありません。",
      crossCollectionChartReviewDrilldown: "図表レビュードリルダウン",
      crossCollectionChartReviewWritebackTargets: "一括ステータス書き戻し対象",
      crossCollectionChartReviewCurrentStateColumn: "現在の状態",
      crossCollectionChartReviewTargetStateColumn: "推奨状態",
      crossCollectionChartReviewStatusPatchColumn: "ステータスパッチ",
      crossCollectionChartReviewMatchColumn: "照合条件",
      crossCollectionChartReviewDrilldownSummary: (index, entry) => `${index}. ${entry.priority || "medium"} / ${entry.reviewState || "todo"} - ${entry.collectionCount || 0} 件の collection に ${entry.count || 0} タスク`,
      crossCollectionChartReviewChecklistOpenIndexes: "リンクされた図表レビュー索引を開き、元の visual report を確認する。",
      crossCollectionChartReviewChecklistVerifyPapers: "抽出値を再利用する前に対象論文を確認する。",
      crossCollectionChartReviewChecklistUpdateState: "元の workbench/export で担当者、期限、メモ、レビュー状態を更新する。",
      collectionColumn: "Collection",
      reportColumn: "報告書",
      crossCollectionStatsLine: (stats) => `Collection ${stats.collections} 件、論文 ${stats.totalPapers} 件、利用可能な要約 ${stats.availableSummaries} 件、PDF なしスキップ ${stats.skippedNoPdf} 件、失敗 ${stats.failed} 件。`,
      crossCollectionGapAction: (count, gap) => count >= 2
        ? `候補論文検索を優先する。このギャップは ${count} 件の collection に反復している: ${gap}`
        : `範囲を広げる前に、このギャップが collection 固有か確認する: ${gap}`,
      crossCollectionBridgeQuestion: (theme, count) => `${count} 件の collection にまたがる ${theme} の証拠を、互換しない範囲を混ぜずにどう接続するか。`,
      crossCollectionBridgeAction: (theme) => `${theme} の手法とギャップを比較し、証拠で支えられる共通主張だけを昇格する。`,
      crossCollectionReviewPrompt: (scope, gap) => `${scope} を collection 横断で比較し、共通証拠と範囲固有の証拠を分け、${gap} に必要な追加論文または確認を列挙する。`,
      crossCollectionGapWritingPrompt: (gap) => `反復ギャップ「${gap}」を、必要証拠、候補検索、除外条件を含むレビュー小節計画へ変換する。`,
      crossCollectionReviewAction: (scope) => `リンクされた collection 報告書を開き、${scope} を確認し、根拠に追跡できる主張だけを引用する。`,
      crossCollectionMergeScope: (left, right) => `${left} <-> ${right}`,
      crossCollectionMergeRisk: (themes, signals) => `過度な統合または分割の可能性: ${themes}。共有シグナル: ${signals || "未確認"}。`,
      crossCollectionMergeAction: (scope) => `${scope} の元 collection 報告書を開き、統合、分割、隣接節として保持のどれにするか判断する。`,
      crossCollectionNextActions: [
        "- [ ] テーマ統合確認ボードで、似たシグナルを持つクラスタを統合すべきか、別々に残すべきか判断する。",
        "- [ ] ブリッジボードを使い、反復テーマを横断レビュー節にできるか判断する。",
        "- [ ] Collection 間で似たクラスタを統合すべきか、別々のレビュー範囲として残すべきか確認する。",
        "- [ ] 横断的な原稿へ主張を移す前に、各 collection の正式レビュー報告書を開いて確認する。",
        "- [ ] 複数 collection にまたがる反復的なギャップには候補論文検索を実行する。"
      ].join("\n"),
      roadmapQuestionText: (cluster, method, gap) => `${cluster} の論文を ${method} を軸にどう比較し、${gap} に関する不足証拠をどう補うか。`,
      roadmapSectionText: (index, cluster, method, gap) => `第 ${index} 節: ${cluster} で ${method} を比較し、${gap} を補うか明示する。`,
      roadmapChecklistItems: [
        "- [ ] 各節が統合的な文章を書くのに十分な論文数を持つか確認する。",
        "- [ ] 証拠が弱いクラスタでは推奨クエリで候補論文検索を実行する。",
        "- [ ] 未解決ギャップを根拠のない主張にせず、見える形で残す。"
      ].join("\n"),
      gapMatrix: "研究ギャップマトリクス",
      gapMatrixNote: "執筆に入る前に、限界、不足している証拠、検証ニーズを整理するためのマトリクスです。",
      gapMatrixPendingLimitation: "限界の抽出待ち",
      gapMatrixPendingEvidence: "不足証拠の抽出待ち",
      gapMatrixPendingValidation: "検証設計待ち",
      pendingInsight: "単一論文要約からの抽出待ち",
      pendingRejectCondition: "棄却条件の抽出待ち",
      paperColumn: "論文",
      yearColumn: "年",
      clusterColumn: "クラスタ",
      claimColumn: "主張草案",
      claimSupportScoreColumn: "主張支持スコア",
      claimRiskColumn: "主張リスク",
      evidenceTraceColumn: "証拠トレース",
      supportingPapersColumn: "支持する論文",
      evidenceColumn: "証拠ソース",
      evidenceAnchorColumn: "証拠アンカー",
      counterGapColumn: "反証・ギャップ",
      supportLevelColumn: "支持レベル",
      reviewActionColumn: "レビューアクション",
      writingTaskColumn: "執筆タスク",
      conflictCheckColumn: "コンフリクト確認",
      manualReviewColumn: "手動確認",
      modelDeepeningPromptColumn: "モデル深化プロンプト",
      methodSignalColumn: "手法の手がかり",
      gapSignalColumn: "ギャップ・検証の手がかり",
      limitationColumn: "観察された限界",
      missingEvidenceColumn: "不足している証拠",
      validationColumn: "検証ニーズ",
      summaryColumn: "要約",
      synthesisClaimText: (cluster, methods, gap) => `${cluster}: 現在の要約は ${methods} を示すが、主な未解決ギャップは ${gap} である。`,
      claimRiskLow: "低: 複数論文に支えられ証拠を追跡可能",
      claimRiskMedium: "中: 証拠は追跡可能だが未解決ギャップが残る",
      claimRiskHigh: "高: 単一論文または薄い証拠",
      claimEvidenceTrace: (papers, evidence, validations) => `論文 ${papers || 0} 件、証拠源 ${evidence || 0} 件、検証手がかり ${validations || 0} 件`,
      claimAuditAction: (risk, score) => `主張を監査 (${score || 0}/100): ${risk || "リスク未確認"}。最終執筆前に証拠トレースを確認する。`,
      claimRiskChecklist: "主張リスクチェックリスト",
      claimRiskChecklistItems: [
        "- [ ] 各主張草案が少なくとも 2 本の支持論文を持つか、単一論文の証拠として明示する。",
        "- [ ] 不足している証拠と実際の否定的証拠を分ける。",
        "- [ ] 手法、データセット、シナリオ、指標を統合前に比較可能か確認する。",
        "- [ ] 検証済みの主張だけを正式レビュー報告書または原稿草稿へ移す。"
      ].join("\n"),
      conflictReviewChecklist: "コンフリクト確認リスト",
      conflictReviewChecklistItems: [
        "- [ ] 単一論文の支持を collection レベルの結論として書かない。",
        "- [ ] 真の反証と未検証のシナリオまたは未測定指標を分ける。",
        "- [ ] 検証ニーズが残るクラスタには候補論文検索を追加する。",
        "- [ ] 手動改訂時にこの台帳を正式報告書の横に置く。"
      ].join("\n"),
      supportLevelMultiPaper: (count) => `${count} 本の支持論文`,
      supportLevelSinglePaper: "単一論文の支持。主張は暫定扱い",
      conflictReviewAction: (count, gap, validation) => count >= 2
        ? `比較可能性を確認し、${gap || validation} を解決する。`
        : `本文化の前に支持論文を追加する。検証ニーズ: ${validation}`,
      clusterSynthesis: "統合メモ",
      clusterWritingEntry: "執筆入口",
      clusterSynthesisText: (methods, gaps) => `手法の手がかり: ${methods}。証拠ギャップ: ${gaps}。`,
      clusterWritingText: (cluster, method, gap) => `${cluster} クラスタで ${method} と ${gap} を比較する。`,
      clusterTransportationAirspace: "交通・都市空域",
      clusterSafetyRisk: "安全・リスク",
      clusterAiMethods: "AI・モデル手法",
      clusterDataEvaluation: "データ・評価",
      clusterBiomedicine: "医学・生命科学",
      clusterHumanPolicy: "人間・政策",
      clusterOther: "その他・手動確認",
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
      ].join("\n"),
      formalReviewReport: "正式レビュー報告書",
      reportAbstract: "草稿要旨",
      formalReportIntro: (name, stats) => `この報告書は ${name} の collection レベルのレビュー草稿です。最新のバッチ実行で利用可能な単一論文要約 ${stats.generated + stats.skippedExisting} 件に基づき、PDF なしでスキップ ${stats.skippedNoPdf} 件、失敗 ${stats.failed} 件を含みます。各統合主張は、要約と原論文を確認するまでは草稿として扱ってください。`,
      reportScopeAndEvidence: "範囲と証拠基盤",
      reportSourceFiles: "この collection workspace 内の単一論文要約、手法マトリクス、研究ギャップマトリクス、トピッククラスタ、アイデアリスト",
      reportEvidenceWarning: "- 証拠ルール: 主張は一覧化された要約に結び付け、根拠の弱い横断的主張は外部利用前に明示する。",
      reportPaperInventory: "論文一覧と証拠マップ",
      reportMethodTaxonomy: "手法分類",
      reportDataAndEvidence: "データ・シナリオ・指標の証拠",
      reportTopicSynthesis: "トピック別統合",
      reportSynthesisClaims: "証拠に基づく統合主張",
      reportClaimEvidenceAudit: "主張証拠監査",
      reportSynthesisConflicts: "統合コンフリクトと証拠ギャップ",
      reportResearchGaps: "研究ギャップと検証ニーズ",
      reportDraftOutline: "レビュー草稿アウトライン",
      reportWritingReadinessGate: "執筆準備度ゲート",
      reportWritingReadinessScore: "正式報告書準備度スコア",
      reportWritingReadinessLevel: "準備度レベル",
      reportWritingReadinessBlockers: "阻害項目",
      reportWritingReadinessNoBlockers: "現在の要約からは阻害項目なし",
      reportWritingReadinessCheckColumn: "ゲート確認",
      reportWritingReadinessStatusColumn: "状態",
      reportReadinessReady: "本文草稿化可能",
      reportReadinessRevise: "本文化前に修正",
      reportReadinessBlocked: "証拠追加まで保留",
      reportReadinessPass: "合格",
      reportReadinessReview: "要確認",
      reportReadinessFail: "不合格",
      reportReadinessHighRiskBlocker: (count) => `${count || 0} 件の高リスク主張に証拠監査が必要`,
      reportReadinessEvidenceBlocker: (count) => `${count || 0} 件のロードマップ項目で証拠追加が必要`,
      reportReadinessValidationBlocker: (count) => `${count || 0} 件のロードマップ項目で検証設計が必要`,
      reportReadinessCoverageBlocker: (skipped, failed) => `カバレッジ問題: PDF なしでスキップ ${skipped || 0}、失敗 ${failed || 0}`,
      reportReadinessGapBlocker: "明示的なギャップ追跡がないため、主張は暫定扱いにする",
      reportReadinessEvidenceBase: "証拠ベースのカバレッジ",
      reportReadinessClaimRisk: "主張リスク校正",
      reportReadinessRoadmap: "ロードマップ準備度",
      reportReadinessGapTrace: "ギャップ追跡性",
      reportReadinessEvidenceBaseEvidence: (available, skipped, failed) => `利用可能な要約 ${available || 0} 件、PDF なしスキップ ${skipped || 0} 件、失敗 ${failed || 0} 件`,
      reportReadinessClaimRiskEvidence: (high, medium, average) => `高リスク主張 ${high || 0} 件、中リスク主張 ${medium || 0} 件、平均支持 ${average || 0}`,
      reportReadinessRoadmapEvidence: (ready, evidence, validation) => `草稿化可能 ${ready || 0} 件、証拠不足 ${evidence || 0} 件、検証必要 ${validation || 0} 件`,
      reportReadinessGapTraceEvidence: (count) => `明示的なギャップまたは検証シグナル ${count || 0} 件`,
      reportReadinessCoverageAction: "不足 PDF を回収するか、範囲外として明記してからカバレッジ完了とする。",
      reportReadinessClaimRiskAction: "最終本文を書く前に、主張証拠監査で高リスク主張を処理する。",
      reportReadinessRoadmapAction: "ロードマップボードで準備済み項目を昇格し、証拠不足項目は保留する。",
      reportReadinessGapTraceAction: "各未解決ギャップを該当小節で明示する。",
      reportReadinessProceedAction: "元要約を確認した後、執筆パックへ移行可能。",
      reportReadinessDefaultAction: (level) => `${level}: 本文化前に元要約、主張リスク、ロードマップ阻害要因を確認する。`,
      reportSynthesisWritingPack: "統合執筆パック",
      reportRiskChecklist: "リスク確認リスト",
      reportRiskChecklistItems: [
        "- [ ] 横断的主張が要約パスまたは原 PDF に追跡できるか確認する。",
        "- [ ] 決定論的なトピッククラスタと最終的な手動分類を分ける。",
        "- [ ] 比較できないデータセット、シナリオ、指標、実験条件を明示する。",
        "- [ ] 完成版として扱う前に不足する代表的論文を追加する。"
      ].join("\n"),
      reportNextActions: "次のアクション",
      reportNextActionItems: [
        "- 元の要約を読んだ後で `method-matrix` と `research-gaps` を更新する。",
        "- 安定した段落を `manual-review-draft` または原稿草稿へ移す。",
        "- 証拠が弱いクラスタに対して候補論文検索を実行する。"
      ].join("\n"),
      reportOutlineEntry: (cluster, method, gap) => `${cluster} 節: ${method} を比較し、証拠ギャップ ${gap} を論じる。`,
      synthesisWritingTask: (cluster, method, gap) => `${cluster} のレビュー小節を書く: ${method} を比較し、${gap} を明示する。`,
      synthesisConflictCheck: (claim, gap) => `${gap} が未解決のままでも「${claim}」が妥当か確認する。`,
      synthesisModelPrompt: (cluster, method, gap, claim) => `引用された要約に基づいて ${cluster} を深める。${method} を比較し、主張「${claim}」を検討し、${gap} にまだ必要な証拠を列挙する。`,
      synthesisManualReview: (collection, cluster, papers) => `${collection || "この collection"} の要約と原 PDF を開き、${cluster} について ${papers} を確認する。`
    };
  }
  return {
    paperNotes: "论文笔记",
    methodMatrix: "方法矩阵",
    methodMatrixNote: "此矩阵用于在单篇总结完成后手动汇总方法、数据、指标和局限。",
    topicClusters: "主题聚类",
    topicClustersNote: "基于标题和单篇总结抽取线索生成的启发式集合级聚类，用作综述起点，不等同于最终分类。",
    synthesisClaims: "综合主张矩阵",
    synthesisClaimsNote: "基于主题聚类和单篇总结形成跨论文主张草稿，用作正式写作前的受控主张台账。",
    synthesisConflictLedger: "综合冲突与缺口台账",
    synthesisConflictLedgerNote: "在把主张迁移到综述正文前，记录支持强度、反证/缺口、验证需求和下一步人工审查动作。",
    synthesisRoadmap: "综合路线图",
    synthesisRoadmapNote: "把主题聚类、主张草稿和证据缺口组织成下一轮综述写作可直接使用的小节路线图。",
    roadmapEvidenceMap: "跨主题证据地图",
    roadmapQuestionColumn: "综述问题",
    roadmapCandidateQueryColumn: "候选检索词",
    roadmapSectionPlan: "小节计划",
    roadmapEvidenceIndex: "证据索引",
    roadmapReadinessBoard: "路线图就绪度看板",
    roadmapReadinessScoreColumn: "就绪分",
    roadmapReadinessLevelColumn: "就绪状态",
    roadmapBlockingIssueColumn: "阻塞问题",
    roadmapNextActionColumn: "下一步动作",
    roadmapReadinessReady: "可进入草稿",
    roadmapReadinessNeedsEvidence: "需补证据",
    roadmapReadinessNeedsValidation: "需验证",
    roadmapReadinessDefer: "暂缓",
    roadmapReadinessNoBlocking: "暂无直接阻塞",
    roadmapReadinessBlockingEvidence: (count, risk) => `证据偏薄：${count || 0} 篇支持论文；${risk || "风险待判断"}`,
    roadmapReadinessBlockingValidation: "验证计划仍待补齐",
    roadmapReadinessBlockingGap: (gap) => `进入正文前需保留未解决缺口：${gap}`,
    roadmapReadinessBlockingScore: (score) => `就绪分 ${score || 0} 低于写作阈值`,
    roadmapReadinessAction: (level, cluster, issue, query) => `${level}：核对“${cluster}”；${issue}；下一步检索或检查：${query || "待补充候选检索词"}。`,
    crossCollectionSynthesis: "跨集合综合地图",
    crossCollectionSynthesisNote: "把最近生成的 collection workspace 汇总为一个跨集合综述规划入口，用于在更大范围综述写作前比较不同集合之间的主题、证据和缺口。",
    crossCollectionInventory: "集合清单",
    crossCollectionThemeMap: "跨集合主题地图",
    crossCollectionClusterMap: "跨集合聚类图谱",
    crossCollectionSynthesisLayoutBoard: "跨集合综合布局板",
    crossCollectionClusterCalibrationBoard: "聚类阈值校准板",
    crossCollectionClusterEvidenceCards: "聚类证据卡",
    crossCollectionThemeMergeBoard: "主题归并复核板",
    crossCollectionBridgeBoard: "跨集合主题桥接板",
    crossCollectionGapBoard: "跨集合缺口看板",
    crossCollectionPriorityBoard: "跨集合优先级看板",
    crossCollectionChartReviewTriage: "跨集合图表复核分诊",
    crossCollectionReviewPack: "跨集合综述写作包",
    crossCollectionClusterScopeColumn: "聚类范围",
    crossCollectionClusterScoreColumn: "聚类评分",
    crossCollectionEvidenceRankColumn: "证据卡排序分",
    crossCollectionEvidenceRankSignalsColumn: "排序线索",
    crossCollectionGapPriorityColumn: "缺口优先级分",
    crossCollectionGapPrioritySignalsColumn: "缺口排序线索",
    crossCollectionGapPriorityPending: "待补充缺口优先级",
    crossCollectionClusterThresholdColumn: "阈值证据",
    crossCollectionClusterRecommendationColumn: "校准建议",
    crossCollectionClusterLinkColumn: "连接证据",
    crossCollectionClusterRiskColumn: "复核风险",
    crossCollectionSupportColumn: "跨集合支持",
    crossCollectionLayoutLaneColumn: "布局分区",
    crossCollectionLayoutOrderColumn: "分区顺序",
    crossCollectionLayoutWeightColumn: "布局权重",
    crossCollectionLayoutLaneCore: "核心共享小节",
    crossCollectionLayoutLaneBoundary: "写作前边界复核",
    crossCollectionLayoutLaneGap: "证据缺口跟进",
    crossCollectionLayoutLaneSupport: "支撑背景",
    crossCollectionPriorityColumn: "优先项",
    crossCollectionReasonColumn: "原因",
    crossCollectionScopeColumn: "综述范围",
    crossCollectionMergeScopeColumn: "归并范围",
    crossCollectionThemeCandidatesColumn: "主题候选",
    crossCollectionSharedSignalsColumn: "共享线索",
    crossCollectionMergeRiskColumn: "归并风险",
    crossCollectionMergePending: "待复核主题归并",
    crossCollectionMergeRiskPending: "待复核归并风险",
    crossCollectionSharedToken: "共享词",
    crossCollectionPriorityPending: "待确定优先级",
    crossCollectionPriorityReasonPending: "待补充原因",
    crossCollectionPriorityRecurringReason: (count) => `缺口在 ${count} 个集合中重复出现`,
    crossCollectionPrioritySingleReason: "可能是单集合缺口，扩大范围前先核对",
    crossCollectionPriorityWeakThemeReason: "主题支持证据偏薄",
    crossCollectionPriorityGapSignalReason: "主题仍有未解决的缺口线索",
    crossCollectionPriorityGap: (count, gap) => count >= 2
      ? `重复缺口：${gap}`
      : `范围核对：${gap}`,
    crossCollectionPriorityMergeThemes: (themes) => `复核主题归并候选：${themes}`,
    crossCollectionPriorityMergeReason: "不同主题名称共享证据线索",
    crossCollectionPriorityCluster: (cluster, count) => `撰写跨集合小节：${cluster}`,
    crossCollectionPriorityClusterReason: (count, score) => `该聚类横跨 ${count} 个集合；评分 ${score || 0}`,
    crossCollectionPriorityWeakTheme: (theme, count) => count >= 2
      ? `核对主题缺口：${theme}`
      : `补充主题支持：${theme}`,
    crossCollectionPriorityWeakThemeAction: (theme) => `打开集合报告核对“${theme}”，证据薄弱时继续运行候选论文检索。`,
    crossCollectionClusterTitle: (themes) => (themes || []).slice(0, 3).join(" / ") || "未命名跨集合聚类",
    crossCollectionClusterSupport: (count, papers) => count >= 2
      ? `${count} 个集合，${papers} 篇论文`
      : `单集合，${papers} 篇论文`,
    crossCollectionEvidenceRankCoverage: (count, papers) => `覆盖：${count || 0} 个集合，${papers || 0} 篇论文`,
    crossCollectionEvidenceRankLinks: (links) => `连接证据：${links || 0} 条`,
    crossCollectionEvidenceRankCalibration: (recommendation) => `校准建议：${recommendation || "待复核"}`,
    crossCollectionEvidenceRankRisk: (risk) => `风险：${risk || "待复核"}`,
    crossCollectionGapPriorityCoverage: (count) => `覆盖：${count || 0} 个集合`,
    crossCollectionGapPriorityThemes: (count) => `主题：${count || 0} 个`,
    crossCollectionGapPriorityQueries: (count) => `候选检索词：${count || 0} 条`,
    crossCollectionGapPriorityRecurring: (count) => `在 ${count || 0} 个集合中重复出现`,
    crossCollectionGapPrioritySingle: "单集合缺口",
    crossCollectionLayoutAction: (lane, cluster) => `${lane}：核对“${cluster}”的来源报告，再按该分区决定撰写、拆分或暂缓综述小节。`,
    crossCollectionClusterPrompt: (cluster, count) => `把“${cluster}”整理成横跨 ${count || "相关"} 个集合的综述小节计划，区分共同主张、范围特有主张和缺失证据。`,
    crossCollectionClusterReviewAction: (cluster) => `核对“${cluster}”对应的集合报告，只保留有证据支撑的共同主张。`,
    crossCollectionClusterNoEvidence: "暂时没有可用的聚类证据卡。",
    crossCollectionClusterLinkPending: "待补充连接证据",
    crossCollectionClusterRiskPending: "待补充复核风险",
    crossCollectionClusterRisk: (count, themes, links) => count >= 2 && links >= 2
      ? "中：合并为综述小节前需核对共享证据"
      : themes > 2
        ? "高：主题范围较宽，如证据不可比需拆分"
        : "低：范围较窄，但仍需核对来源总结",
    crossCollectionClusterThresholdPending: "待补充阈值证据",
    crossCollectionClusterThresholdBand: (score, count, links) => `评分 ${score || 0}；${count || 0} 个集合；${links || 0} 条连接证据`,
    crossCollectionClusterCalibrationRecommendation: (key) => ({
      merge: "提升为共享综述小节",
      review: "归并前先做边界复核",
      split: "保留为相邻小节或拆分范围",
      gather: "先补证据再形成跨集合主张"
    }[key] || "归并前先做边界复核"),
    crossCollectionClusterCalibrationReview: "归并前先做边界复核",
    crossCollectionClusterCalibrationAction: (cluster, recommendation) => `对“${cluster}”执行阈值复核：${recommendation || "核对边界、证据可比性和来源报告"}。`,
    crossCollectionClusterLinkSameTheme: (theme) => `同一规范化主题：${theme}`,
    crossCollectionClusterLinkSharedTokens: (count) => `${count} 个共享证据词`,
    crossCollectionClusterLinkStrongTokens: (tokens) => `强共享词：${tokens}`,
    crossCollectionClusterLinkMethodOverlap: "方法线索重叠",
    crossCollectionClusterLinkGapOverlap: "缺口线索重叠",
    crossCollectionClusterLinkQueryOverlap: "候选检索词重叠",
    crossCollectionChartReviewStateColumn: "复核状态",
    crossCollectionChartReviewActionCountColumn: "任务数",
    crossCollectionChartReviewCollectionCountColumn: "集合数",
    crossCollectionChartReviewPaperCountColumn: "论文数",
    crossCollectionChartReviewCollectionsColumn: "集合",
    crossCollectionChartReviewBlockingColumn: "阻塞问题",
    crossCollectionChartReviewBatchActionColumn: "批量处理动作",
    crossCollectionChartReviewDoneColumn: "完成条件",
    crossCollectionChartReviewIndexColumn: "图表复核索引",
    crossCollectionChartReviewNoIssue: "未记录阻塞问题",
    crossCollectionChartReviewActionPending: "待补充批量处理动作",
    crossCollectionChartReviewDonePending: "待补充完成条件",
    crossCollectionChartReviewIndexPending: "待生成图表复核索引",
    crossCollectionChartReviewEmpty: "暂无 collection 级图表复核任务。",
    crossCollectionChartReviewDrilldown: "图表复核下钻",
    crossCollectionChartReviewWritebackTargets: "批量状态回写目标",
    crossCollectionChartReviewCurrentStateColumn: "当前状态",
    crossCollectionChartReviewTargetStateColumn: "建议状态",
    crossCollectionChartReviewStatusPatchColumn: "状态补丁",
    crossCollectionChartReviewMatchColumn: "匹配条件",
    crossCollectionChartReviewDrilldownSummary: (index, entry) => `${index}. ${entry.priority || "medium"} / ${entry.reviewState || "todo"} - ${entry.collectionCount || 0} 个集合中的 ${entry.count || 0} 个任务`,
    crossCollectionChartReviewChecklistOpenIndexes: "打开每个已链接的图表复核索引，核对来源 visual report。",
    crossCollectionChartReviewChecklistVerifyPapers: "复用抽取图表数值前，先核对明细中的论文。",
    crossCollectionChartReviewChecklistUpdateState: "在来源工作台或重新导出时更新复核人、期限、备注和复核状态。",
    collectionColumn: "集合",
    reportColumn: "报告",
    crossCollectionStatsLine: (stats) => `集合 ${stats.collections} 个，论文 ${stats.totalPapers} 篇，可用总结 ${stats.availableSummaries} 篇，无 PDF 跳过 ${stats.skippedNoPdf} 篇，失败 ${stats.failed} 篇。`,
    crossCollectionGapAction: (count, gap) => count >= 2
      ? `优先运行候选论文检索；该缺口在 ${count} 个集合中重复出现：${gap}`
      : `扩大为跨集合主张前，先确认该缺口是否仅属于单个集合：${gap}`,
    crossCollectionBridgeQuestion: (theme, count) => `如何把“${theme}”在 ${count} 个集合中的证据连接起来，同时避免混合不兼容的综述范围？`,
    crossCollectionBridgeAction: (theme) => `比较“${theme}”下的方法与缺口，只把有证据支撑的共同主张提升为跨集合小节。`,
    crossCollectionReviewPrompt: (scope, gap) => `跨集合比较“${scope}”，区分共性证据与单集合特有证据，并列出围绕“${gap}”仍需补充的论文或核查。`,
    crossCollectionGapWritingPrompt: (gap) => `把重复缺口“${gap}”整理成综述小节计划，列出所需证据、候选检索词和排除条件。`,
    crossCollectionReviewAction: (scope) => `打开已链接的集合报告核对“${scope}”，只引用能追溯到来源的主张。`,
    crossCollectionMergeScope: (left, right) => `${left} <-> ${right}`,
    crossCollectionMergeRisk: (themes, signals) => `可能存在过度合并或拆分：${themes}；共享线索：${signals || "待补充"}。`,
    crossCollectionMergeAction: (scope) => `打开“${scope}”对应的集合报告，判断应合并、拆分，还是保留为相邻综述小节。`,
    crossCollectionNextActions: [
      "- [ ] 使用主题归并复核板判断共享线索相近的主题是否应合并，还是保留为独立范围。",
      "- [ ] 使用主题桥接板判断重复主题是否可以升级为跨集合综述小节。",
      "- [ ] 判断不同集合中的相似主题应合并，还是保留为独立综述范围。",
      "- [ ] 把主张迁移到跨集合综述正文前，先打开各集合正式综述报告核对证据。",
      "- [ ] 对多个集合中反复出现的缺口继续运行候选论文检索。"
    ].join("\n"),
    roadmapQuestionText: (cluster, method, gap) => `如何围绕“${cluster}”比较 ${method}，并补齐 ${gap} 相关证据？`,
    roadmapSectionText: (index, cluster, method, gap) => `第 ${index} 节：用“${cluster}”比较 ${method}，补齐或明确标注 ${gap}。`,
    roadmapChecklistItems: [
      "- [ ] 检查每个小节是否有足够论文支撑，再迁移到正文。",
      "- [ ] 对证据薄弱的主题使用建议检索词继续运行候选论文检索。",
      "- [ ] 保留未解决缺口，不要把证据不足的判断写成确定性结论。"
    ].join("\n"),
    gapMatrix: "研究空白矩阵",
    gapMatrixNote: "此矩阵用于在进入写作前整理局限、缺失证据和验证需求。",
    gapMatrixPendingLimitation: "待抽取局限",
    gapMatrixPendingEvidence: "待抽取缺失证据",
    gapMatrixPendingValidation: "待设计验证",
    pendingInsight: "待从单篇总结抽取",
    pendingRejectCondition: "待抽取推翻条件",
    paperColumn: "论文",
    yearColumn: "年份",
    clusterColumn: "主题",
    claimColumn: "主张草稿",
    claimSupportScoreColumn: "主张支持分",
    claimRiskColumn: "主张风险",
    evidenceTraceColumn: "证据轨迹",
    supportingPapersColumn: "支持论文",
    evidenceColumn: "证据来源",
    evidenceAnchorColumn: "证据锚点",
    counterGapColumn: "反证/缺口",
    supportLevelColumn: "支持强度",
    reviewActionColumn: "审查动作",
    writingTaskColumn: "写作任务",
    conflictCheckColumn: "冲突检查",
    manualReviewColumn: "人工复核",
    modelDeepeningPromptColumn: "模型深化提示",
    methodSignalColumn: "方法线索",
    gapSignalColumn: "空白/验证线索",
    limitationColumn: "已观察局限",
    missingEvidenceColumn: "缺失证据",
    validationColumn: "验证需求",
    summaryColumn: "总结",
    synthesisClaimText: (cluster, methods, gap) => `围绕“${cluster}”，当前总结显示 ${methods}；主要未解决缺口是 ${gap}。`,
    claimRiskLow: "低：多篇论文支持且证据可追溯",
    claimRiskMedium: "中：证据可追溯但仍有未解决缺口",
    claimRiskHigh: "高：单篇论文或证据偏薄",
    claimEvidenceTrace: (papers, evidence, validations) => `${papers || 0} 篇论文，${evidence || 0} 条证据来源，${validations || 0} 条验证线索`,
    claimAuditAction: (risk, score) => `审计主张（${score || 0}/100）：${risk || "待判断风险"}；进入最终写作前核对证据轨迹。`,
    claimRiskChecklist: "主张风险检查清单",
    claimRiskChecklistItems: [
      "- [ ] 检查每条主张草稿是否至少有两篇支持论文；否则标记为单篇证据。",
      "- [ ] 区分缺失证据和真正的反向证据。",
      "- [ ] 合并结论前检查方法、数据集、场景和指标是否可比较。",
      "- [ ] 只把已核验主张迁移到正式综述报告或论文草稿。"
    ].join("\n"),
    conflictReviewChecklist: "冲突审查清单",
    conflictReviewChecklistItems: [
      "- [ ] 不要把单篇论文支持写成 collection 级确定结论。",
      "- [ ] 区分真正反向证据、未测试场景和缺失指标。",
      "- [ ] 对验证需求未解决的主题继续运行候选论文检索。",
      "- [ ] 人工修订正式综述报告时，把此台账放在旁边逐条核对。"
    ].join("\n"),
    supportLevelMultiPaper: (count) => `${count} 篇支持论文`,
    supportLevelSinglePaper: "单篇证据支持，主张需保持暂定",
    conflictReviewAction: (count, gap, validation) => count >= 2
      ? `检查可比性，并处理：${gap || validation}`
      : `进入正文前继续补充支持论文；验证需求：${validation}`,
    clusterSynthesis: "综合线索",
    clusterWritingEntry: "写作入口",
    clusterSynthesisText: (methods, gaps) => `方法线索：${methods}。证据空白：${gaps}。`,
    clusterWritingText: (cluster, method, gap) => `围绕“${cluster}”比较 ${method} 与 ${gap}。`,
    clusterTransportationAirspace: "交通与城市空域",
    clusterSafetyRisk: "安全与风险",
    clusterAiMethods: "AI 与模型方法",
    clusterDataEvaluation: "数据与评估",
    clusterBiomedicine: "医学与生命科学",
    clusterHumanPolicy: "人因与政策",
    clusterOther: "其他/待人工归类",
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
    ].join("\n"),
    formalReviewReport: "正式综述报告草稿",
    reportAbstract: "草稿摘要",
    formalReportIntro: (name, stats) => `本报告为 ${name} 的 collection 级综述草稿，基于最近一次批量运行中 ${stats.generated + stats.skippedExisting} 篇可用单篇总结生成；其中无 PDF 跳过 ${stats.skippedNoPdf} 篇，失败 ${stats.failed} 篇。所有综合性判断在核对单篇总结和原文前都应视为草稿。`,
    reportScopeAndEvidence: "范围与证据基础",
    reportSourceFiles: "本 collection workspace 中的单篇总结、方法矩阵、研究空白矩阵、主题聚类和研究想法列表",
    reportEvidenceWarning: "- 证据规则：综合性判断必须能追溯到列出的总结或原文；证据不足的跨论文判断在对外使用前必须标注。",
    reportPaperInventory: "论文清单与证据地图",
    reportMethodTaxonomy: "方法分类",
    reportDataAndEvidence: "数据、场景与指标证据",
    reportTopicSynthesis: "主题级综合",
    reportSynthesisClaims: "有证据支持的综合主张",
    reportClaimEvidenceAudit: "主张证据审计",
    reportSynthesisConflicts: "综合冲突与证据缺口",
    reportResearchGaps: "研究空白与验证需求",
    reportDraftOutline: "综述正文大纲",
    reportWritingReadinessGate: "写作就绪门禁",
    reportWritingReadinessScore: "正式报告就绪分",
    reportWritingReadinessLevel: "就绪状态",
    reportWritingReadinessBlockers: "阻塞项",
    reportWritingReadinessNoBlockers: "当前总结未发现阻塞项",
    reportWritingReadinessCheckColumn: "门禁检查",
    reportWritingReadinessStatusColumn: "状态",
    reportReadinessReady: "可进入正文草稿",
    reportReadinessRevise: "进入正文前需修订",
    reportReadinessBlocked: "补齐证据前暂缓",
    reportReadinessPass: "通过",
    reportReadinessReview: "需复核",
    reportReadinessFail: "未通过",
    reportReadinessHighRiskBlocker: (count) => `${count || 0} 条高风险主张需要证据审计`,
    reportReadinessEvidenceBlocker: (count) => `${count || 0} 个路线图主题仍需补证据`,
    reportReadinessValidationBlocker: (count) => `${count || 0} 个路线图主题仍需验证设计`,
    reportReadinessCoverageBlocker: (skipped, failed) => `覆盖问题：无 PDF 跳过 ${skipped || 0} 篇，失败 ${failed || 0} 篇`,
    reportReadinessGapBlocker: "没有明确缺口轨迹，主张需保持暂定",
    reportReadinessEvidenceBase: "证据基础覆盖",
    reportReadinessClaimRisk: "主张风险校准",
    reportReadinessRoadmap: "路线图就绪度",
    reportReadinessGapTrace: "缺口可追溯性",
    reportReadinessEvidenceBaseEvidence: (available, skipped, failed) => `${available || 0} 篇可用总结，${skipped || 0} 篇无 PDF 跳过，${failed || 0} 篇失败`,
    reportReadinessClaimRiskEvidence: (high, medium, average) => `${high || 0} 条高风险主张，${medium || 0} 条中风险主张，平均支持分 ${average || 0}`,
    reportReadinessRoadmapEvidence: (ready, evidence, validation) => `${ready || 0} 条可进入草稿，${evidence || 0} 条证据薄弱，${validation || 0} 条需验证`,
    reportReadinessGapTraceEvidence: (count) => `${count || 0} 条明确缺口或验证线索`,
    reportReadinessCoverageAction: "补齐缺失 PDF 或明确排除后，再把覆盖面视为完整。",
    reportReadinessClaimRiskAction: "进入最终正文前，先在主张证据审计中处理高风险主张。",
    reportReadinessRoadmapAction: "使用路线图看板提升可写主题，暂缓证据薄弱主题。",
    reportReadinessGapTraceAction: "把每个未解决缺口保留在对应小节中。",
    reportReadinessProceedAction: "核对来源总结后可进入写作包。",
    reportReadinessDefaultAction: (level) => `${level}：进入正文前核对来源总结、主张风险和路线图阻塞项。`,
    reportSynthesisWritingPack: "综合写作包",
    reportRiskChecklist: "风险核查清单",
    reportRiskChecklistItems: [
      "- [ ] 检查每条跨论文结论是否能追溯到总结路径或原始 PDF。",
      "- [ ] 区分启发式主题聚类和最终人工分类。",
      "- [ ] 标注不可直接比较的数据集、场景、指标和实验设置。",
      "- [ ] 在作为完整综述前补充缺失的代表性论文。"
    ].join("\n"),
    reportNextActions: "下一步动作",
    reportNextActionItems: [
      "- 阅读源总结后更新 `method-matrix` 和 `research-gaps`。",
      "- 将稳定段落迁移到 `manual-review-draft` 或正式稿件。",
      "- 对证据薄弱的主题聚类继续运行候选论文检索。"
    ].join("\n"),
    reportOutlineEntry: (cluster, method, gap) => `“${cluster}”小节：比较 ${method}，讨论证据缺口 ${gap}。`,
    synthesisWritingTask: (cluster, method, gap) => `撰写“${cluster}”综述小节：比较 ${method}，并明确标注 ${gap}。`,
    synthesisConflictCheck: (claim, gap) => `核对“${claim}”在 ${gap} 尚未解决时是否仍然成立。`,
    synthesisModelPrompt: (cluster, method, gap, claim) => `基于已引用的总结深化“${cluster}”：比较 ${method}，检验主张“${claim}”，并列出围绕 ${gap} 仍需补齐的证据。`,
    synthesisManualReview: (collection, cluster, papers) => `打开 ${collection || "当前集合"} 的总结和原始 PDF，围绕“${cluster}”核对 ${papers}。`
  };
}

function escapeMarkdownTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
          clientInfo: { name: "zotero-markdown-summary", version: "0.1.6" }
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
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ak|xai|gsk|pplx|ms|rk|hf|deepinfra|cloudflare|cf)[-_][A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .slice(0, 800);
}

function providerErrorText(status, text) {
  return `HTTP ${status}: ${redact(providerErrorDetail(text))}`;
}

function providerErrorDetail(text) {
  const parsed = safeParseJSON(text);
  if (parsed) {
    const responseError = typeof streamErrorText === "function" ? streamErrorText(parsed) : "";
    if (responseError) return responseError;
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
  const text = String(value || "");
  let answer = "";
  let cursor = 0;
  const pattern = /<think\b[^>]*>([\s\S]*?)(<\/think>|$)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    answer += text.slice(cursor, match.index);
    if (!match[2]) {
      answer += unclosedThinkAnswer(match[1] || "");
      cursor = text.length;
      break;
    }
    cursor = pattern.lastIndex;
  }
  answer += text.slice(cursor);
  return answer.trim();
}

function unclosedThinkAnswer(value) {
  const markers = [...String(value || "").matchAll(/(?:^|\n{2,})\s*(?:final\s+answer|answer|最终回答|最终答案|回复|回答|结论|总结)\s*[:：]\s*/gi)];
  const marker = markers[markers.length - 1];
  return marker ? value.slice((marker.index || 0) + marker[0].length).trim() : "";
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

function loadAutoUpdatePolicyModule() {
  if (typeof zmsApplyAddonAutoUpdatePreference === "function") return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  try {
    Services.scriptloader.loadSubScript(`${rootURI}content/auto-update.js`);
  } catch (_err) {
    // Zotero's manifest update_url still remains available if this helper cannot load.
  }
}

async function applyConfiguredAddonAutoUpdatePolicy() {
  if (typeof zmsApplyAddonAutoUpdatePreference !== "function") return { ok: false };
  const enabled = pref("autoUpdateEnabled") !== false;
  const result = await zmsApplyAddonAutoUpdatePreference(enabled, { addonId: pluginID });
  if (!result?.ok) {
    try {
      Zotero.debug(`[Markdown Summary] Failed to apply add-on auto update policy: ${safeError(result?.reason || "unknown")}`);
    } catch (_err) {}
  }
  return result;
}

function loadProviderModelCatalog() {
  if (typeof zmsRecommendedDefaultModelForProvider === "function") return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  try {
    Services.scriptloader.loadSubScript(`${rootURI}content/provider-models.js`);
  } catch (_err) {
    // Bootstrap settings keep a small fallback if the shared catalog cannot load.
  }
}

function loadCandidateSourcesModule() {
  if (typeof ZMSCandidateSources !== "undefined" && ZMSCandidateSources?.searchCandidateSources) return;
  if (!rootURI || typeof Services?.scriptloader?.loadSubScript !== "function") return;
  try {
    Services.scriptloader.loadSubScript(`${rootURI}content/candidate-sources.js`);
  } catch (_err) {
    // Collection reviews still generate deterministic local artifacts without online candidate search.
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
