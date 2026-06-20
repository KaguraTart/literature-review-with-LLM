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
const LOCAL_AGENT_SUBSKILLS = ["ask-gemini", "ask-claude", "ask-opencode"];
const LOCAL_AGENT_SKILLS = {
  "ask-gemini": "ask_gemini",
  "ask-claude": "ask_claude",
  "ask-opencode": "ask_opencode",
  "ask-all-agents": "ask_all_agents",
  "ask-gemini-claude": "ask_all_agents",
  "check-local-agents": "check_local_agents"
};
const LOCAL_AGENT_TOOL_NAMES = new Set(Object.values(LOCAL_AGENT_SKILLS));
const LOCAL_AGENT_AGGREGATE_SKILLS = ["ask-all-agents", "ask-gemini-claude", "check-local-agents"];
const ZMS_PREF_PREFIX = "extensions.zoteroMarkdownSummary";
const ZMS_CHROME_CONTENT_URL = "chrome://zotero-markdown-summary/content/";
const MAX_COMPARISON_PAPERS = 5;

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
    pendingImages: []
  },

  async init() {
    if (this.state.initialized) return;
    this.state.initialized = true;
    this.bindActions();
    this.loadSettings();
    this.applyLanguage();
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
      await ensureDirectory(this.sessionDir());
      await ensureSkillTemplates(this.state.outputDir);
      this.renderPaper();
      this.renderProfiles();
      this.renderPromptPacks();
      await this.renderSkills();
      // Try to resume the most recent conversation for this item so the
      // user does not have to start over when they reopen the workbench.
      const latest = this.state.comparisonContexts.length ? null : await latestSessionForItem(this.state.item, this.state.outputDir);
      if (latest) {
        await this.loadSession(latest.path, { resume: true });
        this.setStatus(this.t("sessionResumed"));
      } else {
        this.state.sessionId = newSessionId();
        this.state.sessionStartedAt = Date.now();
        this.setStatus(this.t("ready"));
      }
      this.renderSessions();
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
      "zms-export-review-draft": () => this.exportReviewDraft(),
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
      "zms-save-profile-settings": () => this.saveProfileSettings(),
      "zms-test-profile-settings": () => this.testProfileSettings(),
      "zms-attach-image": () => this.chooseImages(),
      "zms-load-models-workbench": () => this.loadModelsForWorkbench(),
      "zms-new-conversation": () => this.newConversation(),
      "zms-compact-context": () => this.compactContext({ auto: false }),
      "zms-copy-session": () => this.copySession()
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
    this.state.outputDir = pref("outputDir");
    this.state.outputLanguage = normalizeOutputLanguage(pref("outputLanguage"));
    this.state.promptPackId = normalizePromptPackId(pref("promptPackId"));
    this.state.inputMode = normalizeInputMode(pref("inputMode"));
    this.state.stream = normalizeBoolean(pref("stream"), true);
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
    setText("zms-save-profile-settings", this.t("save"));
    setText("zms-test-profile-settings", this.t("saveAndTest"));
    setText("zms-profile-name-label", this.t("profileName"));
    setText("zms-profile-base-url-label", this.t("baseURL"));
    setText("zms-profile-api-key-label", this.t("apiKey"));
    setText("zms-profile-model-label", this.t("model"));
    setText("zms-profile-image-text", this.t("imageInput"));
    setText("zms-prompt-pack-label", this.t("promptPack"));
    setText("zms-paper-heading", this.t("paper"));
    setText("zms-profile-label", this.t("provider"));
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
    setInputValue("zms-profile-name", profile.name || profile.id || "");
    setInputValue("zms-profile-base-url", profile.baseURL || "");
    setInputValue("zms-profile-api-key", profile.apiKey || "");
    setInputValue("zms-profile-model", profile.model || "");
    const imageInput = document.getElementById("zms-profile-image-input");
    if (imageInput) imageInput.checked = profile?.capabilities?.imageBase64 === true;
  },

  profileFromSettingsPanel() {
    if (!this.state.profile) return null;
    const next = hydrateProfile({
      ...this.state.profile,
      name: document.getElementById("zms-profile-name")?.value?.trim() || this.state.profile.name || this.state.profile.id,
      baseURL: document.getElementById("zms-profile-base-url")?.value?.trim() || this.state.profile.baseURL,
      apiKey: document.getElementById("zms-profile-api-key")?.value?.trim() || "",
      model: document.getElementById("zms-profile-model")?.value?.trim() || "",
      capabilities: {
        ...(this.state.profile.capabilities || {}),
        imageBase64: document.getElementById("zms-profile-image-input")?.checked === true
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
    this.renderProfiles();
    if (options.status !== false) this.setStatus(this.t("saved"));
    return profile;
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
      const response = await fetch(endpointForProfile(profile), {
        method: "POST",
        headers: headersForProfile(profile),
        body: JSON.stringify(withProviderBodyDefaults(profile, connectionTestBodyForProfile(profile)))
      });
      const text = await response.text();
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
    if (!profileHasUsableAuth(profile) && !isLocalEndpoint(endpointForProfile(profile))) {
      this.setStatus(this.t("apiKeyMissing"));
      return;
    }
    const request = workbenchModelListRequestForProfile(profile);
    if (!request) {
      this.setStatus(this.t("modelListUnavailable"));
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
      this.renderWorkbenchModelOptions(options);
      if (options.length) {
        if (!modelInput?.value?.trim()) {
          if (modelInput) modelInput.value = options[0].id;
        }
        this.setStatus(`${this.t("modelListLoaded")}: ${options.length}`);
      } else {
        this.setStatus(this.t("modelListEmpty"));
      }
    } catch (err) {
      this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
    }
  },

  renderWorkbenchModelOptions(modelOptions) {
    const list = document.getElementById("zms-workbench-model-options");
    if (!list) return;
    list.textContent = "";
    for (const entry of normalizeModelOptions(modelOptions)) {
      const option = document.createElement("option");
      option.value = entry.id;
      if (entry.label && entry.label !== entry.id) {
        option.setAttribute?.("label", entry.label);
      }
      list.appendChild(option);
    }
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
      if (!await IOUtils.exists(this.sessionDir())) {
        renderEmptySessionList(list, this.t("noSessions"));
        return;
      }
      const children = await IOUtils.getChildren(this.sessionDir());
      const recent = recentSessionFiles(children);
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
      await saveCandidateRecords(this.state.candidatePath, candidates);
      await appendImportLedgerEntries(ledgerPath, decisionLedgerEntries(candidates, previousReview, updates, now));
      await writeTextAtomic(reviewPath, renderCandidateReviewMarkdown(candidates, {
        item: this.state.item,
        outputLanguage: this.state.outputLanguage,
        generatedAt: now,
        candidatePath: this.state.candidatePath,
        ledgerPath,
        reviewPath
      }), `${reviewPath}.${Date.now()}.tmp`);
      this.state.candidates = candidates;
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
      this.state.messages = text.split(/\r?\n/).filter(Boolean)
        .map((line) => safeParseJSON(line))
        .filter(Boolean);
      // Compaction markers live as the last entry when present. Drop them
      // from the live view; the marker is still kept on disk inside the
      // jsonl so the conversation can be re-derived if the user undoes.
      this.state.compaction = this.state.messages.find((m) => m?.role === "compaction") || null;
      this.state.messages = this.state.messages.filter((m) => m?.role !== "compaction");
      const previousId = this.state.sessionId;
      this.state.sessionId = sessionIdFromPath(path) || this.state.sessionId;
      this.state.sessionStartedAt = sessionStartedAtFromId(this.state.sessionId);
      this.state.sessionIdBeforeResume = options.resume ? previousId : "";
      this.renderMessages();
      await this.renderSessions();
      this.setStatus(options.resume ? this.t("sessionResumed") : this.t("ready"));
    } catch (err) {
      this.setStatus(safeError(err));
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
    const body = document.createElement("div");
    body.className = "zms-message-body";
    renderMessageContent(body, message);
    if (message.role === "assistant") {
      const toolbar = document.createElement("div");
      toolbar.className = "zms-message-toolbar";
      const copy = document.createElement("button");
      copy.className = "zms-message-copy";
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
    if (message.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "zms-message-actions";
      const retry = document.createElement("button");
      retry.textContent = this.t("retry");
      retry.onclick = () => this.retryMessage(message);
      const write = document.createElement("button");
      write.textContent = this.t("write");
      write.onclick = () => this.openWriteback(message);
      actions.append(retry, write);
      block.appendChild(actions);
    }
    container.appendChild(block);
    container.scrollTop = container.scrollHeight;
    return body;
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
    const messageProfile = profileMessageMetadata(this.state.profile);
    const userMessage = makeMessage("user", displayContent, { skillId, images: images.map(imageMessageMetadata), ...messageProfile });
    this.state.messages.push(userMessage);
    this.appendMessageElement(userMessage);
    input.value = "";
    this.state.pendingImages = [];
    this.renderImageAttachments();
    const assistantMessage = makeMessage("assistant", "", { skillId, ...messageProfile });
    this.state.messages.push(assistantMessage);
    const assistantBody = this.appendMessageElement(assistantMessage);
    this.setStatus(this.t("thinking"));
    this.state.requestInFlight = true;
    this.state.lastProviderUsage = null;
    this.updateComposerState();
    try {
      this.state.abortController = new AbortController();
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
      await this.saveSession();
      this.setStatus(this.t("ready"));
    } catch (err) {
      assistantMessage.content = safeError(err);
      renderMessageContent(assistantBody, assistantMessage);
      this.setStatus(safeError(err));
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
      this.state.abortController?.signal
    );
    if (!response.ok) {
      throw new Error(providerErrorText(response.status, await response.text()));
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
    return PathUtils.join(this.state.outputDir, "sessions", this.state.item?.key || "unknown");
  },

  sessionPath() {
    return PathUtils.join(this.sessionDir(), sessionFilenameFor(this.state.sessionId));
  },

  async saveSession(options = {}) {
    try {
      await ensureDirectory(this.sessionDir());
      const compactionEntry = this.state.compaction || null;
      const allLines = [
        ...this.state.messages.map((message) => JSON.stringify({
          ...message,
          itemKey: this.state.item?.key,
          profileId: message.profileId || this.state.profile?.id,
          profileName: message.profileName || this.state.profile?.name,
          protocol: message.protocol || this.state.profile?.protocol,
          model: message.model || this.state.profile?.model,
          uiLanguage: this.state.uiLanguage,
          outputLanguage: this.state.outputLanguage
        })),
        ...(compactionEntry ? [JSON.stringify({
          ...compactionEntry,
          itemKey: this.state.item?.key,
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
        await linkOrCreateChatAttachment(this.state.item, this.state.item.key, mdPath, this.state.sessionId);
      }
      await this.renderSessions();
      if (!options.quiet) this.setStatus(this.t("saved"));
    } catch (err) {
      this.setStatus(`${this.t("saveFailed")}: ${safeError(err)}`);
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
        contextSourceHash: this.state.contextSourceHash
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
        contextSourceHash: this.state.contextSourceHash
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
  return ["minimax", "openai", "openai_compatible", "openai_responses_compatible", "anthropic", "anthropic_compatible", "gemini", "azure_openai", "github_models", "fireworks", "cerebras", "nvidia_nim", "sambanova", "sambanova_responses", "sambanova_anthropic", "xai", "groq", "mistral", "together", "kimi", "perplexity", "deepseek", "deepseek_anthropic", "zai_anthropic", "openrouter", "dashscope", "siliconflow", "zhipu", "volcengine", "qianfan", "hunyuan", "ollama", "lm_studio", "local_agents"].map((provider, index) => {
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
  if (id === "github_models") return "github-models";
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
    model: String(source.model || defaults.model || "").trim(),
    capabilities: normalizeProviderCapabilities(source.capabilities, defaults.capabilities || {}),
    customHeaders: normalizeObjectStringMap(source.customHeaders) || normalizeObjectStringMap(defaults.customHeaders) || {},
    bodyExtra: normalizeObjectStringMap(source.bodyExtra) || normalizeObjectStringMap(defaults.bodyExtra) || {},
    isDefault: source.isDefault === true
  };
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
  const id = String(provider || "openai_compatible").trim();
  const commonCapabilities = { text: true, pdfBase64: false, imageBase64: true, fileReference: false, streaming: true, embeddings: false, jsonMode: false, toolUse: false, modelList: true };
  if (id === "openai") {
    return { id: "openai", name: "OpenAI", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://api.openai.com/v1", model: "", capabilities: { ...commonCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "openai_responses_compatible" || id === "openai-responses-compatible") {
    return { id: "openai-responses-compatible", name: "OpenAI Compatible Responses", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1", model: "", capabilities: { ...commonCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "anthropic") {
    return { id: "anthropic", name: "Anthropic", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://api.anthropic.com", model: "", capabilities: { ...commonCapabilities, pdfBase64: true }, bodyExtra: {} };
  }
  if (id === "anthropic_compatible" || id === "anthropic-compatible") {
    return { id: "anthropic-compatible", name: "Anthropic Compatible Messages", protocol: "anthropic_messages", endpointMode: "base_url", baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT", model: "", capabilities: commonCapabilities, bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false } };
  }
  if (id === "minimax") {
    return { id: "minimax", name: "MiniMax", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", capabilities: commonCapabilities, bodyExtra: { extra_body: { reasoning_split: true } } };
  }
  if (id === "gemini") {
    return { id: "gemini", name: "Gemini OpenAI Compatible", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "", capabilities: commonCapabilities, bodyExtra: {} };
  }
  if (id === "azure_openai" || id === "azure-openai") {
    return { id: "azure-openai", name: "Azure OpenAI", protocol: "openai_responses", endpointMode: "base_url", baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1", model: "", capabilities: { ...commonCapabilities, pdfBase64: true }, customHeaders: {}, bodyExtra: {} };
  }
  if (id === "github_models" || id === "github-models") {
    return { id: "github-models", name: "GitHub Models", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://models.github.ai/inference", model: "", capabilities: { ...commonCapabilities, modelList: false }, customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, bodyExtra: {} };
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
    return { id: "local-agents", name: "Local Agents", protocol: "openai_chat", endpointMode: "base_url", baseURL: "http://127.0.0.1:3333/v1", model: "", capabilities: { ...commonCapabilities, imageBase64: false, streaming: false, modelList: false }, bodyExtra: { localAgent: { endpoint: "http://127.0.0.1:3333/mcp", payloadMode: "jsonrpc", timeoutSeconds: 180, "ask-gemini": { tool: "ask_gemini" }, "ask-claude": { tool: "ask_claude" }, "ask-opencode": { tool: "ask_opencode" }, "ask-all-agents": { tool: "ask_all_agents" }, "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } }, "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } } } } };
  }
  return { id: "openai-compatible", name: "OpenAI Compatible Chat", protocol: "openai_chat", endpointMode: "base_url", baseURL: "https://api.openai.com/v1", model: "", capabilities: commonCapabilities, bodyExtra: {} };
}

function workbenchProviderFromProfile(profile, fallbackProvider) {
  if (profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent) return "local_agents";
  const id = String(profile?.id || fallbackProvider || "").trim();
  if (id === "moonshot") return "kimi";
  if (id === "github-models" || id === "github_models") return "github_models";
  if (id === "nvidia-nim" || id === "nvidia_nim") return "nvidia_nim";
  if (id === "sambanova-responses" || id === "sambanova_responses") return "sambanova_responses";
  if (id === "sambanova-anthropic" || id === "sambanova_anthropic") return "sambanova_anthropic";
  if (id === "zai-anthropic" || id === "zai_anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") return "zai_anthropic";
  if (id === "anthropic-compatible" || id === "anthropic_compatible") return "anthropic_compatible";
  if (id === "openai-responses-compatible" || id === "openai_responses_compatible") return "openai_responses_compatible";
  if (["fireworks", "cerebras", "sambanova", "xai", "groq", "mistral", "together", "kimi", "perplexity", "deepseek", "deepseek-anthropic", "deepseek_anthropic", "openrouter", "dashscope", "qwen", "siliconflow", "zhipu", "volcengine", "qianfan", "hunyuan", "ollama", "gemini"].includes(id)) return id;
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
  if (baseURL === "https://models.github.ai/inference" || baseURL === "https://models.github.ai/inference/chat/completions") return "github_models";
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
    parsed?.choices?.[0]?.message?.content,
    parsed?.result?.choices?.[0]?.message?.content,
    parsed?.result?.content?.[0]?.text
  ];
  for (const candidate of candidates) {
    const text = localAgentTextFromValue(candidate);
    if (text) return text;
  }
  return "";
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

function connectionTestBodyForProfile(profile) {
  const system = "You are a provider connection test endpoint. Reply with pong only.";
  if (profile.protocol === "anthropic_messages") {
    return {
      model: profile.model,
      system,
      max_tokens: 32,
      stream: false,
      messages: [{ role: "user", content: "ping" }]
    };
  }
  if (profile.protocol === "openai_responses") {
    return {
      model: profile.model,
      instructions: system,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "ping" }]
        }
      ],
      max_output_tokens: 32,
      stream: false
    };
  }
  return {
    model: profile.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: "ping" }
    ],
    ...openAIChatTokenLimit(profile, 32),
    stream: false,
    n: 1
  };
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
          version: "0.1.1"
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
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
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

function answerTextForMessage(message) {
  return splitThinkBlocks(message?.content || "").answer.trim();
}

function splitThinkBlocks(value) {
  const text = String(value || "");
  const reasoning = [];
  let answer = "";
  let cursor = 0;
  const pattern = /<think\b[^>]*>([\s\S]*?)(?:<\/think>|$)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    answer += text.slice(cursor, match.index);
    reasoning.push(match[1] || "");
    cursor = pattern.lastIndex;
    if (!/<\/think>/i.test(match[0])) {
      cursor = text.length;
      break;
    }
  }
  answer += text.slice(cursor);
  return {
    reasoning: reasoning.join("\n\n").trim(),
    answer: answer.trim()
  };
}

function profileCompactLabel(profile, modelLabel = "Model") {
  if (!profile) return modelLabel;
  const name = profile.name || profile.id || modelLabel;
  const model = profile.model || "";
  return model ? `${name} · ${model}` : name;
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
    title: item.getField("title") || item.key,
    authors: item.getCreators?.().map((creator) => [creator.firstName, creator.lastName].filter(Boolean).join(" ")).filter(Boolean) || [],
    year: item.getField("date") || "",
    doi: item.getField("DOI") || "",
    abstract: item.getField("abstractNote") || ""
  };
  const text = pdf ? String((await pdf.attachmentText) || "").trim() : "";
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
}

async function readChildNotes(item) {
  return (await readChildNotesWithCount(item)).text;
}

async function readChildNotesWithCount(item) {
  const noteIds = typeof item.getNotes === "function" ? item.getNotes() : [];
  const notes = [];
  for (const id of noteIds) {
    const note = Zotero.Items.get(id);
    const html = note?.getNote?.() || note?.getField?.("note") || "";
    const text = htmlToText(html);
    if (text) notes.push(text);
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
  const sections = proposalNoteSections(labels);
  const lines = [
    "---",
    "templateVersion: proposal-note-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `itemKey: ${yamlScalar(itemKey)}`,
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
      proposalFrame: "选题框架",
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
    proposalFrame: "Proposal Frame",
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
  const sections = journalOutlineSections(labels);
  const lines = [
    "---",
    "templateVersion: journal-outline-v1",
    `generatedAt: ${generatedAt}`,
    `collectionKey: ${yamlScalar(collectionKey)}`,
    `focalItemKey: ${yamlScalar(focal.itemKey)}`,
    `comparisonCount: ${comparisons.length}`,
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

function journalOutlineLabels(outputLanguage) {
  const zh = /^zh/i.test(String(outputLanguage || ""));
  if (zh) {
    return {
      title: "期刊/报告写作提纲",
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

function markdownTableCell(value) {
  const text = mdText(value);
  return text ? text.replace(/\|/g, "\\|").replace(/\n/g, "<br>") : "";
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
  if (await IOUtils.exists(path)) {
    const text = await readText(path);
    if (text.trim()) return `${text.trim()}\n\n${languageInstruction(outputLanguage)}`;
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
    return `${common}\n\n请结构化解析论文中的截图、图表、表格、公式截图或实验结果。优先结合图片附件、PDF/摘要上下文和用户问题；若没有图片附件，则只从文本上下文中抽取。输出 Markdown，并固定使用以下章节：\n\n## 对象识别\n- 类型：图、表、流程图、公式截图、实验结果、消融结果或其他。\n- 所属位置：如果能判断，写 Figure/Table 编号、标题、页码或上下文证据。\n- 研究作用：这张图/表在论文中承担的问题、方法、实验或结论角色。\n\n## 视觉 OCR 文本\n- 逐项转录能看清的标题、坐标轴、图例、表头、指标、数据集、模型名、公式符号和关键数值。\n- 看不清的内容写 [illegible]；可能识别错的内容标注 低置信度。\n- 保留原始单位、大小写、缩写和符号，不要自动改写。\n\n## 表格/数据重建\n- 如果图片中有表格或可读数值，用 Markdown 表格重建：字段至少包括 项目、数值/文本、单位、来源、置信度、备注。\n- 如果是折线图、柱状图或散点图，只重建能可靠读出的点或区间，并写明坐标轴、图例和读数依据。\n- 如果无法可靠重建，明确写“无法可靠重建”，不要补不存在的数据。\n\n## 结论与证据映射\n- 解释图/表想证明什么，以及它如何支持或限制论文主张。\n- 每条解释都标注证据来源：[image]、[metadata]、[abstract] 或 [chunk:<id>]。\n- 区分图片直接观察、文本上下文推断和低置信度判断。\n\n## 综述/复现可复用信息\n- 给出适合写进文献综述、实验对比、方法复现或后续问题的要点。\n- 明确可比较指标、实验条件、baseline、公平性风险和需要补查的原文位置。\n\n## 不确定性与复核清单\n- 列出模糊、遮挡、缺少上下文、模型无法可靠识别、需要人工放大或回到 PDF 原图核对的部分。\n\n不要编造看不清的数字；不要把文本上下文推断伪装成图片观察。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n論文中のスクリーンショット、図、表、数式画像、実験結果を構造化して解析してください。画像添付、PDF/要約コンテキスト、ユーザー質問を優先し、画像がない場合はテキスト根拠だけで抽出してください。Markdown で次の章を固定して使ってください: 対象識別、視覚 OCR テキスト、表/データ再構成、結論と根拠マッピング、レビュー/再現に使える情報、不確実性と確認リスト。読めない数値は [illegible] とし、推測しないでください。表や数値は、項目、値/テキスト、単位、出典、信頼度、備考を持つ Markdown 表として再構成してください。各解釈には [image]、[metadata]、[abstract]、[chunk:<id>] の根拠を付け、画像観察、テキスト推論、低信頼判断を区別してください。`;
  }
  return `${common}\n\nExtract structured information from screenshots, figures, tables, formula captures, or experimental-result panels. Prefer attached images plus the provided paper/PDF context and the user question; if no image is attached, extract only from the text context. Use Markdown with these exact sections:\n\n## Object Identification\n- Type: figure, table, flow chart, formula capture, experiment result, ablation result, or other.\n- Location: Figure/Table number, title, page, or contextual evidence when available.\n- Research role: problem, method, experiment, or conclusion role in the paper.\n\n## Visual OCR Text\n- Transcribe readable titles, axes, legends, headers, metrics, datasets, model names, formula symbols, and key numbers.\n- Write [illegible] for unreadable content and mark uncertain recognition as low-confidence.\n- Preserve original units, capitalization, abbreviations, and symbols.\n\n## Reconstructed Data Table\n- For tables or readable numbers, reconstruct a Markdown table with at least: Item, Value/Text, Unit, Source, Confidence, Notes.\n- For line/bar/scatter charts, reconstruct only reliably readable points or ranges, and state the axis, legend, and reading basis.\n- If reconstruction is unreliable, say so explicitly instead of filling missing values.\n\n## Interpretation And Evidence Map\n- Explain what the visual tries to prove and how it supports or limits the paper's claims.\n- Mark every interpretation with [image], [metadata], [abstract], or [chunk:<id>].\n- Separate direct visual observation, text-context inference, and low-confidence judgment.\n\n## Reusable Review Or Reproduction Notes\n- Extract points useful for a literature review, experiment comparison, method reproduction, or follow-up question.\n- Call out comparable metrics, experimental conditions, baselines, fairness risks, and original-PDF locations to verify.\n\n## Uncertainty And Review Checklist\n- List blur, occlusion, missing context, unreliable recognition, and items that need manual zooming or checking against the original PDF.\n\nDo not invent unreadable numbers, and do not present text-context inference as direct image observation.`;
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
  if (!pdfPath) {
    return { type: "text", source: "no_pdf_path", reason: "PDF path unavailable", images: normalizedImageAttachments(images) };
  }
  const base64 = await attachmentToBase64(pdfPath);
  if (!base64) {
    return { type: "text", source: "read_failed", reason: "Failed to encode PDF as base64", images: normalizedImageAttachments(images) };
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

function imageMessageMetadata(image) {
  return {
    name: image?.name || "image.png",
    mimeType: image?.mimeType || "image/png",
    size: Number(image?.size) || 0
  };
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
    setHeaderIfMissing(headers, "anthropic-version", "2023-06-01");
    if (shouldAddAnthropicDirectBrowserAccess(profile)) {
      setHeaderIfMissing(headers, "anthropic-dangerous-direct-browser-access", "true");
    }
  } else if (usesAzureOpenAIAuth(profile)) {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "api-key", profile.apiKey);
  } else {
    if (!hasExplicitAuthHeader(headers)) setHeaderIfMissing(headers, "authorization", profile.apiKey ? `Bearer ${profile.apiKey}` : "");
  }
  return headers;
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

function usesAzureOpenAIAuth(profile) {
  const id = String(profile?.id || "").toLowerCase();
  const baseURL = String(profile?.baseURL || "");
  return id === "azure-openai" || id === "azure_openai" || /\.openai\.azure\.com\/openai\/v1\/?$/i.test(baseURL) || /\.services\.ai\.azure\.com\/openai\/v1\/?$/i.test(baseURL);
}

function anthropicAuthHeaderName(profile) {
  const explicit = normalizeAuthHeaderName(profile?.authHeader || profile?.bodyExtra?.authHeader || profile?.bodyExtra?.anthropicAuthHeader);
  if (explicit) return explicit;
  const id = String(profile?.id || "").toLowerCase();
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  if (id === "anthropic-compatible" || id === "anthropic_compatible" || id === "deepseek-anthropic" || id === "deepseek_anthropic" || id === "zai-anthropic" || id === "zai_anthropic" || id === "sambanova-anthropic" || id === "sambanova_anthropic") return "authorization";
  if (baseURL === "https://api.deepseek.com/anthropic" || baseURL.startsWith("https://api.deepseek.com/anthropic/")) return "authorization";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL.startsWith("https://api.z.ai/api/anthropic/")) return "authorization";
  if (baseURL === "https://api.sambanova.ai/v1" || baseURL.startsWith("https://api.sambanova.ai/v1/")) return "authorization";
  return "x-api-key";
}

function shouldAddAnthropicDirectBrowserAccess(profile) {
  const explicit = profile?.bodyExtra?.directBrowserAccess
    ?? profile?.bodyExtra?.anthropicDirectBrowserAccess
    ?? profile?.directBrowserAccess
    ?? profile?.anthropicDirectBrowserAccess;
  if (explicit === false || String(explicit).toLowerCase() === "false") return false;
  if (explicit === true || String(explicit).toLowerCase() === "true") return true;
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  return baseURL === "https://api.anthropic.com" || baseURL.startsWith("https://api.anthropic.com/");
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
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
}

function bodyForProfile(profile, messages, outputLanguage, systemPrompt, requestInput = {}, streamEnabled = true) {
  const baseSystem = systemPrompt || "You are a careful academic paper reading assistant.";
  const system = `${baseSystem}\n${languageInstruction(outputLanguage)}`;
  const baseText = messagesToText(messages);
  const stream = shouldStream(profile, streamEnabled);
  if (requestInputImages(requestInput).length && !canUseImageInput(profile)) {
    throw new Error("Selected provider profile does not support image input");
  }
  if (profile.protocol === "anthropic_messages") {
    return withProviderBodyDefaults(profile, {
      model: profile.model,
      system,
      messages: anthropicMessages(messages, requestInput, baseText),
      max_tokens: Number(pref("maxOutputTokens")) || 8192,
      stream
    });
  }
  if (profile.protocol === "openai_responses") {
    return withProviderBodyDefaults(profile, {
      model: profile.model,
      instructions: system,
      input: openaiResponsesInput(messages, requestInput),
      max_output_tokens: Number(pref("maxOutputTokens")) || 8192,
      temperature: Number(pref("temperature")) || 1,
      stream
    });
  }
  return withOpenAIChatBodyDefaults(profile, {
    model: profile.model,
    messages: [{ role: "system", content: system }, ...openaiChatMessages(messages, requestInput)],
    ...openAIChatTokenLimit(profile, Number(pref("maxOutputTokens")) || 8192),
    temperature: Number(pref("temperature")) || 1,
    stream,
    n: 1
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
    tokenLimitField: _tokenLimitField,
    openAIChatTokenField: _openAIChatTokenField,
    chatTokenField: _chatTokenField,
    maxTokenField: _maxTokenField,
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
  for (const field of fields) delete next[field];
  return next;
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

function openaiResponsesInput(messages, requestInput = {}) {
  const input = messages.map((message) => ({
    role: message.role,
    content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: String(message.content || "") }]
  }));
  const lastUserIndex = findLastIndex(input, (message) => message.role === "user");
  const contextText = requestInput?.type === "text" ? requestInput.text : "";
  if (contextText) {
    appendOpenAIResponsesPart(input, lastUserIndex, { type: "input_text", text: `CONTEXT:\n${contextText}` });
  }
  if (requestInput?.type === "pdf_base64" && requestInput.base64) {
    prependOpenAIResponsesPart(input, lastUserIndex, {
      type: "input_file",
      filename: requestInput.filename || "paper.pdf",
      file_data: `data:application/pdf;base64,${requestInput.base64}`
    });
  }
  for (const image of requestInputImages(requestInput)) {
    appendOpenAIResponsesPart(input, lastUserIndex, {
      type: "input_image",
      image_url: imageDataURL(image)
    });
  }
  return input;
}

function openaiChatMessages(messages, requestInput = {}) {
  const mapped = messages.map((message) => ({ role: message.role, content: message.content }));
  const images = requestInputImages(requestInput);
  if (!images.length) return mapped;
  const lastUserIndex = findLastIndex(mapped, (message) => message.role === "user");
  const imageParts = images.map((image) => ({ type: "image_url", image_url: { url: imageDataURL(image) } }));
  if (lastUserIndex >= 0) {
    const baseText = String(mapped[lastUserIndex].content || "");
    mapped[lastUserIndex] = {
      role: "user",
      content: [
        { type: "text", text: baseText },
        ...imageParts
      ]
    };
    return mapped;
  }
  mapped.push({ role: "user", content: imageParts });
  return mapped;
}

function appendOpenAIResponsesPart(input, lastUserIndex, part) {
  if (lastUserIndex >= 0) {
    input[lastUserIndex] = {
      ...input[lastUserIndex],
      content: [...input[lastUserIndex].content, part]
    };
    return;
  }
  input.push({ role: "user", content: [part] });
}

function prependOpenAIResponsesPart(input, lastUserIndex, part) {
  if (lastUserIndex >= 0) {
    input[lastUserIndex] = {
      ...input[lastUserIndex],
      content: [part, ...input[lastUserIndex].content]
    };
    return;
  }
  input.push({ role: "user", content: [part] });
}

async function requestModelWithRetry(profile, messages, outputLanguage, systemPrompt, requestInput, streamEnabled, signal) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const body = bodyForProfile(profile, messages, outputLanguage, systemPrompt, requestInput, streamEnabled);
      const response = await fetch(endpointForProfile(profile), {
        method: "POST",
        headers: headersForProfile(profile),
        body: JSON.stringify(body),
        signal
      });
      if (!response.ok) {
        const text = await response.text();
        const error = providerHTTPError(response.status, text);
        if (error.retryableProviderError && attempt < 3) {
          await delay(500 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      response.zmsRequestedStream = body.stream === true;
      return response;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
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
  response.zmsUsage = normalizeProviderUsage(usage);
  return text;
}

function streamTextFromData(protocol, data, depth = 0) {
  if (!data) return "";
  const errorText = streamErrorText(data);
  if (errorText) throw new Error(`Stream error: ${redact(errorText)}`);
  if (protocol === "anthropic_messages") {
    if (data?.type === "content_block_delta") {
      return data?.delta?.text || data?.delta?.partial_json || "";
    }
    return data?.delta?.text || data?.content_block?.text || wrappedStreamTextFromData(protocol, data, depth);
  }
  if (typeof data?.choices?.[0]?.delta === "string") return data.choices[0].delta;
  const deltaContent = modelTextFromValue(data?.choices?.[0]?.delta?.content);
  if (deltaContent) return deltaContent;
  const messageContent = modelTextFromValue(data?.choices?.[0]?.message?.content);
  if (messageContent) return messageContent;
  if ((data?.type === "response.output_text.delta" || data?.type === "response.text.delta") && typeof data?.delta === "string") return data.delta;
  if (data?.delta?.content) {
    const nestedDelta = modelTextFromValue(data.delta.content);
    if (nestedDelta) return nestedDelta;
  }
  const directContent = modelTextFromValue(data?.content);
  if (directContent) return directContent;
  const eventText = modelTextFromStreamContainer(data);
  if (eventText) return eventText;
  return data?.choices?.[0]?.text || data?.choices?.[0]?.delta?.text || modelTextFromValue(data?.output) || (typeof data?.delta === "string" ? data.delta : "") || wrappedStreamTextFromData(protocol, data, depth);
}

function wrappedStreamTextFromData(protocol, data, depth) {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of ["data", "result", "payload", "response"]) {
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

function streamErrorText(data) {
  const error = data?.error || (data?.type === "error" ? data : null);
  if (!error) return "";
  if (typeof error === "string") return error;
  const code = error.code || error.type || data?.code || data?.type || "";
  const message = error.message || data?.message || "";
  return [code, message || JSON.stringify(error)].filter(Boolean).join(" - ");
}

function providerUsageFromResponse(data, depth = 0) {
  if (!data || typeof data !== "object" || depth > 3) return null;
  const direct = normalizeProviderUsage(data.usage || data.token_usage || data.tokenUsage || data.usage_metadata);
  const nested = ["response", "message", "result", "payload", "data"]
    .map((key) => providerUsageFromResponse(data?.[key], depth + 1))
    .filter(Boolean)
    .reduce((merged, usage) => mergeProviderUsage(merged, usage), null);
  return mergeProviderUsage(direct, nested);
}

function normalizeProviderUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = firstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.promptTokens,
    usage.promptTokenCount,
    usage.input_token_count
  );
  const outputTokens = firstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.completionTokens,
    usage.candidatesTokenCount,
    usage.output_token_count
  );
  const totalTokens = firstNumber(
    usage.total_tokens,
    usage.totalTokens,
    usage.totalTokenCount,
    inputTokens !== undefined || outputTokens !== undefined ? (inputTokens || 0) + (outputTokens || 0) : undefined
  );
  const cachedInputTokens = sumNumbers(
    usage.cachedInputTokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.input_tokens_details?.cached_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.promptTokensDetails?.cachedTokens
  );
  const reasoningTokens = firstNumber(
    usage.output_tokens_details?.reasoning_tokens,
    usage.completion_tokens_details?.reasoning_tokens,
    usage.completionTokensDetails?.reasoningTokens,
    usage.reasoning_tokens,
    usage.reasoningTokens
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
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens"]) {
    const value = maxNumber(left[key], right[key]);
    if (value !== undefined) merged[key] = value;
  }
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
  return String(text).trim();
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

function anthropicMessages(messages, requestInput, baseText) {
  const mapped = messages.map((message) => ({ role: message.role, content: message.content }));
  const content = [];
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
  if (requestInput?.type === "pdf_base64" && requestInput.base64) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: requestInput.base64 } });
  }
  if (!content.length) {
    return mergeConsecutiveAnthropicMessages(mapped);
  }
  content.push({ type: "text", text: baseText });
  const lastUserIndex = findLastIndex(mapped, (message) => message.role === "user");
  if (lastUserIndex >= 0) {
    mapped[lastUserIndex] = { role: "user", content };
    return mergeConsecutiveAnthropicMessages(mapped);
  }
  mapped.push({ role: "user", content });
  return mergeConsecutiveAnthropicMessages(mapped);
}

function requestInputImages(requestInput) {
  return Array.isArray(requestInput?.images) ? requestInput.images.filter((image) => image?.base64) : [];
}

function imageDataURL(image) {
  return `data:${image.mimeType || "image/png"};base64,${image.base64 || ""}`;
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
    return /\/v\d+$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
  }
  if (protocol === "openai_responses") return `${openAICompatibleBaseWithVersion(base)}/responses`;
  return `${openAICompatibleBaseWithVersion(base)}/chat/completions`;
}

function stripKnownProviderEndpointPath(baseURL) {
  return String(baseURL || "")
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|responses|messages|models)$/i, "");
}

function openAICompatibleBaseWithVersion(baseURL) {
  const base = String(baseURL || "").replace(/\/+$/, "");
  return hasOpenAICompatibleVersionPath(base) || usesVersionlessOpenAICompatibleBase(base) ? base : `${base}/v1`;
}

function hasOpenAICompatibleVersionPath(baseURL) {
  return /\/v\d+(?:[a-z]+)?$/i.test(baseURL) || /\/v\d+(?:[a-z]+)?\/openai$/i.test(baseURL);
}

function usesVersionlessOpenAICompatibleBase(baseURL) {
  const normalized = String(baseURL || "").replace(/\/+$/, "");
  return /^https:\/\/api\.perplexity\.ai$/i.test(normalized)
    || /^https:\/\/models\.github\.ai\/inference$/i.test(normalized);
}

function modelTextFromValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => modelTextFromValue(item)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    if (isReasoningModelPart(value)) return "";
    if (typeof value.text === "string") return value.text;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) return modelTextFromValue(value.content);
    if (Array.isArray(value.output)) return modelTextFromValue(value.output);
  }
  return "";
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
    || modelTextFromValue(data?.choices?.[0]?.message?.content)
    || modelTextFromValue(data?.choices?.[0]?.delta?.content)
    || data?.choices?.[0]?.text
    || data?.choices?.[0]?.delta?.text
    || modelTextFromValue(data?.output)
    || modelTextFromValue(data?.content)
    || modelTextFromStreamContainer(data)
    || wrappedProviderTextFromResponse("openai", data, depth);
}

function anthropicTextFromResponse(data, depth = 0) {
  const content = data?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return typeof data?.text === "string" ? data.text : wrappedProviderTextFromResponse("anthropic", data, depth);
}

function wrappedProviderTextFromResponse(protocol, data, depth) {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of ["data", "result", "payload", "response"]) {
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
    || !!value?.response;
  if (direct) return true;
  if (depth >= 2 || !value || typeof value !== "object") return false;
  return ["data", "result", "payload"].some((key) => {
    const wrapped = value?.[key];
    return !!wrapped && typeof wrapped === "object" && isStreamSnapshot(protocol, wrapped, depth + 1);
  });
}

function isReasoningModelPart(value) {
  const type = String(value?.type || "");
  return type.includes("reasoning") || type === "thinking";
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
  if (!name.toLowerCase().endsWith(".jsonl")) return "";
  return normalizeSessionId(name.slice(0, -6));
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

function sessionMarkdownPath(outputDir, item, sessionId) {
  const safeKey = sanitizeFilename(item?.key || "unknown");
  const safeId = sanitizeFilename(sessionId || newSessionId());
  return PathUtils.join(outputDir || "", "sessions", safeKey, `${safeId}.md`);
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
    const text = String(message?.content || "").trim();
    if (!text) continue;
    lines.push(`### ${header}`, "", text, "");
    const usageText = role === "assistant" ? providerUsageText(message?.usage) : "";
    if (usageText) lines.push(`_Usage: ${usageText}_`, "");
  }
  return lines.join("\n");
}

async function latestSessionForItem(item, outputDir) {
  if (!item?.key || !outputDir) return null;
  const dir = PathUtils.join(outputDir, "sessions", sanitizeFilename(item.key));
  if (!await pathExists(dir)) return null;
  const children = await IOUtils.getChildren(dir);
  const files = recentSessionFiles(children);
  if (!files.length) return null;
  return { path: files[files.length - 1], sessionId: sessionIdFromPath(files[files.length - 1]) };
}

function renderEmptySessionList(element, message) {
  const note = document.createElement("div");
  note.className = "zms-session-empty";
  note.textContent = message;
  element.appendChild(note);
}

async function summarizeMessagesWithLlm(messages, profile, t, setStatus) {
  const history = (messages || [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && String(message.content || "").trim())
    .slice(-COMPACT_HISTORY_LIMIT);
  if (!history.length) return "";
  const transcript = history.map((message) => `${message.role === "user" ? "USER" : "ASSISTANT"}: ${String(message.content).slice(0, 2000)}`).join("\n\n");
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
    return history.map((m) => m.content).join("\n").slice(0, 1500);
  }
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
  return (paths || [])
    .filter((path) => String(path || "").toLowerCase().endsWith(".jsonl"))
    .sort((left, right) => String(left).localeCompare(String(right)))
    .slice(-Math.max(1, limit));
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
    const helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
    helper.copyString(value);
    return true;
  } catch (_err) {
    return false;
  }
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
    .replace(/\b(?:sk|ak|xai|gsk|pplx|ms|rk)[-_][A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .slice(0, 800);
}

function stripThink(value) {
  return String(value || "").replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
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
  return { url, headers: headersForProfile(profile) };
}

function workbenchModelsEndpointForProfile(profile) {
  if (!profile?.capabilities?.modelList || profile.endpointMode === "full_url") return "";
  const base = stripKnownProviderEndpointPath(profile.baseURL);
  if (!base) return "";
  if (profile.protocol === "anthropic_messages") {
    return /\/v\d+$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
  }
  return `${openAICompatibleBaseWithVersion(base)}/models`;
}

async function workbenchFetchModelOptions(request) {
  const items = [];
  const seen = new Set();
  let nextUrl = request.url;
  for (let page = 0; nextUrl && page < WORKBENCH_MODEL_LIST_MAX_PAGES; page += 1) {
    if (seen.has(nextUrl)) break;
    seen.add(nextUrl);
    const response = await fetch(nextUrl, { method: "GET", headers: request.headers });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(providerErrorText(response.status, text));
    }
    const data = safeParseJSON(text);
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
  for (const key of ["result", "payload", "response", "data"]) {
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
  const direct = workbenchStringField(envelope.next_page, envelope.nextPage, envelope.next);
  if (direct) return workbenchModelListURLFromNextValue(currentUrl, direct);
  if (envelope.has_more !== true && envelope.hasMore !== true) return "";
  const pairs = [
    ["after_id", workbenchStringField(envelope.last_id, envelope.lastId, envelope.after_id, envelope.afterId)],
    ["page_token", workbenchStringField(envelope.next_page_token, envelope.nextPageToken, envelope.next_token, envelope.nextToken)],
    ["after", workbenchStringField(envelope.next_cursor, envelope.nextCursor, envelope.cursor, envelope.after)]
  ];
  for (const [param, token] of pairs) {
    if (token) return workbenchUrlWithQueryParam(currentUrl, param, token);
  }
  return "";
}

function workbenchDirectModelListItemsFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.model)) return data.model;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function workbenchModelListPaginationEnvelope(data, depth = 0) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (workbenchHasModelListPaginationFields(data)) return data;
  if (depth >= 2) return null;
  for (const key of ["result", "payload", "response", "data"]) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const envelope = workbenchModelListPaginationEnvelope(value, depth + 1);
    if (envelope) return envelope;
  }
  return null;
}

function workbenchHasModelListPaginationFields(data) {
  return !!workbenchStringField(data?.next_page, data?.nextPage, data?.next)
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

function workbenchModelOptionFromItem(item) {
  if (typeof item === "string") return { id: item.trim(), label: "" };
  const id = String(item?.id || item?.name || item?.model || "").trim();
  const label = String(item?.display_name || item?.displayName || item?.label || "").trim();
  return { id, label };
}

function isOllamaProfile(profile) {
  if (!profile) return false;
  if (profile.id === "ollama") return true;
  const base = String(profile.baseURL || "");
  return /^https?:\/\/(localhost|127\.0\.0\.1):11434/i.test(base);
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
