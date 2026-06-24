var Zotero = window.Zotero || window.parent?.Zotero;
var Services = window.Services || window.parent?.Services;
var IOUtils = window.IOUtils || window.parent?.IOUtils;
var PathUtils = window.PathUtils || window.parent?.PathUtils;
var Cc = window.Cc || window.parent?.Cc;
var Ci = window.Ci || window.parent?.Ci;

const ZMS_SKILL_IDS = [
  "paper-deep-summary",
  "method-extractor",
  "experiment-table-builder",
  "figure-table-extractor",
  "literature-matrix-builder",
  "literature-review-synthesis",
  "citation-audit",
  "custom-summary",
  "ask-gemini",
  "ask-claude",
  "ask-opencode",
  "ask-all-agents",
  "ask-gemini-claude",
  "check-local-agents"
];
const ZMS_PROMPT_PACK_IDS = [
  "general",
  "ai-ml",
  "transportation",
  "biomedicine",
  "social-science",
  "review-writing"
];
const ZMS_CANDIDATE_SCREENING_STAGES = [
  "not_started",
  "abstract_screened",
  "full_text_needed",
  "full_text_screened"
];
const ZMS_CANDIDATE_EXCLUSION_REASONS = [
  "",
  "off_topic",
  "duplicate",
  "no_full_text",
  "weak_evidence",
  "wrong_document_type",
  "not_peer_reviewed",
  "other"
];
const ZMS_VISUAL_REVIEW_STATES = ["todo", "in-review", "done", "blocked", "discarded"];
const LOCAL_AGENT_SUBSKILLS = ["ask-gemini", "ask-claude", "ask-opencode"];
const LOCAL_AGENT_SKILLS = {
  "ask-gemini": "ask_gemini",
  "ask-claude": "ask_claude",
  "ask-opencode": "ask_opencode",
  "ask-all-agents": "ask_all_agents",
  "ask-gemini-claude": "ask_all_agents",
  "check-local-agents": "check_local_agents",
  "extract-pdf-pages": "extract_pdf_pages"
};
const LOCAL_AGENT_TOOL_NAMES = new Set(Object.values(LOCAL_AGENT_SKILLS));
const LOCAL_AGENT_AGGREGATE_SKILLS = ["ask-all-agents", "ask-gemini-claude", "check-local-agents"];
const ZMS_PREF_PREFIX = "extensions.zoteroMarkdownSummary";
const ZMS_CHROME_CONTENT_URL = "chrome://zotero-markdown-summary/content/";
const ZMS_DEFAULT_OUTPUT_DIR_NAME = "Literature Review with LLM";
const MAX_COMPARISON_PAPERS = 5;
const PROVIDER_FALLBACK_BODY_FIELDS = new Set([
  "stream_options",
  "stream",
  "temperature",
  "n",
  "response_format",
  "max_completion_tokens",
  "max_tokens",
  "text",
  "text.format",
  "text.verbosity",
  "max_output_tokens",
  "instructions",
  "reasoning",
  "verbosity",
  "system",
  "metadata",
  "thinking",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "top_logprobs",
  "logprobs",
  "parallel_tool_calls",
  "reasoning_effort",
  "stop",
  "top_k",
  "stop_sequences",
  "tools",
  "tool_choice",
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
  "extra_body",
  "messages.content",
  "messages.content.image",
  "messages.content.document",
  "messages.role.system",
  "messages.content.image_url",
  "image_url.url",
  "input.content.input_image",
  "input_file.file_data",
  "input_file.file_url"
]);
const PROVIDER_REQUIRED_BODY_FIELDS = new Set(["model", "messages", "input"]);

function wbMessage(scope, key, settingOrLocale) {
  if (typeof zmsMessage !== "function") return key;
  return zmsMessage(scope, key, settingOrLocale, runtimeLocale());
}


var ZoteroMarkdownSummaryWorkbench = {
  state: {
    item: null,
    pdf: null,
    context: null,
    comparisonItems: [],
    comparisonContexts: [],
    contextDiagnostics: null,
    contextSourceHash: "",
    messages: [],
    sessionId: "",
    sessionIdBeforeResume: "",
    sessionStartedAt: 0,
    compaction: null,
    compactionScheduled: 0,
    profiles: [],
    profile: null,
    outputDir: "",
    outputLanguage: "zh-CN",
    promptPackId: "general",
    inputMode: "text",
    stream: true,
    localOcrEnabled: false,
    localOcrEndpoint: "http://127.0.0.1:3333/mcp",
    localOcrTool: "ocr_image",
    localOcrLanguage: "eng",
    summaryVersion: "1",
    uiLanguage: "en-US",
    systemPrompt: "",
    userPrompt: "",
    initialized: false,
    requestInFlight: false,
    abortController: null,
    writeMessage: null,
    writePreview: null,
    candidates: [],
    candidatePath: "",
    settingsOpen: false,
    pendingImages: [],
    visualReviewReportData: null,
    visualReviewPath: ""
  },

  async init() {
    if (this.state.initialized) return;
    this.state.initialized = true;
    this.bindActions();
    this.loadSettings();
    this.applyLanguage();
    this.renderOutputDirSettings();
    this.setStatus(this.t("loading"));
    try {
      this.state.launchPayload = launchPayload();
      if (this.state.launchPayload.embedded) {
        document.documentElement.setAttribute("data-embedded", "true");
      }
      const launchItems = itemsFromArgs(this.state.launchPayload);
      this.state.item = launchItems[0] || itemFromArgs(this.state.launchPayload);
      if (!this.state.item) throw new Error(this.t("noItem"));
      this.state.comparisonItems = launchItems.filter((item) => !sameZoteroItem(item, this.state.item)).slice(0, MAX_COMPARISON_PAPERS);
      this.state.pdf = await findPdfAttachment(this.state.item);
      this.state.context = await buildPaperContext(this.state.item, this.state.pdf, this.state.outputDir);
      this.state.comparisonContexts = await buildComparisonContexts(this.state.comparisonItems, this.state.outputDir);
      this.state.context.comparisonContexts = this.state.comparisonContexts;
      this.state.contextDiagnostics = this.state.context.diagnostics || null;
      this.state.contextSourceHash = buildContextSourceHash(this.state.context, this.state.item, this.state.pdf);
      let storageError = "";
      try {
        await ensureDirectory(this.sessionDir());
        await ensureSkillTemplates(this.state.outputDir);
      } catch (err) {
        storageError = safeError(err);
        this.state.storageError = storageError;
      }
      this.renderPaper();
      this.renderProfiles();
      this.renderPromptPacks();
      await this.renderSkills();
      const latest = await latestSessionForItem(this.state.item, this.state.outputDir);
      if (latest) {
        const loaded = await this.loadSession(latest.path, { resume: true });
        if (loaded) {
          this.setStatus(this.t("sessionResumed"));
        } else {
          this.state.sessionId = newSessionId();
          this.state.sessionStartedAt = Date.now();
          this.setStatus(storageError ? `${this.t("outputDirUnavailable")}: ${storageError}` : this.t("ready"));
        }
      } else {
        this.state.sessionId = newSessionId();
        this.state.sessionStartedAt = Date.now();
        this.setStatus(storageError ? `${this.t("outputDirUnavailable")}: ${storageError}` : this.t("ready"));
      }
      this.renderSessions();
      await this.loadVisualReviewState({ quiet: true });
      await this.loadCandidates({ quiet: true });
      this.queueComposerFocus();
    } catch (err) {
      this.setStatus(safeError(err));
    }
  },

  bindActions() {
    const bindings = {
      "zms-open-reader": () => this.openReader(),
      "zms-save-session": () => this.saveSession({ quiet: false }),
      "zms-export-reading-log": () => this.exportReadingLog(),
      "zms-export-comparison-report": () => this.exportComparisonReport(),
      "zms-export-visual-report": () => this.exportVisualExtractionReport(),
      "zms-export-review-draft": () => this.exportReviewDraft(),
      "zms-start-cross-review": () => this.startCrossPaperReview(),
      "zms-export-proposal-note": () => this.exportProposalNote(),
      "zms-export-journal-outline": () => this.exportJournalOutline(),
      "zms-search-candidates": () => this.searchCandidates(),
      "zms-expand-citation-network": () => this.expandCandidateCitationNetwork(),
      "zms-load-candidates": () => this.loadCandidates(),
      "zms-apply-candidate-recommendations": () => this.applyCandidateRecommendations(),
      "zms-save-candidates": () => this.saveCandidates(),
      "zms-export-candidate-review": () => this.exportCandidateReview(),
      "zms-import-candidates": () => this.importIncludedCandidates(),
      "zms-attach-candidate-pdfs": () => this.attachCandidatePdfs(),
      "zms-reconcile-candidate-duplicates": () => this.reconcileCandidateDuplicates(),
      "zms-preview-write": () => this.previewWriteback(),
      "zms-confirm-write": () => this.confirmWriteback(),
      "zms-cancel-write": () => this.cancelWriteback(),
      "zms-send": () => this.send(),
      "zms-stop": () => this.stop(),
      "zms-settings-toggle": () => this.toggleSettings(),
      "zms-settings-close": () => this.toggleSettings(false),
      "zms-close-workbench": () => this.closeWorkbench(),
      "zms-workbench-choose-output-dir": () => this.chooseOutputDir(),
      "zms-workbench-save-output-dir": () => this.saveOutputDir(),
      "zms-save-profile-settings": () => this.saveProfileSettings(),
      "zms-test-profile-settings": () => this.testProfileSettings(),
      "zms-workbench-apply-provider-env": () => this.applyProviderEnvFromText(),
      "zms-export-provider-diagnostics": () => this.exportProviderDiagnostics(),
      "zms-attach-image": () => this.chooseImages(),
      "zms-load-models-workbench": () => this.loadModelsForWorkbench(),
      "zms-new-conversation": () => this.newConversation(),
      "zms-compact-context": () => this.compactContext({ auto: false }),
      "zms-copy-session": () => this.copySession(),
      "zms-load-visual-review": () => this.loadVisualReviewState(),
      "zms-save-visual-review": () => this.saveVisualReviewState()
    };
    for (const [id, handler] of Object.entries(bindings)) {
      const element = document.getElementById(id);
      if (!element || element.dataset?.zmsBound === "1") continue;
      element.addEventListener("click", (event) => {
        event.preventDefault();
        handler();
      });
      if (element.dataset) element.dataset.zmsBound = "1";
    }
    const modelSelect = document.getElementById("zms-profile-model-select");
    if (modelSelect && modelSelect.dataset?.zmsModelPickerBound !== "1") {
      modelSelect.addEventListener("change", () => this.selectWorkbenchModelFromDropdown());
      if (modelSelect.dataset) modelSelect.dataset.zmsModelPickerBound = "1";
    }
    const modelInput = document.getElementById("zms-profile-model");
    if (modelInput && modelInput.dataset?.zmsModelPickerBound !== "1") {
      const sync = () => this.syncWorkbenchModelSelect();
      modelInput.addEventListener("input", sync);
      modelInput.addEventListener("change", sync);
      if (modelInput.dataset) modelInput.dataset.zmsModelPickerBound = "1";
    }
    const localOcrInput = document.getElementById("zms-local-ocr-input");
    if (localOcrInput && localOcrInput.dataset?.zmsLocalOcrBound !== "1") {
      localOcrInput.addEventListener("change", () => this.syncLocalOcrPreference());
      if (localOcrInput.dataset) localOcrInput.dataset.zmsLocalOcrBound = "1";
    }
    const input = document.getElementById("zms-input");
    if (input && input.dataset?.zmsShortcutBound !== "1") {
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
        event.preventDefault();
        this.send();
      });
      if (input.dataset) input.dataset.zmsShortcutBound = "1";
    }
    if (!this.state.escapeBound && typeof document.addEventListener === "function") {
      document.addEventListener?.("keydown", (event) => {
        if (event.key !== "Escape" || !this.state.settingsOpen) return;
        event.preventDefault?.();
        this.toggleSettings(false);
      });
      this.state.escapeBound = true;
    }
    if (!this.state.copySelectionBound && typeof document.addEventListener === "function") {
      document.addEventListener?.("copy", (event) => copySelectedWorkbenchText(event));
      this.state.copySelectionBound = true;
    }
    this.bindImageInput();
    this.bindCitationNetworkPolicyControls();
    const composer = document.getElementById("zms-composer");
    if (input && input.dataset?.zmsFocusBound !== "1") {
      for (const eventName of ["pointerdown", "mousedown", "click"]) {
        input.addEventListener(eventName, () => this.focusComposerInput());
      }
      if (input.dataset) input.dataset.zmsFocusBound = "1";
    }
    if (input && composer && composer.dataset?.zmsFocusBound !== "1") {
      composer.addEventListener("click", (event) => {
        const target = event?.target;
        const targetId = target?.id || "";
        const targetTag = String(target?.tagName || "").toLowerCase();
        if (targetTag === "button" || targetId === "zms-send" || targetId === "zms-stop") return;
        this.focusComposerInput();
      });
      if (composer.dataset) composer.dataset.zmsFocusBound = "1";
    }
    this.updateComposerState();
  },

  bindImageInput() {
    const fileInput = document.getElementById("zms-image-file");
    if (fileInput && fileInput.dataset?.zmsBound !== "1") {
      fileInput.addEventListener("change", async () => {
        await this.addImageFiles(Array.from(fileInput.files || []));
        fileInput.value = "";
      });
      if (fileInput.dataset) fileInput.dataset.zmsBound = "1";
    }
    const input = document.getElementById("zms-input");
    if (input && input.dataset?.zmsImageBound !== "1") {
      input.addEventListener("paste", async (event) => {
        const files = imageFilesFromDataTransfer(event.clipboardData);
        if (!files.length) return;
        event.preventDefault?.();
        await this.addImageFiles(files);
      });
      if (input.dataset) input.dataset.zmsImageBound = "1";
    }
    const composer = document.getElementById("zms-composer");
    if (composer && composer.dataset?.zmsDropBound !== "1") {
      composer.addEventListener("dragover", (event) => {
        if (!imageFilesFromDataTransfer(event.dataTransfer).length) return;
        event.preventDefault?.();
        composer.setAttribute("data-dragging-image", "true");
      });
      composer.addEventListener("dragleave", () => composer.removeAttribute("data-dragging-image"));
      composer.addEventListener("drop", async (event) => {
        const files = imageFilesFromDataTransfer(event.dataTransfer);
        composer.removeAttribute("data-dragging-image");
        if (!files.length) return;
        event.preventDefault?.();
        await this.addImageFiles(files);
      });
      if (composer.dataset) composer.dataset.zmsDropBound = "1";
    }
  },

  bindCitationNetworkPolicyControls() {
    const policy = document.getElementById("zms-citation-policy");
    if (!policy || policy.dataset?.zmsPolicyBound === "1") return;
    policy.addEventListener("change", () => applyCitationNetworkPolicyToDom(policy.value));
    if (policy.dataset) policy.dataset.zmsPolicyBound = "1";
  },

  chooseImages() {
    document.getElementById("zms-image-file")?.click?.();
  },

  async addImageFiles(files) {
    const imageFiles = (files || []).filter((file) => String(file?.type || "").startsWith("image/"));
    if (!imageFiles.length) return;
    try {
      const attachments = [];
      for (const file of imageFiles.slice(0, 6)) {
        attachments.push(await imageAttachmentFromFile(file));
      }
      this.state.pendingImages.push(...attachments.filter(Boolean));
      this.renderImageAttachments();
    } catch (err) {
      this.setStatus(`${this.t("imageReadFailed")}: ${safeError(err)}`);
    }
  },

  removeImage(id) {
    this.state.pendingImages = this.state.pendingImages.filter((image) => image.id !== id);
    this.renderImageAttachments();
  },

  renderImageAttachments() {
    const container = document.getElementById("zms-image-attachments");
    if (!container) return;
    container.textContent = "";
    container.hidden = this.state.pendingImages.length === 0;
    for (const image of this.state.pendingImages) {
      const chip = document.createElement("div");
      chip.className = "zms-image-chip";
      const preview = document.createElement("img");
      preview.src = `data:${image.mimeType};base64,${image.base64}`;
      preview.alt = image.name || this.t("imageInput");
      const label = document.createElement("span");
      label.textContent = image.name || this.t("imageInput");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = this.t("removeImage");
      remove.setAttribute?.("aria-label", this.t("removeImage"));
      remove.onclick = () => this.removeImage(image.id);
      chip.append(preview, label, remove);
      container.appendChild(chip);
    }
  },

  focusComposerInput() {
    focusElement(document.getElementById("zms-input"));
  },

  toggleSettings(open = !this.state.settingsOpen) {
    this.state.settingsOpen = Boolean(open);
    document.documentElement.setAttribute("data-settings-open", this.state.settingsOpen ? "true" : "false");
    const panel = document.getElementById("zms-settings-panel");
    const toggle = document.getElementById("zms-settings-toggle");
    if (panel) panel.setAttribute("aria-hidden", this.state.settingsOpen ? "false" : "true");
    if (toggle) toggle.setAttribute("aria-expanded", this.state.settingsOpen ? "true" : "false");
    if (!this.state.settingsOpen) this.queueComposerFocus();
  },

  openProfileSettings() {
    this.toggleSettings(true);
    window.setTimeout?.(() => focusElement(document.getElementById("zms-profile")), 30);
  },

  openSkillSettings() {
    this.toggleSettings(true);
    window.setTimeout?.(() => focusElement(document.getElementById("zms-skill")), 30);
  },

  closeWorkbench() {
    if (this.state.launchPayload?.embedded) {
      try {
        const panel = window.parent?.document?.getElementById?.("zotero-markdown-summary-workbench-panel");
        const close = panel?.querySelector?.(".zms-embedded-close");
        if (close?.click) {
          close.click();
          return;
        }
        panel?.remove?.();
        return;
      } catch (_err) {
        // Fall through to window close.
      }
    }
    window.close?.();
  },

  queueComposerFocus() {
    this.focusComposerInput();
    for (const delay of [50, 200, 500]) {
      window.setTimeout?.(() => this.focusComposerInput(), delay);
    }
  },

  updateComposerState() {
    const busy = Boolean(this.state.requestInFlight);
    const sendButton = document.getElementById("zms-send");
    const stopButton = document.getElementById("zms-stop");
    if (sendButton) sendButton.disabled = busy;
    if (stopButton) stopButton.disabled = !busy;
  },

  loadSettings() {
    const storedOutputDir = pref("outputDir");
    this.state.outputDir = resolvedOutputDir(storedOutputDir);
    if (this.state.outputDir !== storedOutputDir && shouldPersistResolvedOutputDir(storedOutputDir)) {
      setPref("outputDir", this.state.outputDir);
    }
    this.state.outputLanguage = normalizeOutputLanguage(pref("outputLanguage"));
    this.state.promptPackId = normalizePromptPackId(pref("promptPackId"));
    this.state.inputMode = normalizeInputMode(pref("inputMode"));
    this.state.stream = normalizeBoolean(pref("stream"), true);
    this.state.localOcrEnabled = normalizeBoolean(pref("localOcrEnabled"), false);
    this.state.localOcrEndpoint = String(pref("localOcrEndpoint") || "http://127.0.0.1:3333/mcp");
    this.state.localOcrTool = String(pref("localOcrTool") || "ocr_image");
    this.state.localOcrLanguage = String(pref("localOcrLanguage") || "eng");
    this.state.summaryVersion = String(pref("summaryVersion") || "1");
    this.state.uiLanguage = resolveUiLanguage(pref("uiLanguage"), runtimeLocale());
    this.state.systemPrompt = pref("systemPrompt") || "";
    this.state.userPrompt = pref("userPrompt") || "";
    this.state.profiles = getProfiles();
    const activeProfileId = pref("activeProfileId");
    this.state.profile = this.state.profiles.find((profile) => profile.id === activeProfileId)
      || this.state.profiles.find((profile) => profile.isDefault)
      || this.state.profiles[0]
      || null;
  },

  renderOutputDirSettings() {
    setInputValue("zms-workbench-output-dir", this.state.outputDir || resolvedOutputDir(pref("outputDir")));
  },

  async saveOutputDir(options = {}) {
    const element = document.getElementById("zms-workbench-output-dir");
    const nextOutputDir = resolvedOutputDir(element?.value || this.state.outputDir || pref("outputDir"));
    if (element) element.value = nextOutputDir;
    if (!nextOutputDir) {
      if (options.status !== false) this.setStatus(this.t("outputDirMissing"));
      return false;
    }
    try {
      await ensureDirectory(nextOutputDir);
      await ensureSkillTemplates(nextOutputDir);
      this.state.outputDir = nextOutputDir;
      setPref("outputDir", nextOutputDir);
      if (this.state.item) {
        await ensureDirectory(this.sessionDir());
        await this.renderSkills();
        await this.renderSessions();
        await this.loadVisualReviewState({ quiet: true });
      }
      if (options.status !== false) this.setStatus(`${this.t("outputDirSaved")}: ${nextOutputDir}`);
      return true;
    } catch (err) {
      if (options.status !== false) this.setStatus(`${this.t("outputDirCreateFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  async chooseOutputDir() {
    const element = document.getElementById("zms-workbench-output-dir");
    try {
      const selected = await chooseOutputDirectory(element?.value || this.state.outputDir, this.t("chooseOutputDirTitle"));
      if (!selected) return false;
      if (element) element.value = selected;
      return this.saveOutputDir();
    } catch (err) {
      this.setStatus(`${this.t("outputDirChooseFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  applyLanguage() {
    document.title = this.t("title");
    setText("zms-workbench-title", this.t("title"));
    setText("zms-settings-toggle", this.t("settings"));
    setText("zms-settings-close", this.t("closeSettings"));
    setButtonLabel("zms-close-workbench", "×", this.t("closeSettings"));
    setButtonLabel("zms-attach-image", "+", this.t("attachImageTitle"));
    setButtonLabel("zms-send", "↑", this.t("send"));
    setButtonLabel("zms-stop", "■", this.t("stop"));
    setText("zms-chat-paper-title", this.t("title"));
    setText("zms-quick-settings-heading", this.t("quickSettings"));
    setText("zms-workbench-output-dir-label", this.t("outputDir"));
    setButtonLabel("zms-workbench-choose-output-dir", this.t("chooseOutputDir"), this.t("chooseOutputDirTitle"));
    setButtonLabel("zms-workbench-save-output-dir", this.t("saveOutputDir"), this.t("saveOutputDir"));
    setText("zms-save-profile-settings", this.t("save"));
    setText("zms-test-profile-settings", this.t("saveAndTest"));
    setText("zms-workbench-provider-env-heading", this.t("providerEnv"));
    setText("zms-workbench-apply-provider-env", this.t("applyProviderEnv"));
    setText("zms-export-provider-diagnostics", this.t("exportProviderDiagnostics"));
    setText("zms-profile-name-label", this.t("profileName"));
    setText("zms-profile-base-url-label", this.t("baseURL"));
    setText("zms-profile-api-key-label", this.t("apiKey"));
    setText("zms-profile-model-label", this.t("model"));
    setText("zms-profile-image-text", this.t("imageInput"));
    setText("zms-profile-pdf-text", this.t("pdfInput"));
    setText("zms-local-ocr-text", this.t("localOcr"));
    setText("zms-local-ocr-options-heading", this.t("localOcrOptions"));
    setText("zms-local-ocr-endpoint-label", this.t("localOcrEndpoint"));
    setText("zms-local-ocr-tool-label", this.t("localOcrTool"));
    setText("zms-local-ocr-language-label", this.t("localOcrLanguage"));
    setText("zms-local-ocr-help", this.t("localOcrHelp"));
    const localOcrInput = document.getElementById("zms-local-ocr-input");
    if (localOcrInput) localOcrInput.setAttribute("title", this.t("localOcrTitle"));
    setText("zms-prompt-pack-label", this.t("promptPack"));
    setText("zms-paper-heading", this.t("paper"));
    setText("zms-profile-label", this.t("profile"));
    setText("zms-workbench-provider-label", this.t("modelProvider"));
    setText("zms-skill-label", this.t("skill"));
    setText("zms-sessions-heading", this.t("sessions"));
    setText("zms-candidates-heading", this.t("candidates"));
    setText("zms-candidate-query-label", this.t("candidateSearchQuery"));
    setText("zms-candidate-limit-label", this.t("candidateLimit"));
    setText("zms-candidate-email-label", this.t("candidateEmail"));
    setText("zms-candidate-semantic-key-label", this.t("candidateSemanticKey"));
    setText("zms-citation-policy-label", this.t("citationPolicy"));
    setText("zms-citation-direction-label", this.t("citationDirection"));
    setText("zms-citation-hops-label", this.t("citationHops"));
    setText("zms-citation-max-requests-label", this.t("citationMaxRequests"));
    setText("zms-citation-per-seed-label", this.t("citationPerSeed"));
    setText("zms-citation-seed-limit-label", this.t("citationSeedLimit"));
    setText("zms-citation-policy-balanced", this.t("citationPolicyBalanced"));
    setText("zms-citation-policy-precise", this.t("citationPolicyPrecise"));
    setText("zms-citation-policy-broad", this.t("citationPolicyBroad"));
    setText("zms-citation-direction-both", this.t("citationDirectionBoth"));
    setText("zms-citation-direction-references", this.t("citationDirectionReferences"));
    setText("zms-citation-direction-citations", this.t("citationDirectionCitations"));
    setText("zms-search-candidates", this.t("candidateSearch"));
    setText("zms-expand-citation-network", this.t("expandCitationNetwork"));
    setText("zms-load-candidates", this.t("loadCandidates"));
    setText("zms-apply-candidate-recommendations", this.t("applyCandidateRecommendations"));
    setText("zms-save-candidates", this.t("saveCandidateDecisions"));
    setText("zms-export-candidate-review", this.t("exportCandidateReview"));
    setText("zms-import-candidates", this.t("importCandidates"));
    setText("zms-attach-candidate-pdfs", this.t("attachCandidatePdfs"));
    setText("zms-reconcile-candidate-duplicates", this.t("reconcileCandidateDuplicates"));
    setText("zms-save-session", this.t("saveSession"));
    setText("zms-export-reading-log", this.t("exportReadingLog"));
    setText("zms-export-comparison-report", this.t("exportComparisonReport"));
    setText("zms-start-cross-review", this.t("startCrossReview"));
    const crossReviewButton = document.getElementById("zms-start-cross-review");
    if (crossReviewButton) crossReviewButton.setAttribute("title", this.t("startCrossReviewTitle"));
    setText("zms-export-visual-report", this.t("exportVisualReport"));
    setText("zms-visual-review-heading", this.t("visualReviewHeading"));
    setText("zms-load-visual-review", this.t("loadVisualReview"));
    setText("zms-save-visual-review", this.t("saveVisualReview"));
    setText("zms-export-review-draft", this.t("exportReviewDraft"));
    setText("zms-export-proposal-note", this.t("exportProposalNote"));
    setText("zms-export-journal-outline", this.t("exportJournalOutline"));
    setText("zms-open-reader", this.t("openReader"));
    setText("zms-writeback-title", this.t("writePreview"));
    setText("zms-write-action-label", this.t("action"));
    setText("zms-write-section-label", this.t("section"));
    setText("zms-preview-write", this.t("preview"));
    setText("zms-confirm-write", this.t("confirmWrite"));
    setText("zms-cancel-write", this.t("cancel"));
    setText("zms-load-models-workbench", this.t("loadModels"));
    const loadButton = document.getElementById("zms-load-models-workbench");
    if (loadButton) loadButton.setAttribute("title", this.t("loadModels"));
    setText("zms-workbench-model-help", this.t("modelPickerHelp"));
    document
      .getElementById("zms-input")
      .setAttribute("placeholder", `${this.t("placeholder")} · ${this.t("placeholderHint")}`);
    document.getElementById("zms-candidate-query").setAttribute("placeholder", this.t("candidateSearchPlaceholder"));
    const action = document.getElementById("zms-write-action");
    action.options[0].textContent = this.t("appendNotes");
    action.options[1].textContent = this.t("appendSection");
    action.options[2].textContent = this.t("replaceSection");
    this.renderPromptPacks();
  },

  t(key) {
    return wbMessage("workbench", key, this.state.uiLanguage);
  },

  renderPaper() {
    const item = this.state.item;
    const creators = item.getCreators?.().map((creator) => [creator.firstName, creator.lastName].filter(Boolean).join(" ")).filter(Boolean).slice(0, 4).join(", ") || "";
    const title = item.getField("title") || item.key;
    const year = item.getField("date") || "";
    const doi = item.getField("DOI") || "";
    const diagnostics = contextDiagnosticsText(this.state.contextDiagnostics, (key) => this.t(key));
    const comparisonSummary = comparisonSummaryText(this.state.comparisonContexts, this.state.uiLanguage);
    document.getElementById("zms-paper-meta").textContent = [title, creators, year, doi, comparisonSummary, diagnostics].filter(Boolean).join("\n");
    setText("zms-chat-paper-title", title);
    this.renderCandidateSearchDefaults();
  },

  renderCandidateSearchDefaults() {
    const input = document.getElementById("zms-candidate-query");
    if (!input || input.value.trim()) return;
    const title = this.state.context?.metadata?.title || this.state.item?.getField?.("title") || "";
    input.value = title;
  },

  renderProfiles() {
    const select = document.getElementById("zms-profile");
    select.textContent = "";
    for (const profile of this.state.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = `${profile.name || profile.id} (${profile.protocol})`;
      option.selected = this.state.profile?.id === profile.id;
      select.appendChild(option);
    }
    this.renderProfileStatus();
    this.renderProfileTrigger();
    this.renderProfileEditor();
    select.onchange = () => {
      this.state.profile = this.state.profiles.find((profile) => profile.id === select.value) || null;
      this.renderProfileStatus();
      this.renderProfileTrigger();
      this.renderProfileEditor();
      this.setStatus(this.state.profile ? profileStatusText(this.state.profile, (key) => this.t(key)) : this.t("noProfile"));
    };
  },

  renderProfileEditor() {
    const profile = this.state.profile || {};
    this.renderWorkbenchProviderOptions();
    setInputValue("zms-profile-name", profile.name || profile.id || "");
    setInputValue("zms-profile-base-url", profile.baseURL || "");
    setInputValue("zms-profile-api-key", profile.apiKey || "");
    setInputValue("zms-profile-model", profile.model || "");
    this.renderWorkbenchModelRecommendations({ selectDefault: true });
    const imageInput = document.getElementById("zms-profile-image-input");
    if (imageInput) imageInput.checked = profile?.capabilities?.imageBase64 === true;
    const pdfInput = document.getElementById("zms-profile-pdf-input");
    if (pdfInput) {
      pdfInput.checked = canUsePdfBase64Input(profile);
      pdfInput.disabled = profile?.protocol === "openai_chat";
      pdfInput.setAttribute?.("title", pdfInput.disabled ? this.t("pdfBase64Unsupported") : this.t("pdfInput"));
    }
    const localOcrInput = document.getElementById("zms-local-ocr-input");
    if (localOcrInput) localOcrInput.checked = this.state.localOcrEnabled === true;
    setInputValue("zms-local-ocr-endpoint", this.state.localOcrEndpoint || "http://127.0.0.1:3333/mcp");
    setInputValue("zms-local-ocr-tool", this.state.localOcrTool || "ocr_image");
    setInputValue("zms-local-ocr-language", this.state.localOcrLanguage || "eng");
  },

  renderWorkbenchProviderOptions() {
    const select = document.getElementById("zms-workbench-provider");
    if (!select) return;
    const currentProvider = workbenchProviderPresetFromProfile(this.state.profile, pref("provider"));
    const labels = workbenchProviderMenuLabels(this.state.uiLanguage);
    clearOptionsElement(select);
    for (const provider of workbenchProviderPresetIds()) {
      const defaults = workbenchProviderDefaults(provider);
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = labels[provider] || defaults.name || provider;
      option.selected = provider === currentProvider;
      select.appendChild(option);
    }
    select.value = currentProvider;
    select.onchange = () => this.applyWorkbenchProviderPreset(select.value);
  },

  applyWorkbenchProviderPreset(provider) {
    const providerId = workbenchProviderPresetValue(provider);
    const current = this.profileFromSettingsPanel() || this.state.profile || {};
    const previousProvider = workbenchProviderPresetFromProfile(current, pref("provider"));
    const defaults = workbenchProviderDefaults(providerId);
    const sameProvider = previousProvider === providerId;
    const storedProfile = sameProvider ? current : storedWorkbenchProfileForProviderPreset(providerId, this.state.profiles);
    const sourceProfile = storedProfile || {};
    const next = hydrateProfile({
      id: defaults.id,
      name: sourceProfile.name || defaults.name,
      protocol: defaults.protocol,
      endpointMode: defaults.endpointMode,
      baseURL: sourceProfile.baseURL || defaults.baseURL || "",
      fullURL: sourceProfile.fullURL || defaults.fullURL || "",
      apiKey: storedProfile ? String(sourceProfile.apiKey || "").trim() : "",
      model: sourceProfile.model || defaults.model || recommendedModelOptionsForWorkbenchProvider(providerId)[0]?.id || "",
      capabilities: { ...(defaults.capabilities || {}) },
      customHeaders: { ...(defaults.customHeaders || {}), ...(sourceProfile.customHeaders || {}) },
      bodyExtra: { ...(defaults.bodyExtra || {}), ...(sourceProfile.bodyExtra || {}) },
      isDefault: true
    });
    this.state.profile = next;
    this.state.profiles = normalizeDefaultProfileSelection([
      next,
      ...this.state.profiles.filter((profile) => profile?.id !== next.id)
    ]).map(hydrateProfile);
    this.renderProfiles();
    this.renderProfileEditor();
    this.renderProfileTrigger();
    this.setStatus(this.t("providerPresetApplied"));
    return next;
  },

  applyProviderEnvFromText() {
    const profile = this.profileFromSettingsPanel();
    const raw = document.getElementById("zms-workbench-provider-env-text")?.value || "";
    if (!profile) {
      this.setStatus(this.t("noProfile"));
      return null;
    }
    const result = applyProviderEnvTextToProfileForWorkbench(profile, raw, workbenchProviderFromProfile(profile, profile.id));
    if (!result.changed.length) {
      this.setStatus(this.t(raw.trim() ? "providerEnvNoMatch" : "providerEnvNoInput"));
      return result;
    }
    this.state.profile = hydrateProfile(result.profile);
    this.renderProfileEditor();
    this.saveProfileSettings({ status: false });
    this.setStatus(`${this.t("providerEnvApplied")}: ${result.changed.join(", ")}`);
    return result;
  },

  profileFromSettingsPanel() {
    if (!this.state.profile) return null;
    const pdfInput = document.getElementById("zms-profile-pdf-input");
    const nextProtocol = this.state.profile.protocol;
    const next = hydrateProfile({
      ...this.state.profile,
      name: document.getElementById("zms-profile-name")?.value?.trim() || this.state.profile.name || this.state.profile.id,
      baseURL: document.getElementById("zms-profile-base-url")?.value?.trim() || this.state.profile.baseURL,
      apiKey: document.getElementById("zms-profile-api-key")?.value?.trim() || "",
      model: document.getElementById("zms-profile-model")?.value?.trim() || "",
      capabilities: {
        ...(this.state.profile.capabilities || {}),
        imageBase64: document.getElementById("zms-profile-image-input")?.checked === true,
        pdfBase64: nextProtocol !== "openai_chat" && pdfInput?.checked === true
      }
    });
    return next;
  },

  saveProfileSettings(options = {}) {
    const profile = this.profileFromSettingsPanel();
    if (!profile) {
      this.setStatus(this.t("noProfile"));
      return null;
    }
    this.state.profile = profile;
    const updated = [
      { ...profile, isDefault: true },
      ...this.state.profiles
        .filter((item) => item.id !== profile.id)
        .map((item) => ({ ...item, isDefault: false }))
    ];
    this.state.profiles = normalizeDefaultProfileSelection(updated).map(hydrateProfile);
    setPref("activeProfileId", profile.id || "");
    setPref("profilesJson", JSON.stringify(this.state.profiles, null, 2));
    setPref("provider", workbenchProviderFromProfile(profile, pref("provider")));
    setPref("baseURL", profile.baseURL || "");
    setPref("apiKey", profile.apiKey || "");
    setPref("model", profile.model || "");
    this.syncLocalOcrPreference();
    this.renderProfiles();
    if (options.status !== false) this.setStatus(this.t("saved"));
    return profile;
  },

  syncLocalOcrPreference(options = {}) {
    const localOcrInput = document.getElementById("zms-local-ocr-input");
    if (!localOcrInput) return this.state.localOcrEnabled === true;
    const enabled = localOcrInput.checked === true;
    const endpoint = document.getElementById("zms-local-ocr-endpoint")?.value?.trim() || "http://127.0.0.1:3333/mcp";
    const tool = document.getElementById("zms-local-ocr-tool")?.value?.trim() || "ocr_image";
    const language = document.getElementById("zms-local-ocr-language")?.value?.trim() || "";
    this.state.localOcrEnabled = enabled;
    this.state.localOcrEndpoint = endpoint;
    this.state.localOcrTool = tool;
    this.state.localOcrLanguage = language;
    if (options.persist !== false) {
      setPref("localOcrEnabled", enabled);
      setPref("localOcrEndpoint", endpoint);
      setPref("localOcrTool", tool);
      setPref("localOcrLanguage", language);
    }
    return enabled;
  },

  async testProfileSettings() {
    const profile = this.saveProfileSettings({ status: false });
    if (!profile) return;
    if (isLocalAgentProfile(profile)) {
      this.setStatus(this.t("testing"));
      try {
        await verifyLocalAgentConnection(profile);
        this.setStatus(this.t("testOk"));
      } catch (err) {
        this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
      }
      return;
    }
    try {
      assertRemoteProfileReady(profile, (key) => this.t(key));
      this.setStatus(this.t("testing"));
      const request = connectionTestRequestForProfile(profile);
      const { response, text } = await runWorkbenchProviderConnectionTest(profile, request);
      if (!response.ok) {
        this.setStatus(`${this.t("testFailed")}: ${providerErrorText(response.status, text)}`);
        return;
      }
      extractProviderConnectionText(profile.protocol, text);
      this.setStatus(this.t("testOk"));
    } catch (err) {
      this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
    }
  },

  async loadModelsForWorkbench() {
    const profile = this.profileFromSettingsPanel();
    if (!profile) {
      this.setStatus(this.t("noProfile"));
      return;
    }
    const modelInput = document.getElementById("zms-profile-model");
    const wasModelBlank = !String(modelInput?.value || "").trim();
    const recommended = this.renderWorkbenchModelRecommendations({ selectDefault: true });
    if (!profileHasUsableAuth(profile) && !isLocalEndpoint(endpointForProfile(profile))) {
      this.setStatus(recommended.length ? `${this.t("modelRecommendationsLoaded")}: ${recommended.length}` : this.t("apiKeyMissing"));
      return;
    }
    const request = workbenchModelListRequestForProfile(profile);
    if (!request) {
      this.setStatus(recommended.length ? `${this.t("modelRecommendationsLoaded")}: ${recommended.length}` : this.t("modelListUnavailable"));
      return;
    }
    this.setStatus(this.t("modelListLoading"));
    try {
      let options = [];
      try {
        options = await workbenchFetchModelOptions(request);
      } catch (err) {
        if (isOllamaProfile(profile)) {
          // Fallback to Ollama's native /api/tags endpoint when /v1/models is not available
          options = await workbenchFetchOllamaTags(profile);
        } else {
          throw err;
        }
      }
      const displayOptions = mergeModelOptions(
        tagModelOptions(options, "online"),
        tagModelOptions(recommended, "recommended")
      );
      this.renderWorkbenchModelOptions(displayOptions);
      if (displayOptions.length) {
        if (wasModelBlank || !modelInput?.value?.trim()) {
          if (modelInput) modelInput.value = displayOptions[0].id;
        }
        this.syncWorkbenchModelSelect(displayOptions);
        this.saveProfileSettings({ status: false });
        this.renderWorkbenchModelOptions(displayOptions);
        this.syncWorkbenchModelSelect(displayOptions);
        this.setStatus(options.length ? `${this.t("modelListLoaded")}: ${options.length}` : `${this.t("modelRecommendationsLoaded")}: ${displayOptions.length}`);
      } else {
        this.setStatus(this.t("modelListEmpty"));
      }
    } catch (err) {
      if (recommended.length) {
        this.setStatus(`${this.t("modelListFailedUsingRecommendations")}: ${safeError(err)}`);
        return;
      }
      this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
    }
  },

  async exportProviderDiagnostics() {
    try {
      const profile = this.saveProfileSettings({ status: false });
      if (!profile) return;
      const now = new Date().toISOString();
      const reportPath = providerDiagnosticsMarkdownPath(this.state.outputDir, profile);
      this.setStatus(this.t("providerDiagnosticsExporting"));
      await writeTextAtomic(reportPath, renderProviderDiagnosticsMarkdown(profile, {
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        reportPath,
        statusText: profileStatusText(profile, (key) => this.t(key))
      }), `${reportPath}.${Date.now()}.tmp`);
      this.setStatus(`${this.t("providerDiagnosticsDone")}: ${reportPath}`);
    } catch (err) {
      this.setStatus(`${this.t("providerDiagnosticsFailed")}: ${safeError(err)}`);
    }
  },

  renderWorkbenchModelOptions(modelOptions) {
    const list = document.getElementById("zms-workbench-model-options");
    const select = document.getElementById("zms-profile-model-select");
    const entries = normalizeModelOptions(modelOptions);
    clearOptionsElement(list);
    if (select) {
      clearOptionsElement(select);
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = workbenchModelSelectPlaceholder(this.state.profile, entries, this.state.uiLanguage, (key) => this.t(key));
      select.appendChild(placeholder);
    }
    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.id;
      if (entry.label && entry.label !== entry.id) {
        option.setAttribute?.("label", entry.label);
      }
      if (list) list.appendChild(option);
    }
    if (select) {
      appendGroupedModelSelectOptions(select, entries, (key) => this.t(key));
    }
    if (select) {
      const custom = document.createElement("option");
      custom.value = "__custom";
      custom.textContent = this.t("modelSelectCustom");
      select.appendChild(custom);
      this.syncWorkbenchModelSelect(entries);
    }
  },

  renderWorkbenchModelRecommendations(options = {}) {
    const profile = this.profileFromSettingsPanel() || this.state.profile || {};
    const recommendations = recommendedModelOptionsForWorkbenchProfile(profile);
    this.renderWorkbenchModelOptions(tagModelOptions(recommendations, "recommended"));
    const modelInput = document.getElementById("zms-profile-model");
    if (modelInput && options.selectDefault && shouldSelectProviderDefaultModel(modelInput.value, recommendations) && recommendations[0]?.id) {
      modelInput.value = recommendations[0].id;
    }
    this.syncWorkbenchModelSelect(recommendations);
    return recommendations;
  },

  syncWorkbenchModelSelect(modelOptions) {
    const select = document.getElementById("zms-profile-model-select");
    const modelInput = document.getElementById("zms-profile-model");
    if (!select || !modelInput) return;
    const value = String(modelInput.value || "").trim();
    if (!value) {
      select.value = "";
      setWorkbenchCustomModelInputVisible(modelInput, false);
      return;
    }
    const entries = modelOptions || Array.from(document.getElementById("zms-workbench-model-options")?.children || [])
      .map((option) => ({ id: String(option.value || ""), label: String(option.label || option.value || "") }));
    select.value = entries.some((entry) => entry.id === value) ? value : "__custom";
    setWorkbenchCustomModelInputVisible(modelInput, select.value === "__custom");
  },

  selectWorkbenchModelFromDropdown() {
    const select = document.getElementById("zms-profile-model-select");
    const modelInput = document.getElementById("zms-profile-model");
    if (!select || !modelInput) return;
    const selected = String(select.value || "");
    if (selected && selected !== "__custom") {
      modelInput.value = selected;
      setWorkbenchCustomModelInputVisible(modelInput, false);
      return;
    }
    setWorkbenchCustomModelInputVisible(modelInput, true);
    modelInput.focus?.();
  },

  renderProfileStatus() {
    const element = document.getElementById("zms-profile-status");
    if (!element) return;
    element.textContent = profileStatusText(this.state.profile, (key) => this.t(key));
  },

  renderProfileTrigger() {
    const button = document.getElementById("zms-profile-trigger");
    const composerButton = document.getElementById("zms-composer-profile");
    const label = profileCompactLabel(this.state.profile, this.t("model"));
    const title = this.state.profile ? profileStatusText(this.state.profile, (key) => this.t(key)) : this.t("noProfile");
    for (const element of [button, composerButton]) {
      if (!element) continue;
      element.textContent = label;
      element.title = title;
      element.setAttribute?.("aria-label", title);
    }
  },

  async renderSkills() {
    const select = document.getElementById("zms-skill");
    select.textContent = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = this.t("noneSkill");
    select.appendChild(none);
    for (const id of await availableSkillIds(this.state.outputDir)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = this.t(id) === id ? id : this.t(id);
      select.appendChild(option);
    }
    select.onchange = () => {
      const id = select.value;
      document.getElementById("zms-skill-description").textContent = id ? this.t(`${id}-desc`) : "";
      this.renderSkillTrigger();
    };
    this.renderSkillTrigger();
  },

  renderPromptPacks() {
    const select = document.getElementById("zms-prompt-pack");
    const description = document.getElementById("zms-prompt-pack-description");
    if (!select) return;
    const current = normalizePromptPackId(this.state.promptPackId || pref("promptPackId"));
    select.textContent = "";
    for (const id of ZMS_PROMPT_PACK_IDS) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = this.t(`promptPack-${id}`);
      option.selected = id === current;
      select.appendChild(option);
    }
    select.value = current;
    this.state.promptPackId = current;
    if (description) description.textContent = current === "general" ? "" : this.t(`promptPack-${current}-desc`);
    select.onchange = () => {
      const next = normalizePromptPackId(select.value);
      this.state.promptPackId = next;
      setPref("promptPackId", next);
      if (description) description.textContent = next === "general" ? "" : this.t(`promptPack-${next}-desc`);
      this.setStatus(this.t("saved"));
    };
  },

  renderSkillTrigger() {
    const button = document.getElementById("zms-composer-skill");
    const select = document.getElementById("zms-skill");
    if (!button || !select) return;
    const id = select.value || "";
    const label = id ? (this.t(id) === id ? id : this.t(id)) : this.t("noneSkill");
    const description = id ? this.t(`${id}-desc`) : this.t("skill");
    button.textContent = label;
    button.title = description;
    button.setAttribute?.("aria-label", description);
  },

  async renderSessions() {
    const list = document.getElementById("zms-session-list");
    if (!list) return;
    list.textContent = "";
    try {
      const recent = await sessionFilesForItem(this.state.item, this.state.outputDir);
      if (!recent.length) {
        renderEmptySessionList(list, this.t("noSessions"));
        return;
      }
      for (const path of recent) {
        const button = document.createElement("button");
        const sessionId = sessionIdFromPath(path);
        button.textContent = sessionLabelFromPath(path);
        button.title = path;
        button.dataset.sessionId = sessionId;
        if (sessionId === this.state.sessionId) {
          button.setAttribute("aria-current", "true");
        }
        button.onclick = () => this.switchToSession(path);
        list.appendChild(button);
      }
    } catch (_err) {
      renderEmptySessionList(list, this.t("sessionListUnavailable"));
    }
  },

  async loadVisualReviewState(options = {}) {
    const path = visualExtractionReportJsonPath(this.state.outputDir, this.state.item);
    this.state.visualReviewPath = path;
    try {
      const data = await loadVisualExtractionReportData(path);
      if (!data) {
        this.state.visualReviewReportData = null;
        this.renderVisualReviewState(this.t("visualReviewNoReport"));
        if (!options.quiet) this.setStatus(`${this.t("visualReviewNoReport")}: ${path}`);
        return false;
      }
      this.state.visualReviewReportData = data;
      this.renderVisualReviewState();
      if (!options.quiet) this.setStatus(`${this.t("visualReviewLoaded")}: ${data.chartReviewActions?.length || 0}`);
      return true;
    } catch (err) {
      this.state.visualReviewReportData = null;
      this.renderVisualReviewState(`${this.t("visualReviewLoadFailed")}: ${safeError(err)}`);
      if (!options.quiet) this.setStatus(`${this.t("visualReviewLoadFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  renderVisualReviewState(message = "") {
    const status = document.getElementById("zms-visual-review-status");
    const list = document.getElementById("zms-visual-review-list");
    if (!status || !list) return;
    const data = this.state.visualReviewReportData || {};
    const actions = Array.isArray(data.chartReviewActions) ? data.chartReviewActions : [];
    status.textContent = message || (actions.length
      ? `${this.t("visualReviewLoaded")}: ${actions.length}`
      : this.t("visualReviewEmpty"));
    list.textContent = "";
    if (Array.isArray(list.children)) list.children.length = 0;
    if (!actions.length) {
      renderEmptySessionList(list, message || this.t("visualReviewEmpty"));
      return;
    }
    for (const action of actions) {
      list.appendChild(visualReviewActionElement(action, (key) => this.t(key)));
    }
  },

  async saveVisualReviewState() {
    try {
      const path = this.state.visualReviewPath || visualExtractionReportJsonPath(this.state.outputDir, this.state.item);
      let data = this.state.visualReviewReportData || await loadVisualExtractionReportData(path);
      if (!data) {
        this.setStatus(`${this.t("visualReviewNoReport")}: ${path}`);
        return false;
      }
      const updates = visualReviewActionUpdateMapFromDom();
      const actions = applyVisualReviewActionUpdates(data.chartReviewActions || [], updates);
      const now = new Date().toISOString();
      data = {
        ...data,
        chartReviewActions: actions,
        chartReviewStateUpdatedAt: now
      };
      await writeTextAtomic(path, renderVisualExtractionReportJson(data), `${path}.${Date.now()}.tmp`);
      if (data.reportPath) {
        await writeTextAtomic(data.reportPath, renderVisualExtractionReportMarkdownFromData(data, {
          outputLanguage: this.state.outputLanguage,
          reportPath: data.reportPath,
          jsonPath: path,
          csvPath: data.csvPath || ""
        }), `${data.reportPath}.${Date.now()}.tmp`);
      }
      if (data.csvPath) {
        await writeTextAtomic(data.csvPath, renderVisualExtractionReportCsv(data), `${data.csvPath}.${Date.now()}.tmp`);
      }
      this.state.visualReviewReportData = data;
      this.state.visualReviewPath = path;
      this.renderVisualReviewState();
      this.setStatus(`${this.t("visualReviewSaved")}: ${path}`);
      return true;
    } catch (err) {
      this.setStatus(`${this.t("visualReviewSaveFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  async loadCandidates(options = {}) {
    try {
      this.state.candidatePath = candidateJsonlPath(this.state.outputDir, this.state.item);
      this.state.candidates = await loadCandidateRecords(this.state.candidatePath);
      this.renderCandidates();
      if (!options.quiet) this.setStatus(`${this.t("candidateLoaded")}: ${this.state.candidates.length}`);
    } catch (err) {
      this.state.candidates = [];
      this.renderCandidates(safeError(err));
      if (!options.quiet) this.setStatus(`${this.t("candidateNoFile")}: ${safeError(err)}`);
    }
  },

  renderCandidates(errorText = "") {
    if (typeof document === "undefined") return;
    const status = document.getElementById("zms-candidate-status");
    const list = document.getElementById("zms-candidate-list");
    if (!status || !list) return;
    const candidates = Array.isArray(this.state.candidates) ? this.state.candidates : [];
    status.textContent = errorText || candidateStatusText(candidates, this.state.candidatePath, (key) => this.t(key));
    list.textContent = "";
    for (const record of candidates.slice(0, 25)) {
      list.appendChild(candidateElement(record, (key) => this.t(key)));
    }
  },

  async saveCandidates() {
    try {
      const updates = candidateReviewUpdateMapFromDom();
      const previousReview = candidatePreviousReviewMap(this.state.candidates);
      const now = new Date().toISOString();
      this.state.candidates = applyCandidateDecisions(this.state.candidates, updates, now);
      await saveCandidateRecords(this.state.candidatePath || candidateJsonlPath(this.state.outputDir, this.state.item), this.state.candidates);
      await appendImportLedgerEntries(importLedgerJsonlPath(this.state.outputDir, this.state.item), decisionLedgerEntries(this.state.candidates, previousReview, updates, now));
      this.renderCandidates();
      this.setStatus(`${this.t("candidateSaved")}: ${this.state.candidates.length}`);
    } catch (err) {
      this.setStatus(`${this.t("writeFailed")}: ${safeError(err)}`);
    }
  },

  async applyCandidateRecommendations() {
    try {
      const now = new Date().toISOString();
      const candidatePath = this.state.candidatePath || candidateJsonlPath(this.state.outputDir, this.state.item);
      const loaded = this.state.candidates.length
        ? this.state.candidates
        : await loadCandidateRecords(candidatePath).catch(() => []);
      if (!loaded.length) {
        this.setStatus(this.t("candidateRecommendationsNone"));
        return;
      }
      const domUpdates = candidateReviewUpdateMapFromDom();
      const recommendationUpdates = candidateRecommendationUpdates(loaded, domUpdates);
      if (!Object.keys(recommendationUpdates).length) {
        this.setStatus(this.t("candidateRecommendationsNone"));
        return;
      }
      const updates = mergeCandidateReviewUpdates(domUpdates, recommendationUpdates);
      const previousReview = candidatePreviousReviewMap(loaded);
      this.state.candidates = applyCandidateDecisions(loaded, updates, now);
      this.state.candidatePath = candidatePath;
      await saveCandidateRecords(candidatePath, this.state.candidates);
      await appendImportLedgerEntries(importLedgerJsonlPath(this.state.outputDir, this.state.item), decisionLedgerEntries(this.state.candidates, previousReview, updates, now));
      this.renderCandidates();
      this.setStatus(`${this.t("candidateRecommendationsApplied")}: ${Object.keys(recommendationUpdates).length}`);
    } catch (err) {
      this.setStatus(`${this.t("candidateRecommendationsFailed")}: ${safeError(err)}`);
    }
  },

  async searchCandidates() {
    try {
      if (!window.ZMSCandidateSources?.searchCandidateSources) {
        this.setStatus(this.t("candidateSearchUnavailable"));
        return;
      }
      const options = candidateSearchOptionsFromDom(this.state.item);
      if (!options.query) {
        this.setStatus(this.t("candidateSearchNoQuery"));
        return;
      }
      this.state.candidatePath = candidateJsonlPath(this.state.outputDir, this.state.item);
      this.setStatus(this.t("candidateSearching"));
      const existing = this.state.candidates.length
        ? this.state.candidates
        : await loadCandidateRecords(this.state.candidatePath).catch(() => []);
      const existingCandidateIds = new Set(existing.map((record) => record.candidateId));
      const result = await window.ZMSCandidateSources.searchCandidateSources(fetch.bind(window), {
        ...options,
        collectionKey: workbenchCollectionKey(this.state.item),
        now: new Date().toISOString()
      }, existing);
      this.state.candidates = window.ZMSCandidateSources.mergeCandidateRecords(existing, result.records);
      await saveCandidateRecords(this.state.candidatePath, this.state.candidates);
      await appendImportLedgerEntries(importLedgerJsonlPath(this.state.outputDir, this.state.item), discoveredLedgerEntries(result.records, existingCandidateIds));
      this.renderCandidates(candidateSearchErrorSummary(result.errors, (key) => this.t(key)));
      const errorSuffix = result.errors?.length ? `; ${this.t("candidateSourceErrors")}: ${result.errors.map((item) => item.source).join(", ")}` : "";
      this.setStatus(`${this.t("candidateSearchDone")}: ${result.records.length}${errorSuffix}`);
    } catch (err) {
      this.setStatus(`${this.t("candidateSearchFailed")}: ${safeError(err)}`);
    }
  },

  async expandCandidateCitationNetwork() {
    try {
      if (!window.ZMSCandidateSources?.expandCandidateCitationNetwork) {
        this.setStatus(this.t("candidateCitationNetworkUnavailable"));
        return;
      }
      this.state.candidatePath = candidateJsonlPath(this.state.outputDir, this.state.item);
      const existing = this.state.candidates.length
        ? this.state.candidates
        : await loadCandidateRecords(this.state.candidatePath).catch(() => []);
      const networkOptions = citationNetworkOptionsFromDom();
      const seeds = citationNetworkSeedsForWorkbench(existing, this.state.item, networkOptions.seedLimit);
      if (!seeds.length) {
        this.setStatus(this.t("candidateCitationNetworkNoSeeds"));
        return;
      }
      const existingCandidateIds = new Set(existing.map((record) => record.candidateId));
      const options = candidateSearchOptionsFromDom(this.state.item);
      this.setStatus(this.t("candidateCitationNetworkRunning"));
      const result = await window.ZMSCandidateSources.expandCandidateCitationNetwork(fetch.bind(window), {
        ...options,
        query: options.query || this.state.item?.getField?.("title") || this.state.item?.key || "citation-network",
        seeds,
        directions: networkOptions.directions,
        perSeedLimit: networkOptions.perSeedLimit,
        maxHops: networkOptions.maxHops,
        nextHopSeedLimit: networkOptions.nextHopSeedLimit,
        maxNetworkRequests: networkOptions.maxNetworkRequests,
        networkPolicy: networkOptions.policy,
        collectionKey: workbenchCollectionKey(this.state.item),
        now: new Date().toISOString()
      }, existing);
      this.state.candidates = window.ZMSCandidateSources.mergeCandidateRecords(existing, result.records);
      await saveCandidateRecords(this.state.candidatePath, this.state.candidates);
      await appendImportLedgerEntries(importLedgerJsonlPath(this.state.outputDir, this.state.item), discoveredLedgerEntries(result.records, existingCandidateIds));
      this.renderCandidates(candidateSearchErrorSummary(result.errors, (key) => this.t(key)));
      const errorSuffix = result.errors?.length ? `; ${this.t("candidateSourceErrors")}: ${result.errors.map((item) => item.source).join(", ")}` : "";
      this.setStatus(`${this.t("candidateCitationNetworkDone")}: ${result.records.length}; seeds ${seeds.length}; hops ${result.hops || 1}; policy ${networkOptions.policy}${errorSuffix}`);
    } catch (err) {
      this.setStatus(`${this.t("candidateCitationNetworkFailed")}: ${safeError(err)}`);
    }
  },

  async exportCandidateReview() {
    try {
      const now = new Date().toISOString();
      this.state.candidatePath = this.state.candidatePath || candidateJsonlPath(this.state.outputDir, this.state.item);
      const loaded = this.state.candidates.length
        ? this.state.candidates
        : await loadCandidateRecords(this.state.candidatePath).catch(() => []);
      const updates = candidateReviewUpdateMapFromDom();
      const previousReview = candidatePreviousReviewMap(loaded);
      const candidates = applyCandidateDecisions(loaded, updates, now);
      if (!candidates.length) {
        this.setStatus(this.t("candidateReviewNone"));
        return;
      }
      const reviewPath = candidateReviewMarkdownPath(this.state.outputDir, this.state.item);
      const ledgerPath = importLedgerJsonlPath(this.state.outputDir, this.state.item);
      this.setStatus(this.t("candidateReviewExporting"));
      const enrichedCandidates = await enrichCandidatesWithFullTextEvidence(candidates, this.state.item, now);
      await saveCandidateRecords(this.state.candidatePath, enrichedCandidates);
      await appendImportLedgerEntries(ledgerPath, decisionLedgerEntries(enrichedCandidates, previousReview, updates, now));
      await writeTextAtomic(reviewPath, renderCandidateReviewMarkdown(enrichedCandidates, {
        item: this.state.item,
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        candidatePath: this.state.candidatePath,
        ledgerPath,
        reviewPath
      }), `${reviewPath}.${Date.now()}.tmp`);
      this.state.candidates = enrichedCandidates;
      this.renderCandidates();
      this.setStatus(`${this.t("candidateReviewDone")}: ${reviewPath}`);
    } catch (err) {
      this.setStatus(`${this.t("candidateReviewFailed")}: ${safeError(err)}`);
    }
  },

  async importIncludedCandidates() {
    try {
      const now = new Date().toISOString();
      const candidates = this.state.candidates.length
        ? this.state.candidates
        : await loadCandidateRecords(this.state.candidatePath || candidateJsonlPath(this.state.outputDir, this.state.item)).catch(() => []);
      const importable = importableCandidateRecords(candidates);
      if (!importable.length) {
        this.setStatus(this.t("candidateImportNone"));
        return;
      }
      this.setStatus(this.t("candidateImporting"));
      const results = [];
      for (const record of importable) {
        results.push(await importCandidateIntoZotero(record, this.state.item, now));
      }
      const resultById = new Map(results.map((result) => [result.candidateId, result]));
      this.state.candidates = applyCandidateImportResults(candidates, resultById, now);
      const candidatePath = this.state.candidatePath || candidateJsonlPath(this.state.outputDir, this.state.item);
      await saveCandidateRecords(candidatePath, this.state.candidates);
      await appendImportLedgerEntries(importLedgerJsonlPath(this.state.outputDir, this.state.item), importResultLedgerEntries(this.state.candidates, resultById, now));
      this.renderCandidates();
      const imported = results.filter((result) => result.action === "imported").length;
      const skipped = results.filter((result) => result.action === "skipped_duplicate").length;
      const failed = results.filter((result) => result.action === "failed").length;
      this.setStatus(`${this.t("candidateImportDone")}: imported ${imported}; skipped ${skipped}; failed ${failed}`);
    } catch (err) {
      this.setStatus(`${this.t("candidateImportFailed")}: ${safeError(err)}`);
    }
  },

  async attachCandidatePdfs() {
    try {
      const now = new Date().toISOString();
      const candidatePath = this.state.candidatePath || candidateJsonlPath(this.state.outputDir, this.state.item);
      const candidates = this.state.candidates.length
        ? this.state.candidates
        : await loadCandidateRecords(candidatePath).catch(() => []);
      const records = pdfAttachableCandidateRecords(candidates);
      if (!records.length) {
        this.setStatus(this.t("candidatePdfNone"));
        return;
      }
      this.setStatus(this.t("candidatePdfAttaching"));
      const results = [];
      for (const record of records) {
        results.push(await attachCandidatePdfToZotero(record, this.state.item, now));
      }
      const resultById = new Map(results.map((result) => [result.candidateId, result]));
      this.state.candidates = applyCandidatePdfAttachmentResults(candidates, resultById, now);
      await saveCandidateRecords(candidatePath, this.state.candidates);
      await appendImportLedgerEntries(importLedgerJsonlPath(this.state.outputDir, this.state.item), pdfAttachmentLedgerEntries(this.state.candidates, resultById, now));
      this.renderCandidates();
      const attached = results.filter((result) => result.action === "attached_pdf").length;
      const missing = results.filter((result) => result.action === "missing_pdf").length;
      const failed = results.filter((result) => result.action === "failed").length;
      this.setStatus(`${this.t("candidatePdfDone")}: attached ${attached}; missing ${missing}; failed ${failed}`);
    } catch (err) {
      this.setStatus(`${this.t("candidatePdfFailed")}: ${safeError(err)}`);
    }
  },

  async reconcileCandidateDuplicates() {
    try {
      this.setStatus(this.t("candidateDedupeRunning"));
      const now = new Date().toISOString();
      const candidatePath = this.state.candidatePath || candidateJsonlPath(this.state.outputDir, this.state.item);
      const candidates = this.state.candidates.length
        ? this.state.candidates
        : await loadCandidateRecords(candidatePath).catch(() => []);
      const result = reconcileCandidateDuplicateRecords(candidates, now);
      this.state.candidates = result.records;
      await saveCandidateRecords(candidatePath, this.state.candidates);
      await appendImportLedgerEntries(importLedgerJsonlPath(this.state.outputDir, this.state.item), result.ledgerEntries);
      this.renderCandidates();
      this.setStatus(`${this.t("candidateDedupeDone")}: ${result.duplicateCount}`);
    } catch (err) {
      this.setStatus(`${this.t("candidateDedupeFailed")}: ${safeError(err)}`);
    }
  },

  async loadSession(path, options = {}) {
    try {
      if (this.state.messages.length && !options.resume) {
        await this.saveSession({ quiet: true });
      }
      const text = await readText(path);
      this.state.messages = sessionMessagesFromText(path, text);
      // Compaction markers live as the last entry when present. Drop them
      // from the live view; the marker is still kept on disk inside the
      // jsonl so the conversation can be re-derived if the user undoes.
      this.state.compaction = this.state.messages.find((m) => m?.role === "compaction") || null;
      this.state.messages = this.state.messages.filter((m) => m?.role !== "compaction");
      const previousId = this.state.sessionId;
      this.state.sessionId = sessionIdFromPath(path) || this.state.sessionId;
      if (!this.state.sessionId) this.state.sessionId = newSessionId();
      this.state.sessionStartedAt = sessionStartedAtFromId(this.state.sessionId);
      this.state.sessionIdBeforeResume = options.resume ? previousId : "";
      this.renderMessages();
      await this.renderSessions();
      this.setStatus(options.resume ? this.t("sessionResumed") : this.t("ready"));
      return true;
    } catch (err) {
      this.setStatus(`${this.t("sessionLoadFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  async switchToSession(path) {
    if (path && sessionIdFromPath(path) === this.state.sessionId) {
      this.setStatus(this.t("sessionAlreadyActive"));
      return;
    }
    await this.loadSession(path, { resume: false });
  },

  async newConversation() {
    if (this.state.messages.length) {
      await this.saveSession({ quiet: true });
    }
    this.state.sessionId = newSessionId();
    this.state.sessionStartedAt = Date.now();
    this.state.compaction = null;
    this.state.compactionScheduled = 0;
    this.state.messages = [];
    this.renderMessages();
    await this.renderSessions();
    this.setStatus(this.t("newConversation"));
  },

  async copySession() {
    if (!this.state.messages.length) {
      this.setStatus(this.t("copyEmpty"));
      return;
    }
    const text = renderSessionAsMarkdown(this.state.messages, this.t);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement("textarea");
        temp.value = text;
        temp.setAttribute("readonly", "readonly");
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        temp.style.pointerEvents = "none";
        document.body.appendChild(temp);
        temp.select();
        const ok = document.execCommand?.("copy");
        temp.remove();
        if (!ok) throw new Error("execCommand copy failed");
      }
      this.setStatus(`${this.t("copiedSelection")}: ${text.length} chars`);
    } catch (err) {
      this.setStatus(`${this.t("copyFailed")}: ${safeError(err)}`);
    }
  },

  async compactContext(options = {}) {
    if (this.state.compacting) return;
    if (this.state.messages.length < 2) {
      this.setStatus(this.t("nothingToCompact"));
      return;
    }
    const profile = this.state.profile;
    if (!profile) {
      this.setStatus(this.t("noProfile"));
      return;
    }
    this.state.compacting = true;
    this.setStatus(this.t("compacting"));
    try {
      if (this.state.messages.length) {
        await this.saveSession({ quiet: true });
      }
      const summary = await summarizeMessagesWithLlm(this.state.messages, profile, (key) => this.t(key), (text) => this.setStatus(text));
      if (!summary) {
        this.setStatus(this.t("compactFailed"));
        return;
      }
      this.state.compaction = {
        id: `compaction-${Date.now()}`,
        role: "compaction",
        summary,
        at: Date.now(),
        origin: options.auto ? "auto" : "manual",
        keptCount: this.state.messages.length
      };
      this.setStatus(this.t(options.auto ? "contextAutoCompacted" : "contextCompacted"));
      await this.saveSession({ quiet: true });
    } catch (err) {
      this.setStatus(`${this.t("compactFailed")}: ${safeError(err)}`);
    } finally {
      this.state.compacting = false;
      this.state.compactionScheduled = 0;
    }
  },

  async startCrossPaperReview() {
    const comparisonContexts = workbenchComparisonContexts(this.state);
    if (!comparisonContexts.length) {
      this.setStatus(this.t("crossReviewNeedsSelection"));
      return false;
    }
    const skill = document.getElementById("zms-skill");
    if (skill) {
      skill.value = "literature-review-synthesis";
      document.getElementById("zms-skill-description").textContent = this.t("literature-review-synthesis-desc");
      this.renderSkillTrigger();
    }
    const input = document.getElementById("zms-input");
    if (input && !String(input.value || "").trim()) {
      input.value = crossReviewPromptWithScope(
        this.t("crossReviewPrompt"),
        this.state.item,
        this.state.context,
        comparisonContexts,
        this.state.uiLanguage
      );
    }
    await this.send();
    return true;
  },

  maybeScheduleAutoCompact() {
    if (this.state.compacting) return;
    if (this.state.compaction) return;
    if (this.state.compactionScheduled) return;
    if (this.state.messages.length < COMPACT_TRIGGER_MESSAGES) return;
    const profile = this.state.profile;
    if (!profile) return;
    this.state.compactionScheduled = Date.now();
    this.setStatus(this.t("autoCompactScheduled"));
    window.setTimeout?.(() => {
      this.state.compactionScheduled = 0;
      if (this.state.messages.length >= COMPACT_TRIGGER_MESSAGES && !this.state.compaction && !this.state.compacting) {
        this.compactContext({ auto: true });
      }
    }, COMPACT_AUTO_DELAY_MS);
  },

  renderMessages() {
    const container = document.getElementById("zms-messages");
    container.textContent = "";
    for (const message of this.state.messages) {
      this.appendMessageElement(message);
    }
  },

  appendMessageElement(message) {
    const container = document.getElementById("zms-messages");
    const block = document.createElement("article");
    block.className = `zms-message zms-message-${message.role}`;
    block.dataset.messageId = message.id;
    block.dataset.zmsSelectableText = "1";
    const body = document.createElement("div");
    body.className = "zms-message-body";
    body.dataset.zmsSelectableText = "1";
    renderMessageContent(body, message);
    if (message.role === "assistant") {
      const toolbar = document.createElement("div");
      toolbar.className = "zms-message-toolbar";
      toolbar.dataset.zmsCopyExclude = "1";
      const copy = document.createElement("button");
      copy.className = "zms-message-copy";
      copy.dataset.zmsCopyExclude = "1";
      copy.type = "button";
      copy.textContent = this.t("copyAnswer");
      copy.title = this.t("copyAnswerTitle");
      copy.onclick = async () => {
        const copied = await copyText(answerTextForMessage(message));
        copy.textContent = copied ? this.t("copied") : this.t("copyFailed");
        this.setStatus(copied ? this.t("copied") : this.t("copyFailed"));
        window.setTimeout?.(() => {
          copy.textContent = this.t("copyAnswer");
        }, 1200);
      };
      toolbar.appendChild(copy);
      block.appendChild(toolbar);
    }
    block.appendChild(body);
    if (message.role === "user") {
      this.appendUserImageReview(block, message);
    }
    if (message.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "zms-message-actions";
      const retry = document.createElement("button");
      actions.dataset.zmsCopyExclude = "1";
      retry.dataset.zmsCopyExclude = "1";
      retry.textContent = this.t("retry");
      retry.onclick = () => this.retryMessage(message);
      const write = document.createElement("button");
      write.dataset.zmsCopyExclude = "1";
      write.textContent = this.t("write");
      write.onclick = () => this.openWriteback(message);
      actions.append(retry, write);
      block.appendChild(actions);
    }
    container.appendChild(block);
    container.scrollTop = container.scrollHeight;
    return body;
  },

  appendUserImageReview(block, message) {
    const images = Array.isArray(message?.images) ? message.images : [];
    if (!images.length) return;
    const panel = document.createElement("div");
    panel.className = "zms-user-image-review";
    const heading = document.createElement("div");
    heading.className = "zms-user-image-review-heading";
    heading.textContent = this.t("ocrReview");
    panel.appendChild(heading);
    images.forEach((image, index) => {
      const item = document.createElement("details");
      item.className = "zms-user-image-review-item";
      item.open = Boolean(image?.localOcr?.text || image?.localOcr?.error);
      const summary = document.createElement("summary");
      summary.textContent = `${image?.name || image?.mimeType || "image"} · ${userImageOcrSummary(image?.localOcr, (key) => this.t(key))}`;
      item.appendChild(summary);
      const meta = document.createElement("div");
      meta.className = "zms-user-image-review-meta";
      meta.textContent = `${this.t("ocrStatus")}: ${userImageOcrSummary(image?.localOcr, (key) => this.t(key))}`;
      item.appendChild(meta);
      const label = document.createElement("label");
      label.className = "zms-user-image-review-label";
      label.textContent = this.t("ocrText");
      const textarea = document.createElement("textarea");
      textarea.className = "zms-user-image-review-text";
      textarea.value = image?.localOcr?.text || "";
      textarea.rows = 3;
      const button = document.createElement("button");
      button.className = "zms-user-image-review-save";
      button.type = "button";
      button.textContent = this.t("saveOcr");
      button.onclick = async () => {
        const nextText = textarea.value.trim();
        const previous = image?.localOcr && typeof image.localOcr === "object" && !Array.isArray(image.localOcr)
          ? image.localOcr
          : {};
        images[index].localOcr = {
          ...previous,
          status: nextText ? (previous.status ? "corrected" : "manual") : "empty",
          text: nextText,
          error: ""
        };
        summary.textContent = `${image?.name || image?.mimeType || "image"} · ${userImageOcrSummary(images[index].localOcr, (key) => this.t(key))}`;
        meta.textContent = `${this.t("ocrStatus")}: ${userImageOcrSummary(images[index].localOcr, (key) => this.t(key))}`;
        try {
          await this.saveSession({ quiet: true });
          this.setStatus(this.t("ocrSaved"));
        } catch (err) {
          this.setStatus(`${this.t("saveFailed")}: ${safeError(err)}`);
        }
      };
      label.appendChild(textarea);
      item.append(label, button);
      panel.appendChild(item);
    });
    block.appendChild(panel);
  },

  async send() {
    const input = document.getElementById("zms-input");
    const rawContent = input.value.trim();
    const skillId = document.getElementById("zms-skill").value;
    const images = [...this.state.pendingImages];
    const content = userTextForSend(rawContent, skillId, images.length, this.state.outputLanguage);
    const displayContent = displayTextForSend(rawContent, skillId, images.length, this.state.outputLanguage, (id) => this.t(id));
    if (this.state.requestInFlight) {
      this.setStatus(this.t("thinking"));
      return;
    }
    if (!content && !skillId && !images.length) return;
    if (!this.state.profile) {
      this.setStatus(this.t("noProfile"));
      return;
    }
    if (images.length && !canUseImageInput(this.state.profile)) {
      this.setStatus(this.t("imageUnsupported"));
      return;
    }
    this.state.requestInFlight = true;
    this.state.lastProviderUsage = null;
    this.state.abortController = new AbortController();
    this.updateComposerState();
    let assistantMessage = null;
    let assistantBody = null;
    try {
      const localOcrEnabled = this.syncLocalOcrPreference({ persist: false });
      const imageMetadata = images.length && localOcrEnabled
        ? await this.imageMessageMetadataForSend(images)
        : images.map(imageMessageMetadata);
      const messageProfile = profileMessageMetadata(this.state.profile);
      const userMessage = makeMessage("user", displayContent, { skillId, images: imageMetadata, ...messageProfile });
      this.state.messages.push(userMessage);
      this.appendMessageElement(userMessage);
      input.value = "";
      this.state.pendingImages = [];
      this.renderImageAttachments();
      assistantMessage = makeMessage("assistant", "", { skillId, ...messageProfile });
      this.state.messages.push(assistantMessage);
      assistantBody = this.appendMessageElement(assistantMessage);
      this.setStatus(this.t("thinking"));
      const answer = await this.callModel(content, skillId, (delta) => {
        assistantMessage.content += delta;
        renderMessageContent(assistantBody, assistantMessage);
      }, images);
      const answerText = typeof answer === "string" ? answer : String(answer?.text || "");
      if (!assistantMessage.content) {
        assistantMessage.content = answerText;
        renderMessageContent(assistantBody, assistantMessage);
      }
      const usage = normalizeProviderUsage(this.state.lastProviderUsage || answer?.usage);
      if (usage) {
        assistantMessage.usage = usage;
        renderMessageContent(assistantBody, assistantMessage);
      }
      const saved = await this.saveSession();
      this.setStatus(saved === false ? this.t("answerReadySaveFailed") : this.t("ready"));
    } catch (err) {
      const errorText = safeError(err);
      if (assistantMessage && assistantBody) {
        if (visibleMessageText(assistantMessage).trim()) {
          assistantMessage.error = errorText;
          const saved = await this.saveSession({ quiet: true });
          const saveSuffix = saved === false ? ` (${this.t("answerReadySaveFailed")})` : "";
          this.setStatus(`${this.t("answerKeptAfterError")}${saveSuffix}: ${errorText}`);
        } else {
          assistantMessage.content = errorText;
          this.setStatus(errorText);
        }
        renderMessageContent(assistantBody, assistantMessage);
      } else {
        this.setStatus(errorText);
      }
    } finally {
      this.state.abortController = null;
      this.state.requestInFlight = false;
      this.updateComposerState();
    }
  },

  stop() {
    this.state.abortController?.abort();
  },

  async retryMessage(message) {
    const index = this.state.messages.findIndex((item) => item.id === message.id);
    const previousUser = this.state.messages.slice(0, index).reverse().find((item) => item.role === "user");
    if (!previousUser) return;
    const skill = document.getElementById("zms-skill");
    if (previousUser.skillId && Array.from(skill.options).some((option) => option.value === previousUser.skillId)) {
      skill.value = previousUser.skillId;
    }
    document.getElementById("zms-input").value = previousUser.content || "";
    await this.send();
  },

  async imageMessageMetadataForSend(images) {
    if (!images.length) return [];
    this.setStatus(this.t("localOcrRunning"));
    const results = [];
    for (const image of images) {
      results.push(await localOcrForImage(image, {
        endpoint: this.state.localOcrEndpoint,
        tool: this.state.localOcrTool,
        language: this.state.localOcrLanguage,
        signal: this.state.abortController?.signal
      }));
    }
    return images.map((image, index) => imageMessageMetadata(image, results[index]));
  },

  async callModel(userText, skillId, onDelta, images = []) {
    const profile = this.state.profile;
    if (!profile) throw new Error(this.t("noProfile"));
    const localAgents = localAgentPlan(profile, skillId);
    const skillTemplate = skillId ? await loadSkillTemplate(this.state.outputDir, skillId, this.state.outputLanguage) : "";
    const savedSummaryPrompt = skillId === "custom-summary" ? this.state.userPrompt : "";
    const prompt = promptTextForRequest(skillTemplate, savedSummaryPrompt, userText, this.state.promptPackId, this.state.outputLanguage);
    const contextText = contextForPrompt(this.state.context, prompt || userText);
    const requestPrompt = `${prompt || userText}\n\n${contextText}`;
    const requestMessages = requestMessagesWithHistory(this.state.messages, userText || this.t(skillId), requestPrompt, { compaction: this.state.compaction });
    this.maybeScheduleAutoCompact();
    if (localAgents.length) {
      const fallbackToRemote = localAgents.some((agent) => agent.fallbackToRemote);
      const localAgentPrompt = requestPrompt.trim();
      try {
        const answer = await callLocalAgents(localAgents, {
          skillId,
          prompt: localAgentPrompt,
          userText,
          contextText,
          requestMessages,
          model: profile?.model,
          outputLanguage: this.state.outputLanguage,
          cwd: localAgentRequestCwd(localAgents),
          signal: this.state.abortController?.signal,
          labelFor: (entry) => this.t(entry.skillId),
          formatFailure: (entrySkillId, error) => this.state.uiLanguage === "zh-CN"
            ? `调用 ${this.t(entrySkillId)} 失败：${safeError(error)}`
            : `${this.t(entrySkillId)} failed: ${safeError(error)}`,
          noResponseMessage: this.state.uiLanguage === "zh-CN" ? "本机代理未返回有效内容" : "No local agent output returned",
          mergeAsMulti: LOCAL_AGENT_AGGREGATE_SKILLS.includes(skillId)
        });
        if (!answer?.trim()) throw new Error("Local agent returned empty response");
        this.state.lastProviderUsage = null;
        return answer;
      } catch (err) {
        if (!fallbackToRemote) throw err;
        Zotero.debug(`[Markdown Summary] Local agent failed, fallback to remote provider: ${safeError(err)}`);
      }
    }
    assertRemoteProfileReady(profile, (key) => this.t(key));
    const requestInput = await buildRequestInput(profile, this.state.inputMode, this.state.pdf, images);
    this.setStatus(`${this.t("thinking")} - ${requestInputStatusText(requestInput, (key) => this.t(key))}`);
    const response = await requestModelWithRetry(
      profile,
      requestMessages,
      this.state.outputLanguage,
      this.state.systemPrompt,
      requestInput,
      this.state.stream,
      this.state.abortController?.signal,
      { parseStream: true, onDelta }
    );
    if (!response.ok) {
      throw new Error(providerErrorText(response.status, await response.text()));
    }
    if (response.zmsStreamText !== undefined) {
      this.state.lastProviderUsage = response.zmsUsage || null;
      return response.zmsStreamText;
    }
    if (response.zmsRequestedStream === true && response.body) {
      const text = await readStream(response, profile.protocol, onDelta);
      this.state.lastProviderUsage = response.zmsUsage || null;
      return text;
    }
    const data = await response.json();
    this.state.lastProviderUsage = providerUsageFromResponse(data);
    return extractResponseText(profile.protocol, data);
  },

  sessionDir() {
    return sessionDirForItem(this.state.outputDir, this.state.item);
  },

  sessionPath() {
    return PathUtils.join(this.sessionDir(), sessionFilenameFor(this.state.sessionId));
  },

  async saveSession(options = {}) {
    try {
      await ensureDirectory(this.sessionDir());
      const compactionEntry = this.state.compaction || null;
      const scopeKey = sessionScopeKey(this.state.item);
      const sourceItemKey = this.state.item?.key || "";
      const allLines = [
        ...this.state.messages.map((message) => JSON.stringify({
          ...message,
          itemKey: scopeKey,
          sourceItemKey,
          profileId: message.profileId || this.state.profile?.id,
          profileName: message.profileName || this.state.profile?.name,
          protocol: message.protocol || this.state.profile?.protocol,
          model: message.model || this.state.profile?.model,
          uiLanguage: this.state.uiLanguage,
          outputLanguage: this.state.outputLanguage
        })),
        ...(compactionEntry ? [JSON.stringify({
          ...compactionEntry,
          itemKey: scopeKey,
          sourceItemKey,
          profileId: this.state.profile?.id,
          profileName: this.state.profile?.name
        })] : [])
      ].join("\n");
      const path = this.sessionPath();
      await writeText(path, `${allLines}\n`);
      // Mirror the conversation as a Markdown copy so the user can open
      // it from the Zotero item as a linked attachment.
      const mdPath = sessionMarkdownPath(this.state.outputDir, this.state.item, this.state.sessionId);
      await writeText(mdPath, renderSessionAsMarkdown(this.state.messages, this.t, compactionEntry?.summary));
      if (this.state.item) {
        const ownerItem = sessionOwnerItem(this.state.item) || this.state.item;
        await linkOrCreateChatAttachment(ownerItem, scopeKey, mdPath, this.state.sessionId);
        await updateSessionIndexForItem(this.state.item, this.state.outputDir, {
          sessionId: this.state.sessionId,
          path,
          markdownPath: mdPath
        });
      }
      await this.renderSessions();
      if (!options.quiet) this.setStatus(this.t("saved"));
      return true;
    } catch (err) {
      this.setStatus(`${this.t("saveFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  async exportComparisonReport() {
    try {
      const comparisonContexts = Array.isArray(this.state.context?.comparisonContexts)
        ? this.state.context.comparisonContexts
        : this.state.comparisonContexts || [];
      if (!comparisonContexts.length) {
        this.setStatus(this.t("comparisonReportNone"));
        return;
      }
      const now = new Date().toISOString();
      const reportPath = comparisonReportMarkdownPath(this.state.outputDir, this.state.item);
      const reportContext = {
        ...(this.state.context || {}),
        comparisonContexts
      };
      this.setStatus(this.t("comparisonReportExporting"));
      await writeTextAtomic(reportPath, renderComparisonReportMarkdown(reportContext, {
        item: this.state.item,
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        reportPath,
        contextSourceHash: this.state.contextSourceHash
      }), `${reportPath}.${Date.now()}.tmp`);
      this.setStatus(`${this.t("comparisonReportDone")}: ${reportPath}`);
    } catch (err) {
      this.setStatus(`${this.t("comparisonReportFailed")}: ${safeError(err)}`);
    }
  },

  async exportVisualExtractionReport() {
    try {
      const exchange = latestVisualExtractionExchange(this.state.messages);
      if (!exchange) {
        this.setStatus(this.t("visualReportNone"));
        return;
      }
      const now = new Date().toISOString();
      const reportPath = visualExtractionReportMarkdownPath(this.state.outputDir, this.state.item);
      const jsonPath = visualExtractionReportJsonPath(this.state.outputDir, this.state.item);
      const csvPath = visualExtractionReportCsvPath(this.state.outputDir, this.state.item);
      const payload = {
        context: this.state.context || {},
        exchange,
        item: this.state.item
      };
      const options = {
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        reportPath,
        jsonPath,
        csvPath,
        contextSourceHash: this.state.contextSourceHash,
        previousChartReviewActions: await loadPreviousVisualExtractionChartReviewActions(jsonPath)
      };
      const reportData = visualExtractionReportData(payload, options);
      this.setStatus(this.t("visualReportExporting"));
      await writeTextAtomic(reportPath, renderVisualExtractionReportMarkdownFromData(reportData, options), `${reportPath}.${Date.now()}.tmp`);
      await writeTextAtomic(jsonPath, renderVisualExtractionReportJson(reportData), `${jsonPath}.${Date.now()}.tmp`);
      await writeTextAtomic(csvPath, renderVisualExtractionReportCsv(reportData), `${csvPath}.${Date.now()}.tmp`);
      this.state.visualReviewReportData = reportData;
      this.state.visualReviewPath = jsonPath;
      this.renderVisualReviewState();
      this.setStatus(`${this.t("visualReportDone")}: ${reportPath}`);
    } catch (err) {
      this.setStatus(`${this.t("visualReportFailed")}: ${safeError(err)}`);
    }
  },

  async exportReadingLog() {
    try {
      const now = new Date().toISOString();
      const logPath = readingLogMarkdownPath(this.state.outputDir, this.state.item);
      this.setStatus(this.t("readingLogExporting"));
      await writeTextAtomic(logPath, renderReadingLogMarkdown(this.state.context || {}, {
        item: this.state.item,
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        logPath,
        contextSourceHash: this.state.contextSourceHash
      }), `${logPath}.${Date.now()}.tmp`);
      this.setStatus(`${this.t("readingLogDone")}: ${logPath}`);
    } catch (err) {
      this.setStatus(`${this.t("readingLogFailed")}: ${safeError(err)}`);
    }
  },

  async exportReviewDraft() {
    try {
      const now = new Date().toISOString();
      const draftPath = reviewDraftMarkdownPath(this.state.outputDir, this.state.item);
      const reviewContext = {
        ...(this.state.context || {}),
        comparisonContexts: Array.isArray(this.state.context?.comparisonContexts)
          ? this.state.context.comparisonContexts
          : this.state.comparisonContexts || []
      };
      this.setStatus(this.t("reviewDraftExporting"));
      await writeTextAtomic(draftPath, renderReviewDraftMarkdown(reviewContext, {
        item: this.state.item,
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        draftPath,
        contextSourceHash: this.state.contextSourceHash
      }), `${draftPath}.${Date.now()}.tmp`);
      this.setStatus(`${this.t("reviewDraftDone")}: ${draftPath}`);
    } catch (err) {
      this.setStatus(`${this.t("reviewDraftFailed")}: ${safeError(err)}`);
    }
  },

  async exportProposalNote() {
    try {
      const now = new Date().toISOString();
      const notePath = proposalNoteMarkdownPath(this.state.outputDir, this.state.item);
      this.setStatus(this.t("proposalNoteExporting"));
      await writeTextAtomic(notePath, renderProposalNoteMarkdown(this.state.context || {}, {
        item: this.state.item,
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        notePath,
        contextSourceHash: this.state.contextSourceHash,
        promptPackId: this.state.promptPackId
      }), `${notePath}.${Date.now()}.tmp`);
      this.setStatus(`${this.t("proposalNoteDone")}: ${notePath}`);
    } catch (err) {
      this.setStatus(`${this.t("proposalNoteFailed")}: ${safeError(err)}`);
    }
  },

  async exportJournalOutline() {
    try {
      const now = new Date().toISOString();
      const outlinePath = journalOutlineMarkdownPath(this.state.outputDir, this.state.item);
      const outlineContext = {
        ...(this.state.context || {}),
        comparisonContexts: Array.isArray(this.state.context?.comparisonContexts)
          ? this.state.context.comparisonContexts
          : this.state.comparisonContexts || []
      };
      this.setStatus(this.t("journalOutlineExporting"));
      await writeTextAtomic(outlinePath, renderJournalOutlineMarkdown(outlineContext, {
        item: this.state.item,
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        outlinePath,
        contextSourceHash: this.state.contextSourceHash,
        promptPackId: this.state.promptPackId
      }), `${outlinePath}.${Date.now()}.tmp`);
      this.setStatus(`${this.t("journalOutlineDone")}: ${outlinePath}`);
    } catch (err) {
      this.setStatus(`${this.t("journalOutlineFailed")}: ${safeError(err)}`);
    }
  },

  async openReader() {
    try {
      const summary = await ensureSummaryFile(this.state.item, this.state.pdf, this.state.outputDir, this.summaryFileMetadata());
      const payload = {
        path: summary.path,
        title: this.state.item?.getField?.("title") || this.state.item?.key || "Markdown",
        itemID: this.state.item?.id || 0,
        itemKey: this.state.item?.key || "",
        embedded: !!this.state.launchPayload?.embedded
      };
      if (payload.embedded) {
        window.location.href = readerURL(payload);
        return;
      }
      window.openDialog(`${ZMS_CHROME_CONTENT_URL}reader.xhtml`, "zotero-markdown-summary-reader", "chrome,centerscreen,resizable", JSON.stringify(payload));
    } catch (err) {
      this.setStatus(safeError(err));
    }
  },

  async openWriteback(message) {
    this.state.writeMessage = message;
    try {
      const summary = await ensureSummaryFile(this.state.item, this.state.pdf, this.state.outputDir, this.summaryFileMetadata());
      if (summary.created) this.setStatus(this.t("noSummary"));
      this.state.summaryPath = summary.path;
      const original = await readText(summary.path);
      const sections = extractHeadings(original);
      const select = document.getElementById("zms-write-section");
      select.textContent = "";
      for (const section of sections.length ? sections : ["Research Notes"]) {
        const option = document.createElement("option");
        option.value = section;
        option.textContent = section;
        select.appendChild(option);
      }
      document.getElementById("zms-writeback").hidden = false;
      await this.previewWriteback();
    } catch (err) {
      this.setStatus(safeError(err));
    }
  },

  async previewWriteback() {
    if (!this.state.writeMessage) return;
    const action = document.getElementById("zms-write-action").value;
    const targetSection = action === "append_research_notes"
      ? (this.state.uiLanguage === "zh-CN" ? "聊天摘录" : "Research Notes")
      : document.getElementById("zms-write-section").value;
    const original = await readText(this.state.summaryPath);
    this.state.writePreview = applyMarkdownEdit(original, {
      summaryPath: this.state.summaryPath,
      chatSessionId: this.state.sessionId,
      action,
      targetSection,
      replacementText: answerTextForMessage(this.state.writeMessage),
      skillId: this.state.writeMessage.skillId,
      now: new Date().toISOString()
    });
    document.getElementById("zms-write-summary").textContent = writePreviewSummary(this.state.writePreview, {
      action,
      targetSection,
      summaryPath: this.state.summaryPath,
      translate: (key) => this.t(key)
    });
    document.getElementById("zms-write-diff").value = this.state.writePreview.diff;
  },

  async confirmWriteback() {
    try {
      if (!this.state.writePreview) await this.previewWriteback();
      const preview = this.state.writePreview;
      const current = await readText(this.state.summaryPath);
      assertWritePreviewCurrent(preview, current, this.t("writeStale"));
      await commitWritePreview(this.state.summaryPath, preview);
      document.getElementById("zms-writeback").hidden = true;
      this.setStatus(this.t("writeDone"));
    } catch (err) {
      this.setStatus(`${this.t("writeFailed")}: ${safeError(err)}`);
    }
  },

  cancelWriteback() {
    this.state.writePreview = null;
    this.state.writeMessage = null;
    document.getElementById("zms-writeback").hidden = true;
  },

  setStatus(message) {
    setText("zms-status", message);
    setText("zms-chat-status", message);
  },

  summaryFileMetadata() {
    return {
      outputLanguage: this.state.outputLanguage,
      sourceHash: this.state.contextSourceHash || buildContextSourceHash(this.state.context, this.state.item, this.state.pdf),
      summaryVersion: this.state.summaryVersion,
      inputMode: this.state.inputMode,
      provider: this.state.profile?.id || this.state.profile?.name || pref("provider") || "default",
      model: this.state.profile?.model || pref("model") || "",
      sourceLanguage: "auto",
      templateVersion: "workbench-v1",
      summaryType: this.state.comparisonContexts?.length ? "paper-comparison-chat" : "paper-chat",
      comparisonItemKeys: (this.state.comparisonContexts || []).map((entry) => entry.itemKey).filter(Boolean).join(",")
    };
  }
};

function itemFromArgs(args) {
  if (args.itemID) return Zotero.Items.get(Number(args.itemID));
  if (!args.itemKey) return null;
  const pane = Zotero.getActiveZoteroPane?.();
  return pane?.getSelectedItems?.().find((item) => item.key === args.itemKey) || null;
}

function itemsFromArgs(args) {
  const ids = parseListParam(args.itemIDs).map((value) => Number(value)).filter(Boolean);
  const keys = parseListParam(args.itemKeys);
  if (args.itemID && !ids.includes(Number(args.itemID))) ids.unshift(Number(args.itemID));
  if (args.itemKey && !keys.includes(args.itemKey)) keys.unshift(args.itemKey);
  const paneItems = Zotero.getActiveZoteroPane?.().getSelectedItems?.() || [];
  const items = [];
  for (const id of ids) {
    const item = Zotero.Items.get(Number(id));
    if (item) items.push(item);
  }
  for (const key of keys) {
    const item = paneItems.find((entry) => entry?.key === key) || itemByKey(key);
    if (item) items.push(item);
  }
  const fallback = itemFromArgs(args);
  if (fallback) items.push(fallback);
  return uniqueZoteroItems(items);
}

function parseListParam(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function itemByKey(key) {
  if (!key) return null;
  const libraryID = Zotero.Libraries?.userLibraryID || Zotero.getActiveZoteroPane?.().libraryID || 1;
  try {
    return Zotero.Items.getByLibraryAndKey?.(libraryID, key) || null;
  } catch (_err) {
    return null;
  }
}

function uniqueZoteroItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = item?.id || item?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sameZoteroItem(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return !!a.key && a.key === b.key;
}

function launchPayload() {
  const argPayload = parseWindowPayload(window.arguments?.[0]);
  if (Object.keys(argPayload).length) return argPayload;
  return payloadFromLocation();
}

function parseWindowPayload(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_err) {
      return {};
    }
  }
  return value;
}

function payloadFromLocation() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return {
      itemID: Number(params.get("itemID")) || 0,
      itemKey: params.get("itemKey") || "",
      itemIDs: params.get("itemIDs") || "",
      itemKeys: params.get("itemKeys") || "",
      embedded: params.get("embedded") === "1"
    };
  } catch (_err) {
    return {};
  }
}

function readerURL(payload) {
  const params = new URLSearchParams({
    path: payload.path || "",
    title: payload.title || "",
    itemID: String(payload.itemID || ""),
    itemKey: payload.itemKey || "",
    embedded: payload.embedded ? "1" : "0",
    refresh: String(Date.now())
  });
  return contentSiblingURL("reader.xhtml", params);
}

function contentSiblingURL(fileName, params) {
  const query = params.toString();
  try {
    const href = String(window.location?.href || "");
    const index = href.indexOf("/content/");
    if (index >= 0) return `${href.slice(0, index + "/content/".length)}${fileName}?${query}`;
  } catch (_err) {
    // Fall back to registered chrome content.
  }
  return `${ZMS_CHROME_CONTENT_URL}${fileName}?${query}`;
}

function getProfiles() {
  try {
    const profiles = JSON.parse(pref("profilesJson") || "[]");
    if (Array.isArray(profiles) && profiles.length) {
      const merged = mergeDefaultProviderProfiles(profiles);
      persistMergedProfilesIfNeeded(profiles, merged);
      return merged.map(hydrateProfile);
    }
  } catch (_err) {
    // Fall back to legacy settings.
  }
  const provider = pref("provider");
  const defaults = workbenchProviderDefaults(provider);
  return [{
    id: defaults.id,
    name: defaults.name,
    protocol: defaults.protocol,
    endpointMode: defaults.endpointMode,
    baseURL: pref("baseURL") || defaults.baseURL || "",
    fullURL: defaults.fullURL || "",
    apiKey: pref("apiKey"),
    model: pref("model") || defaults.model || "",
    capabilities: defaults.capabilities,
    customHeaders: defaults.customHeaders || {},
    bodyExtra: defaults.bodyExtra,
    isDefault: true
  }];
}

function persistMergedProfilesIfNeeded(originalProfiles, mergedProfiles) {
  const originalCount = Array.isArray(originalProfiles)
    ? originalProfiles.filter((profile) => profile && typeof profile === "object" && !Array.isArray(profile)).length
    : 0;
  if (!Array.isArray(mergedProfiles) || mergedProfiles.length <= originalCount) return;
  try {
    setPref("profilesJson", JSON.stringify(mergedProfiles, null, 2));
  } catch (_err) {
    // Workbench can still use the merged in-memory profiles if a pref write is unavailable.
  }
}

function hydrateProfile(profile) {
  const provider = workbenchProviderFromProfile(profile, pref("provider"));
  const defaults = workbenchProviderDefaults(provider);
  return normalizeProviderProfile({
    ...profile,
    protocol: profile.protocol || defaults.protocol,
    endpointMode: profile.endpointMode || defaults.endpointMode,
    baseURL: profile.baseURL || defaults.baseURL,
    fullURL: profile.fullURL || "",
    apiKey: profile.apiKey || "",
    model: profile.model || defaults.model,
    capabilities: {
      ...defaults.capabilities,
      ...(profile.capabilities || {})
    },
    customHeaders: profile.customHeaders || {},
    bodyExtra: profile.bodyExtra || defaults.bodyExtra
  }, defaults);
}

function defaultProviderProfiles() {
  return workbenchProviderPresetIds().map((provider, index) => {
    const defaults = workbenchProviderDefaults(provider);
    return {
      id: defaults.id,
      name: defaults.name,
      protocol: defaults.protocol,
      endpointMode: defaults.endpointMode,
      baseURL: defaults.baseURL || "",
      fullURL: defaults.fullURL || "",
      apiKey: "",
      model: defaults.model || "",
      capabilities: { ...(defaults.capabilities || {}) },
      customHeaders: { ...(defaults.customHeaders || {}) },
      bodyExtra: { ...(defaults.bodyExtra || {}) },
      isDefault: index === 0
    };
  });
}

function workbenchProviderPresetIds() {
  return [
    "minimax",
    "openai",
    "openai_compatible",
    "openai_responses_compatible",
    "anthropic",
    "anthropic_compatible",
    "gemini",
    "azure_openai",
    "vercel_ai_chat",
    "vercel_ai_responses",
    "vercel_ai_anthropic",
    "cline_api",
    "litellm_proxy_chat",
    "litellm_proxy_responses",
    "litellm_proxy_anthropic",
    "cloudflare_ai_chat",
    "cloudflare_ai_responses",
    "cloudflare_ai_anthropic",
    "github_models",
    "huggingface",
    "deepinfra",
    "fireworks",
    "cerebras",
    "nvidia_nim",
    "sambanova",
    "sambanova_responses",
    "sambanova_anthropic",
    "xai",
    "groq",
    "mistral",
    "together",
    "kimi",
    "perplexity",
    "deepseek",
    "deepseek_anthropic",
    "zai_anthropic",
    "openrouter",
    "dashscope",
    "siliconflow",
    "zhipu",
    "volcengine",
    "qianfan",
    "hunyuan",
    "ollama",
    "lm_studio",
    "local_agents"
  ];
}

function workbenchProviderPresetValue(provider) {
  const key = String(provider || "").trim().replace(/-/g, "_");
  return workbenchProviderPresetIds().includes(key) ? key : "openai_compatible";
}

function workbenchProviderPresetFromProfile(profile, fallbackProvider) {
  return workbenchProviderPresetValue(workbenchProviderFromProfile(profile, fallbackProvider));
}

function workbenchProviderMenuLabels(language) {
  const zh = String(language || "").toLowerCase().startsWith("zh");
  return {
    minimax: zh ? "MiniMax OpenAI 兼容" : "MiniMax OpenAI Compatible",
    openai: zh ? "OpenAI 原生" : "OpenAI Native",
    openai_compatible: zh ? "OpenAI 兼容接口" : "OpenAI Compatible Chat",
    openai_responses_compatible: zh ? "OpenAI Responses 兼容接口" : "OpenAI Responses Compatible",
    anthropic: zh ? "Anthropic 原生" : "Anthropic Native",
    anthropic_compatible: zh ? "Anthropic 兼容接口" : "Anthropic Compatible",
    gemini: zh ? "Gemini OpenAI 兼容" : "Gemini OpenAI Compatible",
    azure_openai: "Azure OpenAI",
    vercel_ai_chat: zh ? "Vercel AI Gateway 聊天接口" : "Vercel AI Gateway Chat",
    vercel_ai_responses: zh ? "Vercel AI Gateway Responses 接口" : "Vercel AI Gateway Responses",
    vercel_ai_anthropic: zh ? "Vercel AI Gateway Anthropic 接口" : "Vercel AI Gateway Anthropic",
    cline_api: zh ? "Cline API 聊天接口" : "Cline API Chat",
    litellm_proxy_chat: zh ? "LiteLLM Proxy 聊天接口" : "LiteLLM Proxy Chat",
    litellm_proxy_responses: zh ? "LiteLLM Proxy Responses 接口" : "LiteLLM Proxy Responses",
    litellm_proxy_anthropic: zh ? "LiteLLM Proxy Anthropic 接口" : "LiteLLM Proxy Anthropic",
    cloudflare_ai_chat: zh ? "Cloudflare AI 聊天接口" : "Cloudflare AI Chat",
    cloudflare_ai_responses: zh ? "Cloudflare AI Responses 接口" : "Cloudflare AI Responses",
    cloudflare_ai_anthropic: zh ? "Cloudflare AI Anthropic 接口" : "Cloudflare AI Anthropic",
    github_models: "GitHub Models",
    huggingface: "Hugging Face",
    deepinfra: "DeepInfra",
    fireworks: "Fireworks AI",
    cerebras: "Cerebras",
    nvidia_nim: "NVIDIA NIM",
    sambanova: zh ? "SambaNova 聊天接口" : "SambaNova Chat",
    sambanova_responses: zh ? "SambaNova Responses 接口" : "SambaNova Responses",
    sambanova_anthropic: zh ? "SambaNova Anthropic 接口" : "SambaNova Anthropic",
    xai: "xAI",
    groq: "Groq",
    mistral: "Mistral",
    together: "Together AI",
    kimi: "Kimi / Moonshot",
    perplexity: "Perplexity Sonar",
    deepseek: zh ? "DeepSeek 聊天接口" : "DeepSeek Chat",
    deepseek_anthropic: zh ? "DeepSeek Anthropic 接口" : "DeepSeek Anthropic",
    zai_anthropic: zh ? "Z.AI Anthropic 接口" : "Z.AI Anthropic",
    openrouter: "OpenRouter",
    dashscope: "Qwen / DashScope",
    siliconflow: "SiliconFlow",
    zhipu: zh ? "智谱 / GLM" : "Zhipu / GLM",
    volcengine: zh ? "火山方舟 / Doubao" : "Volcengine Ark / Doubao",
    qianfan: zh ? "百度千帆" : "Baidu Qianfan",
    hunyuan: zh ? "腾讯混元" : "Tencent Hunyuan",
    ollama: zh ? "Ollama 本地接口" : "Ollama Local",
    lm_studio: zh ? "LM Studio 本地接口" : "LM Studio Local",
    local_agents: zh ? "本地代理工具" : "Local Agents"
  };
}

function mergeDefaultProviderProfiles(profiles) {
  const existing = Array.isArray(profiles)
    ? profiles
      .filter((profile) => profile && typeof profile === "object" && !Array.isArray(profile))
      .map((profile) => normalizeProviderProfile(profile))
    : [];
  const defaults = defaultProviderProfiles();
  if (!existing.length) return defaults;
  const seen = new Set(existing.map((profile) => providerProfileCatalogKey(profile)).filter(Boolean));
  for (const defaultProfile of defaults) {
    const key = providerProfileCatalogKey(defaultProfile);
    if (!key || seen.has(key)) continue;
    existing.push({ ...defaultProfile, isDefault: false });
    seen.add(key);
  }
  return normalizeDefaultProfileSelection(existing);
}

function normalizeDefaultProfileSelection(profiles) {
  if (!profiles.length) return [];
  const defaultIndex = Math.max(0, profiles.findIndex((profile) => profile.isDefault));
  return profiles.map((profile, index) => ({ ...profile, isDefault: index === defaultIndex }));
}

function providerProfileCatalogKey(profile) {
  const id = String(profile?.id || "").trim();
  if (id === "openai_compatible") return "openai-compatible";
  if (id === "openai_responses_compatible") return "openai-responses-compatible";
  if (id === "anthropic_compatible") return "anthropic-compatible";
  if (id === "azure_openai") return "azure-openai";
  if (id === "vercel_ai_chat" || id === "vercel_ai_gateway" || id === "vercel-ai-gateway") return "vercel-ai-chat";
  if (id === "vercel_ai_responses") return "vercel-ai-responses";
  if (id === "vercel_ai_anthropic") return "vercel-ai-anthropic";
  if (id === "cline_api") return "cline-api";
  if (id === "litellm_proxy_chat") return "litellm-proxy-chat";
  if (id === "litellm_proxy_responses") return "litellm-proxy-responses";
  if (id === "litellm_proxy_anthropic") return "litellm-proxy-anthropic";
  if (id === "cloudflare_ai_chat" || id === "cloudflare_workers_ai" || id === "cloudflare-workers-ai") return "cloudflare-ai-chat";
  if (id === "cloudflare_ai_responses") return "cloudflare-ai-responses";
  if (id === "cloudflare_ai_anthropic") return "cloudflare-ai-anthropic";
  if (id === "github_models") return "github-models";
  if (id === "hugging_face" || id === "hf") return "huggingface";
  if (id === "deep_infra") return "deepinfra";
  if (id === "nvidia_nim") return "nvidia-nim";
  if (id === "sambanova_responses") return "sambanova-responses";
  if (id === "sambanova_anthropic") return "sambanova-anthropic";
  if (id === "moonshot") return "kimi";
  if (id === "deepseek_anthropic") return "deepseek-anthropic";
  if (id === "zai_anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") return "zai-anthropic";
  if (id === "glm" || id === "bigmodel") return "zhipu";
  if (id === "ark" || id === "doubao") return "volcengine";
  if (id === "baidu") return "qianfan";
  if (id === "tencent") return "hunyuan";
  if (id === "lm_studio") return "lm-studio";
  if (id === "local_agents") return "local-agents";
  return id;
}

function normalizeProviderProfile(profile, defaultsOverride) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const provider = workbenchProviderFromProfile(source, pref("provider"));
  const defaults = defaultsOverride || workbenchProviderDefaults(provider);
  const id = normalizeProfileId(source.id || defaults.id) || defaults.id || "custom";
  const name = String(source.name || defaults.name || id).trim() || id;
  return {
    ...source,
    id,
    name,
    protocol: normalizeProviderProtocol(source.protocol, defaults.protocol || "openai_chat"),
    endpointMode: normalizeEndpointMode(source.endpointMode, defaults.endpointMode || "base_url"),
    baseURL: String(source.baseURL || defaults.baseURL || "").trim(),
    fullURL: String(source.fullURL || defaults.fullURL || "").trim(),
    apiKey: String(source.apiKey || "").trim(),
    model: String(source.model || (shouldUseWorkbenchDefaultProviderModelForProfile(source, defaults) ? defaults.model : "") || "").trim(),
    capabilities: normalizeProviderCapabilities(source.capabilities, defaults.capabilities || {}),
    customHeaders: normalizeObjectStringMap(source.customHeaders) || normalizeObjectStringMap(defaults.customHeaders) || {},
    bodyExtra: normalizeObjectStringMap(source.bodyExtra) || normalizeObjectStringMap(defaults.bodyExtra) || {},
    isDefault: source.isDefault === true
  };
}

function shouldUseWorkbenchDefaultProviderModelForProfile(source, defaults) {
  const sourceId = String(source?.id || "").trim();
  if (!sourceId) return true;
  const sourceKey = providerProfileCatalogKey(source);
  const defaultKey = providerProfileCatalogKey(defaults);
  return !!sourceKey && sourceKey === defaultKey && defaultProviderProfileIds().includes(sourceKey);
}

function defaultProviderProfileIds() {
  return [
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
  ];
}

function normalizeProviderProtocol(value, fallback) {
  const protocol = String(value || "").trim();
  return ["openai_chat", "openai_responses", "anthropic_messages"].includes(protocol)
    ? protocol
    : fallback;
}

function normalizeEndpointMode(value, fallback) {
  const mode = String(value || "").trim();
  if (mode === "full_url" || mode === "base_url") return mode;
  return fallback === "full_url" ? "full_url" : "base_url";
}

function normalizeProviderCapabilities(value, defaults) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const keys = new Set([...Object.keys(defaults || {}), ...Object.keys(raw)]);
  const result = {};
  for (const key of keys) {
    result[key] = normalizeBoolean(raw[key], !!defaults?.[key]);
  }
  return result;
}

function normalizeProfileId(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function workbenchProviderDefaults(provider) {
  return withWorkbenchDefaultProviderModel(provider, workbenchProviderDefaultsRaw(provider));
}

function workbenchProviderDefaultsRaw(provider) {
  const id = String(provider || "openai_compatible").trim();
  const commonCapabilities = { text: true, pdfBase64: false, imageBase64: false, fileReference: false, streaming: true, embeddings: false, jsonMode: false, toolUse: false, modelList: true };
  const imageCapabilities = { ...commonCapabilities, imageBase64: true };
  if (id === "openai") {
    return { id: "openai", name: "OpenAI", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://api.openai.com/v1", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "openai_responses_compatible" || id === "openai-responses-compatible") {
    return { id: "openai-responses-compatible", name: "OpenAI Compatible Responses", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "anthropic") {
    return { id: "anthropic", name: "Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://api.anthropic.com", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "anthropic_compatible" || id === "anthropic-compatible") {
    return { id: "anthropic-compatible", name: "Anthropic Compatible Messages", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT", model: "", capabilities: commonCapabilities, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "minimax") {
    return { id: "minimax", name: "MiniMax", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.minimaxi.com/v1", model: "", capabilities: commonCapabilities, bodyExtra: { extra_body: { reasoning_split: true } } };
  }
  if (id === "gemini") {
    return { id: "gemini", name: "Gemini OpenAI Compatible", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "", capabilities: imageCapabilities, bodyExtra: {} };
  }
  if (id === "azure_openai" || id === "azure-openai") {
    return { id: "azure-openai", name: "Azure OpenAI", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, customHeaders: {}, bodyExtra: {} };
  }
  if (id === "vercel_ai_chat" || id === "vercel-ai-chat" || id === "vercel_ai_gateway" || id === "vercel-ai-gateway") {
    return { id: "vercel-ai-chat", name: "Vercel AI Gateway Chat", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://ai-gateway.vercel.sh/v1", model: "", capabilities: { ...imageCapabilities, pdfBase64: false }, bodyExtra: {} };
  }
  if (id === "vercel_ai_responses" || id === "vercel-ai-responses") {
    return { id: "vercel-ai-responses", name: "Vercel AI Gateway Responses", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://ai-gateway.vercel.sh/v1", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "vercel_ai_anthropic" || id === "vercel-ai-anthropic") {
    return { id: "vercel-ai-anthropic", name: "Vercel AI Gateway Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://ai-gateway.vercel.sh", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "cline_api" || id === "cline-api") {
    return { id: "cline-api", name: "Cline API", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.cline.bot/api/v1", model: "", capabilities: { ...imageCapabilities, pdfBase64: false }, bodyExtra: {} };
  }
  if (id === "litellm_proxy_chat" || id === "litellm-proxy-chat") {
    return { id: "litellm-proxy-chat", name: "LiteLLM Proxy Chat", protocol: "openai_chat", endpointMode: "base_url", baseURL: "http://localhost:4000", model: "", capabilities: { ...imageCapabilities, pdfBase64: false }, bodyExtra: {} };
  }
  if (id === "litellm_proxy_responses" || id === "litellm-proxy-responses") {
    return { id: "litellm-proxy-responses", name: "LiteLLM Proxy Responses", protocol: "openai_responses", endpointMode: "base_url", baseURL: "http://localhost:4000", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "litellm_proxy_anthropic" || id === "litellm-proxy-anthropic") {
    return { id: "litellm-proxy-anthropic", name: "LiteLLM Proxy Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "http://localhost:4000", model: "", capabilities: { ...imageCapabilities, pdfBase64: true }, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "cloudflare_ai_chat" || id === "cloudflare-ai-chat" || id === "cloudflare_workers_ai" || id === "cloudflare-workers-ai") {
    return { id: "cloudflare-ai-chat", name: "Cloudflare AI OpenAI Chat", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1", model: "", capabilities: { ...commonCapabilities, modelList: false }, bodyExtra: {} };
  }
  if (id === "cloudflare_ai_responses" || id === "cloudflare-ai-responses") {
    return { id: "cloudflare-ai-responses", name: "Cloudflare AI Responses", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1", model: "", capabilities: { ...commonCapabilities, modelList: false }, bodyExtra: {} };
  }
  if (id === "cloudflare_ai_anthropic" || id === "cloudflare-ai-anthropic") {
    return { id: "cloudflare-ai-anthropic", name: "Cloudflare AI Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1", model: "", capabilities: { ...commonCapabilities, modelList: false }, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "github_models" || id === "github-models") {
    return { id: "github-models", name: "GitHub Models", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://models.github.ai/inference", model: "", capabilities: { ...commonCapabilities, modelList: false }, customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, bodyExtra: {} };
  }
  if (id === "huggingface" || id === "hugging_face" || id === "hf") {
    return { id: "huggingface", name: "Hugging Face", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://router.huggingface.co/v1", model: "", capabilities: imageCapabilities, bodyExtra: {} };
  }
  if (id === "deepinfra" || id === "deep_infra") {
    return { id: "deepinfra", name: "DeepInfra", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.deepinfra.com/v1/openai", model: "", capabilities: imageCapabilities, bodyExtra: {} };
  }
  if (id === "fireworks") {
    return { id: "fireworks", name: "Fireworks AI", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.fireworks.ai/inference/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "cerebras") {
    return { id: "cerebras", name: "Cerebras", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.cerebras.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "nvidia_nim" || id === "nvidia-nim") {
    return { id: "nvidia-nim", name: "NVIDIA NIM", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://integrate.api.nvidia.com/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "sambanova") {
    return { id: "sambanova", name: "SambaNova", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.sambanova.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "sambanova_responses" || id === "sambanova-responses") {
    return { id: "sambanova-responses", name: "SambaNova Responses", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://api.sambanova.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "sambanova_anthropic" || id === "sambanova-anthropic") {
    return { id: "sambanova-anthropic", name: "SambaNova Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://api.sambanova.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: { authHeader: "authorization" } };
  }
  if (id === "xai") {
    return { id: "xai", name: "xAI", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.x.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "groq") {
    return { id: "groq", name: "Groq", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.groq.com/openai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "mistral") {
    return { id: "mistral", name: "Mistral AI", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.mistral.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "together") {
    return { id: "together", name: "Together AI", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.together.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "kimi" || id === "moonshot") {
    return { id: "kimi", name: "Kimi / Moonshot", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.moonshot.ai/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "perplexity") {
    return { id: "perplexity", name: "Perplexity Sonar", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.perplexity.ai", model: "", capabilities: { ...commonCapabilities }, bodyExtra: {} };
  }
  if (id === "deepseek") {
    return { id: "deepseek", name: "DeepSeek", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.deepseek.com", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "deepseek_anthropic" || id === "deepseek-anthropic") {
    return { id: "deepseek-anthropic", name: "DeepSeek Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://api.deepseek.com/anthropic", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "zai_anthropic" || id === "zai-anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") {
    return { id: "zai-anthropic", name: "Z.AI Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://api.z.ai/api/anthropic", model: "", capabilities: { ...commonCapabilities }, bodyExtra: {} };
  }
  if (id === "openrouter") {
    return { id: "openrouter", name: "OpenRouter", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://openrouter.ai/api/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "dashscope" || id === "qwen") {
    return { id: "dashscope", name: "Qwen / DashScope", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "siliconflow") {
    return { id: "siliconflow", name: "SiliconFlow", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.siliconflow.com/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "zhipu" || id === "glm" || id === "bigmodel") {
    return { id: "zhipu", name: "Zhipu / GLM", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "", capabilities: { ...commonCapabilities }, bodyExtra: {} };
  }
  if (id === "volcengine" || id === "ark" || id === "doubao") {
    return { id: "volcengine", name: "Volcengine Ark / Doubao", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://ark.cn-beijing.volces.com/api/v3", model: "", capabilities: { ...commonCapabilities }, bodyExtra: {} };
  }
  if (id === "qianfan" || id === "baidu") {
    return { id: "qianfan", name: "Baidu Qianfan", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://qianfan.baidubce.com/v2", model: "", capabilities: { ...commonCapabilities }, bodyExtra: {} };
  }
  if (id === "hunyuan" || id === "tencent") {
    return { id: "hunyuan", name: "Tencent Hunyuan", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.hunyuan.cloud.tencent.com/v1", model: "", capabilities: { ...commonCapabilities }, bodyExtra: {} };
  }
  if (id === "ollama") {
    return { id: "ollama", name: "Ollama", protocol: "openai_chat", endpointMode: "base_url", baseURL: "http://localhost:11434/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "lm_studio" || id === "lm-studio") {
    return { id: "lm-studio", name: "LM Studio", protocol: "openai_chat", endpointMode: "base_url", baseURL: "http://127.0.0.1:1234/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "local_agents" || id === "local-agents") {
    return { id: "local-agents", name: "Local Agents", protocol: "openai_chat", endpointMode: "base_url", baseURL: "http://127.0.0.1:3333/v1", model: "", capabilities: { ...commonCapabilities, imageBase64: false, streaming: false, modelList: false }, bodyExtra: { localAgent: { endpoint: "http://127.0.0.1:3333/mcp", payloadMode: "jsonrpc", timeoutSeconds: 180, "ask-gemini": { tool: "ask_gemini" }, "ask-claude": { tool: "ask_claude" }, "ask-opencode": { tool: "ask_opencode" }, "ask-all-agents": { tool: "ask_all_agents" }, "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } }, "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } }, "extract-pdf-pages": { tool: "extract_pdf_pages" } } } };
  }
  return { id: "openai-compatible", name: "OpenAI Compatible Chat", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.openai.com/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
}

function withWorkbenchDefaultProviderModel(provider, defaults) {
  const current = String(defaults?.model || "").trim();
  if (current) return defaults;
  const model = recommendedDefaultModelForWorkbenchProvider(provider, defaults);
  return model ? { ...defaults, model } : defaults;
}

function recommendedDefaultModelForWorkbenchProvider(provider, defaults = {}) {
  const key = String(defaults?.id || provider || "").replace(/-/g, "_");
  if (key === "azure_openai" || key === "local_agents") return "";
  return recommendedModelOptionsForWorkbenchProvider(key)[0]?.id || "";
}

function storedWorkbenchProfileForProviderPreset(provider, profiles) {
  const providerValue = workbenchProviderPresetValue(provider);
  const defaults = workbenchProviderDefaults(providerValue);
  const defaultId = normalizeProfileId(defaults.id);
  return (profiles || []).find((profile) => {
    const profileId = normalizeProfileId(profile?.id);
    return profileId === defaultId || workbenchProviderFromProfile(profile, "") === providerValue;
  }) || null;
}

function workbenchProviderFromProfile(profile, fallbackProvider) {
  if (profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent) return "local_agents";
  const id = String(profile?.id || fallbackProvider || "").trim();
  if (id === "moonshot") return "kimi";
  if (id === "github-models" || id === "github_models") return "github_models";
  if (id === "vercel-ai-chat" || id === "vercel_ai_chat" || id === "vercel-ai-gateway" || id === "vercel_ai_gateway") return "vercel_ai_chat";
  if (id === "vercel-ai-responses" || id === "vercel_ai_responses") return "vercel_ai_responses";
  if (id === "vercel-ai-anthropic" || id === "vercel_ai_anthropic") return "vercel_ai_anthropic";
  if (id === "cline-api" || id === "cline_api") return "cline_api";
  if (id === "litellm-proxy-chat" || id === "litellm_proxy_chat") return "litellm_proxy_chat";
  if (id === "litellm-proxy-responses" || id === "litellm_proxy_responses") return "litellm_proxy_responses";
  if (id === "litellm-proxy-anthropic" || id === "litellm_proxy_anthropic") return "litellm_proxy_anthropic";
  if (id === "cloudflare-ai-chat" || id === "cloudflare_ai_chat" || id === "cloudflare-workers-ai" || id === "cloudflare_workers_ai") return "cloudflare_ai_chat";
  if (id === "cloudflare-ai-responses" || id === "cloudflare_ai_responses") return "cloudflare_ai_responses";
  if (id === "cloudflare-ai-anthropic" || id === "cloudflare_ai_anthropic") return "cloudflare_ai_anthropic";
  if (id === "huggingface" || id === "hugging_face" || id === "hf") return "huggingface";
  if (id === "deepinfra" || id === "deep_infra") return "deepinfra";
  if (id === "nvidia-nim" || id === "nvidia_nim") return "nvidia_nim";
  if (id === "sambanova-responses" || id === "sambanova_responses") return "sambanova_responses";
  if (id === "sambanova-anthropic" || id === "sambanova_anthropic") return "sambanova_anthropic";
  if (id === "zai-anthropic" || id === "zai_anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") return "zai_anthropic";
  if (id === "anthropic-compatible" || id === "anthropic_compatible") return "anthropic_compatible";
  if (id === "openai-responses-compatible" || id === "openai_responses_compatible") return "openai_responses_compatible";
  if (["vercel_ai_chat", "vercel_ai_responses", "vercel_ai_anthropic", "cline_api", "litellm_proxy_chat", "litellm_proxy_responses", "litellm_proxy_anthropic", "cloudflare_ai_chat", "cloudflare_ai_responses", "cloudflare_ai_anthropic", "deepinfra", "fireworks", "cerebras", "sambanova", "xai", "groq", "mistral", "together", "kimi", "perplexity", "deepseek", "deepseek-anthropic", "deepseek_anthropic", "openrouter", "dashscope", "qwen", "siliconflow", "zhipu", "volcengine", "qianfan", "hunyuan", "ollama", "gemini"].includes(id)) return id;
  if (id === "glm" || id === "bigmodel") return "zhipu";
  if (id === "ark" || id === "doubao") return "volcengine";
  if (id === "baidu") return "qianfan";
  if (id === "tencent") return "hunyuan";
  if (id === "lm-studio" || id === "lm_studio") return "lm_studio";
  if (id === "azure-openai" || id === "azure_openai") return "azure_openai";
  if (id === "minimax" || id === "openai" || id === "anthropic" || id === "openai-compatible" || id === "openai_compatible") return id;
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  if (baseURL === "https://api.minimaxi.com/v1") return "minimax";
  if (baseURL === "https://generativelanguage.googleapis.com/v1beta/openai") return "gemini";
  if (/^https:\/\/[^/]+\.openai\.azure\.com\/openai\/v1$/i.test(baseURL) || /^https:\/\/[^/]+\.services\.ai\.azure\.com\/openai\/v1$/i.test(baseURL)) return "azure_openai";
  if (baseURL === "https://ai-gateway.vercel.sh/v1" || baseURL === "https://ai-gateway.vercel.sh/v1/chat/completions" || baseURL === "https://ai-gateway.vercel.sh/v1/responses") {
    if (profile?.protocol === "openai_responses") return "vercel_ai_responses";
    if (profile?.protocol === "anthropic_messages") return "vercel_ai_anthropic";
    return "vercel_ai_chat";
  }
  if (baseURL === "https://ai-gateway.vercel.sh" || baseURL === "https://ai-gateway.vercel.sh/v1/messages") {
    if (profile?.protocol === "anthropic_messages") return "vercel_ai_anthropic";
  }
  if (baseURL === "https://api.cline.bot/api/v1" || baseURL === "https://api.cline.bot/api/v1/chat/completions") return "cline_api";
  if (baseURL === "http://localhost:4000" || baseURL === "http://localhost:4000/v1" || baseURL === "http://localhost:4000/v1/chat/completions" || baseURL === "http://localhost:4000/v1/responses" || baseURL === "http://localhost:4000/v1/messages" || baseURL === "http://127.0.0.1:4000" || baseURL === "http://127.0.0.1:4000/v1" || baseURL === "http://127.0.0.1:4000/v1/chat/completions" || baseURL === "http://127.0.0.1:4000/v1/responses" || baseURL === "http://127.0.0.1:4000/v1/messages") {
    if (profile?.protocol === "openai_responses") return "litellm_proxy_responses";
    if (profile?.protocol === "anthropic_messages") return "litellm_proxy_anthropic";
    return "litellm_proxy_chat";
  }
  if (/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai\/v1(?:\/(?:chat\/completions|responses|messages))?$/i.test(baseURL)) {
    if (profile?.protocol === "openai_responses") return "cloudflare_ai_responses";
    if (profile?.protocol === "anthropic_messages") return "cloudflare_ai_anthropic";
    return "cloudflare_ai_chat";
  }
  if (baseURL === "https://models.github.ai/inference" || baseURL === "https://models.github.ai/inference/chat/completions") return "github_models";
  if (baseURL === "https://router.huggingface.co/v1" || baseURL === "https://router.huggingface.co/v1/chat/completions") return "huggingface";
  if (baseURL === "https://api.deepinfra.com/v1/openai" || baseURL === "https://api.deepinfra.com/v1/openai/chat/completions") return "deepinfra";
  if (baseURL === "https://api.fireworks.ai/inference/v1") return "fireworks";
  if (baseURL === "https://api.cerebras.ai/v1") return "cerebras";
  if (baseURL === "https://integrate.api.nvidia.com/v1") return "nvidia_nim";
  if (baseURL === "https://api.sambanova.ai/v1") {
    if (profile?.protocol === "openai_responses") return "sambanova_responses";
    if (profile?.protocol === "anthropic_messages") return "sambanova_anthropic";
    return "sambanova";
  }
  if (baseURL === "https://api.x.ai/v1") return "xai";
  if (baseURL === "https://api.groq.com/openai/v1") return "groq";
  if (baseURL === "https://api.mistral.ai/v1") return "mistral";
  if (baseURL === "https://api.together.ai/v1") return "together";
  if (baseURL === "https://api.moonshot.ai/v1") return "kimi";
  if (baseURL === "https://api.perplexity.ai") return "perplexity";
  if (baseURL === "https://api.deepseek.com") return "deepseek";
  if (baseURL === "https://api.deepseek.com/anthropic") return "deepseek_anthropic";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL === "https://api.z.ai/api/anthropic/v1" || baseURL === "https://api.z.ai/api/anthropic/v1/messages") return "zai_anthropic";
  if (baseURL === "https://openrouter.ai/api/v1") return "openrouter";
  if (baseURL === "https://dashscope.aliyuncs.com/compatible-mode/v1") return "dashscope";
  if (baseURL === "https://api.siliconflow.com/v1" || baseURL === "https://api.siliconflow.cn/v1") return "siliconflow";
  if (baseURL === "https://open.bigmodel.cn/api/paas/v4" || baseURL === "https://api.z.ai/api/paas/v4") return "zhipu";
  if (baseURL === "https://ark.cn-beijing.volces.com/api/v3") return "volcengine";
  if (baseURL === "https://qianfan.baidubce.com/v2" || baseURL === "https://qianfan.bj.baidubce.com/v2") return "qianfan";
  if (baseURL === "https://api.hunyuan.cloud.tencent.com/v1") return "hunyuan";
  if (baseURL === "http://localhost:11434/v1" || baseURL === "http://127.0.0.1:11434/v1") return "ollama";
  if (baseURL === "http://localhost:1234/v1" || baseURL === "http://127.0.0.1:1234/v1") return "lm_studio";
  if (profile?.protocol === "anthropic_messages") return "anthropic";
  if (profile?.protocol === "openai_responses") {
    return baseURL === "https://api.openai.com/v1" || baseURL === "https://api.openai.com/v1/responses"
      ? "openai"
      : "openai_responses_compatible";
  }
  return "openai_compatible";
}

function assertRemoteProfileReady(profile, translate) {
  const t = typeof translate === "function" ? translate : (key) => key;
  if (!profileHasUsableAuth(profile)) {
    throw new Error(t("apiKeyMissing"));
  }
  if (!String(profile?.model || "").trim()) {
    throw new Error(t("modelMissing"));
  }
}

function profileMessageMetadata(profile) {
  if (!profile) return {};
  return {
    profileId: profile.id || "",
    profileName: profile.name || "",
    protocol: profile.protocol || "",
    model: profile.model || ""
  };
}

function profileStatusText(profile, translate = (key) => key) {
  const t = typeof translate === "function" ? translate : (key) => key;
  if (!profile) return t("noProfile");
  const isLocalAgent = hasLocalAgentConfig(profile);
  const endpoint = endpointForProfileSafe(profile) || t("profileEndpointMissing");
  const model = String(profile.model || "").trim() || (isLocalAgent ? t("profileModelOptional") : t("profileModelMissing"));
  const parts = [
    `${t("profileProtocolStatus")}: ${profile.protocol || ""}`,
    `${t("profileModelStatus")}: ${model}`,
    `${t("profileEndpointStatus")}: ${endpoint}`,
    canUsePdfBase64Input(profile) ? t("profilePdfReady") : t("profilePdfTextOnly"),
    canUseImageInput(profile) ? t("profileImageReady") : t("profileImageOff"),
    profile?.capabilities?.streaming === true ? t("profileStreamReady") : t("profileStreamOff"),
    profileHasUsableAuth(profile) ? t("profileAuthReady") : t("profileAuthMissing")
  ];
  if (isLocalAgent) parts.push(t("profileLocalAgentReady"));
  return parts.filter(Boolean).join("\n");
}

function renderProviderDiagnosticsMarkdown(profile, options = {}) {
  const labels = providerDiagnosticsLabels(options.outputLanguage);
  const endpoint = endpointForProfileSafe(profile);
  const modelList = providerModelListGuideForWorkbench(profile);
  const provider = workbenchProviderFromProfile(profile, profile?.id || "");
  const defaults = workbenchProviderDefaults(provider);
  const verify = providerLiveVerifyGuideForWorkbench(profile, provider);
  const auth = providerAuthDiagnostics(profile, labels);
  const capabilities = providerCapabilityRows(profile, labels);
  const headerNames = diagnosticHeaderNamesForProfile(profile);
  const previews = providerRequestPreviews(profile, labels);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const statusText = String(options.statusText || profileStatusText(profile)).trim();
  const lines = [
    "---",
    "templateVersion: provider-diagnostics-v1",
    `generatedAt: ${generatedAt}`,
    `profileId: ${yamlScalar(profile?.id || "")}`,
    `providerKey: ${yamlScalar(provider)}`,
    `protocol: ${yamlScalar(profile?.protocol || "")}`,
    `endpoint: ${yamlScalar(endpoint || "")}`,
    `reportPath: ${yamlScalar(options.reportPath || "")}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.profile}: ${mdText(profile?.name || defaults.name || profile?.id || "")}`,
    `- ${labels.profileId}: \`${mdText(profile?.id || "")}\``,
    `- ${labels.providerKey}: \`${mdText(provider)}\``,
    `- ${labels.protocol}: ${providerProtocolDiagnosticLabel(profile?.protocol, labels)}`,
    `- ${labels.baseURL}: ${mdText(profile?.baseURL || defaults.baseURL || labels.notConfigured)}`,
    `- ${labels.endpoint}: ${mdText(endpoint || labels.notConfigured)}`,
    `- ${labels.model}: ${mdText(profile?.model || labels.modelMissing)}`,
    `- ${labels.generatedAt}: ${generatedAt}`,
    "",
    `## ${labels.auth}`,
    "",
    `- ${labels.authConfigured}: ${auth.configured ? labels.yes : labels.no}`,
    `- ${labels.authSource}: ${auth.source}`,
    `- ${labels.authHeaders}: ${headerNames.length ? headerNames.map((name) => `\`${name}\``).join(", ") : labels.none}`,
    `- ${labels.secretPolicy}: ${labels.secretPolicyValue}`,
    "",
    `## ${labels.capabilities}`,
    "",
    `| ${labels.capability} | ${labels.status} |`,
    "| --- | --- |",
    ...capabilities.map((row) => `| ${markdownTableCell(row.label)} | ${row.enabled ? labels.enabled : labels.disabled} |`),
    "",
    `## ${labels.endpoints}`,
    "",
    `- ${labels.requestEndpoint}: ${mdText(endpoint || labels.notConfigured)}`,
    `- ${labels.modelListEndpoint}: ${mdText(modelList || labels.modelListUnavailable)}`,
    `- ${labels.defaultBaseURL}: ${mdText(defaults.baseURL || labels.notConfigured)}`,
    `- ${labels.baseURLDiffers}: ${providerBaseURLDiffersForWorkbench(profile, provider) ? labels.yes : labels.no}`,
    "",
    `## ${labels.requestPreview}`,
    "",
    providerRequestPreviewMarkdown(previews, labels),
    "",
    `## ${labels.liveChecks}`,
    "",
    `### ${labels.envTemplate}`,
    "",
    `\`\`\`bash`,
    verify.envTemplateCommand || labels.notConfigured,
    `\`\`\``,
    "",
    ...(verify.dotenvTemplateCommand ? [
      `### ${labels.dotenvTemplate}`,
      "",
      `\`\`\`bash`,
      verify.dotenvTemplateCommand,
      `\`\`\``,
      ""
    ] : []),
    `### ${labels.doctorCheck}`,
    "",
    `\`\`\`bash`,
    verify.doctorCommand || labels.notConfigured,
    `\`\`\``,
    "",
    `### ${labels.envFileCheck}`,
    "",
    `\`\`\`bash`,
    verify.envFileCommand || labels.notConfigured,
    `\`\`\``,
    "",
    `### ${labels.directLiveCheck}`,
    "",
    `\`\`\`bash`,
    verify.liveCommand || labels.notConfigured,
    `\`\`\``,
    "",
    ...(canUseImageInput(profile) ? [
      `### ${labels.imageLiveCheck}`,
      "",
      `\`\`\`bash`,
      verify.envFileImageCommand || verify.imageCommand || labels.notConfigured,
      `\`\`\``,
      ""
    ] : []),
    ...(verify.imageOverrideCommand ? [
      `### ${labels.imageOverrideLiveCheck}`,
      "",
      `\`\`\`bash`,
      verify.imageOverrideCommand,
      `\`\`\``,
      ""
    ] : []),
    ...(canUsePdfBase64Input(profile) ? [
      `### ${labels.pdfLiveCheck}`,
      "",
      `\`\`\`bash`,
      verify.envFilePdfCommand || verify.pdfCommand || labels.notConfigured,
      `\`\`\``,
      ""
    ] : []),
    ...(verify.pdfOverrideCommand ? [
      `### ${labels.pdfOverrideLiveCheck}`,
      "",
      `\`\`\`bash`,
      verify.pdfOverrideCommand,
      `\`\`\``,
      ""
    ] : []),
    `### ${labels.modelListLiveCheck}`,
    "",
    `\`\`\`bash`,
    verify.envFileModelsCommand || verify.modelsCommand || labels.notConfigured,
    `\`\`\``,
    "",
    `## ${labels.statusSnapshot}`,
    "",
    "```text",
    statusText || labels.none,
    "```",
    "",
    `## ${labels.troubleshooting}`,
    "",
    `- [ ] ${labels.checkModel}`,
    `- [ ] ${labels.checkEndpoint}`,
    `- [ ] ${labels.checkAuth}`,
    `- [ ] ${labels.checkCapabilities}`,
    `- [ ] ${labels.checkLive}`,
    ""
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function providerDiagnosticsLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "模型厂商配置诊断",
      profile: "档案",
      profileId: "档案 ID",
      providerKey: "厂商识别",
      protocol: "协议",
      baseURL: "Base URL",
      endpoint: "请求 endpoint",
      model: "模型",
      generatedAt: "生成时间",
      auth: "认证",
      authConfigured: "认证是否已配置",
      authSource: "认证来源",
      authHeaders: "认证相关 header",
      secretPolicy: "密钥处理",
      secretPolicyValue: "报告只记录认证是否存在和 header 名称，不写入 API key 或自定义 header 值。",
      capabilities: "能力声明",
      capability: "能力",
      status: "状态",
      enabled: "启用",
      disabled: "关闭",
      capText: "文本",
      capImage: "图片输入",
      capPdf: "原始 PDF 输入",
      capStreaming: "流式输出",
      capJson: "JSON 模式",
      capModelList: "模型列表",
      capToolUse: "工具调用",
      endpoints: "端点",
      requestEndpoint: "生成请求 endpoint",
      modelListEndpoint: "模型列表 endpoint",
      defaultBaseURL: "默认 Base URL",
      baseURLDiffers: "是否偏离默认值",
      requestPreview: "脱敏请求预览",
      previewKind: "输入类型",
      previewTopFields: "顶层字段",
      previewBody: "请求体",
      previewUnavailable: "无法生成预览",
      previewText: "文本",
      previewImage: "图片",
      previewPdf: "原始 PDF",
      liveChecks: "终端 live 检查",
      envTemplate: "可复制环境变量模板",
      dotenvTemplate: "生成 .env.local 草稿",
      doctorCheck: ".env.local 配置预检",
      envFileCheck: ".env.local live 检查",
      directLiveCheck: "直接 live 检查",
      imageLiveCheck: "图片 live 检查",
      imageOverrideLiveCheck: "图片能力覆盖 live 检查",
      pdfLiveCheck: "PDF live 检查",
      pdfOverrideLiveCheck: "PDF 能力覆盖 live 检查",
      modelListLiveCheck: "模型列表 live 检查",
      statusSnapshot: "当前状态快照",
      troubleshooting: "排查清单",
      checkModel: "确认模型名称真实存在，必要时先点击“加载模型列表”。",
      checkEndpoint: "确认 Base URL 不重复包含 /chat/completions、/responses、/messages 或 /models。",
      checkAuth: "确认 API key 或自定义认证 header 属于当前厂商。",
      checkCapabilities: "图片/PDF/流式开关要和模型能力一致。",
      checkLive: "在终端运行上面的 live-check 命令，比较报错和工作台报错。",
      notConfigured: "未配置",
      modelMissing: "未填写模型",
      modelListUnavailable: "当前档案不支持或无法推导模型列表 endpoint",
      yes: "是",
      no: "否",
      none: "无",
      localEndpoint: "本地接口，通常不需要 API key",
      localAgent: "本地 agent 桥接服务",
      apiKey: "API key 字段",
      explicitHeader: "自定义认证 header",
      missing: "未配置认证"
    };
  }
  return {
    title: "Provider Configuration Diagnostics",
    profile: "Profile",
    profileId: "Profile ID",
    providerKey: "Provider key",
    protocol: "Protocol",
    baseURL: "Base URL",
    endpoint: "Request endpoint",
    model: "Model",
    generatedAt: "Generated at",
    auth: "Authentication",
    authConfigured: "Authentication configured",
    authSource: "Authentication source",
    authHeaders: "Authentication-related headers",
    secretPolicy: "Secret handling",
    secretPolicyValue: "This report records only whether authentication exists and header names. It does not write API keys or custom header values.",
    capabilities: "Capability Declaration",
    capability: "Capability",
    status: "Status",
    enabled: "enabled",
    disabled: "disabled",
    capText: "text",
    capImage: "image input",
    capPdf: "raw PDF input",
    capStreaming: "streaming",
    capJson: "JSON mode",
    capModelList: "model list",
    capToolUse: "tool use",
    endpoints: "Endpoints",
    requestEndpoint: "Generation request endpoint",
    modelListEndpoint: "Model-list endpoint",
    defaultBaseURL: "Default Base URL",
    baseURLDiffers: "Differs from default",
    requestPreview: "Redacted Request Preview",
    previewKind: "Input type",
    previewTopFields: "Top-level fields",
    previewBody: "Request body",
    previewUnavailable: "Preview unavailable",
    previewText: "text",
    previewImage: "image",
    previewPdf: "raw PDF",
    liveChecks: "Terminal Live Checks",
    envTemplate: "Copyable Env Template",
    dotenvTemplate: "Draft .env.local",
    doctorCheck: ".env.local Configuration Doctor",
    envFileCheck: ".env.local Live Check",
    directLiveCheck: "Direct Live Check",
    imageLiveCheck: "Image Live Check",
    imageOverrideLiveCheck: "Image Capability Override Check",
    pdfLiveCheck: "PDF Live Check",
    pdfOverrideLiveCheck: "PDF Capability Override Check",
    modelListLiveCheck: "Model-list Live Check",
    statusSnapshot: "Current Status Snapshot",
    troubleshooting: "Troubleshooting Checklist",
    checkModel: "Confirm the model name exists. Use Load model list first when available.",
    checkEndpoint: "Confirm the Base URL does not duplicate /chat/completions, /responses, /messages, or /models.",
    checkAuth: "Confirm the API key or custom authentication header belongs to the selected provider.",
    checkCapabilities: "Keep image/PDF/streaming toggles aligned with the model's real capabilities.",
    checkLive: "Run the live-check command in a terminal and compare the error with the workbench error.",
    notConfigured: "not configured",
    modelMissing: "model missing",
    modelListUnavailable: "not available or cannot be inferred for this profile",
    yes: "yes",
    no: "no",
    none: "none",
    localEndpoint: "local endpoint, API key is usually optional",
    localAgent: "local agent bridge service",
    apiKey: "API key field",
    explicitHeader: "custom authentication header",
    missing: "missing authentication"
  };
}

function providerCapabilityRows(profile, labels) {
  const capabilities = profile?.capabilities || {};
  return [
    { label: labels.capText, enabled: capabilities.text !== false },
    { label: labels.capImage, enabled: canUseImageInput(profile) },
    { label: labels.capPdf, enabled: canUsePdfBase64Input(profile) },
    { label: labels.capStreaming, enabled: capabilities.streaming === true },
    { label: labels.capJson, enabled: capabilities.jsonMode === true },
    { label: labels.capModelList, enabled: capabilities.modelList !== false },
    { label: labels.capToolUse, enabled: capabilities.toolUse === true }
  ];
}

function providerRequestPreviews(profile, labels = providerDiagnosticsLabels()) {
  const inputs = [
    { kind: labels.previewText, requestInput: {} }
  ];
  if (canUseImageInput(profile)) {
    inputs.push({
      kind: labels.previewImage,
      requestInput: {
        source: "image_attachment",
        images: [{ name: "diagnostic.png", mimeType: "image/png", base64: "aW1hZ2U=" }]
      }
    });
  }
  if (canUsePdfBase64Input(profile)) {
    inputs.push({
      kind: labels.previewPdf,
      requestInput: {
        type: "pdf_base64",
        source: "pdf_base64",
        filename: "diagnostic.pdf",
        base64: "JVBERi0="
      }
    });
  }
  return inputs.map((entry) => {
    try {
      const body = bodyForProfile(profile, [{ role: "user", content: "Diagnostic request preview." }], "en-US", "Diagnostic system prompt.", entry.requestInput, false);
      return {
        kind: entry.kind,
        ok: true,
        topFields: Object.keys(body || {}).sort(),
        body: sanitizeProviderRequestPreview(body)
      };
    } catch (err) {
      return {
        kind: entry.kind,
        ok: false,
        topFields: [],
        error: safeError(err)
      };
    }
  });
}

function providerRequestPreviewMarkdown(previews, labels) {
  const sections = [];
  for (const preview of previews || []) {
    sections.push(`### ${preview.kind}`);
    if (!preview.ok) {
      sections.push("", `- ${labels.previewUnavailable}: ${mdText(preview.error || "")}`, "");
      continue;
    }
    sections.push(
      "",
      `- ${labels.previewTopFields}: ${preview.topFields.map((field) => `\`${field}\``).join(", ") || labels.none}`,
      "",
      "```json",
      JSON.stringify(preview.body, null, 2),
      "```",
      ""
    );
  }
  return sections.length ? sections.join("\n").trim() : `- ${labels.previewUnavailable}`;
}

function sanitizeProviderRequestPreview(value, key = "") {
  const normalizedKey = String(key || "").toLowerCase();
  if (isSensitivePreviewKey(normalizedKey)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => sanitizeProviderRequestPreview(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeProviderRequestPreview(entryValue, entryKey)]));
  }
  if (typeof value === "string") {
    if (/^data:image\/[^;]+;base64,/i.test(value)) return value.replace(/;base64,.+$/i, ";base64,[omitted]");
    if (/^data:application\/pdf;base64,/i.test(value)) return "data:application/pdf;base64,[omitted]";
    if (normalizedKey === "base64" || normalizedKey === "file_data" || normalizedKey === "data") return "[omitted]";
    return redact(value);
  }
  return value;
}

function isSensitivePreviewKey(key) {
  return /api[_-]?key|secret|token|password|authorization|x-api-key|bearer/i.test(String(key || ""));
}

function providerAuthDiagnostics(profile, labels = providerDiagnosticsLabels()) {
  if (isLocalAgentProfile(profile)) return { configured: true, source: labels.localAgent };
  const endpoint = endpointForProfileSafe(profile);
  if (isLocalEndpoint(endpoint)) return { configured: true, source: labels.localEndpoint };
  if (String(profile?.apiKey || "").trim()) return { configured: true, source: labels.apiKey };
  if (hasExplicitAuthHeader(profile?.customHeaders || {})) return { configured: true, source: labels.explicitHeader };
  return { configured: false, source: labels.missing };
}

function diagnosticHeaderNamesForProfile(profile) {
  try {
    return Object.keys(headersForProfile(profile || {}))
      .filter((name) => /authorization|api-key|x-api-key|anthropic-version|anthropic-dangerous-direct-browser-access/i.test(name))
      .sort((a, b) => a.localeCompare(b));
  } catch (_err) {
    return [];
  }
}

function providerProtocolDiagnosticLabel(protocol, labels) {
  if (protocol === "openai_responses") return "OpenAI Responses";
  if (protocol === "anthropic_messages") return "Anthropic Messages";
  if (protocol === "openai_chat") return "OpenAI Chat Completions";
  return mdText(protocol || labels.notConfigured);
}

function providerModelListGuideForWorkbench(profile) {
  try {
    const request = workbenchModelListRequestForProfile(profile);
    return request?.url || "";
  } catch (_err) {
    return "";
  }
}

function providerLiveVerifyGuideForWorkbench(profile, provider = workbenchProviderFromProfile(profile, profile?.id || "")) {
  if (isLocalAgentProfile(profile)) {
    return {
      include: "local-agents",
      envTemplateCommand: "npm run local-agent:service:doctor",
      dotenvTemplateCommand: "",
      doctorCommand: "npm run local-agent:service:doctor",
      envFileCommand: "npm run local-agent:service:check",
      liveCommand: "npm run local-agent:service:check",
      imageCommand: "",
      pdfCommand: "",
      modelsCommand: "npm run local-agent:service:doctor",
      envFileImageCommand: "",
      envFilePdfCommand: "",
      envFileModelsCommand: "npm run local-agent:service:doctor",
      imageOverrideCommand: "",
      pdfOverrideCommand: ""
    };
  }
  const entry = providerLiveVerifyCaseForWorkbench(profile, provider);
  const baseURL = String(profile?.baseURL || workbenchProviderDefaults(provider).baseURL || "").trim();
  const model = String(profile?.model || "").trim();
  const assignments = [];
  if (!entry.apiKeyOptional) assignments.push(`${entry.apiKeyEnv}=...`);
  if (entry.modelEnv) assignments.push(`${entry.modelEnv}=${providerGuideEnvValue(model || "...")}`);
  if (entry.baseURLEnv && entry.includeBaseURL) assignments.push(`${entry.baseURLEnv}=${providerGuideEnvValue(baseURL || "...")}`);
  const livePrefix = assignments.join(" ");
  const modelAssignments = assignments.filter((item) => !entry.modelEnv || !item.startsWith(`${entry.modelEnv}=`));
  const modelPrefix = modelAssignments.join(" ");
  const overrideCommands = providerCapabilityOverrideCommandsForWorkbench(profile, provider, entry, livePrefix);
  return {
    ...entry,
    envTemplateCommand: `npm run verify:provider:live -- --env-template --include ${entry.include}`,
    dotenvTemplateCommand: `npm run verify:provider:live -- --env-template --dotenv-template --include ${entry.include} > .env.local`,
    doctorCommand: `npm run verify:provider:live -- --doctor --include ${entry.include} --provider-env-file .env.local`,
    envFileCommand: `npm run verify:provider:live -- --include ${entry.include} --provider-env-file .env.local`,
    liveCommand: `${livePrefix ? `${livePrefix} ` : ""}npm run verify:provider:live -- --include ${entry.include}`,
    imageCommand: canUseImageInput(profile) ? `${livePrefix ? `${livePrefix} ` : ""}npm run verify:provider:image:live -- --include ${entry.include}` : "",
    pdfCommand: canUsePdfBase64Input(profile) ? `${livePrefix ? `${livePrefix} ` : ""}npm run verify:provider:pdf:live -- --include ${entry.include}` : "",
    modelsCommand: `${modelPrefix ? `${modelPrefix} ` : ""}npm run verify:provider:models:live -- --include ${entry.include}`,
    envFileImageCommand: canUseImageInput(profile) ? `npm run verify:provider:image:live -- --include ${entry.include} --provider-env-file .env.local` : "",
    envFilePdfCommand: canUsePdfBase64Input(profile) ? `npm run verify:provider:pdf:live -- --include ${entry.include} --provider-env-file .env.local` : "",
    envFileModelsCommand: `npm run verify:provider:models:live -- --include ${entry.include} --provider-env-file .env.local`,
    ...overrideCommands
  };
}

function providerCapabilityOverrideCommandsForWorkbench(profile, provider, entry, prefix) {
  if (!shouldShowCapabilityOverrideGuideForWorkbench(profile, provider)) return {};
  const envName = providerCapabilitiesEnvNameForWorkbench(entry);
  const imagePrefix = [prefix, `${envName}='${JSON.stringify({ imageBase64: true })}'`].filter(Boolean).join(" ");
  const pdfPrefix = [prefix, `${envName}='${JSON.stringify({ pdfBase64: true })}'`].filter(Boolean).join(" ");
  return {
    capabilitiesEnv: envName,
    imageOverrideCommand: canUseImageInput(profile)
      ? ""
      : `${imagePrefix} npm run verify:provider:image:live -- --include ${entry.include}`,
    pdfOverrideCommand: canUsePdfBase64Input(profile) || profile?.protocol === "openai_chat"
      ? ""
      : `${pdfPrefix} npm run verify:provider:pdf:live -- --include ${entry.include}`
  };
}

function shouldShowCapabilityOverrideGuideForWorkbench(profile, provider) {
  const key = String(provider || "").replace(/-/g, "_");
  if (["openai_compatible", "openai_responses_compatible", "anthropic_compatible"].includes(key)) return true;
  if (profile?.endpointMode === "full_url") return true;
  return providerBaseURLDiffersForWorkbench(profile, provider);
}

function providerCapabilitiesEnvNameForWorkbench(entry) {
  const key = String(entry?.apiKeyEnv || "").replace(/_API_KEY$/, "");
  if (key) return `${key}_CAPABILITIES_JSON`;
  return `${String(entry?.include || "PROVIDER").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CAPABILITIES_JSON`;
}

function providerLiveVerifyCaseForWorkbench(profile, provider = workbenchProviderFromProfile(profile, profile?.id || "")) {
  const endpoint = endpointForProfileSafe(profile);
  const apiKeyOptional = isLocalEndpoint(endpoint);
  const includeBaseURL = providerBaseURLDiffersForWorkbench(profile, provider);
  const cases = {
    openai: ["openai", "OPENAI"],
    openai_compatible: ["openai-compatible", "OPENAI_COMPATIBLE", true],
    "openai-compatible": ["openai-compatible", "OPENAI_COMPATIBLE", true],
    openai_responses_compatible: ["openai-responses-compatible", "OPENAI_RESPONSES_COMPATIBLE", true],
    "openai-responses-compatible": ["openai-responses-compatible", "OPENAI_RESPONSES_COMPATIBLE", true],
    anthropic: ["anthropic", "ANTHROPIC"],
    anthropic_compatible: ["anthropic-compatible", "ANTHROPIC_COMPATIBLE", true],
    "anthropic-compatible": ["anthropic-compatible", "ANTHROPIC_COMPATIBLE", true],
    minimax: ["minimax", "MINIMAX"],
    gemini: ["gemini", "GEMINI"],
    azure_openai: ["azure-openai", "AZURE_OPENAI", true],
    "azure-openai": ["azure-openai", "AZURE_OPENAI", true],
    vercel_ai_chat: ["vercel-ai-chat", "VERCEL_AI"],
    "vercel-ai-chat": ["vercel-ai-chat", "VERCEL_AI"],
    vercel_ai_gateway: ["vercel-ai-chat", "VERCEL_AI"],
    "vercel-ai-gateway": ["vercel-ai-chat", "VERCEL_AI"],
    vercel_ai_responses: ["vercel-ai-responses", "VERCEL_AI_RESPONSES"],
    "vercel-ai-responses": ["vercel-ai-responses", "VERCEL_AI_RESPONSES"],
    vercel_ai_anthropic: ["vercel-ai-anthropic", "VERCEL_AI_ANTHROPIC"],
    "vercel-ai-anthropic": ["vercel-ai-anthropic", "VERCEL_AI_ANTHROPIC"],
    cline_api: ["cline-api", "CLINE"],
    "cline-api": ["cline-api", "CLINE"],
    litellm_proxy_chat: ["litellm-proxy-chat", "LITELLM_PROXY", true],
    "litellm-proxy-chat": ["litellm-proxy-chat", "LITELLM_PROXY", true],
    litellm_proxy_responses: ["litellm-proxy-responses", "LITELLM_PROXY_RESPONSES", true],
    "litellm-proxy-responses": ["litellm-proxy-responses", "LITELLM_PROXY_RESPONSES", true],
    litellm_proxy_anthropic: ["litellm-proxy-anthropic", "LITELLM_PROXY_ANTHROPIC", true],
    "litellm-proxy-anthropic": ["litellm-proxy-anthropic", "LITELLM_PROXY_ANTHROPIC", true],
    cloudflare_ai_chat: ["cloudflare-ai-chat", "CLOUDFLARE", true],
    "cloudflare-ai-chat": ["cloudflare-ai-chat", "CLOUDFLARE", true],
    cloudflare_workers_ai: ["cloudflare-ai-chat", "CLOUDFLARE", true],
    "cloudflare-workers-ai": ["cloudflare-ai-chat", "CLOUDFLARE", true],
    cloudflare_ai_responses: ["cloudflare-ai-responses", "CLOUDFLARE_RESPONSES", true],
    "cloudflare-ai-responses": ["cloudflare-ai-responses", "CLOUDFLARE_RESPONSES", true],
    cloudflare_ai_anthropic: ["cloudflare-ai-anthropic", "CLOUDFLARE_ANTHROPIC", true],
    "cloudflare-ai-anthropic": ["cloudflare-ai-anthropic", "CLOUDFLARE_ANTHROPIC", true],
    github_models: ["github-models", "GITHUB_MODELS"],
    "github-models": ["github-models", "GITHUB_MODELS"],
    huggingface: ["huggingface", "HUGGINGFACE"],
    hugging_face: ["huggingface", "HUGGINGFACE"],
    hf: ["huggingface", "HUGGINGFACE"],
    deepinfra: ["deepinfra", "DEEPINFRA"],
    deep_infra: ["deepinfra", "DEEPINFRA"],
    fireworks: ["fireworks", "FIREWORKS"],
    cerebras: ["cerebras", "CEREBRAS"],
    nvidia_nim: ["nvidia-nim", "NVIDIA_NIM"],
    "nvidia-nim": ["nvidia-nim", "NVIDIA_NIM"],
    sambanova: ["sambanova", "SAMBANOVA"],
    sambanova_responses: ["sambanova-responses", "SAMBANOVA_RESPONSES"],
    "sambanova-responses": ["sambanova-responses", "SAMBANOVA_RESPONSES"],
    sambanova_anthropic: ["sambanova-anthropic", "SAMBANOVA_ANTHROPIC"],
    "sambanova-anthropic": ["sambanova-anthropic", "SAMBANOVA_ANTHROPIC"],
    xai: ["xai", "XAI"],
    groq: ["groq", "GROQ"],
    mistral: ["mistral", "MISTRAL"],
    together: ["together", "TOGETHER"],
    kimi: ["kimi", "KIMI"],
    perplexity: ["perplexity", "PERPLEXITY"],
    deepseek: ["deepseek", "DEEPSEEK"],
    deepseek_anthropic: ["deepseek-anthropic", "DEEPSEEK_ANTHROPIC"],
    "deepseek-anthropic": ["deepseek-anthropic", "DEEPSEEK_ANTHROPIC"],
    zai_anthropic: ["zai-anthropic", "ZAI_ANTHROPIC"],
    "zai-anthropic": ["zai-anthropic", "ZAI_ANTHROPIC"],
    openrouter: ["openrouter", "OPENROUTER"],
    dashscope: ["dashscope", "DASHSCOPE"],
    siliconflow: ["siliconflow", "SILICONFLOW"],
    zhipu: ["zhipu", "ZHIPU"],
    volcengine: ["volcengine", "VOLCENGINE"],
    qianfan: ["qianfan", "QIANFAN"],
    hunyuan: ["hunyuan", "HUNYUAN"],
    ollama: ["ollama", "OLLAMA", true],
    lm_studio: ["lm-studio", "LM_STUDIO", true],
    "lm-studio": ["lm-studio", "LM_STUDIO", true]
  };
  const fallback = profile?.protocol === "anthropic_messages"
    ? ["anthropic-compatible", "ANTHROPIC_COMPATIBLE", true]
    : profile?.protocol === "openai_responses"
      ? ["openai-responses-compatible", "OPENAI_RESPONSES_COMPATIBLE", true]
      : ["openai-compatible", "OPENAI_COMPATIBLE", true];
  const [include, envPrefix, alwaysIncludeBaseURL] = cases[provider] || fallback;
  return {
    include,
    apiKeyEnv: `${envPrefix}_API_KEY`,
    modelEnv: `${envPrefix}_MODEL`,
    baseURLEnv: `${envPrefix}_BASE_URL`,
    includeBaseURL: !!alwaysIncludeBaseURL || includeBaseURL,
    apiKeyOptional
  };
}

function applyProviderEnvTextToProfileForWorkbench(profile, raw, provider = workbenchProviderFromProfile(profile, profile?.id || "")) {
  const env = parseProviderEnvTextForWorkbench(raw);
  const next = hydrateProfile(profile || {});
  const entry = providerLiveVerifyCaseForWorkbench(next, provider);
  const changed = [];
  const apiKey = providerEnvFirstValueForWorkbench(env, providerEnvCandidateNamesForWorkbench(entry, provider, "apiKey"));
  const model = providerEnvFirstValueForWorkbench(env, providerEnvCandidateNamesForWorkbench(entry, provider, "model"));
  const baseURL = providerEnvFirstValueForWorkbench(env, providerEnvCandidateNamesForWorkbench(entry, provider, "baseURL"));
  const capabilities = providerEnvJSONValueForWorkbench(env, providerEnvCandidateNamesForWorkbench(entry, provider, "capabilities"));
  const headers = providerEnvJSONValueForWorkbench(env, providerEnvCandidateNamesForWorkbench(entry, provider, "headers"));
  const bodyExtra = providerEnvJSONValueForWorkbench(env, providerEnvCandidateNamesForWorkbench(entry, provider, "bodyExtra"));

  if (apiKey !== undefined) {
    next.apiKey = apiKey;
    changed.push("apiKey");
  }
  if (model !== undefined) {
    next.model = model;
    changed.push("model");
  }
  if (baseURL !== undefined) {
    next.baseURL = baseURL;
    changed.push("baseURL");
  }
  if (capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)) {
    next.capabilities = normalizeProviderCapabilities({ ...(next.capabilities || {}), ...capabilities }, next.capabilities || {});
    changed.push("capabilities");
  }
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    next.customHeaders = normalizeObjectStringMap({ ...(next.customHeaders || {}), ...headers }) || {};
    changed.push("customHeaders");
  }
  if (bodyExtra && typeof bodyExtra === "object" && !Array.isArray(bodyExtra)) {
    next.bodyExtra = normalizeObjectStringMap({ ...(next.bodyExtra || {}), ...bodyExtra }) || {};
    changed.push("bodyExtra");
  }

  return { profile: hydrateProfile(next), changed, env };
}

function parseProviderEnvTextForWorkbench(raw) {
  const env = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const parsed = parseProviderEnvLineForWorkbench(line);
    if (parsed) env[parsed.key] = parsed.value;
  }
  return env;
}

function parseProviderEnvLineForWorkbench(line) {
  let text = String(line || "").trim();
  if (!text || text.startsWith("#")) return null;
  text = text.replace(/^export\s+/i, "").trim();
  const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
  if (!match) return null;
  return { key: match[1], value: normalizeProviderEnvValueForWorkbench(match[2]) };
}

function normalizeProviderEnvValueForWorkbench(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  const quote = text[0];
  if ((quote === "\"" || quote === "'") && text.length >= 2) {
    const end = findProviderEnvQuoteEndForWorkbench(text, quote);
    if (end > 0) return unquoteProviderEnvValueForWorkbench(text.slice(0, end + 1));
  }
  text = text.replace(/\s+#.*$/, "").trim();
  return unquoteProviderEnvValueForWorkbench(text);
}

function findProviderEnvQuoteEndForWorkbench(text, quote) {
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] !== quote) continue;
    if (quote === "\"" && text[index - 1] === "\\") continue;
    return index;
  }
  return -1;
}

function unquoteProviderEnvValueForWorkbench(value) {
  const text = String(value || "").trim();
  if (text.length < 2) return text;
  const quote = text[0];
  if ((quote !== "\"" && quote !== "'") || text[text.length - 1] !== quote) return text;
  const inner = text.slice(1, -1);
  if (quote === "'") return inner;
  try {
    return JSON.parse(text);
  } catch (_err) {
    return inner.replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
}

function providerEnvFirstValueForWorkbench(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (providerEnvValueUsableForWorkbench(value)) return String(value).trim();
  }
  return undefined;
}

function providerEnvJSONValueForWorkbench(env, names) {
  const value = providerEnvFirstValueForWorkbench(env, names);
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function providerEnvValueUsableForWorkbench(value) {
  const text = String(value ?? "").trim();
  return !!text && text !== "..." && !/^YOUR[_-]/i.test(text);
}

function providerEnvCandidateNamesForWorkbench(entry, provider, field) {
  const prefix = String(entry?.apiKeyEnv || "").replace(/_API_KEY$/, "");
  const aliases = providerEnvAliasesForWorkbench(provider, prefix);
  if (field === "apiKey") return providerEnvUniqueNamesForWorkbench(entry?.apiKeyEnv, `${prefix}_KEY`, ...aliases.apiKey, "API_KEY");
  if (field === "model") return providerEnvUniqueNamesForWorkbench(entry?.modelEnv, `${prefix}_MODEL`, ...aliases.model, "MODEL");
  if (field === "baseURL") return providerEnvUniqueNamesForWorkbench(entry?.baseURLEnv, `${prefix}_BASE_URL`, `${prefix}_ENDPOINT`, ...aliases.baseURL, "BASE_URL", "ENDPOINT");
  if (field === "capabilities") return providerEnvUniqueNamesForWorkbench(providerCapabilitiesEnvNameForWorkbench(entry), `${prefix}_CAPABILITIES_JSON`, "CAPABILITIES_JSON");
  if (field === "headers") return providerEnvUniqueNamesForWorkbench(`${prefix}_HEADERS_JSON`, `${prefix}_CUSTOM_HEADERS_JSON`, "HEADERS_JSON", "CUSTOM_HEADERS_JSON");
  if (field === "bodyExtra") return providerEnvUniqueNamesForWorkbench(`${prefix}_BODY_EXTRA_JSON`, `${prefix}_EXTRA_BODY_JSON`, "BODY_EXTRA_JSON", "EXTRA_BODY_JSON");
  return [];
}

function providerEnvAliasesForWorkbench(provider, prefix) {
  const key = String(provider || "").replace(/-/g, "_");
  const aliases = { apiKey: [], model: [], baseURL: [] };
  if (key.includes("vercel_ai")) {
    aliases.apiKey.push("AI_GATEWAY_API_KEY", "VERCEL_API_KEY");
    aliases.model.push("AI_GATEWAY_MODEL");
    aliases.baseURL.push("AI_GATEWAY_BASE_URL");
  }
  if (key === "gemini") {
    aliases.apiKey.push("GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY");
    aliases.model.push("GOOGLE_MODEL", "GOOGLE_GENERATIVE_AI_MODEL");
    aliases.baseURL.push("GOOGLE_BASE_URL", "GOOGLE_GENERATIVE_AI_BASE_URL");
  }
  if (key === "azure_openai") {
    aliases.baseURL.push("AZURE_OPENAI_ENDPOINT");
  }
  if (key === "cline_api") {
    aliases.apiKey.push("CLINE_BOT_API_KEY");
    aliases.model.push("CLINE_API_MODEL");
    aliases.baseURL.push("CLINE_API_BASE_URL", "CLINE_ENDPOINT");
  }
  if (key === "litellm_proxy_chat" || key === "litellm_proxy_responses" || key === "litellm_proxy_anthropic") {
    aliases.apiKey.push("LITELLM_API_KEY", "LITELLM_PROXY_KEY", "LITELLM_MASTER_KEY");
    aliases.model.push("LITELLM_MODEL");
    aliases.baseURL.push("LITELLM_BASE_URL", "LITELLM_PROXY_URL", "LITELLM_ENDPOINT");
  }
  if (key === "cloudflare_ai_chat" || key === "cloudflare_ai_responses" || key === "cloudflare_ai_anthropic") {
    aliases.apiKey.push("CLOUDFLARE_API_TOKEN");
  }
  if (key === "openai_compatible" || key === "openai_responses_compatible") {
    aliases.apiKey.push("OPENAI_API_KEY");
    aliases.model.push("OPENAI_MODEL");
    aliases.baseURL.push("OPENAI_BASE_URL");
  }
  if (key === "anthropic_compatible") {
    aliases.apiKey.push("ANTHROPIC_API_KEY");
    aliases.model.push("ANTHROPIC_MODEL");
    aliases.baseURL.push("ANTHROPIC_BASE_URL");
  }
  if (prefix && prefix !== "OPENAI") aliases.apiKey.push(`${prefix}_TOKEN`);
  return aliases;
}

function providerEnvUniqueNamesForWorkbench(...names) {
  return Array.from(new Set(names.map((name) => String(name || "").trim()).filter(Boolean)));
}

function providerBaseURLDiffersForWorkbench(profile, provider = workbenchProviderFromProfile(profile, profile?.id || "")) {
  const current = String(profile?.baseURL || "").trim().replace(/\/+$/, "");
  const defaults = workbenchProviderDefaults(provider);
  const fallback = String(defaults?.baseURL || "").trim().replace(/\/+$/, "");
  if (!current) return false;
  if (!fallback || /^https:\/\/YOUR-/i.test(fallback)) return true;
  return current !== fallback;
}

function providerGuideEnvValue(value) {
  const text = String(value || "").trim();
  if (!text) return "...";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function endpointForProfileSafe(profile) {
  try {
    return endpointForProfile(profile);
  } catch (_err) {
    return "";
  }
}

function hasLocalAgentConfig(profile) {
  return !!(profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent);
}

function isLocalAgentProfile(profile) {
  return hasLocalAgentConfig(profile);
}

function localAgentConfig(profile, skillId) {
  if (!isLocalAgentSkill(profile, skillId)) return null;
  const localAgentRaw = profile.bodyExtra?.localAgent || profile.bodyExtra?.agent || profile.bodyExtra?.subagent;
  if (localAgentRaw && typeof localAgentRaw === "object" && !Array.isArray(localAgentRaw) && localAgentRaw.enabled === false) return null;
  const localAgent = normalizeLocalAgentConfig(localAgentRaw, skillId);
  if (!localAgent) return null;
  const endpoint = normalizeLocalAgentEndpoint(localAgent.endpoint || localAgent.url || localAgent.mcpUrl || localAgent.baseUrl);
  if (!endpoint) return null;
  const explicitTool = inferLocalAgentTool(localAgentRaw, skillId);
  const tool = normalizeLocalAgentToolName(explicitTool || localAgent.tool || localAgent.toolName || localAgent.tool_id, skillId);
  const timeout = resolveLocalAgentTimeoutMs(localAgent, 180000);
  const fallbackToRemote = localAgent.fallbackToRemote === true;
  const callArgs = localAgentCallArgs(localAgent);
  return {
    endpoint,
    tool,
    timeoutMs: timeout,
    timeoutSeconds: Math.max(1, Math.ceil(timeout / 1000)),
    model: localAgent.model || profile?.model,
    headers: localAgent.headers,
    payloadMode: normalizeLocalAgentPayloadMode(localAgent.payloadMode || localAgent.protocol),
    ...(localAgent.method ? { method: localAgent.method } : {}),
    ...(localAgent.cwd ? { cwd: localAgent.cwd } : {}),
    ...(localAgent.workdir ? { workdir: localAgent.workdir } : {}),
    ...(localAgent.workingDirectory ? { workingDirectory: localAgent.workingDirectory } : {}),
    ...(localAgent.working_directory ? { working_directory: localAgent.working_directory } : {}),
    fallbackToRemote,
    ...(callArgs && Object.keys(callArgs).length ? { args: callArgs } : {})
  };
}

function resolveLocalAgentTimeoutMs(localAgent, fallbackMs = 180000) {
  const timeoutMs = toFinitePositiveInt(
    localAgent.timeoutMs,
    localAgent.timeout_ms
  );
  if (timeoutMs) return timeoutMs;
  const timeoutSeconds = toFinitePositiveInt(
    localAgent.timeoutSeconds,
    localAgent.timeoutSec,
    localAgent.timeout_seconds
  );
  if (timeoutSeconds) return timeoutSeconds * 1000;
  const timeout = toFinitePositiveInt(localAgent.timeout);
  if (!timeout) return fallbackMs;
  return timeout <= 1200 ? timeout * 1000 : timeout;
}

function localAgentPlan(profile, skillId) {
  const raw = profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent;
  if (!raw) return [];
  const shouldMergeSubagents = LOCAL_AGENT_AGGREGATE_SKILLS.includes(skillId);
  if (!shouldMergeSubagents) {
    const localAgent = localAgentConfig(profile, skillId);
    return localAgent ? [{ ...localAgent, skillId }] : [];
  }
  const hasAnySubagentConfig = LOCAL_AGENT_SUBSKILLS.some((subSkillId) => hasLocalAgentSkillConfig(raw, subSkillId));
  const hasAggregatorConfig = hasLocalAgentSkillConfig(raw, skillId);
  const defaultAgent = localAgentConfig(profile, skillId);
  if (!hasAnySubagentConfig && !hasAggregatorConfig) {
    const fallbackAgents = [];
    const seen = new Set();
    for (const subSkillId of LOCAL_AGENT_SUBSKILLS) {
      const localAgent = localAgentConfig(profile, subSkillId);
      if (!localAgent) continue;
      const key = `${localAgent.endpoint}::${localAgent.tool || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fallbackAgents.push({
        ...localAgent,
        skillId: subSkillId,
        fallbackToRemote: localAgent.fallbackToRemote === true
      });
    }
    if (fallbackAgents.length) return fallbackAgents;
  }
  if (hasAggregatorConfig && defaultAgent) {
    return [{ ...defaultAgent, skillId }];
  }
  const agents = [];
  const seen = new Set();
  for (const subSkillId of LOCAL_AGENT_SUBSKILLS) {
    const localAgent = localAgentConfig(profile, subSkillId);
    if (!localAgent) continue;
    const key = `${localAgent.endpoint}::${localAgent.tool || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    agents.push({
      ...localAgent,
      skillId: subSkillId,
      fallbackToRemote: localAgent.fallbackToRemote === true
    });
  }
  if (!agents.length && defaultAgent) {
    return [{ ...defaultAgent, skillId }];
  }
  return agents;
}

async function callLocalAgents(agents, request) {
  const results = await Promise.allSettled(agents.map((agent) => callLocalAgent(agent, request)));
  const labelFor = request.labelFor || ((entry) => entry.skillId);
  const mergeAsMulti = request.mergeAsMulti || false;
  let lastError = null;
  const parts = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const current = agents[index];
    if (result.status === "fulfilled") {
      const text = String(result.value || "").trim();
      if (!text) continue;
      parts.push({
        kind: "text",
        title: labelFor(current),
        text
      });
      continue;
    }
    lastError = lastError || result.reason;
    const failureText = request.formatFailure ? request.formatFailure(current.skillId, result.reason) : `Local agent call failed: ${safeError(result.reason)}`;
    parts.push({
      kind: "error",
      title: labelFor(current),
      text: failureText
    });
  }
  const successParts = parts.filter((part) => part.kind === "text" && part.text);
  const textParts = parts.filter((part) => part.text);
  if (!successParts.length) {
    throw lastError || new Error(request.noResponseMessage || "No local agent output returned");
  }
  if (!mergeAsMulti || successParts.length === 1) {
    return successParts[0].text;
  }
  return textParts.map((part) => `## ${part.title}\n\n${part.text}`).join("\n\n");
}

function isLocalAgentSkill(profile, skillId) {
  const localAgentRaw = profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent;
  if (!localAgentRaw) return false;
  if (typeof localAgentRaw === "string") {
    return isKnownLocalSkillId(skillId);
  }
  if (typeof localAgentRaw === "object" && !Array.isArray(localAgentRaw) && localAgentRaw.enabled === false) return false;
  return isKnownLocalSkillId(skillId) || hasLocalAgentSkillConfig(localAgentRaw, skillId);
}

function isKnownLocalSkillId(skillId) {
  const normalized = String(skillId || "");
  return LOCAL_AGENT_SUBSKILLS.includes(normalized) || LOCAL_AGENT_AGGREGATE_SKILLS.includes(normalized);
}

function inferLocalAgentTool(rawConfig, skillId) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) return "";
  if (rawConfig.enabled === false) return "";
  const candidate = pickSkillLocalAgentConfig(rawConfig, String(skillId));
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return "";
  if (typeof candidate.tool === "string" && candidate.tool.trim()) return candidate.tool.trim();
  if (typeof candidate.toolName === "string" && candidate.toolName.trim()) return candidate.toolName.trim();
  if (typeof candidate.tool_id === "string" && candidate.tool_id.trim()) return candidate.tool_id.trim();
  return "";
}

function hasLocalAgentSkillConfig(raw, skillId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const snakeSkillId = toSnakeCase(skillId);
  const toolName = LOCAL_AGENT_SKILLS[skillId];
  const keys = [skillId, snakeSkillId];
  if (toolName) {
    keys.push(toolIdToDash(toolName), `${toolName}`, `${toolName}_config`);
  }
  keys.push(`${snakeSkillId}-config`, `${skillId}-config`);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
}

function normalizeLocalAgentToolName(value, fallbackSkillId = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return LOCAL_AGENT_SKILLS[fallbackSkillId] || fallbackSkillId || "";
  const camelSeparated = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (LOCAL_AGENT_TOOL_NAMES.has(camelSeparated)) return camelSeparated;
  const compact = camelSeparated.replace(/_/g, "");
  for (const toolName of LOCAL_AGENT_TOOL_NAMES) {
    if (toolName.replace(/_/g, "") === compact) {
      return toolName;
    }
  }
  return camelSeparated;
}

function toolIdToDash(toolId) {
  return String(toolId || "").replace(/_/g, "-");
}

function normalizeLocalAgentEndpoint(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:localhost|127\.0\.0\.1):\d+(?:\/|$)/.test(value)) return `http://${value}`;
  if (value.startsWith("/")) return value;
  return "";
}

async function callLocalAgent(localAgent, request) {
  const timeoutSeconds = toFinitePositiveInt(request.timeoutSeconds, localAgent.timeoutSeconds);
  const normalizedLocalAgent = {
    ...localAgent,
    tool: normalizeLocalAgentToolName(localAgent.tool || "", request.skillId),
    model: localAgent.model || request.model,
    timeoutSeconds
  };
  const payload = buildLocalAgentRequestPayload(normalizedLocalAgent, request);
  const payloadModes = localAgentPayloadModes(localAgent.payloadMode);
  const [signal, clearTimeout] = createAbortController(request.signal, localAgent.timeoutMs);
  let lastError = null;
  try {
    for (const payloadMode of payloadModes) {
      const requestBody = localAgentRequestBody(localAgent, payload, payloadMode);
      try {
        const response = await fetch(localAgent.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...normalizeObjectStringMap(localAgent.headers)
          },
          body: JSON.stringify(requestBody),
          signal
        });
        const rawText = await response.text();
        if (!response.ok) {
          throw new Error(`Local agent HTTP ${response.status}: ${redact(rawText)}`);
        }
        const content = extractLocalAgentContent(rawText, request.skillId, localAgent.tool);
        if (content) return content;
        throw new Error("Local agent returned no content");
      } catch (err) {
        lastError = err;
        if (err?.name === "AbortError") throw err;
        if (payloadModes.length > 1) continue;
        throw err;
      }
    }
    if (lastError) throw lastError;
    return "";
  } finally {
    clearTimeout();
  }
}

function buildLocalAgentRequestPayload(localAgent, request) {
  const timeoutSeconds = toFinitePositiveInt(localAgent.timeoutSeconds, request.timeoutSeconds);
  const tool = normalizeLocalAgentToolName(localAgent.tool, request.skillId);
  const requestArgs = normalizeObjectStringMap(request.args);
  const configArgs = normalizeObjectStringMap(localAgent.args);
  const cwd = request.cwd || localAgent.cwd || localAgent.workingDirectory || localAgent.workdir || localAgent.working_directory || "";
  const basePayload = {
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
    ...configArgs,
    ...requestArgs,
    ...localAgent.model ? { model: localAgent.model } : {},
    ...(tool && tool === "check_local_agents" ? { tool } : {})
  };
  if (tool === "check_local_agents") {
    const { prompt: _prompt, cwd: _cwd, model: _model, ...checkPayload } = basePayload;
    return {
      ...(tool ? { tool } : {}),
      ...checkPayload
    };
  }
  return {
    ...basePayload,
    ...(tool ? { tool: tool } : {}),
    prompt: request.prompt,
    cwd
  };
}

function localAgentPayloadModes(payloadMode) {
  const normalizedPayloadMode = normalizeLocalAgentPayloadMode(payloadMode);
  const fallbackMode = normalizedPayloadMode === "simple" ? "jsonrpc" : "simple";
  const modes = [normalizedPayloadMode];
  if (fallbackMode !== normalizedPayloadMode) {
    modes.push(fallbackMode);
  }
  return modes;
}

function localAgentRequestBody(localAgent, payload, payloadMode) {
  if (payloadMode === "simple") {
    return payload;
  }
  const method = localAgent.method || "tools/call";
  const callPayload = payload && typeof payload === "object" ? { ...payload } : {};
  if (method === "tools/call") {
    const name = localAgent.tool || callPayload.tool;
    if (callPayload.tool) {
      delete callPayload.tool;
    }
    return {
      jsonrpc: "2.0",
      id: `local-agent-${Date.now()}`,
      method,
      params: {
        name,
        arguments: {
          ...callPayload
        }
      }
    };
  }
  return {
    jsonrpc: "2.0",
    id: `local-agent-${Date.now()}`,
    method,
    params: callPayload
  };
}

function localAgentCallArgs(localAgent) {
  if (!localAgent || typeof localAgent !== "object" || Array.isArray(localAgent)) return {};
  const presetArgs = normalizeObjectStringMap(localAgent) || {};
  const reserved = [
    "endpoint",
    "url",
    "mcpUrl",
    "baseUrl",
    "tool",
    "toolName",
    "tool_id",
    "headers",
    "timeoutMs",
    "timeout_ms",
    "timeout",
    "timeoutSec",
    "timeout_seconds",
    "payloadMode",
    "protocol",
    "fallbackToRemote",
    "enabled",
    "toolMode",
    "method",
    "model",
    "cwd",
    "workdir",
    "workingDirectory",
    "working_directory"
  ];
  for (const key of reserved) {
    delete presetArgs[key];
  }
  const body = normalizeObjectStringMap(localAgent.body);
  const params = normalizeObjectStringMap(localAgent.params);
  const payload = normalizeObjectStringMap(localAgent.payload);
  delete presetArgs.args;
  delete presetArgs.body;
  delete presetArgs.params;
  delete presetArgs.payload;
  return {
    ...presetArgs,
    ...(body || {}),
    ...(params || {}),
    ...(payload || {}),
    ...(normalizeObjectStringMap(localAgent.args) || {})
  };
}

function createAbortController(parentSignal, timeoutMs) {
  const child = new AbortController();
  const clearTimers = [];
  if (parentSignal) {
    if (parentSignal.aborted) {
      child.abort(parentSignal.reason);
      return [child.signal, () => clearTimers.forEach((clear) => clear())];
    }
    const onAbort = () => child.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", onAbort, { once: true });
    clearTimers.push(() => parentSignal.removeEventListener("abort", onAbort));
  }
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    const timer = setTimeout(() => child.abort("Local agent request timeout"), timeoutMs);
    clearTimers.push(() => clearTimeout(timer));
  }
  return [child.signal, () => clearTimers.forEach((clear) => clear())];
}

function extractLocalAgentContent(rawText, _skillId, _tool) {
  const chunks = [];
  const payloads = localAgentPayloadTexts(rawText);
  for (const payloadText of payloads) {
    const payload = safeParseJSON(payloadText);
    if (!payload) continue;
    if (payload?.error) {
      const message = payload.error?.message || JSON.stringify(payload.error);
      throw new Error(`Local agent error: ${message}`);
    }
    const candidate = localAgentTextFromPayload(payload);
    if (candidate) chunks.push(candidate);
  }
  const content = chunks.join("\n").trim();
  if (content) return content;
  return String(rawText || "").trim();
}

function localAgentPayloadTexts(rawText) {
  const text = String(rawText || "");
  const seen = new Set();
  const payloads = [];
  const pushPayload = (payloadText) => {
    const trimmed = String(payloadText || "").trim();
    if (!trimmed || trimmed === "[DONE]") return;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      payloads.push(trimmed);
    }
  };

  for (const payloadText of extractContentLengthPayloads(text)) {
    pushPayload(payloadText);
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const payloadText = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (payloadText) pushPayload(payloadText);
  }

  if (!payloads.length) {
    pushPayload(text);
  }
  return payloads;
}

function extractContentLengthPayloads(rawText) {
  const text = String(rawText || "");
  const frames = [];
  let cursor = 0;
  while (cursor < text.length) {
    const candidateHeaderStarts = [text.indexOf("Content-Length:", cursor), text.indexOf("content-length:", cursor)].filter((index) => index >= 0);
    if (!candidateHeaderStarts.length) break;
    const headerStart = Math.min(...candidateHeaderStarts);
    if (headerStart === -1) break;
    const headerEnd = text.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) break;
    const header = text.slice(headerStart, headerEnd);
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      cursor = headerStart + 1;
      continue;
    }
    const length = Number(match[1]);
    if (!Number.isFinite(length) || length <= 0) {
      cursor = headerEnd + 4;
      continue;
    }
    const payloadStart = headerEnd + 4;
    const payloadEnd = payloadStart + length;
    if (payloadEnd > text.length) break;
    frames.push(text.slice(payloadStart, payloadEnd));
    cursor = payloadEnd;
  }
  return frames;
}

function localAgentTextFromPayload(parsed) {
  const candidates = [
    parsed?.content,
    parsed?.result?.content,
    parsed?.result?.text,
    parsed?.result?.output,
    parsed?.result?.output_text,
    parsed?.output,
    parsed?.output_text,
    parsed?.answer,
    parsed?.response,
    parsed?.message?.content,
    parsed?.result?.message?.content,
    parsed?.result?.message?.text,
    localAgentTextFromChoices(parsed?.choices),
    localAgentTextFromChoices(parsed?.result?.choices),
    parsed?.result?.content?.[0]?.text
  ];
  for (const candidate of candidates) {
    const text = localAgentTextFromValue(candidate);
    if (text) return text;
  }
  return "";
}

function localAgentTextFromChoices(choices) {
  if (!Array.isArray(choices)) return "";
  return choices
    .map((choice) => localAgentTextFromValue(choice?.message?.content)
      || localAgentTextFromValue(choice?.message)
      || localAgentTextFromValue(choice?.delta?.content)
      || localAgentTextFromValue(choice?.delta)
      || localAgentTextFromValue(choice?.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function localAgentTextFromValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => localAgentTextFromValue(item)).filter(Boolean).join("\n").trim();
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.content === "string") return value.content.trim();
    if (typeof value.output_text === "string") return value.output_text.trim();
    if (typeof value.outputText === "string") return value.outputText.trim();
    if (typeof value.answer === "string") return value.answer.trim();
    if (typeof value.response === "string") return value.response.trim();
    if (typeof value.result === "string") return value.result.trim();
    if (typeof value.message === "string") return value.message.trim();
    if (Array.isArray(value.content)) {
      const contentText = value.content
        .map((item) => localAgentTextFromValue(item))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (contentText) return contentText;
    }
    if (Array.isArray(value.output)) {
      const outputText = value.output
        .map((item) => localAgentTextFromValue(item))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (outputText) return outputText;
    }
  }
  return "";
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function normalizeObjectStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined).map(([key, candidate]) => [String(key), candidate]));
}

function toFinitePositiveInt(...values) {
  for (const value of values) {
    const normalized = Number(value);
    if (Number.isFinite(normalized) && normalized > 0) return Math.round(normalized);
  }
  return null;
}

function normalizeLocalAgentPayloadMode(payloadMode) {
  const normalized = String(payloadMode || "").trim().toLowerCase();
  if (normalized === "simple") return "simple";
  return "jsonrpc";
}

function normalizeLocalAgentConfig(raw, skillId) {
  if (typeof raw === "string") return { endpoint: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const normalizedRaw = normalizeObjectStringMap(raw);
  if (!normalizedRaw) return null;
  const baseConfig = {
    ...(normalizedRaw.endpoint ? { endpoint: normalizedRaw.endpoint } : {}),
    ...(normalizedRaw.url ? { url: normalizedRaw.url } : {}),
    ...(normalizedRaw.mcpUrl ? { mcpUrl: normalizedRaw.mcpUrl } : {}),
    ...(normalizedRaw.baseUrl ? { baseUrl: normalizedRaw.baseUrl } : {}),
    ...(normalizedRaw.tool ? { tool: normalizedRaw.tool } : {}),
    ...(normalizedRaw.toolName ? { toolName: normalizedRaw.toolName } : {}),
    ...(normalizedRaw.tool_id ? { tool_id: normalizedRaw.tool_id } : {}),
    ...(normalizedRaw.headers ? { headers: normalizedRaw.headers } : {}),
    ...(normalizedRaw.timeoutMs ? { timeoutMs: normalizedRaw.timeoutMs } : {}),
    ...(normalizedRaw.timeout ? { timeout: normalizedRaw.timeout } : {}),
    ...(normalizedRaw.timeoutSeconds ? { timeoutSeconds: normalizedRaw.timeoutSeconds } : {}),
    ...(normalizedRaw.timeoutSec ? { timeoutSec: normalizedRaw.timeoutSec } : {}),
    ...(normalizedRaw.timeout_seconds ? { timeout_seconds: normalizedRaw.timeout_seconds } : {}),
    ...(normalizedRaw.timeout_ms ? { timeout_ms: normalizedRaw.timeout_ms } : {}),
    ...(normalizedRaw.payloadMode ? { payloadMode: normalizedRaw.payloadMode } : {}),
    ...(normalizedRaw.protocol ? { protocol: normalizedRaw.protocol } : {}),
    ...(normalizedRaw.method ? { method: normalizedRaw.method } : {}),
    ...(normalizedRaw.model ? { model: normalizedRaw.model } : {}),
    ...(normalizedRaw.cwd ? { cwd: normalizedRaw.cwd } : {}),
    ...(normalizedRaw.workdir ? { workdir: normalizedRaw.workdir } : {}),
    ...(normalizedRaw.workingDirectory ? { workingDirectory: normalizedRaw.workingDirectory } : {}),
    ...(normalizedRaw.working_directory ? { working_directory: normalizedRaw.working_directory } : {}),
    ...(normalizedRaw.args ? { args: normalizedRaw.args } : {}),
    ...(normalizedRaw.body ? { body: normalizedRaw.body } : {}),
    ...(normalizedRaw.params ? { params: normalizedRaw.params } : {}),
    ...(normalizedRaw.payload ? { payload: normalizedRaw.payload } : {}),
    ...(normalizedRaw.fallbackToRemote ? { fallbackToRemote: true } : {})
  };
  const candidate = pickSkillLocalAgentConfig(raw, String(skillId));
  if (!candidate) {
    return baseConfig.endpoint || baseConfig.url || baseConfig.mcpUrl || baseConfig.baseUrl ? baseConfig : null;
  }
  if (typeof candidate === "string") return { ...baseConfig, endpoint: candidate };
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return {
      ...baseConfig,
      ...normalizeObjectStringMap(candidate)
    };
  }
  return null;
}

function localAgentRequestCwd(localAgents) {
  for (const agent of localAgents || []) {
    const cwd = agent?.cwd || agent?.workingDirectory || agent?.workdir || agent?.working_directory;
    if (typeof cwd === "string" && cwd.trim()) return cwd.trim();
  }
  return "";
}

function pickSkillLocalAgentConfig(candidateMap, skillId) {
  const fallback = candidateMap.default;
  const bySkill = candidateMap[skillId];
  const bySnake = candidateMap[toSnakeCase(skillId)];
  const byToolName = candidateMap[LOCAL_AGENT_SKILLS[skillId]];
  const bySkillConfig = candidateMap[`${toSnakeCase(skillId)}-config`];
  const byDashSkillConfig = candidateMap[`${toolIdToDash(skillId)}-config`];
  const byToolConfig = candidateMap[`${LOCAL_AGENT_SKILLS[skillId]}-config`];
  const byToolDashConfig = candidateMap[`${toolIdToDash(LOCAL_AGENT_SKILLS[skillId])}-config`];
  return bySkill || bySnake || byToolName || bySkillConfig || byDashSkillConfig || byToolConfig || byToolDashConfig || fallback || null;
}

function toSnakeCase(skillId) {
  return String(skillId).replace(/-/g, "_");
}

function pref(key) {
  return Zotero.Prefs.get(`${ZMS_PREF_PREFIX}.${key}`, true);
}

function setPref(key, value) {
  Zotero.Prefs.set(`${ZMS_PREF_PREFIX}.${key}`, value, true);
}

function resolvedOutputDir(value) {
  const raw = String(value || "").trim();
  if (raw && !isLegacyPackagedOutputDir(raw)) return raw;
  return defaultOutputDir();
}

async function chooseOutputDirectory(currentPath, title) {
  const cc = typeof Cc !== "undefined" ? Cc : undefined;
  const ci = typeof Ci !== "undefined" ? Ci : undefined;
  const nsIFilePicker = ci?.nsIFilePicker;
  const pickerFactory = cc?.["@mozilla.org/filepicker;1"];
  const pickerTitle = title || "Choose output folder";
  const displayPath = pathFromPickerString(currentPath);
  const displayDirectory = fileForDirectoryPicker(currentPath);
  const zoteroFilePicker = zoteroFilePickerClass();
  if (zoteroFilePicker) {
    try {
      return await chooseOutputDirectoryWithZoteroFilePicker(zoteroFilePicker, pickerTitle, displayPath);
    } catch (_err) {
      // Fall back to raw nsIFilePicker below.
    }
  }
  if (!pickerFactory || !nsIFilePicker) {
    throw new Error("Folder picker is not available in this Zotero runtime");
  }
  try {
    const picker = pickerFactory.createInstance(nsIFilePicker);
    return await chooseOutputDirectoryWithPicker(picker, pickerTitle, nsIFilePicker, displayDirectory, true);
  } catch (_err) {
    const picker = pickerFactory.createInstance(nsIFilePicker);
    return chooseOutputDirectoryWithPicker(picker, pickerTitle, nsIFilePicker, displayDirectory, false);
  }
}

async function chooseOutputDirectoryWithZoteroFilePicker(FilePicker, title, displayPath) {
  let lastError = null;
  for (const parentWindow of directoryPickerWindowCandidates()) {
    try {
      const picker = new FilePicker();
      if (displayPath) setZoteroPickerDisplayDirectory(picker, displayPath);
      picker.init(parentWindow, title, picker.modeGetFolder ?? 2);
      if (typeof picker.appendFilters === "function" && picker.filterAll !== undefined) {
        try { picker.appendFilters(picker.filterAll); } catch (_err) {}
      }
      const result = typeof picker.show === "function" ? await picker.show() : await openDirectoryPicker(picker);
      if (!isAcceptedDirectoryPickerResult(result, picker)) return "";
      const selected = selectedDirectoryPathFromPicker(picker);
      if (!selected) throw new Error("Folder picker did not return a usable folder path");
      return selected;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Folder picker cannot be initialized");
}

function zoteroFilePickerClass() {
  try {
    if (typeof ChromeUtils !== "undefined") {
      return ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs")?.FilePicker || null;
    }
  } catch (_err) {}
  try {
    return Zotero?.FilePicker || null;
  } catch (_err) {
    return null;
  }
}

function setZoteroPickerDisplayDirectory(picker, displayPath) {
  try {
    picker.displayDirectory = displayPath;
    return true;
  } catch (_err) {
    return false;
  }
}

async function chooseOutputDirectoryWithPicker(picker, title, nsIFilePicker, displayDirectory, useWindowParent) {
  initDirectoryPicker(picker, title, nsIFilePicker, useWindowParent);
  setPickerDisplayDirectory(picker, displayDirectory);
  const result = await openDirectoryPicker(picker);
  if (!isAcceptedDirectoryPickerResult(result, nsIFilePicker)) return "";
  const selected = selectedDirectoryPathFromPicker(picker);
  if (!selected) throw new Error("Folder picker did not return a usable folder path");
  return selected;
}

function initDirectoryPicker(picker, title, nsIFilePicker, useWindowParent = true) {
  const mode = typeof nsIFilePicker.modeGetFolder === "number" ? nsIFilePicker.modeGetFolder : 2;
  let lastError = null;
  for (const parent of directoryPickerParentCandidates(useWindowParent)) {
    try {
      picker.init(parent, title, mode);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Folder picker cannot be initialized");
}

function directoryPickerParentCandidates(useWindowParent = true) {
  const candidates = [];
  const add = (value) => {
    if (typeof value === "undefined" || candidates.includes(value)) return;
    candidates.push(value);
  };
  const addWindow = (value) => {
    if (!value) return;
    try { add(value.browsingContext); } catch (_err) {}
    add(value);
  };
  if (useWindowParent && typeof window !== "undefined") {
    addWindow(window);
    try { addWindow(window.top); } catch (_err) {}
    try { addWindow(window.parent); } catch (_err) {}
  }
  try { addWindow(Services?.wm?.getMostRecentWindow?.("navigator:browser")); } catch (_err) {}
  try { addWindow(Services?.wm?.getMostRecentWindow?.(null)); } catch (_err) {}
  add(null);
  return candidates;
}

function directoryPickerWindowCandidates() {
  const candidates = [];
  const add = (value) => {
    if (typeof value === "undefined" || candidates.includes(value)) return;
    candidates.push(value);
  };
  if (typeof window !== "undefined") {
    add(window);
    try { add(window.top); } catch (_err) {}
    try { add(window.parent); } catch (_err) {}
  }
  try { add(Services?.wm?.getMostRecentWindow?.("navigator:browser")); } catch (_err) {}
  try { add(Services?.wm?.getMostRecentWindow?.(null)); } catch (_err) {}
  add(null);
  return candidates;
}

function fileForDirectoryPicker(path) {
  const raw = pathFromPickerString(path);
  if (!raw) return null;
  try {
    const cc = typeof Cc !== "undefined" ? Cc : undefined;
    const ci = typeof Ci !== "undefined" ? Ci : undefined;
    const fileFactory = cc?.["@mozilla.org/file/local;1"];
    if (!fileFactory) return null;
    const file = fileFactory.createInstance(ci?.nsIFile);
    file.initWithPath(raw);
    return nearestDirectoryForPicker(file);
  } catch (_err) {
    return null;
  }
}

function nearestDirectoryForPicker(file) {
  const seen = new Set();
  let current = file;
  for (let depth = 0; current && depth < 64; depth += 1) {
    const path = String(current.path || "");
    if (path && seen.has(path)) break;
    if (path) seen.add(path);
    const directory = directoryForPicker(current);
    if (directory) return directory;
    current = current.parent || null;
  }
  return null;
}

function directoryForPicker(file) {
  if (!file) return null;
  try {
    if (typeof file.exists === "function" && !file.exists()) return null;
    if (typeof file.isDirectory === "function" && !file.isDirectory()) return null;
    return file;
  } catch (_err) {
    return null;
  }
}

function setPickerDisplayDirectory(picker, directory) {
  if (!picker || !directory) return false;
  try {
    picker.displayDirectory = directory;
    return true;
  } catch (_err) {
    return false;
  }
}

async function openDirectoryPicker(picker) {
  if (typeof picker.open === "function") {
    return new Promise((resolve, reject) => {
      try {
        const returned = picker.open(resolve);
        if (returned && typeof returned.then === "function") {
          returned.then(resolve, reject);
        } else if (typeof returned === "number") {
          resolve(returned);
        }
      } catch (err) {
        reject(err);
      }
    });
  }
  if (typeof picker.show === "function") return picker.show();
  throw new Error("Folder picker cannot be opened");
}

function isAcceptedDirectoryPickerResult(result, nsIFilePicker) {
  return result === nsIFilePicker.returnOK || result === nsIFilePicker.returnReplace || result === 0;
}

function selectedDirectoryPathFromPicker(picker) {
  const seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;
  return firstDirectoryPath(
    seen,
    ...safeObjectValues(picker, [
      "file",
      "files",
      "fileURL",
      "directoryURL",
      "folderURL",
      "domFileOrDirectoryPath",
      "domFileOrDirectory",
      "selectedFile",
      "selectedFiles",
      "selectedDirectory",
      "resultFile",
      "resultFiles",
      "targetFile",
      "target",
      "directory",
      "folder"
    ]),
    ...safeObjectValues(safeObjectValue(picker, "file"), [
      "path",
      "filePath",
      "nativePath",
      "persistentDescriptor"
    ]),
    ...safeObjectValues(safeObjectValue(picker, "fileURL"), [
      "file",
      "filePath",
      "path",
      "spec",
      "displaySpec",
      "asciiSpec"
    ])
  );
}

function firstDirectoryPath(seen, ...values) {
  for (const value of values) {
    const path = directoryPathFromPickerValue(value, seen);
    if (path) return path;
  }
  return "";
}

function directoryPathFromPickerValue(value, seen, depth = 0) {
  if (!value || depth > 3) return "";
  if (typeof value === "string") return pathFromPickerString(value);
  if (typeof value !== "object") return "";
  if (seen) {
    if (seen.has(value)) return "";
    seen.add(value);
  }
  const queried = filePathFromQueryInterface(value);
  if (queried) return queried;
  const enumerated = firstDirectoryPathFromEnumerable(value, seen, depth);
  if (enumerated) return enumerated;
  const methodValue = firstDirectoryPathFromMethods(value, seen, depth);
  if (methodValue) return methodValue;
  return firstDirectoryPath(
    seen,
    ...safeObjectValues(value, [
      "path",
      "filePath",
      "nativePath",
      "domFileOrDirectoryPath",
      "mozFullPath",
      "fullPath",
      "displayPath",
      "persistentDescriptor",
      "url",
      "URL",
      "href",
      "uri",
      "asciiSpec",
      "targetFile",
      "target",
      "file",
      "files",
      "selectedFile",
      "selectedFiles",
      "directory",
      "selectedDirectory",
      "folder",
      "fileURL",
      "directoryURL",
      "folderURL",
      "domFileOrDirectory",
      "resultFile",
      "resultFiles",
      "spec",
      "displaySpec"
    ])
  );
}

function filePathFromQueryInterface(value) {
  try {
    if (typeof value.QueryInterface !== "function") return "";
    const nsIFile = typeof Ci !== "undefined" ? Ci.nsIFile : undefined;
    const file = nsIFile ? value.QueryInterface(nsIFile) : null;
    const filePath = pathFromPickerString(firstPathLikeValue(
      safeObjectValue(file, "path"),
      safeObjectValue(file, "persistentDescriptor"),
      safeObjectValue(file, "nativePath")
    ));
    if (filePath) return filePath;
  } catch (_err) {
    // Try nsIFileURL below.
  }
  try {
    if (typeof value.QueryInterface !== "function") return "";
    const nsIFileURL = typeof Ci !== "undefined" ? Ci.nsIFileURL : undefined;
    const fileURL = nsIFileURL ? value.QueryInterface(nsIFileURL) : null;
    return pathFromPickerString(firstPathLikeValue(
      safeObjectValue(safeObjectValue(fileURL, "file"), "path"),
      safeObjectValue(fileURL, "filePath"),
      safeObjectValue(fileURL, "path"),
      safeObjectValue(fileURL, "spec"),
      safeObjectValue(fileURL, "displaySpec"),
      safeObjectValue(fileURL, "asciiSpec")
    ));
  } catch (_err) {
    return "";
  }
}

function safeObjectValue(value, key) {
  if (!value || typeof value !== "object") return undefined;
  try {
    return value[key];
  } catch (_err) {
    return undefined;
  }
}

function safeObjectValues(value, keys) {
  if (!value || typeof value !== "object") return [];
  const values = [];
  for (const key of keys || []) {
    const next = safeObjectValue(value, key);
    if (typeof next !== "undefined" && next !== null && next !== "") values.push(next);
  }
  return values;
}

function firstPathLikeValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value !== "string") return value;
  }
  return "";
}

function firstDirectoryPathFromEnumerable(value, seen, depth) {
  if (Array.isArray(value)) {
    return firstDirectoryPath(seen, ...value);
  }
  if (typeof value?.[Symbol.iterator] === "function") {
    const paths = [];
    let count = 0;
    for (const entry of value) {
      paths.push(entry);
      count += 1;
      if (count >= 8) break;
    }
    return firstDirectoryPath(seen, ...paths);
  }
  if (typeof value?.hasMoreElements === "function" && typeof value?.getNext === "function") {
    const paths = [];
    for (let count = 0; count < 8 && value.hasMoreElements(); count += 1) {
      paths.push(value.getNext());
    }
    return firstDirectoryPath(seen, ...paths);
  }
  if (depth > 0 || typeof value?.length !== "number" || value.length < 1 || value.length > 8) return "";
  const paths = [];
  for (let index = 0; index < value.length; index += 1) paths.push(value[index]);
  return firstDirectoryPath(seen, ...paths);
}

function firstDirectoryPathFromMethods(value, seen, depth) {
  if (depth > 1 || !value || typeof value !== "object") return "";
  for (const name of [
    "getFile",
    "getFiles",
    "getSelectedFile",
    "getSelectedFiles",
    "getDirectory",
    "getFolder"
  ]) {
    const method = safeObjectValue(value, name);
    if (typeof method !== "function") continue;
    try {
      const path = directoryPathFromPickerValue(method.call(value), seen, depth + 1);
      if (path) return path;
    } catch (_err) {
      // Try the next nonstandard picker accessor.
    }
  }
  return "";
}

function pathFromPickerString(value) {
  const text = stripPickerPathQuotes(String(value || "").trim());
  if (!text) return "";
  if (!/^file:/i.test(text)) return normalizePickerPathString(text);
  const rawWindowsPath = pathFromNonstandardWindowsFileURL(text);
  if (rawWindowsPath) return normalizePickerPathString(rawWindowsPath);
  try {
    const url = new URL(text);
    if (url.protocol !== "file:") return normalizePickerPathString(text);
    const host = safeDecodePickerPath(url.hostname || "");
    const pathname = safeDecodePickerPath(url.pathname || "");
    const slashPath = pathname.replace(/\\/g, "/");
    if (host && host.toLowerCase() !== "localhost") {
      const driveHost = host.match(/^([A-Za-z])[:|]?$/);
      if (driveHost) {
        return normalizePickerPathString(`${driveHost[1]}:${slashPath.startsWith("/") ? slashPath : `/${slashPath}`}`);
      }
      return normalizePickerPathString(`//${host}${slashPath.startsWith("/") ? slashPath : `/${slashPath}`}`);
    }
    return normalizePickerPathString(pathname || text);
  } catch (_err) {
    return normalizePickerPathString(text.replace(/^file:(?:\/\/)?/i, ""));
  }
}

function pathFromNonstandardWindowsFileURL(value) {
  const text = String(value || "").trim();
  const longPathMatch = text.match(/^file:\/+\?[/\\](.+)$/i) || text.match(/^file:\/+localhost\/\?[/\\](.+)$/i);
  if (longPathMatch?.[1]) {
    const rawPath = longPathMatch[1];
    return /^UNC[/\\]/i.test(rawPath) ? `//?/${rawPath}` : rawPath;
  }
  return "";
}

function normalizePickerPathString(value) {
  const text = stripPickerPathQuotes(safeDecodePickerPath(value).trim().replace(/\0/g, ""));
  if (/^\/+\\\\\?\\UNC\\/i.test(text)) return `\\\\${text.replace(/^\/+\\\\\?\\UNC\\/i, "")}`;
  if (/^\/+\\\\\?\\[A-Za-z]:\\/i.test(text)) return text.replace(/^\/+\\\\\?\\/i, "");
  if (/^\/+\\\\[^\\]+\\[^\\]+/.test(text)) return text.replace(/^\/+/, "");
  if (/^\/+[A-Za-z]:$/.test(text)) return `${text.replace(/^\/+/, "")}\\`;
  if (/^\/\/\?\/UNC\//i.test(text)) return `\\\\${text.replace(/^\/\/\?\/UNC\//i, "").replace(/\//g, "\\")}`;
  if (/^\/\/\?\/[A-Za-z]:\//i.test(text)) return text.replace(/^\/\/\?\//i, "").replace(/\//g, "\\");
  if (/^\\\\\?\\UNC\\/i.test(text)) return `\\\\${text.slice(8)}`;
  if (/^\\\\\?\\[A-Za-z]:\\/i.test(text)) return text.slice(4);
  if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return text;
  if (/^\/{2,}[A-Za-z]:[\\/]/.test(text)) return text.replace(/^\/+/, "").replace(/\//g, "\\");
  if (/^\/{2,}[A-Za-z]\|[\\/]/.test(text)) return `${text.replace(/^\/+/, "")[0]}:${text.replace(/^\/+/, "").slice(2)}`.replace(/\//g, "\\");
  if (/^\/\/\/+[^/\\]+[\\/][^/\\]+/.test(text)) return text.replace(/^\/+/, "//").replace(/\//g, "\\");
  if (/^\/\/[^/\\]+[\\/][^/\\]+/.test(text)) return text.replace(/\//g, "\\");
  if (/^localhost[\\/]/i.test(text)) return normalizePickerPathString(text.replace(/^localhost[\\/]+/i, "/"));
  if (/^[A-Za-z]:$/.test(text)) return `${text}\\`;
  if (/^[\\/][A-Za-z]:$/.test(text)) return `${text[1]}:\\`;
  if (/^[A-Za-z]:[\\/]/.test(text)) return text.replace(/\//g, "\\");
  if (/^[\\/][A-Za-z]:[\\/]/.test(text)) return text.slice(1).replace(/\//g, "\\");
  if (/^[A-Za-z]\|[\\/]/.test(text)) return `${text[0]}:${text.slice(2)}`.replace(/\//g, "\\");
  if (/^[\\/][A-Za-z]\|[\\/]/.test(text)) return `${text[1]}:${text.slice(3)}`.replace(/\//g, "\\");
  return text;
}

function stripPickerPathQuotes(value) {
  let text = String(value || "").trim();
  for (let i = 0; i < 2 && text.length >= 2; i += 1) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }
  return text;
}

function safeDecodePickerPath(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (_err) {
    return text;
  }
}

function shouldPersistResolvedOutputDir(value) {
  const raw = String(value || "").trim();
  return !raw || isLegacyPackagedOutputDir(raw);
}

function isLegacyPackagedOutputDir(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  return /\/Library\/CloudStorage\/OneDrive-[^/]+\/Zotero_PDFs\/Zotero_MD_Summaries$/.test(normalized);
}

function defaultOutputDir() {
  const base = zoteroDataDirectory() || zoteroProfileDirectory();
  if (base && PathUtils?.join) return PathUtils.join(base, ZMS_DEFAULT_OUTPUT_DIR_NAME);
  return ZMS_DEFAULT_OUTPUT_DIR_NAME;
}

function zoteroDataDirectory() {
  try {
    return Zotero?.DataDirectory?.dir || "";
  } catch (_err) {
    return "";
  }
}

function zoteroProfileDirectory() {
  try {
    const nsIFile = typeof Ci !== "undefined" ? Ci.nsIFile : undefined;
    return Services?.dirsvc?.get?.("ProfD", nsIFile)?.path || "";
  } catch (_err) {
    return "";
  }
}

function homeDirectory() {
  try {
    const nsIFile = typeof Ci !== "undefined" ? Ci.nsIFile : undefined;
    const home = Services?.dirsvc?.get?.("Home", nsIFile)?.path || "";
    if (home) return home;
  } catch (_err) {
    // Fall back to deriving it from Zotero directories below.
  }
  const candidates = [zoteroDataDirectory(), zoteroProfileDirectory()];
  for (const path of candidates) {
    const match = String(path || "").replace(/\\/g, "/").match(/^(\/Users\/[^/]+)/);
    if (match) return match[1];
  }
  return "";
}

function connectionTestBodyForProfile(profile) {
  const system = "You are a provider connection test endpoint. Reply with pong only.";
  if (profile.protocol === "anthropic_messages") {
    const systemInUser = isTrueValue(profile?.bodyExtra?.systemFallbackToUser);
    return {
      model: profile.model,
      ...(systemInUser ? {} : { system }),
      max_tokens: 32,
      stream: false,
      messages: systemInUser
        ? messagesWithPrependedAnthropicText([{ role: "user", content: "ping" }], fallbackSystemText(system))
        : [{ role: "user", content: "ping" }]
    };
  }
  if (profile.protocol === "openai_responses") {
    const instructionsInUser = isTrueValue(profile?.bodyExtra?.instructionsFallbackToUser);
    return {
      model: profile.model,
      ...(instructionsInUser ? {} : { instructions: system }),
      input: openaiResponsesInput([{ role: "user", content: "ping" }], {}, instructionsInUser ? system : "", profile),
      max_output_tokens: 32,
      stream: false
    };
  }
  return {
    model: profile.model,
    messages: isTrueValue(profile?.bodyExtra?.systemFallbackToUser)
      ? messagesWithPrependedOpenAIChatText([{ role: "user", content: "ping" }], fallbackSystemText(system))
      : [
        { role: "system", content: system },
        { role: "user", content: "ping" }
      ],
    ...openAIChatTokenLimit(profile, 32),
    ...openAIChatOptionalDefaults(profile, { n: 1 }),
    stream: false
  };
}

function connectionTestRequestForProfile(profile) {
  const body = connectionTestBodyForProfile(profile);
  return {
    url: endpointForProfile(profile),
    headers: headersForProfile(profile),
    body: profile?.protocol === "openai_chat" ? withOpenAIChatBodyDefaults(profile, body) : withProviderBodyDefaults(profile, body)
  };
}

async function runWorkbenchProviderConnectionTest(profile, request) {
  let requestProfile = profile;
  let currentRequest = request;
  const usedFallbackFields = [];
  let lastResponse = null;
  let lastText = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(currentRequest.url, { method: "POST", headers: currentRequest.headers, body: JSON.stringify(currentRequest.body) });
    const text = await response.text();
    lastResponse = response;
    lastText = text;
    const fallback = providerCompatibilityFallback(requestProfile, currentRequest.body, response.status, text, usedFallbackFields, false);
    if (response.ok && !fallback) return { response, text };
    if (!fallback) return { response, text };
    requestProfile = fallback.profile;
    usedFallbackFields.splice(0, usedFallbackFields.length, ...fallback.usedFields);
    currentRequest = connectionTestRequestForProfile(requestProfile);
  }
  return { response: lastResponse, text: lastText };
}

async function verifyLocalAgentConnection(profile) {
  const initializePayload = await assertLocalAgentRequestOk(localAgentConnectionTestRequestForProfile(profile));
  if (initializePayload?.error) throw new Error(localAgentErrorText(200, JSON.stringify(initializePayload)));
  const toolsPayload = await assertLocalAgentRequestOk(localAgentToolsListRequestForProfile(profile));
  const names = localAgentToolNamesFromResponse(toolsPayload);
  const missing = [...LOCAL_AGENT_TOOL_NAMES].filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Missing Local Agents MCP tools: ${missing.join(", ")}`);
  return true;
}

function localAgentConnectionTestRequestForProfile(profile) {
  const localAgent = baseLocalAgentConfigForProfile(profile);
  const endpoint = normalizeLocalAgentEndpoint(localAgent?.endpoint || "http://127.0.0.1:3333/mcp");
  return {
    url: endpoint,
    headers: {
      "content-type": "application/json",
      ...(localAgent?.headers || {})
    },
    body: {
      jsonrpc: "2.0",
      id: `workbench-settings-${Date.now()}`,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "literature-review-with-llm-workbench",
          version: "0.1.6"
        }
      }
    }
  };
}

function localAgentToolsListRequestForProfile(profile) {
  const localAgent = baseLocalAgentConfigForProfile(profile);
  const endpoint = normalizeLocalAgentEndpoint(localAgent?.endpoint || "http://127.0.0.1:3333/mcp");
  return {
    url: endpoint,
    headers: {
      "content-type": "application/json",
      ...(localAgent?.headers || {})
    },
    body: {
      jsonrpc: "2.0",
      id: `workbench-settings-tools-${Date.now()}`,
      method: "tools/list",
      params: {}
    }
  };
}

function baseLocalAgentConfigForProfile(profile) {
  const raw = profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent;
  if (typeof raw === "string") return { endpoint: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return normalizeObjectStringMap(raw) || {};
}

async function assertLocalAgentRequestOk(request) {
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: request.signal });
  const text = await response.text();
  const data = safeParseJSON(text);
  if (!response.ok || data?.error) throw new Error(localAgentErrorText(response.status, text));
  return data || {};
}

function localAgentToolNamesFromResponse(data) {
  const tools = Array.isArray(data?.result?.tools)
    ? data.result.tools
    : Array.isArray(data?.tools)
      ? data.tools
      : [];
  return tools
    .map((tool) => String(typeof tool === "string" ? tool : tool?.name || "").trim())
    .filter(Boolean);
}

function localAgentErrorText(status, text) {
  const detail = redact(providerErrorDetail(text));
  return status && Number(status) !== 200 ? `HTTP ${status}: ${detail}` : detail;
}

function resolveUiLanguage(setting, locale) {
  if (typeof zmsResolveUiLanguage === "function") {
    return zmsResolveUiLanguage(setting, locale);
  }
  if (setting === "zh-CN" || setting === "en-US") return setting;
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function runtimeLocale() {
  try {
    return Services.locale.appLocaleAsBCP47 || Services.locale.requestedLocale || "";
  } catch (_err) {
    return "";
  }
}

function normalizeOutputLanguage(value) {
  if (value === "en-US" || value === "ja-JP") return value;
  return "zh-CN";
}

function normalizeInputMode(value) {
  return value === "pdf_base64" ? "pdf_base64" : "text";
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "yes", "on"].includes(lowered)) return true;
    if (["false", "no", "off"].includes(lowered)) return false;
  }
  return fallback;
}

function buildContextSourceHash(context, item, pdf) {
  const itemKey = item?.key || "";
  const pdfKey = pdf?.key || "";
  const chunkParts = (context?.chunks || []).map((chunk) => `${chunk.chunkId}:${chunk.sourceHash}`).join("|");
  const comparisonParts = (context?.comparisonContexts || []).map((entry) => {
    const chunks = (entry.chunks || []).map((chunk) => `${chunk.chunkId}:${chunk.sourceHash}`).join("|");
    return `${entry.itemKey || ""}|${entry.pdfKey || ""}|${chunks}`;
  }).join("||");
  return hashString(`${itemKey}|${pdfKey}|${chunkParts}|${comparisonParts}`);
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? "";
}

function setButtonLabel(id, visualText, accessibleText) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = visualText;
  element.title = accessibleText;
  element.setAttribute?.("aria-label", accessibleText);
}

function renderMessageContent(body, message) {
  if (message?.role === "user") {
    renderUserMessageContent(body, message);
    return;
  }
  if (message?.role !== "assistant" || !window.ZMSMarkdownRenderer?.renderMarkdown) {
    body.textContent = message?.content || "";
    return;
  }
  body.textContent = "";
  const parts = splitThinkBlocks(message.content || "");
  if (parts.reasoning.trim()) {
    const details = document.createElement("details");
    details.className = "zms-think";
    const summary = document.createElement("summary");
    summary.textContent = wbMessage("workbench", "thinkTitle");
    const pre = document.createElement("pre");
    pre.textContent = parts.reasoning.trim();
    details.append(summary, pre);
    body.appendChild(details);
  }
  const rendered = window.ZMSMarkdownRenderer.renderMarkdown(parts.answer || "");
  rendered.className = `${rendered.className || ""} zms-markdown`.trim();
  body.appendChild(rendered);
}

function renderUserMessageContent(body, message) {
  body.textContent = "";
  const text = document.createElement("div");
  text.className = "zms-user-text";
  text.textContent = message?.content || "";
  body.appendChild(text);
  const images = Array.isArray(message?.images) ? message.images : [];
  if (!images.length) return;
  const list = document.createElement("div");
  list.className = "zms-user-image-list";
  for (const image of images) {
    const chip = document.createElement("span");
    chip.className = "zms-user-image-chip";
    chip.textContent = image.name || image.mimeType || "image";
    list.appendChild(chip);
  }
  body.appendChild(list);
}

function userImageOcrSummary(localOcr, translate = (key) => key) {
  const label = (key, fallback) => {
    const translated = translate(key);
    return translated && translated !== key ? translated : fallback;
  };
  if (!localOcr?.status) return label("localOcrNotRun", "not run");
  if (localOcr.status === "corrected") return label("ocrCorrected", "corrected");
  if (localOcr.status === "manual") return label("ocrManual", "manual");
  if (localOcr.status === "ok") return label("localOcrOk", "recognized");
  if (localOcr.status === "empty") return label("ocrNoText", "no text");
  if (localOcr.status === "failed") return [label("localOcrFailed", "failed"), localOcr.error].filter(Boolean).join(": ");
  return String(localOcr.status || "");
}

function answerTextForMessage(message) {
  return splitThinkBlocks(message?.content || "").answer.trim();
}

function visibleMessageText(message) {
  if (message?.role === "assistant") return answerTextForMessage(message);
  return String(message?.content || "").trim();
}

function splitThinkBlocks(value) {
  const text = String(value || "");
  const reasoning = [];
  let answer = "";
  let cursor = 0;
  const pattern = /<think\b[^>]*>([\s\S]*?)(<\/think>|$)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    answer += text.slice(cursor, match.index);
    if (!match[2]) {
      const tail = splitUnclosedThinkTail(match[1] || "");
      if (tail.reasoning) reasoning.push(tail.reasoning);
      if (tail.answer) answer += answer.trim() ? `\n\n${tail.answer}` : tail.answer;
      cursor = text.length;
      break;
    }
    reasoning.push(match[1] || "");
    cursor = pattern.lastIndex;
  }
  answer += text.slice(cursor);
  return {
    reasoning: reasoning.join("\n\n").trim(),
    answer: answer.trim()
  };
}

function splitUnclosedThinkTail(value) {
  const text = String(value || "");
  const markers = [...text.matchAll(/(?:^|\n{2,})\s*(?:final\s+answer|answer|最终回答|最终答案|回复|回答|结论|总结)\s*[:：]\s*/gi)];
  const marker = markers[markers.length - 1];
  if (!marker) return { reasoning: text.trim(), answer: "" };
  const index = marker.index || 0;
  return {
    reasoning: text.slice(0, index).trim(),
    answer: text.slice(index + marker[0].length).trim()
  };
}

function profileCompactLabel(profile, modelLabel = "Model") {
  if (!profile) return modelLabel;
  const name = profile.name || profile.id || modelLabel;
  const model = profile.model || "";
  return model ? `${name} · ${model}` : name;
}

function normalizeModelOptions(modelOptions) {
  return (modelOptions || [])
    .map((entry) => typeof entry === "string" ? { id: entry, label: "" } : entry)
    .map((entry) => ({
      id: String(entry?.id || "").trim(),
      label: String(entry?.label || "").trim(),
      source: String(entry?.source || "").trim(),
      vendor: String(entry?.vendor || "").trim(),
      features: normalizeModelFeatureList(entry?.features || entry?.featureHints || entry?.traits)
    }))
    .filter((entry) => entry.id);
}

function normalizeModelFeatureList(value) {
  const source = Array.isArray(value) ? value : (typeof value === "string" ? value.split(/[\s,|/]+/) : []);
  const allowed = new Set(["image", "pdf", "reasoning", "fast", "local"]);
  const result = [];
  for (const item of source) {
    const feature = String(item || "").trim().toLowerCase();
    if (!allowed.has(feature) || result.includes(feature)) continue;
    result.push(feature);
  }
  return result;
}

function tagModelOptions(modelOptions, source) {
  const nextSource = String(source || "").trim();
  return normalizeModelOptions(modelOptions).map((entry) => ({
    ...entry,
    source: entry.source || nextSource,
    vendor: entry.vendor || inferredModelVendor(entry),
    features: entry.features.length ? entry.features : inferredModelFeatures(entry)
  }));
}

function appendGroupedModelSelectOptions(select, entries, translate = (key) => key) {
  const grouped = groupedModelSelectEntries(entries);
  for (const groupInfo of grouped) {
    const groupEntries = groupInfo.entries;
    if (!groupEntries.length) continue;
    const group = document.createElement("optgroup");
    const label = modelSelectGroupLabel(groupInfo, translate);
    group.label = label;
    group.setAttribute?.("label", label);
    for (const entry of groupEntries) {
      group.appendChild(modelSelectOption(entry, translate));
    }
    select.appendChild(group);
  }
}

function modelSelectOption(entry, translate = (key) => key) {
  const option = document.createElement("option");
  option.value = entry.id;
  const features = normalizeModelFeatureList(entry.features);
  const featureText = modelFeatureText(features, translate);
  option.textContent = modelOptionBaseText(entry, featureText);
  if (features.length) {
    option.setAttribute?.("data-features", features.join(" "));
    option.setAttribute?.("title", `${entry.id} · ${featureText}`);
  }
  return option;
}

function modelOptionBaseText(entry, featureText = "") {
  const base = entry.label && entry.label !== entry.id ? `${entry.label} (${entry.id})` : entry.id;
  return featureText ? `${base} · ${featureText}` : base;
}

function modelFeatureText(features, translate = (key) => key) {
  return normalizeModelFeatureList(features)
    .map((feature) => modelFeatureLabel(feature, translate))
    .filter(Boolean)
    .join(" / ");
}

function modelFeatureLabel(feature, translate = (key) => key) {
  const key = {
    image: "modelFeatureImage",
    pdf: "modelFeaturePdf",
    reasoning: "modelFeatureReasoning",
    fast: "modelFeatureFast",
    local: "modelFeatureLocal"
  }[feature];
  if (!key) return "";
  const value = translate(key);
  return value && value !== key ? value : feature;
}

function groupedModelSelectEntries(entries) {
  const order = ["online", "recommended", ""];
  const groups = [];
  const normalized = normalizeModelOptions(entries);
  for (const source of order) {
    const sourceEntries = normalized.filter((entry) => source ? entry.source === source : entry.source !== "online" && entry.source !== "recommended");
    const vendorNames = [];
    for (const entry of sourceEntries) {
      const vendor = entry.vendor || inferredModelVendor(entry);
      if (vendor && !vendorNames.includes(vendor)) vendorNames.push(vendor);
    }
    if (vendorNames.length <= 1) {
      if (sourceEntries.length) groups.push({ source, vendor: vendorNames[0] || "", entries: sourceEntries });
      continue;
    }
    for (const vendor of vendorNames) {
      groups.push({ source, vendor, entries: sourceEntries.filter((entry) => (entry.vendor || inferredModelVendor(entry)) === vendor) });
    }
    const ungrouped = sourceEntries.filter((entry) => !(entry.vendor || inferredModelVendor(entry)));
    if (ungrouped.length) groups.push({ source, vendor: "", entries: ungrouped });
  }
  return groups;
}

function modelSelectGroupLabel(groupInfo, translate = (key) => key) {
  const suffix = groupInfo.source === "online"
    ? translate("onlineModels")
    : (groupInfo.source === "recommended" ? translate("recommendedModels") : translate("modelSelectCustom"));
  return groupInfo.vendor ? `${groupInfo.vendor} · ${suffix}` : suffix;
}

function inferredModelVendor(entry) {
  const id = String(entry?.id || "");
  const label = String(entry?.label || "");
  if (typeof zmsModelVendorForProviderModel === "function") {
    return zmsModelVendorForProviderModel("", id, label);
  }
  return "";
}

function inferredModelFeatures(entry) {
  const id = String(entry?.id || "");
  const label = String(entry?.label || "");
  if (typeof zmsModelFeatureHintsForProviderModel === "function") {
    return normalizeModelFeatureList(zmsModelFeatureHintsForProviderModel("", id, label));
  }
  return [];
}

function clearOptionsElement(element) {
  if (!element) return;
  element.textContent = "";
  if (Array.isArray(element.children)) element.children = [];
}

function mergeModelOptions(primary, secondary) {
  const merged = new Map();
  for (const entry of [...normalizeModelOptions(primary), ...normalizeModelOptions(secondary)]) {
    if (!entry.id || merged.has(entry.id)) continue;
    merged.set(entry.id, entry);
  }
  return [...merged.values()];
}

function shouldSelectProviderDefaultModel(currentValue, recommendations) {
  const value = String(currentValue || "").trim();
  if (!value) return true;
  const entries = normalizeModelOptions(recommendations);
  if (entries.some((entry) => entry.id === value)) return false;
  return isKnownProviderDefaultModel(value);
}

function isKnownProviderDefaultModel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  return allRecommendedProviderModelIds().has(normalized);
}

function allRecommendedProviderModelIds() {
  const catalog = typeof zmsProviderModelCatalog === "object" && zmsProviderModelCatalog ? zmsProviderModelCatalog : {};
  return new Set(Object.keys(catalog).flatMap((provider) => recommendedModelOptionsForWorkbenchProvider(provider).map((entry) => entry.id)));
}

function recommendedModelOptionsForWorkbenchProfile(profile) {
  const provider = workbenchProviderFromProfile(profile, profile?.id || "");
  const defaults = workbenchProviderDefaults(provider);
  return mergeModelOptions([
    ...recommendedModelOptionsForWorkbenchProvider(provider),
    defaults?.model ? { id: defaults.model, label: defaults.model } : null
  ].filter(Boolean), []);
}

function recommendedModelOptionsForWorkbenchProvider(provider) {
  return zmsRecommendedModelOptionsForProvider(provider);
}

function workbenchModelSelectPlaceholder(profile, entries, language, translate = (key) => key) {
  const provider = workbenchProviderFromProfile(profile, profile?.id || "");
  const providerLabel = workbenchModelSelectProviderLabel(provider, entries);
  return providerModelSelectPlaceholder(providerLabel, language, translate);
}

function providerModelSelectPlaceholder(providerLabel, language, translate = (key) => key) {
  const zh = String(language || "").toLowerCase().startsWith("zh");
  const label = String(providerLabel || "").trim();
  if (!label) return translate("modelSelectPlaceholder");
  return zh ? `选择 ${label} 推荐模型` : `Choose ${label} model`;
}

function workbenchModelSelectProviderLabel(provider, entries = []) {
  const key = String(provider || "").trim();
  if (key && typeof zmsProviderModelCatalogLabel === "function") {
    return zmsProviderModelCatalogLabel(key);
  }
  return normalizeModelOptions(entries)[0]?.vendor || key;
}

function setWorkbenchCustomModelInputVisible(modelInput, visible) {
  if (!modelInput) return;
  modelInput.hidden = !visible;
  modelInput.setAttribute?.("aria-hidden", visible ? "false" : "true");
}

function focusElement(element) {
  if (!element?.focus) return;
  try {
    element.focus({ preventScroll: true });
  } catch (_err) {
    element.focus();
  }
}

async function findPdfAttachment(item) {
  if (isPdfAttachmentItem(item)) return item;
  if (typeof item.getBestAttachment === "function") {
    const best = await item.getBestAttachment();
    if (isPdfAttachmentItem(best)) return best;
  }
  const attachmentIDs = typeof item?.getAttachments === "function" ? item.getAttachments() : [];
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    if (isPdfAttachmentItem(attachment)) return attachment;
  }
  return null;
}

function isPdfAttachmentItem(item) {
  return String(item?.attachmentContentType || "").toLowerCase() === "application/pdf";
}

async function buildPaperContext(item, pdf, outputDir) {
  const metadata = {
    title: safeItemField(item, "title") || item?.key || "",
    authors: safeCreators(item),
    year: safeItemField(item, "date"),
    doi: safeItemField(item, "DOI"),
    abstract: safeItemField(item, "abstractNote")
  };
  const text = await safePdfAttachmentText(pdf);
  const pdfPath = await safePdfPath(pdf);
  const annotationsText = await readPdfAnnotations(pdf);
  const annotationCount = countAnnotationEntries(pdf);
  const notesResult = await readChildNotesWithCount(item);
  const notesText = notesResult.text;
  const summaryText = await readExistingSummaryText(item, outputDir);
  const chunks = [
    ...chunkText(Object.entries(metadata).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\n"), "metadata", 1200),
    ...chunkText(metadata.abstract, "abstract", 1200),
    ...chunkText(text, "fulltext", 1800),
    ...chunkText(annotationsText, "annotation", 1200),
    ...chunkText(notesText, "note", 1200),
    ...chunkText(summaryText, "summary", 1400)
  ];
  return {
    metadata,
    chunks,
    diagnostics: {
      hasPdf: !!pdf,
      pdfPathAvailable: !pdf || !!pdfPath,
      fulltextChars: text.length,
      annotationCount,
      noteCount: notesResult.count,
      summaryChars: summaryText.trim().length,
      chunkCount: chunks.length
    }
  };
}

async function buildComparisonContexts(items, outputDir) {
  const contexts = [];
  for (const item of uniqueZoteroItems(items).slice(0, MAX_COMPARISON_PAPERS)) {
    try {
      const pdf = await findPdfAttachment(item);
      const context = await buildPaperContext(item, pdf, outputDir);
      contexts.push({
        itemID: item?.id || 0,
        itemKey: item?.key || "",
        pdfKey: pdf?.key || "",
        metadata: context.metadata,
        chunks: context.chunks,
        diagnostics: context.diagnostics
      });
    } catch (err) {
      contexts.push({
        itemID: item?.id || 0,
        itemKey: item?.key || "",
        pdfKey: "",
        metadata: {
          title: item?.getField?.("title") || item?.key || "",
          authors: [],
          year: item?.getField?.("date") || "",
          doi: item?.getField?.("DOI") || "",
          abstract: item?.getField?.("abstractNote") || ""
        },
        chunks: [],
        diagnostics: { error: safeError(err), hasPdf: false, chunkCount: 0 }
      });
    }
  }
  return contexts;
}

function safeItemField(item, field) {
  try {
    return item?.getField?.(field) || "";
  } catch (_err) {
    return "";
  }
}

function safeCreators(item) {
  try {
    return item?.getCreators?.().map((creator) => [creator.firstName, creator.lastName].filter(Boolean).join(" ")).filter(Boolean) || [];
  } catch (_err) {
    return [];
  }
}

async function safePdfAttachmentText(pdf) {
  if (!pdf) return "";
  try {
    return String((await pdf.attachmentText) || "").trim();
  } catch (_err) {
    return "";
  }
}

async function safePdfPath(pdf) {
  try {
    return pdf && typeof pdf.getFilePathAsync === "function" ? await pdf.getFilePathAsync() : "";
  } catch (_err) {
    return "";
  }
}

function countAnnotationEntries(pdf) {
  try {
    const annotations = typeof pdf?.getAnnotations === "function" ? pdf.getAnnotations() : [];
    return Array.isArray(annotations) ? annotations.length : 0;
  } catch (_err) {
    return 0;
  }
}

async function readPdfAnnotations(pdf) {
  if (!pdf || typeof pdf.getAnnotations !== "function") return "";
  try {
    const annotations = pdf.getAnnotations() || [];
    return annotations.map((annotation) => {
      const parts = [
        annotation.annotationType ? `type: ${annotation.annotationType}` : "",
        annotation.annotationPageLabel ? `page: ${annotation.annotationPageLabel}` : "",
        annotation.annotationText ? `text: ${annotation.annotationText}` : "",
        annotation.annotationComment ? `comment: ${annotation.annotationComment}` : "",
        annotation.annotationColor ? `color: ${annotation.annotationColor}` : ""
      ].filter(Boolean);
      return parts.join("\n");
    }).filter(Boolean).join("\n\n");
  } catch (_err) {
    return "";
  }
}

async function readChildNotes(item) {
  return (await readChildNotesWithCount(item)).text;
}

async function readChildNotesWithCount(item) {
  let noteIds = [];
  try {
    noteIds = typeof item?.getNotes === "function" ? item.getNotes() : [];
  } catch (_err) {
    noteIds = [];
  }
  const notes = [];
  for (const id of noteIds) {
    try {
      const note = Zotero.Items.get(id);
      const html = note?.getNote?.() || note?.getField?.("note") || "";
      const text = htmlToText(html);
      if (text) notes.push(text);
    } catch (_err) {
      // Keep the paper context usable even if one child note is corrupt.
    }
  }
  return { text: notes.join("\n\n"), count: notes.length };
}

async function readExistingSummaryText(item, outputDir) {
  try {
    const attachment = await findExistingSummaryAttachment(item, outputDir);
    const path = await attachment?.getFilePathAsync?.();
    if (!path || !await IOUtils.exists(path)) return "";
    return await readText(path);
  } catch (_err) {
    return "";
  }
}

function htmlToText(html) {
  const raw = String(html || "").trim();
  if (!raw) return "";
  try {
    return new DOMParser().parseFromString(raw, "text/html").body.textContent?.replace(/\s+/g, " ").trim() || "";
  } catch (_err) {
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function contextForPrompt(context, query) {
  const chunks = selectRelevantChunks(context.chunks, query, 8);
  const metadata = context.metadata;
  const comparisonContexts = Array.isArray(context.comparisonContexts) ? context.comparisonContexts : [];
  return [
    "Paper metadata:",
    `Title: ${metadata.title}`,
    `Authors: ${metadata.authors.join(", ")}`,
    `Year: ${metadata.year}`,
    `DOI: ${metadata.doi}`,
    ...comparisonInstructionLines(comparisonContexts),
    "",
    "Context excerpts:",
    ...chunks.map((chunk) => `${chunkEvidenceLabel(chunk)} ${chunk.text}`),
    ...comparisonContextLines(comparisonContexts, query)
  ].join("\n");
}

function comparisonInstructionLines(comparisonContexts) {
  if (!comparisonContexts.length) return [];
  return [
    "",
    "Cross-paper comparison task:",
    "- Treat the first paper above as the focal paper.",
    "- Compare the focal paper with every comparison paper below across research question, method, data/experiments, assumptions, findings, limitations, and reusable ideas.",
    "- Cite evidence labels from the focal paper and comparison papers when making comparative claims.",
    "- If a comparison dimension is not supported by the available excerpts, mark it as low-confidence."
  ];
}

function comparisonContextLines(comparisonContexts, query) {
  const lines = [];
  comparisonContexts.forEach((entry, index) => {
    const metadata = entry.metadata || {};
    const chunks = selectRelevantChunks(entry.chunks || [], query, 4);
    lines.push(
      "",
      `Comparison paper ${index + 1}:`,
      `Title: ${metadata.title || entry.itemKey || "unknown"}`,
      `Authors: ${Array.isArray(metadata.authors) ? metadata.authors.join(", ") : ""}`,
      `Year: ${metadata.year || ""}`,
      `DOI: ${metadata.doi || ""}`
    );
    if (!chunks.length) {
      lines.push(`[paper${index + 2}:metadata itemKey=${entry.itemKey || "unknown"}] No indexed excerpts available; use metadata only and mark details as low-confidence.`);
      return;
    }
    for (const chunk of chunks) {
      lines.push(`${chunkEvidenceLabel(chunk, `paper${index + 2}`)} ${chunk.text}`);
    }
  });
  return lines;
}

function chunkEvidenceLabel(chunk, prefix = "chunk") {
  const source = chunk.sourceType || "unknown";
  const locator = chunk.locator || "";
  const hash = chunk.sourceHash || "";
  const details = [
    `source=${source}`,
    locator ? `locator=${locator}` : "",
    hash ? `hash=${hash}` : ""
  ].filter(Boolean).join(" ");
  return `[${prefix}:${chunk.chunkId || "unknown"} ${details}]`;
}

function comparisonSummaryText(contexts, uiLanguage) {
  const entries = (contexts || []).map((context) => context?.metadata?.title || context?.itemKey || "").filter(Boolean);
  if (!entries.length) return "";
  const label = uiLanguage === "zh-CN" ? "对比论文" : "Comparison papers";
  return `${label}: ${entries.slice(0, MAX_COMPARISON_PAPERS).join(" | ")}`;
}

function workbenchComparisonContexts(state) {
  const fromContext = Array.isArray(state?.context?.comparisonContexts) ? state.context.comparisonContexts : [];
  const fromState = Array.isArray(state?.comparisonContexts) ? state.comparisonContexts : [];
  return fromContext.length ? fromContext : fromState;
}

function crossReviewPromptWithScope(basePrompt, item, context, comparisonContexts, uiLanguage) {
  const focalTitle = context?.metadata?.title || safeItemField(item, "title") || item?.key || "unknown";
  const comparisons = (comparisonContexts || [])
    .slice(0, MAX_COMPARISON_PAPERS)
    .map((entry, index) => ({
      index: index + 1,
      title: entry?.metadata?.title || entry?.itemKey || `comparison-${index + 1}`,
      year: entry?.metadata?.year || "",
      key: entry?.itemKey || ""
    }));
  if (uiLanguage === "zh-CN") {
    return [
      basePrompt,
      "",
      "综述范围：",
      `- 焦点论文：${focalTitle}`,
      `- 对比论文数量：${comparisons.length}`,
      ...comparisons.map((entry) => `- 对比论文 ${entry.index}：${[entry.title, entry.year, entry.key ? `key=${entry.key}` : ""].filter(Boolean).join("；")}`),
      "",
      "请优先输出可直接进入文献综述正文的分类、对比矩阵、研究空白和段落草稿；所有判断都要使用上下文中的证据标签。"
    ].join("\n");
  }
  return [
    basePrompt,
    "",
    "Review scope:",
    `- Focal paper: ${focalTitle}`,
    `- Comparison paper count: ${comparisons.length}`,
    ...comparisons.map((entry) => `- Comparison paper ${entry.index}: ${[entry.title, entry.year, entry.key ? `key=${entry.key}` : ""].filter(Boolean).join("; ")}`),
    "",
    "Prioritize review-ready taxonomy, comparison matrix, research gaps, and draft paragraphs. Cite evidence labels from the provided context for every judgment."
  ].join("\n");
}

function renderReadingLogMarkdown(context, options = {}) {
  const labels = readingLogLabels(options.outputLanguage);
  const metadata = context?.metadata || {};
  const diagnostics = context?.diagnostics || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const itemKey = options.item?.key || "";
  const collectionKey = workbenchCollectionKey(options.item);
  const dimensions = readingLogDimensions(labels);
  const lines = [
    "---",
    "templateVersion: paper-reading-log-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `itemKey: ${yamlScalar(itemKey)}`,
    `contextSourceHash: ${yamlScalar(options.contextSourceHash || "")}`,
    `logPath: ${yamlScalar(options.logPath || "")}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.paperTitle}: ${mdText(metadata.title || itemKey || "")}`,
    `- ${labels.authors}: ${mdText(Array.isArray(metadata.authors) ? metadata.authors.join(", ") : "")}`,
    `- ${labels.year}: ${mdText(metadata.year || "")}`,
    `- DOI: ${mdText(metadata.doi || "")}`,
    `- ${labels.generatedAt}: ${generatedAt}`,
    `- ${labels.logFile}: ${mdText(options.logPath || "")}`,
    "",
    `## ${labels.contextQuality}`,
    "",
    `- ${labels.chunks}: ${Number(diagnostics.chunkCount) || 0}`,
    `- ${labels.fulltextChars}: ${Number(diagnostics.fulltextChars) || 0}`,
    `- ${labels.annotations}: ${Number(diagnostics.annotationCount) || 0}`,
    `- ${labels.notesCount}: ${Number(diagnostics.noteCount) || 0}`,
    `- ${labels.summaryChars}: ${Number(diagnostics.summaryChars) || 0}`,
    ...(diagnostics.error ? [`- ${labels.error}: ${mdText(diagnostics.error)}`] : []),
    "",
    `## ${labels.checklist}`,
    "",
    `- [ ] ${labels.checkProblem}`,
    `- [ ] ${labels.checkMethod}`,
    `- [ ] ${labels.checkEvidence}`,
    `- [ ] ${labels.checkLimits}`,
    `- [ ] ${labels.checkReuse}`,
    "",
    `## ${labels.structuredNotes}`,
    ""
  ];
  for (const dimension of dimensions) {
    const evidence = readingLogEvidenceForDimension(context, dimension, 3);
    lines.push(
      `### ${dimension.label}`,
      "",
      `- ${labels.evidence}: ${evidence.length ? evidence.map((item) => `${item.label} ${truncateText(item.text, 220)}`).join("<br>") : labels.noEvidence}`,
      `- ${labels.notes}: `,
      `- ${labels.confidence}: `,
      ""
    );
  }
  lines.push(
    `## ${labels.evidenceIndex}`,
    ""
  );
  const overview = readingLogEvidenceForDimension(context, readingLogOverviewDimension(labels), 8);
  if (overview.length) {
    for (const item of overview) lines.push(`- ${item.label} ${truncateText(item.text, 360)}`);
  } else {
    lines.push(`- ${labels.noEvidence}`);
  }
  lines.push(
    "",
    `## ${labels.reusePlan}`,
    "",
    `- ${labels.reviewUse}: `,
    `- ${labels.methodUse}: `,
    `- ${labels.experimentUse}: `,
    `- ${labels.followUp}: `,
    ""
  );
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function readingLogEvidenceForDimension(context, dimension, limit = 3) {
  return selectRelevantChunks(context?.chunks || [], dimension.query, limit)
    .map((chunk) => ({
      label: chunkEvidenceLabel(chunk),
      text: chunk.text || ""
    }))
    .filter((item) => item.text);
}

function readingLogDimensions(labels) {
  return [
    { id: "problem", label: labels.researchProblem, query: "research question problem objective motivation gap 研究问题 研究目标 问题 动机 空白" },
    { id: "method", label: labels.method, query: "method model algorithm framework architecture 方法 模型 算法 框架 结构" },
    { id: "evidence", label: labels.evidenceAndResults, query: "experiment result metric dataset evaluation finding 实验 结果 指标 数据集 评估 发现" },
    { id: "limitation", label: labels.limitations, query: "limitation weakness threat failure future 局限 不足 威胁 失败 未来" },
    { id: "reuse", label: labels.reusableIdeas, query: "reuse implication insight contribution idea design 可复用 启发 贡献 思路 设计" }
  ];
}

function readingLogOverviewDimension(labels) {
  return {
    id: "overview",
    label: labels.evidenceIndex,
    query: "summary abstract contribution method experiment result limitation 摘要 贡献 方法 实验 结果 局限"
  };
}

function readingLogLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "论文阅读日志",
      paperTitle: "题名",
      authors: "作者",
      year: "年份",
      generatedAt: "生成时间",
      logFile: "日志文件",
      contextQuality: "上下文质量",
      chunks: "片段",
      fulltextChars: "全文字符",
      annotations: "注释",
      notesCount: "笔记",
      summaryChars: "已有摘要字符",
      error: "错误",
      checklist: "阅读核对清单",
      checkProblem: "确认论文解决的问题、对象和适用场景。",
      checkMethod: "记录核心方法、模型结构或算法流程。",
      checkEvidence: "核对数据、实验指标、结果和证据标签。",
      checkLimits: "标注局限、失败条件和不确定性。",
      checkReuse: "提炼可写入综述、开题或方法复现的要点。",
      structuredNotes: "结构化笔记",
      researchProblem: "研究问题",
      method: "方法/模型",
      evidenceAndResults: "证据与结果",
      limitations: "局限与不确定性",
      reusableIdeas: "可复用思想",
      evidence: "证据",
      notes: "笔记",
      confidence: "置信度",
      noEvidence: "暂无可用证据片段，请人工补充或等待 Zotero 完成全文索引。",
      evidenceIndex: "证据摘录索引",
      reusePlan: "复用计划",
      reviewUse: "综述写作用途",
      methodUse: "方法复现/借鉴",
      experimentUse: "实验对比用途",
      followUp: "后续问题"
    };
  }
  return {
    title: "Paper Reading Log",
    paperTitle: "Title",
    authors: "Authors",
    year: "Year",
    generatedAt: "Generated at",
    logFile: "Log file",
    contextQuality: "Context Quality",
    chunks: "chunks",
    fulltextChars: "fulltext chars",
    annotations: "annotations",
    notesCount: "notes",
    summaryChars: "existing summary chars",
    error: "error",
    checklist: "Reading Checklist",
    checkProblem: "Confirm the research problem, object, and applicable scenario.",
    checkMethod: "Record the core method, model structure, or algorithm flow.",
    checkEvidence: "Check data, metrics, results, and evidence labels.",
    checkLimits: "Mark limitations, failure conditions, and uncertainty.",
    checkReuse: "Extract points reusable in a review, proposal, or reproduction plan.",
    structuredNotes: "Structured Notes",
    researchProblem: "Research Problem",
    method: "Method / Model",
    evidenceAndResults: "Evidence and Results",
    limitations: "Limitations and Uncertainty",
    reusableIdeas: "Reusable Ideas",
    evidence: "Evidence",
    notes: "Notes",
    confidence: "Confidence",
    noEvidence: "No evidence excerpts are available yet; add notes manually or wait for Zotero full-text indexing.",
    evidenceIndex: "Evidence Excerpt Index",
    reusePlan: "Reuse Plan",
    reviewUse: "Review-writing use",
    methodUse: "Method reuse",
    experimentUse: "Experiment comparison use",
    followUp: "Follow-up questions"
  };
}

function renderComparisonReportMarkdown(context, options = {}) {
  const labels = comparisonReportLabels(options.outputLanguage);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const focal = {
    role: labels.focal,
    evidencePrefix: "chunk",
    itemKey: options.item?.key || "",
    metadata: context?.metadata || {},
    chunks: context?.chunks || [],
    diagnostics: context?.diagnostics || {}
  };
  const comparisons = (context?.comparisonContexts || []).map((entry, index) => ({
    role: `${labels.comparison} ${index + 1}`,
    evidencePrefix: `paper${index + 2}`,
    itemKey: entry.itemKey || "",
    metadata: entry.metadata || {},
    chunks: entry.chunks || [],
    diagnostics: entry.diagnostics || {}
  }));
  const contexts = [focal, ...comparisons];
  const collectionKey = workbenchCollectionKey(options.item);
  const dimensions = comparisonReportDimensions(labels);
  const lines = [
    "---",
    "templateVersion: literature-matrix-v1",
    "synthesisVersion: evidence-synthesis-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `focalItemKey: ${yamlScalar(focal.itemKey)}`,
    `comparisonCount: ${comparisons.length}`,
    `contextSourceHash: ${yamlScalar(options.contextSourceHash || "")}`,
    `reportPath: ${yamlScalar(options.reportPath || "")}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.focalPaper}: ${mdText(focal.metadata.title || focal.itemKey || "")}`,
    `- ${labels.comparisonCount}: ${comparisons.length}`,
    `- ${labels.generatedAt}: ${generatedAt}`,
    `- ${labels.reportFile}: ${mdText(options.reportPath || "")}`,
    "",
    `## ${labels.inventory}`,
    "",
    `| ${labels.role} | ${labels.evidence} | ${labels.paperTitle} | ${labels.authors} | ${labels.year} | DOI | ${labels.contextQuality} |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...contexts.map((entry) => comparisonInventoryRow(entry, labels)),
    "",
    `## ${labels.matrix}`,
    ""
  ];
  for (const dimension of dimensions) {
    lines.push(
      `### ${dimension.label}`,
      "",
      `| ${labels.paper} | ${labels.evidenceExcerpts} | ${labels.manualJudgment} |`,
      "| --- | --- | --- |"
    );
    for (const entry of contexts) {
      lines.push(comparisonDimensionRow(entry, dimension, labels));
    }
    lines.push("");
  }
  lines.push(
    `## ${labels.synthesis}`,
    "",
    `### ${labels.coverageMap}`,
    "",
    `| ${labels.dimension} | ${labels.coverage} | ${labels.sharedSignals} | ${labels.evidenceLabels} | ${labels.followUp} |`,
    "| --- | --- | --- | --- | --- |",
    ...comparisonSynthesisRows(contexts, dimensions, labels),
    "",
    `### ${labels.pairwiseContrasts}`,
    "",
    `| ${labels.comparisonPaper} | ${labels.method} | ${labels.dataExperiment} | ${labels.finding} | ${labels.limitation} | ${labels.followUp} |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...comparisonPairwiseContrastRows(focal, comparisons, labels),
    "",
    `### ${labels.gapLedger}`,
    "",
    `| ${labels.dimension} | ${labels.paper} | ${labels.gap} | ${labels.followUp} |`,
    "| --- | --- | --- | --- |",
    ...comparisonGapLedgerRows(contexts, dimensions, labels),
    ""
  );
  lines.push(
    `## ${labels.crossAnalysis}`,
    "",
    `- [ ] ${labels.sharedAssumptions}`,
    `- [ ] ${labels.keyDifferences}`,
    `- [ ] ${labels.evidenceStrength}`,
    `- [ ] ${labels.conflicts}`,
    `- [ ] ${labels.reviewDraftNotes}`,
    "",
    `## ${labels.evidenceMap}`,
    ""
  );
  for (const entry of contexts) {
    lines.push(`### ${entry.role}: ${mdText(entry.metadata.title || entry.itemKey || "")}`, "");
    const evidence = comparisonEvidenceForContext(entry, comparisonEvidenceOverviewDimension(labels), labels, 5);
    if (evidence.length) {
      for (const item of evidence) lines.push(`- ${item.label} ${truncateText(item.text, 360)}`);
    } else {
      lines.push(`- ${comparisonMetadataLabel(entry)} ${labels.metadataOnly}`);
    }
    lines.push("");
  }
  lines.push(`## ${labels.notes}`, "", `- ${labels.notesPlaceholder}`, "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function comparisonInventoryRow(entry, labels) {
  const metadata = entry.metadata || {};
  const authors = Array.isArray(metadata.authors) ? metadata.authors.join(", ") : "";
  return [
    entry.role,
    comparisonMetadataLabel(entry),
    metadata.title || entry.itemKey || "",
    authors,
    metadata.year || "",
    metadata.doi || "",
    comparisonContextQuality(entry.diagnostics, labels)
  ].map(markdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function comparisonDimensionRow(entry, dimension, labels) {
  const evidence = comparisonEvidenceForContext(entry, dimension, labels, 3);
  const evidenceText = evidence.length
    ? evidence.map((item) => `${item.label} ${truncateText(item.text, 240)}`).join("<br>")
    : `${comparisonMetadataLabel(entry)} ${labels.metadataOnly}`;
  return [
    entry.role,
    evidenceText,
    labels.manualPlaceholder
  ].map(markdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function comparisonEvidenceForContext(entry, dimension, labels, limit = 3) {
  const chunks = selectRelevantChunks(entry.chunks || [], dimension.query, limit);
  return chunks.map((chunk) => ({
    label: chunkEvidenceLabel(chunk, entry.evidencePrefix || "chunk"),
    text: chunk.text || ""
  })).filter((item) => item.text);
}

function comparisonSynthesisRows(contexts, dimensions, labels) {
  return dimensions.map((dimension) => {
    const evidenceByContext = contexts.map((entry) => ({
      entry,
      evidence: comparisonEvidenceForContext(entry, dimension, labels, 2)
    }));
    const covered = evidenceByContext.filter((item) => item.evidence.length);
    const evidenceLabels = covered
      .map((item) => item.evidence.map((evidence) => evidence.label).join("<br>"))
      .filter(Boolean)
      .join("<br>");
    return [
      dimension.label,
      `${covered.length}/${contexts.length}`,
      comparisonSharedSignals(covered.map((item) => item.evidence.map((evidence) => evidence.text).join(" ")), labels),
      evidenceLabels || labels.noEvidence,
      comparisonCoverageFollowUp(covered.length, contexts.length, labels)
    ].map(markdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
  });
}

function comparisonPairwiseContrastRows(focal, comparisons, labels) {
  const dimensions = comparisonPairwiseDimensions(labels);
  if (!comparisons.length) {
    return [`| ${labels.noComparisonPaper} | ${labels.metadataOnly} | ${labels.metadataOnly} | ${labels.metadataOnly} | ${labels.metadataOnly} | ${labels.selectComparisonPapers} |`];
  }
  return comparisons.map((entry) => {
    const cells = [comparisonMetadataLabel(entry)];
    for (const dimension of dimensions) {
      const focalEvidence = comparisonEvidenceForContext(focal, dimension, labels, 1);
      const comparisonEvidence = comparisonEvidenceForContext(entry, dimension, labels, 1);
      cells.push(comparisonPairwiseEvidenceCell(focalEvidence, comparisonEvidence, labels));
    }
    cells.push(labels.pairwiseFollowUp);
    return cells.map(markdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
  });
}

function comparisonPairwiseDimensions(labels) {
  return [
    { id: "method", label: labels.method, query: "method model algorithm framework architecture 方法 模型 算法 框架 结构" },
    { id: "dataExperiment", label: labels.dataExperiment, query: "experiment dataset data metric evaluation result 实验 数据集 指标 评估 结果" },
    { id: "finding", label: labels.finding, query: "finding conclusion contribution result insight 发现 结论 贡献 结果" },
    { id: "limitation", label: labels.limitation, query: "limitation weakness threat failure future 局限 不足 威胁 失败 未来" }
  ];
}

function comparisonPairwiseEvidenceCell(focalEvidence, comparisonEvidence, labels) {
  const focalLabels = focalEvidence.map((item) => item.label).join("<br>");
  const comparisonLabels = comparisonEvidence.map((item) => item.label).join("<br>");
  if (focalLabels && comparisonLabels) return `${labels.focal}: ${focalLabels}<br>${labels.comparison}: ${comparisonLabels}`;
  if (focalLabels) return `${labels.focal}: ${focalLabels}<br>${labels.comparisonMissing}`;
  if (comparisonLabels) return `${labels.focalMissing}<br>${labels.comparison}: ${comparisonLabels}`;
  return labels.noEvidence;
}

function comparisonGapLedgerRows(contexts, dimensions, labels) {
  const rows = [];
  for (const dimension of dimensions) {
    for (const entry of contexts) {
      const evidence = comparisonEvidenceForContext(entry, dimension, labels, 1);
      if (evidence.length) continue;
      rows.push([
        dimension.label,
        `${entry.role}: ${entry.metadata?.title || entry.itemKey || ""}`,
        comparisonContextQuality(entry.diagnostics, labels) || labels.metadataOnly,
        labels.gapFollowUp
      ].map(markdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }
  return rows.length ? rows : [`| ${labels.allDimensions} | ${labels.allPapers} | ${labels.noMajorGap} | ${labels.verifyEvidence} |`];
}

function comparisonSharedSignals(texts, labels) {
  const counts = new Map();
  for (const text of texts || []) {
    const terms = new Set(comparisonSignalTerms(text));
    for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
  }
  const shared = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term)
    .slice(0, 6);
  return shared.length ? shared.join(", ") : labels.noSharedSignals;
}

function comparisonSignalTerms(text) {
  const stopwords = new Set([
    "about", "above", "after", "again", "algorithm", "analysis", "based", "between", "could", "dataset",
    "datasets", "different", "during", "experimental", "experiments", "finding", "findings", "framework",
    "larger", "method", "methods", "model", "models", "paper", "proposed", "reports", "results", "scenario",
    "scenarios", "shows", "study", "system", "these", "using", "which", "with", "without"
  ]);
  return String(text || "").toLowerCase()
    .match(/[a-z][a-z0-9-]{4,}/g)?.filter((term) => !stopwords.has(term)).slice(0, 40) || [];
}

function comparisonCoverageFollowUp(coveredCount, totalCount, labels) {
  if (totalCount > 0 && coveredCount === totalCount) return labels.coverageAllFollowUp;
  if (coveredCount > 0) return labels.coveragePartialFollowUp;
  return labels.coverageMissingFollowUp;
}

function comparisonMetadataLabel(entry) {
  return `[${entry.evidencePrefix || "chunk"}:metadata itemKey=${entry.itemKey || "unknown"}]`;
}

function comparisonContextQuality(diagnostics, labels) {
  if (!diagnostics) return labels.unknown;
  const parts = [
    `${labels.chunks}: ${Number(diagnostics.chunkCount) || 0}`,
    `${labels.fulltextChars}: ${Number(diagnostics.fulltextChars) || 0}`,
    `${labels.annotations}: ${Number(diagnostics.annotationCount) || 0}`,
    `${labels.notesCount}: ${Number(diagnostics.noteCount) || 0}`,
    diagnostics.error ? `${labels.error}: ${diagnostics.error}` : ""
  ].filter(Boolean);
  return parts.join("; ");
}

function comparisonReportDimensions(labels) {
  return [
    { id: "researchQuestion", label: labels.researchQuestion, query: "research question objective problem motivation 研究问题 研究目标 问题 背景 动机" },
    { id: "method", label: labels.method, query: "method model algorithm framework architecture 方法 模型 算法 框架 结构" },
    { id: "dataExperiment", label: labels.dataExperiment, query: "experiment dataset data metric evaluation result 实验 数据集 指标 评估 结果" },
    { id: "assumption", label: labels.assumption, query: "assumption setting condition scenario limitation 假设 条件 场景 约束" },
    { id: "finding", label: labels.finding, query: "finding conclusion contribution result insight 发现 结论 贡献 结果" },
    { id: "limitation", label: labels.limitation, query: "limitation weakness threat failure future 局限 不足 威胁 失败 未来" },
    { id: "reusableIdea", label: labels.reusableIdea, query: "reuse reusable idea implication design lesson 可复用 启发 借鉴 设计 经验" }
  ];
}

function comparisonEvidenceOverviewDimension(labels) {
  return {
    id: "overview",
    label: labels.evidenceMap,
    query: "summary abstract conclusion method experiment limitation contribution 摘要 方法 实验 结论 局限 贡献"
  };
}

function comparisonReportLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "文献对比矩阵",
      focal: "焦点论文",
      comparison: "对比论文",
      focalPaper: "焦点论文",
      comparisonCount: "对比论文数",
      generatedAt: "生成时间",
      reportFile: "报告文件",
      inventory: "论文清单",
      role: "角色",
      evidence: "证据标签",
      paperTitle: "题名",
      authors: "作者",
      year: "年份",
      contextQuality: "上下文质量",
      matrix: "对比矩阵",
      synthesis: "跨文献综合",
      coverageMap: "证据覆盖图",
      pairwiseContrasts: "两两对比",
      gapLedger: "缺口台账",
      dimension: "维度",
      coverage: "覆盖",
      sharedSignals: "共同信号",
      evidenceLabels: "证据标签",
      followUp: "下一步",
      comparisonPaper: "对比论文",
      gap: "缺口",
      paper: "论文",
      evidenceExcerpts: "证据摘录",
      manualJudgment: "人工判断",
      manualPlaceholder: "补充判断、置信度和综述写作位置",
      crossAnalysis: "横向分析清单",
      sharedAssumptions: "归纳共同假设和共同适用场景。",
      keyDifferences: "标出方法、数据、评价指标和结论的关键差异。",
      evidenceStrength: "检查每个结论是否有证据标签支撑，并标注低置信度单元。",
      conflicts: "记录可能矛盾的发现或不可直接比较的条件。",
      reviewDraftNotes: "提炼可写入综述的小标题和段落要点。",
      evidenceMap: "证据摘录索引",
      notes: "人工备注",
      notesPlaceholder: "在这里记录最终纳入综述的分类、段落位置和后续检索需求。",
      chunks: "片段",
      fulltextChars: "全文字符",
      annotations: "注释",
      notesCount: "笔记",
      error: "错误",
      unknown: "未知",
      metadataOnly: "仅有题录或上下文不足，请低置信度处理。",
      noEvidence: "暂无证据标签",
      noSharedSignals: "暂无稳定共同信号",
      noComparisonPaper: "暂无对比论文",
      selectComparisonPapers: "在 Zotero 中多选文献后重新打开工作台。",
      comparisonMissing: "对比论文缺少该维度证据",
      focalMissing: "焦点论文缺少该维度证据",
      pairwiseFollowUp: "核对证据后写成相同点、差异点和不可比条件。",
      gapFollowUp: "补充全文、批注或摘要证据，再重新导出矩阵。",
      coverageAllFollowUp: "可提炼共同主张、差异条件和综述段落。",
      coveragePartialFollowUp: "先补齐缺失论文证据，再做结论比较。",
      coverageMissingFollowUp: "需要回到 PDF、摘要或笔记补充证据。",
      allDimensions: "所有维度",
      allPapers: "所有论文",
      noMajorGap: "当前抽取范围内未发现明显缺口。",
      verifyEvidence: "人工复核证据标签后使用。",
      researchQuestion: "研究问题",
      method: "方法/模型",
      dataExperiment: "数据与实验",
      assumption: "假设与场景",
      finding: "核心发现",
      limitation: "局限",
      reusableIdea: "可复用思想"
    };
  }
  return {
    title: "Literature Matrix",
    focal: "Focal paper",
    comparison: "Comparison paper",
    focalPaper: "Focal paper",
    comparisonCount: "Comparison papers",
    generatedAt: "Generated at",
    reportFile: "Report file",
    inventory: "Paper Inventory",
    role: "Role",
    evidence: "Evidence label",
    paperTitle: "Title",
    authors: "Authors",
    year: "Year",
    contextQuality: "Context quality",
    matrix: "Comparison Matrix",
    synthesis: "Cross-paper Synthesis",
    coverageMap: "Evidence Coverage Map",
    pairwiseContrasts: "Pairwise Contrasts",
    gapLedger: "Gap Ledger",
    dimension: "Dimension",
    coverage: "Coverage",
    sharedSignals: "Shared signals",
    evidenceLabels: "Evidence labels",
    followUp: "Follow-up",
    comparisonPaper: "Comparison paper",
    gap: "Gap",
    paper: "Paper",
    evidenceExcerpts: "Evidence excerpts",
    manualJudgment: "Manual judgment",
    manualPlaceholder: "Add judgment, confidence, and review-writing placement",
    crossAnalysis: "Cross-paper Analysis Checklist",
    sharedAssumptions: "Summarize shared assumptions and applicable scenarios.",
    keyDifferences: "Mark decisive differences in method, data, metrics, and conclusions.",
    evidenceStrength: "Check whether every claim has evidence labels and mark low-confidence cells.",
    conflicts: "Record conflicting findings or conditions that prevent direct comparison.",
    reviewDraftNotes: "Extract review section headings and paragraph notes.",
    evidenceMap: "Evidence Excerpt Index",
    notes: "Manual Notes",
    notesPlaceholder: "Record final taxonomy placement, section use, and follow-up search needs here.",
    chunks: "chunks",
    fulltextChars: "fulltext chars",
    annotations: "annotations",
    notesCount: "notes",
    error: "error",
    unknown: "unknown",
    metadataOnly: "Metadata only or insufficient context; treat as low-confidence.",
    noEvidence: "No evidence labels yet",
    noSharedSignals: "No stable shared signals yet",
    noComparisonPaper: "No comparison paper",
    selectComparisonPapers: "Select multiple Zotero papers and reopen the workbench.",
    comparisonMissing: "Comparison paper lacks evidence for this dimension",
    focalMissing: "Focal paper lacks evidence for this dimension",
    pairwiseFollowUp: "After checking evidence, write similarities, differences, and non-comparable conditions.",
    gapFollowUp: "Add full text, annotations, or abstract evidence, then export the matrix again.",
    coverageAllFollowUp: "Ready to draft shared claims, boundary conditions, and review paragraphs.",
    coveragePartialFollowUp: "Fill missing paper evidence before making a comparative conclusion.",
    coverageMissingFollowUp: "Return to PDFs, abstracts, or notes to add evidence.",
    allDimensions: "All dimensions",
    allPapers: "All papers",
    noMajorGap: "No obvious gap found in the extracted context.",
    verifyEvidence: "Verify evidence labels manually before using.",
    researchQuestion: "Research Question",
    method: "Method / Model",
    dataExperiment: "Data and Experiments",
    assumption: "Assumptions and Scenario",
    finding: "Key Findings",
    limitation: "Limitations",
    reusableIdea: "Reusable Ideas"
  };
}

function renderReviewDraftMarkdown(context, options = {}) {
  const labels = reviewDraftLabels(options.outputLanguage);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const focal = {
    role: labels.focal,
    evidencePrefix: "chunk",
    itemKey: options.item?.key || "",
    metadata: context?.metadata || {},
    chunks: context?.chunks || [],
    diagnostics: context?.diagnostics || {}
  };
  const comparisons = (context?.comparisonContexts || []).map((entry, index) => ({
    role: `${labels.comparison} ${index + 1}`,
    evidencePrefix: `paper${index + 2}`,
    itemKey: entry.itemKey || "",
    metadata: entry.metadata || {},
    chunks: entry.chunks || [],
    diagnostics: entry.diagnostics || {}
  }));
  const papers = [focal, ...comparisons];
  const collectionKey = workbenchCollectionKey(options.item);
  const sections = reviewDraftSections(labels);
  const lines = [
    "---",
    "templateVersion: formal-review-draft-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `focalItemKey: ${yamlScalar(focal.itemKey)}`,
    `comparisonCount: ${comparisons.length}`,
    `contextSourceHash: ${yamlScalar(options.contextSourceHash || "")}`,
    `draftPath: ${yamlScalar(options.draftPath || "")}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.focalPaper}: ${mdText(focal.metadata.title || focal.itemKey || "")}`,
    `- ${labels.comparisonCount}: ${comparisons.length}`,
    `- ${labels.generatedAt}: ${generatedAt}`,
    `- ${labels.draftFile}: ${mdText(options.draftPath || "")}`,
    "",
    `## ${labels.positioning}`,
    "",
    `- ${labels.reviewTopic}: `,
    `- ${labels.targetQuestion}: `,
    `- ${labels.scopeBoundary}: `,
    `- ${labels.inclusionRule}: `,
    `- ${labels.mainClaim}: `,
    "",
    `## ${labels.paperInventory}`,
    "",
    `| ${labels.role} | ${labels.evidence} | ${labels.paperTitle} | ${labels.authors} | ${labels.year} | DOI | ${labels.contextQuality} |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...papers.map((entry) => comparisonInventoryRow(entry, labels)),
    "",
    `## ${labels.argumentSpine}`,
    "",
    `- [ ] ${labels.spineBackground}`,
    `- [ ] ${labels.spineTaxonomy}`,
    `- [ ] ${labels.spineEvidence}`,
    `- [ ] ${labels.spineGap}`,
    `- [ ] ${labels.spineBridge}`,
    "",
    `## ${labels.taxonomy}`,
    "",
    `| ${labels.dimension} | ${labels.evidenceExcerpts} | ${labels.draftNote} |`,
    "| --- | --- | --- |"
  ];
  for (const section of sections) {
    const evidence = reviewDraftEvidenceAcrossPapers(papers, section, labels, 2);
    lines.push([
      section.label,
      evidence.length ? evidence.map((item) => `${item.label} ${truncateText(item.text, 220)}`).join("<br>") : labels.noEvidence,
      labels.manualPlaceholder
    ].map(markdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push(
    "",
    `## ${labels.synthesis}`,
    ""
  );
  for (const section of sections) {
    const evidence = reviewDraftEvidenceAcrossPapers(papers, section, labels, 3);
    lines.push(
      `### ${section.label}`,
      "",
      `- ${labels.keyEvidence}: ${evidence.length ? evidence.map((item) => `${item.label} ${truncateText(item.text, 240)}`).join("<br>") : labels.noEvidence}`,
      `- ${labels.draftParagraph}: `,
      `- ${labels.confidenceAndGaps}: `,
      ""
    );
  }
  lines.push(
    `## ${labels.risks}`,
    "",
    `- [ ] ${labels.riskEvidence}`,
    `- [ ] ${labels.riskComparability}`,
    `- [ ] ${labels.riskMissingPapers}`,
    `- [ ] ${labels.riskTerminology}`,
    "",
    `## ${labels.writingPlan}`,
    "",
    `- ${labels.sectionPlan}: `,
    `- ${labels.transitionPlan}: `,
    `- ${labels.figureTablePlan}: `,
    `- ${labels.followUpSearch}: `,
    "",
    `## ${labels.evidenceIndex}`,
    ""
  );
  for (const paper of papers) {
    lines.push(`### ${paper.role}: ${mdText(paper.metadata.title || paper.itemKey || "")}`, "");
    const evidence = comparisonEvidenceForContext(paper, reviewDraftOverviewDimension(labels), labels, 6);
    if (evidence.length) {
      for (const item of evidence) lines.push(`- ${item.label} ${truncateText(item.text, 360)}`);
    } else {
      lines.push(`- ${comparisonMetadataLabel(paper)} ${labels.metadataOnly}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function reviewDraftEvidenceAcrossPapers(papers, section, labels, limitPerPaper = 2) {
  const evidence = [];
  for (const paper of papers || []) {
    const selected = comparisonEvidenceForContext(paper, section, labels, limitPerPaper);
    evidence.push(...selected.map((item) => ({
      ...item,
      role: paper.role
    })));
  }
  return evidence;
}

function reviewDraftSections(labels) {
  return [
    { id: "background", label: labels.background, query: "background motivation problem gap challenge 背景 动机 问题 空白 挑战" },
    { id: "methodTaxonomy", label: labels.methodTaxonomy, query: "method model algorithm taxonomy framework category 方法 模型 算法 分类 框架" },
    { id: "dataEvidence", label: labels.dataEvidence, query: "experiment data dataset metric evaluation result evidence 实验 数据 指标 评估 结果 证据" },
    { id: "findings", label: labels.findings, query: "finding conclusion contribution insight result 发现 结论 贡献 启发 结果" },
    { id: "limitations", label: labels.limitations, query: "limitation weakness failure threat validity future 局限 不足 失败 威胁 有效性 未来" },
    { id: "futureWork", label: labels.futureWork, query: "future work open question research agenda next step 未来 开放问题 后续 研究议程" }
  ];
}

function reviewDraftOverviewDimension(labels) {
  return {
    id: "overview",
    label: labels.evidenceIndex,
    query: "summary abstract method experiment result limitation contribution review 摘要 方法 实验 结果 局限 贡献 综述"
  };
}

function reviewDraftLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "正式综述草稿",
      focal: "焦点论文",
      comparison: "对比论文",
      focalPaper: "焦点论文",
      comparisonCount: "对比论文数",
      generatedAt: "生成时间",
      draftFile: "草稿文件",
      positioning: "写作定位",
      reviewTopic: "综述主题",
      targetQuestion: "核心问题",
      scopeBoundary: "范围边界",
      inclusionRule: "纳入规则",
      mainClaim: "拟写主线",
      paperInventory: "论文清单",
      role: "角色",
      evidence: "证据标签",
      paperTitle: "题名",
      authors: "作者",
      year: "年份",
      contextQuality: "上下文质量",
      argumentSpine: "论证骨架",
      spineBackground: "用一段话说明领域背景和问题压力。",
      spineTaxonomy: "给出方法分类或研究脉络。",
      spineEvidence: "用证据标签支撑关键判断。",
      spineGap: "指出现有方法的局限和证据缺口。",
      spineBridge: "衔接到下一步研究或实验设计。",
      taxonomy: "方法分类与证据矩阵",
      dimension: "维度",
      evidenceExcerpts: "证据摘录",
      draftNote: "草稿要点",
      manualPlaceholder: "补充段落判断、置信度和可写位置",
      synthesis: "证据综合草稿",
      keyEvidence: "关键证据",
      draftParagraph: "草稿段落",
      confidenceAndGaps: "置信度与缺口",
      risks: "风险与核查点",
      riskEvidence: "检查是否存在无证据支撑的概括。",
      riskComparability: "确认不同论文的数据、场景和指标是否可比较。",
      riskMissingPapers: "记录仍需补充检索的代表性论文。",
      riskTerminology: "统一术语、缩写和分类边界。",
      writingPlan: "写作计划",
      sectionPlan: "章节安排",
      transitionPlan: "段落衔接",
      figureTablePlan: "图表或表格计划",
      followUpSearch: "后续检索",
      evidenceIndex: "证据摘录索引",
      background: "背景与问题压力",
      methodTaxonomy: "方法谱系",
      dataEvidence: "数据、实验与指标",
      findings: "核心发现",
      limitations: "局限与适用边界",
      futureWork: "后续研究线索",
      chunks: "片段",
      fulltextChars: "全文字符",
      annotations: "注释",
      notesCount: "笔记",
      error: "错误",
      unknown: "未知",
      noEvidence: "暂无可用证据片段，请人工补充或等待 Zotero 完成全文索引。",
      metadataOnly: "仅有题录或上下文不足，请低置信度处理。"
    };
  }
  return {
    title: "Formal Review Draft",
    focal: "Focal paper",
    comparison: "Comparison paper",
    focalPaper: "Focal paper",
    comparisonCount: "Comparison papers",
    generatedAt: "Generated at",
    draftFile: "Draft file",
    positioning: "Review Positioning",
    reviewTopic: "Review topic",
    targetQuestion: "Target question",
    scopeBoundary: "Scope boundary",
    inclusionRule: "Inclusion rule",
    mainClaim: "Main claim",
    paperInventory: "Paper Inventory",
    role: "Role",
    evidence: "Evidence label",
    paperTitle: "Title",
    authors: "Authors",
    year: "Year",
    contextQuality: "Context quality",
    argumentSpine: "Argument Spine",
    spineBackground: "State the field background and problem pressure in one paragraph.",
    spineTaxonomy: "Define a method taxonomy or research lineage.",
    spineEvidence: "Support key judgments with evidence labels.",
    spineGap: "Identify method limits and evidence gaps.",
    spineBridge: "Bridge to the next research step or experiment design.",
    taxonomy: "Method Taxonomy and Evidence Matrix",
    dimension: "Dimension",
    evidenceExcerpts: "Evidence excerpts",
    draftNote: "Draft note",
    manualPlaceholder: "Add paragraph judgment, confidence, and writing placement",
    synthesis: "Evidence-backed Draft Sections",
    keyEvidence: "Key evidence",
    draftParagraph: "Draft paragraph",
    confidenceAndGaps: "Confidence and gaps",
    risks: "Risks and Checks",
    riskEvidence: "Check whether any general claim lacks evidence.",
    riskComparability: "Confirm that data, scenarios, and metrics are comparable.",
    riskMissingPapers: "Record representative papers that still need follow-up search.",
    riskTerminology: "Normalize terminology, abbreviations, and taxonomy boundaries.",
    writingPlan: "Writing Plan",
    sectionPlan: "Section plan",
    transitionPlan: "Transitions",
    figureTablePlan: "Figure or table plan",
    followUpSearch: "Follow-up search",
    evidenceIndex: "Evidence Excerpt Index",
    background: "Background and Problem Pressure",
    methodTaxonomy: "Method Lineage",
    dataEvidence: "Data, Experiments, and Metrics",
    findings: "Key Findings",
    limitations: "Limitations and Boundary Conditions",
    futureWork: "Future Research Leads",
    chunks: "chunks",
    fulltextChars: "fulltext chars",
    annotations: "annotations",
    notesCount: "notes",
    error: "error",
    unknown: "unknown",
    noEvidence: "No evidence excerpts are available yet; add notes manually or wait for Zotero full-text indexing.",
    metadataOnly: "Metadata only or insufficient context; treat as low-confidence."
  };
}

function renderProposalNoteMarkdown(context, options = {}) {
  const labels = proposalNoteLabels(options.outputLanguage);
  const metadata = context?.metadata || {};
  const diagnostics = context?.diagnostics || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const itemKey = options.item?.key || "";
  const collectionKey = workbenchCollectionKey(options.item);
  const promptPackId = normalizePromptPackId(options.promptPackId || "general");
  const domainChecklist = proposalDomainChecklist(promptPackId, labels);
  const sections = proposalNoteSections(labels);
  const lines = [
    "---",
    "templateVersion: proposal-note-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `itemKey: ${yamlScalar(itemKey)}`,
    `promptPackId: ${yamlScalar(promptPackId)}`,
    `contextSourceHash: ${yamlScalar(options.contextSourceHash || "")}`,
    `notePath: ${yamlScalar(options.notePath || "")}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.paperTitle}: ${mdText(metadata.title || itemKey || "")}`,
    `- ${labels.authors}: ${mdText(Array.isArray(metadata.authors) ? metadata.authors.join(", ") : "")}`,
    `- ${labels.year}: ${mdText(metadata.year || "")}`,
    `- DOI: ${mdText(metadata.doi || "")}`,
    `- ${labels.generatedAt}: ${generatedAt}`,
    `- ${labels.noteFile}: ${mdText(options.notePath || "")}`,
    "",
    `## ${labels.contextQuality}`,
    "",
    `- ${labels.chunks}: ${Number(diagnostics.chunkCount) || 0}`,
    `- ${labels.fulltextChars}: ${Number(diagnostics.fulltextChars) || 0}`,
    `- ${labels.annotations}: ${Number(diagnostics.annotationCount) || 0}`,
    `- ${labels.notesCount}: ${Number(diagnostics.noteCount) || 0}`,
    ...(diagnostics.error ? [`- ${labels.error}: ${mdText(diagnostics.error)}`] : []),
    "",
    `## ${labels.proposalFrame}`,
    "",
    `- ${labels.topic}: `,
    `- ${labels.coreQuestion}: `,
    `- ${labels.researchObject}: `,
    `- ${labels.scopeBoundary}: `,
    `- ${labels.expectedContribution}: `,
    "",
    `## ${labels.domainWritingFormat}`,
    "",
    `- ${labels.promptPack}: ${mdText(domainChecklist.title)}`,
    ...domainChecklist.items.map((item) => `- [ ] ${item}`),
    "",
    `## ${labels.sections}`,
    ""
  ];
  for (const section of sections) {
    const evidence = readingLogEvidenceForDimension(context, section, 3);
    lines.push(
      `### ${section.label}`,
      "",
      `- ${labels.keyEvidence}: ${evidence.length ? evidence.map((item) => `${item.label} ${truncateText(item.text, 240)}`).join("<br>") : labels.noEvidence}`,
      `- ${labels.note}: `,
      `- ${labels.gap}: `,
      `- ${labels.action}: `,
      ""
    );
  }
  lines.push(
    `## ${labels.milestones}`,
    "",
    `- [ ] ${labels.milestoneLiterature}`,
    `- [ ] ${labels.milestoneMethod}`,
    `- [ ] ${labels.milestoneExperiment}`,
    `- [ ] ${labels.milestoneWriting}`,
    "",
    `## ${labels.riskCheck}`,
    "",
    `- [ ] ${labels.riskEvidence}`,
    `- [ ] ${labels.riskScope}`,
    `- [ ] ${labels.riskFeasibility}`,
    `- [ ] ${labels.riskNovelty}`,
    "",
    `## ${labels.evidenceIndex}`,
    ""
  );
  const overview = readingLogEvidenceForDimension(context, proposalOverviewDimension(labels), 8);
  if (overview.length) {
    for (const item of overview) lines.push(`- ${item.label} ${truncateText(item.text, 360)}`);
  } else {
    lines.push(`- ${labels.noEvidence}`);
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function proposalNoteSections(labels) {
  return [
    { id: "background", label: labels.background, query: "background motivation problem gap challenge domain 背景 动机 问题 空白 挑战 领域" },
    { id: "researchQuestion", label: labels.researchQuestion, query: "research question objective hypothesis 研究问题 研究目标 假设" },
    { id: "methodRoute", label: labels.methodRoute, query: "method model algorithm framework route 方法 模型 算法 技术路线 框架" },
    { id: "experimentPlan", label: labels.experimentPlan, query: "experiment dataset metric evaluation baseline 实验 数据集 指标 评价 基线" },
    { id: "innovation", label: labels.innovation, query: "contribution novelty innovation insight 贡献 创新 新颖 启发" },
    { id: "limitations", label: labels.limitations, query: "limitation weakness feasibility risk failure 局限 风险 可行性 失败" }
  ];
}

function proposalOverviewDimension(labels) {
  return {
    id: "proposalOverview",
    label: labels.evidenceIndex,
    query: "summary abstract contribution method experiment limitation future 摘要 贡献 方法 实验 局限 未来"
  };
}

function proposalDomainChecklist(promptPackId, labels) {
  const id = normalizePromptPackId(promptPackId);
  const zh = labels.language === "zh-CN";
  const title = zh ? domainPackLabelZh(id) : domainPackLabelEn(id);
  const packs = zh ? {
    "ai-ml": [
      "明确模型输入输出、训练目标、baseline 与公平对照。",
      "列出数据集、指标、消融、算力预算和复现成本。",
      "把失败模式、泛化边界和安全风险写进可行性分析。"
    ],
    transportation: [
      "明确道路/空域/网络约束、需求流量和运行管理场景。",
      "列出安全、效率、鲁棒性、可扩展性和仿真/实测数据条件。",
      "说明路径规划、控制策略或调度机制如何落到工程验证。"
    ],
    biomedicine: [
      "明确研究设计、样本/队列、干预或暴露和终点指标。",
      "列出偏倚来源、统计不确定性、伦理边界和数据合规要求。",
      "区分机制解释、临床相关性和不能直接外推的结论。"
    ],
    "social-science": [
      "明确理论框架、变量构造、测量有效性和样本代表性。",
      "列出因果识别策略、混杂因素、外部有效性和政策边界。",
      "把可证伪假设与替代解释写进研究设计。"
    ],
    "review-writing": [
      "明确综述分类维度、代表性论文位置和证据强弱。",
      "列出可比较指标、冲突证据、研究空白和后续路线。",
      "把单篇证据和跨论文综合主张分开标注。"
    ],
    general: [
      "明确研究问题、研究对象、证据范围和边界条件。",
      "列出方法、数据、验证指标和可复核证据标签。",
      "把创新点、可行性风险和待补文献分开记录。"
    ]
  } : {
    "ai-ml": [
      "Define model inputs, outputs, training objective, baselines, and fair comparisons.",
      "List datasets, metrics, ablations, compute budget, and reproducibility cost.",
      "Turn failure modes, generalization boundaries, and safety risks into feasibility checks."
    ],
    transportation: [
      "Define road, airspace, or network constraints, demand flow, and operational scenario.",
      "List safety, efficiency, robustness, scalability, and simulation or field-data conditions.",
      "Explain how routing, control, or scheduling mechanisms become engineering validation."
    ],
    biomedicine: [
      "Define study design, sample or cohort, intervention or exposure, and endpoints.",
      "List bias sources, statistical uncertainty, ethics boundaries, and data-compliance needs.",
      "Separate mechanism explanation, clinical relevance, and conclusions that should not be generalized."
    ],
    "social-science": [
      "Define theory, constructs, measurement validity, and sample representativeness.",
      "List causal identification, confounders, external validity, and policy boundaries.",
      "Write falsifiable hypotheses and alternative explanations into the design."
    ],
    "review-writing": [
      "Define review taxonomy dimensions, representative-paper positioning, and evidence strength.",
      "List comparable metrics, conflicting evidence, research gaps, and future routes.",
      "Separate single-paper evidence from cross-paper synthesis claims."
    ],
    general: [
      "Define research question, object, evidence scope, and boundary conditions.",
      "List method, data, validation metrics, and traceable evidence labels.",
      "Separate contribution, feasibility risk, and literature still to be followed up."
    ]
  };
  return { title, items: packs[id] || packs.general };
}

function domainPackLabelZh(id) {
  if (id === "ai-ml") return "AI/ML/系统";
  if (id === "transportation") return "交通与城市空域";
  if (id === "biomedicine") return "医学与生命科学";
  if (id === "social-science") return "社科与政策";
  if (id === "review-writing") return "综述写作";
  return "通用研究";
}

function domainPackLabelEn(id) {
  if (id === "ai-ml") return "AI/ML systems";
  if (id === "transportation") return "Transportation and urban airspace";
  if (id === "biomedicine") return "Biomedicine and life sciences";
  if (id === "social-science") return "Social science and policy";
  if (id === "review-writing") return "Literature-review writing";
  return "General research";
}

function proposalNoteLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "开题与课题申报笔记",
      paperTitle: "题名",
      authors: "作者",
      year: "年份",
      generatedAt: "生成时间",
      noteFile: "笔记文件",
      contextQuality: "上下文质量",
      chunks: "片段",
      fulltextChars: "全文字符",
      annotations: "注释",
      notesCount: "笔记",
      error: "错误",
      language: "zh-CN",
      proposalFrame: "选题框架",
      domainWritingFormat: "领域化写作格式",
      promptPack: "提示模板包",
      topic: "拟定题目/方向",
      coreQuestion: "核心科学问题或工程问题",
      researchObject: "研究对象与场景",
      scopeBoundary: "范围边界",
      expectedContribution: "预期贡献",
      sections: "申报要点",
      keyEvidence: "关键证据",
      note: "可写入内容",
      gap: "待补证据/问题",
      action: "下一步动作",
      background: "研究背景与问题压力",
      researchQuestion: "研究问题与目标",
      methodRoute: "技术路线与方法基础",
      experimentPlan: "实验验证与数据条件",
      innovation: "创新点与可借鉴点",
      limitations: "风险、局限与可行性",
      milestones: "里程碑",
      milestoneLiterature: "补齐核心文献和代表性方法。",
      milestoneMethod: "形成方法框架、变量和约束定义。",
      milestoneExperiment: "设计验证场景、数据、指标和基线。",
      milestoneWriting: "整理开题或申报文本中的章节要点。",
      riskCheck: "风险核查",
      riskEvidence: "每个主张都有证据标签或明确低置信度说明。",
      riskScope: "研究边界不过宽，能解释不纳入的对象。",
      riskFeasibility: "数据、实验平台、时间和实现成本可控。",
      riskNovelty: "创新点不是简单复述已有工作。",
      evidenceIndex: "证据摘录索引",
      noEvidence: "暂无可用证据片段，请人工补充或等待 Zotero 完成全文索引。"
    };
  }
  return {
    title: "Proposal Note",
    paperTitle: "Title",
    authors: "Authors",
    year: "Year",
    generatedAt: "Generated at",
    noteFile: "Note file",
    contextQuality: "Context Quality",
    chunks: "chunks",
    fulltextChars: "fulltext chars",
    annotations: "annotations",
    notesCount: "notes",
    error: "error",
    language: "en-US",
    proposalFrame: "Proposal Frame",
    domainWritingFormat: "Domain Writing Format",
    promptPack: "Prompt pack",
    topic: "Working title / direction",
    coreQuestion: "Core scientific or engineering question",
    researchObject: "Research object and scenario",
    scopeBoundary: "Scope boundary",
    expectedContribution: "Expected contribution",
    sections: "Proposal Notes",
    keyEvidence: "Key evidence",
    note: "Draftable note",
    gap: "Evidence gap / question",
    action: "Next action",
    background: "Background and Problem Pressure",
    researchQuestion: "Research Question and Objectives",
    methodRoute: "Technical Route and Method Basis",
    experimentPlan: "Validation Plan and Data Conditions",
    innovation: "Innovation and Reusable Ideas",
    limitations: "Risks, Limits, and Feasibility",
    milestones: "Milestones",
    milestoneLiterature: "Complete core literature and representative methods.",
    milestoneMethod: "Define method framework, variables, and constraints.",
    milestoneExperiment: "Design validation scenarios, data, metrics, and baselines.",
    milestoneWriting: "Organize section notes for a proposal document.",
    riskCheck: "Risk Check",
    riskEvidence: "Each claim has an evidence label or explicit low-confidence note.",
    riskScope: "The scope is bounded and exclusions are explainable.",
    riskFeasibility: "Data, experiment platform, schedule, and implementation cost are feasible.",
    riskNovelty: "The contribution is more than a restatement of existing work.",
    evidenceIndex: "Evidence Excerpt Index",
    noEvidence: "No evidence excerpts are available yet; add notes manually or wait for Zotero full-text indexing."
  };
}

function renderJournalOutlineMarkdown(context, options = {}) {
  const labels = journalOutlineLabels(options.outputLanguage);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const focal = {
    role: labels.focal,
    evidencePrefix: "chunk",
    itemKey: options.item?.key || "",
    metadata: context?.metadata || {},
    chunks: context?.chunks || [],
    diagnostics: context?.diagnostics || {}
  };
  const comparisons = (context?.comparisonContexts || []).map((entry, index) => ({
    role: `${labels.comparison} ${index + 1}`,
    evidencePrefix: `paper${index + 2}`,
    itemKey: entry.itemKey || "",
    metadata: entry.metadata || {},
    chunks: entry.chunks || [],
    diagnostics: entry.diagnostics || {}
  }));
  const papers = [focal, ...comparisons];
  const collectionKey = workbenchCollectionKey(options.item);
  const promptPackId = normalizePromptPackId(options.promptPackId || "general");
  const domainChecklist = journalDomainChecklist(promptPackId, labels);
  const sections = journalOutlineSections(labels);
  const lines = [
    "---",
    "templateVersion: journal-outline-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `focalItemKey: ${yamlScalar(focal.itemKey)}`,
    `comparisonCount: ${comparisons.length}`,
    `promptPackId: ${yamlScalar(promptPackId)}`,
    `contextSourceHash: ${yamlScalar(options.contextSourceHash || "")}`,
    `outlinePath: ${yamlScalar(options.outlinePath || "")}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.focalPaper}: ${mdText(focal.metadata.title || focal.itemKey || "")}`,
    `- ${labels.comparisonCount}: ${comparisons.length}`,
    `- ${labels.generatedAt}: ${generatedAt}`,
    `- ${labels.outlineFile}: ${mdText(options.outlinePath || "")}`,
    "",
    `## ${labels.submissionFrame}`,
    "",
    `- ${labels.targetVenue}: `,
    `- ${labels.articleType}: `,
    `- ${labels.mainClaim}: `,
    `- ${labels.audience}: `,
    `- ${labels.requiredEvidence}: `,
    "",
    `## ${labels.domainWritingFormat}`,
    "",
    `- ${labels.promptPack}: ${mdText(domainChecklist.title)}`,
    ...domainChecklist.items.map((item) => `- [ ] ${item}`),
    "",
    `## ${labels.paperInventory}`,
    "",
    `| ${labels.role} | ${labels.evidence} | ${labels.paperTitle} | ${labels.authors} | ${labels.year} | DOI | ${labels.contextQuality} |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...papers.map((entry) => comparisonInventoryRow(entry, labels)),
    "",
    `## ${labels.manuscriptOutline}`,
    "",
    `| ${labels.section} | ${labels.purpose} | ${labels.evidenceExcerpts} | ${labels.draftNote} |`,
    "| --- | --- | --- | --- |"
  ];
  for (const section of sections) {
    const evidence = reviewDraftEvidenceAcrossPapers(papers, section, labels, 2);
    lines.push([
      section.label,
      section.purpose,
      evidence.length ? evidence.map((item) => `${item.label} ${truncateText(item.text, 220)}`).join("<br>") : labels.noEvidence,
      labels.manualPlaceholder
    ].map(markdownTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push(
    "",
    `## ${labels.readinessChecklist}`,
    "",
    `- [ ] ${labels.checkClaim}`,
    `- [ ] ${labels.checkMethods}`,
    `- [ ] ${labels.checkExperiments}`,
    `- [ ] ${labels.checkFigures}`,
    `- [ ] ${labels.checkLimits}`,
    "",
    `## ${labels.evidenceIndex}`,
    ""
  );
  for (const paper of papers) {
    lines.push(`### ${paper.role}: ${mdText(paper.metadata.title || paper.itemKey || "")}`, "");
    const evidence = comparisonEvidenceForContext(paper, journalOverviewDimension(labels), labels, 5);
    if (evidence.length) {
      for (const item of evidence) lines.push(`- ${item.label} ${truncateText(item.text, 360)}`);
    } else {
      lines.push(`- ${comparisonMetadataLabel(paper)} ${labels.metadataOnly}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function journalOutlineSections(labels) {
  return [
    { id: "titleAbstract", label: labels.titleAbstract, purpose: labels.purposeTitleAbstract, query: "title abstract contribution problem method result 标题 摘要 贡献 问题 方法 结果" },
    { id: "introduction", label: labels.introduction, purpose: labels.purposeIntroduction, query: "introduction background motivation gap challenge 背景 动机 空白 挑战 引言" },
    { id: "relatedWork", label: labels.relatedWork, purpose: labels.purposeRelatedWork, query: "related work taxonomy comparison limitation literature 相关工作 分类 对比 局限 文献" },
    { id: "method", label: labels.method, purpose: labels.purposeMethod, query: "method model algorithm framework design 方法 模型 算法 框架 设计" },
    { id: "experiments", label: labels.experiments, purpose: labels.purposeExperiments, query: "experiment dataset metric baseline evaluation result 实验 数据集 指标 基线 评估 结果" },
    { id: "discussion", label: labels.discussion, purpose: labels.purposeDiscussion, query: "discussion limitation threat validity implication future 讨论 局限 威胁 有效性 启发 未来" }
  ];
}

function journalOverviewDimension(labels) {
  return {
    id: "journalOverview",
    label: labels.evidenceIndex,
    query: "summary abstract method experiment result limitation contribution discussion 摘要 方法 实验 结果 局限 贡献 讨论"
  };
}

function journalDomainChecklist(promptPackId, labels) {
  const id = normalizePromptPackId(promptPackId);
  const zh = labels.language === "zh-CN";
  const title = zh ? domainPackLabelZh(id) : domainPackLabelEn(id);
  const packs = zh ? {
    "ai-ml": [
      "引言中交代任务定义、模型类别、数据与评价协议。",
      "方法章节明确训练目标、架构差异、复杂度和复现设置。",
      "实验章节包含主结果、消融、鲁棒性、失败案例和算力成本。"
    ],
    transportation: [
      "引言中交代交通/空域场景、网络约束、需求流和安全问题。",
      "方法章节明确状态变量、约束、控制/路径/调度策略和可扩展性。",
      "实验章节包含仿真设置、基线、指标、安全边界和运行管理启示。"
    ],
    biomedicine: [
      "引言中交代研究设计、样本来源、临床或生物学问题边界。",
      "方法章节明确队列、干预/暴露、终点、统计方法和偏倚控制。",
      "讨论章节区分相关性、因果性、机制解释和不可直接外推部分。"
    ],
    "social-science": [
      "引言中交代理论框架、研究问题和政策或社会背景。",
      "方法章节明确变量测量、样本、识别策略和稳健性检验。",
      "讨论章节处理替代解释、外部有效性和政策含义。"
    ],
    "review-writing": [
      "相关工作按分类维度组织，而不是逐篇罗列。",
      "正文每个综合判断都连接代表论文、证据强弱和冲突证据。",
      "结论给出研究空白、方法路线和可执行的后续研究问题。"
    ],
    general: [
      "引言中交代问题压力、研究空白和本文主张。",
      "方法和实验章节保持证据标签、指标和图表计划可追踪。",
      "讨论章节明确适用边界、局限和后续工作。"
    ]
  } : {
    "ai-ml": [
      "Frame task definition, model class, data, and evaluation protocol in the introduction.",
      "Make objective, architecture differences, complexity, and reproducibility settings explicit in methods.",
      "Cover main results, ablations, robustness, failure cases, and compute cost in experiments."
    ],
    transportation: [
      "Frame traffic or airspace scenario, network constraints, demand flow, and safety problem in the introduction.",
      "Make state variables, constraints, control/routing/scheduling policy, and scalability explicit in methods.",
      "Cover simulation setup, baselines, metrics, safety boundary, and operational implications in experiments."
    ],
    biomedicine: [
      "Frame study design, sample source, and clinical or biological problem boundary in the introduction.",
      "Make cohort, intervention or exposure, endpoints, statistics, and bias control explicit in methods.",
      "Separate association, causality, mechanism interpretation, and non-generalizable conclusions in discussion."
    ],
    "social-science": [
      "Frame theory, research question, and policy or social background in the introduction.",
      "Make measurement, sample, identification strategy, and robustness checks explicit in methods.",
      "Handle alternative explanations, external validity, and policy implications in discussion."
    ],
    "review-writing": [
      "Organize related work by taxonomy dimensions instead of paper-by-paper listing.",
      "Connect every synthesis claim to representative papers, evidence strength, and counter-evidence.",
      "End with research gaps, method routes, and actionable follow-up questions."
    ],
    general: [
      "Frame problem pressure, research gap, and paper claim in the introduction.",
      "Keep evidence labels, metrics, and figure/table plans traceable in methods and experiments.",
      "Make scope, limitations, and future work explicit in discussion."
    ]
  };
  return { title, items: packs[id] || packs.general };
}

function journalOutlineLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "期刊/报告写作提纲",
      language: "zh-CN",
      focal: "焦点论文",
      comparison: "对比论文",
      focalPaper: "焦点论文",
      comparisonCount: "对比论文数",
      generatedAt: "生成时间",
      outlineFile: "提纲文件",
      submissionFrame: "投稿/报告定位",
      targetVenue: "目标期刊/会议/报告类型",
      articleType: "文章类型",
      mainClaim: "主张一句话",
      audience: "目标读者",
      requiredEvidence: "必须补齐的证据",
      domainWritingFormat: "领域化写作格式",
      promptPack: "提示模板包",
      paperInventory: "论文清单",
      role: "角色",
      evidence: "证据标签",
      paperTitle: "题名",
      authors: "作者",
      year: "年份",
      contextQuality: "上下文质量",
      manuscriptOutline: "正文提纲",
      section: "章节",
      purpose: "写作目的",
      evidenceExcerpts: "证据摘录",
      draftNote: "草稿要点",
      manualPlaceholder: "补充段落句群、图表位置和引用安排",
      readinessChecklist: "投稿/报告核查清单",
      checkClaim: "摘要、引言和结论中的核心主张保持一致。",
      checkMethods: "方法细节足够支撑复现或审稿判断。",
      checkExperiments: "实验、对照、指标和消融能支撑主张。",
      checkFigures: "图表计划能解释核心结果而不是重复正文。",
      checkLimits: "局限、威胁和适用边界有明确说明。",
      evidenceIndex: "证据摘录索引",
      titleAbstract: "标题与摘要",
      purposeTitleAbstract: "压缩问题、方法、结果和贡献。",
      introduction: "引言",
      purposeIntroduction: "建立问题压力、研究空白和本文主张。",
      relatedWork: "相关工作",
      purposeRelatedWork: "形成分类、对比和本文位置。",
      method: "方法",
      purposeMethod: "说明模型、算法、输入输出和关键设计。",
      experiments: "实验与结果",
      purposeExperiments: "组织数据、指标、基线、主结果和消融。",
      discussion: "讨论与局限",
      purposeDiscussion: "解释适用范围、失败条件和后续工作。",
      chunks: "片段",
      fulltextChars: "全文字符",
      annotations: "注释",
      notesCount: "笔记",
      error: "错误",
      unknown: "未知",
      noEvidence: "暂无可用证据片段，请人工补充或等待 Zotero 完成全文索引。",
      metadataOnly: "仅有题录或上下文不足，请低置信度处理。"
    };
  }
  return {
    title: "Journal / Report Outline",
    language: "en-US",
    focal: "Focal paper",
    comparison: "Comparison paper",
    focalPaper: "Focal paper",
    comparisonCount: "Comparison papers",
    generatedAt: "Generated at",
    outlineFile: "Outline file",
    submissionFrame: "Submission / Report Frame",
    targetVenue: "Target journal, venue, or report type",
    articleType: "Article type",
    mainClaim: "One-sentence main claim",
    audience: "Target readers",
    requiredEvidence: "Evidence still required",
    domainWritingFormat: "Domain Writing Format",
    promptPack: "Prompt pack",
    paperInventory: "Paper Inventory",
    role: "Role",
    evidence: "Evidence label",
    paperTitle: "Title",
    authors: "Authors",
    year: "Year",
    contextQuality: "Context quality",
    manuscriptOutline: "Manuscript Outline",
    section: "Section",
    purpose: "Writing purpose",
    evidenceExcerpts: "Evidence excerpts",
    draftNote: "Draft note",
    manualPlaceholder: "Add paragraph clusters, figure/table placement, and citation plan",
    readinessChecklist: "Submission / Report Checklist",
    checkClaim: "Core claims are consistent across abstract, introduction, and conclusion.",
    checkMethods: "Method details are sufficient for reproduction or review.",
    checkExperiments: "Experiments, baselines, metrics, and ablations support the claim.",
    checkFigures: "Figures and tables explain key results instead of repeating prose.",
    checkLimits: "Limitations, threats, and boundary conditions are explicit.",
    evidenceIndex: "Evidence Excerpt Index",
    titleAbstract: "Title and Abstract",
    purposeTitleAbstract: "Compress problem, method, result, and contribution.",
    introduction: "Introduction",
    purposeIntroduction: "Build problem pressure, gap, and paper claim.",
    relatedWork: "Related Work",
    purposeRelatedWork: "Shape taxonomy, comparison, and positioning.",
    method: "Method",
    purposeMethod: "Explain model, algorithm, inputs, outputs, and design choices.",
    experiments: "Experiments and Results",
    purposeExperiments: "Organize data, metrics, baselines, main results, and ablations.",
    discussion: "Discussion and Limitations",
    purposeDiscussion: "Explain scope, failure conditions, and follow-up work.",
    chunks: "chunks",
    fulltextChars: "fulltext chars",
    annotations: "annotations",
    notesCount: "notes",
    error: "error",
    unknown: "unknown",
    noEvidence: "No evidence excerpts are available yet; add notes manually or wait for Zotero full-text indexing.",
    metadataOnly: "Metadata only or insufficient context; treat as low-confidence."
  };
}

function renderVisualExtractionReportMarkdown(payload, options = {}) {
  return renderVisualExtractionReportMarkdownFromData(visualExtractionReportData(payload, options), options);
}

function visualExtractionReportData(payload, options = {}) {
  const labels = visualExtractionReportLabels(options.outputLanguage);
  const context = payload?.context || {};
  const exchange = payload?.exchange || latestVisualExtractionExchange(payload?.messages || []);
  const metadata = context?.metadata || {};
  const item = options.item || payload?.item || {};
  const itemKey = item?.key || "";
  const collectionKey = workbenchCollectionKey(item);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const assistant = exchange?.assistant || {};
  const user = exchange?.user || {};
  const answer = answerTextForMessage(assistant);
  const sections = visualExtractionSections(answer);
  const tables = visualExtractionParsedTables(answer);
  const evidenceLabels = visualExtractionEvidenceLabels(answer);
  const images = Array.isArray(user?.images) ? user.images : [];
  const chartDataDrafts = visualExtractionChartDataDrafts(answer, tables, images);
  const rawPixelDataDrafts = visualExtractionPixelDataDrafts(answer, tables, images);
  const calibrationAnchors = visualExtractionCalibrationAnchors(answer, tables, rawPixelDataDrafts, images);
  const pixelDataDrafts = visualExtractionApplyAxisCalibration(rawPixelDataDrafts, calibrationAnchors);
  const chartQualityReview = visualExtractionChartQualityReview(chartDataDrafts, pixelDataDrafts, {
    evidenceLabels,
    images,
    calibrationAnchors
  });
  const chartReviewActions = visualExtractionMergeChartReviewActionState(
    visualExtractionChartReviewActions(chartQualityReview, labels),
    options.previousChartReviewActions || payload?.previousChartReviewActions
  );
  return {
    templateVersion: "visual-extraction-report-v2",
    generatedAt,
    collectionKey,
    itemKey,
    contextSourceHash: mdText(options.contextSourceHash || ""),
    reportPath: mdText(options.reportPath || ""),
    jsonPath: mdText(options.jsonPath || ""),
    csvPath: mdText(options.csvPath || ""),
    sourceAssistantMessageId: mdText(assistant.id || ""),
    sourceUserMessageId: mdText(user?.id || ""),
    metadata: {
      title: mdText(metadata.title || itemKey || "")
    },
    mode: mdText(assistant.skillId || user?.skillId || "image-question"),
    model: mdText(assistant.profileName || assistant.model || user?.profileName || user?.model || ""),
    images: images.map((image) => ({
      name: mdText(image.name || "image"),
      mimeType: mdText(image.mimeType || ""),
      size: Number(image.size) || 0,
      localOcr: visualExtractionLocalOcrMetadata(image.localOcr)
    })),
    sections,
    tables,
    chartDataDrafts,
    pixelDataDrafts,
    calibrationAnchors,
    chartQualityReview,
    chartReviewActions,
    evidenceLabels,
    originalAnswer: answer || "",
    labels
  };
}

function renderVisualExtractionReportMarkdownFromData(data, options = {}) {
  const labels = data?.labels || visualExtractionReportLabels(options.outputLanguage);
  const images = Array.isArray(data?.images) ? data.images : [];
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const tables = Array.isArray(data?.tables) ? data.tables : [];
  const chartDataDrafts = Array.isArray(data?.chartDataDrafts) ? data.chartDataDrafts : [];
  const pixelDataDrafts = Array.isArray(data?.pixelDataDrafts) ? data.pixelDataDrafts : [];
  const calibrationAnchors = Array.isArray(data?.calibrationAnchors) ? data.calibrationAnchors : [];
  const chartQualityReview = data?.chartQualityReview || visualExtractionChartQualityReview(chartDataDrafts, pixelDataDrafts, {
    evidenceLabels: data?.evidenceLabels || [],
    images,
    calibrationAnchors
  });
  const chartReviewActions = Array.isArray(data?.chartReviewActions)
    ? data.chartReviewActions
    : visualExtractionChartReviewActions(chartQualityReview, labels);
  const reconstructedRows = visualExtractionStructuredRows(tables, chartDataDrafts, pixelDataDrafts, calibrationAnchors, chartReviewActions);
  const imageInventory = images.length
    ? [
      `| ${labels.imageName} | ${labels.imageType} | ${labels.imageSize} | ${labels.localOcr} |`,
      "| --- | --- | --- | --- |",
      ...images.map((image) => `| ${markdownTableCell(image.name || "image")} | ${markdownTableCell(image.mimeType || "")} | ${Number(image.size) || 0} | ${markdownTableCell(visualExtractionLocalOcrSummary(image.localOcr, labels))} |`)
    ].join("\n")
    : `- ${labels.noImages}`;
  const lines = [
    "---",
    `templateVersion: ${yamlScalar(data?.templateVersion || "visual-extraction-report-v2")}`,
    `generatedAt: ${data?.generatedAt || ""}`,
    `collectionKey: ${yamlScalar(data?.collectionKey || "")}`,
    `itemKey: ${yamlScalar(data?.itemKey || "")}`,
    `contextSourceHash: ${yamlScalar(data?.contextSourceHash || "")}`,
    `reportPath: ${yamlScalar(data?.reportPath || options.reportPath || "")}`,
    `jsonPath: ${yamlScalar(data?.jsonPath || options.jsonPath || "")}`,
    `csvPath: ${yamlScalar(data?.csvPath || options.csvPath || "")}`,
    `sourceAssistantMessageId: ${yamlScalar(data?.sourceAssistantMessageId || "")}`,
    `sourceUserMessageId: ${yamlScalar(data?.sourceUserMessageId || "")}`,
    `imageCount: ${images.length}`,
    `reconstructedTableCount: ${tables.length}`,
    `chartDataDraftCount: ${chartDataDrafts.length}`,
    `densePointDraftCount: ${visualExtractionDensePointDraftCount(chartDataDrafts)}`,
    `densePointCount: ${visualExtractionDensePointCount(chartDataDrafts)}`,
    `pixelDataDraftCount: ${pixelDataDrafts.length}`,
    `calibrationAnchorCount: ${calibrationAnchors.length}`,
    `chartQualityStatus: ${yamlScalar(chartQualityReview.status || "")}`,
    `chartQualityIssueCount: ${Number(chartQualityReview.issueCount) || 0}`,
    `chartReviewActionCount: ${chartReviewActions.length}`,
    `reconstructedDataRowCount: ${reconstructedRows.length}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.paperTitle}: ${mdText(data?.metadata?.title || data?.itemKey || "")}`,
    `- ${labels.generatedAt}: ${data?.generatedAt || ""}`,
    `- ${labels.reportFile}: ${mdText(data?.reportPath || options.reportPath || "")}`,
    `- ${labels.jsonFile}: ${mdText(data?.jsonPath || options.jsonPath || "")}`,
    `- ${labels.csvFile}: ${mdText(data?.csvPath || options.csvPath || "")}`,
    `- ${labels.mode}: ${mdText(data?.mode || "image-question")}`,
    `- ${labels.model}: ${mdText(data?.model || "")}`,
    "",
    `## ${labels.imageInventory}`,
    "",
    imageInventory,
    "",
    `## ${labels.sectionIndex}`,
    "",
    visualExtractionSectionTable(sections, labels),
    "",
    `## ${labels.reconstructedTables}`,
    "",
    tables.length ? tables.map((table) => [`### ${labels.table} ${table.tableIndex}`, "", table.markdown].join("\n")).join("\n\n") : `- ${labels.noTables}`,
    "",
    `## ${labels.chartDataDrafts}`,
    "",
    chartDataDrafts.length ? visualExtractionChartDataDraftsMarkdown(chartDataDrafts, labels) : `- ${labels.noChartDataDrafts}`,
    "",
    `## ${labels.pixelDataDrafts}`,
    "",
    pixelDataDrafts.length ? visualExtractionPixelDataDraftsMarkdown(pixelDataDrafts, labels) : `- ${labels.noPixelDataDrafts}`,
    "",
    `## ${labels.calibrationAnchors}`,
    "",
    calibrationAnchors.length ? visualExtractionCalibrationAnchorsMarkdown(calibrationAnchors, labels) : `- ${labels.noCalibrationAnchors}`,
    "",
    `## ${labels.chartQualityReview}`,
    "",
    visualExtractionChartQualityReviewMarkdown(chartQualityReview, labels),
    "",
    `## ${labels.chartReviewActions}`,
    "",
    chartReviewActions.length ? visualExtractionChartReviewActionsMarkdown(chartReviewActions, labels) : `- ${labels.noChartReviewActions}`,
    "",
    `## ${labels.structuredData}`,
    "",
    reconstructedRows.length
      ? visualExtractionStructuredDataTable(reconstructedRows, labels)
      : `- ${labels.noStructuredRows}`,
    "",
    `## ${labels.evidenceLabels}`,
    "",
    data?.evidenceLabels?.length ? data.evidenceLabels.map((label) => `- \`${label}\``).join("\n") : `- ${labels.noEvidenceLabels}`,
    "",
    `## ${labels.reviewChecklist}`,
    "",
    `- [ ] ${labels.checkReadableText}`,
    `- [ ] ${labels.checkTableNumbers}`,
    `- [ ] ${labels.checkChartDataDrafts}`,
    `- [ ] ${labels.checkPixelDataDrafts}`,
    `- [ ] ${labels.checkImageEvidence}`,
    `- [ ] ${labels.checkPdfLocation}`,
    `- [ ] ${labels.checkReuse}`,
    "",
    `## ${labels.originalAnswer}`,
    "",
    data?.originalAnswer || labels.noAnswer,
    ""
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function renderVisualExtractionReportJson(data) {
  const { labels: _labels, ...payload } = data || {};
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderVisualExtractionReportCsv(data) {
  const rows = visualExtractionStructuredRows(
    data?.tables || [],
    data?.chartDataDrafts || [],
    data?.pixelDataDrafts || [],
    data?.calibrationAnchors || [],
    data?.chartReviewActions || []
  );
  const header = ["tableIndex", "rowIndex", "column", "value", "evidenceLabels", "sourceAssistantMessageId", "imageNames"];
  const imageNames = (data?.images || []).map((image) => image.name).filter(Boolean).join("; ");
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.tableIndex,
      row.rowIndex,
      row.column,
      row.value,
      row.evidenceLabels.join("; "),
      data?.sourceAssistantMessageId || "",
      imageNames
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function latestVisualExtractionExchange(messages = []) {
  for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
    const assistant = messages[index];
    if (assistant?.role !== "assistant" || !answerTextForMessage(assistant).trim()) continue;
    const user = previousUserMessage(messages, index);
    if (isVisualExtractionAssistantMessage(assistant, user)) return { assistant, user, index };
  }
  return null;
}

function previousUserMessage(messages, beforeIndex) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return null;
}

function isVisualExtractionAssistantMessage(assistant, user) {
  const skillId = assistant?.skillId || user?.skillId || "";
  if (skillId === "figure-table-extractor") return true;
  if (Array.isArray(user?.images) && user.images.length) return true;
  const text = answerTextForMessage(assistant);
  return /##\s*(Visual OCR Text|视觉 OCR 文本|視覚 OCR テキスト|Reconstructed Data Table|重建表格|再構成データ表)/i.test(text);
}

function visualExtractionSections(answer) {
  const sections = [];
  let current = null;
  for (const line of String(answer || "").split(/\r?\n/)) {
    const match = line.match(/^##+\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push(current);
      current = { heading: mdText(match[1]), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections
    .map((section) => ({
      heading: section.heading,
      text: section.lines.join("\n").trim(),
      evidenceLabels: visualExtractionEvidenceLabels(section.lines.join("\n"))
    }))
    .filter((section) => section.heading || section.text);
}

function visualExtractionSectionTable(sections, labels) {
  const rows = (sections || []).slice(0, 12).map((section) => [
    markdownTableCell(section.heading || labels.unknown),
    markdownTableCell(truncateText(section.text || labels.noAnswer, 220)),
    markdownTableCell((section.evidenceLabels || []).join(", ") || labels.noEvidenceLabels)
  ]);
  return [
    `| ${labels.section} | ${labels.summary} | ${labels.evidenceLabels} |`,
    "| --- | --- | --- |",
    rows.length ? rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n") : `| ${markdownTableCell(labels.noSections)} |  |  |`
  ].join("\n");
}

function visualExtractionLocalOcrMetadata(localOcr) {
  if (!localOcr || typeof localOcr !== "object" || Array.isArray(localOcr)) return null;
  const status = mdText(localOcr.status || "");
  if (!status) return null;
  return {
    status,
    engine: mdText(localOcr.engine || ""),
    language: mdText(localOcr.language || ""),
    tool: mdText(localOcr.tool || ""),
    text: truncateText(mdText(localOcr.text || ""), 4000),
    error: truncateText(mdText(localOcr.error || ""), 500)
  };
}

function visualExtractionLocalOcrSummary(localOcr, labels) {
  if (!localOcr?.status) return labels.localOcrNotRun;
  if (localOcr.status === "ok" || localOcr.status === "corrected" || localOcr.status === "manual") {
    const text = truncateText(localOcr.text || "", 120);
    const label = localOcr.status === "corrected"
      ? labels.localOcrCorrected
      : localOcr.status === "manual"
        ? labels.localOcrManual
        : labels.localOcrOk;
    return text ? `${label}: ${text}` : label;
  }
  if (localOcr.status === "empty") return labels.localOcrEmpty;
  if (localOcr.status === "failed") return [labels.localOcrFailed, localOcr.error].filter(Boolean).join(": ");
  return localOcr.status;
}

function visualExtractionTables(answer) {
  return visualExtractionTableBlocks(answer).map((block) => block.markdown);
}

function visualExtractionTableBlocks(answer) {
  const blocks = [];
  const lines = String(answer || "").split(/\r?\n/);
  let heading = "";
  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = String(lines[index] || "").match(/^##+\s+(.+?)\s*$/);
    if (headingMatch) {
      heading = mdText(headingMatch[1]);
      continue;
    }
    if (!/^\s*\|.*\|\s*$/.test(lines[index] || "")) continue;
    const start = index;
    while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] || "")) index += 1;
    const block = lines.slice(start, index).join("\n").trim();
    if (/\|\s*:?-{3,}:?\s*\|/.test(block)) blocks.push({ markdown: block, heading });
  }
  return blocks.slice(0, 10);
}

function visualExtractionParsedTables(answer) {
  return visualExtractionTableBlocks(answer)
    .map((block, index) => ({
      tableIndex: index + 1,
      markdown: block.markdown,
      heading: mdText(block.heading || ""),
      isDensePointTable: visualExtractionDensePointHeading(block.heading),
      ...parseVisualExtractionMarkdownTable(block.markdown),
      evidenceLabels: visualExtractionEvidenceLabels(`${block.heading || ""}\n${block.markdown}`)
    }))
    .filter((table) => table.columns.length || table.rows.length);
}

function parseVisualExtractionMarkdownTable(markdown) {
  const lines = String(markdown || "").split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (lines.length < 2) return { columns: [], rows: [] };
  const separatorIndex = lines.findIndex((line) => markdownTableRowCells(line).every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, ""))));
  if (separatorIndex <= 0) return { columns: [], rows: [] };
  const columns = uniqueVisualExtractionColumns(markdownTableRowCells(lines[separatorIndex - 1]));
  const rows = lines.slice(separatorIndex + 1)
    .map((line) => visualExtractionDataRow(columns, markdownTableRowCells(line)))
    .filter((row) => Object.values(row).some((value) => mdText(value)));
  return { columns, rows };
}

function markdownTableRowCells(line) {
  const source = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaping = false;
  for (const char of source) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "|") {
      cells.push(mdText(current));
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(mdText(current));
  return cells.map((cell) => cell.replace(/\\\|/g, "|"));
}

function uniqueVisualExtractionColumns(cells) {
  const seen = new Map();
  return (cells || []).map((cell, index) => {
    const base = mdText(cell || `column_${index + 1}`) || `column_${index + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function visualExtractionDataRow(columns, cells) {
  const row = {};
  (columns || []).forEach((column, index) => {
    row[column] = mdText(cells[index] || "");
  });
  if ((cells || []).length > (columns || []).length) {
    row._extra = cells.slice(columns.length).map(mdText).filter(Boolean).join(" | ");
  }
  return row;
}

function visualExtractionStructuredRows(tables, chartDataDrafts = [], pixelDataDrafts = [], calibrationAnchors = [], chartReviewActions = []) {
  const rows = [];
  for (const table of tables || []) {
    for (const [rowIndex, row] of (table.rows || []).entries()) {
      for (const column of table.columns || []) {
        rows.push({
          tableIndex: table.tableIndex,
          rowIndex: rowIndex + 1,
          column,
          value: mdText(row[column] || ""),
          evidenceLabels: visualExtractionEvidenceLabels(row[column] || "")
        });
      }
      if (row._extra) {
        rows.push({
          tableIndex: table.tableIndex,
          rowIndex: rowIndex + 1,
          column: "_extra",
          value: mdText(row._extra),
          evidenceLabels: visualExtractionEvidenceLabels(row._extra)
        });
      }
    }
  }
  for (const chart of chartDataDrafts || []) {
    for (const [pointIndex, point] of (chart.points || []).entries()) {
      const chartLabel = `chart:${chart.chartIndex || ""}`;
      const base = {
        tableIndex: chartLabel,
        rowIndex: pointIndex + 1,
        evidenceLabels: Array.from(new Set([...(chart.evidenceLabels || []), ...(point.evidenceLabels || [])]))
      };
      for (const [column, value] of [
        ["source", chart.source || ""],
        ["series", point.series || ""],
        ["x", point.x || ""],
        ["y", point.y || ""],
        ["yNumber", point.yNumber === null || point.yNumber === undefined ? "" : point.yNumber],
        ["unit", point.unit || ""],
        ["confidence", point.confidence || ""],
        ["basis", point.basis || ""]
      ]) {
        if (value === "") continue;
        rows.push({ ...base, column, value: mdText(value) });
      }
    }
  }
  for (const draft of pixelDataDrafts || []) {
    for (const [pointIndex, point] of (draft.points || []).entries()) {
      const draftLabel = `pixel:${draft.pixelDraftIndex || ""}`;
      const base = {
        tableIndex: draftLabel,
        rowIndex: pointIndex + 1,
        evidenceLabels: Array.from(new Set([...(draft.evidenceLabels || []), ...(point.evidenceLabels || [])]))
      };
      for (const [column, value] of [
        ["source", draft.source || ""],
        ["series", point.series || ""],
        ["point", point.point || ""],
        ["pixelX", point.pixelX === null || point.pixelX === undefined ? "" : point.pixelX],
        ["pixelY", point.pixelY === null || point.pixelY === undefined ? "" : point.pixelY],
        ["axisX", point.axisX || ""],
        ["axisY", point.axisY || ""],
        ["axisXCalibrated", point.axisXCalibrated ? "true" : ""],
        ["axisYCalibrated", point.axisYCalibrated ? "true" : ""],
        ["confidence", point.confidence || ""],
        ["calibrationBasis", point.calibrationBasis || ""],
        ["basis", point.basis || ""]
      ]) {
        if (value === "") continue;
        rows.push({ ...base, column, value: mdText(value) });
      }
    }
  }
  for (const [anchorIndex, anchor] of (calibrationAnchors || []).entries()) {
    const anchorLabel = `calibration:${anchor.calibrationIndex || anchorIndex + 1}`;
    const base = {
      tableIndex: anchorLabel,
      rowIndex: anchorIndex + 1,
      evidenceLabels: anchor.evidenceLabels || []
    };
    for (const [column, value] of [
      ["source", anchor.source || ""],
      ["axis", anchor.axis || ""],
      ["pixel", anchor.pixel === null || anchor.pixel === undefined ? "" : anchor.pixel],
      ["value", anchor.value || ""],
      ["unit", anchor.unit || ""],
      ["confidence", anchor.confidence || ""],
      ["basis", anchor.basis || ""]
    ]) {
      if (value === "") continue;
      rows.push({ ...base, column, value: mdText(value) });
    }
  }
  for (const [actionIndex, action] of (chartReviewActions || []).entries()) {
    const queueId = action.queueId || `review-${actionIndex + 1}`;
    const base = {
      tableIndex: `review-action:${queueId}`,
      rowIndex: actionIndex + 1,
      evidenceLabels: []
    };
    for (const [column, value] of [
      ["queueId", queueId],
      ["actionId", action.actionId || ""],
      ["priority", action.priority || ""],
      ["reviewState", action.reviewState || ""],
      ["relatedCheck", action.checkId || ""],
      ["checkStatus", action.status || ""],
      ["nextStep", action.nextStep || ""],
      ["doneCriteria", action.doneCriteria || ""],
      ["reviewer", action.reviewer || ""],
      ["due", action.due || ""],
      ["notes", action.notes || ""],
      ["detail", action.detail || ""]
    ]) {
      if (value === "") continue;
      rows.push({ ...base, column, value: mdText(value) });
    }
  }
  return rows.filter((row) => row.value);
}

function visualExtractionChartDataDrafts(answer, tables = [], images = []) {
  const drafts = [];
  for (const table of tables || []) {
    const draft = visualExtractionChartDraftFromTable(table);
    if (draft) drafts.push({ ...draft, chartIndex: drafts.length + 1 });
  }
  for (const image of images || []) {
    const draft = visualExtractionChartDraftFromLocalOcr(image);
    if (draft) drafts.push({ ...draft, chartIndex: drafts.length + 1 });
  }
  if (!drafts.length) {
    const draft = visualExtractionChartDraftFromText(answer);
    if (draft) drafts.push({ ...draft, chartIndex: 1 });
  }
  return drafts.slice(0, 12);
}

function visualExtractionChartDraftFromTable(table) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  if (!rows.length) return null;
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  const xColumn = visualExtractionFindColumn(columns, [
    /^(x|x[-_\s]?axis|axis\s*x)$/i,
    /^(item|name|category|condition|dataset|metric|method|model|scenario)$/i,
    /^(项目|名称|类别|条件|数据集|指标|方法|模型|场景|横轴)$/i
  ]);
  const yColumn = visualExtractionFindColumn(columns, [
    /^(y|y[-_\s]?axis|axis\s*y)$/i,
    /^(value|value\/text|score|result|number|rate|accuracy|delay|cost|time)$/i,
    /^(数值|数值\/文本|值|结果|得分|比例|准确率|延误|成本|时间|纵轴)$/i
  ]);
  if (!xColumn || !yColumn) return null;
  const unitColumn = visualExtractionFindColumn(columns, [/^(unit|单位)$/i]);
  const seriesColumn = visualExtractionFindColumn(columns, [
    /^(series|legend|group|baseline)$/i,
    /^(图例|系列|分组|基线)$/i
  ]);
  const confidenceColumn = visualExtractionFindColumn(columns, [/^(confidence|置信度)$/i]);
  const sourceColumn = visualExtractionFindColumn(columns, [/^(source|来源|evidence|证据)$/i]);
  const notesColumn = visualExtractionFindColumn(columns, [/^(note|notes|备注|说明)$/i]);
  const points = rows.map((row) => {
    const y = mdText(row[yColumn] || "");
    const x = mdText(row[xColumn] || "");
    const basis = mdText([row[sourceColumn], row[notesColumn]].filter(Boolean).join(" · "));
    return {
      series: mdText(row[seriesColumn] || ""),
      x,
      y,
      yNumber: visualExtractionNumber(y),
      unit: mdText(row[unitColumn] || ""),
      confidence: visualExtractionConfidence(row[confidenceColumn] || row[sourceColumn] || ""),
      basis,
      evidenceLabels: visualExtractionEvidenceLabels(Object.values(row).join(" "))
    };
  }).filter((point) => point.x && point.y);
  if (!points.length) return null;
  const densePointTable = visualExtractionDensePointTable(table);
  return {
    source: densePointTable ? "dense-point-table" : "reconstructed-table",
    tableIndex: table.tableIndex,
    heading: table.heading || "",
    densePointTable,
    xAxis: xColumn,
    yAxis: yColumn,
    seriesColumn: seriesColumn || "",
    reviewStatus: "needs-review",
    evidenceLabels: table.evidenceLabels || [],
    points: points.slice(0, 200)
  };
}

function visualExtractionDensePointTable(table) {
  if (table?.isDensePointTable) return true;
  const heading = mdText(table?.heading || "");
  if (visualExtractionDensePointHeading(heading)) return true;
  const columns = (table?.columns || []).join(" ");
  return /(?:dense|densified|sampled|digitized|高密度|密集|采样|採樣|点位|點位)/i.test(columns)
    && /(?:axis\s*x|axis\s*y|x\s*value|y\s*value|横轴|纵轴|點|点|point)/i.test(columns);
}

function visualExtractionDensePointHeading(heading) {
  const text = mdText(heading || "");
  if (!text) return false;
  return /(?:dense|densified|sampled|digitized|密集|高密度|采样|採樣|数字化|點位|点位)/i.test(text)
    && /(?:point|data|table|chart|图表|圖表|数据|資料|点|點)/i.test(text);
}

function visualExtractionDensePointDraftCount(drafts = []) {
  return (drafts || []).filter((draft) => draft?.densePointTable || draft?.source === "dense-point-table").length;
}

function visualExtractionDensePointCount(drafts = []) {
  return (drafts || [])
    .filter((draft) => draft?.densePointTable || draft?.source === "dense-point-table")
    .reduce((sum, draft) => sum + ((draft?.points || []).length), 0);
}

function visualExtractionChartDraftFromLocalOcr(image) {
  const localOcr = image?.localOcr || {};
  if (!["ok", "corrected", "manual"].includes(localOcr.status)) return null;
  const points = visualExtractionNumericTextPoints(localOcr.text || "")
    .slice(0, 80)
    .map((point) => ({
      ...point,
      series: image?.name || "image",
      confidence: localOcr.status === "corrected" ? "medium" : "low",
      evidenceLabels: ["[image]", "[metadata]"]
    }));
  if (!points.length) return null;
  return {
    source: "local-ocr",
    imageName: mdText(image?.name || "image"),
    xAxis: "OCR line",
    yAxis: "recognized numeric value",
    seriesColumn: "image",
    reviewStatus: "needs-review",
    evidenceLabels: ["[image]", "[metadata]"],
    points
  };
}

function visualExtractionChartDraftFromText(answer) {
  const points = visualExtractionNumericTextPoints(answer).slice(0, 80);
  if (!points.length) return null;
  return {
    source: "answer-text",
    xAxis: "text item",
    yAxis: "numeric value",
    seriesColumn: "",
    reviewStatus: "needs-review",
    evidenceLabels: visualExtractionEvidenceLabels(answer),
    points
  };
}

function visualExtractionPixelDataDrafts(answer, tables = [], images = []) {
  const drafts = [];
  for (const table of tables || []) {
    const draft = visualExtractionPixelDraftFromTable(table, images);
    if (draft) drafts.push({ ...draft, pixelDraftIndex: drafts.length + 1 });
  }
  if (!drafts.length) {
    const draft = visualExtractionPixelDraftFromText(answer, images);
    if (draft) drafts.push({ ...draft, pixelDraftIndex: 1 });
  }
  return drafts.slice(0, 12);
}

function visualExtractionPixelDraftFromTable(table, images = []) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  if (!rows.length) return null;
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  const pixelXColumn = visualExtractionFindColumn(columns, [
    /^(pixel\s*x|x\s*pixel|px\s*x|image\s*x|screen\s*x|像素\s*x|x\s*像素)$/i
  ]);
  const pixelYColumn = visualExtractionFindColumn(columns, [
    /^(pixel\s*y|y\s*pixel|px\s*y|image\s*y|screen\s*y|像素\s*y|y\s*像素)$/i
  ]);
  if (!pixelXColumn && !pixelYColumn) return null;
  const axisXColumn = visualExtractionFindColumn(columns, [
    /^(axis\s*x|x\s*value|data\s*x|chart\s*x|横轴|x\s*轴值|数据\s*x)$/i
  ]);
  const axisYColumn = visualExtractionFindColumn(columns, [
    /^(axis\s*y|y\s*value|data\s*y|chart\s*y|纵轴|y\s*轴值|数据\s*y)$/i
  ]);
  const pointColumn = visualExtractionFindColumn(columns, [
    /^(point|point\s*label|label|item|category|点|点位|标签|项目)$/i
  ]);
  const seriesColumn = visualExtractionFindColumn(columns, [
    /^(series|legend|group|baseline|line|bar|系列|图例|分组|基线|线|柱)$/i
  ]);
  const confidenceColumn = visualExtractionFindColumn(columns, [/^(confidence|置信度|certainty)$/i]);
  const sourceColumn = visualExtractionFindColumn(columns, [/^(source|来源|evidence|证据|basis|依据)$/i]);
  const notesColumn = visualExtractionFindColumn(columns, [/^(note|notes|备注|说明)$/i]);
  const points = rows.map((row) => {
    const basis = mdText([row[sourceColumn], row[notesColumn]].filter(Boolean).join(" · "));
    return {
      series: mdText(row[seriesColumn] || ""),
      point: mdText(row[pointColumn] || ""),
      pixelX: visualExtractionNumber(row[pixelXColumn] || ""),
      pixelY: visualExtractionNumber(row[pixelYColumn] || ""),
      axisX: mdText(row[axisXColumn] || ""),
      axisY: mdText(row[axisYColumn] || ""),
      confidence: visualExtractionConfidence(row[confidenceColumn] || row[sourceColumn] || ""),
      basis,
      evidenceLabels: visualExtractionEvidenceLabels(Object.values(row).join(" "))
    };
  }).filter((point) => point.pixelX !== null || point.pixelY !== null);
  if (!points.length) return null;
  return {
    source: "pixel-coordinate-table",
    tableIndex: table.tableIndex,
    imageName: visualExtractionPixelDraftImageName(images),
    reviewStatus: "needs-review",
    evidenceLabels: table.evidenceLabels || [],
    points: points.slice(0, 200)
  };
}

function visualExtractionPixelDraftFromText(answer, images = []) {
  const points = String(answer || "").split(/\r?\n/)
    .map((line) => mdText(line.replace(/^[-*]\s*/, "")))
    .map((line) => {
      const match = line.match(/(?:pixel|px|像素)[^\d-]*x\s*[:=]?\s*(-?\d+(?:\.\d+)?)[^\d-]+y\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i)
        || line.match(/x\s*[:=]?\s*(-?\d+(?:\.\d+)?)[^\d-]+y\s*[:=]?\s*(-?\d+(?:\.\d+)?)[^\n]*(?:pixel|px|像素)/i);
      if (!match) return null;
      return {
        series: "",
        point: truncateText(line.replace(/\[(?:image|metadata|abstract|chunk:[^\]\s]+|paper\d+:[^\]\s]+)[^\]]*\]/g, "").trim(), 80),
        pixelX: Number(match[1]),
        pixelY: Number(match[2]),
        axisX: "",
        axisY: "",
        confidence: "low",
        basis: truncateText(line, 180),
        evidenceLabels: visualExtractionEvidenceLabels(line)
      };
    })
    .filter(Boolean)
    .slice(0, 80);
  if (!points.length) return null;
  return {
    source: "pixel-coordinate-text",
    imageName: visualExtractionPixelDraftImageName(images),
    reviewStatus: "needs-review",
    evidenceLabels: visualExtractionEvidenceLabels(answer),
    points
  };
}

function visualExtractionPixelDraftImageName(images = []) {
  return (images || []).map((image) => image?.name).filter(Boolean).join("; ");
}

function visualExtractionCalibrationAnchors(_answer, tables = [], _pixelDataDrafts = [], images = []) {
  const anchors = [];
  for (const table of tables || []) {
    for (const anchor of visualExtractionCalibrationAnchorsFromTable(table, images)) {
      anchors.push({ ...anchor, calibrationIndex: anchors.length + 1 });
    }
  }
  return anchors.slice(0, 80);
}

function visualExtractionCalibrationAnchorsFromTable(table, images = []) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  if (!rows.length) return [];
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  const axisColumn = visualExtractionFindColumn(columns, [
    /^(axis|axis\s*name|coordinate\s*axis|坐标轴|座標軸|轴|軸)$/i
  ]);
  const pixelColumn = visualExtractionFindColumn(columns, [
    /^(pixel|pixel\s*position|pixel\s*anchor|px|image\s*pixel|像素|像素位置|像素锚点|像素錨點)$/i
  ]);
  const valueColumn = visualExtractionFindColumn(columns, [
    /^(value|axis\s*value|tick|tick\s*value|data\s*value|anchor\s*value|值|轴值|軸値|刻度|刻度值|锚点值|錨點值)$/i
  ]);
  if (!axisColumn || !pixelColumn || !valueColumn) return [];
  const unitColumn = visualExtractionFindColumn(columns, [/^(unit|units|单位|單位)$/i]);
  const confidenceColumn = visualExtractionFindColumn(columns, [/^(confidence|置信度|certainty|可靠性)$/i]);
  const sourceColumn = visualExtractionFindColumn(columns, [/^(source|来源|來源|evidence|证据|證據|basis|依据|依據)$/i]);
  const notesColumn = visualExtractionFindColumn(columns, [/^(note|notes|备注|備註|说明|說明)$/i]);
  return rows.map((row) => {
    const axis = visualExtractionAxisName(row[axisColumn]);
    const pixel = visualExtractionNumber(row[pixelColumn] || "");
    const value = mdText(row[valueColumn] || "");
    const basis = mdText([row[sourceColumn], row[notesColumn]].filter(Boolean).join(" · "));
    return {
      source: "axis-calibration-table",
      tableIndex: table.tableIndex,
      imageName: visualExtractionPixelDraftImageName(images),
      axis,
      pixel,
      value,
      unit: mdText(row[unitColumn] || ""),
      confidence: visualExtractionConfidence(row[confidenceColumn] || row[sourceColumn] || ""),
      basis,
      evidenceLabels: visualExtractionEvidenceLabels(Object.values(row).join(" "))
    };
  }).filter((anchor) => anchor.axis && anchor.pixel !== null && anchor.value);
}

function visualExtractionApplyAxisCalibration(pixelDataDrafts = [], calibrationAnchors = []) {
  const xScale = visualExtractionAxisCalibrationScale(calibrationAnchors, "X");
  const yScale = visualExtractionAxisCalibrationScale(calibrationAnchors, "Y");
  if (!xScale && !yScale) return pixelDataDrafts;
  return (pixelDataDrafts || []).map((draft) => ({
    ...draft,
    points: (draft.points || []).map((point) => visualExtractionApplyAxisCalibrationToPoint(point, { X: xScale, Y: yScale }))
  }));
}

function visualExtractionApplyAxisCalibrationToPoint(point, scales) {
  const next = { ...(point || {}) };
  const basisParts = [];
  const evidenceLabels = [...(next.evidenceLabels || [])];
  if (!mdText(next.axisX || "") && next.pixelX !== null && next.pixelX !== undefined && scales.X) {
    const value = visualExtractionAxisValueFromPixel(scales.X, next.pixelX);
    if (value !== null) {
      next.axisX = visualExtractionFormatCalibratedAxisValue(value, scales.X.unit);
      next.axisXCalibrated = true;
      basisParts.push(visualExtractionCalibrationBasis(scales.X));
      evidenceLabels.push(...(scales.X.evidenceLabels || []));
    }
  }
  if (!mdText(next.axisY || "") && next.pixelY !== null && next.pixelY !== undefined && scales.Y) {
    const value = visualExtractionAxisValueFromPixel(scales.Y, next.pixelY);
    if (value !== null) {
      next.axisY = visualExtractionFormatCalibratedAxisValue(value, scales.Y.unit);
      next.axisYCalibrated = true;
      basisParts.push(visualExtractionCalibrationBasis(scales.Y));
      evidenceLabels.push(...(scales.Y.evidenceLabels || []));
    }
  }
  if (basisParts.length) {
    next.calibrationBasis = Array.from(new Set(basisParts)).join("; ");
    next.basis = visualExtractionMergeBasis(next.basis, next.calibrationBasis);
    next.evidenceLabels = Array.from(new Set(evidenceLabels));
  }
  return next;
}

function visualExtractionAxisCalibrationScale(calibrationAnchors = [], axisName) {
  const axis = visualExtractionAxisName(axisName);
  const anchors = (calibrationAnchors || []).map((anchor) => ({
    ...anchor,
    axis: visualExtractionAxisName(anchor?.axis),
    pixel: Number(anchor?.pixel),
    numericValue: visualExtractionNumber(anchor?.value)
  })).filter((anchor) =>
    anchor.axis === axis
    && Number.isFinite(anchor.pixel)
    && anchor.numericValue !== null
    && Number.isFinite(anchor.numericValue)
  );
  if (anchors.length < 2) return null;
  let selected = null;
  for (let left = 0; left < anchors.length; left += 1) {
    for (let right = left + 1; right < anchors.length; right += 1) {
      const pixelSpan = Math.abs(anchors[right].pixel - anchors[left].pixel);
      const valueSpan = Math.abs(anchors[right].numericValue - anchors[left].numericValue);
      if (!pixelSpan || !valueSpan) continue;
      if (!selected || pixelSpan > selected.pixelSpan) {
        selected = {
          left: anchors[left],
          right: anchors[right],
          pixelSpan
        };
      }
    }
  }
  if (!selected) return null;
  const unit = mdText(selected.left.unit || selected.right.unit || "");
  return {
    axis,
    pixelA: selected.left.pixel,
    valueA: selected.left.numericValue,
    pixelB: selected.right.pixel,
    valueB: selected.right.numericValue,
    unit,
    evidenceLabels: Array.from(new Set([...(selected.left.evidenceLabels || []), ...(selected.right.evidenceLabels || [])]))
  };
}

function visualExtractionAxisValueFromPixel(scale, pixel) {
  const numericPixel = Number(pixel);
  const pixelSpan = Number(scale?.pixelB) - Number(scale?.pixelA);
  const valueSpan = Number(scale?.valueB) - Number(scale?.valueA);
  if (!Number.isFinite(numericPixel) || !Number.isFinite(pixelSpan) || !Number.isFinite(valueSpan) || pixelSpan === 0) {
    return null;
  }
  return Number(scale.valueA) + ((numericPixel - Number(scale.pixelA)) * valueSpan / pixelSpan);
}

function visualExtractionFormatCalibratedAxisValue(value, unit = "") {
  if (!Number.isFinite(Number(value))) return "";
  const normalized = Math.abs(Number(value)) >= 1000000 || (Math.abs(Number(value)) > 0 && Math.abs(Number(value)) < 0.0001)
    ? Number(Number(value).toPrecision(6))
    : Number(Number(value).toFixed(6));
  const text = String(Object.is(normalized, -0) ? 0 : normalized);
  const suffix = mdText(unit);
  return suffix ? `${text} ${suffix}` : text;
}

function visualExtractionCalibrationBasis(scale) {
  if (!scale) return "";
  const left = visualExtractionFormatCalibratedAxisValue(scale.valueA, scale.unit);
  const right = visualExtractionFormatCalibratedAxisValue(scale.valueB, scale.unit);
  return `linear ${scale.axis} calibration: ${scale.pixelA}px=${left}, ${scale.pixelB}px=${right}`;
}

function visualExtractionMergeBasis(existing, addition) {
  const parts = [existing, addition].map(mdText).filter(Boolean);
  return Array.from(new Set(parts)).join(" · ");
}

function visualExtractionAxisName(value) {
  const text = mdText(value);
  if (/^(x|x[-_\s]?axis|axis\s*x)$/i.test(text) || /横轴|橫軸|横坐标|橫座標|水平/.test(text)) return "X";
  if (/^(y|y[-_\s]?axis|axis\s*y)$/i.test(text) || /纵轴|縱軸|纵坐标|縱座標|垂直/.test(text)) return "Y";
  return text;
}

function visualExtractionNumericTextPoints(text) {
  return String(text || "").split(/\r?\n/)
    .map((line) => mdText(line.replace(/^[-*]\s*/, "")))
    .filter((line) => !visualExtractionLooksLikeMarkdownTableLine(line))
    .filter((line) => visualExtractionLooksLikeDataLine(line))
    .map((line) => {
      const number = visualExtractionNumber(line);
      const unitMatch = line.match(/[-+]?\d+(?:\.\d+)?\s*([%a-zA-Z\u4e00-\u9fff/]+)?/);
      const label = line.replace(/[-+]?\d+(?:\.\d+)?\s*[%a-zA-Z\u4e00-\u9fff/]*.*/, "").replace(/[:：,，\-–—]+$/, "").trim() || line.slice(0, 80);
      return {
        series: "",
        x: label,
        y: unitMatch ? unitMatch[0].trim() : line,
        yNumber: number,
        unit: unitMatch?.[1] || "",
        confidence: "low",
        basis: truncateText(line, 180),
        evidenceLabels: visualExtractionEvidenceLabels(line)
      };
    })
    .filter((point) => point.yNumber !== null);
}

function visualExtractionLooksLikeMarkdownTableLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;
  if (/^\|.*\|$/.test(text)) return true;
  return /^:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$/.test(text);
}

function visualExtractionLooksLikeDataLine(line) {
  const text = String(line || "");
  const numeric = text.match(/[-+]?\d+(?:\.\d+)?\s*([%％a-zA-Z\u4e00-\u9fff/]+)?/);
  if (!numeric) return false;
  const token = String(numeric[0] || "").toLowerCase();
  if (/[%％]|(?:^|[-+0-9.\s])(?:ms|s|sec|secs|second|seconds|min|mins|hour|hours|hz|khz|mhz|ghz|fps|px|pt|m|km|cm|mm|gb|mb|kb|tokens?|samples?|epochs?|steps?|runs?)\b/.test(token)) return true;
  if (/(毫秒|秒|分钟|小时|像素|公里|米|厘米|毫米|样本|轮次|步|次|帧|点)/.test(token)) return true;
  if (/[:：]/.test(text)) return true;
  return visualExtractionEvidenceLabels(text).length > 0;
}

function visualExtractionFindColumn(columns, patterns) {
  for (const pattern of patterns || []) {
    const found = (columns || []).find((column) => pattern.test(String(column || "").trim()));
    if (found) return found;
  }
  return "";
}

function visualExtractionNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function visualExtractionConfidence(value) {
  const text = String(value || "").toLowerCase();
  if (/高|high|可靠|confirmed/.test(text)) return "high";
  if (/中|medium|moderate|校正|corrected/.test(text)) return "medium";
  if (/低|low|uncertain|不确定|模糊|估计/.test(text)) return "low";
  return "needs-review";
}

function visualExtractionChartDataDraftsMarkdown(drafts, labels) {
  const lines = [
    `| ${labels.chart} | ${labels.source} | ${labels.xAxis} | ${labels.yAxis} | ${labels.series} | ${labels.pointCount} | ${labels.reviewStatus} | ${labels.evidenceLabels} |`,
    "| --- | --- | --- | --- | --- | ---: | --- | --- |"
  ];
  for (const draft of drafts || []) {
    lines.push([
      draft.chartIndex,
      markdownTableCell(draft.source || ""),
      markdownTableCell(draft.xAxis || ""),
      markdownTableCell(draft.yAxis || ""),
      markdownTableCell(draft.seriesColumn || ""),
      (draft.points || []).length,
      markdownTableCell(draft.reviewStatus || ""),
      markdownTableCell((draft.evidenceLabels || []).join(", ") || labels.noEvidenceLabels)
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  for (const draft of drafts || []) {
    lines.push("", `### ${labels.chart} ${draft.chartIndex}`, "");
    lines.push(`| ${labels.series} | ${labels.xValue} | ${labels.yValue} | ${labels.unit} | ${labels.confidence} | ${labels.source} | ${labels.evidenceLabels} |`);
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const point of (draft.points || []).slice(0, 80)) {
      lines.push([
        markdownTableCell(point.series || ""),
        markdownTableCell(point.x || ""),
        markdownTableCell(point.y || ""),
        markdownTableCell(point.unit || ""),
        markdownTableCell(point.confidence || ""),
        markdownTableCell(point.basis || draft.source || ""),
        markdownTableCell((point.evidenceLabels || []).join(", ") || labels.noEvidenceLabels)
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }
  return lines.join("\n");
}

function visualExtractionPixelDataDraftsMarkdown(drafts, labels) {
  const lines = [
    `| ${labels.pixelDraft} | ${labels.source} | ${labels.imageName} | ${labels.pointCount} | ${labels.reviewStatus} | ${labels.evidenceLabels} |`,
    "| --- | --- | --- | ---: | --- | --- |"
  ];
  for (const draft of drafts || []) {
    lines.push([
      draft.pixelDraftIndex,
      markdownTableCell(draft.source || ""),
      markdownTableCell(draft.imageName || ""),
      (draft.points || []).length,
      markdownTableCell(draft.reviewStatus || ""),
      markdownTableCell((draft.evidenceLabels || []).join(", ") || labels.noEvidenceLabels)
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  for (const draft of drafts || []) {
    lines.push("", `### ${labels.pixelDraft} ${draft.pixelDraftIndex}`, "");
    lines.push(`| ${labels.series} | ${labels.point} | ${labels.pixelX} | ${labels.pixelY} | ${labels.axisXValue} | ${labels.axisYValue} | ${labels.confidence} | ${labels.source} | ${labels.evidenceLabels} |`);
    lines.push("| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |");
    for (const point of (draft.points || []).slice(0, 80)) {
      lines.push([
        markdownTableCell(point.series || ""),
        markdownTableCell(point.point || ""),
        point.pixelX === null || point.pixelX === undefined ? "" : point.pixelX,
        point.pixelY === null || point.pixelY === undefined ? "" : point.pixelY,
        markdownTableCell(point.axisX || ""),
        markdownTableCell(point.axisY || ""),
        markdownTableCell(point.confidence || ""),
        markdownTableCell(point.basis || draft.source || ""),
        markdownTableCell((point.evidenceLabels || []).join(", ") || labels.noEvidenceLabels)
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }
  return lines.join("\n");
}

function visualExtractionCalibrationAnchorsMarkdown(anchors, labels) {
  const lines = [
    `| ${labels.anchor} | ${labels.source} | ${labels.axis} | ${labels.pixelPosition} | ${labels.axisValue} | ${labels.unit} | ${labels.confidence} | ${labels.evidenceLabels} |`,
    "| --- | --- | --- | ---: | --- | --- | --- | --- |"
  ];
  for (const anchor of anchors || []) {
    lines.push([
      anchor.calibrationIndex || "",
      markdownTableCell(anchor.source || ""),
      markdownTableCell(anchor.axis || ""),
      anchor.pixel === null || anchor.pixel === undefined ? "" : anchor.pixel,
      markdownTableCell(anchor.value || ""),
      markdownTableCell(anchor.unit || ""),
      markdownTableCell(anchor.confidence || ""),
      markdownTableCell((anchor.evidenceLabels || []).join(", ") || labels.noEvidenceLabels)
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  return lines.join("\n");
}

function visualExtractionChartQualityReview(chartDataDrafts = [], pixelDataDrafts = [], options = {}) {
  const chartPoints = (chartDataDrafts || []).flatMap((draft) => draft?.points || []);
  const pixelPoints = (pixelDataDrafts || []).flatMap((draft) => draft?.points || []);
  const calibrationAnchors = Array.isArray(options.calibrationAnchors) ? options.calibrationAnchors : [];
  const evidenceLabels = Array.from(new Set([
    ...(options.evidenceLabels || []),
    ...(chartDataDrafts || []).flatMap((draft) => draft?.evidenceLabels || []),
    ...(pixelDataDrafts || []).flatMap((draft) => draft?.evidenceLabels || []),
    ...calibrationAnchors.flatMap((anchor) => anchor?.evidenceLabels || []),
    ...chartPoints.flatMap((point) => point?.evidenceLabels || []),
    ...pixelPoints.flatMap((point) => point?.evidenceLabels || [])
  ]));
  const checks = [
    visualExtractionQualityCheck(
      "chart-data",
      chartPoints.length ? "pass" : "warning",
      chartPoints.length ? `chart points: ${chartPoints.length}` : "no chart-data points parsed"
    ),
    visualExtractionQualityCheck(
      "pixel-coordinates",
      pixelPoints.length ? "pass" : "warning",
      pixelPoints.length ? `pixel points: ${pixelPoints.length}` : "no pixel-coordinate points parsed"
    ),
    visualExtractionAxisCalibrationCheck(pixelPoints, calibrationAnchors),
    ...(calibrationAnchors.length ? [visualExtractionCalibrationQualityCheck(calibrationAnchors)] : []),
    visualExtractionConfidenceCheck([...chartPoints, ...pixelPoints]),
    visualExtractionEvidenceCheck(evidenceLabels),
    visualExtractionPointCountCheck(chartPoints.length + pixelPoints.length)
  ];
  const issueCount = checks.filter((check) => check.status !== "pass").length;
  const score = checks.reduce((sum, check) => sum + (check.status === "pass" ? 2 : check.status === "warning" ? 1 : 0), 0);
  const maxScore = checks.length * 2;
  const status = !chartPoints.length && !pixelPoints.length
    ? "insufficient"
    : checks.some((check) => check.status === "fail")
      ? "needs-review"
      : checks.some((check) => check.status === "warning")
        ? "reviewable-with-cautions"
        : "reviewable";
  return {
    status,
    score,
    maxScore,
    issueCount,
    imageCount: (options.images || []).length,
    checks,
    recommendations: visualExtractionQualityRecommendations(checks)
  };
}

function visualExtractionQualityCheck(id, status, detail) {
  return { id, status, detail: mdText(detail || "") };
}

function visualExtractionAxisCalibrationCheck(pixelPoints = [], calibrationAnchors = []) {
  const anchors = (calibrationAnchors || []).filter((anchor) =>
    mdText(anchor?.axis || "")
    && anchor?.pixel !== null
    && anchor?.pixel !== undefined
    && mdText(anchor?.value || "")
  );
  const xAnchors = anchors.filter((anchor) => /^x$/i.test(mdText(anchor.axis)));
  const yAnchors = anchors.filter((anchor) => /^y$/i.test(mdText(anchor.axis)));
  if (xAnchors.length >= 2 && yAnchors.length >= 2) {
    return visualExtractionQualityCheck("axis-calibration", "pass", `calibration anchors present: X ${xAnchors.length}, Y ${yAnchors.length}`);
  }
  if (anchors.length) {
    return visualExtractionQualityCheck("axis-calibration", "warning", `partial calibration anchors: X ${xAnchors.length}, Y ${yAnchors.length}`);
  }
  if (!pixelPoints.length) return visualExtractionQualityCheck("axis-calibration", "warning", "no pixel points available for axis calibration");
  const calibrated = pixelPoints.filter((point) =>
    point?.pixelX !== null
    && point?.pixelX !== undefined
    && point?.pixelY !== null
    && point?.pixelY !== undefined
    && mdText(point?.axisX || "")
    && mdText(point?.axisY || "")
  ).length;
  if (calibrated === pixelPoints.length) return visualExtractionQualityCheck("axis-calibration", "pass", `axis values present for ${calibrated}/${pixelPoints.length} pixel points`);
  if (calibrated > 0) return visualExtractionQualityCheck("axis-calibration", "warning", `axis values present for ${calibrated}/${pixelPoints.length} pixel points`);
  return visualExtractionQualityCheck("axis-calibration", "fail", "pixel points have no axis-value mapping");
}

function visualExtractionCalibrationQualityCheck(calibrationAnchors = []) {
  const anchors = (calibrationAnchors || []).filter((anchor) =>
    mdText(anchor?.axis || "")
    && anchor?.pixel !== null
    && anchor?.pixel !== undefined
    && mdText(anchor?.value || "")
  );
  if (!anchors.length) return visualExtractionQualityCheck("calibration-quality", "warning", "no explicit calibration anchors to diagnose");
  const axisGroups = visualExtractionCalibrationAxisGroups(anchors);
  const spans = [];
  const monotonicAxes = [];
  const issues = [];
  const severeIssues = [];
  let numericCount = 0;
  for (const [axis, axisAnchors] of axisGroups.entries()) {
    const numericAnchors = axisAnchors
      .map((anchor) => ({ ...anchor, numericValue: visualExtractionNumber(anchor.value) }))
      .filter((anchor) => anchor.numericValue !== null);
    numericCount += numericAnchors.length;
    const duplicatePixels = visualExtractionDuplicateValues(axisAnchors.map((anchor) => anchor.pixel));
    if (duplicatePixels.length) {
      severeIssues.push(`duplicate pixel anchors on ${axis}: ${duplicatePixels.join(", ")}`);
    }
    const duplicateAxisValues = visualExtractionDuplicateValues(numericAnchors.map((anchor) => anchor.numericValue));
    if (duplicateAxisValues.length) {
      severeIssues.push(`duplicate axis values on ${axis}: ${duplicateAxisValues.join(", ")}`);
    }
    if (axisAnchors.length >= 2) {
      const pixels = axisAnchors.map((anchor) => Number(anchor.pixel)).filter(Number.isFinite);
      const span = Math.max(...pixels) - Math.min(...pixels);
      spans.push(`${axis} ${span} px`);
      if (span > 0 && span < 24) issues.push(`small pixel span on ${axis}: ${span} px`);
    }
    if (numericAnchors.length >= 3) {
      if (visualExtractionMonotonicCalibration(numericAnchors)) {
        monotonicAxes.push(axis);
      } else {
        severeIssues.push(`non-monotonic anchors on ${axis}`);
      }
    } else if (numericAnchors.length >= 2) {
      monotonicAxes.push(axis);
    }
  }
  if (numericCount < anchors.length) issues.push(`non-numeric values ${anchors.length - numericCount}/${anchors.length}`);
  const detailParts = [
    spans.length ? `spans: ${spans.join(", ")}` : "",
    `numeric anchors: ${numericCount}/${anchors.length}`,
    monotonicAxes.length ? `monotonic axes: ${monotonicAxes.join(", ")}` : "",
    severeIssues.length || issues.length ? `issues: ${[...severeIssues, ...issues].join("; ")}` : ""
  ].filter(Boolean);
  if (severeIssues.length) return visualExtractionQualityCheck("calibration-quality", "fail", detailParts.join("; "));
  if (issues.length) return visualExtractionQualityCheck("calibration-quality", "warning", detailParts.join("; "));
  return visualExtractionQualityCheck("calibration-quality", "pass", detailParts.join("; "));
}

function visualExtractionCalibrationAxisGroups(anchors = []) {
  const groups = new Map();
  for (const anchor of anchors || []) {
    const axis = mdText(anchor?.axis || "").toUpperCase() || "UNKNOWN";
    if (!groups.has(axis)) groups.set(axis, []);
    groups.get(axis).push(anchor);
  }
  return groups;
}

function visualExtractionDuplicateValues(values = []) {
  const seen = new Map();
  const duplicates = [];
  for (const value of values || []) {
    const normalized = mdText(value === null || value === undefined ? "" : value);
    if (!normalized) continue;
    seen.set(normalized, (seen.get(normalized) || 0) + 1);
    if (seen.get(normalized) === 2) duplicates.push(normalized);
  }
  return duplicates;
}

function visualExtractionMonotonicCalibration(anchors = []) {
  const sorted = [...(anchors || [])].sort((left, right) => Number(left.pixel) - Number(right.pixel));
  const deltas = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const delta = Number(sorted[index].numericValue) - Number(sorted[index - 1].numericValue);
    if (delta > 0) deltas.push(1);
    else if (delta < 0) deltas.push(-1);
    else deltas.push(0);
  }
  const nonZero = deltas.filter((delta) => delta !== 0);
  return nonZero.length > 0 && nonZero.every((delta) => delta === nonZero[0]);
}

function visualExtractionConfidenceCheck(points = []) {
  if (!points.length) return visualExtractionQualityCheck("confidence", "warning", "no point-level confidence values");
  const counts = { high: 0, medium: 0, low: 0, review: 0 };
  for (const point of points) {
    const confidence = String(point?.confidence || "").toLowerCase();
    if (confidence === "high") counts.high += 1;
    else if (confidence === "medium") counts.medium += 1;
    else if (confidence === "low") counts.low += 1;
    else counts.review += 1;
  }
  const detail = `high ${counts.high}, medium ${counts.medium}, low ${counts.low}, needs-review ${counts.review}`;
  if (counts.high + counts.medium > 0) return visualExtractionQualityCheck("confidence", "pass", detail);
  return visualExtractionQualityCheck("confidence", "warning", detail);
}

function visualExtractionEvidenceCheck(evidenceLabels = []) {
  const labels = evidenceLabels || [];
  if (labels.some((label) => /^\[image(?:\]|\s)/.test(label))) {
    return visualExtractionQualityCheck("image-evidence", "pass", "image evidence label present");
  }
  if (labels.length) return visualExtractionQualityCheck("image-evidence", "warning", `evidence labels present but no [image]: ${labels.slice(0, 3).join(", ")}`);
  return visualExtractionQualityCheck("image-evidence", "warning", "no evidence labels detected");
}

function visualExtractionPointCountCheck(pointCount) {
  const count = Number(pointCount) || 0;
  if (count >= 3) return visualExtractionQualityCheck("point-count", "pass", `points parsed: ${count}`);
  if (count > 0) return visualExtractionQualityCheck("point-count", "warning", `only ${count} point(s) parsed`);
  return visualExtractionQualityCheck("point-count", "fail", "no reusable data points parsed");
}

function visualExtractionQualityRecommendations(checks = []) {
  const byId = new Map((checks || []).map((check) => [check.id, check]));
  const recommendations = [];
  if (byId.get("axis-calibration")?.status !== "pass") {
    recommendations.push({ id: "axis-calibration" });
  }
  if (byId.get("calibration-quality") && byId.get("calibration-quality")?.status !== "pass") {
    recommendations.push({ id: "calibration-quality" });
  }
  if (byId.get("confidence")?.status !== "pass") {
    recommendations.push({ id: "confidence" });
  }
  if (byId.get("image-evidence")?.status !== "pass") {
    recommendations.push({ id: "image-evidence" });
  }
  if (byId.get("point-count")?.status !== "pass") {
    recommendations.push({ id: "point-count" });
  }
  return recommendations;
}

function visualExtractionChartQualityReviewMarkdown(review, labels) {
  const checks = Array.isArray(review?.checks) ? review.checks : [];
  const recommendations = Array.isArray(review?.recommendations) ? review.recommendations : [];
  const lines = [
    `- ${labels.qualityStatus}: ${review?.status || labels.unknown}`,
    `- ${labels.qualityScore}: ${Number(review?.score) || 0}/${Number(review?.maxScore) || 0}`,
    "",
    `| ${labels.qualityCheck} | ${labels.reviewStatus} | ${labels.detail} |`,
    "| --- | --- | --- |",
    ...(checks.length ? checks.map((check) => `| ${markdownTableCell(check.id || "")} | ${markdownTableCell(check.status || "")} | ${markdownTableCell(check.detail || "")} |`) : [`| ${labels.unknown} | ${labels.unknown} | ${labels.noAnswer} |`])
  ];
  lines.push("", `### ${labels.recommendations}`, "");
  if (recommendations.length) {
    lines.push(...recommendations.map((item) => `- ${visualExtractionQualityRecommendationText(item, labels)}`));
  } else {
    lines.push(`- ${labels.noQualityIssues}`);
  }
  return lines.join("\n");
}

function visualExtractionQualityRecommendationText(item, labels) {
  const id = typeof item === "string" ? item : item?.id || "";
  if (id === "axis-calibration") return labels.recommendationAxisCalibration;
  if (id === "calibration-quality") return labels.recommendationCalibrationQuality;
  if (id === "confidence") return labels.recommendationConfidence;
  if (id === "image-evidence") return labels.recommendationImageEvidence;
  if (id === "point-count") return labels.recommendationPointCount;
  return item?.text || id || labels.unknown;
}

function visualExtractionChartReviewActions(review, labels) {
  const checks = Array.isArray(review?.checks) ? review.checks : [];
  const priorities = { high: 0, medium: 1, low: 2 };
  return checks
    .filter((check) => check?.status && check.status !== "pass")
    .map((check) => visualExtractionChartReviewActionForCheck(check, labels))
    .filter(Boolean)
    .sort((left, right) => (priorities[left.priority] ?? 9) - (priorities[right.priority] ?? 9))
    .map((action, index) => ({
      queueId: `review-${index + 1}`,
      reviewState: "todo",
      reviewer: "",
      due: "",
      notes: "",
      ...action
    }));
}

function visualExtractionMergeChartReviewActionState(actions, previousActions) {
  const generated = Array.isArray(actions) ? actions : [];
  const previous = Array.isArray(previousActions) ? previousActions : [];
  if (!generated.length || !previous.length) return generated;
  const previousByStableKey = new Map();
  const previousByQueueId = new Map();
  for (const action of previous) {
    const state = visualExtractionMutableChartReviewState(action);
    if (!visualExtractionHasMutableChartReviewState(state)) continue;
    const stableKey = visualExtractionChartReviewActionStableKey(action);
    const queueKey = visualExtractionChartReviewActionQueueKey(action);
    if (stableKey && !previousByStableKey.has(stableKey)) previousByStableKey.set(stableKey, state);
    if (queueKey && !previousByQueueId.has(queueKey)) previousByQueueId.set(queueKey, state);
  }
  if (!previousByStableKey.size && !previousByQueueId.size) return generated;
  return generated.map((action) => {
    const stableKey = visualExtractionChartReviewActionStableKey(action);
    const queueKey = visualExtractionChartReviewActionQueueKey(action);
    const state = (stableKey && previousByStableKey.get(stableKey)) || (queueKey && previousByQueueId.get(queueKey));
    return state ? { ...action, ...state } : action;
  });
}

function visualExtractionMutableChartReviewState(action) {
  return {
    reviewState: mdText(action?.reviewState || ""),
    reviewer: mdText(action?.reviewer || ""),
    due: mdText(action?.due || ""),
    notes: mdText(action?.notes || "")
  };
}

function visualExtractionHasMutableChartReviewState(state) {
  return Boolean(state && (state.reviewState || state.reviewer || state.due || state.notes));
}

function visualExtractionChartReviewActionStableKey(action) {
  const parts = [
    action?.actionId,
    action?.checkId,
    action?.status,
    action?.detail
  ].map((part) => mdText(part || "").toLowerCase());
  return parts.some(Boolean) ? parts.join("::") : "";
}

function visualExtractionChartReviewActionQueueKey(action) {
  return mdText(action?.queueId || "").toLowerCase();
}

function visualReviewActionElement(action, translate = (key) => key) {
  const queueId = mdText(action?.queueId || "");
  const article = document.createElement("article");
  article.className = "zms-visual-review-item";
  article.dataset.visualReviewQueue = queueId;

  const title = document.createElement("div");
  title.className = "zms-visual-review-title";
  title.textContent = [
    queueId,
    action?.priority || "",
    action?.actionId || "",
    action?.checkId ? `${action.checkId}${action.status ? ` (${action.status})` : ""}` : ""
  ].filter(Boolean).join(" · ");

  const grid = document.createElement("div");
  grid.className = "zms-visual-review-grid";
  appendVisualReviewControl(grid, translate("visualReviewState"), visualReviewStateSelect(action, translate));
  appendVisualReviewControl(grid, translate("visualReviewReviewer"), visualReviewInput(action, "reviewer", "text", "visualReviewReviewer"));
  appendVisualReviewControl(grid, translate("visualReviewDue"), visualReviewInput(action, "due", "date", "visualReviewDue"));
  appendVisualReviewControl(grid, translate("visualReviewNotes"), visualReviewTextarea(action));

  const detail = document.createElement("div");
  detail.className = "zms-visual-review-detail";
  detail.textContent = [action?.nextStep, action?.doneCriteria, action?.detail].filter(Boolean).join(" · ");
  grid.appendChild(detail);

  article.append(title, grid);
  return article;
}

function appendVisualReviewControl(grid, labelText, control) {
  const label = document.createElement("label");
  label.textContent = labelText;
  grid.append(label, control);
}

function visualReviewStateSelect(action, translate = (key) => key) {
  const select = document.createElement("select");
  select.dataset.visualReviewState = mdText(action?.queueId || "");
  const selectedState = normalizeVisualReviewState(action?.reviewState || "todo");
  for (const state of ZMS_VISUAL_REVIEW_STATES) {
    const option = document.createElement("option");
    option.value = state;
    option.textContent = translate(`visualReviewState-${state}`) || state;
    option.selected = state === selectedState;
    select.appendChild(option);
  }
  select.value = selectedState;
  return select;
}

function visualReviewInput(action, field, type, datasetKey) {
  const input = document.createElement("input");
  input.type = type;
  input.value = mdText(action?.[field] || "");
  input.dataset[datasetKey] = mdText(action?.queueId || "");
  return input;
}

function visualReviewTextarea(action) {
  const textarea = document.createElement("textarea");
  textarea.value = mdText(action?.notes || "");
  textarea.placeholder = "";
  textarea.dataset.visualReviewNotes = mdText(action?.queueId || "");
  return textarea;
}

function visualReviewActionUpdateMapFromDom() {
  if (typeof document === "undefined") return {};
  const updates = {};
  for (const element of document.querySelectorAll("[data-visual-review-state]")) {
    const queueId = element.dataset?.visualReviewState || "";
    if (!queueId) continue;
    updates[queueId] = {
      ...(updates[queueId] || {}),
      reviewState: normalizeVisualReviewState(element.value)
    };
  }
  for (const element of document.querySelectorAll("[data-visual-review-reviewer]")) {
    const queueId = element.dataset?.visualReviewReviewer || "";
    if (!queueId) continue;
    updates[queueId] = {
      ...(updates[queueId] || {}),
      reviewer: mdText(element.value || "")
    };
  }
  for (const element of document.querySelectorAll("[data-visual-review-due]")) {
    const queueId = element.dataset?.visualReviewDue || "";
    if (!queueId) continue;
    updates[queueId] = {
      ...(updates[queueId] || {}),
      due: mdText(element.value || "")
    };
  }
  for (const element of document.querySelectorAll("[data-visual-review-notes]")) {
    const queueId = element.dataset?.visualReviewNotes || "";
    if (!queueId) continue;
    updates[queueId] = {
      ...(updates[queueId] || {}),
      notes: mdText(element.value || "")
    };
  }
  return updates;
}

function applyVisualReviewActionUpdates(actions, updates) {
  return (actions || []).map((action) => {
    const queueId = mdText(action?.queueId || "");
    const update = queueId ? updates?.[queueId] : null;
    if (!update) return action;
    return {
      ...action,
      reviewState: normalizeVisualReviewState(update.reviewState || action.reviewState || "todo"),
      reviewer: mdText(update.reviewer ?? action.reviewer ?? ""),
      due: mdText(update.due ?? action.due ?? ""),
      notes: mdText(update.notes ?? action.notes ?? "")
    };
  });
}

function normalizeVisualReviewState(value) {
  const normalized = mdText(value || "").toLowerCase();
  if (normalized === "in_review" || normalized === "in review" || normalized === "reviewing") return "in-review";
  if (normalized === "complete" || normalized === "completed") return "done";
  if (ZMS_VISUAL_REVIEW_STATES.includes(normalized)) return normalized;
  return "todo";
}

function visualExtractionChartReviewActionForCheck(check, labels) {
  const id = mdText(check?.id || "");
  const status = mdText(check?.status || "");
  const detail = mdText(check?.detail || "");
  const severe = status === "fail";
  const base = {
    checkId: id,
    status,
    detail,
    priority: severe ? "high" : "medium"
  };
  if (id === "chart-data") {
    return {
      ...base,
      actionId: "reconstruct-chart-data",
      nextStep: labels.reviewActionReconstructChartData,
      doneCriteria: labels.reviewDoneReconstructChartData
    };
  }
  if (id === "pixel-coordinates") {
    return {
      ...base,
      actionId: "add-pixel-coordinate-table",
      nextStep: labels.reviewActionAddPixelCoordinates,
      doneCriteria: labels.reviewDoneAddPixelCoordinates
    };
  }
  if (id === "axis-calibration") {
    return {
      ...base,
      actionId: "add-axis-calibration-anchors",
      priority: "high",
      nextStep: labels.reviewActionAddAxisCalibration,
      doneCriteria: labels.reviewDoneAddAxisCalibration
    };
  }
  if (id === "calibration-quality") {
    return {
      ...base,
      actionId: "verify-calibration-quality",
      priority: severe ? "high" : "medium",
      nextStep: labels.reviewActionVerifyCalibrationQuality,
      doneCriteria: labels.reviewDoneVerifyCalibrationQuality
    };
  }
  if (id === "confidence") {
    return {
      ...base,
      actionId: "confirm-low-confidence-readings",
      priority: "medium",
      nextStep: labels.reviewActionConfirmConfidence,
      doneCriteria: labels.reviewDoneConfirmConfidence
    };
  }
  if (id === "image-evidence") {
    return {
      ...base,
      actionId: "separate-visual-evidence",
      priority: "medium",
      nextStep: labels.reviewActionSeparateImageEvidence,
      doneCriteria: labels.reviewDoneSeparateImageEvidence
    };
  }
  if (id === "point-count") {
    return {
      ...base,
      actionId: "request-denser-point-table",
      priority: severe ? "high" : "medium",
      nextStep: labels.reviewActionRequestMorePoints,
      doneCriteria: labels.reviewDoneRequestMorePoints
    };
  }
  return {
    ...base,
    actionId: "manual-review",
    nextStep: labels.reviewActionManualReview,
    doneCriteria: labels.reviewDoneManualReview
  };
}

function visualExtractionChartReviewActionsMarkdown(actions, labels) {
  return [
    `| ${labels.priority} | ${labels.reviewState} | ${labels.action} | ${labels.relatedCheck} | ${labels.nextStep} | ${labels.doneCriteria} | ${labels.reviewer} | ${labels.due} | ${labels.notes} | ${labels.detail} |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(actions || []).map((action) => [
      markdownTableCell(action.priority || ""),
      markdownTableCell(action.reviewState || "todo"),
      markdownTableCell(action.actionId || ""),
      markdownTableCell(`${action.checkId || ""}${action.status ? ` (${action.status})` : ""}`),
      markdownTableCell(action.nextStep || ""),
      markdownTableCell(action.doneCriteria || ""),
      markdownTableCell(action.reviewer || ""),
      markdownTableCell(action.due || ""),
      markdownTableCell(action.notes || ""),
      markdownTableCell(action.detail || "")
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  ].join("\n");
}

function visualExtractionStructuredDataTable(rows, labels) {
  return [
    `| ${labels.table} | ${labels.row} | ${labels.column} | ${labels.value} | ${labels.evidenceLabels} |`,
    "| --- | --- | --- | --- | --- |",
    ...rows.slice(0, 120).map((row) => [
      row.tableIndex,
      row.rowIndex,
      markdownTableCell(row.column),
      markdownTableCell(row.value),
      markdownTableCell(row.evidenceLabels.join(", ") || labels.noEvidenceLabels)
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  ].join("\n");
}

function visualExtractionEvidenceLabels(answer) {
  return Array.from(new Set(String(answer || "").match(/\[(?:image|metadata|abstract|chunk:[^\]\s]+|paper\d+:[^\]\s]+)[^\]]*\]/g) || []));
}

function visualExtractionReportLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "图表/截图解析报告",
      paperTitle: "题名",
      generatedAt: "生成时间",
      reportFile: "报告文件",
      jsonFile: "结构化 JSON",
      csvFile: "结构化 CSV",
      mode: "解析模式",
      model: "模型",
      imageInventory: "图片清单",
      imageName: "图片",
      imageType: "类型",
      imageSize: "字节",
      localOcr: "本地 OCR",
      localOcrNotRun: "未运行",
      localOcrOk: "已识别",
      localOcrCorrected: "已校正",
      localOcrManual: "手动录入",
      localOcrEmpty: "无文本",
      localOcrFailed: "失败",
      noImages: "本次导出未记录图片附件；请核对原会话。",
      sectionIndex: "结构化解析索引",
      section: "章节",
      summary: "摘要",
      evidenceLabels: "证据标签",
      noEvidenceLabels: "未标注",
      noSections: "未检测到结构化二级标题，请回到原回答人工整理。",
      reconstructedTables: "重建表格/数据",
      table: "表格",
      noTables: "未检测到 Markdown 表格；如原图含图表数据，请人工复核或重新使用图表解析模板提问。",
      chartDataDrafts: "图表数据草稿",
      pixelDataDrafts: "像素/坐标数据草稿",
      calibrationAnchors: "坐标轴校准锚点",
      chart: "图表",
      pixelDraft: "像素草稿",
      anchor: "锚点",
      source: "来源",
      xAxis: "X 轴/项目",
      yAxis: "Y 轴/数值",
      axis: "坐标轴",
      pixelPosition: "像素位置",
      axisValue: "轴值",
      series: "系列",
      pointCount: "点数",
      reviewStatus: "复核状态",
      xValue: "X/项目",
      yValue: "Y/数值",
      point: "点位",
      pixelX: "Pixel X",
      pixelY: "Pixel Y",
      axisXValue: "X 轴值",
      axisYValue: "Y 轴值",
      unit: "单位",
      confidence: "置信度",
      noChartDataDrafts: "未能从重建表格、可校正 OCR 或回答文本中抽取图表数据草稿；需要人工放大原图或重新提问。",
      noPixelDataDrafts: "未能从回答中抽取像素/坐标数据草稿；需要使用多模态模型重新输出 Pixel X、Pixel Y、轴值和置信度。",
      noCalibrationAnchors: "未检测到坐标轴校准锚点表；如需后续量化复用，请让模型补充 Axis、Pixel、Value、Unit、Source 和 Confidence。",
      chartQualityReview: "图表数据质量审阅",
      chartReviewActions: "图表人工复核任务",
      qualityStatus: "质量状态",
      qualityScore: "质量分",
      qualityCheck: "检查项",
      detail: "细节",
      recommendations: "复核建议",
      priority: "优先级",
      reviewState: "复核状态",
      action: "任务",
      relatedCheck: "关联检查",
      nextStep: "下一步",
      doneCriteria: "完成条件",
      reviewer: "复核人",
      due: "期限",
      notes: "备注",
      noChartReviewActions: "当前质量审阅未生成强制复核任务；正式使用前仍建议回到原图抽查。",
      noQualityIssues: "未发现结构化质量风险；正式使用前仍建议回到原图核对。",
      recommendationAxisCalibration: "补充至少两个清晰坐标轴刻度/数值锚点，并对照原图核对 Pixel X/Y 到 Axis X/Y 的映射。",
      recommendationCalibrationQuality: "重新核对校准锚点的像素跨度、单调性、重复刻度和数值单位；跨度太小或非单调时不要用于量化比较。",
      recommendationConfidence: "在人工确认点位读数、单位和坐标轴前，不要把抽取值当作最终实验数据。",
      recommendationImageEvidence: "重新提问时要求模型用 [image] 标注直接视觉观察，并把文本上下文推断分开。",
      recommendationPointCount: "放大原图或要求模型输出更密集的点表后，再用于跨论文实验对比。",
      reviewActionReconstructChartData: "重新要求模型输出可复核的重建数据表，或人工从原图读取最少关键点。",
      reviewActionAddPixelCoordinates: "要求模型补充 Pixel X、Pixel Y、Axis X、Axis Y 表，并标注低置信点。",
      reviewActionAddAxisCalibration: "补充每个坐标轴至少两个清晰刻度锚点，再重新导出报告。",
      reviewActionVerifyCalibrationQuality: "回到原图核对锚点跨度、单调性、重复值和单位，异常时不要用于量化比较。",
      reviewActionConfirmConfidence: "人工确认低置信读数、单位和图例；确认前只作为草稿使用。",
      reviewActionSeparateImageEvidence: "重新提问时要求直接视觉观察都用 [image] 标注，推断内容单独列出。",
      reviewActionRequestMorePoints: "放大原图或重新提问，要求输出更密集但仍可复核的点表。",
      reviewActionManualReview: "回到原图和 PDF 上下文进行人工复核。",
      reviewDoneReconstructChartData: "已得到含单位、图例/系列和证据标签的可复核数据表。",
      reviewDoneAddPixelCoordinates: "已为关键点补齐 Pixel X、Pixel Y、Axis X、Axis Y 和置信度。",
      reviewDoneAddAxisCalibration: "每个坐标轴至少有两个清晰刻度锚点，并已重新导出报告。",
      reviewDoneVerifyCalibrationQuality: "锚点跨度、单调性、重复值和单位已人工核对，可说明是否能量化使用。",
      reviewDoneConfirmConfidence: "低置信读数、单位、图例和轴映射已逐项确认或标记为不可用。",
      reviewDoneSeparateImageEvidence: "直接视觉观察、文本上下文推断和低置信判断已分开标注。",
      reviewDoneRequestMorePoints: "已补充更密集且仍可复核的点表，或记录无法可靠抽取的原因。",
      reviewDoneManualReview: "已回到原图和 PDF 上下文复核，并填写处理结论。",
      structuredData: "机器可读数据",
      row: "行",
      column: "字段",
      value: "值",
      noStructuredRows: "未能从重建表格解析出机器可读数据行。",
      reviewChecklist: "复核清单",
      checkReadableText: "核对 OCR 文本、标题、坐标轴、图例、表头和公式是否可读。",
      checkTableNumbers: "核对重建表格中的数字、单位、指标和数据集名称。",
      checkChartDataDrafts: "核对图表数据草稿的轴、系列、单位、读数、质量审阅结果和置信度，不能直接作为最终数据。",
      checkPixelDataDrafts: "核对像素/坐标草稿中的点位、像素坐标、轴值映射和置信度；必要时回到原图校准坐标轴。",
      checkImageEvidence: "区分直接视觉观察、论文上下文推断和低置信判断。",
      checkPdfLocation: "回到 PDF 原图位置核对页码、图号/表号和上下文。",
      checkReuse: "标记可复用于综述、实验对比、方法复现或后续检索的条目。",
      originalAnswer: "原始模型回答",
      noAnswer: "没有可用回答。",
      unknown: "未知"
    };
  }
  return {
    title: "Figure/Table Extraction Report",
    paperTitle: "Title",
    generatedAt: "Generated at",
    reportFile: "Report file",
    jsonFile: "Structured JSON",
    csvFile: "Structured CSV",
    mode: "Extraction mode",
    model: "Model",
    imageInventory: "Image Inventory",
    imageName: "Image",
    imageType: "Type",
    imageSize: "Bytes",
    localOcr: "Local OCR",
    localOcrNotRun: "not run",
    localOcrOk: "recognized",
    localOcrCorrected: "corrected",
    localOcrManual: "manual",
    localOcrEmpty: "no text",
    localOcrFailed: "failed",
    noImages: "No image attachment metadata was recorded for this export; check the original session.",
    sectionIndex: "Structured Extraction Index",
    section: "Section",
    summary: "Summary",
    evidenceLabels: "Evidence labels",
    noEvidenceLabels: "not labeled",
    noSections: "No structured H2 sections were detected; manually organize the original answer.",
    reconstructedTables: "Reconstructed Tables / Data",
    table: "Table",
    noTables: "No Markdown table was detected. If the image contains chart data, verify manually or ask again with the figure/table extractor.",
    chartDataDrafts: "Chart Data Drafts",
    pixelDataDrafts: "Pixel / Coordinate Data Drafts",
    calibrationAnchors: "Axis Calibration Anchors",
    chart: "Chart",
    pixelDraft: "Pixel draft",
    anchor: "Anchor",
    source: "Source",
    xAxis: "X axis / item",
    yAxis: "Y axis / value",
    axis: "Axis",
    pixelPosition: "Pixel position",
    axisValue: "Axis value",
    series: "Series",
    pointCount: "Points",
    reviewStatus: "Review status",
    xValue: "X / item",
    yValue: "Y / value",
    point: "Point",
    pixelX: "Pixel X",
    pixelY: "Pixel Y",
    axisXValue: "Axis X value",
    axisYValue: "Axis Y value",
    unit: "Unit",
    confidence: "Confidence",
    noChartDataDrafts: "No chart data draft could be extracted from reconstructed tables, editable OCR, or answer text; zoom the original image or ask again.",
    noPixelDataDrafts: "No pixel / coordinate data draft could be extracted; ask a multimodal model to return Pixel X, Pixel Y, axis values, and confidence.",
    noCalibrationAnchors: "No axis calibration anchor table was detected. For reusable quantitative exports, ask for Axis, Pixel, Value, Unit, Source, and Confidence.",
    chartQualityReview: "Chart Data Quality Review",
    chartReviewActions: "Chart Review Action Queue",
    qualityStatus: "Quality status",
    qualityScore: "Quality score",
    qualityCheck: "Check",
    detail: "Detail",
    recommendations: "Review Recommendations",
    priority: "Priority",
    reviewState: "Review state",
    action: "Action",
    relatedCheck: "Related check",
    nextStep: "Next step",
    doneCriteria: "Done criteria",
    reviewer: "Reviewer",
    due: "Due",
    notes: "Notes",
    noChartReviewActions: "No required review action was generated by the quality review; still spot-check the original figure before final use.",
    noQualityIssues: "No structured quality risk was detected; still verify against the original figure before final use.",
    recommendationAxisCalibration: "Add at least two visible axis tick/value anchors and verify Pixel X/Y to Axis X/Y mapping against the original chart.",
    recommendationCalibrationQuality: "Recheck calibration-anchor pixel span, monotonicity, duplicate ticks, and units; do not use small-span or non-monotonic anchors for quantitative comparison.",
    recommendationConfidence: "Treat extracted chart values as review drafts until a human confirms the point readings, units, and axes.",
    recommendationImageEvidence: "Ask the model to mark direct visual observations with [image] and keep text-context inferences separate.",
    recommendationPointCount: "Zoom the original figure or request a denser point table before using the data for cross-paper comparison.",
    reviewActionReconstructChartData: "Ask for a reviewable reconstructed data table again, or manually read the minimum key points from the original figure.",
    reviewActionAddPixelCoordinates: "Ask for a Pixel X, Pixel Y, Axis X, Axis Y table and mark low-confidence points explicitly.",
    reviewActionAddAxisCalibration: "Add at least two visible tick anchors per axis, then export the report again.",
    reviewActionVerifyCalibrationQuality: "Recheck anchor span, monotonicity, duplicate values, and units against the original chart before quantitative use.",
    reviewActionConfirmConfidence: "Manually confirm low-confidence readings, units, and legends; treat them as draft values until then.",
    reviewActionSeparateImageEvidence: "Ask again with direct visual observations marked as [image] and inferred context separated.",
    reviewActionRequestMorePoints: "Zoom the figure or ask again for a denser but still reviewable point table.",
    reviewActionManualReview: "Review the original figure and PDF context manually.",
    reviewDoneReconstructChartData: "A reviewable data table with units, legend or series labels, and evidence labels is available.",
    reviewDoneAddPixelCoordinates: "Key points include Pixel X, Pixel Y, Axis X, Axis Y, and confidence.",
    reviewDoneAddAxisCalibration: "Each axis has at least two visible tick anchors, and the report has been exported again.",
    reviewDoneVerifyCalibrationQuality: "Anchor span, monotonicity, duplicate values, and units have been manually checked with a reuse decision.",
    reviewDoneConfirmConfidence: "Low-confidence readings, units, legends, and axis mappings are confirmed or marked unusable.",
    reviewDoneSeparateImageEvidence: "Direct visual observations, text-context inference, and low-confidence judgments are separated.",
    reviewDoneRequestMorePoints: "A denser but still reviewable point table is added, or the extraction limit is recorded.",
    reviewDoneManualReview: "The original figure and PDF context have been reviewed, with the outcome recorded.",
    structuredData: "Machine-Readable Data",
    row: "Row",
    column: "Column",
    value: "Value",
    noStructuredRows: "No machine-readable data rows could be parsed from reconstructed tables.",
    reviewChecklist: "Review Checklist",
    checkReadableText: "Check OCR text, titles, axes, legends, headers, and formulas.",
    checkTableNumbers: "Verify reconstructed numbers, units, metrics, and dataset names.",
    checkChartDataDrafts: "Verify chart-data draft axes, series, units, readings, quality-review flags, and confidence before reuse.",
    checkPixelDataDrafts: "Verify pixel / coordinate drafts, point labels, pixel coordinates, axis-value mapping, and confidence; recalibrate against the original image when needed.",
    checkImageEvidence: "Separate direct visual observations, paper-context inference, and low-confidence judgments.",
    checkPdfLocation: "Return to the PDF figure/table location and verify page, label, and context.",
    checkReuse: "Mark items reusable for review writing, experiment comparison, reproduction, or follow-up search.",
    originalAnswer: "Original Model Answer",
    noAnswer: "No answer is available.",
    unknown: "Unknown"
  };
}

function markdownTableCell(value) {
  const text = mdText(value);
  return text ? text.replace(/\|/g, "\\|").replace(/\n/g, "<br>") : "";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function contextDiagnosticsText(diagnostics, translate = (key) => key) {
  if (!diagnostics) return "";
  const lines = [
    `${translate("contextQuality")}: ${translate("contextChunks")} ${Number(diagnostics.chunkCount) || 0}; ${translate("contextFulltextChars")} ${Number(diagnostics.fulltextChars) || 0}; ${translate("contextAnnotations")} ${Number(diagnostics.annotationCount) || 0}; ${translate("contextNotes")} ${Number(diagnostics.noteCount) || 0}; ${translate("contextSummary")} ${Number(diagnostics.summaryChars) || 0}`
  ];
  const warnings = [];
  if (!diagnostics.hasPdf) warnings.push(translate("contextPdfMissing"));
  else {
    if (!diagnostics.pdfPathAvailable) warnings.push(translate("contextPdfPathMissing"));
    if (!diagnostics.fulltextChars) warnings.push(translate("contextFulltextMissing"));
  }
  if (warnings.length) lines.push(warnings.join("\n"));
  return lines.join("\n");
}

function requestMessagesWithHistory(messages, latestUserText, requestPrompt, options = {}) {
  const limit = options.limit ?? 8;
  const compaction = options.compaction || null;
  const recent = messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && String(message.content || "").trim())
    .slice(-limit);
  if (recent.at(-1)?.role === "user" && recent.at(-1)?.content === latestUserText) {
    recent.pop();
  }
  const out = [];
  if (compaction && compaction.summary) {
    out.push({
      role: "system",
      content: `[Earlier conversation summary from ${new Date(compaction.at || Date.now()).toLocaleString()}]\n${compaction.summary}`
    });
  }
  for (const message of recent) {
    out.push({ role: message.role, content: message.content });
  }
  out.push({ role: "user", content: requestPrompt });
  return out;
}

function chunkText(text, sourceType, maxChars) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (paragraph.length <= maxChars) current = paragraph;
      else {
        for (let index = 0; index < paragraph.length; index += maxChars) chunks.push(paragraph.slice(index, index + maxChars));
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => ({ chunkId: stableChunkId(sourceType, chunk, index), sourceType, locator: `${sourceType}:${index + 1}`, text: chunk, sourceHash: hashString(chunk) }));
}

function stableChunkId(sourceType, chunk, index) {
  return `${sourceType}-${hashString(chunk).slice(0, 8)}-${String(index + 1).padStart(4, "0")}`;
}

function selectRelevantChunks(chunks, query, limit) {
  const terms = String(query || "").toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((term) => term.length >= 2);
  return [...chunks].map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.chunk);
}

function scoreChunk(chunk, terms) {
  const lower = String(chunk.text || "").toLowerCase();
  const termScore = terms.reduce((score, term) => score + termFrequency(lower, term), 0);
  return termScore * 10 + sourceWeight(chunk.sourceType);
}

function termFrequency(text, term) {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function sourceWeight(sourceType) {
  return {
    summary: 6,
    annotation: 5,
    note: 4,
    abstract: 3,
    metadata: 2,
    fulltext: 1
  }[sourceType] || 0;
}

async function ensureSkillTemplates(outputDir) {
  const skillsDir = PathUtils.join(outputDir, "skills");
  await ensureDirectory(skillsDir);
  for (const id of ZMS_SKILL_IDS) {
    const path = PathUtils.join(skillsDir, `${id}.md`);
    if (!await IOUtils.exists(path)) await writeText(path, builtInSkillTemplate(id, "zh-CN"));
  }
}

async function loadSkillTemplate(outputDir, skillId, outputLanguage) {
  const safeSkillId = normalizeSkillId(skillId) || "paper-deep-summary";
  const path = PathUtils.join(outputDir, "skills", `${safeSkillId}.md`);
  try {
    if (await IOUtils.exists(path)) {
      const text = await readText(path);
      if (text.trim()) return `${text.trim()}\n\n${languageInstruction(outputLanguage)}`;
    }
  } catch (_err) {
    // Use the built-in skill when the configured output directory is stale.
  }
  return builtInSkillTemplate(safeSkillId, outputLanguage);
}

async function availableSkillIds(outputDir) {
  const ids = new Set(ZMS_SKILL_IDS);
  try {
    const skillsDir = PathUtils.join(outputDir, "skills");
    if (!await IOUtils.exists(skillsDir)) return [...ids];
    const children = await IOUtils.getChildren(skillsDir);
    for (const path of children) {
      const name = leafName(path);
      if (name.endsWith(".md")) {
        const skillId = normalizeSkillId(name.slice(0, -3));
        if (skillId) ids.add(skillId);
      }
    }
  } catch (_err) {
    // Built-in skills remain available if the local folder is not readable.
  }
  return [...ids];
}

function builtInSkillTemplate(skillId, outputLanguage) {
  const common = [
    languageInstruction(outputLanguage),
    "Use only the provided paper metadata and context excerpts.",
    "Mark each important claim with an evidence note such as [metadata], [abstract], or [chunk:<id>].",
    "If evidence is missing, mark the point as low-confidence."
  ].join("\n");
  if (skillId === "method-extractor") return `${common}\n\nExtract method, model, algorithm flow, inputs, outputs, constraints, and reusable details.`;
  if (skillId === "experiment-table-builder") return `${common}\n\nBuild a Markdown table for datasets, baselines, metrics, ablations, results, and limitations.`;
  if (skillId === "figure-table-extractor") return figureTableTemplate(common, outputLanguage);
  if (skillId === "literature-matrix-builder") return literatureMatrixTemplate(common, outputLanguage);
  if (skillId === "literature-review-synthesis") return literatureReviewSynthesisTemplate(common, outputLanguage);
  if (skillId === "citation-audit") return `${common}\n\nAudit claims and identify unsupported or weakly supported statements.`;
  if (skillId === "custom-summary") return `${common}\n\nFollow the user's custom research goal and produce a structured Markdown note.`;
  if (skillId === "ask-gemini") {
    return `${common}\n\nAnalyze this paper with a Gemini-style lens. Summarize key contributions, identify weak assumptions, surface likely edge cases, and propose follow-up questions.`;
  }
  if (skillId === "ask-claude") {
    return `${common}\n\nGive a reviewer-style critique focused on novelty, validity, and potential failure modes; propose practical revision actions.`;
  }
  if (skillId === "ask-opencode") {
    return `${common}\n\nProvide practical implementation guidance: reproducible experiment design, code-level checkpoints, tooling assumptions, and validation order.`;
  }
  if (skillId === "ask-all-agents") {
    return `${common}\n\nQuery all local agents and report agreement points, disagreement points, and consolidated recommendations with uncertainty.`;
  }
  if (skillId === "ask-gemini-claude") {
    return `${common}\n\nQuery Gemini and Claude and report agreement points, disagreement points, and consolidated recommendations with uncertainty.`;
  }
  if (skillId === "check-local-agents") {
    return `${common}\n\nRun a quick local-agent health check and report each subagent status, likely failure causes, and command-level remediation suggestions.`;
  }
  return paperDeepSummaryTemplate(common, outputLanguage);
}

function figureTableTemplate(common, outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n${[
      "请结构化解析论文中的截图、图表、表格、公式截图或实验结果。优先结合图片附件、PDF/摘要上下文和用户问题；若没有图片附件，则只从文本上下文中抽取。输出 Markdown，并固定使用以下章节：",
      "",
      "## 对象识别",
      "- 类型：图、表、流程图、公式截图、实验结果、消融结果或其他。",
      "- 所属位置：如果能判断，写 Figure/Table 编号、标题、页码或上下文证据。",
      "- 研究作用：这张图/表在论文中承担的问题、方法、实验或结论角色。",
      "",
      "## 视觉 OCR 文本",
      "- 逐项转录能看清的标题、坐标轴、图例、表头、指标、数据集、模型名、公式符号和关键数值。",
      "- 看不清的内容写 [illegible]；可能识别错的内容标注低置信度。",
      "- 保留原始单位、大小写、缩写和符号，不要自动改写。",
      "",
      "## 表格/数据重建",
      "- 如果图片中有表格或可读数值，用 Markdown 表格重建：字段至少包括 项目、数值/文本、单位、来源、置信度、备注。",
      "- 如果是折线图、柱状图或散点图，只重建能可靠读出的点或区间，并写明坐标轴、图例和读数依据。",
      "- 如果无法可靠重建，明确写“无法可靠重建”，不要补不存在的数据。",
      "",
      "## 密集点位数据草稿",
      "- 若折线图、柱状图或散点图有多个可读点，请补充更密集但仍可复核的 Markdown 表格，字段包括 Series、Point、Axis X、Axis Y、Unit、Confidence、Source、Notes。",
      "- 只列出能从原图直接观察、读数或明确估计的点；不能读出的区间写无法可靠抽取，不要插值补全。",
      "",
      "## 像素/坐标数据草稿",
      "- 若图中有折线、柱状或散点，请在可见范围内给出可复核的 Markdown 表格，字段包括 Series、Point、Pixel X、Pixel Y、Axis X、Axis Y、Confidence、Source、Notes。",
      "- Pixel X/Y 是图像中的估计像素位置；Axis X/Y 是按坐标轴读出的数据值。读不准时留空或标低置信度。",
      "- 只输出能从图像直接观察或明确估计的点，不要为了凑完整曲线而补点。",
      "",
      "## 坐标轴校准锚点",
      "- 如果图表有 X/Y 坐标轴，请给出用于校准的可见刻度锚点表，字段包括 Axis、Pixel、Value、Unit、Source、Confidence、Notes。",
      "- 每个坐标轴至少输出两个清晰锚点；如果看不清刻度，明确写无法可靠校准。",
      "",
      "## 结论与证据映射",
      "- 解释图/表想证明什么，以及它如何支持或限制论文主张。",
      "- 每条解释都标注证据来源：[image]、[metadata]、[abstract] 或 [chunk:<id>]。",
      "- 区分图片直接观察、文本上下文推断和低置信度判断。",
      "",
      "## 综述/复现可复用信息",
      "- 给出适合写进文献综述、实验对比、方法复现或后续问题的要点。",
      "- 明确可比较指标、实验条件、baseline、公平性风险和需要补查的原文位置。",
      "",
      "## 不确定性与复核清单",
      "- 列出模糊、遮挡、缺少上下文、模型无法可靠识别、需要人工放大或回到 PDF 原图核对的部分。",
      "",
      "不要编造看不清的数字；不要把文本上下文推断伪装成图片观察。"
    ].join("\n")}`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n論文中のスクリーンショット、図、表、数式画像、実験結果を構造化して解析してください。画像添付、PDF/要約コンテキスト、ユーザー質問を優先し、画像がない場合はテキスト根拠だけで抽出してください。Markdown で次の章を固定して使ってください: 対象識別、視覚 OCR テキスト、表/データ再構成、密集ポイントデータ下書き、ピクセル/座標データ下書き、座標軸キャリブレーションアンカー、結論と根拠マッピング、レビュー/再現に使える情報、不確実性と確認リスト。読めない数値は [illegible] とし、推測しないでください。表や数値は、項目、値/テキスト、単位、出典、信頼度、備考を持つ Markdown 表として再構成してください。グラフでは読める場合だけ Series、Point、Axis X、Axis Y、Unit、Confidence、Source、Notes を持つ密集ポイント表を追加し、可能な場合だけ Series、Point、Pixel X、Pixel Y、Axis X、Axis Y、Confidence、Source、Notes を持つ表を追加してください。X/Y 軸ごとに少なくとも 2 つの Axis、Pixel、Value、Unit、Source、Confidence アンカーを追加してください。各解釈には [image]、[metadata]、[abstract]、[chunk:<id>] の根拠を付け、画像観察、テキスト推論、低信頼判断を区別してください。`;
  }
  return `${common}\n\n${[
    "Extract structured information from screenshots, figures, tables, formula captures, or experimental-result panels. Prefer attached images plus the provided paper/PDF context and the user question; if no image is attached, extract only from the text context. Use Markdown with these exact sections:",
    "",
    "## Object Identification",
    "- Type: figure, table, flow chart, formula capture, experiment result, ablation result, or other.",
    "- Location: Figure/Table number, title, page, or contextual evidence when available.",
    "- Research role: problem, method, experiment, or conclusion role in the paper.",
    "",
    "## Visual OCR Text",
    "- Transcribe readable titles, axes, legends, headers, metrics, datasets, model names, formula symbols, and key numbers.",
    "- Write [illegible] for unreadable content and mark uncertain recognition as low-confidence.",
    "- Preserve original units, capitalization, abbreviations, and symbols.",
    "",
    "## Reconstructed Data Table",
    "- For tables or readable numbers, reconstruct a Markdown table with at least: Item, Value/Text, Unit, Source, Confidence, Notes.",
    "- For line/bar/scatter charts, reconstruct only reliably readable points or ranges, and state the axis, legend, and reading basis.",
    "- If reconstruction is unreliable, say so explicitly instead of filling missing values.",
    "",
    "## Dense Point Data Draft",
    "- For line, bar, or scatter charts with multiple readable points, add a denser but still reviewable Markdown table with: Series, Point, Axis X, Axis Y, Unit, Confidence, Source, Notes.",
    "- Include only points directly visible, read from the chart, or explicitly estimated from the visual. If a region cannot be read, say so instead of interpolating missing values.",
    "",
    "## Pixel / Coordinate Data Draft",
    "- For visible line, bar, or scatter charts, add a reviewable Markdown table when possible with: Series, Point, Pixel X, Pixel Y, Axis X, Axis Y, Confidence, Source, Notes.",
    "- Pixel X/Y are estimated image coordinates; Axis X/Y are values read from the chart scale. Leave fields blank or mark low-confidence when unsure.",
    "- Include only directly visible or explicitly estimated points; do not fabricate a complete series.",
    "",
    "## Axis Calibration Anchors",
    "- For charts with X/Y axes, add a visible tick-anchor table with: Axis, Pixel, Value, Unit, Source, Confidence, Notes.",
    "- Provide at least two clear anchors per axis when readable; if the ticks are unreadable, state that calibration is unreliable.",
    "",
    "## Interpretation And Evidence Map",
    "- Explain what the visual tries to prove and how it supports or limits the paper's claims.",
    "- Mark every interpretation with [image], [metadata], [abstract], or [chunk:<id>].",
    "- Separate direct visual observation, text-context inference, and low-confidence judgment.",
    "",
    "## Reusable Review Or Reproduction Notes",
    "- Extract points useful for a literature review, experiment comparison, method reproduction, or follow-up question.",
    "- Call out comparable metrics, experimental conditions, baselines, fairness risks, and original-PDF locations to verify.",
    "",
    "## Uncertainty And Review Checklist",
    "- List blur, occlusion, missing context, unreliable recognition, and items that need manual zooming or checking against the original PDF.",
    "",
    "Do not invent unreadable numbers, and do not present text-context inference as direct image observation."
  ].join("\n")}`;
}

function literatureMatrixTemplate(common, outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n生成 literature matrix。若上下文包含 Comparison paper，请同时比较焦点论文和所有对比论文；否则先为当前论文建立单篇矩阵。输出 Markdown，至少包含：\n\n1. 论文清单：题名、年份、研究对象、问题类型、证据标签。\n2. 对比矩阵：研究问题、方法/模型、数据或场景、实验指标、核心发现、局限、可复用思想、证据标签。\n3. 交叉分析：共同假设、关键差异、证据强弱、可能矛盾、可合并的研究路线。\n4. 综述草稿要点：适合放入文献综述的小标题和 3-6 条可直接改写的要点。\n\n每个矩阵单元必须引用 [chunk:<id>]、[paper2:<id>] 或 [metadata] 等证据；缺证据时写低置信度，不要补全不存在的信息。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\nliterature matrix を作成してください。Comparison paper がある場合は、焦点論文と比較論文を同時に比較してください。ない場合は、現在の論文だけで単一論文の行列を作成してください。Markdown で、論文一覧、比較行列、横断分析、レビュー草稿の要点を含めてください。各セルには [chunk:<id>]、[paper2:<id>]、または [metadata] のような根拠ラベルを付け、根拠が弱い場合は低信頼と明記してください。`;
  }
  return `${common}\n\nCreate a literature matrix. If the context contains Comparison papers, compare the focal paper against every comparison paper; otherwise build a single-paper matrix for the current paper first. Use Markdown and include:\n\n1. Paper inventory: title, year, research object, problem type, and evidence labels.\n2. Comparison matrix: research question, method/model, data or scenario, experimental metrics, key findings, limitations, reusable ideas, and evidence labels.\n3. Cross-paper analysis: shared assumptions, decisive differences, evidence strength, possible contradictions, and mergeable research directions.\n4. Review-draft notes: section headings and 3-6 bullets that can be rewritten into a literature review.\n\nEvery matrix cell must cite evidence labels such as [chunk:<id>], [paper2:<id>], or [metadata]. Mark unsupported cells as low-confidence instead of filling gaps.`;
}

function literatureReviewSynthesisTemplate(common, outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n生成可直接用于文献综述写作的跨论文综合。若上下文包含 Comparison papers，请把焦点论文和所有对比论文一起综合；若只有当前论文，先输出单篇综述骨架并明确缺少对比论文。使用 Markdown，固定包含：\n\n## 综述主题与范围\n## 论文分组与研究谱系\n## 共同问题与核心共识\n## 方法、数据与实验对比\n## 关键分歧与证据强弱\n## 研究空白与未解决问题\n## 可写入正文的综述段落草稿\n## 后续补充文献与验证清单\n\n每个判断都必须引用 [metadata]、[chunk:<id>]、[paper2:<id>] 等证据标签；不要把低置信推断写成确定结论。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n文献レビュー執筆に使える横断的な統合を作成してください。Comparison papers がある場合は焦点論文と比較論文をまとめて扱い、ない場合は単一論文のレビュー骨子として不足を明記してください。章はレビュー範囲、論文群の分類、共通課題、方法・データ・実験比較、相違点と証拠強度、研究ギャップ、本文に使える段落案、追加確認リストを含めてください。各判断には [metadata]、[chunk:<id>]、[paper2:<id>] などの根拠ラベルを付けてください。`;
  }
  return `${common}\n\nCreate a cross-paper synthesis for literature-review writing. If the context contains Comparison papers, synthesize the focal paper together with every comparison paper; otherwise produce a single-paper review scaffold and state that comparison papers are missing. Use Markdown with these sections:\n\n## Review Scope\n## Paper Groups And Research Lineage\n## Shared Problem And Core Consensus\n## Method, Data, And Experiment Comparison\n## Key Disagreements And Evidence Strength\n## Research Gaps And Open Questions\n## Draft Review Paragraphs\n## Follow-up Literature And Verification Checklist\n\nEvery judgment must cite evidence labels such as [metadata], [chunk:<id>], or [paper2:<id>]. Mark low-confidence inferences explicitly instead of presenting them as settled claims.`;
}

function languageInstruction(outputLanguage) {
  if (outputLanguage === "en-US") return "Write the output in English.";
  if (outputLanguage === "ja-JP") return "日本語で出力してください。";
  return "请使用中文输出。";
}

function normalizePromptPackId(value) {
  const id = String(value || "").trim();
  return ZMS_PROMPT_PACK_IDS.includes(id) ? id : "general";
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

function promptTextForRequest(skillTemplate, savedSummaryPrompt, userText, promptPackId, outputLanguage) {
  return [
    promptPackInstructionBlock(promptPackId, outputLanguage),
    String(skillTemplate || "").trim(),
    String(savedSummaryPrompt || "").trim(),
    String(userText || "").trim()
  ].filter(Boolean).join("\n\n");
}

function paperDeepSummaryTemplate(common, outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n请生成单篇深度阅读报告，使用以下 Markdown 章节：基本信息、研究背景、研究问题、方法框架、实验与验证、主要发现、贡献、局限、后续想法。每节只写有证据支持的内容，缺证据处标注低置信度。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n単一論文の詳細読解レポートを作成してください。Markdown の章立ては、基本情報、研究背景、研究課題、手法、実験と検証、主な知見、貢献、限界、次の検討事項にしてください。根拠のある内容だけを書き、根拠が弱い箇所は低信頼として明記してください。`;
  }
  return `${common}\n\nCreate a deep paper reading report with Markdown sections for basic information, background, research question, method, experiments and validation, findings, contributions, limitations, and follow-up ideas. Keep every section evidence-grounded and mark unsupported points as low-confidence.`;
}

function defaultImageQuestion(outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return "请解析这张图片，说明它展示的对象、关键文字或数值、与当前论文的关系、可用于综述或复现的要点，以及看不清或不确定的部分。";
  }
  if (outputLanguage === "ja-JP") {
    return "この画像を解析し、示している対象、重要な文字や数値、現在の論文との関係、レビューや再現に使える要点、不明確な部分を説明してください。";
  }
  return "Analyze this image. Explain what it shows, key text or numbers, how it relates to the current paper, reusable notes for review or reproduction, and any unclear or uncertain parts.";
}

function userTextForSend(rawContent, skillId, imageCount, outputLanguage) {
  const content = String(rawContent || "").trim();
  if (content) return content;
  if (!skillId && imageCount > 0) return defaultImageQuestion(outputLanguage);
  return "";
}

function displayTextForSend(rawContent, skillId, imageCount, outputLanguage, labelFor) {
  const content = String(rawContent || "").trim();
  if (content) return content;
  if (skillId) return labelFor?.(skillId) || skillId;
  return userTextForSend("", "", imageCount, outputLanguage);
}

function normalizeSkillId(value) {
  return String(value || "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function canUsePdfBase64Input(profile) {
  return profile?.capabilities?.pdfBase64 === true && profile.protocol !== "openai_chat";
}

function canUseImageInput(profile) {
  return profile?.capabilities?.imageBase64 === true;
}

function assertModelInputSupport(profile, requestInput = {}) {
  const model = String(profile?.model || "").trim();
  if (!model || !modelLikelyTextOnlyForRequest(profile)) return;
  if (requestInputImages(requestInput).length) {
    throw new Error(`Selected model ${model} is text-only; choose an image-capable model before sending images.`);
  }
  if (requestInput?.type === "pdf_base64" && requestInput.base64) {
    throw new Error(`Selected model ${model} is text-only; choose a PDF-capable model or switch to extracted text input.`);
  }
}

function modelLikelyTextOnlyForRequest(profile) {
  if (typeof zmsModelLikelyTextOnlyForProviderModel !== "function") return false;
  const provider = workbenchProviderFromProfile(profile, profile?.id || "");
  return zmsModelLikelyTextOnlyForProviderModel(provider, profile?.model || "", profile?.model || "");
}

async function buildRequestInput(profile, inputMode, pdf, images = []) {
  if (normalizeInputMode(inputMode) !== "pdf_base64") {
    return { type: "text", source: "text_mode", images: normalizedImageAttachments(images) };
  }
  if (!canUsePdfBase64Input(profile)) {
    return { type: "text", source: "unsupported_profile", reason: "Profile does not support pdf_base64", images: normalizedImageAttachments(images) };
  }
  if (!pdf) {
    return { type: "text", source: "no_pdf", reason: "No PDF attachment", images: normalizedImageAttachments(images) };
  }
  const pdfPath = await attachmentFilePath(pdf);
  let base64 = pdfPath ? await attachmentToBase64(pdfPath) : "";
  if (!base64) {
    base64 = await attachmentPdfBase64(pdf);
  }
  if (!base64) {
    return pdfPath
      ? { type: "text", source: "read_failed", reason: "Failed to encode PDF as base64", images: normalizedImageAttachments(images) }
      : { type: "text", source: "no_pdf_path", reason: "PDF path unavailable", images: normalizedImageAttachments(images) };
  }
  return {
    type: "pdf_base64",
    source: "pdf_base64",
    base64,
    filename: attachmentDisplayName(pdf) || "paper.pdf",
    images: normalizedImageAttachments(images)
  };
}

function requestInputStatusText(requestInput, translate = (key) => key) {
  const t = typeof translate === "function" ? translate : (key) => key;
  const source = requestInput?.source || requestInput?.type;
  if (requestInput?.type === "pdf_base64") return t("inputPdfBase64");
  if (source === "unsupported_profile") return t("inputFallbackUnsupported");
  if (source === "no_pdf") return t("inputFallbackNoPdf");
  if (source === "no_pdf_path") return t("inputFallbackNoPath");
  if (source === "read_failed") return t("inputFallbackReadFailed");
  return t("inputTextMode");
}

async function attachmentFilePath(attachment) {
  if (!attachment) return "";
  try {
    if (typeof attachment.getFilePathAsync === "function") return await attachment.getFilePathAsync();
  } catch (_err) {
    // fall through
  }
  if (typeof attachment.getFilePath === "function") {
    try {
      return attachment.getFilePath();
    } catch (_err) {
      // keep fallback
    }
  }
  return attachment.path || attachment.filePath || "";
}

function attachmentDisplayName(attachment) {
  return attachment?.getField?.("title") || attachment?.attachmentFilename || attachment?.filename || "";
}

async function attachmentToBase64(path) {
  try {
    const bytes = await readBinary(path);
    if (!bytes?.length) return "";
    return bytesToBase64(bytes);
  } catch (_err) {
    return "";
  }
}

async function readBinary(path) {
  if (!IOUtils.read) return null;
  const raw = await IOUtils.read(path);
  if (raw?.byteLength !== undefined) {
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    return new Uint8Array(raw);
  }
  if (typeof raw === "string") return new TextEncoder().encode(raw);
  if (Array.isArray(raw)) return Uint8Array.from(raw);
  return null;
}

function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    bytes = new Uint8Array(bytes);
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function imageFilesFromDataTransfer(dataTransfer) {
  const files = [];
  for (const file of Array.from(dataTransfer?.files || [])) {
    if (String(file?.type || "").startsWith("image/")) files.push(file);
  }
  for (const item of Array.from(dataTransfer?.items || [])) {
    if (String(item?.type || "").startsWith("image/") && typeof item.getAsFile === "function") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  const seen = new Set();
  return files.filter((file) => {
    const key = `${file.name || ""}:${file.size || 0}:${file.type || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function imageAttachmentFromFile(file) {
  const dataURL = await fileToDataURL(file);
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataURL);
  if (!match) throw new Error("Unsupported image data");
  return {
    id: `image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: String(file?.name || "screenshot.png"),
    mimeType: match[1] || file?.type || "image/png",
    base64: match[2] || "",
    size: Number(file?.size) || 0
  };
}

function fileToDataURL(file) {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.readAsDataURL(file);
    });
  }
  if (typeof file?.arrayBuffer === "function") {
    return file.arrayBuffer().then((buffer) => {
      const mimeType = file.type || "image/png";
      return `data:${mimeType};base64,${bytesToBase64(new Uint8Array(buffer))}`;
    });
  }
  throw new Error("Image file API is unavailable");
}

function normalizedImageAttachments(images) {
  return (images || [])
    .filter((image) => image?.base64 && image?.mimeType)
    .map((image) => ({
      name: String(image.name || "image.png"),
      mimeType: String(image.mimeType || "image/png"),
      base64: String(image.base64 || "")
    }));
}

function imageMessageMetadata(image, localOcr = null) {
  const metadata = {
    name: image?.name || "image.png",
    mimeType: image?.mimeType || "image/png",
    size: Number(image?.size) || 0
  };
  if (localOcr?.status) metadata.localOcr = localOcr;
  return metadata;
}

async function localOcrForImage(image, options = {}) {
  if (typeof fetch !== "function") return null;
  const tool = String(options.tool || "ocr_image").trim() || "ocr_image";
  const endpoint = normalizeLocalAgentEndpoint(options.endpoint || "http://127.0.0.1:3333/mcp");
  const language = String(options.language || "").trim();
  try {
    const args = {
      image: {
        name: image?.name || "image.png",
        mimeType: image?.mimeType || "image/png",
        base64: image?.base64 || ""
      },
      timeoutSeconds: 30
    };
    if (language) args.language = language;
    const payload = await assertLocalAgentRequestOk({
      url: endpoint,
      signal: options.signal,
      headers: { "content-type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: `workbench-local-ocr-${Date.now()}`,
        method: "tools/call",
        params: {
          name: tool,
          arguments: args
        }
      }
    });
    const result = localOcrResultFromPayload(payload);
    const text = mdText(result.text || "");
    if (!text) {
      return {
        status: "empty",
        tool,
        engine: mdText(result.engine || ""),
        language: mdText(result.language || "")
      };
    }
    return {
      status: "ok",
      tool,
      engine: mdText(result.engine || "local-ocr"),
      language: mdText(result.language || ""),
      text: truncateText(text, 4000)
    };
  } catch (err) {
    return {
      status: "failed",
      tool,
      error: truncateText(safeError(err), 240)
    };
  }
}

function localOcrResultFromPayload(payload) {
  const content = Array.isArray(payload?.result?.content) ? payload.result.content : [];
  const text = content.map((part) => typeof part === "string" ? part : part?.text || "").filter(Boolean).join("\n").trim();
  const parsed = safeParseJSON(text);
  if (parsed && typeof parsed === "object") return parsed;
  return { text };
}

function endpointForProfile(profile) {
  if (profile.endpointMode === "full_url") return profile.fullURL || profile.baseURL;
  return endpointForProtocol(profile.protocol, profile.baseURL);
}

function headersForProfile(profile) {
  const headers = { "content-type": "application/json", ...(profile.customHeaders || {}) };
  if (profile.protocol === "anthropic_messages") {
    if (!hasExplicitAuthHeader(headers)) {
      const authHeader = anthropicAuthHeaderName(profile);
      setHeaderIfMissing(headers, authHeader, authHeader === "authorization" && profile.apiKey ? `Bearer ${profile.apiKey}` : profile.apiKey);
    }
    if (!shouldOmitAnthropicVersion(profile)) {
      setHeaderIfMissing(headers, "anthropic-version", "2023-06-01");
    }
    if (shouldAddAnthropicDirectBrowserAccess(profile)) {
      setHeaderIfMissing(headers, "anthropic-dangerous-direct-browser-access", "true");
    }
  } else if (usesAzureOpenAIAuth(profile)) {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "api-key", profile.apiKey);
  } else {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "authorization", profile.apiKey ? `Bearer ${profile.apiKey}` : "");
  }
  return withoutBlankHeaders(headers);
}

function profileHasUsableAuth(profile) {
  if (String(profile?.apiKey || "").trim()) return true;
  const headers = profile?.customHeaders || {};
  if (hasExplicitAuthHeader(headers)) return true;
  try {
    return isLocalEndpoint(endpointForProfile(profile || {}));
  } catch (_err) {
    return false;
  }
}

function hasHeader(headers, name) {
  return !!headerKey(headers, name);
}

function headerKey(headers, name) {
  const normalized = String(name || "").toLowerCase();
  return Object.keys(headers || {}).find((key) => key.toLowerCase() === normalized) || "";
}

function hasExplicitAuthHeader(headers) {
  return hasHeaderValue(headers, "authorization") || hasHeaderValue(headers, "api-key") || hasHeaderValue(headers, "x-api-key");
}

function hasHeaderValue(headers, name) {
  const normalized = String(name || "").toLowerCase();
  return Object.entries(headers || {}).some(([key, value]) => key.toLowerCase() === normalized && String(value || "").trim());
}

function setHeaderIfMissing(headers, name, value) {
  if (!String(value || "").trim()) return;
  const existingKey = headerKey(headers, name);
  if (existingKey && String(headers[existingKey] || "").trim()) return;
  headers[existingKey || name] = value;
}

function withoutBlankHeaders(headers) {
  for (const key of Object.keys(headers || {})) {
    if (!String(headers[key] || "").trim()) delete headers[key];
  }
  return headers;
}

function providerRequestHeadersWithFallback(headers, fields) {
  if (!Array.isArray(fields) || !fields.includes("headers.anthropic-version")) return headers;
  const next = { ...(headers || {}) };
  const key = headerKey(next, "anthropic-version");
  if (key) delete next[key];
  return next;
}

function usesAzureOpenAIAuth(profile) {
  const id = String(profile?.id || "").toLowerCase();
  const baseURL = providerURLPath(profile?.baseURL || "");
  return id === "azure-openai" || id === "azure_openai" || /\.openai\.azure\.com\/openai\/v1\/?$/i.test(baseURL) || /\.services\.ai\.azure\.com\/openai\/v1\/?$/i.test(baseURL);
}

function anthropicAuthHeaderName(profile) {
  const explicit = normalizeAuthHeaderName(profile?.authHeader || profile?.bodyExtra?.authHeader || profile?.bodyExtra?.anthropicAuthHeader);
  if (explicit) return explicit;
  const id = String(profile?.id || "").toLowerCase();
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  if (id === "anthropic") return "x-api-key";
  if (id === "anthropic-compatible" || id === "anthropic_compatible" || id === "deepseek-anthropic" || id === "deepseek_anthropic" || id === "zai-anthropic" || id === "zai_anthropic" || id === "sambanova-anthropic" || id === "sambanova_anthropic") return "authorization";
  if (baseURL === "https://api.deepseek.com/anthropic" || baseURL.startsWith("https://api.deepseek.com/anthropic/")) return "authorization";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL.startsWith("https://api.z.ai/api/anthropic/")) return "authorization";
  if (baseURL === "https://api.sambanova.ai/v1" || baseURL.startsWith("https://api.sambanova.ai/v1/")) return "authorization";
  if (!isOfficialAnthropicBaseURL(baseURL)) return "authorization";
  return "x-api-key";
}

function isOfficialAnthropicBaseURL(baseURL) {
  const normalized = providerURLPath(stripKnownProviderEndpointPath(baseURL)).replace(/\/+$/, "");
  return normalized === "https://api.anthropic.com" || normalized.startsWith("https://api.anthropic.com/");
}

function shouldAddAnthropicDirectBrowserAccess(profile) {
  const explicit = profile?.bodyExtra?.directBrowserAccess
    ?? profile?.bodyExtra?.anthropicDirectBrowserAccess
    ?? profile?.directBrowserAccess
    ?? profile?.anthropicDirectBrowserAccess;
  if (explicit === false || String(explicit).toLowerCase() === "false") return false;
  if (explicit === true || String(explicit).toLowerCase() === "true") return true;
  const baseURL = providerURLPath(profile?.baseURL || "").replace(/\/+$/, "");
  return baseURL === "https://api.anthropic.com" || baseURL.startsWith("https://api.anthropic.com/");
}

function shouldOmitAnthropicVersion(profile) {
  return isTrueValue(profile?.bodyExtra?.omitAnthropicVersion)
    || isTrueValue(profile?.bodyExtra?.skipAnthropicVersion)
    || isTrueValue(profile?.bodyExtra?.dropAnthropicVersion)
    || isTrueValue(profile?.bodyExtra?.omitAnthropicVersionHeader)
    || isTrueValue(profile?.bodyExtra?.skipAnthropicVersionHeader)
    || isTrueValue(profile?.bodyExtra?.dropAnthropicVersionHeader)
    || isTrueValue(profile?.omitAnthropicVersion)
    || isTrueValue(profile?.skipAnthropicVersion)
    || isTrueValue(profile?.dropAnthropicVersion);
}

function normalizeAuthHeaderName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "authorization" || normalized === "bearer" || normalized === "auth-token" || normalized === "anthropic-auth-token") return "authorization";
  if (normalized === "x-api-key" || normalized === "anthropic-api-key") return "x-api-key";
  if (normalized === "api-key") return "api-key";
  return "";
}

function isLocalEndpoint(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
}

function bodyForProfile(profile, messages, outputLanguage, systemPrompt, requestInput = {}, streamEnabled = true) {
  const baseSystem = systemPrompt || "You are a careful academic paper reading assistant.";
  const system = `${baseSystem}\n${languageInstruction(outputLanguage)}`;
  const baseText = messagesToText(messages);
  const stream = shouldStream(profile, streamEnabled);
  const responsesSystemInUser = isTrueValue(profile?.bodyExtra?.instructionsFallbackToUser);
  const anthropicSystemInUser = isTrueValue(profile?.bodyExtra?.systemFallbackToUser);
  const openAIChatSystemInUser = isTrueValue(profile?.bodyExtra?.systemFallbackToUser);
  assertModelInputSupport(profile, requestInput);
  if (requestInputImages(requestInput).length && !canUseImageInput(profile)) {
    throw new Error("Selected provider profile does not support image input");
  }
  if (profile.protocol === "anthropic_messages") {
    return withProviderBodyDefaults(profile, {
      model: profile.model,
      ...(anthropicSystemInUser ? {} : { system }),
      messages: anthropicMessages(messages, requestInput, baseText, anthropicSystemInUser ? system : "", profile),
      max_tokens: Number(pref("maxOutputTokens")) || 8192,
      stream
    });
  }
  if (profile.protocol === "openai_responses") {
    return withProviderBodyDefaults(profile, {
      model: profile.model,
      ...(responsesSystemInUser ? {} : { instructions: system }),
      input: openaiResponsesInput(messages, requestInput, responsesSystemInUser ? system : "", profile),
      max_output_tokens: Number(pref("maxOutputTokens")) || 8192,
      temperature: Number(pref("temperature")) || 1,
      stream
    });
  }
  const chatMessages = openaiChatMessages(messages, requestInput, profile);
  return withOpenAIChatBodyDefaults(profile, {
    model: profile.model,
    messages: openAIChatSystemInUser
      ? messagesWithPrependedOpenAIChatText(chatMessages, fallbackSystemText(system))
      : [{ role: "system", content: system }, ...chatMessages],
    ...openAIChatOptionalDefaults(profile, {
      temperature: Number(pref("temperature")) || 1,
      n: 1
    }),
    ...openAIChatTokenLimit(profile, Number(pref("maxOutputTokens")) || 8192),
    stream
  });
}

function withOpenAIChatBodyDefaults(profile, body) {
  const merged = withProviderBodyDefaults(profile, body);
  if (merged.stream === true && merged.stream_options === undefined && !providerBodyOmitFields(profile?.bodyExtra).has("stream_options")) {
    merged.stream_options = openAIChatStreamOptions();
  }
  return merged;
}

function openAIChatStreamOptions() {
  return { include_usage: true };
}

function shouldStream(profile, streamEnabled = true) {
  return !!streamEnabled && profile?.capabilities?.streaming === true;
}

function providerBodyExtra(bodyExtra) {
  if (!bodyExtra || typeof bodyExtra !== "object" || Array.isArray(bodyExtra)) return {};
  const {
    localAgent: _localAgent,
    agent: _agent,
    subagent: _subagent,
    authHeader: _authHeader,
    anthropicAuthHeader: _anthropicAuthHeader,
    directBrowserAccess: _directBrowserAccess,
    anthropicDirectBrowserAccess: _anthropicDirectBrowserAccess,
    omitAnthropicVersion: _omitAnthropicVersion,
    skipAnthropicVersion: _skipAnthropicVersion,
    dropAnthropicVersion: _dropAnthropicVersion,
    omitAnthropicVersionHeader: _omitAnthropicVersionHeader,
    skipAnthropicVersionHeader: _skipAnthropicVersionHeader,
    dropAnthropicVersionHeader: _dropAnthropicVersionHeader,
    tokenLimitField: _tokenLimitField,
    openAIChatTokenField: _openAIChatTokenField,
    chatTokenField: _chatTokenField,
    maxTokenField: _maxTokenField,
    instructionsFallbackToUser: _instructionsFallbackToUser,
    systemFallbackToUser: _systemFallbackToUser,
    pdfInputFileField: _pdfInputFileField,
    omitPdfInputFile: _omitPdfInputFile,
    skipPdfInputFile: _skipPdfInputFile,
    dropPdfInputFile: _dropPdfInputFile,
    omitOpenAIChatImage: _omitOpenAIChatImage,
    skipOpenAIChatImage: _skipOpenAIChatImage,
    dropOpenAIChatImage: _dropOpenAIChatImage,
    omitOpenAIResponsesImage: _omitOpenAIResponsesImage,
    skipOpenAIResponsesImage: _skipOpenAIResponsesImage,
    dropOpenAIResponsesImage: _dropOpenAIResponsesImage,
    omitAnthropicDocument: _omitAnthropicDocument,
    skipAnthropicDocument: _skipAnthropicDocument,
    dropAnthropicDocument: _dropAnthropicDocument,
    omitAnthropicImage: _omitAnthropicImage,
    skipAnthropicImage: _skipAnthropicImage,
    dropAnthropicImage: _dropAnthropicImage,
    omitImageBlock: _omitImageBlock,
    skipImageBlock: _skipImageBlock,
    dropImageBlock: _dropImageBlock,
    omitImageInput: _omitImageInput,
    skipImageInput: _skipImageInput,
    dropImageInput: _dropImageInput,
    omitPdfDocument: _omitPdfDocument,
    skipPdfDocument: _skipPdfDocument,
    dropPdfDocument: _dropPdfDocument,
    imageURLFormat: _imageURLFormat,
    anthropicTextContentFormat: _anthropicTextContentFormat,
    anthropicTextContent: _anthropicTextContent,
    omitFields: _omitFields,
    omitBodyFields: _omitBodyFields,
    removeFields: _removeFields,
    removeBodyFields: _removeBodyFields,
    ...rest
  } = bodyExtra;
  return rest;
}

function omitProviderBodyFields(body, bodyExtra) {
  const fields = providerBodyOmitFields(bodyExtra);
  if (!fields.size) return body;
  const next = { ...body };
  for (const field of fields) {
    if (field === "text.format") {
      removeOpenAIResponsesTextField(next, "format");
      continue;
    }
    if (field === "text.verbosity") {
      removeOpenAIResponsesTextField(next, "verbosity");
      continue;
    }
    delete next[field];
  }
  return next;
}

function removeOpenAIResponsesTextField(body, field) {
  const text = body.text;
  if (!text || typeof text !== "object" || Array.isArray(text)) return;
  const nextText = { ...text };
  delete nextText[field];
  if (Object.keys(nextText).length) body.text = nextText;
  else delete body.text;
}

function providerBodyOmitFields(bodyExtra) {
  if (!bodyExtra || typeof bodyExtra !== "object" || Array.isArray(bodyExtra)) return new Set();
  const values = [
    bodyExtra.omitFields,
    bodyExtra.omitBodyFields,
    bodyExtra.removeFields,
    bodyExtra.removeBodyFields
  ];
  return new Set(values.flatMap((value) => bodyFieldList(value)).filter(Boolean));
}

function bodyFieldList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => bodyFieldList(item));
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function openAIChatTokenLimit(profile, maxTokens) {
  return { [openAIChatTokenLimitField(profile)]: maxTokens };
}

function openAIChatOptionalDefaults(profile, defaults) {
  return openAIChatTokenLimitField(profile) === "max_completion_tokens" ? {} : defaults;
}

function openAIChatTokenLimitField(profile) {
  const extra = providerBodyExtra(profile?.bodyExtra);
  const explicit = normalizeOpenAIChatTokenLimitField(
    profile?.bodyExtra?.tokenLimitField
    ?? profile?.bodyExtra?.openAIChatTokenField
    ?? profile?.bodyExtra?.chatTokenField
    ?? profile?.bodyExtra?.maxTokenField
  );
  if (explicit) return explicit;
  if (extra.max_completion_tokens !== undefined && extra.max_tokens === undefined) return "max_completion_tokens";
  if (extra.max_tokens !== undefined && extra.max_completion_tokens === undefined) return "max_tokens";
  return modelPrefersCompletionTokenLimit(profile?.model) ? "max_completion_tokens" : "max_tokens";
}

function normalizeOpenAIChatTokenLimitField(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[.\s-]+/g, "_");
  if (!normalized) return "";
  if (normalized === "max_completion_tokens" || normalized === "completion_tokens" || normalized === "completion") return "max_completion_tokens";
  if (normalized === "max_tokens" || normalized === "tokens") return "max_tokens";
  return "";
}

function modelPrefersCompletionTokenLimit(model) {
  return /^o\d(?:$|[-_.])/i.test(String(model || "").trim());
}

function isTrueValue(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function withProviderBodyDefaults(profile, body) {
  return omitProviderBodyFields({ ...body, ...jsonModeBodyDefaults(profile), ...providerBodyExtra(profile.bodyExtra) }, profile.bodyExtra);
}

function jsonModeBodyDefaults(profile) {
  if (!profile?.capabilities?.jsonMode || profile.protocol === "anthropic_messages") return {};
  const extra = providerBodyExtra(profile.bodyExtra);
  if (profile.protocol === "openai_responses") {
    if (extra.text !== undefined || extra.response_format !== undefined) return {};
    return { text: { format: { type: "json_object" } } };
  }
  if (extra.response_format !== undefined) return {};
  return { response_format: { type: "json_object" } };
}

function messagesToText(messages) {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function openaiResponsesInput(messages, requestInput = {}, fallbackSystem = "", profile = null) {
  const input = messages.map((message) => ({
    role: message.role,
    content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: String(message.content || "") }]
  }));
  let lastUserIndex = findLastIndex(input, (message) => message.role === "user");
  const systemText = fallbackSystemText(fallbackSystem);
  if (systemText) {
    const firstUserIndex = input.findIndex((message) => message.role === "user");
    if (firstUserIndex >= 0) {
      input[firstUserIndex] = {
        ...input[firstUserIndex],
        content: [{ type: "input_text", text: systemText }, ...input[firstUserIndex].content]
      };
    } else {
      input.unshift({ role: "user", content: [{ type: "input_text", text: systemText }] });
      lastUserIndex = 0;
    }
  }
  const contextText = requestInput?.type === "text" ? requestInput.text : "";
  if (contextText) {
    lastUserIndex = appendOpenAIResponsesPart(input, lastUserIndex, { type: "input_text", text: `CONTEXT:\n${contextText}` });
  }
  if (requestInput?.type === "pdf_base64" && requestInput.base64 && !shouldOmitPdfInputFile(profile)) {
    lastUserIndex = prependOpenAIResponsesPart(input, lastUserIndex, openAIResponsesPdfFilePart(requestInput, profile));
  }
  if (!shouldOmitOpenAIResponsesImage(profile)) {
    for (const image of requestInputImages(requestInput)) {
      lastUserIndex = appendOpenAIResponsesPart(input, lastUserIndex, {
        type: "input_image",
        image_url: imageDataURL(image)
      });
    }
  }
  return input;
}

function openAIResponsesPdfFilePart(requestInput, profile) {
  const dataURL = `data:application/pdf;base64,${requestInput.base64 || ""}`;
  const field = normalizePdfInputFileField(profile?.bodyExtra?.pdfInputFileField);
  return {
    type: "input_file",
    filename: requestInput.filename || "paper.pdf",
    [field]: dataURL
  };
}

function shouldOmitPdfInputFile(profile) {
  return isTrueValue(profile?.bodyExtra?.omitPdfInputFile)
    || isTrueValue(profile?.bodyExtra?.skipPdfInputFile)
    || isTrueValue(profile?.bodyExtra?.dropPdfInputFile);
}

function shouldOmitOpenAIChatImage(profile) {
  return isTrueValue(profile?.bodyExtra?.omitOpenAIChatImage)
    || isTrueValue(profile?.bodyExtra?.skipOpenAIChatImage)
    || isTrueValue(profile?.bodyExtra?.dropOpenAIChatImage)
    || shouldOmitGenericImageInput(profile);
}

function shouldOmitOpenAIResponsesImage(profile) {
  return isTrueValue(profile?.bodyExtra?.omitOpenAIResponsesImage)
    || isTrueValue(profile?.bodyExtra?.skipOpenAIResponsesImage)
    || isTrueValue(profile?.bodyExtra?.dropOpenAIResponsesImage)
    || shouldOmitGenericImageInput(profile);
}

function shouldOmitAnthropicDocument(profile) {
  return isTrueValue(profile?.bodyExtra?.omitAnthropicDocument)
    || isTrueValue(profile?.bodyExtra?.skipAnthropicDocument)
    || isTrueValue(profile?.bodyExtra?.dropAnthropicDocument)
    || isTrueValue(profile?.bodyExtra?.omitPdfDocument)
    || isTrueValue(profile?.bodyExtra?.skipPdfDocument)
    || isTrueValue(profile?.bodyExtra?.dropPdfDocument);
}

function shouldOmitAnthropicImage(profile) {
  return isTrueValue(profile?.bodyExtra?.omitAnthropicImage)
    || isTrueValue(profile?.bodyExtra?.skipAnthropicImage)
    || isTrueValue(profile?.bodyExtra?.dropAnthropicImage)
    || isTrueValue(profile?.bodyExtra?.omitImageBlock)
    || isTrueValue(profile?.bodyExtra?.skipImageBlock)
    || isTrueValue(profile?.bodyExtra?.dropImageBlock)
    || shouldOmitGenericImageInput(profile);
}

function shouldOmitGenericImageInput(profile) {
  return isTrueValue(profile?.bodyExtra?.omitImageInput)
    || isTrueValue(profile?.bodyExtra?.skipImageInput)
    || isTrueValue(profile?.bodyExtra?.dropImageInput);
}

function normalizePdfInputFileField(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]/g, "");
  return normalized === "fileurl" || normalized === "url" ? "file_url" : "file_data";
}

function openaiChatMessages(messages, requestInput = {}, profile = null) {
  const mapped = messages.map((message) => ({ role: message.role, content: message.content }));
  const contextText = requestInput?.type === "text" && requestInput.text ? `CONTEXT:\n${requestInput.text}` : "";
  const images = shouldOmitOpenAIChatImage(profile) ? [] : requestInputImages(requestInput);
  const lastUserIndex = findLastIndex(mapped, (message) => message.role === "user");
  if (!images.length) {
    return contextText ? messagesWithAppendedOpenAIChatText(mapped, contextText) : mapped;
  }
  const imageParts = images.map((image) => openAIChatImagePart(image, profile));
  if (lastUserIndex >= 0) {
    const baseText = [String(mapped[lastUserIndex].content || ""), contextText].filter(Boolean).join("\n\n");
    mapped[lastUserIndex] = {
      role: "user",
      content: [
        { type: "text", text: baseText },
        ...imageParts
      ]
    };
    return mapped;
  }
  mapped.push({
    role: "user",
    content: contextText ? [{ type: "text", text: contextText }, ...imageParts] : imageParts
  });
  return mapped;
}

function openAIChatImagePart(image, profile) {
  const dataURL = imageDataURL(image);
  return {
    type: "image_url",
    image_url: openAIChatImageURLFormat(profile?.bodyExtra?.imageURLFormat) === "string" ? dataURL : { url: dataURL }
  };
}

function openAIChatImageURLFormat(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  return normalized === "string" || normalized === "dataurl" || normalized === "urlstring" ? "string" : "object";
}

function appendOpenAIResponsesPart(input, lastUserIndex, part) {
  if (lastUserIndex >= 0) {
    input[lastUserIndex] = {
      ...input[lastUserIndex],
      content: [...input[lastUserIndex].content, part]
    };
    return lastUserIndex;
  }
  input.push({ role: "user", content: [part] });
  return input.length - 1;
}

function prependOpenAIResponsesPart(input, lastUserIndex, part) {
  if (lastUserIndex >= 0) {
    input[lastUserIndex] = {
      ...input[lastUserIndex],
      content: [part, ...input[lastUserIndex].content]
    };
    return lastUserIndex;
  }
  input.push({ role: "user", content: [part] });
  return input.length - 1;
}

async function requestModelWithRetry(profile, messages, outputLanguage, systemPrompt, requestInput, streamEnabled, signal, options = {}) {
  let lastError;
  let requestProfile = profile;
  let requestStreamEnabled = streamEnabled;
  let usedCompatibilityFallbackFields = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const body = bodyForProfile(requestProfile, messages, outputLanguage, systemPrompt, requestInput, requestStreamEnabled);
      const response = await fetch(endpointForProfile(profile), {
        method: "POST",
        headers: headersForProfile(requestProfile),
        body: JSON.stringify(body),
        signal
      });
      if (!response.ok) {
        const text = await response.text();
        const fallback = providerCompatibilityFallback(requestProfile, body, response.status, text, usedCompatibilityFallbackFields, requestStreamEnabled);
        if (fallback && attempt < 3) {
          requestProfile = fallback.profile;
          requestStreamEnabled = fallback.streamEnabled;
          usedCompatibilityFallbackFields = fallback.usedFields;
          continue;
        }
        const error = providerHTTPError(response.status, text);
        if (error.retryableProviderError && attempt < 3) {
          await delay(500 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      const okInspection = await inspectOkProviderResponseForFallback(response, requestProfile, body, usedCompatibilityFallbackFields, requestStreamEnabled);
      if (okInspection.fallback && attempt < 3) {
        requestProfile = okInspection.fallback.profile;
        requestStreamEnabled = okInspection.fallback.streamEnabled;
        usedCompatibilityFallbackFields = okInspection.fallback.usedFields;
        continue;
      }
      if (okInspection.fallback) {
        throw new Error(providerErrorText(response.status, okInspection.text || ""));
      }
      okInspection.response.zmsRequestedStream = okInspection.requestedStream;
      if (options?.parseStream === true && okInspection.requestedStream === true && okInspection.response.body) {
        try {
          okInspection.response.zmsStreamText = await readStream(okInspection.response, requestProfile.protocol, options.onDelta || (() => undefined));
        } catch (err) {
          const fallback = providerStreamCompatibilityFallback(requestProfile, body, err, usedCompatibilityFallbackFields, requestStreamEnabled);
          if (fallback && attempt < 3) {
            requestProfile = fallback.profile;
            requestStreamEnabled = fallback.streamEnabled;
            usedCompatibilityFallbackFields = fallback.usedFields;
            continue;
          }
          throw err;
        }
      }
      return okInspection.response;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      if (err?.zmsProviderStreamError) throw err;
      if (err?.retryableProviderError === false) throw err;
      lastError = err;
      if (attempt < 3) {
        await delay(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError;
}

function providerStreamCompatibilityFallback(profile, body, err, usedFallback, streamEnabled) {
  if (err?.zmsPartialText) return null;
  const message = streamCompatibilityErrorMessage(err);
  if (!message) return null;
  return providerCompatibilityFallback(profile, body, 200, JSON.stringify({ error: { message } }), usedFallback, streamEnabled);
}

function streamCompatibilityErrorMessage(err) {
  const message = String(err?.message || err || "").trim();
  if (!/^Stream error:/i.test(message)) return "";
  return message.replace(/^Stream error:\s*/i, "").trim();
}

function providerCompatibilityFallback(profile, body, status, text, usedFallback, streamEnabled) {
  if (!["openai_chat", "openai_responses", "anthropic_messages"].includes(profile?.protocol)) return null;
  if (!providerFallbackEligibleStatus(body, status, text, profile?.protocol)) return null;
  const fields = providerUnsupportedOptionalFields(profile?.protocol, body, text, usedFallback);
  if (!fields.length) return null;
  const nextUsedFields = Array.from(new Set([...(Array.isArray(usedFallback) ? usedFallback : []), ...fields]));
  return {
    profile: {
      ...profile,
      bodyExtra: mergeProviderFallbackBodyExtra(profile?.bodyExtra, body, fields, usedFallback)
    },
    streamEnabled: fields.includes("stream") ? false : streamEnabled,
    usedFields: nextUsedFields
  };
}

function providerCompatibilityFallbackFields(protocol, body, status, text, usedFallback = false) {
  if (usedFallback === true || !["openai_chat", "openai_responses", "anthropic_messages"].includes(protocol) || !providerFallbackEligibleStatus(body, status, text, protocol)) return [];
  return providerUnsupportedOptionalFields(protocol, body, text, usedFallback);
}

async function inspectOkProviderResponseForFallback(response, profile, body, usedFallback, streamEnabled) {
  const requestedStream = body?.stream === true;
  if (!shouldInspectOkProviderResponse(response, requestedStream)) {
    return { response, requestedStream };
  }
  const text = await response.text();
  const fallback = providerCompatibilityFallback(profile, body, response.status, text, usedFallback, streamEnabled);
  if (fallback) return { fallback, text };
  return { response: responseFromText(response, text), requestedStream: false };
}

function shouldInspectOkProviderResponse(response, requestedStream) {
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

function responseFromText(response, text) {
  if (typeof Response === "function") {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText || "",
      headers: response.headers
    });
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText || "",
    headers: response.headers,
    body: null,
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

function providerFallbackEligibleStatus(body, status, text, protocol = "") {
  const numericStatus = Number(status);
  if (numericStatus === 400 || numericStatus === 422) return true;
  if (numericStatus !== 200) return false;
  return providerOkResponseLooksLikeFallbackError(body, text, protocol);
}

function providerOkResponseLooksLikeFallbackError(body, text, protocol = "") {
  const parsed = safeParseJSON(text);
  if (!parsed) return false;
  if (streamErrorText(parsed)) return true;
  if (protocol === "anthropic_messages" && rejectedAnthropicVersionHeader(String(text || "").toLowerCase())) return true;
  if (
    !providerStructuredUnsupportedFields(body, text, protocol).length
    && !providerUnsupportedCustomBodyFields(body, String(text || "").toLowerCase()).length
  ) {
    return false;
  }
  return /unsupported|unrecognized|not supported|unknown (?:field|parameter|argument)|extra_forbidden|not permitted|invalid|forbidden/.test(String(text || "").toLowerCase());
}

function providerUnsupportedOptionalFields(protocol, body, text, usedFallback = []) {
  if (usedFallback === true) return [];
  const usedFields = new Set(Array.isArray(usedFallback) ? usedFallback : []);
  const detail = String(text || "").toLowerCase();
  const fields = providerStructuredUnsupportedFields(body, text, protocol);
  if (body?.stream_options !== undefined && (/stream_options|stream options|stream option/.test(detail) || providerDetailMentionsCanonicalField(detail, "stream_options"))) {
    fields.push("stream_options");
  }
  if (body?.stream !== undefined && /\bstream\b|streaming/.test(detail)) {
    fields.push("stream");
    if (body?.stream_options !== undefined) fields.push("stream_options");
  }
  if (body?.temperature !== undefined && /temperature/.test(detail)) {
    fields.push("temperature");
  }
  if (body?.n !== undefined && /(?:^|[^a-z0-9_])n(?:[^a-z0-9_]|$)|number of completions|multiple completions/.test(detail)) {
    fields.push("n");
  }
  if (body?.response_format !== undefined && (/response_format|response format/.test(detail) || providerDetailMentionsCanonicalField(detail, "response_format"))) {
    fields.push("response_format");
  }
  if (body?.max_completion_tokens !== undefined && (/max_completion_tokens|max completion tokens|max completion token/.test(detail) || providerDetailMentionsCanonicalField(detail, "max_completion_tokens"))) {
    fields.push("max_completion_tokens");
  }
  if (body?.max_tokens !== undefined && (/max_tokens|max tokens|max token/.test(detail) || providerDetailMentionsCanonicalField(detail, "max_tokens"))) {
    fields.push("max_tokens");
  }
  if (providerTextFieldPresent(body, "format") && (/text\.format|text format|json mode|json_schema|json schema/.test(detail) || providerDetailMentionsCanonicalField(detail, "text.format"))) {
    fields.push("text.format");
  }
  if (providerTextFieldPresent(body, "verbosity") && (/text\.verbosity|text verbosity/.test(detail) || providerDetailMentionsCanonicalField(detail, "text.verbosity"))) {
    fields.push("text.verbosity");
  }
  if (!fields.includes("text.format") && !fields.includes("text.verbosity") && body?.text !== undefined && /(?:^|[^a-z0-9_])text(?![._\-\s]*(?:format|verbosity))(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("text");
  }
  if (body?.max_output_tokens !== undefined && (/max_output_tokens|max output tokens|max output token/.test(detail) || providerDetailMentionsCanonicalField(detail, "max_output_tokens"))) {
    fields.push("max_output_tokens");
  }
  if (body?.instructions !== undefined && /(?:^|[^a-z0-9_])instructions?(?:[^a-z0-9_]|$)|system instructions?|developer instructions?|system prompt/.test(detail)) {
    fields.push("instructions");
  }
  if (body?.reasoning !== undefined && /(?:^|[^a-z0-9_])reasoning(?:[^a-z0-9_]|$)|reasoning config|reasoning parameter/.test(detail)) {
    fields.push("reasoning");
  }
  if (body?.verbosity !== undefined && /(?:^|[^a-z0-9_])verbosity(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("verbosity");
  }
  if (body?.system !== undefined && /(?:^|[^a-z0-9_])system(?:[^a-z0-9_]|$)|system prompt|system field/.test(detail)) {
    fields.push("system");
  }
  if (body?.metadata !== undefined && /metadata/.test(detail)) {
    fields.push("metadata");
  }
  if (body?.thinking !== undefined && /thinking|reasoning/.test(detail)) {
    fields.push("thinking");
  }
  if (body?.top_p !== undefined && (/top_p|top p/.test(detail) || providerDetailMentionsCanonicalField(detail, "top_p"))) {
    fields.push("top_p");
  }
  if (body?.presence_penalty !== undefined && (/presence_penalty|presence penalty/.test(detail) || providerDetailMentionsCanonicalField(detail, "presence_penalty"))) {
    fields.push("presence_penalty");
  }
  if (body?.frequency_penalty !== undefined && (/frequency_penalty|frequency penalty/.test(detail) || providerDetailMentionsCanonicalField(detail, "frequency_penalty"))) {
    fields.push("frequency_penalty");
  }
  if (body?.seed !== undefined && /(?:^|[^a-z0-9_])seed(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("seed");
  }
  if (body?.top_logprobs !== undefined && (/top_logprobs|top logprobs/.test(detail) || providerDetailMentionsCanonicalField(detail, "top_logprobs"))) {
    fields.push("top_logprobs");
  }
  if (body?.logprobs !== undefined && /(?:^|[^a-z0-9_])logprobs(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("logprobs");
  }
  if (body?.parallel_tool_calls !== undefined && (/parallel_tool_calls|parallel tool calls|parallel tool call/.test(detail) || providerDetailMentionsCanonicalField(detail, "parallel_tool_calls"))) {
    fields.push("parallel_tool_calls");
  }
  if (body?.reasoning_effort !== undefined && (/reasoning_effort|reasoning effort/.test(detail) || providerDetailMentionsCanonicalField(detail, "reasoning_effort"))) {
    fields.push("reasoning_effort");
  }
  if (body?.stop !== undefined && /(?:^|[^a-z0-9_])stop(?:[^a-z0-9_]|$)|stop sequence|stop sequences/.test(detail)) {
    fields.push("stop");
  }
  if (body?.top_k !== undefined && (/top_k|top k/.test(detail) || providerDetailMentionsCanonicalField(detail, "top_k"))) {
    fields.push("top_k");
  }
  if (body?.stop_sequences !== undefined && (/stop_sequences|stop sequences|stop sequence/.test(detail) || providerDetailMentionsCanonicalField(detail, "stop_sequences"))) {
    fields.push("stop_sequences");
  }
  if (body?.tools !== undefined && /(?:^|[^a-z0-9_])tools?(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("tools");
  }
  if (body?.tool_choice !== undefined && (/tool_choice|tool choice/.test(detail) || providerDetailMentionsCanonicalField(detail, "tool_choice"))) {
    fields.push("tool_choice");
  }
  fields.push(...providerUnsupportedOptionalBodyFields(body, detail));
  fields.push(...providerUnsupportedCustomBodyFields(body, detail));
  if (protocol === "anthropic_messages" && rejectedAnthropicVersionHeader(detail)) {
    fields.push("headers.anthropic-version");
  }
  const rejectedAnthropicContentField = rejectedAnthropicMessagesContentField(body, detail);
  if (protocol === "anthropic_messages" && rejectedAnthropicContentField) {
    fields.push(rejectedAnthropicContentField);
  }
  const rejectedAnthropicDocumentField = rejectedAnthropicMessagesDocumentField(body, detail);
  if (protocol === "anthropic_messages" && rejectedAnthropicDocumentField) {
    fields.push(rejectedAnthropicDocumentField);
  }
  const rejectedAnthropicImageField = rejectedAnthropicMessagesImageField(body, detail);
  if (protocol === "anthropic_messages" && rejectedAnthropicImageField) {
    fields.push(rejectedAnthropicImageField);
  }
  const rejectedImageURLField = rejectedOpenAIChatImageURLField(body, detail);
  if (protocol === "openai_chat" && rejectedImageURLField) {
    fields.push(rejectedImageURLField);
  }
  const rejectedOpenAIChatImageField = rejectedImageURLField ? "" : rejectedOpenAIChatImageContentField(body, detail);
  if (protocol === "openai_chat" && rejectedOpenAIChatImageField) {
    fields.push(rejectedOpenAIChatImageField);
  }
  const rejectedSystemRoleField = rejectedOpenAIChatSystemRoleField(body, detail);
  if (protocol === "openai_chat" && rejectedSystemRoleField) {
    fields.push(rejectedSystemRoleField);
  }
  const rejectedPDFField = rejectedOpenAIResponsesPdfFileField(body, detail);
  if (protocol === "openai_responses" && rejectedPDFField) {
    fields.push(rejectedPDFField);
  }
  const rejectedResponsesImageField = rejectedOpenAIResponsesInputImageField(body, detail);
  if (protocol === "openai_responses" && rejectedResponsesImageField) {
    fields.push(rejectedResponsesImageField);
  }
  return Array.from(new Set(fields)).filter((field) => !usedFields.has(field));
}

function providerStructuredUnsupportedFields(body, text, protocol = "") {
  const parsed = parseProviderFallbackJSON(text);
  if (!parsed) return [];
  const hints = [];
  collectProviderFieldHints(parsed, hints);
  return hints
    .map((value) => normalizeProviderFieldHint(value))
    .filter((field) => providerFallbackFieldSupported(body, field, protocol) && providerFallbackFieldPresent(body, field));
}

const PROVIDER_OPTIONAL_BODY_FIELD_PATTERNS = [
  ["modalities", /\bmodalities?\b|response modalities?/],
  ["response_modalities", /response_modalities|response modalities?|\bmodalities?\b/],
  ["audio", /\baudio\b|voice|speech/],
  ["prediction", /\bprediction\b|predicted output/],
  ["service_tier", /service_tier|service tier/],
  ["store", /(?:^|[^a-z0-9_])store(?:[^a-z0-9_]|$)|stored output/],
  ["user", /(?:^|[^a-z0-9_])user(?:[^a-z0-9_]|$)|end[-\s]?user/],
  ["logit_bias", /logit_bias|logit bias/],
  ["web_search_options", /web_search_options|web search|web-search/],
  ["search_options", /search_options|search options/],
  ["safety_settings", /safety_settings|safety settings|safety_setting/],
  ["generation_config", /generation_config|generation config/],
  ["thinking_config", /thinking_config|thinking config|thinking budget|thought config/],
  ["response_mime_type", /response_mime_type|response mime|mime_type|mime type/],
  ["response_schema", /response_schema|response schema/],
  ["extra_body", /extra_body|extra body/]
];

function providerUnsupportedOptionalBodyFields(body, detail) {
  return PROVIDER_OPTIONAL_BODY_FIELD_PATTERNS
    .filter(([field, pattern]) => body?.[field] !== undefined && (pattern.test(detail) || providerDetailMentionsCanonicalField(detail, field)))
    .map(([field]) => field);
}

function providerUnsupportedCustomBodyFields(body, detail) {
  const text = String(detail || "").toLowerCase();
  if (!providerDetailLooksLikeUnsupportedField(text)) return [];
  return Object.keys(body || {})
    .filter((field) => !PROVIDER_REQUIRED_BODY_FIELDS.has(field))
    .filter((field) => !PROVIDER_FALLBACK_BODY_FIELDS.has(field))
    .filter((field) => providerFallbackCustomBodyFieldPresent(body, field))
    .filter((field) => providerDetailMentionsField(text, field));
}

function providerDetailLooksLikeUnsupportedField(text) {
  return /unsupported|unrecognized|not supported|does not support|unknown (?:field|parameter|argument)|unknown_field|unknown_parameter|extra_forbidden|not permitted|not allowed|forbidden|invalid/.test(text);
}

function providerDetailMentionsField(text, field) {
  const fieldText = String(field || "").toLowerCase();
  if (!fieldText) return false;
  const pattern = providerFieldNamePattern(fieldText);
  if (pattern?.test(text)) return true;
  const normalizedText = normalizeProviderFieldWords(text);
  const normalizedField = normalizeProviderFieldWords(fieldText);
  return Boolean(normalizedField && normalizedText.includes(normalizedField));
}

function providerFieldNamePattern(field) {
  const parts = String(field || "")
    .toLowerCase()
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map(escapeProviderRegExp);
  if (!parts.length) return null;
  return new RegExp(`(?:^|[^a-z0-9])${parts.join("[._\\-\\s]+")}(?:[^a-z0-9]|$)`);
}

function normalizeProviderFieldWords(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeProviderRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseProviderFallbackJSON(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (_err) {
    return null;
  }
}

function collectProviderFieldHints(value, hints) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectProviderFieldHints(item, hints);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isProviderFieldHintKey(key)) collectProviderFieldHintValue(entry, hints);
    if (entry && typeof entry === "object") collectProviderFieldHints(entry, hints);
  }
}

function collectProviderFieldHintValue(value, hints) {
  if (typeof value === "string") {
    hints.push(value);
    return;
  }
  if (Array.isArray(value)) {
    const path = providerFieldHintArrayPath(value);
    if (path) {
      hints.push(path);
      return;
    }
    for (const item of value) collectProviderFieldHintValue(item, hints);
    return;
  }
  if (value && typeof value === "object") {
    const direct = providerFieldHintObjectValue(value);
    if (direct) hints.push(direct);
    collectProviderFieldHints(value, hints);
  }
}

function providerFieldHintObjectValue(value) {
  for (const key of ["name", "field", "path", "pointer", "property", "param", "parameter", "argument", "key"]) {
    const entry = value?.[key];
    if (typeof entry === "string" && entry.trim()) return entry.trim();
  }
  return "";
}

function providerFieldHintArrayPath(value) {
  let path = "";
  for (const item of value) {
    if (typeof item === "number" || (typeof item === "string" && /^\d+$/.test(item))) {
      path += `[${item}]`;
      continue;
    }
    if (typeof item !== "string" || !item.trim()) return "";
    const text = item.trim();
    if (value.length > 1 && /[./]/.test(text)) return "";
    path += path ? `.${text}` : text;
  }
  return path.includes(".") || path.includes("[") ? path : "";
}

function isProviderFieldHintKey(key) {
  return /^(?:param|params|parameter|parameters|field|fields|property|properties|property_name|propertyname|additional_property|additionalproperty|argument|arguments|loc|location|path|json_path|jsonpath|json_pointer|jsonpointer|pointer|data_path|datapath|instance_path|instancepath|unsupported_param|unsupported_params|unsupported_parameter|unsupported_parameters|unsupported_field|unsupported_fields|unknown_param|unknown_params|unknown_parameter|unknown_parameters|unknown_field|unknown_fields|invalid_param|invalid_params|invalid_parameter|invalid_parameters|invalid_field|invalid_fields|extra_field|extra_fields|forbidden_field|forbidden_fields|unrecognized_param|unrecognized_params|unrecognized_parameter|unrecognized_parameters|unrecognized_field|unrecognized_fields)$/i.test(key);
}

function normalizeProviderFieldHint(value) {
  const raw = String(value || "").trim();
  const pointerPath = providerFieldHintPointerPath(raw);
  const normalized = (pointerPath || raw)
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\$\.?/, "")
    .replace(/^\./, "")
    .replace(/^(?:(?:body|request|payload|params?|parameters?|input|data|attributes|json|root)\.)+/i, "")
    .replace(/\[[^\]]+\]/g, "");
  const normalizedLower = normalized.toLowerCase();
  if (/\bfile_data\b/.test(normalizedLower)) return "input_file.file_data";
  if (/\bfile_url\b/.test(normalizedLower)) return "input_file.file_url";
  if (/input(?:\.\d+|\[\d+\])?\.content.*input_image|inputcontent.*inputimage|(?:^|[^a-z0-9_])input_image(?:[^a-z0-9_]|$)|(?:^|[^a-z0-9_])inputimage(?:[^a-z0-9_]|$)/.test(normalizedLower)) return "input.content.input_image";
  if (/image_url\.url|image_url_url|imageurl\.url|imageurlurl|(?:^|[^a-z0-9_])image_url(?:[^a-z0-9_]|$)|(?:^|[^a-z0-9_])imageurl(?:[^a-z0-9_]|$)/.test(normalizedLower)) return "image_url.url";
  if (/messages?(?:\.\d+|\[\d+\])?\.content.*(?:image|image\/|png|jpe?g|webp)|messages?content.*(?:image|image\/|png|jpe?g|webp)|(?:^|[^a-z0-9_])image(?:[^a-z0-9_]|$)/.test(normalizedLower)) return "messages.content.image";
  if (/messages?(?:\.\d+|\[\d+\])?\.content.*(?:document|source|media_type|mediatype|base64|application\/pdf)|messages?content.*(?:document|source|media_type|mediatype|base64|applicationpdf)|(?:^|[^a-z0-9_])document(?:[^a-z0-9_]|$)/.test(normalizedLower)) return "messages.content.document";
  if (/messages?(?:\.\d+|\[\d+\])?\.content|messages?content/.test(normalizedLower)) return "messages.content";
  if (/messages?(?:\.\d+|\[\d+\])?\.role|messages?role/.test(normalizedLower)) return "messages.role.system";
  const canonical = canonicalProviderFieldHint(normalized);
  if (canonical) return canonical;
  return normalized
    .split(".")[0]
    .trim();
}

function providerFieldHintPointerPath(value) {
  const text = String(value || "").trim();
  if (!/^#?\//.test(text)) return "";
  const segments = text
    .replace(/^#/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .filter(Boolean)
    .filter((segment, index) => index !== 0 || !/^(?:body|request|payload|params?|parameters?|input)$/i.test(segment));
  return segments.length ? segments.join(".") : "";
}

function providerDetailMentionsCanonicalField(detail, field) {
  const canonical = canonicalProviderFieldHint(field) || field;
  const compactDetail = normalizeProviderFieldWords(detail).replace(/\s+/g, "");
  const compactField = normalizeProviderFieldWords(canonical).replace(/\s+/g, "");
  return Boolean(compactField && compactDetail.includes(compactField));
}

function canonicalProviderFieldHint(value) {
  const compact = normalizeProviderFieldWords(value).replace(/\s+/g, "");
  const aliases = {
    streamoptions: "stream_options",
    responseformat: "response_format",
    maxcompletiontokens: "max_completion_tokens",
    maxtokens: "max_tokens",
    maxoutputtokens: "max_output_tokens",
    textformat: "text.format",
    textverbosity: "text.verbosity",
    topp: "top_p",
    presencepenalty: "presence_penalty",
    frequencypenalty: "frequency_penalty",
    toplogprobs: "top_logprobs",
    paralleltoolcalls: "parallel_tool_calls",
    reasoningeffort: "reasoning_effort",
    topk: "top_k",
    stopsequences: "stop_sequences",
    toolchoice: "tool_choice",
    responsemodalities: "response_modalities",
    servicetier: "service_tier",
    logitbias: "logit_bias",
    websearchoptions: "web_search_options",
    searchoptions: "search_options",
    safetysettings: "safety_settings",
    generationconfig: "generation_config",
    thinkingconfig: "thinking_config",
    responsemimetype: "response_mime_type",
    responseschema: "response_schema",
    extrabody: "extra_body",
    filedata: "input_file.file_data",
    fileurl: "input_file.file_url",
    imageurlurl: "image_url.url",
    imageurl: "image_url.url",
    inputimage: "input.content.input_image"
  };
  return aliases[compact] || "";
}

function providerFallbackFieldPresent(body, field) {
  if (field === "text.format") return providerTextFieldPresent(body, "format");
  if (field === "text.verbosity") return providerTextFieldPresent(body, "verbosity");
  if (field === "messages.content") return anthropicMessagesHaveStringContent(body);
  if (field === "messages.content.image") return anthropicMessagesHaveImageBlock(body);
  if (field === "messages.content.document") return anthropicMessagesHaveDocumentBlock(body);
  if (field === "messages.role.system") return openAIChatHasSystemMessage(body);
  if (field === "messages.content.image_url") return openAIChatHasImagePart(body);
  if (field === "image_url.url") return openAIChatImageURLHasObjectURL(body);
  if (field === "input.content.input_image") return openAIResponsesInputHasImage(body);
  if (field === "input_file.file_data") return openAIResponsesInputFileHasField(body, "file_data");
  if (field === "input_file.file_url") return openAIResponsesInputFileHasField(body, "file_url");
  return body?.[field] !== undefined;
}

function providerFallbackFieldSupported(body, field, protocol = "") {
  if (!field) return false;
  if (field === "text.format" || field === "text.verbosity") return protocol === "openai_responses";
  if (field === "messages.content") return protocol === "anthropic_messages";
  if (field === "messages.content.image") return protocol === "anthropic_messages";
  if (field === "messages.content.document") return protocol === "anthropic_messages";
  if (field === "messages.role.system") return protocol === "openai_chat";
  if (field === "messages.content.image_url") return protocol === "openai_chat";
  if (field === "input.content.input_image") return protocol === "openai_responses";
  if (PROVIDER_FALLBACK_BODY_FIELDS.has(field)) return true;
  return providerFallbackCustomBodyFieldPresent(body, field);
}

function providerFallbackCustomBodyFieldPresent(body, field) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) return false;
  if (PROVIDER_REQUIRED_BODY_FIELDS.has(field.toLowerCase())) return false;
  return Object.prototype.hasOwnProperty.call(body || {}, field);
}

function providerTextFieldPresent(body, field) {
  const text = body?.text;
  return !!text && typeof text === "object" && !Array.isArray(text) && Object.prototype.hasOwnProperty.call(text, field);
}

function rejectedAnthropicMessagesContentField(body, detail) {
  if (!anthropicMessagesHaveStringContent(body)) return "";
  if (/messages?(?:[.\[]\d+\]?)*\.?content|message content|content.*(?:array|list|block)|(?:array|list|block).*content|valid list|list_type/.test(detail)) {
    return "messages.content";
  }
  return "";
}

function rejectedAnthropicVersionHeader(detail) {
  return /anthropic[-_\s]?version|headers?[.\s_-]*anthropic[-_\s]?version|unknown header|unsupported header|invalid header|not allowed header|forbidden header/.test(detail)
    && /anthropic[-_\s]?version/.test(detail);
}

function anthropicMessagesHaveStringContent(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some((message) => typeof message?.content === "string");
}

function rejectedAnthropicMessagesDocumentField(body, detail) {
  if (!anthropicMessagesHaveDocumentBlock(body)) return "";
  if (/messages?(?:[.\[]\d+\]?)*\.?content.*(?:document|source|media_type|media type|base64|application\/pdf)|content block.*document|document.*content block|unsupported document|document.*unsupported|pdf.*(?:unsupported|not supported|invalid)|(?:unsupported|not supported|invalid).*pdf/.test(detail)) {
    return "messages.content.document";
  }
  return "";
}

function rejectedAnthropicMessagesImageField(body, detail) {
  if (!anthropicMessagesHaveImageBlock(body)) return "";
  if (/messages?(?:[.\[]\d+\]?)*\.?content.*(?:image|source|media_type|media type|base64|image\/|png|jpe?g|webp)|content block.*image|image.*content block|unsupported image|image.*unsupported|vision.*(?:unsupported|not supported)|(?:unsupported|not supported|invalid).*image|image\/(?:png|jpe?g|webp)|media_type.*image/.test(detail)) {
    return "messages.content.image";
  }
  return "";
}

function anthropicMessagesHaveDocumentBlock(body) {
  return anthropicDocumentBlocks(body).length > 0;
}

function anthropicMessagesHaveImageBlock(body) {
  return anthropicImageBlocks(body).length > 0;
}

function anthropicDocumentBlocks(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    .filter((part) => part?.type === "document" && part && typeof part === "object");
}

function anthropicImageBlocks(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    .filter((part) => part?.type === "image" && part && typeof part === "object");
}

function rejectedOpenAIChatImageURLField(body, detail) {
  if (!openAIChatImageURLHasObjectURL(body)) return "";
  if (/image_url\.url|image_url_url|imageurl\.url|imageurlurl|(?:image_url|image url|imageurl).*string|string.*(?:image_url|image url|imageurl)|string_type|valid string/.test(detail)) return "image_url.url";
  return "";
}

function rejectedOpenAIChatImageContentField(body, detail) {
  if (!openAIChatHasImagePart(body)) return "";
  if (/messages?(?:[.\[]\d+\]?)*\.?content.*(?:image|image_url|image url)|(?:image_url|image url|imageurl).*(?:unsupported|not supported|unrecognized|unknown|invalid|extra_forbidden|not permitted|forbidden)|(?:unsupported|not supported|unrecognized|unknown|invalid|extra_forbidden|not permitted|forbidden).*(?:image_url|image url|imageurl)|(?:image|vision|input image).*(?:unsupported|not supported|not available|disabled)|(?:unsupported|not supported|not available|disabled).*(?:image|vision|input image)|image\/(?:png|jpe?g|webp)/.test(detail)) {
    return "messages.content.image_url";
  }
  return "";
}

function rejectedOpenAIChatSystemRoleField(body, detail) {
  if (!openAIChatHasSystemMessage(body)) return "";
  if (/system (?:role|message)|(?:role|message).*system|messages?(?:[.\[]\d+\]?)*\.?role|message role|unsupported role|invalid role|expected.*(?:user|assistant)|(?:user|assistant).*expected/.test(detail)) {
    return "messages.role.system";
  }
  return "";
}

function openAIChatHasSystemMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some((message) => String(message?.role || "").toLowerCase() === "system");
}

function openAIChatImageURLHasObjectURL(body) {
  return openAIChatImageParts(body).some((part) => {
    const imageURL = part?.image_url;
    return imageURL && typeof imageURL === "object" && !Array.isArray(imageURL) && imageURL.url !== undefined;
  });
}

function openAIChatHasImagePart(body) {
  return openAIChatImageParts(body).length > 0;
}

function openAIChatImageParts(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    .filter((part) => part?.type === "image_url" && part && typeof part === "object");
}

function rejectedOpenAIResponsesPdfFileField(body, detail) {
  if (openAIResponsesInputFileHasField(body, "file_data") && /\bfile_data\b/.test(detail)) return "input_file.file_data";
  if (openAIResponsesInputFileHasField(body, "file_url") && /\bfile_url\b/.test(detail)) return "input_file.file_url";
  return "";
}

function rejectedOpenAIResponsesInputImageField(body, detail) {
  if (!openAIResponsesInputHasImage(body)) return "";
  if (/input(?:[.\[]\d+\]?)*\.?content.*(?:input_image|image_url|image url|image)|input_image|inputimage|(?:image|vision|input image).*(?:unsupported|not supported|not available|disabled)|(?:unsupported|not supported|not available|disabled).*(?:image|vision|input image)|image\/(?:png|jpe?g|webp)/.test(detail)) {
    return "input.content.input_image";
  }
  return "";
}

function openAIResponsesInputHasImage(body) {
  return openAIResponsesInputImageParts(body).length > 0;
}

function openAIResponsesInputImageParts(body) {
  const input = Array.isArray(body?.input) ? body.input : [];
  return input.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === "input_image" && part && typeof part === "object");
}

function openAIResponsesInputFileHasField(body, field) {
  return openAIResponsesInputFileParts(body).some((part) => part[field] !== undefined);
}

function openAIResponsesInputFileParts(body) {
  const input = Array.isArray(body?.input) ? body.input : [];
  return input.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === "input_file" && part && typeof part === "object");
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
    if (usedFields.has("input_file.file_url")) {
      nextExtra.omitPdfInputFile = true;
    } else {
      nextExtra.pdfInputFileField = "file_url";
    }
    removeFromArray(omitFields, "input_file.file_data");
  }
  if (fields.includes("input_file.file_url")) {
    if (usedFields.has("input_file.file_data")) {
      nextExtra.omitPdfInputFile = true;
    } else {
      nextExtra.pdfInputFileField = "file_data";
    }
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
    nextExtra.anthropicTextContentFormat = "blocks";
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

function providerHTTPError(status, text) {
  const error = new Error(providerErrorText(status, text));
  error.retryableProviderError = status === 429 || status >= 500;
  return error;
}

function delay(ms) {
  return Zotero.Promise?.delay ? Zotero.Promise.delay(ms) : new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStream(response, protocol, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let recordLines = [];
  let text = "";
  let usage = null;
  const consumeRecord = (record) => {
    const parsed = parseStreamDelta(protocol, record);
    usage = mergeProviderUsage(usage, parsed.usage);
    if (parsed.text && (!parsed.snapshot || !text)) {
      text += parsed.text;
      onDelta(parsed.text);
    }
  };
  try {
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
  } catch (err) {
    if (err && typeof err === "object") {
      err.zmsProviderStreamError = true;
      err.zmsPartialText = text;
    }
    throw err;
  }
  response.zmsUsage = normalizeProviderUsage(usage);
  return text;
}

const PROVIDER_RESPONSE_WRAPPER_KEYS = ["data", "result", "payload", "response", "message", "body", "completion"];
const MODEL_LIST_RESPONSE_WRAPPER_KEYS = [...PROVIDER_RESPONSE_WRAPPER_KEYS, "meta", "metadata", "pagination", "paging", "page", "links"];
const MODEL_TEXT_CONTAINER_KEYS = [
  "content",
  "output",
  "parts",
  "message",
  "delta",
  "part",
  "item",
  "response",
  "result",
  "payload",
  "data",
  "body",
  "candidate",
  "candidates",
  "content_block",
  "completion",
  "parsed",
  "json",
  "output_parsed",
  "outputParsed"
];
const PROVIDER_USAGE_CONTAINER_KEYS = [
  ...PROVIDER_RESPONSE_WRAPPER_KEYS,
  "delta",
  "choices",
  "output",
  "content",
  "parts",
  "part",
  "item",
  "candidate",
  "candidates"
];

function streamTextFromData(protocol, data, depth = 0) {
  if (!data) return "";
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  if (isReasoningStreamEvent(data)) return "";
  if (protocol === "anthropic_messages") {
    if (data?.type === "content_block_delta") {
      return data?.delta?.text || data?.delta?.partial_json || "";
    }
    if (data?.type === "content_block_start") {
      return modelTextFromValue(data?.content_block);
    }
    return data?.delta?.text
      || data?.delta?.partial_json
      || data?.content_block?.text
      || modelTextFromValue(data?.content)
      || modelTextFromValue(data?.message)
      || wrappedStreamTextFromData(protocol, data, depth);
  }
  const choiceText = modelTextFromChoices(data?.choices);
  if (choiceText) return choiceText;
  if ((data?.type === "response.output_text.delta" || data?.type === "response.text.delta") && typeof data?.delta === "string") return data.delta;
  if (data?.type === "response.refusal.delta" && typeof data?.delta === "string") return data.delta;
  if (data?.type === "response.output_text.done" && typeof data?.text === "string") return data.text;
  if (data?.type === "response.refusal.done" && typeof data?.refusal === "string") return data.refusal;
  if (data?.delta?.content) {
    const nestedDelta = modelTextFromValue(data.delta.content);
    if (nestedDelta) return nestedDelta;
  }
  const deltaText = modelTextFromValue(data?.delta);
  if (deltaText) return deltaText;
  const directContent = modelTextFromValue(data?.content);
  if (directContent) return directContent;
  const candidateContent = modelTextFromValue(data?.candidates);
  if (candidateContent) return candidateContent;
  const eventText = modelTextFromStreamContainer(data);
  if (eventText) return eventText;
  const directText = modelTextFromValue(data?.text);
  if (directText) return directText;
  return modelTextFromValue(data?.output) || (typeof data?.delta === "string" ? data.delta : "") || wrappedStreamTextFromData(protocol, data, depth);
}

function wrappedStreamTextFromData(protocol, data, depth) {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object") continue;
    const text = streamTextFromData(protocol, value, depth + 1);
    if (text) return text;
  }
  return "";
}

function parseStreamDelta(protocol, rawLine) {
  const payloads = streamPayloads(rawLine);
  if (!payloads.length) return { text: "", snapshot: false, usage: null };
  let text = "";
  let snapshot = false;
  let usage = null;
  for (const payload of payloads) {
    const parsed = parseStreamPayload(protocol, payload);
    if (parsed.snapshot) snapshot = true;
    usage = mergeProviderUsage(usage, parsed.usage);
    if (parsed.text && (!parsed.snapshot || !text)) text += parsed.text;
  }
  return { text, snapshot, usage };
}

function parseStreamPayload(protocol, payload) {
  if (!payload || payload === "[DONE]") return { text: "", snapshot: false, usage: null };
  const data = safeParseJSON(payload);
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  return {
    text: streamTextFromData(protocol, data),
    snapshot: isStreamSnapshot(protocol, data),
    usage: providerUsageFromResponse(data)
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

function streamErrorText(data, depth = 0) {
  const direct = directProviderErrorText(data);
  if (direct) return direct;
  if (depth >= 3 || !data || typeof data !== "object" || Array.isArray(data)) return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = streamErrorText(value, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function directProviderErrorText(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const error = data?.error || (data?.type === "error" ? data : null);
  if (error) {
    if (typeof error === "string") return error;
    const code = firstProviderErrorString(error.code, data?.code);
    const type = normalizedProviderErrorType(error.type);
    const message = firstProviderErrorString(error.message, data?.message, error.detail, data?.detail, error.error_description, data?.error_description);
    const details = providerErrorDetailsText(error.details, error.detail, error.errors, data?.details, data?.detail, data?.errors);
    return [code, type, providerErrorMessageWithDetails(message, details) || JSON.stringify(error)].filter(Boolean).join(" - ");
  }
  if (Array.isArray(data?.errors) && data.errors.length) {
    const text = data.errors.map((entry) => directProviderErrorText({ error: entry })).filter(Boolean).join("; ");
    if (text) return text;
  }
  const message = firstProviderErrorString(data.message, data.detail, data.error_description, data.errorMessage, data.error_message);
  const details = providerErrorDetailsText(data.details, data.detail, data.errors);
  const code = firstProviderErrorString(data.code, data.error_code, data.errorCode);
  const type = firstProviderErrorString(data.type, data.error_type, data.errorType);
  const status = firstProviderErrorString(data.status, data.status_code, data.statusCode);
  const statusText = status.toLowerCase();
  const typeText = type.toLowerCase();
  const looksLikeError = data.ok === false
    || data.success === false
    || /^(error|failed|failure|invalid|unauthorized|forbidden)$/i.test(statusText)
    || /error|invalid|unauth|forbidden|denied|rate|limit|unsupported/.test(typeText)
    || !!code
    || providerErrorDetailLooksLikeError(details);
  const messageWithDetails = providerErrorMessageWithDetails(message, details);
  return messageWithDetails && looksLikeError ? [code, type, status, messageWithDetails].filter(Boolean).join(" - ") : "";
}

function normalizedProviderErrorType(value) {
  const type = firstProviderErrorString(value);
  return type.toLowerCase() === "error" ? "" : type;
}

function providerErrorMessageWithDetails(message, details) {
  if (!message) return details;
  if (!details || details === message) return message;
  return `${message} | ${details}`;
}

function providerErrorDetailsText(...values) {
  const details = [];
  for (const value of values) collectProviderErrorDetails(value, details, 0);
  return Array.from(new Set(details.map((entry) => entry.trim()).filter(Boolean))).join("; ");
}

function collectProviderErrorDetails(value, details, depth) {
  if (value === undefined || value === null || depth > 4) return;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) details.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProviderErrorDetails(item, details, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const path = providerErrorPath(value.loc ?? value.location ?? value.path ?? value.json_path ?? value.jsonpath ?? value.param ?? value.parameter ?? value.field ?? value.property ?? value.argument);
  const message = firstProviderErrorString(value.msg, value.message, value.detail, value.reason, value.description, value.type, value.code);
  if (path || message) details.push([path, message].filter(Boolean).join(": "));
  collectProviderErrorDetails(value.details, details, depth + 1);
  collectProviderErrorDetails(value.errors, details, depth + 1);
  collectProviderErrorDetails(value.causes, details, depth + 1);
  collectProviderErrorDetails(value.issues, details, depth + 1);
}

function providerErrorPath(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!Array.isArray(value)) return "";
  let path = "";
  for (const item of value) {
    if (typeof item === "number" || (typeof item === "string" && /^\d+$/.test(item))) {
      path += `[${item}]`;
      continue;
    }
    if (typeof item !== "string" || !item.trim()) return "";
    const text = item.trim();
    path += path ? `.${text}` : text;
  }
  return path;
}

function providerErrorDetailLooksLikeError(value) {
  return /error|invalid|unauth|forbidden|denied|rate|limit|unsupported|unknown|not supported|not permitted|not allowed|extra_forbidden/.test(String(value || "").toLowerCase());
}

function firstProviderErrorString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function providerUsageFromResponse(data, depth = 0) {
  if (!data || typeof data !== "object" || depth > 5) return null;
  if (Array.isArray(data)) {
    return data
      .map((item) => providerUsageFromResponse(item, depth + 1))
      .filter(Boolean)
      .reduce((merged, usage) => mergeProviderUsage(merged, usage), null);
  }
  const direct = directProviderUsageFromResponse(data);
  const nested = PROVIDER_USAGE_CONTAINER_KEYS
    .map((key) => providerUsageFromResponse(data?.[key], depth + 1))
    .filter(Boolean)
    .reduce((merged, usage) => mergeProviderUsage(merged, usage), null);
  return mergeProviderUsage(direct, nested);
}

function directProviderUsageFromResponse(data) {
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
    .reduce((merged, usage) => mergeProviderUsage(merged, usage), null);
}

function normalizeProviderUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = firstNumber(
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
  const outputTokens = firstNumber(
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
  const totalTokens = firstNumber(
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
  const cachedInputTokens = sumNumbers(
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
  const reasoningTokens = firstNumber(
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
  return Object.keys(normalized).length ? normalized : null;
}

function mergeProviderUsage(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  const merged = {};
  for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens"]) {
    const value = maxNumber(left[key], right[key]);
    if (value !== undefined) merged[key] = value;
  }
  const total = maxNumber(
    left.totalTokens,
    right.totalTokens,
    merged.inputTokens !== undefined || merged.outputTokens !== undefined
      ? (merged.inputTokens || 0) + (merged.outputTokens || 0)
      : undefined
  );
  if (total !== undefined) merged.totalTokens = total;
  return Object.keys(merged).length ? merged : null;
}

function providerUsageText(usage) {
  const normalized = normalizeProviderUsage(usage);
  if (!normalized) return "";
  const parts = [];
  if (normalized.inputTokens !== undefined) parts.push(`input ${normalized.inputTokens}`);
  if (normalized.outputTokens !== undefined) parts.push(`output ${normalized.outputTokens}`);
  if (normalized.totalTokens !== undefined) parts.push(`total ${normalized.totalTokens}`);
  if (normalized.cachedInputTokens !== undefined) parts.push(`cached ${normalized.cachedInputTokens}`);
  if (normalized.reasoningTokens !== undefined) parts.push(`reasoning ${normalized.reasoningTokens}`);
  return parts.join(", ");
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numericValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function sumNumbers(...values) {
  const numbers = values.map((value) => numericValue(value)).filter((value) => value !== undefined);
  if (!numbers.length) return undefined;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function maxNumber(...values) {
  const numbers = values.map((value) => numericValue(value)).filter((value) => value !== undefined);
  return numbers.length ? Math.max(...numbers) : undefined;
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function extractResponseText(protocol, data) {
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Provider error: ${redact(errorText)}`);
  const text = protocol === "anthropic_messages"
    ? anthropicTextFromResponse(data)
    : openAITextFromResponse(data);
  if (!text) throw new Error("No text returned from model");
  const visibleText = stripThink(text);
  if (!visibleText) throw new Error("No text returned from model");
  return visibleText;
}

function extractProviderConnectionText(protocol, text) {
  const data = safeParseJSON(text);
  if (!data) {
    const plainText = String(text || "").trim();
    if (!plainText) throw new Error("No text returned from model");
    return plainText;
  }
  return extractResponseText(protocol, data);
}

function anthropicMessages(messages, requestInput, baseText, fallbackSystem = "", profile = null) {
  const mapped = messages.map((message) => ({ role: message.role, content: message.content }));
  const content = [];
  const systemText = fallbackSystemText(fallbackSystem);
  const contextText = requestInput?.type === "text" && requestInput.text ? `CONTEXT:\n${requestInput.text}` : "";
  if (!shouldOmitAnthropicImage(profile)) {
    for (const image of requestInputImages(requestInput)) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType || "image/png",
          data: image.base64 || ""
        }
      });
    }
  }
  if (requestInput?.type === "pdf_base64" && requestInput.base64 && !shouldOmitAnthropicDocument(profile)) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: requestInput.base64 } });
  }
  if (!content.length) {
    let nextMessages = contextText ? messagesWithAppendedAnthropicText(mapped, contextText) : mapped;
    if (systemText) nextMessages = messagesWithPrependedAnthropicText(nextMessages, systemText);
    return formatAnthropicMessages(mergeConsecutiveAnthropicMessages(nextMessages), profile);
  }
  const text = contextText ? `${baseText}\n\n${contextText}` : baseText;
  content.push({ type: "text", text: systemText ? `${systemText}\n\n${text}` : text });
  const lastUserIndex = findLastIndex(mapped, (message) => message.role === "user");
  if (lastUserIndex >= 0) {
    mapped[lastUserIndex] = { role: "user", content };
    return formatAnthropicMessages(mergeConsecutiveAnthropicMessages(mapped), profile);
  }
  mapped.push({ role: "user", content });
  return formatAnthropicMessages(mergeConsecutiveAnthropicMessages(mapped), profile);
}

function formatAnthropicMessages(messages, profile) {
  if (anthropicTextContentFormat(profile?.bodyExtra?.anthropicTextContentFormat ?? profile?.bodyExtra?.anthropicTextContent) !== "blocks") {
    return messages;
  }
  return messages.map((message) => typeof message?.content === "string"
    ? { ...message, content: [{ type: "text", text: message.content }] }
    : message);
}

function anthropicTextContentFormat(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  return normalized === "block" || normalized === "blocks" || normalized === "array" || normalized === "contentblocks" || normalized === "textblocks" ? "blocks" : "string";
}

function requestInputImages(requestInput) {
  return Array.isArray(requestInput?.images) ? requestInput.images.filter((image) => image?.base64) : [];
}

function imageDataURL(image) {
  return `data:${image.mimeType || "image/png"};base64,${image.base64 || ""}`;
}

function fallbackSystemText(value) {
  const text = String(value || "").trim();
  return text ? `SYSTEM:\n${text}` : "";
}

function messagesWithPrependedOpenAIChatText(messages, text) {
  const items = Array.isArray(messages) ? messages.map((item) => ({ ...item })) : [];
  const userIndex = items.findIndex((item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex];
    if (typeof item.content === "string") {
      items[userIndex] = { ...item, content: `${text}\n\n${item.content}` };
      return items;
    }
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [{ type: "text", text }, ...content] };
    return items;
  }
  return [{ role: "user", content: text }, ...items];
}

function messagesWithAppendedOpenAIChatText(messages, text) {
  const items = Array.isArray(messages) ? messages.map((item) => ({ ...item })) : [];
  const userIndex = findLastIndex(items, (item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex];
    if (typeof item.content === "string") {
      items[userIndex] = { ...item, content: `${item.content}\n\n${text}` };
      return items;
    }
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [...content, { type: "text", text }] };
    return items;
  }
  return [...items, { role: "user", content: text }];
}

function messagesWithPrependedAnthropicText(messages, text) {
  const items = Array.isArray(messages) ? messages.map((item) => ({ ...item })) : [];
  const userIndex = items.findIndex((item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex];
    if (typeof item.content === "string") {
      items[userIndex] = { ...item, content: `${text}\n\n${item.content}` };
      return items;
    }
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [{ type: "text", text }, ...content] };
    return items;
  }
  return [{ role: "user", content: text }, ...items];
}

function messagesWithAppendedAnthropicText(messages, text) {
  const items = Array.isArray(messages) ? messages.map((item) => ({ ...item })) : [];
  const userIndex = findLastIndex(items, (item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex];
    if (typeof item.content === "string") {
      items[userIndex] = { ...item, content: `${item.content}\n\n${text}` };
      return items;
    }
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [...content, { type: "text", text }] };
    return items;
  }
  return [...items, { role: "user", content: text }];
}

function mergeConsecutiveAnthropicMessages(messages) {
  const merged = [];
  for (const message of messages) {
    if (!hasAnthropicContent(message.content)) continue;
    const last = merged[merged.length - 1];
    if (last?.role === message.role) {
      last.content = mergeAnthropicContent(last.content, message.content);
    } else {
      merged.push({ role: message.role, content: message.content });
    }
  }
  return merged;
}

function hasAnthropicContent(content) {
  if (typeof content === "string") return !!content.trim();
  return Array.isArray(content) && content.length > 0;
}

function mergeAnthropicContent(left, right) {
  return compactAnthropicTextBlocks([...anthropicContentBlocks(left), ...anthropicContentBlocks(right)]);
}

function anthropicContentBlocks(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function compactAnthropicTextBlocks(blocks) {
  const compacted = [];
  for (const block of blocks) {
    const last = compacted[compacted.length - 1];
    if (block?.type === "text" && typeof block.text === "string" && last?.type === "text" && typeof last.text === "string") {
      last.text = `${last.text}\n\n${block.text}`;
    } else {
      compacted.push(block);
    }
  }
  return compacted;
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function endpointForProtocol(protocol, baseURL) {
  const base = stripKnownProviderEndpointPath(baseURL);
  if (!base) throw new Error("Base URL endpoint is required");
  if (protocol === "anthropic_messages") {
    return /\/v\d+$/i.test(providerURLPath(base)) ? appendProviderURLPath(base, "messages") : appendProviderURLPath(base, "v1/messages");
  }
  if (protocol === "openai_responses") return appendProviderURLPath(openAICompatibleBaseWithVersion(base), "responses");
  return appendProviderURLPath(openAICompatibleBaseWithVersion(base), "chat/completions");
}

function stripKnownProviderEndpointPath(baseURL) {
  const parts = splitProviderURLSuffix(baseURL);
  return `${parts.path.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|messages|models)$/i, "")}${parts.suffix}`;
}

function openAICompatibleBaseWithVersion(baseURL) {
  const base = trimProviderURLPath(baseURL);
  return hasOpenAICompatibleVersionPath(base) || usesVersionlessOpenAICompatibleBase(base) ? base : appendProviderURLPath(base, "v1");
}

function hasOpenAICompatibleVersionPath(baseURL) {
  const path = providerURLPath(baseURL);
  return /\/v\d+(?:[a-z]+)?$/i.test(path) || /\/v\d+(?:[a-z]+)?\/openai$/i.test(path);
}

function usesVersionlessOpenAICompatibleBase(baseURL) {
  const normalized = providerURLPath(baseURL).replace(/\/+$/, "");
  return /^https:\/\/api\.perplexity\.ai$/i.test(normalized)
    || /^https:\/\/models\.github\.ai\/inference$/i.test(normalized);
}

function appendProviderURLPath(baseURL, path) {
  const parts = splitProviderURLSuffix(baseURL);
  return `${parts.path.replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}${parts.suffix}`;
}

function trimProviderURLPath(baseURL) {
  const parts = splitProviderURLSuffix(baseURL);
  return `${parts.path.replace(/\/+$/, "")}${parts.suffix}`;
}

function providerURLPath(baseURL) {
  return splitProviderURLSuffix(baseURL).path;
}

function splitProviderURLSuffix(baseURL) {
  const text = String(baseURL || "").trim();
  const hashIndex = text.indexOf("#");
  const beforeHash = hashIndex >= 0 ? text.slice(0, hashIndex) : text;
  const hash = hashIndex >= 0 ? text.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex < 0) return { path: beforeHash, suffix: hash };
  return {
    path: beforeHash.slice(0, queryIndex),
    suffix: `${beforeHash.slice(queryIndex)}${hash}`
  };
}

function modelTextFromValue(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => modelTextFromValue(item, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    if (isReasoningModelPart(value)) return "";
    if (typeof value.text === "string") return value.text;
    if (value.text && typeof value.text === "object") {
      const text = modelTextFromValue(value.text, depth + 1);
      if (text) return text;
    }
    if (typeof value.value === "string") return value.value;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.completion === "string") return value.completion;
    if (typeof value.refusal === "string") return value.refusal;
    const structured = structuredModelText(value?.parsed, depth + 1)
      || structuredModelText(value?.json, depth + 1)
      || structuredModelText(value?.output_parsed, depth + 1)
      || structuredModelText(value?.outputParsed, depth + 1);
    if (structured) return structured;
    for (const key of MODEL_TEXT_CONTAINER_KEYS) {
      const nested = value?.[key];
      if (!nested || nested === value) continue;
      const text = modelTextFromValue(nested, depth + 1);
      if (text) return text;
    }
  }
  return "";
}

function structuredModelText(value, depth = 0) {
  if (value === undefined || value === null || depth > 5) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const nested = modelTextFromValue(value, depth + 1);
    if (nested) return nested;
    return stringifyProviderJSON(value);
  }
  return "";
}

function stringifyProviderJSON(value) {
  try {
    return JSON.stringify(value, null, 2) || "";
  } catch (_err) {
    return "";
  }
}

function modelTextFromChoices(choices) {
  if (!Array.isArray(choices)) return "";
  return choices
    .map((choice) => {
      if (typeof choice?.delta === "string") return choice.delta;
      return modelTextFromValue(choice?.delta?.content)
        || modelTextFromValue(choice?.delta)
        || modelTextFromValue(choice?.message?.content)
        || modelTextFromValue(choice?.message)
        || (typeof choice?.text === "string" ? choice.text : "")
        || (typeof choice?.delta?.text === "string" ? choice.delta.text : "");
    })
    .filter(Boolean)
    .join("\n");
}

function modelTextFromStreamContainer(value) {
  return modelTextFromValue(value?.part)
    || modelTextFromValue(value?.item)
    || modelTextFromValue(value?.message)
    || modelTextFromValue(value?.response)
    || "";
}

function openAITextFromResponse(data, depth = 0) {
  return data?.output_text
    || modelTextFromChoices(data?.choices)
    || modelTextFromValue(data?.output)
    || modelTextFromValue(data?.content)
    || modelTextFromValue(data?.candidates)
    || modelTextFromStreamContainer(data)
    || modelTextFromValue(data?.text)
    || modelTextFromValue(data?.refusal)
    || wrappedProviderTextFromResponse("openai", data, depth);
}

function anthropicTextFromResponse(data, depth = 0) {
  return modelTextFromValue(data?.content)
    || modelTextFromValue(data?.message)
    || modelTextFromValue(data?.body)
    || modelTextFromValue(data?.candidates)
    || modelTextFromValue(data?.text)
    || wrappedProviderTextFromResponse("anthropic", data, depth);
}

function wrappedProviderTextFromResponse(protocol, data, depth) {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object") continue;
    const text = protocol === "anthropic"
      ? anthropicTextFromResponse(value, depth + 1)
      : openAITextFromResponse(value, depth + 1);
    if (text) return text;
  }
  return "";
}

function isStreamSnapshot(protocol, value, depth = 0) {
  if (protocol === "anthropic_messages") return false;
  const type = String(value?.type || "");
  const direct = type === "response.output_text.done"
    || type === "response.content_part.done"
    || type === "response.output_item.done"
    || type === "response.completed"
    || !!value?.part
    || !!value?.item
    || !!value?.message
    || !!value?.response;
  if (direct) return true;
  if (depth >= 2 || !value || typeof value !== "object") return false;
  return PROVIDER_RESPONSE_WRAPPER_KEYS.some((key) => {
    const wrapped = value?.[key];
    return !!wrapped && typeof wrapped === "object" && isStreamSnapshot(protocol, wrapped, depth + 1);
  });
}

function isReasoningModelPart(value) {
  const type = String(value?.type || "");
  return type.includes("reasoning") || type.includes("thinking");
}

function isReasoningStreamEvent(value) {
  if (!value || typeof value !== "object") return false;
  return [value.type, value.delta?.type, value.content_block?.type]
    .some((type) => isReasoningModelPart({ type }));
}

async function ensureSummaryFile(item, pdf, outputDir, options = {}) {
  const outputLanguage = normalizeOutputLanguage(options.outputLanguage);
  const inputMode = normalizeInputMode(options.inputMode);
  const sourceHash = options.sourceHash || "";
  const summaryVersion = options.summaryVersion || "1";
  const provider = options.provider || pref("provider") || "default";
  const model = options.model || "";
  const sourceLanguage = options.sourceLanguage || "auto";
  const templateVersion = options.templateVersion || "workbench-v1";
  const summaryType = options.summaryType || "paper-chat";
  const evidenceLevel = inputMode === "text" ? "fulltext_or_indexed_text" : "pdf_base64";
  const existing = await findExistingSummaryAttachment(item, outputDir);
  if (existing) {
    const existingPath = await existing.getFilePathAsync().catch(() => "");
    if (existingPath && (!IOUtils.exists || await IOUtils.exists(existingPath))) {
      return { path: existingPath, created: false };
    }
  }
  await ensureDirectory(outputDir);
  const title = item.getField("title") || item.key;
  const path = PathUtils.join(outputDir, `${sanitizeFilename(item.key)}.${outputLanguage}.summary.md`);
  const markdown = [
    "---",
    `zoteroItemKey: ${item.key}`,
    `pdfAttachmentKey: ${pdf?.key || ""}`,
    `sourceHash: ${sourceHash}`,
    `summaryVersion: ${summaryVersion}`,
    `inputMode: ${inputMode}`,
    `summaryType: ${summaryType}`,
    `evidenceLevel: ${evidenceLevel}`,
    `outputLanguage: ${outputLanguage}`,
    `sourceLanguage: ${sourceLanguage}`,
    `templateVersion: ${templateVersion}`,
    `provider: ${provider}`,
    `model: ${model}`,
    `generatedAt: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${title}`,
    ""
  ].join("\n");
  await writeText(path, markdown);
  await linkOrUpdateSummaryAttachment(item, path, existing);
  return { path, created: true };
}

async function findExistingSummaryAttachment(item, outputDir) {
  const prefix = summaryTitlePrefix(item);
  const attachmentIDs = typeof item?.getAttachments === "function" ? item.getAttachments() : [];
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    if (!attachment) continue;
    const title = attachment.getField("title") || "";
    if (!title.startsWith(prefix)) continue;
    const path = await attachment.getFilePathAsync().catch(() => "");
    if (!path || path.startsWith(outputDir)) return attachment;
  }
  return null;
}

async function linkOrUpdateSummaryAttachment(item, path, existing) {
  const title = summaryTitlePrefix(item) + ".md";
  if (existing) {
    const previous = summaryAttachmentSnapshot(existing);
    try {
      if (typeof existing.setField === "function") existing.setField("title", title);
      else existing.title = title;
      existing.attachmentPath = path;
      existing.attachmentContentType = existing.attachmentContentType || "text/markdown";
      if (typeof existing.saveTx === "function") {
        await existing.saveTx();
        return existing;
      }
    } catch (_err) {
      restoreSummaryAttachmentSnapshot(existing, previous);
      // Fall back to a fresh linked file if the existing attachment cannot be repaired.
    }
  }
  const payload = { file: path, contentType: "text/markdown", title };
  if (item?.isRegularItem?.()) payload.parentItemID = item.id;
  else if (item?.libraryID) payload.libraryID = item.libraryID;
  return Zotero.Attachments.linkFromFile(payload);
}

function summaryAttachmentSnapshot(attachment) {
  return {
    title: typeof attachment.getField === "function" ? attachment.getField("title") : attachment.title,
    attachmentPath: attachment.attachmentPath,
    attachmentContentType: attachment.attachmentContentType
  };
}

function restoreSummaryAttachmentSnapshot(attachment, snapshot) {
  try {
    if (typeof attachment.setField === "function") attachment.setField("title", snapshot.title || "");
    else attachment.title = snapshot.title;
    attachment.attachmentPath = snapshot.attachmentPath;
    attachment.attachmentContentType = snapshot.attachmentContentType;
  } catch (_err) {
    // Best-effort cleanup before creating a fresh linked attachment.
  }
}

function summaryTitlePrefix(item) {
  return `Markdown 摘要 - ${item.key}`;
}

function extractHeadings(markdown) {
  return Array.from(markdown.matchAll(/^(#{2,6})\s+(.+?)\s*$/gm)).map((match) => match[2]);
}

function applyMarkdownEdit(original, request) {
  const patch = { lastEditedAt: request.now, lastEditSource: "chat", chatSessionId: request.chatSessionId, skillId: request.skillId || "", editCount: nextEditCount(original) };
  const edited = applyBodyEdit(original, request);
  const after = upsertFrontmatter(edited, patch);
  return { before: original, after, diff: simpleDiff(original, after), backupPath: backupPathFor(request.summaryPath, request.now), tempPath: tempPathFor(request.summaryPath, request.now), frontmatterPatch: patch, action: request.action, targetSection: request.targetSection || "" };
}

function applyBodyEdit(original, request) {
  if (request.action === "append_research_notes") return appendToNamedSection(original, request.targetSection || "Research Notes", request.replacementText);
  const range = findHeadingRange(original, request.targetSection);
  if (!range) {
    if (request.action === "append_section") return appendToNamedSection(original, request.targetSection, request.replacementText);
    throw new Error(`Section not found: ${request.targetSection}`);
  }
  if (request.action === "replace_section") return `${original.slice(0, range.contentStart)}\n${request.replacementText.trim()}\n${original.slice(range.end)}`;
  return `${original.slice(0, range.end).replace(/\s*$/, "")}\n\n${request.replacementText.trim()}\n${original.slice(range.end)}`;
}

function appendToNamedSection(original, title, text) {
  const range = findHeadingRange(original, title);
  if (range) return `${original.slice(0, range.end).replace(/\s*$/, "")}\n\n${text.trim()}\n${original.slice(range.end)}`;
  return `${original}${original.endsWith("\n") ? "" : "\n"}\n## ${title}\n\n${text.trim()}\n`;
}

function findHeadingRange(markdown, title) {
  const headingPattern = /^(#{1,6})\s+(.+?)\s*$/gm;
  const normalizedTitle = normalizeHeading(title || "");
  let match;
  while ((match = headingPattern.exec(markdown))) {
    const level = match[1].length;
    if (normalizeHeading(match[2]) !== normalizedTitle) continue;
    const contentStart = headingPattern.lastIndex;
    const nextPattern = new RegExp(`^#{1,${level}}\\s+.+?\\s*$`, "gm");
    nextPattern.lastIndex = contentStart;
    const next = nextPattern.exec(markdown);
    return { contentStart, end: next?.index ?? markdown.length };
  }
  return null;
}

function upsertFrontmatter(markdown, patch) {
  if (!markdown.startsWith("---\n")) return `---\n${formatPatch(patch)}\n---\n\n${markdown}`;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return `---\n${formatPatch(patch)}\n---\n\n${markdown}`;
  const lines = markdown.slice(4, end).split("\n");
  const seen = new Set();
  const updated = lines.map((line) => {
    const key = line.split(":")[0]?.trim();
    if (key && Object.prototype.hasOwnProperty.call(patch, key)) {
      seen.add(key);
      return `${key}: ${patch[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(patch)) {
    if (!seen.has(key) && value !== "") updated.push(`${key}: ${value}`);
  }
  return `---\n${updated.join("\n")}\n---${markdown.slice(end + 4)}`;
}

function formatPatch(patch) {
  return Object.entries(patch).filter(([, value]) => value !== "").map(([key, value]) => `${key}: ${value}`).join("\n");
}

function backupPathFor(summaryPath, timestamp) {
  const slashIndex = Math.max(summaryPath.lastIndexOf("/"), summaryPath.lastIndexOf("\\"));
  const dir = slashIndex === -1 ? "." : summaryPath.slice(0, slashIndex);
  const file = slashIndex === -1 ? summaryPath : summaryPath.slice(slashIndex + 1);
  return `${dir}/.bak/${file}.${timestamp.replace(/[:.]/g, "-")}.md`;
}

function tempPathFor(summaryPath, timestamp) {
  const slashIndex = Math.max(summaryPath.lastIndexOf("/"), summaryPath.lastIndexOf("\\"));
  const dir = slashIndex === -1 ? "." : summaryPath.slice(0, slashIndex);
  const file = slashIndex === -1 ? summaryPath : summaryPath.slice(slashIndex + 1);
  return `${dir}/.${file}.${timestamp.replace(/[:.]/g, "-")}.tmp`;
}

function assertWritePreviewCurrent(preview, currentText, staleMessage) {
  if (!preview || currentText !== preview.before) {
    throw new Error(staleMessage || "Summary file changed after preview. Reload preview before writing.");
  }
}

async function commitWritePreview(summaryPath, preview) {
  await ensureDirectory(parentDir(preview.backupPath));
  await writeText(preview.backupPath, preview.before);
  try {
    await writeTextAtomic(summaryPath, preview.after, preview.tempPath);
  } catch (err) {
    await restorePreviewBeforeOnFailure(summaryPath, preview);
    throw err;
  }
}

async function restorePreviewBeforeOnFailure(summaryPath, preview) {
  try {
    const current = await readText(summaryPath);
    if (current === preview.before) return;
  } catch (_err) {
    // If the target cannot be read after a failed write, still try restoring below.
  }
  const rollbackTempPath = `${preview.tempPath || tempPathFor(summaryPath, new Date().toISOString())}.rollback`;
  try {
    await writeTextAtomic(summaryPath, preview.before, rollbackTempPath);
  } catch (_err) {
    try {
      await writeText(summaryPath, preview.before);
    } catch (_innerErr) {
      // Preserve the original write error for the caller; the backup file remains available.
    }
  }
}

function nextEditCount(markdown) {
  const match = markdown.match(/^editCount:\s*(\d+)\s*$/m);
  return match ? Number(match[1]) + 1 : 1;
}

function simpleDiff(before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix++;
  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (beforeSuffix >= prefix && afterSuffix >= prefix && beforeLines[beforeSuffix] === afterLines[afterSuffix]) {
    beforeSuffix--;
    afterSuffix--;
  }
  return [
    ...beforeLines.slice(prefix, beforeSuffix + 1).map((line) => `- ${line}`),
    ...afterLines.slice(prefix, afterSuffix + 1).map((line) => `+ ${line}`)
  ].join("\n");
}

function writePreviewSummary(preview, options = {}) {
  if (!preview) return "";
  const translate = options.translate || ((key) => key);
  const action = options.action || preview.action || "";
  const targetSection = options.targetSection || preview.targetSection || "";
  const summaryPath = options.summaryPath || "";
  const lines = [
    `${translate("writeTarget")}: ${summaryPath}`,
    `${translate("writeBackup")}: ${preview.backupPath || ""}`,
    `${translate("writeAction")}: ${translate(writeActionMessageKey(action))}`,
    `${translate("writeSection")}: ${targetSection || translate("writeSectionNone")}`,
    `${translate("writeSize")}: ${String(preview.before || "").length} -> ${String(preview.after || "").length}`
  ];
  const patchKeys = Object.keys(preview.frontmatterPatch || {}).filter((key) => preview.frontmatterPatch[key] !== "");
  if (patchKeys.length) lines.push(`${translate("writeFrontmatter")}: ${patchKeys.join(", ")}`);
  return lines.join("\n");
}

function writeActionMessageKey(action) {
  if (action === "replace_section") return "replaceSection";
  if (action === "append_section") return "appendSection";
  return "appendNotes";
}

async function readText(path) {
  if (IOUtils.readUTF8) return IOUtils.readUTF8(path);
  return new TextDecoder().decode(await IOUtils.read(path));
}

async function writeText(path, text) {
  await ensureDirectory(parentDir(path));
  if (Zotero.File?.putContentsAsync) return Zotero.File.putContentsAsync(path, text);
  if (IOUtils.writeUTF8) return IOUtils.writeUTF8(path, text);
  return IOUtils.write(path, new TextEncoder().encode(text));
}

async function writeTextAtomic(path, text, tempPath) {
  await ensureDirectory(parentDir(path));
  if (!IOUtils.move || !PathUtils?.join) {
    await writeText(path, text);
    return;
  }
  tempPath ||= PathUtils.join(parentDir(path), `.${leafName(path)}.${Date.now()}.tmp`);
  try {
    await writeText(tempPath, text);
    await IOUtils.move(tempPath, path, { noOverwrite: false });
  } catch (err) {
    await removePathQuietly(tempPath);
    throw err;
  }
}

async function removePathQuietly(path) {
  try {
    if (path && await IOUtils.exists(path)) {
      if (IOUtils.remove) await IOUtils.remove(path);
      else if (IOUtils.removeFile) await IOUtils.removeFile(path);
    }
  } catch (_err) {
    // Best-effort cleanup only; the original summary remains untouched.
  }
}

async function ensureDirectory(path) {
  if (!await IOUtils.exists(path)) await IOUtils.makeDirectory(path, { createAncestors: true, ignoreExisting: true });
}

async function pathExists(path) {
  try {
    return !!path && await IOUtils.exists(path);
  } catch (_err) {
    return false;
  }
}

function parentDir(path) {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slashIndex === -1 ? "." : path.slice(0, slashIndex);
}

function leafName(path) {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slashIndex === -1 ? path : path.slice(slashIndex + 1);
}

function sessionFilenameFor(sessionId) {
  const normalized = normalizeSessionId(sessionId);
  return `${normalized || `chat-${Date.now()}`}.jsonl`;
}

function sessionIdFromPath(path) {
  const name = leafName(String(path || ""));
  const lower = name.toLowerCase();
  if (lower.endsWith(".jsonl")) return normalizeSessionId(name.slice(0, -6));
  if (lower.endsWith(".md")) {
    const id = normalizeSessionId(name.slice(0, -3));
    return id.startsWith("chat-") ? id : "";
  }
  return "";
}

function sessionStartedAtFromId(sessionId) {
  const match = String(sessionId || "").match(/^chat-(\d+)/);
  return match ? Number(match[1]) : 0;
}

function sessionLabelFromPath(path) {
  const id = sessionIdFromPath(path) || leafName(path);
  const startedAt = sessionStartedAtFromId(id);
  if (startedAt) {
    const date = new Date(startedAt);
    if (!Number.isNaN(date.getTime())) {
      return `Chat · ${date.toLocaleString()}`;
    }
  }
  return id;
}

function newSessionId() {
  return `chat-${Date.now()}`;
}

function sessionScopeKey(item) {
  return sessionIdentityKeys(item)[0] || "unknown";
}

function sessionIdentityKeys(item) {
  const keys = [];
  const ownerKey = sessionOwnerItem(item)?.key || "";
  if (ownerKey) keys.push(ownerKey);
  if (item?.key) keys.push(item.key);
  return Array.from(new Set(keys.map((key) => sanitizeFilename(key)).filter(Boolean)));
}

function sessionOwnerItem(item) {
  if (!item) return null;
  try {
    if (item.isRegularItem?.()) return item;
  } catch (_err) {
    // Fall back to parent lookup below.
  }
  const parentID = Number(item.parentItemID || item.parentID || item.getSource?.() || 0);
  if (!parentID) return null;
  try {
    return Zotero.Items.get(parentID) || null;
  } catch (_err) {
    return null;
  }
}

function sessionDirForKey(outputDir, key) {
  return PathUtils.join(outputDir || "", "sessions", sanitizeFilename(key || "unknown"));
}

function sessionIndexPath(outputDir) {
  return PathUtils.join(outputDir || "", "sessions", "session-index.json");
}

function sessionDirForItem(outputDir, item) {
  return sessionDirForKey(outputDir, sessionScopeKey(item));
}

function sessionDirsForItem(outputDir, item) {
  return sessionIdentityKeys(item).map((key) => sessionDirForKey(outputDir, key));
}

function sessionMarkdownPath(outputDir, item, sessionId) {
  const safeKey = sessionScopeKey(item);
  const safeId = sanitizeFilename(sessionId || newSessionId());
  return PathUtils.join(outputDir || "", "sessions", safeKey, `${safeId}.md`);
}

async function readSessionIndex(outputDir) {
  if (!outputDir) return { version: 1, items: {} };
  const parsed = safeParseJSON(await readTextIfExists(sessionIndexPath(outputDir)));
  const items = parsed?.items && typeof parsed.items === "object" && !Array.isArray(parsed.items)
    ? parsed.items
    : {};
  return {
    version: 1,
    updatedAt: parsed?.updatedAt || "",
    items
  };
}

async function writeSessionIndex(outputDir, index) {
  if (!outputDir) return;
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: index?.items && typeof index.items === "object" && !Array.isArray(index.items) ? index.items : {}
  };
  await writeTextAtomic(sessionIndexPath(outputDir), JSON.stringify(next, null, 2));
}

async function updateSessionIndexForItem(item, outputDir, entry) {
  if (!item?.key || !outputDir || !entry?.sessionId) return;
  const index = await readSessionIndex(outputDir);
  const scopeKey = sessionScopeKey(item);
  const sourceItemKey = item?.key || "";
  const record = {
    itemKey: scopeKey,
    sourceItemKey,
    sessionId: normalizeSessionId(entry.sessionId),
    path: String(entry.path || ""),
    markdownPath: String(entry.markdownPath || ""),
    updatedAt: new Date().toISOString()
  };
  for (const key of sessionIdentityKeys(item)) {
    index.items[key] = { ...record, lookupKey: key };
  }
  await writeSessionIndex(outputDir, index);
}

async function indexedSessionForItem(item, outputDir) {
  const paths = await indexedSessionPathsForItem(item, outputDir);
  return paths[0] ? sessionFileDescriptor(paths[0]) : null;
}

async function indexedSessionPathsForItem(item, outputDir) {
  if (!item?.key || !outputDir) return [];
  const index = await readSessionIndex(outputDir);
  const paths = [];
  const seen = new Set();
  for (const key of sessionIdentityKeys(item)) {
    const record = index.items?.[key];
    if (!record) continue;
    const candidates = [
      String(record.path || ""),
      String(record.markdownPath || "")
    ].filter(Boolean);
    if (record.sessionId) {
      candidates.push(PathUtils.join(sessionDirForKey(outputDir, key), sessionFilenameFor(record.sessionId)));
      candidates.push(PathUtils.join(sessionDirForKey(outputDir, key), `${sanitizeFilename(record.sessionId)}.md`));
    }
    for (const path of candidates) {
      if (!sessionIdFromPath(path) || seen.has(path)) continue;
      seen.add(path);
      if (await pathExists(path)) {
        paths.push(path);
        break;
      }
    }
  }
  return paths;
}

function providerDiagnosticsMarkdownPath(outputDir, profile) {
  const profileId = sanitizeFilename(profile?.id || profile?.name || "profile");
  return PathUtils.join(outputDir || "", "diagnostics", `provider-${profileId}.md`);
}

function renderSessionAsMarkdown(messages, t, compactionSummary) {
  const lines = [];
  lines.push("---");
  lines.push("source: zotero-markdown-summary workbench");
  lines.push(`renderedAt: ${new Date().toISOString()}`);
  if (compactionSummary) {
    lines.push("compactionSummary: true");
  }
  lines.push("---", "", "# Chat session", "");
  if (compactionSummary) {
    lines.push("## Earlier conversation summary", "", compactionSummary, "");
  }
  for (const message of messages || []) {
    const role = message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const header = role === "user" ? "**You**" : "**Assistant**";
    const text = visibleMessageText(message);
    if (!text) continue;
    lines.push(`### ${header}`, "", text, "");
    const usageText = role === "assistant" ? providerUsageText(message?.usage) : "";
    if (usageText) lines.push(`_Usage: ${usageText}_`, "");
  }
  return lines.join("\n");
}

function sessionMessagesFromText(path, text) {
  const value = String(text || "");
  if (String(path || "").toLowerCase().endsWith(".md")) return messagesFromSessionMarkdown(value);
  return value.split(/\r?\n/).filter(Boolean)
    .map((line) => safeParseJSON(line))
    .filter(Boolean);
}

function messagesFromSessionMarkdown(markdown) {
  const body = String(markdown || "").replace(/^---[\s\S]*?---\s*/m, "");
  const messages = [];
  const pattern = /^###\s+\*\*(You|Assistant)\*\*\s*$/gmi;
  const matches = Array.from(body.matchAll(pattern));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const raw = body.slice(match.index + match[0].length, next ? next.index : body.length);
    const content = raw
      .replace(/^\s+|\s+$/g, "")
      .replace(/\n_Usage:[^\n]+_\s*$/i, "")
      .trim();
    if (!content) continue;
    messages.push(makeMessage(match[1].toLowerCase() === "you" ? "user" : "assistant", content));
  }
  return messages;
}

async function latestSessionForItem(item, outputDir) {
  if (!item?.key) return null;
  const indexed = outputDir ? await indexedSessionForItem(item, outputDir) : null;
  if (indexed) return indexed;
  const files = outputDir ? await sessionFilesForItem(item, outputDir) : [];
  if (files.length) return sessionFileDescriptor(files[files.length - 1]);
  return latestLinkedChatSessionForItem(item);
}

async function sessionFilesForItem(item, outputDir) {
  if (!item?.key || !outputDir) return [];
  const files = [];
  const seen = new Set();
  const outputDirs = [outputDir, ...await legacyOutputDirsForSessionLookup(outputDir)];
  for (const baseDir of outputDirs) {
    for (const dir of sessionDirsForItem(baseDir, item)) {
    if (!dir || seen.has(`dir:${dir}`)) continue;
    seen.add(`dir:${dir}`);
    if (!await pathExists(dir)) continue;
    try {
      for (const path of await IOUtils.getChildren(dir)) {
        if (seen.has(path)) continue;
        seen.add(path);
        files.push(path);
      }
    } catch (_err) {
      // Keep listing other legacy/current session directories.
    }
    }
  }
  for (const path of await indexedSessionPathsForItem(item, outputDir)) {
    if (seen.has(path)) continue;
    seen.add(path);
    files.push(path);
  }
  for (const path of await linkedChatSessionPathsForItem(item)) {
    if (seen.has(path)) continue;
    seen.add(path);
    files.push(path);
  }
  return recentSessionFiles(files);
}

async function legacyOutputDirsForSessionLookup(outputDir) {
  const current = normalizedFilesystemPath(outputDir);
  const dirs = [];
  const seen = new Set([current].filter(Boolean));
  const add = (path) => {
    const normalized = normalizedFilesystemPath(path);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    dirs.push(path);
  };
  const home = homeDirectory();
  if (!home || !PathUtils?.join) return dirs;
  const cloudStorage = PathUtils.join(home, "Library", "CloudStorage");
  try {
    if (await pathExists(cloudStorage)) {
      for (const path of await IOUtils.getChildren(cloudStorage)) {
        const name = leafName(path);
        if (/^OneDrive(?:-|$)/i.test(name)) {
          add(PathUtils.join(path, "Zotero_PDFs", "Zotero_MD_Summaries"));
        }
      }
    }
  } catch (_err) {
    // Fall back to common OneDrive folder names below.
  }
  for (const name of ["OneDrive-个人", "OneDrive-Personal", "OneDrive"]) {
    add(PathUtils.join(cloudStorage, name, "Zotero_PDFs", "Zotero_MD_Summaries"));
  }
  return dirs;
}

function normalizedFilesystemPath(path) {
  return String(path || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function renderEmptySessionList(element, message) {
  const note = document.createElement("div");
  note.className = "zms-session-empty";
  note.textContent = message;
  element.appendChild(note);
}

async function latestLinkedChatSessionForItem(item) {
  const paths = await linkedChatSessionPathsForItem(item);
  if (!paths.length) return null;
  const sorted = paths.slice().sort(compareSessionPath);
  const recent = recentSessionFiles(sorted);
  const path = recent.length ? recent[recent.length - 1] : sorted[sorted.length - 1];
  return path ? sessionFileDescriptor(path) : null;
}

function sessionFileDescriptor(path) {
  return {
    path,
    sessionId: sessionIdFromPath(path),
    source: String(path || "").toLowerCase().endsWith(".md") ? "markdown" : "jsonl"
  };
}

async function linkedChatSessionPathsForItem(item) {
  const owner = sessionOwnerItem(item) || item;
  const items = Array.from(new Set([owner, item].filter(Boolean)));
  const prefixes = sessionIdentityKeys(item).map(chatAttachmentTitlePrefix);
  const paths = [];
  const seen = new Set();
  for (const sourceItem of items) {
    const attachmentIDs = typeof sourceItem?.getAttachments === "function" ? sourceItem.getAttachments() : [];
    for (const id of attachmentIDs) {
      const attachment = Zotero.Items.get(id);
      if (!attachment) continue;
      const title = attachment.getField?.("title") || attachment.title || "";
      if (!prefixes.some((prefix) => title.startsWith(prefix))) continue;
      const mdPath = await attachment.getFilePathAsync?.().catch(() => "") || attachment.attachmentPath || "";
      if (!mdPath || !mdPath.toLowerCase().endsWith(".md")) continue;
      const jsonlPath = mdPath.replace(/\.md$/i, ".jsonl");
      const path = await pathExists(jsonlPath) ? jsonlPath : mdPath;
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

async function summarizeMessagesWithLlm(messages, profile, t, setStatus) {
  const history = (messages || [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && visibleMessageText(message))
    .slice(-COMPACT_HISTORY_LIMIT);
  if (!history.length) return "";
  const transcript = history.map((message) => `${message.role === "user" ? "USER" : "ASSISTANT"}: ${visibleMessageText(message).slice(0, 2000)}`).join("\n\n");
  const instruction = t("compactPrompt") || "Summarize the conversation above in 6-10 concise bullet points, keeping any concrete facts, decisions, open questions, and conclusions. Reply in the same language as the conversation.";
  if (setStatus) setStatus(t("compacting"));
  try {
    assertRemoteProfileReady(profile, (key) => t(key));
    const requestMessages = [
      { role: "system", content: instruction },
      { role: "user", content: transcript }
    ];
    const response = await requestModelWithRetry(
      profile,
      requestMessages,
      t("outputLanguage") === "zh-CN" ? "zh-CN" : "en-US",
      instruction,
      null,
      false,
      null
    );
    if (!response.ok) {
      throw new Error(providerErrorText(response.status, await response.text()));
    }
    const data = await response.json();
    return String(extractResponseText(profile.protocol, data) || "").trim();
  } catch (_err) {
    // Last-resort fallback so the user can still manually trigger later.
    return history.map((message) => visibleMessageText(message)).filter(Boolean).join("\n").slice(0, 1500);
  }
}

function isInteractiveWorkbenchTarget(target) {
  const tagName = String(target?.tagName || target?.localName || "").toLowerCase();
  if (["a", "button", "input", "textarea", "select", "option", "summary", "label"].includes(tagName)) return true;
  const role = String(target?.getAttribute?.("role") || "").toLowerCase();
  return ["button", "link", "textbox", "combobox", "checkbox", "menuitem"].includes(role);
}

const COMPACT_TRIGGER_MESSAGES = 16;
const COMPACT_HISTORY_LIMIT = 12;
const COMPACT_AUTO_DELAY_MS = 30000;

async function linkOrCreateChatAttachment(item, itemKey, mdPath, sessionId) {
  if (!item || !itemKey || !mdPath) return null;
  const prefix = chatAttachmentTitlePrefix(itemKey);
  const title = `${prefix} ${sanitizeFilename(String(sessionId || "chat"))}.md`;
  const attachmentIDs = typeof item.getAttachments === "function" ? item.getAttachments() : [];
  let existing = null;
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    if (!attachment) continue;
    const atitle = attachment.getField("title") || "";
    if (atitle.startsWith(prefix) && atitle === title) {
      existing = attachment;
      break;
    }
  }
  if (existing) {
    existing.attachmentPath = mdPath;
    existing.attachmentContentType = existing.attachmentContentType || "text/markdown";
    if (typeof existing.saveTx === "function") await existing.saveTx();
    return existing;
  }
  const payload = { file: mdPath, contentType: "text/markdown", title };
  if (item.isRegularItem?.()) payload.parentItemID = item.id;
  else if (item.libraryID) payload.libraryID = item.libraryID;
  return Zotero.Attachments.linkFromFile(payload);
}

function chatAttachmentTitlePrefix(itemKey) {
  return `Markdown Chat - ${sanitizeFilename(itemKey)}`;
}

function recentSessionFiles(paths, limit = 50) {
  return dedupeSessionPaths(paths || [])
    .sort(compareSessionPath)
    .slice(-Math.max(1, limit));
}

function dedupeSessionPaths(paths) {
  const byId = new Map();
  for (const path of paths || []) {
    const id = sessionIdFromPath(path);
    if (!id) continue;
    const previous = byId.get(id);
    if (!previous || preferSessionPath(path, previous)) byId.set(id, path);
  }
  return Array.from(byId.values());
}

function preferSessionPath(candidate, current) {
  const candidateLower = String(candidate || "").toLowerCase();
  const currentLower = String(current || "").toLowerCase();
  if (candidateLower.endsWith(".jsonl") && !currentLower.endsWith(".jsonl")) return true;
  return false;
}

function compareSessionPath(left, right) {
  const leftId = sessionIdFromPath(left);
  const rightId = sessionIdFromPath(right);
  const leftStarted = sessionStartedAtFromId(leftId);
  const rightStarted = sessionStartedAtFromId(rightId);
  if (leftStarted !== rightStarted) return leftStarted - rightStarted;
  const idOrder = leftId.localeCompare(rightId);
  if (idOrder) return idOrder;
  return String(left).localeCompare(String(right));
}

function candidateJsonlPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "sources", "candidates.jsonl");
}

function importLedgerJsonlPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "sources", "import-ledger.jsonl");
}

function candidateReviewMarkdownPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", "candidate-review.md");
}

function readingLogMarkdownPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "paper");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `reading-log-${itemKey}.md`);
}

function comparisonReportMarkdownPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "focus");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `literature-matrix-${itemKey}.md`);
}

function visualExtractionReportMarkdownPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "paper");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `visual-extraction-${itemKey}.md`);
}

function visualExtractionReportJsonPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "paper");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `visual-extraction-${itemKey}.json`);
}

function visualExtractionReportCsvPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "paper");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `visual-extraction-${itemKey}.csv`);
}

function reviewDraftMarkdownPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "focus");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `review-draft-${itemKey}.md`);
}

function proposalNoteMarkdownPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "paper");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `proposal-note-${itemKey}.md`);
}

function journalOutlineMarkdownPath(outputDir, item) {
  const collectionKey = workbenchCollectionKey(item);
  const itemKey = sanitizeFilename(item?.key || "focus");
  return PathUtils.join(outputDir || "", "collections", sanitizeFilename(collectionKey), "writing", `journal-outline-${itemKey}.md`);
}

function candidateSearchOptionsFromDom(item) {
  const query = document.getElementById("zms-candidate-query")?.value?.trim() || item?.getField?.("title") || item?.key || "";
  const limit = clampNumber(document.getElementById("zms-candidate-limit")?.value, 1, 50, 10);
  return {
    query,
    limit,
    email: document.getElementById("zms-candidate-email")?.value?.trim() || "",
    semanticScholarApiKey: document.getElementById("zms-candidate-semantic-key")?.value?.trim() || "",
    openAccessOnly: true
  };
}

function citationNetworkOptionsFromDom() {
  const policy = normalizeCitationNetworkPolicy(document.getElementById("zms-citation-policy")?.value);
  const defaults = citationNetworkPolicyDefaults(policy);
  const seedLimit = clampNumber(document.getElementById("zms-citation-seed-limit")?.value, 1, 20, defaults.seedLimit);
  return {
    policy,
    directions: citationNetworkDirectionsFromValue(document.getElementById("zms-citation-direction")?.value),
    maxHops: clampNumber(document.getElementById("zms-citation-hops")?.value, 1, 3, defaults.maxHops),
    maxNetworkRequests: clampNumber(document.getElementById("zms-citation-max-requests")?.value, 1, 100, defaults.maxNetworkRequests),
    perSeedLimit: clampNumber(document.getElementById("zms-citation-per-seed")?.value, 1, 100, defaults.perSeedLimit),
    seedLimit,
    nextHopSeedLimit: seedLimit
  };
}

function applyCitationNetworkPolicyToDom(policyValue) {
  const defaults = citationNetworkPolicyDefaults(policyValue);
  setNumberInputValue("zms-citation-hops", defaults.maxHops);
  setNumberInputValue("zms-citation-max-requests", defaults.maxNetworkRequests);
  setNumberInputValue("zms-citation-per-seed", defaults.perSeedLimit);
  setNumberInputValue("zms-citation-seed-limit", defaults.seedLimit);
}

function setNumberInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = String(value);
}

function normalizeCitationNetworkPolicy(value) {
  return value === "precise" || value === "broad" ? value : "balanced";
}

function citationNetworkPolicyDefaults(policyValue) {
  const policy = normalizeCitationNetworkPolicy(policyValue);
  if (policy === "precise") {
    return { maxHops: 1, maxNetworkRequests: 6, perSeedLimit: 3, seedLimit: 3 };
  }
  if (policy === "broad") {
    return { maxHops: 3, maxNetworkRequests: 24, perSeedLimit: 8, seedLimit: 8 };
  }
  return { maxHops: 2, maxNetworkRequests: 12, perSeedLimit: 4, seedLimit: 4 };
}

function citationNetworkDirectionsFromValue(value) {
  if (value === "references") return ["references"];
  if (value === "citations") return ["citations"];
  return ["references", "citations"];
}

function citationNetworkSeedsForWorkbench(records, item, limit = 4) {
  const seeds = [];
  const seen = new Set();
  const pushSeed = (seed) => {
    const key = citationNetworkSeedKey(seed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    seeds.push(seed);
  };
  pushSeed(citationNetworkSeedFromItem(item));
  for (const record of citationNetworkSeedRecords(records)) {
    if (seeds.length >= limit) break;
    pushSeed(citationNetworkSeedFromRecord(record));
  }
  return seeds.slice(0, Math.max(1, limit));
}

function citationNetworkSeedRecords(records) {
  return [...(records || [])]
    .filter((record) => record?.quality?.dedupeStatus !== "duplicate")
    .filter((record) => {
      const decision = normalizeCandidateDecision(record.decision);
      const tier = record?.priority?.tier;
      return decision === "include" || decision === "to_read" || tier === "high" || tier === "medium";
    });
}

function citationNetworkSeedFromItem(item) {
  if (!item) return null;
  const extra = item.getField?.("extra") || "";
  return {
    candidateId: item.key,
    title: item.getField?.("title") || item.getDisplayTitle?.() || item.key,
    doi: item.getField?.("DOI") || doiFromText(extra),
    arxivId: arxivIdFromText(extra) || arxivIdFromText(item.getField?.("url")),
    url: item.getField?.("url") || ""
  };
}

function citationNetworkSeedFromRecord(record) {
  return {
    candidateId: record.candidateId,
    title: record.title,
    doi: record.ids?.doi,
    arxivId: record.ids?.arxivId,
    semanticScholarId: record.ids?.semanticScholarId || record.sourceIds?.semantic_scholar,
    url: record.sourceUrl || record.pdfUrl
  };
}

function citationNetworkSeedKey(seed) {
  if (!seed) return "";
  if (seed.semanticScholarId) return `s2:${seed.semanticScholarId}`;
  const doi = normalizeCandidateDoi(seed.doi || (String(seed.candidateId || "").startsWith("doi:") ? String(seed.candidateId).slice(4) : ""));
  if (doi) return `doi:${doi}`;
  const arxivId = normalizeCandidateArxivId(seed.arxivId || (String(seed.candidateId || "").startsWith("arxiv:") ? String(seed.candidateId).slice(6) : ""));
  if (arxivId) return `arxiv:${arxivId}`;
  const url = String(seed.url || "").trim();
  if (url) return `url:${url}`;
  const candidateId = String(seed.candidateId || "").trim();
  return candidateId && !candidateId.startsWith("title:") ? `id:${candidateId}` : "";
}

function doiFromText(value) {
  const match = String(value || "").match(/(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\S+)/i);
  return normalizeCandidateDoi(match?.[1] || "");
}

function arxivIdFromText(value) {
  const text = String(value || "");
  const match = text.match(/(?:arxiv:\s*|arxiv\.org\/(?:abs|pdf)\/)([a-z-]*\/?\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)/i);
  return normalizeCandidateArxivId(match?.[1] || "");
}

function candidateSearchErrorSummary(errors, translate = (key) => key) {
  if (!errors?.length) return "";
  return `${translate("candidateSourceErrors")}: ${errors.map((item) => `${item.source}: ${item.error}`).join("; ")}`;
}

function workbenchCollectionKey(item) {
  const collectionIDs = typeof item?.getCollections === "function" ? item.getCollections() : [];
  for (const id of collectionIDs || []) {
    const collection = Zotero.Collections?.get?.(id);
    if (collection?.key) return collection.key;
  }
  return item?.key || "unfiled";
}

async function loadCandidateRecords(path) {
  if (!path || !await IOUtils.exists(path)) throw new Error(path || "candidates.jsonl");
  return parseCandidateJsonl(await readText(path));
}

async function saveCandidateRecords(path, records) {
  if (!path) throw new Error("candidates.jsonl path is missing");
  const tempPath = `${path}.${Date.now()}.tmp`;
  await writeTextAtomic(path, renderCandidateJsonl(records), tempPath);
}

async function appendImportLedgerEntries(path, entries) {
  if (!path || !entries?.length) return;
  const existing = await readTextIfExists(path);
  const next = `${existing ? `${existing.replace(/\s*$/, "")}\n` : ""}${renderImportLedgerJsonl(entries)}`;
  await writeTextAtomic(path, next, `${path}.${Date.now()}.tmp`);
}

async function loadPreviousVisualExtractionChartReviewActions(path) {
  const data = await loadVisualExtractionReportData(path);
  return Array.isArray(data?.chartReviewActions) ? data.chartReviewActions : [];
}

async function loadVisualExtractionReportData(path) {
  const text = await readTextIfExists(path);
  if (!text.trim()) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch (_err) {
    return null;
  }
}

async function readTextIfExists(path) {
  try {
    if (!path || !await IOUtils.exists(path)) return "";
    return await readText(path);
  } catch (_err) {
    return "";
  }
}

function parseCandidateJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid candidates.jsonl line ${index + 1}: ${err?.message || err}`);
      }
    })
    .filter(isCandidateRecord);
}

function renderCandidateJsonl(records) {
  if (!Array.isArray(records) || !records.length) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function renderImportLedgerJsonl(entries) {
  if (!Array.isArray(entries) || !entries.length) return "";
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function isCandidateRecord(value) {
  return !!value
    && typeof value.candidateId === "string"
    && typeof value.title === "string"
    && typeof value.decision === "string";
}

function candidateStatusText(records, path, translate = (key) => key) {
  const t = typeof translate === "function" ? translate : (key) => key;
  if (!records.length) return [t("candidateEmpty"), path].filter(Boolean).join("\n");
  const counts = candidateDecisionCounts(records);
  const summary = [
    `${records.length}`,
    `${t("candidateInclude")}: ${counts.include}`,
    `${t("candidateExclude")}: ${counts.exclude}`,
    `${t("candidateToRead")}: ${counts.to_read}`,
    `${t("candidatePending")}: ${counts.user_pending}`
  ].join(" | ");
  return [summary, path].filter(Boolean).join("\n");
}

function renderCandidateReviewMarkdown(records, options = {}) {
  const candidates = [...(records || [])];
  const labels = candidateReviewLabels(options.outputLanguage);
  const counts = candidateDecisionCounts(candidates);
  const tierCounts = candidatePriorityTierCounts(candidates);
  const collectionKey = workbenchCollectionKey(options.item);
  const title = options.item?.getField?.("title") || options.item?.getDisplayTitle?.() || options.item?.key || collectionKey;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const lines = [
    "---",
    "templateVersion: candidate-review-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `candidateCount: ${candidates.length}`,
    `candidateJsonl: ${yamlScalar(options.candidatePath || "")}`,
    `importLedger: ${yamlScalar(options.ledgerPath || "")}`,
    "---",
    "",
    `# ${labels.title}`,
    "",
    `- ${labels.paper}: ${mdText(title)}`,
    `- ${labels.collection}: ${mdText(collectionKey)}`,
    `- ${labels.generatedAt}: ${generatedAt}`,
    `- ${labels.sourceFile}: ${mdText(options.candidatePath || "")}`,
    `- ${labels.reviewFile}: ${mdText(options.reviewPath || "")}`,
    "",
    `## ${labels.summary}`,
    "",
    `- ${labels.total}: ${candidates.length}`,
    `- ${labels.include}: ${counts.include || 0}`,
    `- ${labels.toRead}: ${counts.to_read || 0}`,
    `- ${labels.pending}: ${counts.user_pending || 0}`,
    `- ${labels.exclude}: ${counts.exclude || 0}`,
    `- ${labels.high}: ${tierCounts.high || 0}`,
    `- ${labels.medium}: ${tierCounts.medium || 0}`,
    `- ${labels.low}: ${tierCounts.low || 0}`,
    `- ${labels.duplicate}: ${tierCounts.duplicate || 0}`,
    "",
    `## ${labels.screeningBoard}`,
    "",
    ...candidateReviewScreeningBoard(candidates, labels),
    "",
    `## ${labels.evidenceChain}`,
    "",
    ...candidateReviewEvidenceChainQueue(candidates, labels),
    "",
    `## ${labels.sourceEvidence}`,
    "",
    ...candidateReviewSourceEvidenceSnippets(candidates, labels),
    "",
    `## ${labels.checklist}`,
    "",
    `- [ ] ${labels.checkIdentifiers}`,
    `- [ ] ${labels.checkFullText}`,
    `- [ ] ${labels.checkDuplicates}`,
    `- [ ] ${labels.checkRelevance}`,
    `- [ ] ${labels.checkImport}`,
    "",
    `## ${labels.screeningProtocol}`,
    "",
    `- ${labels.inclusionCriteria}: ${labels.inclusionCriteriaText}`,
    `- ${labels.exclusionCriteria}: ${labels.exclusionCriteriaText}`,
    `- ${labels.decisionRules}: ${labels.decisionRulesText}`,
    "",
    `## ${labels.actionQueue}`,
    "",
    ...candidateReviewActionQueue(candidates, labels),
    "",
    `## ${labels.queue}`,
    ""
  ];
  for (const group of candidateReviewGroups(candidates)) {
    if (!group.records.length) continue;
    lines.push(`### ${labels[group.labelKey] || group.labelKey}`, "");
    group.records.forEach((record, index) => {
      lines.push(...candidateReviewRecordLines(record, index + 1, labels), "");
    });
  }
  lines.push(`## ${labels.notes}`, "", `- ${labels.notesPlaceholder}`, "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function candidateReviewGroups(records) {
  return [
    { labelKey: "include", records: candidateReviewGroupRecords(records, (record) => normalizeCandidateDecision(record.decision) === "include" && record.quality?.dedupeStatus !== "duplicate") },
    { labelKey: "toRead", records: candidateReviewGroupRecords(records, (record) => normalizeCandidateDecision(record.decision) === "to_read" && record.quality?.dedupeStatus !== "duplicate") },
    { labelKey: "pending", records: candidateReviewGroupRecords(records, (record) => normalizeCandidateDecision(record.decision) === "user_pending" && record.quality?.dedupeStatus !== "duplicate") },
    { labelKey: "exclude", records: candidateReviewGroupRecords(records, (record) => normalizeCandidateDecision(record.decision) === "exclude" && record.quality?.dedupeStatus !== "duplicate") },
    { labelKey: "duplicate", records: candidateReviewGroupRecords(records, (record) => record.quality?.dedupeStatus === "duplicate" || record.priority?.tier === "duplicate") }
  ];
}

function candidateReviewGroupRecords(records, predicate) {
  return (records || [])
    .filter(predicate)
    .sort((left, right) => (right.priority?.score || 0) - (left.priority?.score || 0) || Number(right.year || 0) - Number(left.year || 0));
}

function candidateReviewActionQueue(records, labels) {
  const rows = candidateReviewActionRows(records, labels);
  if (!rows.length) return [`- ${labels.noImmediateActions}`];
  return [
    `| ${labels.paperColumn} | ${labels.decision} | ${labels.recommended} | ${labels.priority} | ${labels.nextAction} |`,
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${mdTableCell(row.title)} | ${mdTableCell(row.decision)} | ${mdTableCell(row.recommended)} | ${mdTableCell(row.priority)} | ${mdTableCell(row.action)} |`)
  ];
}

function candidateReviewActionRows(records, labels) {
  return candidateReviewGroupRecords(records, candidateNeedsReviewAction)
    .slice(0, 20)
    .map((record) => {
      const title = `${record.title || record.candidateId}${record.year ? ` (${record.year})` : ""}`;
      return {
        title,
        decision: candidateDecisionLabel(record.decision, candidateReviewDecisionLabel(labels)),
        recommended: record.priority?.recommendedDecision
          ? candidateDecisionLabel(record.priority.recommendedDecision, candidateReviewDecisionLabel(labels))
          : labels.noRecommendation,
        priority: candidateReviewPriorityText(record, labels),
        action: candidateReviewNextAction(record, labels)
      };
    });
}

function candidateReviewScreeningBoard(records, labels) {
  const rows = candidateReviewScreeningRows(records, labels);
  return [
    `| ${labels.boardMetric} | ${labels.boardCount} | ${labels.boardAction} |`,
    "| --- | ---: | --- |",
    ...rows.map((row) => `| ${mdTableCell(row.metric)} | ${row.count} | ${mdTableCell(row.action)} |`)
  ];
}

function candidateReviewScreeningRows(records, labels) {
  const candidates = records || [];
  const recommendedMismatch = candidates.filter(candidateRecommendationMismatch).length;
  const highPending = candidates.filter((record) => normalizeCandidateDecision(record.decision) === "user_pending" && record?.priority?.tier === "high").length;
  const mediumPending = candidates.filter((record) => normalizeCandidateDecision(record.decision) === "user_pending" && record?.priority?.tier === "medium").length;
  const duplicateCount = candidates.filter((record) => record?.quality?.dedupeStatus === "duplicate" || record?.priority?.tier === "duplicate").length;
  const readyToImport = importableCandidateRecords(candidates).length;
  const includedMissingPdf = candidates.filter((record) => normalizeCandidateDecision(record.decision) === "include"
    && record?.quality?.dedupeStatus !== "duplicate"
    && record?.quality?.isAbstractOnly !== true
    && !record?.pdfUrl
    && record?.pdfAttachmentStatus !== "attached_pdf").length;
  const importIssues = candidates.filter((record) => record?.importStatus && !["imported", "skipped_duplicate"].includes(record.importStatus)).length;
  const pdfAttached = candidates.filter((record) => record?.pdfAttachmentStatus === "attached_pdf").length;
  const abstractOnly = candidates.filter((record) => record?.quality?.isAbstractOnly === true).length;
  return [
    { metric: labels.boardHighPending, count: highPending, action: labels.boardHighPendingAction },
    { metric: labels.boardMediumPending, count: mediumPending, action: labels.boardMediumPendingAction },
    { metric: labels.boardRecommendationMismatch, count: recommendedMismatch, action: labels.boardRecommendationMismatchAction },
    { metric: labels.boardDuplicates, count: duplicateCount, action: labels.boardDuplicatesAction },
    { metric: labels.boardReadyToImport, count: readyToImport, action: labels.boardReadyToImportAction },
    { metric: labels.boardIncludedMissingPdf, count: includedMissingPdf, action: labels.boardIncludedMissingPdfAction },
    { metric: labels.boardImportIssues, count: importIssues, action: labels.boardImportIssuesAction },
    { metric: labels.boardPdfAttached, count: pdfAttached, action: labels.boardPdfAttachedAction },
    { metric: labels.boardAbstractOnly, count: abstractOnly, action: labels.boardAbstractOnlyAction }
  ];
}

function candidateReviewEvidenceChainQueue(records, labels) {
  const rows = candidateReviewEvidenceRows(records, labels);
  if (!rows.length) return [`- ${labels.evidenceNoFollowUp}`];
  return [
    `| ${labels.paperColumn} | ${labels.evidenceColumnState} | ${labels.evidenceColumnGap} | ${labels.evidenceColumnCheck} | ${labels.evidenceColumnSource} |`,
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${mdTableCell(row.title)} | ${mdTableCell(row.state)} | ${mdTableCell(row.gap)} | ${mdTableCell(row.check)} | ${mdTableCell(row.source)} |`)
  ];
}

function candidateReviewEvidenceRows(records, labels) {
  return candidateReviewGroupRecords(records, candidateNeedsEvidenceFollowUp)
    .slice(0, 20)
    .map((record) => ({
      title: `${record.title || record.candidateId}${record.year ? ` (${record.year})` : ""}`,
      state: candidateReviewEvidenceState(record, labels),
      gap: candidateReviewEvidenceGap(record, labels),
      check: candidateReviewEvidenceCheck(record, labels),
      source: candidateReviewEvidenceSource(record, labels)
    }));
}

function candidateNeedsEvidenceFollowUp(record) {
  return !!candidateReviewEvidenceGap(record, candidateReviewLabels("en-US"));
}

function candidateReviewEvidenceState(record, labels) {
  const stage = candidateReviewScreeningStage(record);
  if (stage === "full_text_screened") return labels.evidenceStateFullTextScreened;
  if (stage === "full_text_needed") return labels.evidenceStateFullTextNeeded;
  if (record?.quality?.isAbstractOnly === true) return labels.evidenceStateAbstractOnly;
  if (stage === "abstract_screened") return labels.evidenceStateAbstractScreened;
  if (candidateHasFullText(record)) return labels.evidenceStatePdfAvailable;
  return labels.evidenceStateSourceOnly;
}

function candidateReviewEvidenceGap(record, labels) {
  if (record?.quality?.dedupeStatus === "duplicate" || record?.priority?.tier === "duplicate") return "";
  const decision = normalizeCandidateDecision(record?.decision);
  const stage = candidateReviewScreeningStage(record);
  if (decision === "exclude" && !candidateReviewExclusionReason(record)) return labels.evidenceGapMissingExclusionReason;
  if (decision === "include" && !candidateHasFullText(record)) return labels.evidenceGapMissingFullText;
  if (stage === "full_text_needed") return labels.evidenceGapFullTextNeeded;
  if (record?.quality?.isAbstractOnly === true) return labels.evidenceGapAbstractOnly;
  if (["include", "to_read"].includes(decision) && stage !== "full_text_screened") return labels.evidenceGapNeedFullTextScreening;
  if (record?.networkOrigins?.length && stage !== "full_text_screened") return labels.evidenceGapCitationContext;
  return "";
}

function candidateReviewEvidenceCheck(record, labels) {
  const gap = candidateReviewEvidenceGap(record, labels);
  if (gap === labels.evidenceGapMissingExclusionReason) return labels.evidenceCheckAddExclusionReason;
  if (gap === labels.evidenceGapMissingFullText || gap === labels.evidenceGapFullTextNeeded) return labels.evidenceCheckFindPdf;
  if (gap === labels.evidenceGapAbstractOnly) return labels.evidenceCheckReadAbstract;
  if (gap === labels.evidenceGapCitationContext) return labels.evidenceCheckTraceCitationContext;
  if (gap === labels.evidenceGapNeedFullTextScreening) return labels.evidenceCheckScreenFullText;
  return labels.actionNoImmediate;
}

function candidateReviewEvidenceSource(record, labels) {
  const parts = [
    record?.pdfAttachmentStatus === "attached_pdf" ? labels.evidenceSourceAttachedPdf : "",
    record?.pdfUrl ? labels.evidenceSourcePdfUrl : "",
    record?.networkOrigins?.length ? labels.evidenceSourceNetwork : "",
    record?.sources?.length ? `${labels.evidenceSourceCatalog}: ${record.sources.join(", ")}` : "",
    record?.sourceUrl ? labels.source : ""
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : labels.evidenceSourceUnknown;
}

function candidateHasFullText(record) {
  return !!record?.pdfUrl || record?.pdfAttachmentStatus === "attached_pdf";
}

function candidateReviewSourceEvidenceSnippets(records, labels) {
  const rows = candidateReviewSourceEvidenceRows(records, labels);
  if (!rows.length) return [`- ${labels.sourceEvidenceNone}`];
  return [
    `| ${labels.paperColumn} | ${labels.sourceEvidenceLabel} | ${labels.sourceEvidenceType} | ${labels.sourceEvidenceLocator} | ${labels.sourceEvidenceSnippet} | ${labels.sourceEvidenceFollowUp} |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${mdTableCell(row.title)} | ${mdTableCell(row.label)} | ${mdTableCell(row.type)} | ${mdTableCell(row.locator)} | ${mdTableCell(row.snippet)} | ${mdTableCell(row.followUp)} |`)
  ];
}

function candidateReviewSourceEvidenceRows(records, labels) {
  const rows = [];
  for (const record of candidateReviewGroupRecords(records, candidateHasSourceEvidence)) {
    rows.push(...candidateSourceEvidenceForRecord(record, labels));
    if (rows.length >= 30) break;
  }
  return rows.slice(0, 30);
}

function candidateHasSourceEvidence(record) {
  if (record?.quality?.dedupeStatus === "duplicate" || record?.priority?.tier === "duplicate") return false;
  return !!candidateReviewFullTextEvidence(record).length
    || !!candidateReviewAbstract(record)
    || !!record?.pdfUrl
    || record?.pdfAttachmentStatus === "attached_pdf"
    || !!record?.sourceUrl
    || !!record?.networkOrigins?.length
    || !!record?.ids?.doi
    || !!record?.ids?.arxivId
    || !!record?.ids?.semanticScholarId;
}

function candidateSourceEvidenceForRecord(record, labels) {
  const title = `${record.title || record.candidateId}${record.year ? ` (${record.year})` : ""}`;
  const rows = [];
  for (const evidence of candidateReviewFullTextEvidence(record)) {
    rows.push({
      title,
      label: evidence.label || candidateSourceEvidenceLabel(record, `fulltext-${evidence.topic || "snippet"}`),
      type: labels.sourceEvidenceTypeFullText,
      locator: candidateSourceEvidenceLocator(record, "fulltext", evidence),
      snippet: truncateText(candidateFullTextEvidenceDisplayText(evidence), 420),
      followUp: labels.sourceEvidenceFollowFullText
    });
  }
  const abstract = candidateReviewAbstract(record);
  if (abstract) {
    rows.push(candidateSourceEvidenceRow(record, title, "abstract", labels.sourceEvidenceTypeAbstract, truncateText(abstract, 260), labels.sourceEvidenceFollowAbstract));
  }
  if (record?.pdfUrl || record?.pdfAttachmentStatus === "attached_pdf") {
    const pdfParts = [
      record.pdfAttachmentStatus === "attached_pdf" ? labels.evidenceSourceAttachedPdf : "",
      record.pdfUrl ? record.pdfUrl : ""
    ].filter(Boolean).join("; ");
    rows.push(candidateSourceEvidenceRow(record, title, "pdf", labels.sourceEvidenceTypePdf, pdfParts, labels.sourceEvidenceFollowPdf));
  }
  if (record?.networkOrigins?.length) {
    rows.push(candidateSourceEvidenceRow(record, title, "network", labels.sourceEvidenceTypeNetwork, candidateReviewNetworkOrigins(record.networkOrigins), labels.sourceEvidenceFollowNetwork));
  }
  if (record?.sourceUrl || record?.sources?.length) {
    const sourceParts = [
      record.sources?.length ? record.sources.join(", ") : "",
      record.sourceUrl || ""
    ].filter(Boolean).join("; ");
    rows.push(candidateSourceEvidenceRow(record, title, "source", labels.sourceEvidenceTypeSource, sourceParts, labels.sourceEvidenceFollowSource));
  }
  const ids = candidateSourceEvidenceIdentifiers(record);
  if (ids) {
    rows.push(candidateSourceEvidenceRow(record, title, "identifier", labels.sourceEvidenceTypeIdentifier, ids, labels.sourceEvidenceFollowIdentifier));
  }
  return rows;
}

function candidateSourceEvidenceRow(record, title, type, typeLabel, snippet, followUp) {
  return {
    title,
    label: candidateSourceEvidenceLabel(record, type),
    type: typeLabel,
    locator: candidateSourceEvidenceLocator(record, type),
    snippet,
    followUp
  };
}

function candidateSourceEvidenceLocator(record, type, evidence = {}) {
  if (type === "fulltext") {
    const parts = [
      evidence.locator || "",
      evidence.sourceHash ? `hash:${evidence.sourceHash}` : "",
      evidence.attachmentKey || record?.pdfAttachmentKey ? `attachment:${evidence.attachmentKey || record?.pdfAttachmentKey}` : ""
    ].filter(Boolean);
    return parts.join("; ") || "indexed-text";
  }
  if (type === "abstract") return "abstract";
  if (type === "pdf") {
    if (record?.pdfAttachmentStatus === "attached_pdf") return record?.pdfAttachmentKey ? `attachment:${record.pdfAttachmentKey}` : "attached-pdf";
    return record?.pdfUrl ? "pdf-url" : "pdf";
  }
  if (type === "network") return "citation-network";
  if (type === "source") return record?.sourceUrl ? "source-url" : "source";
  if (type === "identifier") return "identifier";
  return type || "";
}

function candidateSourceEvidenceLabel(record, type) {
  const raw = String(record?.candidateId || record?.ids?.doi || record?.title || "candidate");
  const id = raw.toLowerCase().replace(/[\\/]+/g, ":").replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "candidate";
  return `[candidate:${id}:${type}]`;
}

function candidateReviewAbstract(record) {
  return mdText(record?.abstract || record?.abstractNote || record?.summary || "");
}

function candidateReviewFullTextEvidence(record) {
  const values = record?.review?.fullTextEvidence ?? record?.fullTextEvidence ?? [];
  const items = Array.isArray(values) ? values : [values];
  return items
    .map((item) => {
      if (typeof item === "string") return { topic: "snippet", text: mdText(item), quote: mdText(item), label: "" };
      if (!item || typeof item !== "object") return null;
      const text = mdText(item.text || item.snippet || item.value || "");
      if (!text) return null;
      return {
        topic: mdText(item.topic || "snippet").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 32) || "snippet",
        text,
        quote: mdText(item.quote || ""),
        contextBefore: mdText(item.contextBefore || item.before || ""),
        contextAfter: mdText(item.contextAfter || item.after || ""),
        label: mdText(item.label || ""),
        locator: mdText(item.locator || ""),
        sourceHash: normalizeEvidenceHash(item.sourceHash || item.hash || ""),
        attachmentKey: mdText(item.attachmentKey || ""),
        sourceType: candidateFullTextLocatorSourceType(item.sourceType || ""),
        page: candidateEvidencePage(item.page),
        pageLabel: mdText(item.pageLabel || item.annotationPageLabel || ""),
        annotationKey: mdText(item.annotationKey || ""),
        annotationType: mdText(item.annotationType || "")
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function candidateFullTextEvidenceDisplayText(evidence) {
  const quote = mdText(evidence?.quote || evidence?.text || evidence?.snippet || "");
  const before = mdText(evidence?.contextBefore || "");
  const after = mdText(evidence?.contextAfter || "");
  if (!before && !after) return quote;
  return [
    before ? `Context before: ${before}` : "",
    quote ? `Hit: ${quote}` : "",
    after ? `Context after: ${after}` : ""
  ].filter(Boolean).join(" / ");
}

async function enrichCandidatesWithFullTextEvidence(records, contextItem, now = new Date().toISOString()) {
  const enriched = [];
  for (const record of records || []) {
    enriched.push(await enrichCandidateWithFullTextEvidence(record, contextItem, now));
  }
  return enriched;
}

async function enrichCandidateWithFullTextEvidence(record, contextItem, now) {
  if (!candidateShouldEnrichFullTextEvidence(record)) return record;
  try {
    const item = await candidateImportedZoteroItem(record, contextItem);
    if (!item) return record;
    const pdf = await findPdfAttachment(item);
    const source = await candidatePdfEvidenceSource(pdf, record);
    const snippets = candidateFullTextEvidenceSnippets(source, record, pdf);
    if (!snippets.length) return record;
    return {
      ...record,
      review: {
        ...(record.review || {}),
        fullTextEvidence: snippets,
        fullTextEvidenceUpdatedAt: now
      }
    };
  } catch (_err) {
    return record;
  }
}

function candidateShouldEnrichFullTextEvidence(record) {
  if (!record || record?.quality?.dedupeStatus === "duplicate" || record?.priority?.tier === "duplicate") return false;
  if (!record.zoteroItemID && !record.zoteroItemKey) return false;
  if (record.pdfAttachmentStatus && record.pdfAttachmentStatus !== "attached_pdf") return false;
  return normalizeCandidateDecision(record.decision) !== "exclude";
}

function candidateFullTextEvidenceSnippets(text, record, pdf) {
  const indexed = indexedTextForEvidence(text);
  if (!indexed.text) return [];
  const topics = [
    { id: "method", pattern: /\b(method|methods|methodology|approach|model|algorithm|framework|propose|proposed|方法|模型|算法|框架)\b/i },
    { id: "experiment", pattern: /\b(experiment|evaluation|result|dataset|benchmark|metric|ablation|实验|结果|评估|数据集|指标|消融)\b/i },
    { id: "limitation", pattern: /\b(limitation|limitations|threat|validity|future work|weakness|局限|不足|威胁|未来)\b/i },
    { id: "contribution", pattern: /\b(contribution|contributions|finding|findings|conclusion|novel|贡献|发现|结论|创新)\b/i }
  ];
  const rows = [];
  const used = new Set();
  for (const topic of topics) {
    const hit = candidateSnippetForPattern(indexed, topic.pattern, used, topic.id);
    if (!hit) continue;
    const annotation = candidatePdfAnnotationForHit(pdf, hit);
    const locatedHit = {
      ...hit,
      pageLabel: annotation?.pageLabel || hit.pageLabel || "",
      annotationKey: annotation?.key || "",
      annotationType: annotation?.type || ""
    };
    rows.push({
      topic: topic.id,
      label: candidateSourceEvidenceLabel(record, `fulltext-${topic.id}`),
      text: hit.text,
      quote: hit.quote,
      contextBefore: hit.contextBefore,
      contextAfter: hit.contextAfter,
      locator: candidateFullTextLocator(locatedHit),
      sourceHash: hit.sourceHash,
      attachmentKey: pdf?.key || record.pdfAttachmentKey || "",
      sourceType: locatedHit.sourceType || "indexed-text",
      page: hit.page,
      pageLabel: locatedHit.pageLabel,
      annotationKey: locatedHit.annotationKey,
      annotationType: locatedHit.annotationType
    });
  }
  if (!rows.length) {
    const fallback = truncateText(indexed.text, 320);
    if (fallback) {
      const hit = {
        text: fallback,
        quote: fallback,
        contextBefore: "",
        contextAfter: "",
        start: 0,
        end: Math.min(indexed.text.length, fallback.length),
        page: indexed.pages[0]?.page,
        pageLabel: indexed.pages[0]?.pageLabel || "",
        pageStart: 0,
        pageEnd: Math.min(indexed.pages[0]?.text?.length || fallback.length, fallback.length),
        sourceType: indexed.sourceType,
        sourceHash: shortEvidenceHash(fallback)
      };
      const annotation = candidatePdfAnnotationForHit(pdf, hit);
      const locatedHit = {
        ...hit,
        pageLabel: annotation?.pageLabel || hit.pageLabel || "",
        annotationKey: annotation?.key || "",
        annotationType: annotation?.type || ""
      };
      rows.push({
        topic: "snippet",
        label: candidateSourceEvidenceLabel(record, "fulltext-snippet"),
        text: hit.text,
        quote: hit.quote,
        contextBefore: hit.contextBefore,
        contextAfter: hit.contextAfter,
        locator: candidateFullTextLocator(locatedHit),
        sourceHash: hit.sourceHash,
        attachmentKey: pdf?.key || record.pdfAttachmentKey || "",
        sourceType: locatedHit.sourceType || "indexed-text",
        page: hit.page,
        pageLabel: locatedHit.pageLabel,
        annotationKey: locatedHit.annotationKey,
        annotationType: locatedHit.annotationType
      });
    }
  }
  return rows.slice(0, 4);
}

async function candidatePdfEvidenceSource(pdf, record = {}) {
  const pageSources = [
    record?.review?.fullTextPages,
    record?.review?.pdfTextPages,
    record?.fullTextPages,
    record?.pdfTextPages,
    pdf?.attachmentTextPages,
    pdf?.pdfTextPages,
    pdf?.textPages,
    pdf?.pageTexts
  ];
  for (const source of pageSources) {
    const pages = normalizePdfTextPagesForEvidence(source);
    if (pages.length) return { sourceType: "pdf-page-text", pages };
  }
  for (const method of ["getTextPages", "getPageTexts", "getPageTextEntries", "getPdfTextPages"]) {
    if (typeof pdf?.[method] !== "function") continue;
    try {
      const pages = normalizePdfTextPagesForEvidence(await pdf[method]());
      if (pages.length) return { sourceType: "pdf-page-text", pages };
    } catch (_err) {
      // Keep the indexed-text fallback below.
    }
  }
  const bridgePages = await candidatePdfTextPagesFromLocalBridge(pdf, record);
  if (bridgePages.length) return { sourceType: "pdf-page-text", pages: bridgePages };
  return String((await pdf?.attachmentText) || "").trim();
}

async function candidatePdfTextPagesFromLocalBridge(pdf, record = {}) {
  if (!pdf || typeof fetch !== "function") return [];
  const bridgeArguments = await candidatePdfBridgeArguments(pdf);
  if (!bridgeArguments) return [];
  const endpoint = candidatePdfTextBridgeEndpoint(record);
  if (!endpoint) return [];
  const [signal, clearPdfTextTimeout] = typeof setTimeout === "function"
    ? createAbortController(null, 50000)
    : [undefined, () => {}];
  try {
    const payload = await assertLocalAgentRequestOk({
      url: endpoint,
      signal,
      headers: { "content-type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: `workbench-pdf-pages-${Date.now()}`,
        method: "tools/call",
        params: {
          name: "extract_pdf_pages",
          arguments: {
            ...bridgeArguments,
            timeoutSeconds: 50,
            ocrFallback: true,
            maxOcrPages: 3,
            minTextChars: 40
          }
        }
      }
    });
    const result = localOcrResultFromPayload(payload);
    return normalizePdfTextPagesForEvidence(result?.pages || result);
  } catch (_err) {
    return [];
  } finally {
    clearPdfTextTimeout();
  }
}

async function candidatePdfBridgeArguments(pdf) {
  const name = attachmentDisplayName(pdf) || "paper.pdf";
  const filePath = await candidatePdfFilePath(pdf);
  if (filePath) return { filePath, name };
  const pdfBase64 = await attachmentPdfBase64(pdf);
  if (pdfBase64) return { pdfBase64, name };
  return null;
}

async function candidatePdfFilePath(pdf) {
  try {
    const path = await attachmentFilePath(pdf);
    if (path) return path;
  } catch (_err) {
    // Keep the fallback path checks below.
  }
  return String(pdf?.path || pdf?.filePath || pdf?.attachmentPath || "").trim();
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
      const normalized = normalizedPdfBase64(value) || pdfBytesToBase64(value);
      if (normalized) return normalized;
    } catch (_err) {
      // Keep trying other data accessors.
    }
  }
  for (const method of ["getBlob", "getFile", "getFileAsync"]) {
    if (typeof pdf?.[method] !== "function") continue;
    try {
      const blob = await pdf[method]();
      if (blob && typeof blob.arrayBuffer === "function") {
        const buffer = await blob.arrayBuffer();
        const normalized = pdfBytesToBase64(buffer);
        if (normalized) return normalized;
      }
    } catch (_err) {
      // Keep trying other data accessors.
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

function candidatePdfTextBridgeEndpoint(record = {}) {
  const explicit = record?.review?.localAgentEndpoint || record?.localAgentEndpoint || record?.pdfTextEndpoint || "";
  if (explicit) return normalizeLocalAgentEndpoint(explicit);
  try {
    return normalizeLocalAgentEndpoint(pref("localOcrEndpoint") || "http://127.0.0.1:3333/mcp");
  } catch (_err) {
    return normalizeLocalAgentEndpoint("http://127.0.0.1:3333/mcp");
  }
}

function indexedTextForEvidence(text) {
  const explicitPages = normalizePdfTextPagesForEvidence(text);
  const normalizedPages = explicitPages.length ? explicitPages : splitIndexedTextPages(text);
  const sourceType = explicitPages.length ? "pdf-page-text" : "indexed-text";
  const pages = [];
  let cursor = 0;
  normalizedPages.forEach((pageEntry, index) => {
    const pageText = pageEntry.text;
    const start = cursor;
    const end = start + pageText.length;
    const fallbackPage = normalizedPages.length > 1 ? index + 1 : undefined;
    const page = candidateEvidencePage(pageEntry.page || fallbackPage);
    pages.push({
      page,
      pageLabel: pageEntry.pageLabel || (page ? String(page) : ""),
      text: pageText,
      start,
      end,
      sourceType
    });
    cursor = end + 1;
  });
  return { text: pages.map((page) => page.text).join(" "), pages, sourceType };
}

function normalizePdfTextPagesForEvidence(source) {
  const rawPages = pdfTextPageCandidates(source);
  if (!rawPages.length) return [];
  return normalizeIndexedPageEntries(rawPages.map((entry, index) => {
    const text = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry.text ?? entry.content ?? entry.value ?? entry.pageText ?? ""
      : entry;
    const page = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry.page ?? entry.pageNumber ?? entry.index ?? entry.pageIndex
      : index + 1;
    const pageLabel = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry.pageLabel ?? entry.label ?? entry.page_label ?? entry.pageNumber
      : String(index + 1);
    return {
      text,
      page: candidateEvidencePage(page) || (index + 1),
      pageLabel: mdText(pageLabel || String(candidateEvidencePage(page) || index + 1))
    };
  }));
}

function pdfTextPageCandidates(source) {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (typeof source !== "object") return [];
  for (const key of ["pages", "textPages", "pageTexts", "pdfTextPages", "fullTextPages", "items"]) {
    if (Array.isArray(source[key])) return source[key];
  }
  return [];
}

function splitIndexedTextPages(text) {
  const source = String(text || "");
  const formFeedPages = normalizeIndexedPageEntries(source
    .split(/\f+/)
    .map((pageText, index) => ({ text: pageText, page: index + 1, pageLabel: String(index + 1) }))
    .filter((entry) => normalizeIndexedText(entry.text)));
  if (formFeedPages.length > 1) return formFeedPages;

  const markedPages = splitIndexedTextPagesByMarkers(source);
  if (markedPages.length) return markedPages;

  const normalized = normalizeIndexedText(cleanIndexedPageText(source));
  return normalized ? [{ text: normalized, page: undefined, pageLabel: "" }] : [];
}

function splitIndexedTextPagesByMarkers(text) {
  const rawPages = [];
  let current = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const marker = indexedPageMarker(line);
    if (marker) {
      if (current && normalizeIndexedText(current.lines.join(" "))) {
        rawPages.push({ text: current.lines.join("\n"), page: current.page, pageLabel: current.pageLabel });
      }
      current = { page: marker.page, pageLabel: marker.pageLabel, lines: [] };
      continue;
    }
    if (!current) current = { page: undefined, pageLabel: "", lines: [] };
    current.lines.push(line);
  }
  if (current && normalizeIndexedText(current.lines.join(" "))) {
    rawPages.push({ text: current.lines.join("\n"), page: current.page, pageLabel: current.pageLabel });
  }
  return normalizeIndexedPageEntries(rawPages);
}

function indexedPageMarker(line) {
  const source = String(line || "").trim();
  if (!source) return null;
  const match = source.match(/^(?:[-=_*]{2,}\s*)?(?:\[\s*)?(?:page|p\.?|页|第)\s*([A-Za-z0-9ivxlcdmIVXLCDM-]{1,12})\s*(?:页)?(?:\s*\])?(?:\s*[-=_*]{2,})?$/i);
  if (!match) return null;
  const pageLabel = match[1];
  return {
    page: candidateEvidencePage(pageLabel),
    pageLabel: mdText(pageLabel)
  };
}

function normalizeIndexedPageEntries(rawPages) {
  const repeatedEdgeLines = repeatedIndexedPageEdgeLines((rawPages || []).map((entry) => entry.text));
  return (rawPages || [])
    .map((entry, index) => normalizedIndexedPageEntry(
      entry.text,
      entry.page || ((rawPages || []).length > 1 ? index + 1 : undefined),
      entry.pageLabel,
      repeatedEdgeLines
    ))
    .filter((entry) => entry.text);
}

function normalizedIndexedPageEntry(pageText, fallbackPage, pageLabel = "", repeatedEdgeLines = new Set()) {
  const text = normalizeIndexedText(cleanIndexedPageText(pageText, repeatedEdgeLines));
  const page = candidateEvidencePage(fallbackPage);
  return {
    text,
    page,
    pageLabel: mdText(pageLabel || (page ? String(page) : ""))
  };
}

function cleanIndexedPageText(pageText, repeatedEdgeLines = new Set()) {
  const lines = String(pageText || "").split(/\r?\n/);
  const edgeLineIndexes = indexedPageEdgeLineIndexes(lines);
  const kept = lines.filter((line, index) => {
    const normalized = normalizeIndexedPageLine(line);
    if (!normalized) return false;
    if (indexedStandalonePageNumberLine(normalized)) return false;
    if (edgeLineIndexes.has(index) && indexedPageFooterNoiseLine(normalized)) return false;
    if (edgeLineIndexes.has(index) && repeatedEdgeLines.has(normalized)) return false;
    return true;
  });
  return dehyphenateIndexedText(kept.join("\n"));
}

function repeatedIndexedPageEdgeLines(pageTexts) {
  const counts = new Map();
  for (const pageText of pageTexts || []) {
    const lines = String(pageText || "").split(/\r?\n/);
    const pageKeys = new Set();
    for (const index of indexedPageEdgeLineIndexes(lines)) {
      const normalized = normalizeIndexedPageLine(lines[index]);
      if (!normalized || normalized.length > 140 || indexedStandalonePageNumberLine(normalized)) continue;
      pageKeys.add(normalized);
    }
    for (const key of pageKeys) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set(Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([key]) => key));
}

function indexedPageEdgeLineIndexes(lines) {
  const nonEmpty = (lines || [])
    .map((line, index) => ({ index, text: normalizeIndexedPageLine(line) }))
    .filter((entry) => entry.text);
  return new Set([
    ...nonEmpty.slice(0, 2).map((entry) => entry.index),
    ...nonEmpty.slice(-2).map((entry) => entry.index)
  ]);
}

function normalizeIndexedPageLine(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .trim();
}

function indexedStandalonePageNumberLine(normalizedLine) {
  return /^\d{1,4}$/.test(normalizedLine)
    || /^[ivxlcdm]{1,8}$/i.test(normalizedLine)
    || /^\d{1,4}\s*(?:\/|of)\s*\d{1,4}$/i.test(normalizedLine)
    || /^(?:page|p\.?|页|第)\s*[A-Za-z0-9ivxlcdmIVXLCDM-]{1,12}\s*(?:页)?$/i.test(normalizedLine);
}

function indexedPageFooterNoiseLine(normalizedLine) {
  return /^©\s*\d{4}\b/.test(normalizedLine)
    || /^copyright\b/i.test(normalizedLine)
    || /^all rights reserved\b/i.test(normalizedLine)
    || /^preprint\b/i.test(normalizedLine)
    || /^arxiv\b/i.test(normalizedLine)
    || /^doi:\s*10\./i.test(normalizedLine);
}

function dehyphenateIndexedText(text) {
  return String(text || "").replace(/([A-Za-z])-\s+([a-z])/g, "$1$2");
}

function normalizeIndexedText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function candidateSnippetForPattern(indexed, pattern, used, topicId = "") {
  const candidates = [];
  for (const page of indexed.pages || []) {
    for (const match of candidatePatternMatches(page.text, pattern)) {
      const hit = candidateSnippetHitForMatch(page, match.index, topicId);
      if (!hit || used.has(hit.key)) continue;
      candidates.push({
        hit,
        score: candidateSnippetEvidenceScore(hit, topicId)
      });
    }
  }
  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.hit.start - right.hit.start;
  });
  const selected = candidates[0]?.hit;
  if (!selected) return null;
  used.add(selected.key);
  const { key: _key, ...hit } = selected;
  return hit;
}

function candidatePatternMatches(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const matches = [];
  let match;
  while ((match = regex.exec(String(text || ""))) !== null) {
    matches.push({ index: match.index, text: match[0] || "" });
    if (!match[0]) regex.lastIndex += 1;
  }
  return matches.slice(0, 80);
}

function candidateSnippetHitForMatch(page, localCenter, topicId = "") {
  const quoteRange = candidateSentenceRange(page.text, localCenter);
  const contextStart = Math.max(0, quoteRange.start - 180);
  const contextEnd = Math.min(page.text.length, quoteRange.end + 220);
  const contextBefore = page.text.slice(contextStart, quoteRange.start).trim();
  const quote = page.text.slice(quoteRange.start, quoteRange.end).trim();
  const contextAfter = page.text.slice(quoteRange.end, contextEnd).trim();
  const snippet = [contextBefore, quote, contextAfter].filter(Boolean).join(" ").trim();
  if (!snippet) return null;
  const start = page.start + contextStart;
  const end = page.start + contextEnd;
  const sourceHash = shortEvidenceHash(snippet);
  return {
    key: `${topicId}:${start}:${sourceHash}`,
    text: snippet,
    quote,
    contextBefore,
    contextAfter,
    start,
    end,
    page: page.page,
    pageLabel: page.pageLabel || "",
    pageStart: contextStart,
    pageEnd: contextEnd,
    sourceType: page.sourceType || "indexed-text",
    sourceHash
  };
}

function candidateSnippetEvidenceScore(hit, topicId = "") {
  const snippet = normalizeEvidenceMatchText(hit?.text || "");
  const quote = normalizeEvidenceMatchText(hit?.quote || "");
  let score = 0;
  if (hit?.page) score += 1;
  if (quote.length >= 60) score += 2;
  else if (quote.length >= 30) score += 1;
  if (/\b(propos(?:e|ed|es|ing)|use[sd]?|based|derive[sd]?|train(?:ed|ing)?|evaluate[sd]?|compare[sd]?|show[sn]?|demonstrate[sd]?)\b/i.test(hit?.text || "")) score += 2;
  if (candidateSnippetTopicSignal(snippet, topicId)) score += 2;
  if (/\b(?:contents|table of contents|toc|index)\b/i.test(hit?.text || "")) score -= 4;
  if (/\.{3,}\s*\d{1,4}\b/.test(hit?.text || "")) score -= 3;
  if (/\b(?:references|bibliography|acknowledg(?:e)?ments?)\b/i.test(hit?.text || "")) score -= 3;
  if (quote.length < 24) score -= 2;
  return score;
}

function candidateSnippetTopicSignal(normalizedSnippet, topicId = "") {
  if (topicId === "method") return /\b(method|approach|framework|algorithm|model|architecture|graph attention|方法|模型|算法|框架)\b/i.test(normalizedSnippet);
  if (topicId === "experiment") return /\b(experiment|evaluation|result|dataset|benchmark|metric|ablation|实验|结果|评估|数据集|指标|消融)\b/i.test(normalizedSnippet);
  if (topicId === "limitation") return /\b(limitation|threat|validity|future work|weakness|局限|不足|威胁|未来)\b/i.test(normalizedSnippet);
  if (topicId === "contribution") return /\b(contribution|finding|conclusion|novel|state of the art|贡献|发现|结论|创新)\b/i.test(normalizedSnippet);
  return false;
}

function candidateSentenceRange(text, center) {
  const source = String(text || "");
  const safeCenter = Math.max(0, Math.min(source.length, Number(center) || 0));
  const before = source.slice(0, safeCenter);
  const after = source.slice(safeCenter);
  const beforeBreak = Math.max(before.lastIndexOf(". "), before.lastIndexOf("。"), before.lastIndexOf("; "), before.lastIndexOf("；"));
  const afterBreakCandidates = [after.indexOf(". "), after.indexOf("。"), after.indexOf("; "), after.indexOf("；")]
    .filter((index) => index >= 0);
  const start = beforeBreak >= 0 ? beforeBreak + 1 : Math.max(0, safeCenter - 120);
  const end = afterBreakCandidates.length ? safeCenter + Math.min(...afterBreakCandidates) + 1 : Math.min(source.length, safeCenter + 180);
  return {
    start: Math.max(0, start),
    end: Math.max(start, Math.min(source.length, end))
  };
}

function candidateFullTextLocator(hit) {
  const start = Number.isFinite(hit?.start) ? Math.max(0, Math.floor(hit.start)) : 0;
  const end = Number.isFinite(hit?.end) ? Math.max(start, Math.floor(hit.end)) : start;
  const sourceType = candidateFullTextLocatorSourceType(hit?.sourceType);
  const prefix = CANDIDATE_FULL_TEXT_LOCATOR_PREFIXES[sourceType] || CANDIDATE_FULL_TEXT_LOCATOR_PREFIXES["indexed-text"];
  const parts = [`${prefix}${start}-${end}`];
  const page = candidateEvidencePage(hit?.page);
  if (page) parts.push(`page:${page}`);
  if (page && Number.isFinite(hit?.pageStart) && Number.isFinite(hit?.pageEnd)) {
    parts.push(`page-span:${Math.max(0, Math.floor(hit.pageStart))}-${Math.max(0, Math.floor(hit.pageEnd))}`);
  }
  const pageLabel = mdText(hit?.pageLabel || hit?.annotationPageLabel || "");
  if (pageLabel) parts.push(`page-label:${candidateLocatorValue(pageLabel)}`);
  const annotationKey = mdText(hit?.annotationKey || "");
  if (annotationKey) parts.push(`annotation:${candidateLocatorValue(annotationKey)}`);
  return parts.join("; ");
}

const CANDIDATE_FULL_TEXT_LOCATOR_PREFIXES = {
  "indexed-text": "indexed-text:",
  "pdf-page-text": "pdf-page-text:"
};

function candidateFullTextLocatorSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized === "pdf-page-text" ? "pdf-page-text" : "indexed-text";
}

function candidateEvidencePage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function candidatePdfAnnotationForHit(pdf, hit) {
  const annotations = candidatePdfAnnotationsForEvidence(pdf);
  if (!annotations.length) return null;
  const target = normalizeEvidenceMatchText([hit?.quote, hit?.text].filter(Boolean).join(" "));
  if (!target) return null;
  let best = null;
  for (const annotation of annotations) {
    const score = evidenceOverlapScore(target, annotation.matchText);
    if (score < 0.42) continue;
    if (!best || score > best.score) best = { ...annotation, score };
  }
  return best;
}

function candidatePdfAnnotationsForEvidence(pdf) {
  try {
    const annotations = typeof pdf?.getAnnotations === "function" ? pdf.getAnnotations() : [];
    if (!Array.isArray(annotations)) return [];
    return annotations
      .map((annotation) => {
        const text = mdText(annotation?.annotationText || annotation?.annotationComment || "");
        const pageLabel = mdText(annotation?.annotationPageLabel || annotation?.pageLabel || "");
        if (!text || !pageLabel) return null;
        return {
          key: mdText(annotation?.key || annotation?.annotationKey || ""),
          type: mdText(annotation?.annotationType || ""),
          pageLabel,
          text,
          matchText: normalizeEvidenceMatchText(text)
        };
      })
      .filter(Boolean);
  } catch (_err) {
    return [];
  }
}

function normalizeEvidenceMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceOverlapScore(left, right) {
  const leftTokens = evidenceMatchTokens(left);
  const rightTokens = evidenceMatchTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
}

function evidenceMatchTokens(value) {
  return normalizeEvidenceMatchText(value)
    .split(" ")
    .filter((token) => token.length > 2)
    .slice(0, 80);
}

function candidateLocatorValue(value) {
  return String(value || "").replace(/[;\n\r]+/g, " ").replace(/\s+/g, "-").slice(0, 80);
}

function shortEvidenceHash(value) {
  return normalizeEvidenceHash(hashString(String(value || ""))).slice(0, 12);
}

function normalizeEvidenceHash(value) {
  return String(value || "").replace(/^0x/i, "").replace(/[^a-f0-9]/gi, "").toLowerCase();
}

function candidateSourceEvidenceIdentifiers(record) {
  return [
    record?.ids?.doi ? `DOI: ${record.ids.doi}` : "",
    record?.ids?.arxivId ? `arXiv: ${record.ids.arxivId}` : "",
    record?.ids?.semanticScholarId ? `Semantic Scholar: ${record.ids.semanticScholarId}` : ""
  ].filter(Boolean).join("; ");
}

function candidateRecommendationMismatch(record) {
  const decision = normalizeCandidateDecision(record?.decision);
  const recommended = record?.priority?.recommendedDecision ? normalizeCandidateDecision(record.priority.recommendedDecision) : "";
  return !!recommended && recommended !== decision;
}

function candidateNeedsReviewAction(record) {
  const decision = normalizeCandidateDecision(record?.decision);
  const recommended = record?.priority?.recommendedDecision ? normalizeCandidateDecision(record.priority.recommendedDecision) : "";
  if (record?.quality?.dedupeStatus === "duplicate" || record?.priority?.tier === "duplicate") return true;
  if (recommended && recommended !== decision) return true;
  if (decision === "user_pending" && ["high", "medium"].includes(record?.priority?.tier)) return true;
  if (record?.importStatus && record.importStatus !== "imported" && record.importStatus !== "skipped_duplicate") return true;
  if (decision === "include" && !record?.pdfUrl && record?.pdfAttachmentStatus !== "attached_pdf") return true;
  return false;
}

function candidateReviewPriorityText(record, labels) {
  const tier = record?.priority?.tier || "";
  const score = Number.isFinite(record?.priority?.score) ? record.priority.score : "";
  return [tier, score].filter((value) => value !== "").join(" ") || labels.noPriority;
}

function candidateReviewNextAction(record, labels) {
  const decision = normalizeCandidateDecision(record?.decision);
  const recommended = record?.priority?.recommendedDecision ? normalizeCandidateDecision(record.priority.recommendedDecision) : "";
  if (record?.quality?.dedupeStatus === "duplicate" || record?.priority?.tier === "duplicate") return labels.actionResolveDuplicate;
  if (recommended && recommended !== decision) {
    return labels.actionApplyRecommendation.replace("{decision}", candidateDecisionLabel(recommended, candidateReviewDecisionLabel(labels)));
  }
  if (decision === "user_pending" && record?.priority?.tier === "high") return labels.actionScreenHigh;
  if (decision === "user_pending" && record?.priority?.tier === "medium") return labels.actionScreenMedium;
  if (record?.importStatus && record.importStatus !== "imported" && record.importStatus !== "skipped_duplicate") return labels.actionCheckImport;
  if (decision === "include" && !record?.pdfUrl && record?.pdfAttachmentStatus !== "attached_pdf") return labels.actionFindPdf;
  if (decision === "to_read") return labels.actionReadAbstract;
  if (decision === "exclude") return labels.actionKeepExcluded;
  return labels.actionNoImmediate;
}

function candidateReviewRecordLines(record, index, labels) {
  const ids = [
    record.ids?.doi ? `DOI: ${record.ids.doi}` : "",
    record.ids?.arxivId ? `arXiv: ${record.ids.arxivId}` : "",
    record.ids?.semanticScholarId ? `Semantic Scholar: ${record.ids.semanticScholarId}` : ""
  ].filter(Boolean).join("; ");
  const status = [
    `${labels.decision}: ${candidateDecisionLabel(record.decision, candidateReviewDecisionLabel(labels))}`,
    record.priority ? `${labels.priority}: ${record.priority.tier || "unknown"} ${Number.isFinite(record.priority.score) ? record.priority.score : ""}`.trim() : "",
    record.priority?.recommendedDecision ? `${labels.recommended}: ${candidateDecisionLabel(record.priority.recommendedDecision, candidateReviewDecisionLabel(labels))}` : "",
    record.quality?.dedupeStatus ? `${labels.dedupe}: ${record.quality.dedupeStatus}` : "",
    record.importStatus ? `${labels.importStatus}: ${record.importStatus}` : "",
    record.pdfAttachmentStatus ? `${labels.pdfStatus}: ${record.pdfAttachmentStatus}` : ""
  ].filter(Boolean).join(" | ");
  const links = [
    record.sourceUrl ? `[${labels.source}](${record.sourceUrl})` : "",
    record.pdfUrl ? `[PDF](${record.pdfUrl})` : ""
  ].filter(Boolean).join(" | ");
  return [
    `${index}. **${mdText(record.title || record.candidateId)}**${record.year ? ` (${record.year})` : ""}`,
    `   - ${status}`,
    ids ? `   - ${labels.identifiers}: ${mdText(ids)}` : "",
    record.authors?.length ? `   - ${labels.authors}: ${mdText(record.authors.slice(0, 8).join(", "))}` : "",
    record.venue ? `   - ${labels.venue}: ${mdText(record.venue)}` : "",
    record.sources?.length ? `   - ${labels.sources}: ${mdText(record.sources.join(", "))}` : "",
    record.priority?.reasons?.length ? `   - ${labels.reasons}: ${mdText(record.priority.reasons.join("; "))}` : "",
    record.networkOrigins?.length ? `   - ${labels.network}: ${mdText(candidateReviewNetworkOrigins(record.networkOrigins))}` : "",
    `   - ${labels.screeningStage}: ${mdText(candidateReviewScreeningStageText(record, labels))}`,
    candidateReviewExclusionReason(record) ? `   - ${labels.exclusionReason}: ${mdText(candidateReviewExclusionReasonText(record, labels))}` : "",
    links ? `   - ${labels.links}: ${links}` : "",
    record.abstract ? `   - ${labels.abstract}: ${mdText(truncateText(record.abstract, 500))}` : "",
    candidateReviewNote(record) ? `   - ${labels.savedNote}: ${mdText(candidateReviewNote(record))}` : "",
    `   - ${labels.nextAction}: ${mdText(candidateReviewNextAction(record, labels))}`,
    `   - ${labels.notesLine}: `
  ].filter(Boolean);
}

function candidatePriorityTierCounts(records) {
  return (records || []).reduce((counts, record) => {
    const tier = record?.priority?.tier || "none";
    counts[tier] = (counts[tier] || 0) + 1;
    return counts;
  }, { high: 0, medium: 0, low: 0, duplicate: 0 });
}

function candidateReviewScreeningStageText(record, labels) {
  const stage = candidateReviewScreeningStage(record);
  return {
    not_started: labels.screeningStageNotStarted,
    abstract_screened: labels.screeningStageAbstractScreened,
    full_text_needed: labels.screeningStageFullTextNeeded,
    full_text_screened: labels.screeningStageFullTextScreened
  }[stage] || stage;
}

function candidateReviewExclusionReasonText(record, labels) {
  const reason = candidateReviewExclusionReason(record);
  return {
    off_topic: labels.exclusionReasonOffTopic,
    duplicate: labels.exclusionReasonDuplicate,
    no_full_text: labels.exclusionReasonNoFullText,
    weak_evidence: labels.exclusionReasonWeakEvidence,
    wrong_document_type: labels.exclusionReasonWrongDocumentType,
    not_peer_reviewed: labels.exclusionReasonNotPeerReviewed,
    other: labels.exclusionReasonOther
  }[reason] || "";
}

function candidateReviewDecisionLabel(labels) {
  return (key) => ({
    candidateInclude: labels.include,
    candidateExclude: labels.exclude,
    candidateToRead: labels.toRead,
    candidatePending: labels.pending
  }[key] || key);
}

function candidateReviewNetworkOrigins(origins) {
  return (origins || []).map((origin) => {
    const hop = origin.hop ? `hop ${origin.hop}` : "";
    return [origin.direction, origin.seedTitle || origin.seedId, hop].filter(Boolean).join(" from ");
  }).join("; ");
}

function candidateReviewLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "候选论文审阅报告",
      paper: "当前论文",
      collection: "Collection",
      generatedAt: "生成时间",
      sourceFile: "候选 JSONL",
      reviewFile: "审阅报告",
      summary: "统计摘要",
      total: "候选总数",
      include: "纳入",
      toRead: "待读",
      pending: "待确认",
      exclude: "排除",
      high: "高优先级",
      medium: "中优先级",
      low: "低优先级",
      duplicate: "重复项",
      screeningBoard: "审阅状态看板",
      boardMetric: "审阅状态",
      boardCount: "数量",
      boardAction: "建议处理",
      boardHighPending: "高优先级待确认",
      boardHighPendingAction: "优先阅读摘要和全文，必要时直接转为纳入或排除。",
      boardMediumPending: "中优先级待确认",
      boardMediumPendingAction: "检查与综述分类、方法和实验指标的相关性。",
      boardRecommendationMismatch: "建议与当前决策不一致",
      boardRecommendationMismatchAction: "逐条人工复核，不自动覆盖已有人工判断。",
      boardDuplicates: "重复或疑似重复",
      boardDuplicatesAction: "核对 DOI、标题和 Zotero 已有条目，确认后排除或合并。",
      boardReadyToImport: "可导入 Zotero",
      boardReadyToImportAction: "确认纳入理由后执行导入，并记录后续 PDF 补全状态。",
      boardIncludedMissingPdf: "已纳入但缺 PDF",
      boardIncludedMissingPdfAction: "优先查找开放获取 PDF 或手动附加本地文件。",
      boardImportIssues: "导入异常",
      boardImportIssuesAction: "检查导入错误、重复项和缺失标识符。",
      boardPdfAttached: "PDF 已补全",
      boardPdfAttachedAction: "可进入精读或加入文献矩阵。",
      boardAbstractOnly: "仅摘要记录",
      boardAbstractOnlyAction: "低优先级仅摘要记录暂缓导入，先补全文或来源。",
      evidenceChain: "证据链复核队列",
      evidenceColumnState: "证据状态",
      evidenceColumnGap: "证据缺口",
      evidenceColumnCheck: "建议核验",
      evidenceColumnSource: "可用来源",
      evidenceNoFollowUp: "暂无需要单独复核的证据链事项；继续按审阅队列记录人工判断。",
      evidenceStateFullTextScreened: "全文已筛",
      evidenceStateFullTextNeeded: "需要全文",
      evidenceStateAbstractScreened: "摘要已筛",
      evidenceStateAbstractOnly: "仅摘要",
      evidenceStatePdfAvailable: "PDF 可用",
      evidenceStateSourceOnly: "仅来源记录",
      evidenceGapMissingExclusionReason: "已排除但缺少结构化排除理由",
      evidenceGapMissingFullText: "已纳入但缺少 PDF 或全文证据",
      evidenceGapFullTextNeeded: "需要全文后才能判断证据强度",
      evidenceGapAbstractOnly: "仅摘要，缺少方法、实验和局限证据",
      evidenceGapNeedFullTextScreening: "尚未完成全文筛选",
      evidenceGapCitationContext: "引用网络相关性需要回到原文核对",
      evidenceCheckAddExclusionReason: "补充排除理由，并在备注中写明证据位置。",
      evidenceCheckFindPdf: "查找开放获取 PDF 或附加本地全文，再更新筛选阶段。",
      evidenceCheckScreenFullText: "检查方法、实验、局限和可复用指标，并标记为已筛全文。",
      evidenceCheckReadAbstract: "先核对摘要与来源页，能获取全文后再进入纳入判断。",
      evidenceCheckTraceCitationContext: "核对它与种子论文的引用/被引关系和具体段落上下文。",
      evidenceSourcePdfUrl: "PDF 链接",
      evidenceSourceAttachedPdf: "已附加 PDF",
      evidenceSourceNetwork: "引用网络",
      evidenceSourceCatalog: "检索来源",
      evidenceSourceUnknown: "未知",
      sourceEvidence: "来源证据摘录",
      sourceEvidenceNone: "暂无可摘录的候选来源证据；请先检索候选论文或补充摘要、PDF、来源页和引用网络信息。",
      sourceEvidenceLabel: "证据标签",
      sourceEvidenceType: "类型",
      sourceEvidenceLocator: "定位",
      sourceEvidenceSnippet: "摘录",
      sourceEvidenceFollowUp: "下一步核验",
      sourceEvidenceTypeFullText: "全文索引",
      sourceEvidenceTypeAbstract: "摘要",
      sourceEvidenceTypePdf: "PDF",
      sourceEvidenceTypeNetwork: "引用网络",
      sourceEvidenceTypeSource: "来源页",
      sourceEvidenceTypeIdentifier: "标识符",
      sourceEvidenceFollowFullText: "回到 PDF 原文核对页码、上下文和表格/图示位置，再决定是否纳入综述证据。",
      sourceEvidenceFollowAbstract: "对照全文确认研究问题、方法、实验和局限是否被摘要充分覆盖。",
      sourceEvidenceFollowPdf: "打开 PDF 或已附加文件，摘录方法、实验指标和关键结论位置。",
      sourceEvidenceFollowNetwork: "回到种子论文上下文核对引用或被引关系是否真的支撑相关性。",
      sourceEvidenceFollowSource: "打开来源页核对元数据、开放获取状态和版本。",
      sourceEvidenceFollowIdentifier: "用稳定标识符去重，并与 Zotero 已有条目核对。",
      checklist: "人工复核清单",
      checkIdentifiers: "核对 DOI、arXiv、Semantic Scholar ID 是否对应同一篇论文。",
      checkFullText: "优先确认是否有 PDF 或开放获取全文。",
      checkDuplicates: "检查重复项和疑似重复项，避免重复导入 Zotero。",
      checkRelevance: "判断与当前研究问题、方法或综述分类是否相关。",
      checkImport: "只把确认纳入的条目导入 Zotero，并在必要时补全 PDF。",
      screeningProtocol: "筛选协议",
      inclusionCriteria: "纳入标准",
      inclusionCriteriaText: "优先保留与当前论文的问题、方法、数据、评价指标或引用网络直接相关，且具备稳定 DOI/arXiv/Semantic Scholar 标识或可追溯来源的论文。",
      exclusionCriteria: "排除标准",
      exclusionCriteriaText: "排除重复项、无可靠标识且无法追溯来源的记录、明显偏离主题的论文，以及只有摘要且暂时无法获取全文的低优先级记录。",
      decisionRules: "决策规则",
      decisionRulesText: "先处理高优先级和重复项；建议与当前决策不一致时必须人工确认；纳入后再执行导入 Zotero 和 PDF 补全。",
      actionQueue: "决策行动队列",
      paperColumn: "候选论文",
      nextAction: "下一步",
      noImmediateActions: "暂无需要立即处理的候选项；可按审阅队列继续检查摘要、全文和人工备注。",
      noRecommendation: "无建议",
      noPriority: "未排序",
      actionResolveDuplicate: "核对重复项，确认后排除或合并到已有条目",
      actionApplyRecommendation: "人工复核后按建议改为{decision}",
      actionScreenHigh: "优先阅读摘要和全文，确认是否纳入",
      actionScreenMedium: "检查相关性，必要时放入待读",
      actionFindPdf: "查找或补全 PDF，再导入 Zotero",
      actionCheckImport: "检查导入状态和错误信息",
      actionReadAbstract: "阅读摘要和关键结论后决定纳入或排除",
      actionKeepExcluded: "保留排除理由，必要时补充备注",
      actionNoImmediate: "无需立即处理",
      queue: "审阅队列",
      notes: "人工备注",
      notesPlaceholder: "在这里记录纳入理由、排除理由、待读顺序或后续检索式。",
      decision: "决策",
      priority: "优先级",
      recommended: "建议",
      dedupe: "去重",
      importStatus: "导入状态",
      pdfStatus: "PDF 状态",
      identifiers: "标识符",
      authors: "作者",
      venue: "期刊/会议",
      sources: "来源",
      reasons: "排序理由",
      network: "引用网络来源",
      screeningStage: "筛选阶段",
      screeningStageNotStarted: "未开始",
      screeningStageAbstractScreened: "已筛摘要",
      screeningStageFullTextNeeded: "需要全文",
      screeningStageFullTextScreened: "已筛全文",
      exclusionReason: "排除理由",
      exclusionReasonOffTopic: "主题不相关",
      exclusionReasonDuplicate: "重复项",
      exclusionReasonNoFullText: "无法获取全文",
      exclusionReasonWeakEvidence: "证据不足",
      exclusionReasonWrongDocumentType: "文献类型不合适",
      exclusionReasonNotPeerReviewed: "非同行评议或来源不足",
      exclusionReasonOther: "其他",
      links: "链接",
      source: "来源页",
      abstract: "摘要",
      savedNote: "已保存备注",
      notesLine: "人工判断"
    };
  }
  return {
    title: "Candidate Paper Review",
    paper: "Current paper",
    collection: "Collection",
    generatedAt: "Generated at",
    sourceFile: "Candidate JSONL",
    reviewFile: "Review file",
    summary: "Summary",
    total: "Total candidates",
    include: "Include",
    toRead: "To Read",
    pending: "Pending",
    exclude: "Exclude",
    high: "High priority",
    medium: "Medium priority",
    low: "Low priority",
    duplicate: "Duplicates",
    screeningBoard: "Screening Board",
    boardMetric: "Review state",
    boardCount: "Count",
    boardAction: "Suggested handling",
    boardHighPending: "High-priority pending",
    boardHighPendingAction: "Review abstract and full text first, then include or exclude.",
    boardMediumPending: "Medium-priority pending",
    boardMediumPendingAction: "Check relevance to the review taxonomy, method, and evaluation metrics.",
    boardRecommendationMismatch: "Recommendation differs from current decision",
    boardRecommendationMismatchAction: "Manually review each mismatch instead of overwriting prior human decisions.",
    boardDuplicates: "Duplicate or possible duplicate",
    boardDuplicatesAction: "Compare DOI, title, and existing Zotero items before excluding or merging.",
    boardReadyToImport: "Ready for Zotero import",
    boardReadyToImportAction: "Import after confirming the inclusion rationale, then track PDF attachment state.",
    boardIncludedMissingPdf: "Included but missing PDF",
    boardIncludedMissingPdfAction: "Look for open-access PDF or attach a local file.",
    boardImportIssues: "Import issues",
    boardImportIssuesAction: "Inspect import errors, duplicates, and missing identifiers.",
    boardPdfAttached: "PDF attached",
    boardPdfAttachedAction: "Move to close reading or the literature matrix.",
    boardAbstractOnly: "Abstract-only records",
    boardAbstractOnlyAction: "Defer low-priority abstract-only records until full text or source evidence is available.",
    evidenceChain: "Evidence-chain Follow-up",
    evidenceColumnState: "Evidence state",
    evidenceColumnGap: "Evidence gap",
    evidenceColumnCheck: "Suggested check",
    evidenceColumnSource: "Available source",
    evidenceNoFollowUp: "No separate evidence-chain follow-up is needed; continue recording manual judgments from the review queue.",
    evidenceStateFullTextScreened: "Full text screened",
    evidenceStateFullTextNeeded: "Full text needed",
    evidenceStateAbstractScreened: "Abstract screened",
    evidenceStateAbstractOnly: "Abstract only",
    evidenceStatePdfAvailable: "PDF available",
    evidenceStateSourceOnly: "Source only",
    evidenceGapMissingExclusionReason: "Excluded record is missing a structured exclusion reason",
    evidenceGapMissingFullText: "Included record is missing PDF or full-text evidence",
    evidenceGapFullTextNeeded: "Full text is needed before judging evidence strength",
    evidenceGapAbstractOnly: "Abstract-only record lacks method, experiment, and limitation evidence",
    evidenceGapNeedFullTextScreening: "Full-text screening is not complete",
    evidenceGapCitationContext: "Citation-network relevance needs source-context verification",
    evidenceCheckAddExclusionReason: "Add an exclusion reason and note the evidence location.",
    evidenceCheckFindPdf: "Find an open-access PDF or attach local full text, then update the screening stage.",
    evidenceCheckScreenFullText: "Check method, experiments, limitations, and reusable metrics, then mark full text screened.",
    evidenceCheckReadAbstract: "Check the abstract and source page first; defer inclusion until full text is available.",
    evidenceCheckTraceCitationContext: "Verify the reference/citation relation and the source paragraphs around it.",
    evidenceSourcePdfUrl: "PDF URL",
    evidenceSourceAttachedPdf: "Attached PDF",
    evidenceSourceNetwork: "Citation network",
    evidenceSourceCatalog: "Search source",
    evidenceSourceUnknown: "Unknown",
    sourceEvidence: "Source Evidence Snippets",
    sourceEvidenceNone: "No candidate source evidence is available yet; search candidates or add abstracts, PDFs, source pages, and citation-network metadata first.",
    sourceEvidenceLabel: "Evidence label",
    sourceEvidenceType: "Type",
    sourceEvidenceLocator: "Locator",
    sourceEvidenceSnippet: "Snippet",
    sourceEvidenceFollowUp: "Next check",
    sourceEvidenceTypeFullText: "Full-text index",
    sourceEvidenceTypeAbstract: "Abstract",
    sourceEvidenceTypePdf: "PDF",
    sourceEvidenceTypeNetwork: "Citation network",
    sourceEvidenceTypeSource: "Source page",
    sourceEvidenceTypeIdentifier: "Identifier",
    sourceEvidenceFollowFullText: "Return to the PDF and verify page, context, and table/figure location before using it as review evidence.",
    sourceEvidenceFollowAbstract: "Check full text to confirm whether the abstract covers question, method, experiments, and limitations.",
    sourceEvidenceFollowPdf: "Open the PDF or attached file and extract method, metric, and key-finding locations.",
    sourceEvidenceFollowNetwork: "Return to seed-paper context and verify whether the citation relation actually supports relevance.",
    sourceEvidenceFollowSource: "Open the source page and verify metadata, open-access status, and version.",
    sourceEvidenceFollowIdentifier: "Use stable identifiers for deduplication and compare against existing Zotero items.",
    checklist: "Manual Review Checklist",
    checkIdentifiers: "Confirm DOI, arXiv, and Semantic Scholar IDs refer to the same paper.",
    checkFullText: "Prefer papers with PDF or open-access full text.",
    checkDuplicates: "Check duplicates and possible duplicates before importing into Zotero.",
    checkRelevance: "Judge relevance to the current question, method, or review taxonomy.",
    checkImport: "Import only confirmed items into Zotero and attach PDFs when needed.",
    screeningProtocol: "Screening Protocol",
    inclusionCriteria: "Inclusion criteria",
    inclusionCriteriaText: "Prioritize papers directly related to the current paper's question, method, data, evaluation metrics, or citation network, with stable DOI/arXiv/Semantic Scholar identifiers or traceable source links.",
    exclusionCriteria: "Exclusion criteria",
    exclusionCriteriaText: "Exclude duplicates, records without reliable identifiers or traceable sources, clearly off-topic papers, and low-priority abstract-only records when full text is unavailable.",
    decisionRules: "Decision rules",
    decisionRulesText: "Handle high-priority items and duplicates first; manually confirm any mismatch between the current decision and recommendation; import to Zotero and attach PDFs only after inclusion is confirmed.",
    actionQueue: "Decision Action Queue",
    paperColumn: "Candidate paper",
    nextAction: "Next action",
    noImmediateActions: "No candidates need immediate action; continue reviewing abstracts, full text, and manual notes from the queue.",
    noRecommendation: "No recommendation",
    noPriority: "Unranked",
    actionResolveDuplicate: "Resolve duplicate status, then exclude or merge with the existing item",
    actionApplyRecommendation: "Manually review, then change to {decision} if appropriate",
    actionScreenHigh: "Review abstract and full text first, then confirm inclusion",
    actionScreenMedium: "Check relevance and move to To Read when needed",
    actionFindPdf: "Find or attach a PDF before Zotero import",
    actionCheckImport: "Check import status and error details",
    actionReadAbstract: "Read abstract and key findings, then include or exclude",
    actionKeepExcluded: "Keep the exclusion reason and add notes when needed",
    actionNoImmediate: "No immediate action",
    queue: "Review Queue",
    notes: "Manual Notes",
    notesPlaceholder: "Record inclusion reasons, exclusion reasons, reading order, or follow-up search queries here.",
    decision: "Decision",
    priority: "Priority",
    recommended: "Recommended",
    dedupe: "Dedupe",
    importStatus: "Import status",
    pdfStatus: "PDF status",
    identifiers: "Identifiers",
    authors: "Authors",
    venue: "Venue",
    sources: "Sources",
    reasons: "Ranking reasons",
    network: "Citation network",
    screeningStage: "Screening stage",
    screeningStageNotStarted: "Not started",
    screeningStageAbstractScreened: "Abstract screened",
    screeningStageFullTextNeeded: "Full text needed",
    screeningStageFullTextScreened: "Full text screened",
    exclusionReason: "Exclusion reason",
    exclusionReasonOffTopic: "Off topic",
    exclusionReasonDuplicate: "Duplicate",
    exclusionReasonNoFullText: "No full text",
    exclusionReasonWeakEvidence: "Weak evidence",
    exclusionReasonWrongDocumentType: "Wrong document type",
    exclusionReasonNotPeerReviewed: "Not peer reviewed or weak source",
    exclusionReasonOther: "Other",
    links: "Links",
    source: "Source",
    abstract: "Abstract",
    savedNote: "Saved note",
    notesLine: "Manual judgment"
  };
}

function mdText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mdTableCell(value) {
  return mdText(value).replace(/\|/g, "\\|");
}

function yamlScalar(value) {
  const text = String(value ?? "");
  return JSON.stringify(text);
}

function truncateText(value, max = 500) {
  const text = mdText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function candidateDecisionCounts(records) {
  return (records || []).reduce((counts, record) => {
    const decision = normalizeCandidateDecision(record.decision);
    counts[decision] = (counts[decision] || 0) + 1;
    return counts;
  }, { include: 0, exclude: 0, to_read: 0, user_pending: 0 });
}

function candidateElement(record, translate = (key) => key) {
  const wrapper = document.createElement("article");
  wrapper.className = "zms-candidate";
  const title = document.createElement("div");
  title.className = "zms-candidate-title";
  title.textContent = record.title || record.candidateId;
  const meta = document.createElement("div");
  meta.className = "zms-candidate-meta";
  meta.textContent = candidateMetaText(record);
  const select = document.createElement("select");
  select.dataset.candidateDecision = record.candidateId;
  for (const decision of ["user_pending", "include", "to_read", "exclude"]) {
    const option = document.createElement("option");
    option.value = decision;
    option.textContent = candidateDecisionLabel(decision, translate);
    option.selected = normalizeCandidateDecision(record.decision) === decision;
    select.appendChild(option);
  }
  select.setAttribute?.("aria-label", translate("candidateDecisionLabel"));
  const reviewControls = document.createElement("div");
  reviewControls.className = "zms-candidate-review-controls";
  const screening = document.createElement("select");
  screening.dataset.candidateScreening = record.candidateId;
  screening.setAttribute?.("aria-label", translate("candidateScreeningStageLabel"));
  for (const stage of ZMS_CANDIDATE_SCREENING_STAGES) {
    const option = document.createElement("option");
    option.value = stage;
    option.textContent = candidateScreeningStageLabel(stage, translate);
    option.selected = candidateReviewScreeningStage(record) === stage;
    screening.appendChild(option);
  }
  const exclusion = document.createElement("select");
  exclusion.dataset.candidateExclusionReason = record.candidateId;
  exclusion.setAttribute?.("aria-label", translate("candidateExclusionReasonLabel"));
  for (const reason of ZMS_CANDIDATE_EXCLUSION_REASONS) {
    const option = document.createElement("option");
    option.value = reason;
    option.textContent = candidateExclusionReasonLabel(reason, translate);
    option.selected = candidateReviewExclusionReason(record) === reason;
    exclusion.appendChild(option);
  }
  reviewControls.append(select, screening, exclusion);
  const note = document.createElement("textarea");
  note.className = "zms-candidate-note";
  note.dataset.candidateNote = record.candidateId;
  note.value = candidateReviewNote(record);
  note.placeholder = translate("candidateReviewNotePlaceholder");
  note.setAttribute?.("aria-label", translate("candidateReviewNoteLabel"));
  wrapper.append(title, meta, reviewControls, note);
  return wrapper;
}

function candidateMetaText(record) {
  const quality = record.quality || {};
  return [
    candidatePriorityMetaText(record),
    citationNetworkMetaText(record),
    [record.authors || []].flat().filter(Boolean).slice(0, 3).join(", "),
    record.year || "",
    record.sourceType || "",
    quality.dedupeStatus || "",
    record.importStatus || "",
    record.pdfAttachmentStatus || "",
    quality.isAbstractOnly ? "abstract_only" : "",
    quality.reason || "",
    record.sourceUrl || record.pdfUrl || ""
  ].filter(Boolean).join(" | ");
}

function citationNetworkMetaText(record) {
  const origins = Array.isArray(record?.networkOrigins) ? record.networkOrigins : [];
  if (!origins.length) return "";
  return `network:${origins.slice(0, 2).map((origin) => {
    const seed = origin.seedTitle || origin.seedId || "";
    const hop = origin.hop ? `hop${origin.hop}` : "";
    return [origin.direction, seed, hop].filter(Boolean).join(":");
  }).join(",")}`;
}

function candidatePriorityMetaText(record) {
  const priority = record?.priority || {};
  if (!Number.isFinite(priority.score)) return "";
  return [`rank:${priority.tier || "unknown"}`, String(priority.score), priority.recommendedDecision ? `recommend:${priority.recommendedDecision}` : ""].filter(Boolean).join(" ");
}

function candidateDecisionLabel(decision, translate = (key) => key) {
  const key = {
    include: "candidateInclude",
    exclude: "candidateExclude",
    to_read: "candidateToRead",
    user_pending: "candidatePending"
  }[normalizeCandidateDecision(decision)];
  return translate(key);
}

function candidateScreeningStageLabel(stage, translate = (key) => key) {
  const key = {
    not_started: "candidateScreeningStageNotStarted",
    abstract_screened: "candidateScreeningStageAbstractScreened",
    full_text_needed: "candidateScreeningStageFullTextNeeded",
    full_text_screened: "candidateScreeningStageFullTextScreened"
  }[normalizeCandidateScreeningStage(stage)];
  return translate(key);
}

function candidateExclusionReasonLabel(reason, translate = (key) => key) {
  const key = {
    "": "candidateExclusionReasonNone",
    off_topic: "candidateExclusionReasonOffTopic",
    duplicate: "candidateExclusionReasonDuplicate",
    no_full_text: "candidateExclusionReasonNoFullText",
    weak_evidence: "candidateExclusionReasonWeakEvidence",
    wrong_document_type: "candidateExclusionReasonWrongDocumentType",
    not_peer_reviewed: "candidateExclusionReasonNotPeerReviewed",
    other: "candidateExclusionReasonOther"
  }[normalizeCandidateExclusionReason(reason)];
  return translate(key || "candidateExclusionReasonNone");
}

function candidateDecisionMapFromDom() {
  if (typeof document === "undefined") return {};
  const decisions = {};
  for (const element of document.querySelectorAll("[data-candidate-decision]")) {
    const candidateId = element.dataset?.candidateDecision || "";
    if (candidateId) decisions[candidateId] = normalizeCandidateDecision(element.value);
  }
  return decisions;
}

function candidateReviewUpdateMapFromDom() {
  if (typeof document === "undefined") return {};
  const updates = {};
  for (const element of document.querySelectorAll("[data-candidate-decision]")) {
    const candidateId = element.dataset?.candidateDecision || "";
    if (!candidateId) continue;
    updates[candidateId] = {
      ...(updates[candidateId] || {}),
      decision: normalizeCandidateDecision(element.value)
    };
  }
  for (const element of document.querySelectorAll("[data-candidate-note]")) {
    const candidateId = element.dataset?.candidateNote || "";
    if (!candidateId) continue;
    updates[candidateId] = {
      ...(updates[candidateId] || {}),
      note: normalizeCandidateReviewNote(element.value)
    };
  }
  for (const element of document.querySelectorAll("[data-candidate-screening]")) {
    const candidateId = element.dataset?.candidateScreening || "";
    if (!candidateId) continue;
    updates[candidateId] = {
      ...(updates[candidateId] || {}),
      screeningStage: normalizeCandidateScreeningStage(element.value)
    };
  }
  for (const element of document.querySelectorAll("[data-candidate-exclusion-reason]")) {
    const candidateId = element.dataset?.candidateExclusionReason || "";
    if (!candidateId) continue;
    updates[candidateId] = {
      ...(updates[candidateId] || {}),
      exclusionReason: normalizeCandidateExclusionReason(element.value)
    };
  }
  return updates;
}

function applyCandidateDecisions(records, updates, now) {
  return (records || []).map((record) => {
    const update = candidateReviewUpdateForRecord(updates, record.candidateId);
    if (!update) return record;
    const nextDecision = update.decision ? normalizeCandidateDecision(update.decision) : normalizeCandidateDecision(record.decision);
    const currentNote = candidateReviewNote(record);
    const currentScreeningStage = candidateReviewScreeningStage(record);
    const currentExclusionReason = candidateReviewExclusionReason(record);
    const hasNoteUpdate = Object.prototype.hasOwnProperty.call(update, "note");
    const hasScreeningUpdate = Object.prototype.hasOwnProperty.call(update, "screeningStage");
    const hasExclusionReasonUpdate = Object.prototype.hasOwnProperty.call(update, "exclusionReason");
    const nextNote = hasNoteUpdate ? normalizeCandidateReviewNote(update.note) : currentNote;
    const nextScreeningStage = hasScreeningUpdate ? normalizeCandidateScreeningStage(update.screeningStage) : currentScreeningStage;
    const nextExclusionReason = hasExclusionReasonUpdate ? normalizeCandidateExclusionReason(update.exclusionReason) : currentExclusionReason;
    const decisionChanged = nextDecision !== normalizeCandidateDecision(record.decision);
    const noteChanged = hasNoteUpdate && nextNote !== currentNote;
    const screeningChanged = hasScreeningUpdate && nextScreeningStage !== currentScreeningStage;
    const exclusionReasonChanged = hasExclusionReasonUpdate && nextExclusionReason !== currentExclusionReason;
    if (!decisionChanged && !noteChanged && !screeningChanged && !exclusionReasonChanged) return record;
    const review = { ...(record.review || {}) };
    const reviewUpdatedAt = now || new Date().toISOString();
    if (hasNoteUpdate) {
      if (nextNote) {
        review.note = nextNote;
        review.updatedAt = reviewUpdatedAt;
      } else {
        delete review.note;
        if (Object.keys(review).length) review.updatedAt = reviewUpdatedAt;
      }
    }
    if (hasScreeningUpdate) {
      if (nextScreeningStage && nextScreeningStage !== "not_started") {
        review.screeningStage = nextScreeningStage;
        review.updatedAt = reviewUpdatedAt;
      } else {
        delete review.screeningStage;
        if (Object.keys(review).length) review.updatedAt = reviewUpdatedAt;
      }
    }
    if (hasExclusionReasonUpdate) {
      if (nextExclusionReason) {
        review.exclusionReason = nextExclusionReason;
        review.updatedAt = reviewUpdatedAt;
      } else {
        delete review.exclusionReason;
        if (Object.keys(review).length) review.updatedAt = reviewUpdatedAt;
      }
    }
    const nextRecord = {
      ...record,
      decision: nextDecision,
      updatedAt: reviewUpdatedAt
    };
    if (Object.keys(review).length) nextRecord.review = review;
    else delete nextRecord.review;
    return nextRecord;
  });
}

function candidateRecommendationUpdates(records, currentUpdates = {}) {
  return (records || []).reduce((updates, record) => {
    const currentUpdate = candidateReviewUpdateForRecord(currentUpdates, record.candidateId);
    const decision = recommendedCandidateDecision(record, currentUpdate?.decision || record.decision);
    if (decision) updates[record.candidateId] = { decision };
    return updates;
  }, {});
}

function recommendedCandidateDecision(record, currentDecision) {
  const current = normalizeCandidateDecision(currentDecision);
  if (current !== "user_pending") return "";
  const recommended = record?.priority?.recommendedDecision ? normalizeCandidateDecision(record.priority.recommendedDecision) : "";
  if (!recommended || recommended === current) return "";
  const tier = record?.priority?.tier || "";
  if (record?.quality?.dedupeStatus === "duplicate" || tier === "duplicate") return recommended === "exclude" ? "exclude" : "";
  if (!["high", "medium"].includes(tier)) return "";
  return recommended;
}

function mergeCandidateReviewUpdates(...updateMaps) {
  return updateMaps.reduce((merged, updates) => {
    for (const [candidateId, update] of Object.entries(updates || {})) {
      const value = typeof update === "string" ? { decision: update } : update;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      merged[candidateId] = {
        ...(merged[candidateId] || {}),
        ...value
      };
    }
    return merged;
  }, {});
}

function candidateReviewUpdateForRecord(updates, candidateId) {
  if (!updates || !candidateId || !Object.prototype.hasOwnProperty.call(updates, candidateId)) return null;
  const update = updates[candidateId];
  if (typeof update === "string") return { decision: update };
  if (update && typeof update === "object" && !Array.isArray(update)) return update;
  return null;
}

function candidateReviewNote(record) {
  return normalizeCandidateReviewNote(record?.review?.note ?? record?.reviewNote ?? record?.manualNote ?? "");
}

function normalizeCandidateReviewNote(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 2000);
}

function candidateReviewScreeningStage(record) {
  return normalizeCandidateScreeningStage(record?.review?.screeningStage ?? record?.screeningStage ?? "");
}

function normalizeCandidateScreeningStage(value) {
  const stage = String(value || "").trim();
  return ZMS_CANDIDATE_SCREENING_STAGES.includes(stage) ? stage : "not_started";
}

function candidateReviewExclusionReason(record) {
  return normalizeCandidateExclusionReason(record?.review?.exclusionReason ?? record?.exclusionReason ?? "");
}

function normalizeCandidateExclusionReason(value) {
  const reason = String(value || "").trim();
  return ZMS_CANDIDATE_EXCLUSION_REASONS.includes(reason) ? reason : "";
}

function importableCandidateRecords(records) {
  return (records || []).filter((record) => {
    if (normalizeCandidateDecision(record.decision) !== "include") return false;
    if (record.quality?.dedupeStatus === "duplicate") return false;
    if (record.quality?.isAbstractOnly) return false;
    if (record.importStatus === "imported" || record.importStatus === "skipped_duplicate") return false;
    return true;
  });
}

async function importCandidateIntoZotero(record, contextItem, now = new Date().toISOString()) {
  try {
    const existing = await findExistingZoteroCandidateItem(record, contextItem);
    if (existing) {
      await addItemToCurrentCollection(existing, contextItem);
      return {
        candidateId: record.candidateId,
        action: "skipped_duplicate",
        zoteroItemID: existing.id,
        zoteroItemKey: existing.key,
        at: now,
        message: "Existing Zotero item matched before import"
      };
    }
    const item = new Zotero.Item("journalArticle");
    item.libraryID = contextItem?.libraryID || Zotero.Libraries?.userLibraryID;
    setCandidateItemFields(item, record);
    setCandidateItemCreators(item, record.authors || []);
    const itemID = await item.saveTx();
    await addItemToCurrentCollection(item, contextItem);
    return {
      candidateId: record.candidateId,
      action: "imported",
      zoteroItemID: itemID || item.id,
      zoteroItemKey: item.key,
      at: now,
      message: "Imported metadata-only Zotero item"
    };
  } catch (err) {
    return {
      candidateId: record.candidateId,
      action: "failed",
      at: now,
      error: safeError(err)
    };
  }
}

async function findExistingZoteroCandidateItem(record, contextItem) {
  if (!Zotero.Search) return null;
  const libraryID = contextItem?.libraryID || Zotero.Libraries?.userLibraryID;
  const doi = record.ids?.doi;
  if (doi) {
    const doiMatch = await findZoteroItemBySearch(libraryID, [["DOI", "is", doi]]);
    if (doiMatch) return doiMatch;
  }
  const title = normalizedCandidateTitle(record.title);
  if (!title) return null;
  return findZoteroItemBySearch(libraryID, [["title", "contains", record.title]], (item) => {
    return normalizedCandidateTitle(zoteroItemTitle(item)) === title;
  });
}

async function findZoteroItemBySearch(libraryID, conditions, predicate = () => true) {
  try {
    const search = new Zotero.Search();
    search.libraryID = libraryID;
    for (const [field, operator, value] of conditions) {
      search.addCondition(field, operator, value);
    }
    const ids = await search.search();
    for (const id of Array.isArray(ids) ? ids : []) {
      const item = await zoteroItemById(id);
      if (item && predicate(item)) return item;
    }
  } catch (_err) {
    // Search conditions vary across Zotero versions; a failed fallback should not block import.
  }
  return null;
}

async function zoteroItemById(id) {
  if (!id) return null;
  if (typeof Zotero.Items?.getAsync === "function") return Zotero.Items.getAsync(id);
  if (typeof Zotero.Items?.get === "function") return Zotero.Items.get(id);
  return null;
}

function zoteroItemTitle(item) {
  return item?.getField?.("title") || item?.fields?.title || item?.title || item?.getDisplayTitle?.() || "";
}

function normalizedCandidateTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s:;,._()[\]{}'"!?-]+/g, " ")
    .trim();
}

function setCandidateItemFields(item, record) {
  setItemFieldSafe(item, "title", record.title);
  setItemFieldSafe(item, "date", record.year ? String(record.year) : "");
  setItemFieldSafe(item, "DOI", record.ids?.doi);
  setItemFieldSafe(item, "url", record.sourceUrl);
  setItemFieldSafe(item, "abstractNote", record.abstract);
  setItemFieldSafe(item, "publicationTitle", record.venue);
  setItemFieldSafe(item, "extra", candidateExtraField(record));
}

function setItemFieldSafe(item, field, value) {
  const text = String(value || "").trim();
  if (!text) return;
  try {
    item.setField(field, text);
  } catch (_err) {
    if (field === "DOI") {
      const existing = item.getField?.("extra") || "";
      item.setField("extra", [existing, `DOI: ${text}`].filter(Boolean).join("\n"));
    }
  }
}

function candidateExtraField(record) {
  return [
    record.ids?.arxivId ? `arXiv: ${record.ids.arxivId}` : "",
    record.ids?.semanticScholarId ? `Semantic Scholar: ${record.ids.semanticScholarId}` : "",
    record.pdfUrl ? `Open PDF: ${record.pdfUrl}` : "",
    record.candidateId ? `Candidate ID: ${record.candidateId}` : "",
    record.sources?.length ? `Candidate Sources: ${record.sources.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}

function setCandidateItemCreators(item, authors) {
  const creators = (authors || []).map((name) => candidateCreatorFromName(name)).filter(Boolean);
  if (!creators.length) return;
  if (typeof item.setCreators === "function") {
    item.setCreators(creators);
  } else {
    item.creators = creators;
  }
}

function candidateCreatorFromName(name) {
  const text = String(name || "").trim();
  if (!text) return null;
  if (text.includes(",")) {
    const [family, given] = text.split(",", 2).map((part) => part.trim());
    return { creatorType: "author", firstName: given || "", lastName: family || text, fieldMode: 0 };
  }
  const parts = text.split(/\s+/);
  if (parts.length === 1) return { creatorType: "author", name: text, fieldMode: 1 };
  return { creatorType: "author", firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1), fieldMode: 0 };
}

async function addItemToCurrentCollection(item, contextItem) {
  const collectionID = currentCollectionID(contextItem);
  if (!collectionID || typeof item.addToCollection !== "function") return;
  item.addToCollection(collectionID);
  if (typeof item.saveTx === "function") await item.saveTx();
}

function currentCollectionID(contextItem) {
  const collectionIDs = typeof contextItem?.getCollections === "function" ? contextItem.getCollections() : [];
  return Array.isArray(collectionIDs) && collectionIDs.length ? collectionIDs[0] : null;
}

function applyCandidateImportResults(records, resultById, now = new Date().toISOString()) {
  return (records || []).map((record) => {
    const result = resultById.get(record.candidateId);
    if (!result) return record;
    return {
      ...record,
      importStatus: result.action,
      zoteroItemID: result.zoteroItemID,
      zoteroItemKey: result.zoteroItemKey,
      importError: result.error || "",
      importedAt: result.action === "imported" ? result.at || now : record.importedAt,
      updatedAt: now
    };
  });
}

function importResultLedgerEntries(records, resultById, now = new Date().toISOString()) {
  return (records || [])
    .map((record) => {
      const result = resultById.get(record.candidateId);
      if (!result) return null;
      return importLedgerEntryForCandidate(record, result.action, result.at || now, {
        zoteroItemID: result.zoteroItemID,
        zoteroItemKey: result.zoteroItemKey,
        message: result.message,
        error: result.error
      });
    })
    .filter(Boolean);
}

function pdfAttachableCandidateRecords(records) {
  return (records || []).filter((record) => {
    if (normalizeCandidateDecision(record.decision) !== "include") return false;
    if (record.pdfAttachmentStatus === "attached_pdf" || record.pdfAttachmentStatus === "missing_pdf") return false;
    return record.importStatus === "imported" || record.importStatus === "skipped_duplicate";
  });
}

async function attachCandidatePdfToZotero(record, contextItem, now = new Date().toISOString()) {
  try {
    if (!record.pdfUrl) {
      return {
        candidateId: record.candidateId,
        action: "missing_pdf",
        zoteroItemID: record.zoteroItemID,
        zoteroItemKey: record.zoteroItemKey,
        at: now,
        message: "No PDF URL available"
      };
    }
    const item = await candidateImportedZoteroItem(record, contextItem);
    if (!item) {
      return {
        candidateId: record.candidateId,
        action: "failed",
        zoteroItemID: record.zoteroItemID,
        zoteroItemKey: record.zoteroItemKey,
        at: now,
        error: "Imported Zotero item not found"
      };
    }
    const existing = await findExistingCandidatePdfAttachment(item, record.pdfUrl);
    if (existing) {
      return {
        candidateId: record.candidateId,
        action: "attached_pdf",
        zoteroItemID: item.id,
        zoteroItemKey: item.key || record.zoteroItemKey,
        attachmentKey: existing.key,
        at: now,
        message: "Existing PDF attachment found"
      };
    }
    const attachment = await createCandidatePdfAttachment(item, record);
    return {
      candidateId: record.candidateId,
      action: "attached_pdf",
      zoteroItemID: item.id,
      zoteroItemKey: item.key || record.zoteroItemKey,
      attachmentKey: attachment?.key,
      at: now,
      message: "Attached PDF from candidate URL"
    };
  } catch (err) {
    return {
      candidateId: record.candidateId,
      action: "failed",
      zoteroItemID: record.zoteroItemID,
      zoteroItemKey: record.zoteroItemKey,
      at: now,
      error: safeError(err)
    };
  }
}

async function candidateImportedZoteroItem(record, contextItem) {
  if (record.zoteroItemID) {
    const byId = await zoteroItemById(record.zoteroItemID);
    if (byId) return byId;
  }
  if (record.zoteroItemKey && Zotero.Items?.getByLibraryAndKey) {
    const libraryID = contextItem?.libraryID || Zotero.Libraries?.userLibraryID;
    return Zotero.Items.getByLibraryAndKey(libraryID, record.zoteroItemKey);
  }
  return null;
}

async function findExistingCandidatePdfAttachment(item, pdfUrl = "") {
  const attachmentIDs = typeof item?.getAttachments === "function" ? item.getAttachments() : [];
  for (const id of attachmentIDs || []) {
    const attachment = await zoteroItemById(id);
    if (!attachment) continue;
    const contentType = String(attachment.attachmentContentType || "").toLowerCase();
    const url = attachment.getField?.("url") || attachment.url || "";
    if (contentType === "application/pdf" && (!pdfUrl || url === pdfUrl)) return attachment;
  }
  return null;
}

async function createCandidatePdfAttachment(item, record) {
  const payload = {
    url: record.pdfUrl,
    parentItemID: item.id,
    libraryID: item.libraryID,
    contentType: "application/pdf",
    title: candidatePdfAttachmentTitle(record),
    renameIfAllowedType: true
  };
  if (typeof Zotero.Attachments?.importFromURL === "function") {
    return Zotero.Attachments.importFromURL(payload);
  }
  if (typeof Zotero.Attachments?.linkFromURL === "function") {
    return Zotero.Attachments.linkFromURL(payload);
  }
  throw new Error("Zotero PDF URL attachment API is unavailable");
}

function candidatePdfAttachmentTitle(record) {
  const title = String(record.title || "Candidate PDF").trim();
  return title.toLowerCase().endsWith(".pdf") ? title : `${title}.pdf`;
}

function applyCandidatePdfAttachmentResults(records, resultById, now = new Date().toISOString()) {
  return (records || []).map((record) => {
    const result = resultById.get(record.candidateId);
    if (!result) return record;
    return {
      ...record,
      zoteroItemID: result.zoteroItemID ?? record.zoteroItemID,
      zoteroItemKey: result.zoteroItemKey || record.zoteroItemKey,
      pdfAttachmentStatus: result.action,
      pdfAttachmentKey: result.attachmentKey,
      pdfAttachmentError: result.error || "",
      pdfAttachedAt: result.action === "attached_pdf" ? result.at || now : record.pdfAttachedAt,
      updatedAt: now
    };
  });
}

function pdfAttachmentLedgerEntries(records, resultById, now = new Date().toISOString()) {
  return (records || [])
    .map((record) => {
      const result = resultById.get(record.candidateId);
      if (!result) return null;
      return importLedgerEntryForCandidate(record, result.action, result.at || now, {
        zoteroItemID: result.zoteroItemID,
        zoteroItemKey: result.zoteroItemKey,
        attachmentKey: result.attachmentKey,
        message: result.message,
        error: result.error
      });
    })
    .filter(Boolean);
}

function reconcileCandidateDuplicateRecords(records, now = new Date().toISOString()) {
  const seen = new Map();
  const ledgerEntries = [];
  let duplicateCount = 0;
  const updatedRecords = (records || []).map((record) => {
    if (record.quality?.dedupeStatus === "duplicate" && (record.quality?.matchedCandidateId || record.quality?.matchedItemKey)) {
      return record;
    }
    const keys = candidateDuplicateIdentityKeys(record);
    const match = keys.map((key) => seen.get(key)).find(Boolean);
    if (match) {
      duplicateCount += 1;
      const updated = {
        ...record,
        quality: {
          ...(record.quality || {}),
          dedupeStatus: "duplicate",
          matchedCandidateId: match.candidateId,
          matchedItemKey: match.zoteroItemKey || record.quality?.matchedItemKey,
          reason: `matched candidate ${match.candidateId} in collection cache`
        },
        updatedAt: now
      };
      ledgerEntries.push(importLedgerEntryForCandidate(updated, "skipped_duplicate", now, {
        zoteroItemID: match.zoteroItemID || record.zoteroItemID,
        zoteroItemKey: match.zoteroItemKey || record.zoteroItemKey,
        message: `matched candidate ${match.candidateId} in collection cache`
      }));
      return updated;
    }
    for (const key of keys) {
      if (!seen.has(key)) seen.set(key, record);
    }
    return record;
  });
  return { records: updatedRecords, ledgerEntries, duplicateCount };
}

function candidateDuplicateIdentityKeys(record) {
  const keys = [];
  const doi = normalizeCandidateDoi(record.ids?.doi);
  if (doi) keys.push(`doi:${doi}`);
  const arxivId = normalizeCandidateArxivId(record.ids?.arxivId);
  if (arxivId) keys.push(`arxiv:${arxivId}`);
  if (record.zoteroItemKey) keys.push(`zotero:${record.zoteroItemKey}`);
  const title = normalizedCandidateTitle(record.title);
  const year = String(record.year || "").trim();
  if (title && (year || title.length >= 48)) keys.push(`title:${title}:${year}`);
  return keys;
}

function normalizeCandidateDoi(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
}

function normalizeCandidateArxivId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/\.pdf$/i, "")
    .replace(/^arxiv:/, "")
    .replace(/v\d+$/i, "");
}

function candidatePreviousDecisionMap(records) {
  return new Map((records || []).map((record) => [record.candidateId, normalizeCandidateDecision(record.decision)]));
}

function candidatePreviousReviewMap(records) {
  return new Map((records || []).map((record) => [record.candidateId, {
    decision: normalizeCandidateDecision(record.decision),
    note: candidateReviewNote(record),
    screeningStage: candidateReviewScreeningStage(record),
    exclusionReason: candidateReviewExclusionReason(record)
  }]));
}

function discoveredLedgerEntries(records, existingCandidateIds, now = new Date().toISOString()) {
  return (records || [])
    .filter((record) => !existingCandidateIds?.has?.(record.candidateId))
    .map((record) => importLedgerEntryForCandidate(record, "discovered", record.discoveredAt || now));
}

function decisionLedgerEntries(records, previousDecisions, changedDecisions, now = new Date().toISOString()) {
  return (records || [])
    .filter((record) => Object.prototype.hasOwnProperty.call(changedDecisions || {}, record.candidateId))
    .map((record) => {
      const previous = candidatePreviousReviewValue(previousDecisions?.get(record.candidateId));
      const current = {
        decision: normalizeCandidateDecision(record.decision),
        note: candidateReviewNote(record),
        screeningStage: candidateReviewScreeningStage(record),
        exclusionReason: candidateReviewExclusionReason(record)
      };
      const decisionChanged = previous.decision !== current.decision;
      const noteChanged = previous.note !== current.note;
      const screeningChanged = previous.screeningStage !== current.screeningStage;
      const exclusionReasonChanged = previous.exclusionReason !== current.exclusionReason;
      if (!decisionChanged && !noteChanged && !screeningChanged && !exclusionReasonChanged) return null;
      const action = decisionChanged ? decisionLedgerAction(record.decision) : (screeningChanged || exclusionReasonChanged ? "review_screening" : "review_note");
      return importLedgerEntryForCandidate(record, action, now, {
        reviewNote: current.note,
        screeningStage: current.screeningStage,
        exclusionReason: current.exclusionReason,
        previousDecision: previous.decision,
        previousReviewNote: previous.note,
        previousScreeningStage: previous.screeningStage,
        previousExclusionReason: previous.exclusionReason,
        decisionChanged,
        noteChanged,
        screeningChanged,
        exclusionReasonChanged
      });
    })
    .filter((entry) => !!entry?.action);
}

function candidatePreviousReviewValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      decision: normalizeCandidateDecision(value.decision),
      note: normalizeCandidateReviewNote(value.note),
      screeningStage: normalizeCandidateScreeningStage(value.screeningStage),
      exclusionReason: normalizeCandidateExclusionReason(value.exclusionReason)
    };
  }
  return {
    decision: normalizeCandidateDecision(value),
    note: "",
    screeningStage: "not_started",
    exclusionReason: ""
  };
}

function decisionLedgerAction(decision) {
  if (decision === "include") return "confirmed";
  if (decision === "exclude") return "excluded";
  if (decision === "to_read") return "to_read";
  return "";
}

function importLedgerEntryForCandidate(record, action, at, extra = {}) {
  return {
    id: `${record.candidateId}:${action}:${at}`,
    candidateId: record.candidateId,
    action,
    at,
    title: record.title,
    collectionKey: record.collectionKey,
    zoteroItemID: extra.zoteroItemID,
    doi: record.ids?.doi,
    arxivId: record.ids?.arxivId,
    sourceUrl: record.sourceUrl,
    decision: normalizeCandidateDecision(record.decision),
    dedupeStatus: record.quality?.dedupeStatus,
    zoteroItemKey: extra.zoteroItemKey,
    attachmentKey: extra.attachmentKey,
    reviewNote: extra.reviewNote ?? candidateReviewNote(record),
    screeningStage: extra.screeningStage ?? candidateReviewScreeningStage(record),
    exclusionReason: extra.exclusionReason ?? candidateReviewExclusionReason(record),
    previousDecision: extra.previousDecision,
    previousReviewNote: extra.previousReviewNote,
    previousScreeningStage: extra.previousScreeningStage,
    previousExclusionReason: extra.previousExclusionReason,
    decisionChanged: extra.decisionChanged,
    noteChanged: extra.noteChanged,
    screeningChanged: extra.screeningChanged,
    exclusionReasonChanged: extra.exclusionReasonChanged,
    message: extra.message,
    error: extra.error
  };
}

function normalizeCandidateDecision(value) {
  if (value === "include" || value === "exclude" || value === "to_read") return value;
  return "user_pending";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function normalizeSessionId(value) {
  return String(value || "")
    .trim()
    .replace(/\.jsonl$/i, "")
    .replace(/[\\/]/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 96);
}

function makeMessage(role, content, extra = {}) {
  return { id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`, role, content, time: new Date().toISOString(), ...extra };
}

async function copyText(text) {
  const value = String(text || "");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_err) {
    // Fall through to the Zotero/XUL clipboard helper.
  }
  try {
    return copyTextWithXulClipboard(value);
  } catch (_err) {
    return false;
  }
}

function copySelectedWorkbenchText(event) {
  const text = selectedWorkbenchText();
  if (!text) return false;
  try {
    if (event?.clipboardData?.setData) {
      event.clipboardData.setData("text/plain", text);
      event.preventDefault?.();
      return true;
    }
  } catch (_err) {
    // Fall through to the Zotero/XUL clipboard helper.
  }
  if (copyTextWithXulClipboard(text)) {
    event?.preventDefault?.();
    return true;
  }
  return false;
}

function selectedWorkbenchText() {
  const selection = window.getSelection?.() || document.getSelection?.();
  const text = String(selection?.toString?.() || "");
  if (!text.trim()) return "";
  const messages = document.getElementById("zms-messages");
  if (messages && !selectionTouchesNode(selection, messages)) return "";
  return selectedWorkbenchContentText(selection) || text;
}

function selectedWorkbenchContentText(selection) {
  let fragment = null;
  try {
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    fragment = range?.cloneContents?.() || null;
  } catch (_err) {
    return "";
  }
  if (!fragment) return "";
  for (const node of selectableCleanupNodes(fragment)) {
    removeNode(node);
  }
  const text = normalizedSelectedText(fragment.textContent || "");
  return text.trim() ? text : "";
}

function selectableCleanupNodes(root) {
  if (!root?.querySelectorAll) return [];
  try {
    return Array.from(root.querySelectorAll("[data-zms-copy-exclude='1'], .zms-message-toolbar, .zms-message-actions, button"));
  } catch (_err) {
    return [];
  }
}

function removeNode(node) {
  if (!node) return;
  if (typeof node.remove === "function") {
    node.remove();
    return;
  }
  node.parentNode?.removeChild?.(node);
}

function normalizedSelectedText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function selectionTouchesNode(selection, root) {
  if (!selection || !root) return false;
  const anchorNode = selection.anchorNode || null;
  const focusNode = selection.focusNode || null;
  if (nodeIsInside(anchorNode, root) || nodeIsInside(focusNode, root)) return true;
  try {
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    const common = range?.commonAncestorContainer || null;
    if (nodeIsInside(common, root)) return true;
    if (range?.intersectsNode) return !!range.intersectsNode(root);
  } catch (_err) {
    // Some XUL selections do not expose a DOM Range; anchor/focus checks are enough.
  }
  return false;
}

function nodeIsInside(node, root) {
  let current = node?.nodeType === 1 ? node : node?.parentNode;
  while (current) {
    if (current === root) return true;
    current = current.parentNode;
  }
  return false;
}

function copyTextWithXulClipboard(value) {
  const helper = Cc?.["@mozilla.org/widget/clipboardhelper;1"]?.getService?.(Ci?.nsIClipboardHelper);
  if (!helper?.copyString) return false;
  helper.copyString(String(value || ""));
  return true;
}

function safeError(err) {
  return redact(err?.message || err || "Unknown error");
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("load", () => {
    ZoteroMarkdownSummaryWorkbench.init();
  }, { once: true });
}

function providerErrorText(status, text) {
  return `HTTP ${status}: ${redact(providerErrorDetail(text))}`;
}

function providerErrorDetail(text) {
  const parsed = safeParseJSON(text);
  if (parsed) {
    const responseError = streamErrorText(parsed);
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

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ak|xai|gsk|pplx|ms|rk|hf|deepinfra|cloudflare|cf)[-_][A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .slice(0, 800);
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

function sanitizeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

function normalizeHeading(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const WORKBENCH_MODEL_LIST_MAX_PAGES = 5;

function workbenchStringField(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function workbenchModelListRequestForProfile(profile) {
  if (!profile?.capabilities?.modelList || profile.endpointMode === "full_url") return null;
  const url = workbenchModelsEndpointForProfile(profile);
  if (!url) return null;
  return { url, headers: headersForProfile(profile), profile };
}

function workbenchModelsEndpointForProfile(profile) {
  if (!profile?.capabilities?.modelList || profile.endpointMode === "full_url") return "";
  const base = stripKnownProviderEndpointPath(profile.baseURL);
  if (!base) return "";
  if (profile.protocol === "anthropic_messages") {
    return /\/v\d+$/i.test(providerURLPath(base)) ? appendProviderURLPath(base, "models") : appendProviderURLPath(base, "v1/models");
  }
  return appendProviderURLPath(openAICompatibleBaseWithVersion(base), "models");
}

async function workbenchFetchModelOptions(request) {
  const items = [];
  const seen = new Set();
  let nextUrl = request.url;
  let headers = request.headers;
  const usedFallbackFields = [];
  for (let page = 0; nextUrl && page < WORKBENCH_MODEL_LIST_MAX_PAGES; page += 1) {
    if (seen.has(nextUrl)) break;
    seen.add(nextUrl);
    let response;
    let text = "";
    let data = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(nextUrl, { method: "GET", headers });
      text = await response.text();
      data = safeParseJSON(text);
      const fallbackFields = providerCompatibilityFallbackFields(request.profile?.protocol, {}, response.status, text, usedFallbackFields);
      if (!fallbackFields.length) break;
      headers = providerRequestHeadersWithFallback(headers, fallbackFields);
      usedFallbackFields.push(...fallbackFields);
    }
    if (!response.ok) {
      throw new Error(providerErrorText(response.status, text));
    }
    const errorText = streamErrorText(data);
    if (errorText) {
      throw new Error(`Provider error: ${redact(errorText)}`);
    }
    items.push(...workbenchModelListItemsFromResponse(data));
    nextUrl = workbenchNextModelListURL(nextUrl, data);
  }
  return workbenchModelOptionsFromItems(items);
}

function workbenchModelListItemsFromResponse(data, depth = 0) {
  const direct = workbenchDirectModelListItemsFromResponse(data);
  if (direct.length) return direct;
  if (depth >= 2 || !data || typeof data !== "object" || Array.isArray(data)) return [];
  for (const key of MODEL_LIST_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const items = workbenchModelListItemsFromResponse(value, depth + 1);
    if (items.length) return items;
  }
  return [];
}

function workbenchNextModelListURL(currentUrl, data) {
  const envelope = workbenchModelListPaginationEnvelope(data);
  if (!envelope) return "";
  const direct = workbenchStringField(envelope.next_page, envelope.nextPage, envelope.next, envelope.next_url, envelope.nextUrl, envelope.nextPageUrl);
  if (direct) return workbenchModelListURLFromNextValue(currentUrl, direct);
  const hasMore = envelope.has_more === true || envelope.hasMore === true;
  const nextCursor = workbenchStringField(envelope.next_cursor, envelope.nextCursor);
  const nextPageToken = workbenchStringField(envelope.next_page_token, envelope.nextPageToken, envelope.next_token, envelope.nextToken);
  if (!hasMore && !nextCursor && !nextPageToken) return "";
  const pairs = [
    ["after_id", workbenchStringField(envelope.last_id, envelope.lastId, envelope.after_id, envelope.afterId)],
    ["page_token", nextPageToken],
    ["cursor", nextCursor],
    ["after", hasMore ? workbenchStringField(envelope.cursor, envelope.after) : ""]
  ];
  for (const [param, token] of pairs) {
    if (token) return workbenchUrlWithQueryParam(currentUrl, param, token);
  }
  return "";
}

function workbenchDirectModelListItemsFromResponse(data) {
  if (Array.isArray(data)) return data;
  const fields = [
    "data",
    "results",
    "objects",
    "entries",
    "records",
    "resources",
    "nodes",
    "edges",
    "models",
    "model",
    "items",
    "list",
    "model_list",
    "modelList",
    "available_models",
    "availableModels",
    "model_names",
    "modelNames",
    "deployments",
    "deployment_list",
    "deploymentList",
    "engines",
    "engine_list",
    "engineList"
  ];
  for (const field of fields) {
    if (Array.isArray(data?.[field])) return data[field];
  }
  if (Array.isArray(data?.models?.data)) return data.models.data;
  if (Array.isArray(data?.models?.items)) return data.models.items;
  if (Array.isArray(data?.results?.data)) return data.results.data;
  if (Array.isArray(data?.objects?.data)) return data.objects.data;
  for (const field of fields) {
    const items = workbenchModelListItemsFromObjectMap(data?.[field]);
    if (items.length) return items;
  }
  return [];
}

function workbenchModelListItemsFromObjectMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  if (workbenchModelOptionFromItem(value).id) return [];
  if (workbenchDirectModelListItemsFromResponse(value).length) return [];
  const items = [];
  for (const [key, item] of Object.entries(value)) {
    const id = String(key || "").trim();
    if (!id || workbenchModelListMapMetadataKeys().has(id)) continue;
    if (typeof item === "string") {
      const label = item.trim();
      if (label) items.push({ id, label });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const option = workbenchModelOptionFromItem(item);
    items.push(option.id ? item : { ...item, id });
  }
  return items;
}

function workbenchModelListMapMetadataKeys() {
  return new Set([
    "data",
    "items",
    "models",
    "results",
    "objects",
    "metadata",
    "meta",
    "pagination",
    "paging",
    "page",
    "links",
    "object",
    "type",
    "total",
    "count",
    "has_more",
    "hasMore",
    "next",
    "next_url",
    "nextUrl",
    "next_page",
    "nextPage",
    "next_cursor",
    "nextCursor",
    "next_page_token",
    "nextPageToken"
  ]);
}

function workbenchModelListPaginationEnvelope(data, depth = 0) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (workbenchHasModelListPaginationFields(data)) return data;
  if (depth >= 2) return null;
  for (const key of MODEL_LIST_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const envelope = workbenchModelListPaginationEnvelope(value, depth + 1);
    if (envelope) return envelope;
  }
  return null;
}

function workbenchHasModelListPaginationFields(data) {
  return !!workbenchStringField(
    data?.next_page,
    data?.nextPage,
    data?.next,
    data?.next_url,
    data?.nextUrl,
    data?.nextPageUrl,
    data?.next_cursor,
    data?.nextCursor,
    data?.next_page_token,
    data?.nextPageToken,
    data?.next_token,
    data?.nextToken
  )
    || data?.has_more === true
    || data?.hasMore === true;
}

function workbenchModelListURLFromNextValue(currentUrl, nextValue) {
  if (/^https?:\/\//i.test(nextValue) || nextValue.startsWith("/") || nextValue.startsWith("?")) {
    try { return new URL(nextValue, currentUrl).toString(); } catch (_err) { return ""; }
  }
  return workbenchUrlWithQueryParam(currentUrl, "page", nextValue);
}

function workbenchUrlWithQueryParam(currentUrl, param, value) {
  try {
    const url = new URL(currentUrl);
    url.searchParams.set(param, value);
    return url.toString();
  } catch (_err) { return ""; }
}

function workbenchModelOptionsFromItems(source) {
  const map = new Map();
  for (const item of source) {
    const option = workbenchModelOptionFromItem(item);
    if (option.id && !map.has(option.id)) map.set(option.id, option);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function workbenchModelOptionFromItem(item, depth = 0) {
  if (typeof item === "string") {
    const id = item.trim();
    return { id, label: id };
  }
  if (!item || typeof item !== "object") return { id: "", label: "" };
  const id = workbenchStringField(
    item?.id,
    item?.model,
    item?.model_id,
    item?.modelId,
    item?.model_name,
    item?.modelName,
    item?.deployment,
    item?.deployment_id,
    item?.deploymentId,
    item?.engine,
    item?.engine_id,
    item?.engineId,
    item?.uid,
    item?.key,
    item?.identifier,
    item?.canonical_slug,
    item?.canonicalSlug,
    item?.model_slug,
    item?.modelSlug,
    item?.name,
    item?.value,
    item?.slug
  );
  const label = workbenchStringField(
    item?.display_name,
    item?.displayName,
    item?.display_label,
    item?.displayLabel,
    item?.label,
    item?.title,
    item?.model_name,
    item?.modelName,
    item?.name,
    id
  );
  if (!id && depth < 2) {
    for (const key of ["node", "model", "deployment", "engine", "resource", "item", "value"]) {
      const nested = item?.[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const option = workbenchModelOptionFromItem(nested, depth + 1);
        if (option.id) return option;
      }
    }
  }
  return { id, label };
}

function isOllamaProfile(profile) {
  if (!profile) return false;
  if (profile.id === "ollama") return true;
  const base = String(profile.baseURL || "");
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1):11434/i.test(base);
}

async function workbenchFetchOllamaTags(profile) {
  const base = String(profile.baseURL || "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${base}/api/tags`;
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(providerErrorText(response.status, text));
  }
  const data = safeParseJSON(text);
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .map((model) => {
      const id = String(model?.name || model?.model || "").trim();
      if (!id) return null;
      const details = model?.details || {};
      const parts = [details.family, details.parameter_size, details.quantization_level].filter(Boolean);
      const label = parts.length ? `${id} (${parts.join(" · ")})` : id;
      return { id, label };
    })
    .filter(Boolean);
}

window.ZoteroMarkdownSummaryWorkbench = ZoteroMarkdownSummaryWorkbench;
