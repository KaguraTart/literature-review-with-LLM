function prefMessage(key, settingOrLocale) {
  if (typeof zmsMessage !== "function") return key;
  return zmsMessage("preferences", key, settingOrLocale, runtimeLocale());
}

const ZMS_BUILT_IN_SKILL_IDS = [
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
const REQUIRED_LOCAL_AGENT_TOOL_NAMES = [
  "ask_gemini",
  "ask_claude",
  "ask_opencode",
  "ask_all_agents",
  "check_local_agents",
  "extract_pdf_pages"
];
const MODEL_LIST_MAX_PAGES = 5;
const ZMS_DEFAULT_OUTPUT_DIR_NAME = "Literature Review with LLM";

var ZoteroMarkdownSummaryPrefs = {
  prefix: "extensions.zoteroMarkdownSummary",
  fields: [
    "provider",
    "baseURL",
    "apiKey",
    "model",
    "outputDir",
    "inputMode",
    "maxOutputTokens",
    "temperature",
    "stream",
    "systemPrompt",
    "userPrompt",
    "uiLanguage",
    "outputLanguage",
    "promptPackId",
    "activeProfileId",
    "profilesJson"
  ],

  init() {
    for (const field of this.fields) {
      const element = document.getElementById(`zms-${field}`);
      if (!element) continue;
      let value = Zotero.Prefs.get(`${this.prefix}.${field}`, true);
      if (field === "outputDir") {
        const resolved = resolvedOutputDir(value);
        if (resolved !== value && shouldPersistResolvedOutputDir(value)) {
          Zotero.Prefs.set(`${this.prefix}.outputDir`, resolved, true);
        }
        value = resolved;
      }
      if (field === "stream") element.checked = !!value;
      else element.value = value ?? "";
    }
    this.applyLanguage();
    this.mergeDefaultProfilesIntoEditor();
    this.refreshProfileOptions();
    this.loadProfileEditor();
    this.refreshProviderGuide();
    this.bindProfileStatusEvents();
    this.bindOutputDirEvents();
    document.getElementById("zms-skillId").value ||= "paper-deep-summary";
    this.refreshSkillMenu().then(() => this.loadSkillTemplateEditor());
  },

  mergeDefaultProfilesIntoEditor() {
    const profilesJson = document.getElementById("zms-profilesJson");
    if (!profilesJson) return;
    let profiles;
    try {
      profiles = JSON.parse(profilesJson.value || "[]");
    } catch (_err) {
      return;
    }
    const merged = mergeDefaultProviderProfiles(profiles);
    if (!merged.length) return;
    const nextJson = JSON.stringify(merged, null, 2);
    if (profilesJson.value !== nextJson) {
      profilesJson.value = nextJson;
      Zotero.Prefs.set(`${this.prefix}.profilesJson`, nextJson, true);
    }
    const activeProfile = document.getElementById("zms-activeProfileId");
    if (activeProfile && !merged.some((profile) => profile.id === activeProfile.value)) {
      activeProfile.value = merged.find((profile) => profile.isDefault)?.id || merged[0]?.id || "";
      Zotero.Prefs.set(`${this.prefix}.activeProfileId`, activeProfile.value, true);
    }
    this.refreshProfileOptions();
  },

  applyProviderPreset() {
    const provider = document.getElementById("zms-provider").value || "minimax";
    const defaults = providerDefaults(provider);
    const activeProfileId = document.getElementById("zms-activeProfileId");
    const baseURL = document.getElementById("zms-baseURL");
    const model = document.getElementById("zms-model");
    if (activeProfileId && (!activeProfileId.value || isKnownProviderId(activeProfileId.value))) {
      activeProfileId.value = defaults.id;
    }
    if (baseURL && (!baseURL.value || isKnownProviderBaseURL(baseURL.value))) {
      baseURL.value = defaults.baseURL;
    }
    if (model && (!model.value || isKnownProviderDefaultModel(model.value))) {
      model.value = defaults.model;
    }
    document.getElementById("zms-profileName").value = defaults.name;
    document.getElementById("zms-profileProtocol").value = defaults.protocol;
    document.getElementById("zms-profileEndpointMode").value = defaults.endpointMode;
    document.getElementById("zms-profileFullURL").value = defaults.fullURL;
    document.getElementById("zms-profileBodyExtra").value = JSON.stringify(defaults.bodyExtra || {}, null, 2);
    this.setCapabilityValues(defaults.capabilities);
    this.refreshProfileStatus();
    this.refreshProviderGuide();
  },

  save(options = {}) {
    const updateProfile = options.updateProfile !== false;
    if (updateProfile && !this.upsertProfileFromEditor()) return false;
    const json = document.getElementById("zms-profilesJson").value;
    try {
      JSON.parse(json);
    } catch (_err) {
      this.setStatus(this.t("jsonInvalid"));
      return false;
    }
    for (const field of this.fields) {
      const element = document.getElementById(`zms-${field}`);
      if (!element) continue;
      let value = field === "stream" ? element.checked : element.value;
      if (field === "outputDir") {
        value = resolvedOutputDir(value);
        element.value = value;
        if (element.dataset) element.dataset.zmsLastSaved = value;
      }
      if (field === "maxOutputTokens") value = Number(value) || 8192;
      if (field === "temperature") value = Number(value) || 1;
      Zotero.Prefs.set(`${this.prefix}.${field}`, value, true);
    }
    this.refreshProfileOptions();
    this.applyLanguage();
    this.refreshProfileStatus();
    this.refreshProviderGuide();
    if (options.statusKey !== "") this.setStatus(this.t(options.statusKey || "saved"));
    return true;
  },

  async saveOutputDir() {
    const element = document.getElementById("zms-outputDir");
    if (!element) return false;
    const outputDir = resolvedOutputDir(element.value);
    element.value = outputDir;
    if (!this.save({ updateProfile: false, statusKey: "" })) return false;
    if (element.dataset) element.dataset.zmsLastSaved = outputDir;
    if (!outputDir) {
      this.setStatus(this.t("outputDirMissing"));
      return false;
    }
    try {
      await ensureDirectory(outputDir);
      await this.refreshSkillMenu();
      this.setStatus(`${this.t("outputDirSaved")}: ${outputDir}`);
      return true;
    } catch (err) {
      this.setStatus(`${this.t("outputDirCreateFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  async chooseOutputDir() {
    const element = document.getElementById("zms-outputDir");
    if (!element) return false;
    try {
      const selected = await chooseOutputDirectory(element.value, this.t("chooseOutputDirTitle"));
      if (!selected) return false;
      element.value = selected;
      return this.saveOutputDir();
    } catch (err) {
      this.setStatus(`${this.t("outputDirChooseFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  upsertProfileFromEditor() {
    let profiles;
    try {
      profiles = JSON.parse(document.getElementById("zms-profilesJson").value || "[]");
      if (!Array.isArray(profiles)) profiles = [];
    } catch (_err) {
      this.setStatus(this.t("jsonInvalid"));
      return null;
    }
    const profile = this.profileFromEditor();
    if (!profile) return null;
    const updated = profiles
      .filter((item) => item?.id !== profile.id)
      .map((item) => ({ ...item, isDefault: false }));
    updated.unshift({ ...profile, isDefault: true });
    this.applyProfileToBasicFields(profile);
    document.getElementById("zms-profilesJson").value = JSON.stringify(updated, null, 2);
    this.refreshProfileOptions();
    this.refreshProfileStatus();
    return profile;
  },

  applyProfileToBasicFields(profile) {
    if (!profile) return;
    document.getElementById("zms-activeProfileId").value = profile.id || "";
    document.getElementById("zms-provider").value = providerFromProfile(profile);
    document.getElementById("zms-baseURL").value = profile.baseURL || "";
    document.getElementById("zms-apiKey").value = profile.apiKey || "";
    document.getElementById("zms-model").value = profile.model || "";
  },

  syncLegacyToProfile() {
    this.saveProfileFromEditor();
    this.loadProfileEditor();
  },

  loadProfileEditor() {
    const profile = this.activeProfileRaw() || defaultProfileFromFields();
    const hydrated = hydrateProfile(profile);
    document.getElementById("zms-activeProfileId").value = hydrated.id || "";
    document.getElementById("zms-provider").value = providerFromProfile(hydrated);
    document.getElementById("zms-baseURL").value = hydrated.baseURL || "";
    document.getElementById("zms-apiKey").value = hydrated.apiKey || "";
    document.getElementById("zms-model").value = hydrated.model || "";
    document.getElementById("zms-profileName").value = hydrated.name || hydrated.id || "";
    document.getElementById("zms-profileProtocol").value = hydrated.protocol || "openai_chat";
    document.getElementById("zms-profileEndpointMode").value = hydrated.endpointMode || "base_url";
    document.getElementById("zms-profileFullURL").value = hydrated.fullURL || "";
    document.getElementById("zms-profileCustomHeaders").value = JSON.stringify(hydrated.customHeaders || {}, null, 2);
    document.getElementById("zms-profileBodyExtra").value = JSON.stringify(hydrated.bodyExtra || {}, null, 2);
    this.loadLocalAgentEditor(hydrated.bodyExtra || {});
    this.setCapabilityValues(hydrated.capabilities || {});
    this.refreshProfileOptions();
    this.refreshProfileStatus();
    this.refreshProviderGuide();
  },

  loadLocalAgentEditor(bodyExtra) {
    const rawConfig = bodyExtra?.localAgent;
    const localAgent = parseLocalAgentConfig(rawConfig);
    document.getElementById("zms-profileLocalAgentEnabled").checked = !!localAgent;
    if (!localAgent) {
      document.getElementById("zms-profileLocalAgentEndpoint").value = "";
      document.getElementById("zms-profileLocalAgentTool").value = "";
      document.getElementById("zms-profileLocalAgentPayloadMode").value = "jsonrpc";
      document.getElementById("zms-profileLocalAgentTimeout").value = "";
      document.getElementById("zms-profileLocalAgentFallback").checked = false;
      document.getElementById("zms-profileLocalAgentHeaders").value = "{}";
      document.getElementById("zms-profileLocalAgentSkills").value = "{}";
      return;
    }
    document.getElementById("zms-profileLocalAgentEndpoint").value = localAgent.endpoint || "";
    document.getElementById("zms-profileLocalAgentTool").value = localAgent.tool || localAgent.toolName || localAgent.tool_id || "";
    const payloadMode = normalizeLocalAgentPayloadMode(localAgent.payloadMode || localAgent.protocol || "jsonrpc");
    document.getElementById("zms-profileLocalAgentPayloadMode").value = payloadMode;
    const timeoutMs = toFinitePositiveInt(localAgent.timeoutMs, localAgent.timeout, localAgent.timeoutSeconds, localAgent.timeoutSec, localAgent.timeout_ms);
    document.getElementById("zms-profileLocalAgentTimeout").value = timeoutMs ? String(Math.ceil(timeoutMs / 1000)) : "";
    document.getElementById("zms-profileLocalAgentFallback").checked = !!localAgent.fallbackToRemote;
    const headers = normalizeObjectStringMap(localAgent.headers) || {};
    document.getElementById("zms-profileLocalAgentHeaders").value = JSON.stringify(headers, null, 2);
    const skillMap = { ...(localAgent || {}) };
    const defaultAdvanced = {};
    for (const key of ["method", "model", "args", "body", "params", "payload", "toolMode"]) {
      if (localAgent[key] !== undefined) defaultAdvanced[key] = localAgent[key];
    }
    delete skillMap.endpoint;
    delete skillMap.url;
    delete skillMap.mcpUrl;
    delete skillMap.baseUrl;
    delete skillMap.tool;
    delete skillMap.toolName;
    delete skillMap.tool_id;
    delete skillMap.headers;
    delete skillMap.timeoutMs;
    delete skillMap.timeout;
    delete skillMap.timeoutSec;
    delete skillMap.timeout_seconds;
    delete skillMap.timeout_ms;
    delete skillMap.payloadMode;
    delete skillMap.protocol;
    delete skillMap.method;
    delete skillMap.model;
    delete skillMap.args;
    delete skillMap.body;
    delete skillMap.params;
    delete skillMap.payload;
    delete skillMap.enabled;
    delete skillMap.toolMode;
    delete skillMap.fallbackToRemote;
    if (Object.keys(defaultAdvanced).length) {
      const existingDefault = skillMap.default && typeof skillMap.default === "object" && !Array.isArray(skillMap.default)
        ? skillMap.default
        : {};
      skillMap.default = { ...defaultAdvanced, ...existingDefault };
    }
    document.getElementById("zms-profileLocalAgentSkills").value = JSON.stringify(skillMap, null, 2);
  },

  saveProfileFromEditor() {
    const profile = this.upsertProfileFromEditor();
    if (!profile) return;
    if (this.save({ updateProfile: false, statusKey: "" })) this.setStatus(this.t("profileSaved"));
  },

  deleteProfileFromEditor() {
    let profiles;
    try {
      profiles = JSON.parse(document.getElementById("zms-profilesJson").value || "[]");
      if (!Array.isArray(profiles)) profiles = [];
    } catch (_err) {
      this.setStatus(this.t("jsonInvalid"));
      return;
    }
    const activeProfileId = document.getElementById("zms-activeProfileId").value;
    const remaining = profiles.filter((profile) => profile.id !== activeProfileId);
    if (remaining[0]) remaining[0].isDefault = true;
    document.getElementById("zms-activeProfileId").value = remaining[0]?.id || "minimax";
    document.getElementById("zms-profilesJson").value = JSON.stringify(remaining, null, 2);
    this.refreshProfileOptions();
    this.save();
    this.loadProfileEditor();
    this.setStatus(this.t("profileDeleted"));
  },

  resetProfilesToDefaults() {
    const profiles = defaultProviderProfiles();
    document.getElementById("zms-activeProfileId").value = profiles[0]?.id || "minimax";
    document.getElementById("zms-provider").value = providerFromProfile(profiles[0]) || "minimax";
    document.getElementById("zms-baseURL").value = profiles[0]?.baseURL || "";
    document.getElementById("zms-apiKey").value = profiles[0]?.apiKey || "";
    document.getElementById("zms-model").value = profiles[0]?.model || "";
    document.getElementById("zms-profilesJson").value = JSON.stringify(profiles, null, 2);
    this.refreshProfileOptions();
    this.loadProfileEditor();
    if (this.save()) this.setStatus(this.t("profilesReset"));
  },

  activeProfileRaw() {
    try {
      const activeProfileId = document.getElementById("zms-activeProfileId").value;
      const profiles = JSON.parse(document.getElementById("zms-profilesJson").value || "[]");
      if (!Array.isArray(profiles)) return null;
      return profiles.find((profile) => profile.id === activeProfileId) || profiles.find((profile) => profile.isDefault) || profiles[0] || null;
    } catch (_err) {
      return null;
    }
  },

  profileFromEditor() {
    const id = normalizeProfileId(document.getElementById("zms-activeProfileId").value || document.getElementById("zms-profileName").value) || "custom";
    document.getElementById("zms-activeProfileId").value = id;
    const name = (document.getElementById("zms-profileName").value || id).trim();
    const customHeaders = jsonObjectFromTextarea("zms-profileCustomHeaders", this);
    if (customHeaders === null) return null;
    const localAgent = this.localAgentFromEditor();
    if (localAgent === null) return null;
    const bodyExtra = jsonObjectFromTextarea("zms-profileBodyExtra", this);
    if (bodyExtra === null) return null;
    if (localAgent) {
      bodyExtra.localAgent = localAgent;
    } else if (bodyExtra.localAgent !== undefined) {
      delete bodyExtra.localAgent;
    }
    return {
      id,
      name,
      protocol: document.getElementById("zms-profileProtocol").value || "openai_chat",
      endpointMode: document.getElementById("zms-profileEndpointMode").value || "base_url",
      baseURL: document.getElementById("zms-baseURL").value,
      fullURL: document.getElementById("zms-profileFullURL").value,
      apiKey: document.getElementById("zms-apiKey").value,
      model: document.getElementById("zms-model").value,
      capabilities: this.capabilityValues(),
      customHeaders,
      bodyExtra,
      isDefault: true
    };
  },

  localAgentFromEditor() {
    const rawTimeout = document.getElementById("zms-profileLocalAgentTimeout").value;
    const timeoutSeconds = Number(rawTimeout);
    const localAgent = {
      endpoint: document.getElementById("zms-profileLocalAgentEndpoint").value.trim(),
      tool: document.getElementById("zms-profileLocalAgentTool").value.trim(),
      payloadMode: normalizeLocalAgentPayloadMode(document.getElementById("zms-profileLocalAgentPayloadMode").value),
      fallbackToRemote: !!document.getElementById("zms-profileLocalAgentFallback").checked
    };
    const headers = jsonObjectFromTextarea("zms-profileLocalAgentHeaders", this);
    if (headers === null) return null;
    const skillMap = jsonObjectFromTextarea("zms-profileLocalAgentSkills", this);
    if (skillMap === null) return null;
    const enabled = !!document.getElementById("zms-profileLocalAgentEnabled").checked;
    if (!enabled && localAgent.endpoint === "" && localAgent.tool === "" && !Object.keys(skillMap).length) {
      return undefined;
    }
    if (!enabled) return undefined;
    const result = {};
    if (localAgent.endpoint) result.endpoint = localAgent.endpoint;
    if (localAgent.tool) result.tool = localAgent.tool;
    if (localAgent.payloadMode) result.payloadMode = localAgent.payloadMode;
    if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
      result.timeoutSeconds = Math.round(timeoutSeconds);
      result.timeoutMs = Math.round(timeoutSeconds * 1000);
    }
    if (localAgent.fallbackToRemote) result.fallbackToRemote = true;
    if (Object.keys(headers || {}).length) result.headers = headers;
    if (Object.keys(skillMap).length) {
      for (const [skillId, config] of Object.entries(skillMap)) {
        if (typeof config === "string") {
          result[skillId] = { endpoint: config };
        } else if (config && typeof config === "object" && !Array.isArray(config)) {
          result[skillId] = config;
        }
      }
    }
    return Object.keys(result).length ? result : undefined;
  },

  capabilityValues() {
    return {
      text: !!document.getElementById("zms-cap-text").checked,
      pdfBase64: !!document.getElementById("zms-cap-pdfBase64").checked,
      imageBase64: !!document.getElementById("zms-cap-imageBase64").checked,
      streaming: !!document.getElementById("zms-cap-streaming").checked,
      fileReference: !!document.getElementById("zms-cap-fileReference").checked,
      embeddings: !!document.getElementById("zms-cap-embeddings").checked,
      jsonMode: !!document.getElementById("zms-cap-jsonMode").checked,
      toolUse: !!document.getElementById("zms-cap-toolUse").checked,
      modelList: !!document.getElementById("zms-cap-modelList").checked
    };
  },

  setCapabilityValues(capabilities) {
    const defaults = defaultCapabilitiesForProvider(document.getElementById("zms-provider").value);
    const merged = { ...defaults, ...(capabilities || {}) };
    document.getElementById("zms-cap-text").checked = !!merged.text;
    document.getElementById("zms-cap-pdfBase64").checked = !!merged.pdfBase64;
    document.getElementById("zms-cap-imageBase64").checked = !!merged.imageBase64;
    document.getElementById("zms-cap-streaming").checked = !!merged.streaming;
    document.getElementById("zms-cap-fileReference").checked = !!merged.fileReference;
    document.getElementById("zms-cap-embeddings").checked = !!merged.embeddings;
    document.getElementById("zms-cap-jsonMode").checked = !!merged.jsonMode;
    document.getElementById("zms-cap-toolUse").checked = !!merged.toolUse;
    document.getElementById("zms-cap-modelList").checked = !!merged.modelList;
  },

  async testConnection() {
    const profile = this.upsertProfileFromEditor();
    if (!profile || !this.save({ updateProfile: false, statusKey: "" })) return;
    if (isLocalAgentProfile(profile)) {
      try {
        await verifyLocalAgentConnection(profile);
        this.setStatus(this.t("testOk"));
      } catch (err) {
        this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
      }
      return;
    }
    if (!profileHasUsableAuth(profile)) {
      this.setStatus(this.t("apiKeyMissing"));
      return;
    }
    if (!profile.model) {
      this.setStatus(this.t("modelMissing"));
      return;
    }
    try {
      this.setStatus(this.t("testing"));
      const request = connectionTestRequestForProfile(profile);
      const { response, text } = await runProviderConnectionTest(profile, request);
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

  async loadModels() {
    const profile = this.profileFromEditor();
    if (!profile) return;
    if (!profileHasUsableAuth(profile)) {
      this.setStatus(this.t("apiKeyMissing"));
      return;
    }
    const request = modelListRequestForProfile(profile);
    if (!request) {
      this.setStatus(this.t("modelListUnavailable"));
      return;
    }
    try {
      let modelOptions = [];
      try {
        modelOptions = await fetchModelOptions(request);
      } catch (err) {
        if (isOllamaProfileId(profile.id, profile.baseURL)) {
          modelOptions = await fetchOllamaTags(profile);
        } else {
          throw err;
        }
      }
      renderModelOptions(modelOptions);
      if (modelOptions.length && !document.getElementById("zms-model").value.trim()) {
        document.getElementById("zms-model").value = modelOptions[0].id;
      }
      this.setStatus(modelOptions.length ? `${this.t("modelListLoaded")}: ${modelOptions.length}` : this.t("modelListEmpty"));
    } catch (err) {
      this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
    }
  },

  activeProfile() {
    const activeProfileId = document.getElementById("zms-activeProfileId").value;
    const profiles = JSON.parse(document.getElementById("zms-profilesJson").value || "[]");
    const profile = profiles.find((item) => item.id === activeProfileId) || profiles.find((item) => item.isDefault) || profiles[0];
    return profile ? hydrateProfile(profile) : null;
  },

  async loadSkillTemplateEditor() {
    await this.refreshSkillMenu();
    const outputDir = document.getElementById("zms-outputDir").value;
    const skillId = normalizeSkillId(document.getElementById("zms-skillId").value || "paper-deep-summary") || "paper-deep-summary";
    document.getElementById("zms-skillId").value = skillId;
    if (!outputDir) {
      document.getElementById("zms-skillTemplate").value = builtInSkillTemplate(skillId, document.getElementById("zms-outputLanguage").value);
      this.setStatus(this.t("outputDirMissing"));
      return;
    }
    try {
      const path = skillTemplatePath(outputDir, skillId);
      if (await IOUtils.exists(path)) {
        document.getElementById("zms-skillTemplate").value = await readText(path);
      } else {
        document.getElementById("zms-skillTemplate").value = builtInSkillTemplate(skillId, document.getElementById("zms-outputLanguage").value);
      }
      this.setStatus(this.t("skillLoaded"));
    } catch (err) {
      this.setStatus(`${this.t("testFailed")}: ${err.message || err}`);
    }
  },

  async saveSkillTemplateEditor() {
    const outputDir = document.getElementById("zms-outputDir").value;
    const skillId = normalizeSkillId(document.getElementById("zms-skillId").value || "paper-deep-summary") || "paper-deep-summary";
    document.getElementById("zms-skillId").value = skillId;
    if (!outputDir) {
      this.setStatus(this.t("outputDirMissing"));
      return;
    }
    try {
      const path = skillTemplatePath(outputDir, skillId);
      await ensureDirectory(parentDir(path));
      await writeText(path, document.getElementById("zms-skillTemplate").value);
      await this.refreshSkillMenu();
      this.setStatus(this.t("skillSaved"));
    } catch (err) {
      this.setStatus(`${this.t("testFailed")}: ${err.message || err}`);
    }
  },

  async resetSkillTemplateEditor() {
    const skillId = normalizeSkillId(document.getElementById("zms-skillId").value || "paper-deep-summary") || "paper-deep-summary";
    document.getElementById("zms-skillId").value = skillId;
    document.getElementById("zms-skillTemplate").value = builtInSkillTemplate(skillId, document.getElementById("zms-outputLanguage").value);
    await this.saveSkillTemplateEditor();
    await this.refreshSkillMenu();
    this.setStatus(this.t("skillReset"));
  },

  async refreshSkillMenu() {
    const select = document.getElementById("zms-skillId");
    if (!select) return [];
    const current = normalizeSkillId(select.value || "paper-deep-summary") || "paper-deep-summary";
    const outputDir = document.getElementById("zms-outputDir")?.value || "";
    const ids = await availableSkillTemplateIds(outputDir);
    renderSkillMenuOptions(select, ids, resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale()));
    select.value = current;
    return ids;
  },

  refreshProfileOptions() {
    const list = document.getElementById("zms-profile-options");
    if (!list) return [];
    let profiles = [];
    try {
      profiles = JSON.parse(document.getElementById("zms-profilesJson").value || "[]");
      if (!Array.isArray(profiles)) profiles = [];
    } catch (_err) {
      return [];
    }
    const options = profileOptionsFromProfiles(profiles);
    renderProfileOptions(list, options);
    return options;
  },

  refreshProfileStatus() {
    const element = document.getElementById("zms-profileStatus");
    if (!element) return "";
    const draft = profileDraftFromEditor();
    const summary = profileStatusText(draft.profile, (key) => this.t(key));
    const text = draft.errors.length ? `${summary}\n${this.t("jsonInvalid")}` : summary;
    element.textContent = text;
    return text;
  },

  refreshProviderGuide() {
    const element = document.getElementById("zms-providerGuide");
    if (!element) return "";
    const draft = profileDraftFromEditor();
    const lang = resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale());
    const text = providerSetupGuide(draft.profile, lang);
    element.textContent = text;
    return text;
  },

  bindProfileStatusEvents() {
    const ids = [
      "zms-activeProfileId",
      "zms-provider",
      "zms-baseURL",
      "zms-apiKey",
      "zms-model",
      "zms-profileName",
      "zms-profileProtocol",
      "zms-profileEndpointMode",
      "zms-profileFullURL",
      "zms-profileCustomHeaders",
      "zms-profileBodyExtra",
      "zms-profileLocalAgentEnabled",
      "zms-profileLocalAgentEndpoint",
      "zms-profileLocalAgentTool",
      "zms-profileLocalAgentPayloadMode",
      "zms-profileLocalAgentTimeout",
      "zms-profileLocalAgentHeaders",
      "zms-profileLocalAgentSkills",
      "zms-profileLocalAgentFallback",
      "zms-cap-text",
      "zms-cap-pdfBase64",
      "zms-cap-imageBase64",
      "zms-cap-streaming",
      "zms-cap-fileReference",
      "zms-cap-embeddings",
      "zms-cap-jsonMode",
      "zms-cap-toolUse",
      "zms-cap-modelList"
    ];
    for (const id of ids) {
      const element = document.getElementById(id);
      if (typeof element?.addEventListener !== "function") continue;
      const refresh = () => {
        this.refreshProfileStatus();
        this.refreshProviderGuide();
      };
      element.addEventListener("input", refresh);
      element.addEventListener("change", refresh);
      element.addEventListener("command", refresh);
    }
  },

  bindOutputDirEvents() {
    const element = document.getElementById("zms-outputDir");
    if (!element || element.dataset?.zmsOutputDirBound === "1") return;
    if (element.dataset) element.dataset.zmsLastSaved = String(element.value || "");
    const saveIfChanged = () => {
      if (element.dataset && element.dataset.zmsLastSaved === String(element.value || "")) return;
      this.saveOutputDir();
    };
    element.addEventListener("change", saveIfChanged);
    element.addEventListener("blur", saveIfChanged);
    if (element.dataset) element.dataset.zmsOutputDirBound = "1";
  },

  applyLanguage() {
    const lang = resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale());
    const setLabel = (id, key) => {
      const element = document.getElementById(id);
      if (!element) return;
      if (element.localName === "button") element.setAttribute("label", this.t(key, lang));
      else if (element.localName === "h2") element.textContent = this.t(key, lang);
      else element.setAttribute("value", this.t(key, lang));
    };
    setLabel("zms-title", "title");
    for (const key of [
      "uiLanguage",
      "outputLanguage",
      "promptPackId",
      "activeProfileId",
      "provider",
      "baseURL",
      "apiKey",
      "model",
      "providerGuide",
      "profileStatus",
      "outputDir",
      "inputMode",
      "maxOutputTokens",
      "temperature",
      "stream",
      "profileEditor",
      "profileName",
      "profileProtocol",
      "profileEndpointMode",
      "profileFullURL",
      "profileCapabilities",
      "profileCustomHeaders",
      "profileBodyExtra",
      "profileLocalAgent",
      "profileLocalAgentEnabled",
      "profileLocalAgentEndpoint",
      "profileLocalAgentTool",
      "profileLocalAgentPayloadMode",
      "profileLocalAgentTimeout",
      "profileLocalAgentHeaders",
      "profileLocalAgentSkills",
      "profileLocalAgentFallback",
      "systemPrompt",
      "userPrompt",
      "skillTemplate",
      "skillId",
      "profilesJson"
    ]) {
      setLabel(`zms-${key}-label`, key);
    }
    setLabel("zms-save-button", "save");
    setLabel("zms-choose-outputDir-button", "chooseOutputDir");
    setLabel("zms-save-outputDir-button", "saveOutputDir");
    setLabel("zms-test-button", "test");
    setLabel("zms-load-models-button", "loadModels");
    setLabel("zms-load-profile-button", "loadProfile");
    setLabel("zms-save-profile-button", "saveProfile");
    setLabel("zms-delete-profile-button", "deleteProfile");
    setLabel("zms-reset-profiles-button", "resetProfiles");
    setLabel("zms-load-skill-button", "loadSkill");
    setLabel("zms-save-skill-button", "saveSkill");
    setLabel("zms-reset-skill-button", "resetSkill");
  },

  t(key, lang) {
    const resolved = lang || resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale());
    return prefMessage(key, resolved);
  },

  setStatus(message) {
    document.getElementById("zms-status").value = message;
  }
};

function runtimeLocale() {
  try {
    return Services.locale.appLocaleAsBCP47 || Services.locale.requestedLocale || "";
  } catch (_err) {
    return "";
  }
}

function resolvedOutputDir(value) {
  const raw = String(value || "").trim();
  if (raw && !isLegacyPackagedOutputDir(raw)) return raw;
  return defaultOutputDir();
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

async function chooseOutputDirectory(currentPath, title) {
  const cc = typeof Cc !== "undefined" ? Cc : undefined;
  const ci = typeof Ci !== "undefined" ? Ci : undefined;
  const nsIFilePicker = ci?.nsIFilePicker;
  const pickerFactory = cc?.["@mozilla.org/filepicker;1"];
  if (!pickerFactory || !nsIFilePicker) {
    throw new Error("Folder picker is not available in this Zotero runtime");
  }
  const picker = pickerFactory.createInstance(nsIFilePicker);
  picker.init(window, title || "Choose output folder", nsIFilePicker.modeGetFolder);
  const displayDirectory = fileForDirectoryPicker(currentPath);
  if (displayDirectory) picker.displayDirectory = displayDirectory;
  const result = await openDirectoryPicker(picker);
  const accepted = result === nsIFilePicker.returnOK || result === nsIFilePicker.returnReplace;
  if (!accepted) return "";
  return String(picker.file?.path || "").trim();
}

function fileForDirectoryPicker(path) {
  const raw = String(path || "").trim();
  if (!raw) return null;
  try {
    const cc = typeof Cc !== "undefined" ? Cc : undefined;
    const ci = typeof Ci !== "undefined" ? Ci : undefined;
    const fileFactory = cc?.["@mozilla.org/file/local;1"];
    if (!fileFactory) return null;
    const file = fileFactory.createInstance(ci?.nsIFile);
    file.initWithPath(raw);
    if (typeof file.exists === "function" && !file.exists()) {
      return file.parent || null;
    }
    if (typeof file.isDirectory === "function" && !file.isDirectory()) {
      return file.parent || null;
    }
    return file;
  } catch (_err) {
    return null;
  }
}

async function openDirectoryPicker(picker) {
  if (typeof picker.open === "function") {
    return new Promise((resolve) => picker.open(resolve));
  }
  if (typeof picker.show === "function") return picker.show();
  throw new Error("Folder picker cannot be opened");
}

function resolveUiLanguage(setting, locale) {
  return typeof zmsResolveUiLanguage === "function"
    ? zmsResolveUiLanguage(setting, locale)
    : (setting === "zh-CN" || setting === "en-US" ? setting : (String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"));
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
  const baseURL = String(profile?.baseURL || "");
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
  const normalized = stripKnownProviderEndpointPath(baseURL).replace(/\/+$/, "");
  return normalized === "https://api.anthropic.com" || normalized.startsWith("https://api.anthropic.com/");
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

function isLocalEndpoint(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
}

function profileStatusText(profile, translate = (key) => key) {
  const t = typeof translate === "function" ? translate : (key) => key;
  if (!profile) return t("noProfile");
  const isLocalAgent = isLocalAgentProfile(profile);
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

function providerSetupGuide(profile, language = "en-US") {
  if (!profile) return "";
  const zh = /^zh/i.test(String(language || ""));
  const provider = providerFromProfile(profile);
  const defaults = providerDefaults(provider);
  const endpoint = endpointForProfileSafe(profile) || "";
  const modelList = providerModelListGuide(profile);
  const verify = providerLiveVerifyGuide(profile, provider);
  const capabilities = [
    canUseImageInput(profile) ? (zh ? "图片" : "image") : "",
    canUsePdfBase64Input(profile) ? "PDF base64" : (zh ? "PDF 文本抽取" : "PDF text extraction"),
    profile?.capabilities?.streaming === true ? (zh ? "流式" : "streaming") : "",
    profile?.capabilities?.modelList === true ? (zh ? "模型列表" : "model list") : ""
  ].filter(Boolean).join(", ");
  const auth = providerAuthGuide(profile, provider, zh);
  if (zh) {
    return [
      `当前档案：${profile.name || defaults.name || profile.id || provider}`,
      `协议：${providerProtocolLabel(profile.protocol, zh)}`,
      `Base URL：${profile.baseURL || defaults.baseURL || "未填写"}`,
      `请求 endpoint：${endpoint || "未配置"}`,
      `鉴权：${auth}`,
      `模型：${profile.model || "请填写模型名称，或点击“加载模型”后选择"}`,
      `能力：${capabilities || "文本"}`,
      `模型列表：${modelList || "当前档案不支持自动加载模型列表"}`,
      `保存后测试：点击“测试连接”；失败信息会隐藏完整 API Key。`,
      `复制环境变量模板：${verify.envTemplateCommand}`,
      `.env.local live 检查：${verify.envFileCommand}`,
      `终端 live 检查：${verify.liveCommand}`,
      `图片 live 检查：${verify.imageCommand || "当前档案不支持图片输入"}`,
      ...(verify.imageOverrideCommand ? [`图片能力覆盖检查：${verify.imageOverrideCommand}`] : []),
      `PDF live 检查：${verify.pdfCommand || "当前档案使用 Zotero 文本抽取"}`,
      ...(verify.pdfOverrideCommand ? [`PDF 能力覆盖检查：${verify.pdfOverrideCommand}`] : []),
      `模型列表 live 检查：${verify.modelsCommand}`
    ].join("\n");
  }
  return [
    `Active profile: ${profile.name || defaults.name || profile.id || provider}`,
    `Protocol: ${providerProtocolLabel(profile.protocol, zh)}`,
    `Base URL: ${profile.baseURL || defaults.baseURL || "not set"}`,
    `Request endpoint: ${endpoint || "not configured"}`,
    `Auth: ${auth}`,
    `Model: ${profile.model || "enter a model name, or use Load models"}`,
    `Capabilities: ${capabilities || "text"}`,
    `Model list: ${modelList || "not available for this profile"}`,
    "After saving: click Test connection. Failure messages hide full API keys.",
    `Copy env template: ${verify.envTemplateCommand}`,
    `Env-file live check: ${verify.envFileCommand}`,
    `Terminal live check: ${verify.liveCommand}`,
    `Image live check: ${verify.imageCommand || "not supported by this profile"}`,
    ...(verify.imageOverrideCommand ? [`Image capability override check: ${verify.imageOverrideCommand}`] : []),
    `PDF live check: ${verify.pdfCommand || "uses Zotero extracted text"}`,
    ...(verify.pdfOverrideCommand ? [`PDF capability override check: ${verify.pdfOverrideCommand}`] : []),
    `Model-list live check: ${verify.modelsCommand}`
  ].join("\n");
}

function providerProtocolLabel(protocol, zh = false) {
  if (protocol === "openai_responses") return zh ? "OpenAI Responses" : "OpenAI Responses";
  if (protocol === "anthropic_messages") return zh ? "Anthropic Messages" : "Anthropic Messages";
  return zh ? "OpenAI Chat Completions" : "OpenAI Chat Completions";
}

function providerAuthGuide(profile, provider, zh = false) {
  if (isLocalAgentProfile(profile)) {
    return zh ? "本地代理 HTTP 端点；通常不需要 API Key。" : "Local agent HTTP endpoint; API key is usually not required.";
  }
  const endpoint = endpointForProfileSafe(profile);
  if (isLocalEndpoint(endpoint)) {
    return zh ? "本地接口；通常不需要 API Key，若网关要求可填写。" : "Local endpoint; API key is usually optional unless your gateway requires one.";
  }
  if (provider === "anthropic") {
    if (shouldOmitAnthropicVersion(profile)) {
      return zh ? "API Key 会作为 x-api-key 发送；已关闭 anthropic-version header。" : "API key is sent as x-api-key; anthropic-version is disabled.";
    }
    return zh ? "API Key 会作为 x-api-key 发送，并附带 anthropic-version。" : "API key is sent as x-api-key with anthropic-version.";
  }
  if (profile.protocol === "anthropic_messages") {
    const header = normalizeAuthHeaderName(profile?.bodyExtra?.authHeader || profile?.bodyExtra?.anthropicAuthHeader) || "authorization";
    const versionText = shouldOmitAnthropicVersion(profile)
      ? (zh ? "；不附带 anthropic-version。" : "; anthropic-version is disabled.")
      : (zh ? "；会附带 anthropic-version。" : "; anthropic-version is included.");
    return (header === "x-api-key"
      ? (zh ? "API Key 会作为 x-api-key 发送" : "API key is sent as x-api-key")
      : (zh ? "API Key 会作为 Authorization: Bearer 发送" : "API key is sent as Authorization: Bearer")) + versionText;
  }
  if (provider === "azure_openai") {
    return zh ? "默认使用 Bearer；如 Azure 网关要求 api-key，请在自定义 Headers JSON 填写 api-key。" : "Uses Bearer by default; if your Azure gateway requires api-key, set it in Custom headers JSON.";
  }
  return zh ? "API Key 会作为 Authorization: Bearer 发送。" : "API key is sent as Authorization: Bearer.";
}

function providerModelListGuide(profile) {
  try {
    const request = modelListRequestForProfile(profile);
    return request?.url || "";
  } catch (_err) {
    return "";
  }
}

function providerLiveVerifyGuide(profile, provider = providerFromProfile(profile)) {
  const entry = providerLiveVerifyCase(profile, provider);
  const baseURL = String(profile?.baseURL || providerDefaults(provider).baseURL || "").trim();
  const model = String(profile?.model || "").trim();
  const assignments = [];
  if (!entry.apiKeyOptional) assignments.push(`${entry.apiKeyEnv}=...`);
  if (entry.modelEnv) assignments.push(`${entry.modelEnv}=${providerGuideEnvValue(model || "...")}`);
  if (entry.baseURLEnv && entry.includeBaseURL) assignments.push(`${entry.baseURLEnv}=${providerGuideEnvValue(baseURL || "...")}`);
  const prefix = assignments.join(" ");
  const liveCommand = `${prefix ? `${prefix} ` : ""}npm run verify:provider:live -- --include ${entry.include}`;
  const imageCommand = canUseImageInput(profile) ? `${prefix ? `${prefix} ` : ""}npm run verify:provider:image:live -- --include ${entry.include}` : "";
  const pdfCommand = canUsePdfBase64Input(profile) ? `${prefix ? `${prefix} ` : ""}npm run verify:provider:pdf:live -- --include ${entry.include}` : "";
  const modelAssignments = assignments.filter((item) => !item.startsWith(`${entry.modelEnv}=`));
  const modelPrefix = modelAssignments.join(" ");
  const modelsCommand = `${modelPrefix ? `${modelPrefix} ` : ""}npm run verify:provider:models:live -- --include ${entry.include}`;
  const envTemplateCommand = `npm run verify:provider:live -- --env-template --include ${entry.include}`;
  const envFileCommand = `npm run verify:provider:live -- --include ${entry.include} --env-file .env.local`;
  const envFileImageCommand = canUseImageInput(profile) ? `npm run verify:provider:image:live -- --include ${entry.include} --env-file .env.local` : "";
  const envFilePdfCommand = canUsePdfBase64Input(profile) ? `npm run verify:provider:pdf:live -- --include ${entry.include} --env-file .env.local` : "";
  const envFileModelsCommand = `npm run verify:provider:models:live -- --include ${entry.include} --env-file .env.local`;
  const overrideCommands = providerCapabilityOverrideCommands(profile, provider, entry, prefix);
  return {
    ...entry,
    liveCommand,
    imageCommand,
    pdfCommand,
    modelsCommand,
    envTemplateCommand,
    envFileCommand,
    envFileImageCommand,
    envFilePdfCommand,
    envFileModelsCommand,
    ...overrideCommands
  };
}

function providerCapabilityOverrideCommands(profile, provider, entry, prefix) {
  if (!shouldShowCapabilityOverrideGuide(profile, provider)) return {};
  const envName = providerCapabilitiesEnvName(entry);
  const commandPrefix = [prefix, `${envName}='${JSON.stringify({ imageBase64: true })}'`].filter(Boolean).join(" ");
  const pdfPrefix = [prefix, `${envName}='${JSON.stringify({ pdfBase64: true })}'`].filter(Boolean).join(" ");
  return {
    capabilitiesEnv: envName,
    imageOverrideCommand: canUseImageInput(profile)
      ? ""
      : `${commandPrefix} npm run verify:provider:image:live -- --include ${entry.include}`,
    pdfOverrideCommand: canUsePdfBase64Input(profile) || profile?.protocol === "openai_chat"
      ? ""
      : `${pdfPrefix} npm run verify:provider:pdf:live -- --include ${entry.include}`
  };
}

function shouldShowCapabilityOverrideGuide(profile, provider) {
  const key = String(provider || "").replace(/-/g, "_");
  if (["openai_compatible", "openai_responses_compatible", "anthropic_compatible"].includes(key)) return true;
  if (profile?.endpointMode === "full_url") return true;
  return providerBaseURLDiffers(profile, provider);
}

function providerCapabilitiesEnvName(entry) {
  const key = String(entry?.apiKeyEnv || "").replace(/_API_KEY$/, "");
  if (key) return `${key}_CAPABILITIES_JSON`;
  return `${String(entry?.include || "PROVIDER").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CAPABILITIES_JSON`;
}

function providerLiveVerifyCase(profile, provider = providerFromProfile(profile)) {
  const endpoint = endpointForProfileSafe(profile);
  const apiKeyOptional = isLocalAgentProfile(profile) || isLocalEndpoint(endpoint);
  const includeNamedBaseURL = providerBaseURLDiffers(profile, provider);
  if (provider === "openai") {
    return { include: "openai", apiKeyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", baseURLEnv: "OPENAI_BASE_URL", includeBaseURL: false, apiKeyOptional };
  }
  if (provider === "anthropic") {
    return { include: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", baseURLEnv: "ANTHROPIC_BASE_URL", includeBaseURL: false, apiKeyOptional };
  }
  if (provider === "minimax") {
    return { include: "minimax", apiKeyEnv: "MINIMAX_API_KEY", modelEnv: "MINIMAX_MODEL", baseURLEnv: "MINIMAX_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "gemini") {
    return { include: "gemini", apiKeyEnv: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL", baseURLEnv: "GEMINI_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "azure_openai") {
    return { include: "azure-openai", apiKeyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_MODEL", baseURLEnv: "AZURE_OPENAI_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (provider === "github_models") {
    return { include: "github-models", apiKeyEnv: "GITHUB_MODELS_API_KEY", modelEnv: "GITHUB_MODELS_MODEL", baseURLEnv: "GITHUB_MODELS_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "fireworks") {
    return { include: "fireworks", apiKeyEnv: "FIREWORKS_API_KEY", modelEnv: "FIREWORKS_MODEL", baseURLEnv: "FIREWORKS_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "cerebras") {
    return { include: "cerebras", apiKeyEnv: "CEREBRAS_API_KEY", modelEnv: "CEREBRAS_MODEL", baseURLEnv: "CEREBRAS_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "nvidia_nim") {
    return { include: "nvidia-nim", apiKeyEnv: "NVIDIA_NIM_API_KEY", modelEnv: "NVIDIA_NIM_MODEL", baseURLEnv: "NVIDIA_NIM_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "sambanova") {
    return { include: "sambanova", apiKeyEnv: "SAMBANOVA_API_KEY", modelEnv: "SAMBANOVA_MODEL", baseURLEnv: "SAMBANOVA_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "sambanova_responses") {
    return { include: "sambanova-responses", apiKeyEnv: "SAMBANOVA_RESPONSES_API_KEY", modelEnv: "SAMBANOVA_RESPONSES_MODEL", baseURLEnv: "SAMBANOVA_RESPONSES_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "sambanova_anthropic") {
    return { include: "sambanova-anthropic", apiKeyEnv: "SAMBANOVA_ANTHROPIC_API_KEY", modelEnv: "SAMBANOVA_ANTHROPIC_MODEL", baseURLEnv: "SAMBANOVA_ANTHROPIC_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "xai") {
    return { include: "xai", apiKeyEnv: "XAI_API_KEY", modelEnv: "XAI_MODEL", baseURLEnv: "XAI_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "groq") {
    return { include: "groq", apiKeyEnv: "GROQ_API_KEY", modelEnv: "GROQ_MODEL", baseURLEnv: "GROQ_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "mistral") {
    return { include: "mistral", apiKeyEnv: "MISTRAL_API_KEY", modelEnv: "MISTRAL_MODEL", baseURLEnv: "MISTRAL_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "together") {
    return { include: "together", apiKeyEnv: "TOGETHER_API_KEY", modelEnv: "TOGETHER_MODEL", baseURLEnv: "TOGETHER_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "kimi") {
    return { include: "kimi", apiKeyEnv: "KIMI_API_KEY", modelEnv: "KIMI_MODEL", baseURLEnv: "KIMI_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "perplexity") {
    return { include: "perplexity", apiKeyEnv: "PERPLEXITY_API_KEY", modelEnv: "PERPLEXITY_MODEL", baseURLEnv: "PERPLEXITY_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "deepseek") {
    return { include: "deepseek", apiKeyEnv: "DEEPSEEK_API_KEY", modelEnv: "DEEPSEEK_MODEL", baseURLEnv: "DEEPSEEK_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "deepseek_anthropic") {
    return { include: "deepseek-anthropic", apiKeyEnv: "DEEPSEEK_ANTHROPIC_API_KEY", modelEnv: "DEEPSEEK_ANTHROPIC_MODEL", baseURLEnv: "DEEPSEEK_ANTHROPIC_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "zai_anthropic") {
    return { include: "zai-anthropic", apiKeyEnv: "ZAI_ANTHROPIC_API_KEY", modelEnv: "ZAI_ANTHROPIC_MODEL", baseURLEnv: "ZAI_ANTHROPIC_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "openrouter") {
    return { include: "openrouter", apiKeyEnv: "OPENROUTER_API_KEY", modelEnv: "OPENROUTER_MODEL", baseURLEnv: "OPENROUTER_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "dashscope") {
    return { include: "dashscope", apiKeyEnv: "DASHSCOPE_API_KEY", modelEnv: "DASHSCOPE_MODEL", baseURLEnv: "DASHSCOPE_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "siliconflow") {
    return { include: "siliconflow", apiKeyEnv: "SILICONFLOW_API_KEY", modelEnv: "SILICONFLOW_MODEL", baseURLEnv: "SILICONFLOW_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "zhipu") {
    return { include: "zhipu", apiKeyEnv: "ZHIPU_API_KEY", modelEnv: "ZHIPU_MODEL", baseURLEnv: "ZHIPU_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "volcengine") {
    return { include: "volcengine", apiKeyEnv: "VOLCENGINE_API_KEY", modelEnv: "VOLCENGINE_MODEL", baseURLEnv: "VOLCENGINE_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "qianfan") {
    return { include: "qianfan", apiKeyEnv: "QIANFAN_API_KEY", modelEnv: "QIANFAN_MODEL", baseURLEnv: "QIANFAN_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "hunyuan") {
    return { include: "hunyuan", apiKeyEnv: "HUNYUAN_API_KEY", modelEnv: "HUNYUAN_MODEL", baseURLEnv: "HUNYUAN_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "ollama") {
    return { include: "ollama", apiKeyEnv: "OLLAMA_API_KEY", modelEnv: "OLLAMA_MODEL", baseURLEnv: "OLLAMA_BASE_URL", includeBaseURL: true, apiKeyOptional: true };
  }
  if (provider === "lm_studio" || provider === "lm-studio") {
    return { include: "lm-studio", apiKeyEnv: "LM_STUDIO_API_KEY", modelEnv: "LM_STUDIO_MODEL", baseURLEnv: "LM_STUDIO_BASE_URL", includeBaseURL: true, apiKeyOptional: true };
  }
  if (profile?.protocol === "openai_responses") {
    return { include: "openai-responses-compatible", apiKeyEnv: "OPENAI_RESPONSES_COMPATIBLE_API_KEY", modelEnv: "OPENAI_RESPONSES_COMPATIBLE_MODEL", baseURLEnv: "OPENAI_RESPONSES_COMPATIBLE_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (profile?.protocol === "anthropic_messages") {
    return { include: "anthropic-compatible", apiKeyEnv: "ANTHROPIC_COMPATIBLE_API_KEY", modelEnv: "ANTHROPIC_COMPATIBLE_MODEL", baseURLEnv: "ANTHROPIC_COMPATIBLE_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  return { include: "openai-compatible", apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY", modelEnv: "OPENAI_COMPATIBLE_MODEL", baseURLEnv: "OPENAI_COMPATIBLE_BASE_URL", includeBaseURL: true, apiKeyOptional };
}

function providerBaseURLDiffers(profile, provider) {
  const value = normalizeEndpointRoot(profile?.baseURL || "");
  const defaults = providerDefaults(provider);
  const defaultValue = normalizeEndpointRoot(defaults?.baseURL || "");
  if (!value) return false;
  if (!defaultValue) return true;
  return value !== defaultValue;
}

function normalizeEndpointRoot(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function providerGuideEnvValue(value) {
  const text = String(value || "...");
  if (text === "...") return text;
  return /^[A-Za-z0-9_./:@-]+$/.test(text) ? text : JSON.stringify(text);
}

function endpointForProfileSafe(profile) {
  try {
    return endpointForProfile(profile);
  } catch (_err) {
    return "";
  }
}

function canUsePdfBase64Input(profile) {
  return profile?.capabilities?.pdfBase64 === true && profile.protocol !== "openai_chat";
}

function canUseImageInput(profile) {
  return profile?.capabilities?.imageBase64 === true;
}

function profileDraftFromEditor() {
  const errors = [];
  const customHeaders = jsonObjectFromValue(document.getElementById("zms-profileCustomHeaders")?.value, errors) || {};
  const bodyExtra = jsonObjectFromValue(document.getElementById("zms-profileBodyExtra")?.value, errors) || {};
  const localAgent = localAgentDraftFromEditor(errors);
  if (localAgent) {
    bodyExtra.localAgent = localAgent;
  } else if (bodyExtra.localAgent !== undefined) {
    delete bodyExtra.localAgent;
  }
  const profile = {
    id: normalizeProfileId(document.getElementById("zms-activeProfileId")?.value || document.getElementById("zms-profileName")?.value) || "custom",
    name: String(document.getElementById("zms-profileName")?.value || "").trim(),
    protocol: document.getElementById("zms-profileProtocol")?.value || "openai_chat",
    endpointMode: document.getElementById("zms-profileEndpointMode")?.value || "base_url",
    baseURL: document.getElementById("zms-baseURL")?.value || "",
    fullURL: document.getElementById("zms-profileFullURL")?.value || "",
    apiKey: document.getElementById("zms-apiKey")?.value || "",
    model: document.getElementById("zms-model")?.value || "",
    capabilities: capabilityDraftFromEditor(),
    customHeaders,
    bodyExtra
  };
  return { profile: hydrateProfile(profile), errors };
}

function capabilityDraftFromEditor() {
  return {
    text: !!document.getElementById("zms-cap-text")?.checked,
    pdfBase64: !!document.getElementById("zms-cap-pdfBase64")?.checked,
    imageBase64: !!document.getElementById("zms-cap-imageBase64")?.checked,
    streaming: !!document.getElementById("zms-cap-streaming")?.checked,
    fileReference: !!document.getElementById("zms-cap-fileReference")?.checked,
    embeddings: !!document.getElementById("zms-cap-embeddings")?.checked,
    jsonMode: !!document.getElementById("zms-cap-jsonMode")?.checked,
    toolUse: !!document.getElementById("zms-cap-toolUse")?.checked,
    modelList: !!document.getElementById("zms-cap-modelList")?.checked
  };
}

function localAgentDraftFromEditor(errors) {
  const enabled = !!document.getElementById("zms-profileLocalAgentEnabled")?.checked;
  const endpoint = String(document.getElementById("zms-profileLocalAgentEndpoint")?.value || "").trim();
  const tool = String(document.getElementById("zms-profileLocalAgentTool")?.value || "").trim();
  const headers = jsonObjectFromValue(document.getElementById("zms-profileLocalAgentHeaders")?.value, errors) || {};
  const skillMap = jsonObjectFromValue(document.getElementById("zms-profileLocalAgentSkills")?.value, errors) || {};
  if (!enabled && !endpoint && !tool && !Object.keys(skillMap).length) return undefined;
  if (!enabled) return undefined;
  const rawTimeout = Number(document.getElementById("zms-profileLocalAgentTimeout")?.value);
  const result = {
    endpoint,
    tool,
    payloadMode: normalizeLocalAgentPayloadMode(document.getElementById("zms-profileLocalAgentPayloadMode")?.value),
    fallbackToRemote: !!document.getElementById("zms-profileLocalAgentFallback")?.checked
  };
  if (Number.isFinite(rawTimeout) && rawTimeout > 0) result.timeoutSeconds = Math.round(rawTimeout);
  if (Object.keys(headers).length) result.headers = headers;
  for (const [skillId, config] of Object.entries(skillMap)) {
    if (typeof config === "string") result[skillId] = { endpoint: config };
    else if (config && typeof config === "object" && !Array.isArray(config)) result[skillId] = config;
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== "" && value !== false && value !== undefined));
}

function jsonObjectFromValue(value, errors) {
  const text = String(value || "").trim();
  if (!text) return {};
  const parsed = safeParseJSON(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  errors.push("json");
  return null;
}

function connectionTestRequestForProfile(profile) {
  const body = connectionTestBodyForProfile(profile);
  return {
    url: endpointForProfile(profile),
    headers: headersForProfile(profile),
    body: profile?.protocol === "openai_chat" ? withOpenAIChatBodyDefaults(profile, body) : withProviderBodyDefaults(profile, body)
  };
}

async function runProviderConnectionTest(profile, request) {
  let body = request.body;
  let headers = request.headers;
  const usedFallbackFields = [];
  let lastResponse = null;
  let lastText = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(request.url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await response.text();
    lastResponse = response;
    lastText = text;
    const fallbackFields = providerCompatibilityFallbackFields(profile?.protocol, body, response.status, text, usedFallbackFields);
    if (response.ok && !fallbackFields.length) return { response, text };
    if (!fallbackFields.length) return { response, text };
    usedFallbackFields.push(...fallbackFields);
    body = omitProviderRequestBodyFields(body, fallbackFields, usedFallbackFields);
    headers = providerRequestHeadersWithFallback(headers, fallbackFields);
  }
  return { response: lastResponse, text: lastText };
}

function modelListRequestForProfile(profile) {
  const url = modelsEndpointForProfile(profile);
  if (!url) return null;
  return {
    url,
    headers: headersForProfile(profile),
    profile
  };
}

function localAgentConnectionTestRequestForProfile(profile) {
  const localAgent = localAgentConfigForProfile(profile);
  const endpoint = normalizeLocalAgentEndpoint(localAgent?.endpoint || "http://127.0.0.1:3333/mcp");
  return {
    url: endpoint,
    headers: {
      "content-type": "application/json",
      ...(localAgent?.headers || {})
    },
    body: {
      jsonrpc: "2.0",
      id: `settings-${Date.now()}`,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "zotero-markdown-summary-settings",
          version: "0.1.5"
        }
      }
    }
  };
}

function localAgentToolsListRequestForProfile(profile) {
  const localAgent = localAgentConfigForProfile(profile);
  const endpoint = normalizeLocalAgentEndpoint(localAgent?.endpoint || "http://127.0.0.1:3333/mcp");
  return {
    url: endpoint,
    headers: {
      "content-type": "application/json",
      ...(localAgent?.headers || {})
    },
    body: {
      jsonrpc: "2.0",
      id: `settings-tools-${Date.now()}`,
      method: "tools/list",
      params: {}
    }
  };
}

async function verifyLocalAgentConnection(profile) {
  const initializeRequest = localAgentConnectionTestRequestForProfile(profile);
  await assertLocalAgentRequestOk(initializeRequest);
  const toolsRequest = localAgentToolsListRequestForProfile(profile);
  const toolsPayload = await assertLocalAgentRequestOk(toolsRequest);
  const names = localAgentToolNamesFromResponse(toolsPayload);
  const missing = REQUIRED_LOCAL_AGENT_TOOL_NAMES.filter((name) => !names.includes(name));
  if (missing.length) {
    throw new Error(`Missing Local Agents MCP tools: ${missing.join(", ")}`);
  }
  return true;
}

async function assertLocalAgentRequestOk(request) {
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
  const text = await response.text();
  const data = safeParseJSON(text);
  if (!response.ok || data?.error) {
    throw new Error(localAgentErrorText(response.status, text));
  }
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

function isLocalAgentProfile(profile) {
  return !!localAgentConfigForProfile(profile);
}

function localAgentConfigForProfile(profile) {
  return parseLocalAgentConfig(profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent);
}

function normalizeLocalAgentEndpoint(endpoint) {
  const value = String(endpoint || "").trim() || "http://127.0.0.1:3333/mcp";
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

function modelsEndpointForProfile(profile) {
  if (!profile?.capabilities?.modelList || profile.endpointMode === "full_url") return "";
  const base = stripKnownProviderEndpointPath(profile.baseURL);
  if (!base) return "";
  if (profile.protocol === "anthropic_messages") {
    return /\/v\d+$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
  }
  return `${openAICompatibleBaseWithVersion(base)}/models`;
}

function modelIdsFromResponse(data) {
  return modelOptionsFromResponse(data).map((option) => option.id);
}

function modelOptionsFromResponse(data) {
  return modelOptionsFromItems(modelListItemsFromResponse(data));
}

function modelOptionsFromItems(source) {
  const options = new Map();
  for (const item of source) {
    const option = modelOptionFromItem(item);
    if (option.id && !options.has(option.id)) options.set(option.id, option);
  }
  return [...options.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchModelOptions(request) {
  const items = [];
  const seenUrls = new Set();
  let nextUrl = request.url;
  let headers = request.headers;
  const usedFallbackFields = [];
  for (let page = 0; nextUrl && page < MODEL_LIST_MAX_PAGES; page += 1) {
    if (seenUrls.has(nextUrl)) break;
    seenUrls.add(nextUrl);
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
    const errorText = providerResponseErrorDetail(data);
    if (errorText) {
      throw new Error(`Provider error: ${redact(errorText)}`);
    }
    items.push(...modelListItemsFromResponse(data));
    nextUrl = nextModelListURL(nextUrl, data);
  }
  return modelOptionsFromItems(items);
}

function nextModelListURL(currentUrl, data) {
  const envelope = modelListPaginationEnvelope(data);
  if (!envelope) return "";
  const direct = stringField(envelope.next_page, envelope.nextPage, envelope.next);
  if (direct) return modelListURLFromNextValue(currentUrl, direct);
  if (envelope.has_more !== true && envelope.hasMore !== true) return "";
  const tokenPairs = [
    ["after_id", stringField(envelope.last_id, envelope.lastId, envelope.after_id, envelope.afterId)],
    ["page_token", stringField(envelope.next_page_token, envelope.nextPageToken, envelope.next_token, envelope.nextToken)],
    ["after", stringField(envelope.next_cursor, envelope.nextCursor, envelope.cursor, envelope.after)]
  ];
  for (const [param, token] of tokenPairs) {
    if (token) return urlWithQueryParam(currentUrl, param, token);
  }
  return "";
}

function stringField(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function resolveModelListURL(currentUrl, nextValue) {
  if (/^https?:\/\//i.test(nextValue)) return nextValue;
  try {
    return new URL(nextValue, currentUrl).toString();
  } catch (_err) {
    return "";
  }
}

function modelListURLFromNextValue(currentUrl, nextValue) {
  if (/^https?:\/\//i.test(nextValue) || nextValue.startsWith("/") || nextValue.startsWith("?")) {
    return resolveModelListURL(currentUrl, nextValue);
  }
  return urlWithQueryParam(currentUrl, "page", nextValue);
}

function urlWithQueryParam(currentUrl, param, value) {
  try {
    const url = new URL(currentUrl);
    url.searchParams.set(param, value);
    return url.toString();
  } catch (_err) {
    return "";
  }
}

function isOllamaProfileId(id, baseURL) {
  if (id === "ollama") return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1):11434/i.test(String(baseURL || ""));
}

async function fetchOllamaTags(profile) {
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

function modelListItemsFromResponse(data, depth = 0) {
  const direct = directModelListItemsFromResponse(data);
  if (direct.length) return direct;
  if (depth >= 2 || !data || typeof data !== "object" || Array.isArray(data)) return [];
  for (const key of PREFERENCES_PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const items = modelListItemsFromResponse(value, depth + 1);
    if (items.length) return items;
  }
  return [];
}

function directModelListItemsFromResponse(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data?.model)
          ? data.model
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.list)
              ? data.list
              : Array.isArray(data?.model_list)
                ? data.model_list
                : Array.isArray(data?.modelList)
                  ? data.modelList
                  : Array.isArray(data?.available_models)
                    ? data.available_models
                    : Array.isArray(data?.availableModels)
                      ? data.availableModels
                      : Array.isArray(data?.model_names)
                        ? data.model_names
                        : Array.isArray(data?.modelNames)
                          ? data.modelNames
                          : Array.isArray(data?.models?.data)
                            ? data.models.data
                            : Array.isArray(data?.models?.items)
                              ? data.models.items
                              : [];
  return source;
}

function modelListPaginationEnvelope(data, depth = 0) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (hasModelListPaginationFields(data)) return data;
  if (depth >= 2) return null;
  for (const key of PREFERENCES_PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const envelope = modelListPaginationEnvelope(value, depth + 1);
    if (envelope) return envelope;
  }
  return null;
}

function hasModelListPaginationFields(data) {
  return !!stringField(data?.next_page, data?.nextPage, data?.next)
    || data?.has_more === true
    || data?.hasMore === true;
}

function modelOptionFromItem(item) {
  if (typeof item === "string") {
    const id = item.trim();
    return { id, label: id };
  }
  const id = stringField(item?.id, item?.model, item?.model_id, item?.modelId, item?.model_name, item?.modelName, item?.name, item?.value, item?.slug);
  const label = stringField(item?.display_name, item?.displayName, item?.label, item?.title, item?.model_name, item?.modelName, item?.name, id);
  return { id, label };
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function safeError(err) {
  return redact(err?.message || err || "Unknown error");
}

function providerErrorText(status, text) {
  return `HTTP ${status}: ${redact(providerErrorDetail(text))}`;
}

function extractProviderConnectionText(protocol, text) {
  const data = safeParseJSON(text);
  const errorText = providerResponseErrorDetail(data);
  if (errorText) throw new Error(`Provider error: ${redact(errorText)}`);
  const value = data
    ? providerTextFromResponse(protocol, data)
    : providerTextFromStreamText(protocol, text) || String(text || "").trim();
  if (!String(value || "").trim()) throw new Error("No text returned from model");
  return String(value).trim();
}

function providerTextFromStreamText(protocol, text) {
  const payloads = streamPayloadsFromText(text);
  if (!payloads.length) return "";
  return payloads
    .map((payload) => {
      const data = safeParseJSON(payload);
      if (!data) return payload.trim();
      const errorText = providerResponseErrorDetail(data);
      if (errorText) throw new Error(`Provider error: ${redact(errorText)}`);
      return providerTextFromResponse(protocol, data);
    })
    .filter(Boolean)
    .join("");
}

function streamPayloadsFromText(text) {
  const payloads = [];
  let buffer = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      if (buffer.length) {
        pushStreamPayload(payloads, buffer);
        buffer = [];
      }
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trimStart();
    if (value === "[DONE]") {
      if (buffer.length) {
        pushStreamPayload(payloads, buffer);
        buffer = [];
      }
      continue;
    }
    buffer.push(value);
  }
  if (buffer.length) pushStreamPayload(payloads, buffer);
  return payloads;
}

function pushStreamPayload(payloads, buffer) {
  const payload = buffer.join("\n").trim();
  if (payload) payloads.push(payload);
}

function providerResponseErrorDetail(data, depth = 0) {
  if (!data || typeof data !== "object") return "";
  const direct = directProviderResponseErrorDetail(data);
  if (direct) return direct;
  if (depth >= 3 || Array.isArray(data)) return "";
  for (const key of PREFERENCES_PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = providerResponseErrorDetail(value, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function directProviderResponseErrorDetail(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const error = data.error || (data.type === "error" ? data : null);
  if (error) {
    if (typeof error === "string") return error;
    const message = errorString(error.message, data.message, error.detail, data.detail, error.error_description, data.error_description);
    const code = errorString(error.code, data.code);
    const type = normalizedProviderErrorType(error.type);
    return [code, type, message || JSON.stringify(error)].filter(Boolean).join(" - ");
  }
  if (Array.isArray(data.errors) && data.errors.length) {
    const text = data.errors.map((entry) => directProviderResponseErrorDetail({ error: entry })).filter(Boolean).join("; ");
    if (text) return text;
  }
  const message = errorString(data.message, data.detail, data.error_description, data.errorMessage, data.error_message);
  const code = errorString(data.code, data.error_code, data.errorCode);
  const type = errorString(data.type, data.error_type, data.errorType);
  const status = errorString(data.status, data.status_code, data.statusCode);
  const statusText = status.toLowerCase();
  const typeText = type.toLowerCase();
  const looksLikeError = data.ok === false
    || data.success === false
    || /^(error|failed|failure|invalid|unauthorized|forbidden)$/i.test(statusText)
    || /error|invalid|unauth|forbidden|denied|rate|limit|unsupported/.test(typeText)
    || !!code;
  return message && looksLikeError ? [code, type, status, message].filter(Boolean).join(" - ") : "";
}

function normalizedProviderErrorType(value) {
  const type = errorString(value);
  return type.toLowerCase() === "error" ? "" : type;
}

function errorString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function providerTextFromResponse(protocol, data) {
  if (protocol === "anthropic_messages") return anthropicTextFromResponse(data);
  return openAITextFromResponse(data);
}

const PREFERENCES_PROVIDER_RESPONSE_WRAPPER_KEYS = ["data", "result", "payload", "response", "message", "body", "completion"];
const PREFERENCES_PROVIDER_FALLBACK_BODY_FIELDS = new Set([
  "stream_options",
  "stream",
  "temperature",
  "n",
  "response_format",
  "max_completion_tokens",
  "max_tokens",
  "text",
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
  "messages.content",
  "messages.content.document",
  "messages.role.system",
  "image_url.url",
  "input_file.file_data",
  "input_file.file_url"
]);
const PREFERENCES_PROVIDER_REQUIRED_BODY_FIELDS = new Set(["model", "messages", "input"]);
const PREFERENCES_MODEL_TEXT_CONTAINER_KEYS = [
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
  "completion"
];

function openAITextFromResponse(data, depth = 0) {
  return data?.output_text
    || modelTextFromValue(data?.choices?.[0]?.message?.content)
    || modelTextFromValue(data?.choices?.[0]?.delta?.content)
    || data?.choices?.[0]?.text
    || data?.choices?.[0]?.delta?.text
    || openAIEventDeltaText(data)
    || modelTextFromValue(data?.output)
    || modelTextFromValue(data?.content)
    || modelTextFromValue(data?.candidates)
    || modelTextFromValue(data?.part)
    || modelTextFromValue(data?.item)
    || modelTextFromValue(data?.message)
    || modelTextFromValue(data?.response)
    || wrappedProviderTextFromResponse("openai", data, depth)
    || "";
}

function anthropicTextFromResponse(data, depth = 0) {
  if (data?.type === "content_block_delta") {
    if (typeof data?.delta?.text === "string") return data.delta.text;
    if (typeof data?.delta?.partial_json === "string") return data.delta.partial_json;
  }
  if (typeof data?.delta?.text === "string") return data.delta.text;
  if (typeof data?.content_block?.text === "string") return data.content_block.text;
  return modelTextFromValue(data?.content)
    || modelTextFromValue(data?.message)
    || modelTextFromValue(data?.body)
    || modelTextFromValue(data?.candidates)
    || (typeof data?.text === "string" ? data.text : wrappedProviderTextFromResponse("anthropic", data, depth));
}

function openAIEventDeltaText(data) {
  const type = String(data?.type || "");
  if ((type === "response.output_text.delta" || type === "response.text.delta") && typeof data?.delta === "string") return data.delta;
  if (typeof data?.delta?.text === "string") return data.delta.text;
  if (typeof data?.delta?.content === "string") return data.delta.content;
  return "";
}

function wrappedProviderTextFromResponse(protocol, data, depth) {
  if (depth >= 2 || !data || typeof data !== "object") return "";
  for (const key of PREFERENCES_PROVIDER_RESPONSE_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object") continue;
    const text = protocol === "anthropic"
      ? anthropicTextFromResponse(value, depth + 1)
      : openAITextFromResponse(value, depth + 1);
    if (text) return text;
  }
  return "";
}

function modelTextFromValue(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => modelTextFromValue(part, depth + 1)).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (isReasoningModelPart(value)) return "";
    if (typeof value.text === "string") return value.text;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.completion === "string") return value.completion;
    for (const key of PREFERENCES_MODEL_TEXT_CONTAINER_KEYS) {
      const nested = value?.[key];
      if (!nested || nested === value) continue;
      const text = modelTextFromValue(nested, depth + 1);
      if (text) return text;
    }
  }
  return "";
}

function isReasoningModelPart(value) {
  const type = String(value?.type || "");
  return type.includes("reasoning") || type.includes("thinking");
}

function localAgentErrorText(status, text) {
  const detail = redact(providerErrorDetail(text));
  return status && Number(status) !== 200 ? `HTTP ${status}: ${detail}` : detail;
}

function providerErrorDetail(text) {
  const parsed = safeParseJSON(text);
  if (parsed) {
    const responseError = providerResponseErrorDetail(parsed);
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
    .replace(/\b(?:sk|ak|xai|gsk|pplx|ms|rk)[-_][A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .slice(0, 800);
}

function renderModelOptions(modelOptions) {
  const list = document.getElementById("zms-model-options");
  if (!list) return;
  list.textContent = "";
  for (const entry of normalizeModelOptions(modelOptions)) {
    const option = document.createElement("option");
    option.value = entry.id;
    if (entry.label && entry.label !== entry.id) {
      option.label = entry.label;
      option.setAttribute?.("label", entry.label);
    }
    list.appendChild(option);
  }
}

function renderProfileOptions(list, profileOptions) {
  clearElement(list);
  for (const entry of profileOptions) {
    const option = document.createElement("option");
    option.value = entry.id;
    if (entry.label && entry.label !== entry.id) {
      option.label = entry.label;
      option.setAttribute?.("label", entry.label);
    }
    list.appendChild(option);
  }
}

function profileOptionsFromProfiles(profiles) {
  const seen = new Set();
  return (profiles || [])
    .map((profile) => ({
      id: normalizeProfileId(profile?.id),
      label: profileOptionLabel(profile)
    }))
    .filter((entry) => {
      if (!entry.id || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

function profileOptionLabel(profile) {
  const parts = [
    String(profile?.name || "").trim(),
    String(profile?.protocol || "").trim(),
    String(profile?.model || "").trim()
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : normalizeProfileId(profile?.id);
}

function normalizeModelOptions(modelOptions) {
  return (modelOptions || [])
    .map((entry) => typeof entry === "string" ? { id: entry, label: "" } : entry)
    .map((entry) => ({
      id: String(entry?.id || "").trim(),
      label: String(entry?.label || "").trim()
    }))
    .filter((entry) => entry.id);
}

function connectionTestBodyForProfile(profile) {
  const system = "You are a provider connection test endpoint. Reply with pong only.";
  if (profile.protocol === "anthropic_messages") {
    const systemInUser = normalizeBoolean(profile?.bodyExtra?.systemFallbackToUser, false);
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
    const instructionsInUser = normalizeBoolean(profile?.bodyExtra?.instructionsFallbackToUser, false);
    const input = [
      {
        role: "user",
        content: [{ type: "input_text", text: "ping" }]
      }
    ];
    return {
      model: profile.model,
      ...(instructionsInUser ? {} : { instructions: system }),
      input: instructionsInUser ? inputWithPrependedOpenAIResponsesText(input, fallbackSystemText(system)) : input,
      max_output_tokens: 32,
      stream: false
    };
  }
  return {
    model: profile.model,
    messages: normalizeBoolean(profile?.bodyExtra?.systemFallbackToUser, false)
      ? messagesWithPrependedOpenAIChatText([{ role: "user", content: "ping" }], fallbackSystemText(system))
      : [
        { role: "system", content: system },
        { role: "user", content: "ping" }
      ],
    ...openAIChatTokenLimit(profile, 32),
    ...openAIChatOptionalDefaults(profile, { n: 1 }),
    stream: shouldProfileStream(profile)
  };
}

function shouldProfileStream(profile) {
  return profile?.capabilities?.streaming === true;
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
    omitAnthropicDocument: _omitAnthropicDocument,
    skipAnthropicDocument: _skipAnthropicDocument,
    dropAnthropicDocument: _dropAnthropicDocument,
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

function openAIChatOptionalDefaults(profile, defaults) {
  return openAIChatTokenLimitField(profile) === "max_completion_tokens" ? {} : defaults;
}

function providerCompatibilityFallbackFields(protocol, body, status, text, usedFallback = false) {
  if (usedFallback === true || !["openai_chat", "openai_responses", "anthropic_messages"].includes(protocol) || !providerFallbackEligibleStatus(body, status, text, protocol)) return [];
  const usedFields = new Set(Array.isArray(usedFallback) ? usedFallback : []);
  const detail = String(text || "").toLowerCase();
  const fields = providerStructuredUnsupportedFields(body, text, protocol);
  if (body?.stream_options !== undefined && /stream_options|stream options|stream option/.test(detail)) {
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
  if (body?.response_format !== undefined && /response_format|response format/.test(detail)) {
    fields.push("response_format");
  }
  if (body?.max_completion_tokens !== undefined && /max_completion_tokens|max completion tokens|max completion token/.test(detail)) {
    fields.push("max_completion_tokens");
  }
  if (body?.max_tokens !== undefined && /max_tokens|max tokens|max token/.test(detail)) {
    fields.push("max_tokens");
  }
  if (body?.text !== undefined && /text\.format|text format|text\.verbosity|text verbosity|(?:^|[^a-z0-9_])text(?:[^a-z0-9_]|$)|json mode|json_schema|json schema/.test(detail)) {
    fields.push("text");
  }
  if (body?.max_output_tokens !== undefined && /max_output_tokens|max output tokens|max output token/.test(detail)) {
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
  if (body?.top_p !== undefined && /top_p|top p/.test(detail)) {
    fields.push("top_p");
  }
  if (body?.presence_penalty !== undefined && /presence_penalty|presence penalty/.test(detail)) {
    fields.push("presence_penalty");
  }
  if (body?.frequency_penalty !== undefined && /frequency_penalty|frequency penalty/.test(detail)) {
    fields.push("frequency_penalty");
  }
  if (body?.seed !== undefined && /(?:^|[^a-z0-9_])seed(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("seed");
  }
  if (body?.top_logprobs !== undefined && /top_logprobs|top logprobs/.test(detail)) {
    fields.push("top_logprobs");
  }
  if (body?.logprobs !== undefined && /(?:^|[^a-z0-9_])logprobs(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("logprobs");
  }
  if (body?.parallel_tool_calls !== undefined && /parallel_tool_calls|parallel tool calls|parallel tool call/.test(detail)) {
    fields.push("parallel_tool_calls");
  }
  if (body?.reasoning_effort !== undefined && /reasoning_effort|reasoning effort/.test(detail)) {
    fields.push("reasoning_effort");
  }
  if (body?.stop !== undefined && /(?:^|[^a-z0-9_])stop(?:[^a-z0-9_]|$)|stop sequence|stop sequences/.test(detail)) {
    fields.push("stop");
  }
  if (body?.top_k !== undefined && /top_k|top k/.test(detail)) {
    fields.push("top_k");
  }
  if (body?.stop_sequences !== undefined && /stop_sequences|stop sequences|stop sequence/.test(detail)) {
    fields.push("stop_sequences");
  }
  if (body?.tools !== undefined && /(?:^|[^a-z0-9_])tools?(?:[^a-z0-9_]|$)/.test(detail)) {
    fields.push("tools");
  }
  if (body?.tool_choice !== undefined && /tool_choice|tool choice/.test(detail)) {
    fields.push("tool_choice");
  }
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
  const rejectedImageURLField = rejectedOpenAIChatImageURLField(body, detail);
  if (protocol === "openai_chat" && rejectedImageURLField) {
    fields.push(rejectedImageURLField);
  }
  const rejectedSystemRoleField = rejectedOpenAIChatSystemRoleField(body, detail);
  if (protocol === "openai_chat" && rejectedSystemRoleField) {
    fields.push(rejectedSystemRoleField);
  }
  const rejectedPDFField = rejectedOpenAIResponsesPdfFileField(body, detail);
  if (protocol === "openai_responses" && rejectedPDFField) {
    fields.push(rejectedPDFField);
  }
  return Array.from(new Set(fields)).filter((field) => !usedFields.has(field));
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
  if (providerResponseErrorDetail(parsed)) return true;
  if (protocol === "anthropic_messages" && rejectedAnthropicVersionHeader(String(text || "").toLowerCase())) return true;
  if (!providerStructuredUnsupportedFields(body, text, protocol).length) return false;
  return /unsupported|unrecognized|not supported|unknown (?:field|parameter|argument)|extra_forbidden|not permitted|invalid|forbidden/.test(String(text || "").toLowerCase());
}

function providerStructuredUnsupportedFields(body, text, protocol = "") {
  const parsed = safeParseJSON(text);
  if (!parsed) return [];
  const hints = [];
  collectProviderFieldHints(parsed, hints);
  return hints
    .map((value) => normalizeProviderFieldHint(value))
    .filter((field) => providerFallbackFieldSupported(body, field, protocol) && providerFallbackFieldPresent(body, field));
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
    if (path) hints.push(path);
    for (const item of value) collectProviderFieldHintValue(item, hints);
  }
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
    path += path ? `.${text}` : text;
  }
  return path.includes(".") || path.includes("[") ? path : "";
}

function isProviderFieldHintKey(key) {
  return /^(?:param|params|parameter|parameters|field|fields|property|properties|argument|arguments|loc|location|path|json_path|jsonpath|unsupported_param|unsupported_params|unsupported_parameter|unsupported_parameters|unsupported_field|unsupported_fields|unknown_param|unknown_params|unknown_parameter|unknown_parameters|unknown_field|unknown_fields|invalid_param|invalid_params|invalid_parameter|invalid_parameters|invalid_field|invalid_fields|extra_field|extra_fields|forbidden_field|forbidden_fields|unrecognized_param|unrecognized_params|unrecognized_parameter|unrecognized_parameters|unrecognized_field|unrecognized_fields)$/i.test(key);
}

function normalizeProviderFieldHint(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\$\.?/, "")
    .replace(/^(?:body|request|payload|params?|parameters?|input)\./i, "")
    .replace(/\[[^\]]+\]/g, "");
  if (/\bfile_data\b/.test(normalized)) return "input_file.file_data";
  if (/\bfile_url\b/.test(normalized)) return "input_file.file_url";
  if (/image_url\.url|image_url_url|imageurl\.url|imageurlurl|(?:^|[^a-z0-9_])image_url(?:[^a-z0-9_]|$)|(?:^|[^a-z0-9_])imageurl(?:[^a-z0-9_]|$)/.test(normalized)) return "image_url.url";
  if (/messages?(?:\.\d+|\[\d+\])?\.content.*(?:document|source|media_type|mediatype|base64|application\/pdf)|messages?content.*(?:document|source|media_type|mediatype|base64|applicationpdf)|(?:^|[^a-z0-9_])document(?:[^a-z0-9_]|$)/.test(normalized)) return "messages.content.document";
  if (/messages?(?:\.\d+|\[\d+\])?\.content|messages?content/.test(normalized)) return "messages.content";
  if (/messages?(?:\.\d+|\[\d+\])?\.role|messages?role/.test(normalized)) return "messages.role.system";
  return normalized
    .split(".")[0]
    .trim();
}

function providerFallbackFieldPresent(body, field) {
  if (field === "messages.content") return anthropicMessagesHaveStringContent(body);
  if (field === "messages.content.document") return anthropicMessagesHaveDocumentBlock(body);
  if (field === "messages.role.system") return openAIChatHasSystemMessage(body);
  if (field === "image_url.url") return openAIChatImageURLHasObjectURL(body);
  if (field === "input_file.file_data") return openAIResponsesInputFileHasField(body, "file_data");
  if (field === "input_file.file_url") return openAIResponsesInputFileHasField(body, "file_url");
  return body?.[field] !== undefined;
}

function providerFallbackFieldSupported(body, field, protocol = "") {
  if (!field) return false;
  if (field === "messages.content") return protocol === "anthropic_messages";
  if (field === "messages.content.document") return protocol === "anthropic_messages";
  if (field === "messages.role.system") return protocol === "openai_chat";
  if (PREFERENCES_PROVIDER_FALLBACK_BODY_FIELDS.has(field)) return true;
  return providerFallbackCustomBodyFieldPresent(body, field);
}

function providerFallbackCustomBodyFieldPresent(body, field) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) return false;
  if (PREFERENCES_PROVIDER_REQUIRED_BODY_FIELDS.has(field.toLowerCase())) return false;
  return Object.prototype.hasOwnProperty.call(body || {}, field);
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

function anthropicMessagesHaveDocumentBlock(body) {
  return anthropicDocumentBlocks(body).length > 0;
}

function anthropicDocumentBlocks(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    .filter((part) => part?.type === "document" && part && typeof part === "object");
}

function rejectedOpenAIChatImageURLField(body, detail) {
  if (!openAIChatImageURLHasObjectURL(body)) return "";
  if (/image_url\.url|image_url_url|imageurl\.url|imageurlurl|(?:^|[^a-z0-9_])image_url(?:[^a-z0-9_]|$)|image url|(?:^|[^a-z0-9_])imageurl(?:[^a-z0-9_]|$)/.test(detail)) return "image_url.url";
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

function openAIResponsesInputFileHasField(body, field) {
  return openAIResponsesInputFileParts(body).some((part) => part[field] !== undefined);
}

function openAIResponsesInputFileParts(body) {
  const input = Array.isArray(body?.input) ? body.input : [];
  return input.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === "input_file" && part && typeof part === "object");
}

function omitProviderRequestBodyFields(body, fields, usedFallback = false) {
  if (!fields.length) return body;
  const next = { ...body };
  const usedFields = new Set(Array.isArray(usedFallback) ? usedFallback : []);
  for (const field of fields) {
    if (field === "instructions") {
      moveInstructionsIntoOpenAIResponsesInput(next);
      continue;
    }
    if (field === "system") {
      moveAnthropicSystemIntoMessages(next);
      continue;
    }
    if (field === "max_completion_tokens" && !usedFields.has("max_tokens") && next.max_completion_tokens !== undefined && next.max_tokens === undefined) {
      next.max_tokens = next.max_completion_tokens;
      delete next.max_completion_tokens;
      continue;
    }
    if (field === "max_tokens" && !usedFields.has("max_completion_tokens") && next.max_tokens !== undefined && next.max_completion_tokens === undefined) {
      next.max_completion_tokens = next.max_tokens;
      delete next.max_tokens;
      continue;
    }
    if (field === "input_file.file_data") {
      if (usedFields.has("input_file.file_url")) {
        removeOpenAIResponsesInputFiles(next);
      } else {
        switchOpenAIResponsesInputFileField(next, "file_data", "file_url");
      }
      continue;
    }
    if (field === "input_file.file_url") {
      if (usedFields.has("input_file.file_data")) {
        removeOpenAIResponsesInputFiles(next);
      } else {
        switchOpenAIResponsesInputFileField(next, "file_url", "file_data");
      }
      continue;
    }
    if (field === "image_url.url") {
      switchOpenAIChatImageURLToString(next);
      continue;
    }
    if (field === "messages.role.system") {
      moveOpenAIChatSystemIntoMessages(next);
      continue;
    }
    if (field === "messages.content") {
      switchAnthropicStringMessagesToTextBlocks(next);
      continue;
    }
    if (field === "messages.content.document") {
      removeAnthropicDocumentBlocks(next);
      continue;
    }
    delete next[field];
  }
  return next;
}

function switchAnthropicStringMessagesToTextBlocks(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message) => typeof message?.content === "string"
    ? { ...message, content: [{ type: "text", text: message.content }] }
    : message);
}

function switchOpenAIChatImageURLToString(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message) => {
    const content = Array.isArray(message?.content) ? message.content : null;
    if (!content) return message;
    return {
      ...message,
      content: content.map((part) => {
        const imageURL = part?.image_url;
        if (part?.type !== "image_url" || !imageURL || typeof imageURL !== "object" || Array.isArray(imageURL) || imageURL.url === undefined) return part;
        return { ...part, image_url: imageURL.url };
      })
    };
  });
}

function switchOpenAIResponsesInputFileField(body, from, to) {
  const input = Array.isArray(body.input) ? body.input : [];
  body.input = input.map((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    return {
      ...item,
      content: content.map((part) => {
        if (part?.type !== "input_file" || part?.[from] === undefined) return part;
        const { [from]: value, ...rest } = part;
        return { ...rest, [to]: value };
      })
    };
  });
}

function removeOpenAIResponsesInputFiles(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  body.input = input.map((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    return {
      ...item,
      content: content.filter((part) => part?.type !== "input_file")
    };
  });
}

function removeAnthropicDocumentBlocks(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message) => {
    const content = Array.isArray(message?.content) ? message.content : null;
    if (!content) return message;
    return {
      ...message,
      content: content.filter((part) => part?.type !== "document")
    };
  });
}

function fallbackSystemText(value) {
  const text = String(value || "").trim();
  return text ? `SYSTEM:\n${text}` : "";
}

function moveInstructionsIntoOpenAIResponsesInput(body) {
  const systemText = fallbackSystemText(body.instructions);
  if (systemText) {
    body.input = inputWithPrependedOpenAIResponsesText(body.input, systemText);
  }
  delete body.instructions;
}

function inputWithPrependedOpenAIResponsesText(input, text) {
  const textPart = { type: "input_text", text };
  const items = Array.isArray(input) ? input.map((item) => clonePlainObject(item)) : [];
  const userIndex = items.findIndex((item) => item?.role === "user");
  if (userIndex >= 0) {
    const item = items[userIndex];
    const content = Array.isArray(item.content) ? item.content : item.content ? [item.content] : [];
    items[userIndex] = { ...item, content: [textPart, ...content] };
    return items;
  }
  return [{ role: "user", content: [textPart] }, ...items];
}

function moveAnthropicSystemIntoMessages(body) {
  const systemText = fallbackSystemText(body.system);
  if (systemText) {
    body.messages = messagesWithPrependedAnthropicText(body.messages, systemText);
  }
  delete body.system;
}

function moveOpenAIChatSystemIntoMessages(body) {
  const messages = Array.isArray(body.messages) ? body.messages.map((item) => clonePlainObject(item)) : [];
  const systemText = messages
    .filter((message) => String(message?.role || "").toLowerCase() === "system")
    .map((message) => openAIChatContentText(message.content))
    .filter(Boolean)
    .join("\n\n");
  const remaining = messages.filter((message) => String(message?.role || "").toLowerCase() !== "system");
  body.messages = systemText ? messagesWithPrependedOpenAIChatText(remaining, fallbackSystemText(systemText)) : remaining;
}

function messagesWithPrependedOpenAIChatText(messages, text) {
  const items = Array.isArray(messages) ? messages.map((item) => clonePlainObject(item)) : [];
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

function openAIChatContentText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => openAIChatContentText(part)).filter(Boolean).join("\n");
  if (typeof content !== "object") return "";
  if (typeof content.text === "string") return content.text;
  if (typeof content.content === "string") return content.content;
  return "";
}

function messagesWithPrependedAnthropicText(messages, text) {
  const items = Array.isArray(messages) ? messages.map((item) => clonePlainObject(item)) : [];
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

function clonePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { value };
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

function defaultProfileFromFields() {
  const provider = document.getElementById("zms-provider").value || "minimax";
  const defaults = providerDefaults(provider);
  const activeProfileId = normalizeProfileId(document.getElementById("zms-activeProfileId").value || defaults.id) || "custom";
  const bodyExtra = { ...(defaults.bodyExtra || {}) };
  const localAgent = ZoteroMarkdownSummaryPrefs.localAgentFromEditor();
  if (localAgent) bodyExtra.localAgent = localAgent;
  return {
    id: activeProfileId,
    name: activeProfileId || defaults.name,
    protocol: defaults.protocol,
    endpointMode: defaults.endpointMode,
    baseURL: document.getElementById("zms-baseURL").value || defaults.baseURL,
    fullURL: defaults.fullURL,
    apiKey: document.getElementById("zms-apiKey").value,
    model: document.getElementById("zms-model").value || defaults.model,
    capabilities: defaults.capabilities,
    customHeaders: { ...(defaults.customHeaders || {}) },
    bodyExtra,
    isDefault: true
  };
}

function defaultCapabilitiesForProvider(provider) {
  return providerDefaults(provider).capabilities;
}

function providerDefaults(provider) {
  const id = String(provider || "minimax");
  const commonCapabilities = {
    text: true,
    imageBase64: false,
    fileReference: false,
    streaming: true,
    embeddings: false,
    jsonMode: false,
    toolUse: false,
    modelList: true
  };
  const imageCapabilities = { ...commonCapabilities, imageBase64: true };
  if (id === "anthropic") {
    return {
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      bodyExtra: {}
    };
  }
  if (id === "anthropic_compatible" || id === "anthropic-compatible") {
    return {
      id: "anthropic-compatible",
      name: "Anthropic Compatible Messages",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    };
  }
  if (id === "openai") {
    return {
      id: "openai",
      name: "OpenAI",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      bodyExtra: {}
    };
  }
  if (id === "openai_responses_compatible" || id === "openai-responses-compatible") {
    return {
      id: "openai-responses-compatible",
      name: "OpenAI Compatible Responses",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      bodyExtra: {}
    };
  }
  if (id === "gemini") {
    return {
      id: "gemini",
      name: "Gemini OpenAI Compatible",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "azure_openai" || id === "azure-openai") {
    return {
      id: "azure-openai",
      name: "Azure OpenAI",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      customHeaders: {},
      bodyExtra: {}
    };
  }
  if (id === "github_models" || id === "github-models") {
    return {
      id: "github-models",
      name: "GitHub Models",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://models.github.ai/inference",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false, modelList: false },
      customHeaders: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      bodyExtra: {}
    };
  }
  if (id === "fireworks") {
    return {
      id: "fireworks",
      name: "Fireworks AI",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.fireworks.ai/inference/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "cerebras") {
    return {
      id: "cerebras",
      name: "Cerebras",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cerebras.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "nvidia_nim" || id === "nvidia-nim") {
    return {
      id: "nvidia-nim",
      name: "NVIDIA NIM",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://integrate.api.nvidia.com/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "sambanova") {
    return {
      id: "sambanova",
      name: "SambaNova",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "sambanova_responses" || id === "sambanova-responses") {
    return {
      id: "sambanova-responses",
      name: "SambaNova Responses",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "sambanova_anthropic" || id === "sambanova-anthropic") {
    return {
      id: "sambanova-anthropic",
      name: "SambaNova Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.sambanova.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: { authHeader: "authorization" }
    };
  }
  if (id === "xai") {
    return {
      id: "xai",
      name: "xAI",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.x.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "groq") {
    return {
      id: "groq",
      name: "Groq",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.groq.com/openai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "mistral") {
    return {
      id: "mistral",
      name: "Mistral AI",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.mistral.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "together") {
    return {
      id: "together",
      name: "Together AI",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.together.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "kimi" || id === "moonshot") {
    return {
      id: "kimi",
      name: "Kimi / Moonshot",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.moonshot.ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "perplexity") {
    return {
      id: "perplexity",
      name: "Perplexity Sonar",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.perplexity.ai",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "deepseek") {
    return {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "deepseek_anthropic" || id === "deepseek-anthropic") {
    return {
      id: "deepseek-anthropic",
      name: "DeepSeek Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.deepseek.com/anthropic",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "zai_anthropic" || id === "zai-anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") {
    return {
      id: "zai-anthropic",
      name: "Z.AI Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.z.ai/api/anthropic",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "openrouter") {
    return {
      id: "openrouter",
      name: "OpenRouter",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://openrouter.ai/api/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "dashscope" || id === "qwen") {
    return {
      id: "dashscope",
      name: "Qwen / DashScope",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "siliconflow") {
    return {
      id: "siliconflow",
      name: "SiliconFlow",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.siliconflow.com/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "zhipu" || id === "glm" || id === "bigmodel") {
    return {
      id: "zhipu",
      name: "Zhipu / GLM",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "volcengine" || id === "ark" || id === "doubao") {
    return {
      id: "volcengine",
      name: "Volcengine Ark / Doubao",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "qianfan" || id === "baidu") {
    return {
      id: "qianfan",
      name: "Baidu Qianfan",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://qianfan.baidubce.com/v2",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "hunyuan" || id === "tencent") {
    return {
      id: "hunyuan",
      name: "Tencent Hunyuan",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "ollama") {
    return {
      id: "ollama",
      name: "Ollama",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://localhost:11434/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false, streaming: true, modelList: true },
      bodyExtra: {}
    };
  }
  if (id === "lm_studio" || id === "lm-studio") {
    return {
      id: "lm-studio",
      name: "LM Studio",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:1234/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false, streaming: true, modelList: true },
      bodyExtra: {}
    };
  }
  if (id === "openai_compatible" || id === "openai-compatible") {
    return {
      id: "openai-compatible",
      name: "OpenAI Compatible Chat",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.openai.com/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "local_agents" || id === "local-agents") {
    return {
      id: "local-agents",
      name: "Local Agents",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://127.0.0.1:3333/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false, imageBase64: false, streaming: false, modelList: false },
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
          "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } },
          "extract-pdf-pages": { tool: "extract_pdf_pages" }
        }
      }
    };
  }
  return {
    id: "minimax",
    name: "MiniMax",
    protocol: "openai_chat",
    endpointMode: "base_url",
    baseURL: "https://api.minimaxi.com/v1",
    fullURL: "",
    model: "MiniMax-M2.7",
    capabilities: { ...commonCapabilities, pdfBase64: false },
    bodyExtra: { extra_body: { reasoning_split: true } }
  };
}

function defaultProviderProfiles() {
  return ["minimax", "openai", "openai_compatible", "openai_responses_compatible", "anthropic", "anthropic_compatible", "gemini", "azure_openai", "github_models", "fireworks", "cerebras", "nvidia_nim", "sambanova", "sambanova_responses", "sambanova_anthropic", "xai", "groq", "mistral", "together", "kimi", "perplexity", "deepseek", "deepseek_anthropic", "zai_anthropic", "openrouter", "dashscope", "siliconflow", "zhipu", "volcengine", "qianfan", "hunyuan", "ollama", "lm_studio", "local_agents"].map((provider, index) => {
    const defaults = providerDefaults(provider);
    return {
      id: defaults.id,
      name: defaults.name,
      protocol: defaults.protocol,
      endpointMode: defaults.endpointMode,
      baseURL: defaults.baseURL,
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

function isKnownProviderId(value) {
  return [
    "minimax",
    "openai",
    "openai-compatible",
    "openai_compatible",
    "openai-responses-compatible",
    "openai_responses_compatible",
    "anthropic",
    "anthropic-compatible",
    "gemini",
    "azure-openai",
    "azure_openai",
    "github-models",
    "github_models",
    "fireworks",
    "cerebras",
    "nvidia-nim",
    "nvidia_nim",
    "sambanova",
    "sambanova-responses",
    "sambanova_responses",
    "sambanova-anthropic",
    "sambanova_anthropic",
    "xai",
    "groq",
    "mistral",
    "together",
    "kimi",
    "moonshot",
    "perplexity",
    "deepseek",
    "deepseek-anthropic",
    "deepseek_anthropic",
    "zai-anthropic",
    "zai_anthropic",
    "z_ai_anthropic",
    "z-ai-anthropic",
    "openrouter",
    "dashscope",
    "qwen",
    "siliconflow",
    "zhipu",
    "glm",
    "bigmodel",
    "volcengine",
    "ark",
    "doubao",
    "qianfan",
    "baidu",
    "hunyuan",
    "tencent",
    "ollama",
    "lm-studio",
    "lm_studio",
    "local-agents",
    "local_agents",
    "custom"
  ].includes(String(value || "").trim());
}

function isKnownProviderBaseURL(value) {
  return [
    "https://api.minimaxi.com/v1",
    "https://api.openai.com/v1",
    "https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1",
    "https://api.anthropic.com",
    "https://api.anthropic.com/v1",
    "https://generativelanguage.googleapis.com/v1beta/openai",
    "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1",
    "https://models.github.ai/inference",
    "https://api.fireworks.ai/inference/v1",
    "https://api.cerebras.ai/v1",
    "https://integrate.api.nvidia.com/v1",
    "https://api.sambanova.ai/v1",
    "https://api.x.ai/v1",
    "https://api.groq.com/openai/v1",
    "https://api.mistral.ai/v1",
    "https://api.together.ai/v1",
    "https://api.moonshot.ai/v1",
    "https://api.perplexity.ai",
    "https://api.deepseek.com",
    "https://api.deepseek.com/anthropic",
    "https://api.z.ai/api/anthropic",
    "https://api.z.ai/api/anthropic/v1",
    "https://api.z.ai/api/anthropic/v1/messages",
    "https://openrouter.ai/api/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://api.siliconflow.com/v1",
    "https://api.siliconflow.cn/v1",
    "https://open.bigmodel.cn/api/paas/v4",
    "https://api.z.ai/api/paas/v4",
    "https://ark.cn-beijing.volces.com/api/v3",
    "https://qianfan.baidubce.com/v2",
    "https://qianfan.bj.baidubce.com/v2",
    "https://api.hunyuan.cloud.tencent.com/v1",
    "http://localhost:11434/v1",
    "http://127.0.0.1:1234/v1",
    "http://127.0.0.1:3333/v1"
  ].includes(String(value || "").replace(/\/+$/, ""));
}

function isKnownProviderDefaultModel(value) {
  return ["MiniMax-M2.7"].includes(String(value || "").trim());
}

function parseLocalAgentConfig(raw) {
  if (!raw) return null;
  if (typeof raw === "string") return { endpoint: raw };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const directEndpoint = raw.endpoint || raw.url || raw.mcpUrl || raw.baseUrl;
  const mappedEntries = {};
  for (const [key, value] of Object.entries(raw)) {
    if ([
      "endpoint",
      "url",
      "mcpUrl",
      "baseUrl",
      "tool",
      "toolName",
      "tool_id",
      "headers",
      "timeoutMs",
      "timeoutSeconds",
      "timeout",
      "timeoutSec",
      "timeout_seconds",
      "timeout_ms",
      "payloadMode",
      "protocol",
      "method",
      "model",
      "args",
      "body",
      "params",
      "payload",
      "enabled",
      "toolMode",
      "fallbackToRemote"
    ].includes(key)) continue;
    if (typeof value === "string") {
      mappedEntries[key] = { endpoint: value };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      mappedEntries[key] = value;
    }
  }
  const localAgent = {
    ...(directEndpoint ? { endpoint: directEndpoint } : {}),
    ...(raw.tool || raw.toolName || raw.tool_id ? { tool: raw.tool || raw.toolName || raw.tool_id } : {}),
    ...(raw.headers ? { headers: normalizeObjectStringMap(raw.headers) || {} } : {}),
    ...(raw.fallbackToRemote ? { fallbackToRemote: true } : {}),
    ...(raw.timeoutMs ? { timeoutMs: raw.timeoutMs } : {}),
    ...(raw.timeoutSeconds ? { timeoutSeconds: raw.timeoutSeconds } : {}),
    ...(raw.timeout ? { timeout: raw.timeout } : {}),
    ...(raw.timeoutSec ? { timeoutSec: raw.timeoutSec } : {}),
    ...(raw.timeout_seconds ? { timeout_seconds: raw.timeout_seconds } : {}),
    ...(raw.timeout_ms ? { timeout_ms: raw.timeout_ms } : {}),
    ...(raw.payloadMode || raw.protocol ? { payloadMode: normalizeLocalAgentPayloadMode(raw.payloadMode || raw.protocol) } : {}),
    ...(raw.method ? { method: raw.method } : {}),
    ...(raw.model ? { model: raw.model } : {}),
    ...(raw.args ? { args: normalizeObjectStringMap(raw.args) || {} } : {}),
    ...(raw.body ? { body: normalizeObjectStringMap(raw.body) || {} } : {}),
    ...(raw.params ? { params: normalizeObjectStringMap(raw.params) || {} } : {}),
    ...(raw.payload ? { payload: normalizeObjectStringMap(raw.payload) || {} } : {}),
    ...mappedEntries
  };
  return Object.keys(localAgent).length ? localAgent : null;
}

function normalizeLocalAgentPayloadMode(payloadMode) {
  const normalized = String(payloadMode || "").trim().toLowerCase();
  return normalized === "simple" ? "simple" : "jsonrpc";
}

function toFinitePositiveInt(...values) {
  for (const value of values) {
    const normalized = Number(value);
    if (Number.isFinite(normalized) && normalized > 0) return Math.round(normalized);
  }
  return null;
}

function normalizeObjectStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined).map(([key, candidate]) => [String(key), candidate]));
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

function isTrueValue(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function jsonObjectFromTextarea(id, controller) {
  const text = document.getElementById(id).value.trim();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch (_err) {
    // Handled below with a shared validation message.
  }
  controller.setStatus(controller.t("jsonInvalid"));
  return null;
}

function providerFromProtocol(protocol) {
  if (protocol === "anthropic_messages") return "anthropic";
  if (protocol === "openai_responses") return "openai";
  return "openai_compatible";
}

function providerFromProfile(profile) {
  if (profile?.bodyExtra?.localAgent || profile?.bodyExtra?.agent || profile?.bodyExtra?.subagent) return "local_agents";
  const id = String(profile?.id || "").trim();
  if (id === "minimax") return "minimax";
  if (id === "gemini") return "gemini";
  if (id === "azure-openai" || id === "azure_openai") return "azure_openai";
  if (id === "github-models" || id === "github_models") return "github_models";
  if (id === "fireworks") return "fireworks";
  if (id === "cerebras") return "cerebras";
  if (id === "nvidia-nim" || id === "nvidia_nim") return "nvidia_nim";
  if (id === "sambanova") return "sambanova";
  if (id === "sambanova-responses" || id === "sambanova_responses") return "sambanova_responses";
  if (id === "sambanova-anthropic" || id === "sambanova_anthropic") return "sambanova_anthropic";
  if (id === "openai-compatible" || id === "openai_compatible") return "openai_compatible";
  if (id === "openai-responses-compatible" || id === "openai_responses_compatible") return "openai_responses_compatible";
  if (id === "anthropic-compatible" || id === "anthropic_compatible") return "anthropic_compatible";
  if (id === "moonshot") return "kimi";
  if (id === "xai" || id === "groq" || id === "mistral" || id === "together" || id === "kimi" || id === "perplexity" || id === "deepseek" || id === "openrouter" || id === "dashscope" || id === "qwen" || id === "siliconflow" || id === "zhipu" || id === "volcengine" || id === "qianfan" || id === "hunyuan" || id === "ollama") return id;
  if (id === "glm" || id === "bigmodel") return "zhipu";
  if (id === "ark" || id === "doubao") return "volcengine";
  if (id === "baidu") return "qianfan";
  if (id === "tencent") return "hunyuan";
  if (id === "lm-studio" || id === "lm_studio") return "lm_studio";
  if (id === "deepseek-anthropic" || id === "deepseek_anthropic") return "deepseek_anthropic";
  if (id === "zai-anthropic" || id === "zai_anthropic" || id === "z_ai_anthropic" || id === "z-ai-anthropic") return "zai_anthropic";
  if (String(profile?.name || "").toLowerCase().includes("minimax")) return "minimax";
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
  if (profile?.protocol === "openai_responses") {
    return baseURL === "https://api.openai.com/v1" || baseURL === "https://api.openai.com/v1/responses"
      ? "openai"
      : "openai_responses_compatible";
  }
  return providerFromProtocol(profile?.protocol);
}

function hydrateProfile(profile) {
  const provider = providerFromProfile(profile) || document.getElementById("zms-provider").value;
  const defaults = providerDefaults(provider);
  const defaultCapabilities = defaults.capabilities;
  return normalizeProviderProfile({
    ...profile,
    protocol: profile.protocol || defaults.protocol || "openai_chat",
    endpointMode: profile.endpointMode || defaults.endpointMode || "base_url",
    baseURL: profile.baseURL || defaults.baseURL || document.getElementById("zms-baseURL").value,
    fullURL: profile.fullURL || "",
    apiKey: profile.apiKey || "",
    model: profile.model || defaults.model || "",
    capabilities: { ...defaultCapabilities, ...(profile.capabilities || {}) },
    customHeaders: profile.customHeaders || defaults.customHeaders || {},
    bodyExtra: profile.bodyExtra || defaults.bodyExtra || {}
  }, defaults);
}

function normalizeProviderProfile(profile, defaultsOverride) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const provider = providerFromProfile(source) || document.getElementById("zms-provider")?.value || "openai_compatible";
  const defaults = defaultsOverride || providerDefaults(provider);
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

function skillTemplatePath(outputDir, skillId) {
  const safeSkillId = normalizeSkillId(skillId) || "paper-deep-summary";
  return PathUtils.join(outputDir, "skills", `${safeSkillId}.md`);
}

async function availableSkillTemplateIds(outputDir) {
  const ids = new Set(ZMS_BUILT_IN_SKILL_IDS);
  if (!outputDir) return [...ids];
  try {
    const skillsDir = PathUtils.join(outputDir, "skills");
    if (!await IOUtils.exists(skillsDir)) return [...ids];
    for (const path of await IOUtils.getChildren(skillsDir)) {
      const name = leafName(path);
      if (!name.toLowerCase().endsWith(".md")) continue;
      const skillId = normalizeSkillId(name.slice(0, -3));
      if (skillId) ids.add(skillId);
    }
  } catch (_err) {
    return [...ids];
  }
  return [...ids].sort((a, b) => skillSortKey(a).localeCompare(skillSortKey(b)));
}

function skillSortKey(skillId) {
  const index = ZMS_BUILT_IN_SKILL_IDS.indexOf(skillId);
  return index === -1 ? `z-${skillId}` : `a-${String(index).padStart(3, "0")}`;
}

function renderSkillMenuOptions(select, skillIds, lang) {
  const popup = skillMenuPopup(select);
  clearElement(popup);
  for (const skillId of skillIds) {
    popup.appendChild(createSkillMenuItem(skillId, skillMenuLabel(skillId, lang)));
  }
}

function skillMenuPopup(select) {
  const existing = select.querySelector?.("menupopup");
  if (existing) return existing;
  const childPopup = Array.from(select.children || []).find((child) => child.localName === "menupopup");
  if (childPopup) return childPopup;
  return select;
}

function createSkillMenuItem(skillId, label) {
  const item = typeof document.createXULElement === "function"
    ? document.createXULElement("menuitem")
    : document.createElement("menuitem");
  item.setAttribute("label", label);
  item.setAttribute("value", skillId);
  item.label = label;
  item.value = skillId;
  return item;
}

function skillMenuLabel(skillId, lang) {
  if (typeof zmsMessage === "function") {
    const label = zmsMessage("workbench", skillId, lang, runtimeLocale());
    if (label && label !== skillId) return label;
  }
  return skillId;
}

function clearElement(element) {
  if (!element) return;
  while (element.firstChild) element.removeChild(element.firstChild);
  element.textContent = "";
}

function leafName(path) {
  const value = String(path || "");
  const slashIndex = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return slashIndex === -1 ? value : value.slice(slashIndex + 1);
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

function builtInSkillTemplate(skillId, outputLanguage) {
  const instruction = outputLanguage === "en-US"
    ? "Write the output in English."
    : outputLanguage === "ja-JP"
      ? "日本語で出力してください。"
      : "请使用中文输出。";
  const common = [
    instruction,
    "Use only the provided paper metadata and context excerpts.",
    "Mark important claims with evidence notes such as [metadata], [abstract], or [chunk:<id>].",
    "If evidence is missing, mark the point as low-confidence."
  ].join("\n");
  if (skillId === "method-extractor") {
    return `${common}\n\nExtract the method, model, algorithm flow, inputs, outputs, constraints, assumptions, and reusable implementation details.`;
  }
  if (skillId === "experiment-table-builder") {
    return `${common}\n\nBuild a Markdown table for datasets, baselines, metrics, ablations, main results, and experimental limitations.`;
  }
  if (skillId === "figure-table-extractor") {
    return figureTableTemplate(common, outputLanguage);
  }
  if (skillId === "literature-matrix-builder") {
    return literatureMatrixTemplate(common, outputLanguage);
  }
  if (skillId === "literature-review-synthesis") {
    return literatureReviewSynthesisTemplate(common, outputLanguage);
  }
  if (skillId === "citation-audit") {
    return `${common}\n\nAudit the current summary or answer. List unsupported claims, weak evidence, and the source needed to verify each claim.`;
  }
  if (skillId === "custom-summary") {
    return `${common}\n\nFollow the user's custom research goal and produce a structured Markdown note.`;
  }
  if (skillId === "ask-gemini") {
    return `${common}\n\nAnalyze the paper with a Gemini-style lens. Highlight key ideas, missing assumptions, likely caveats, and follow-up questions.`;
  }
  if (skillId === "ask-claude") {
    return `${common}\n\nProvide a careful reviewer-style analysis focused on novelty, rigor, evidence quality, and risk points, then propose concrete next steps.`;
  }
  if (skillId === "ask-opencode") {
    return `${common}\n\nGive implementation-oriented guidance: reproducibility checks, code-level action items, evaluation protocol, and tooling recommendations.`;
  }
  if (skillId === "ask-all-agents") {
    return `${common}\n\nAsk Gemini, Claude, and opencode for independent perspectives. Compare agreement, disagreement, confidence, and action recommendations.`;
  }
  if (skillId === "ask-gemini-claude") {
    return `${common}\n\nAsk Gemini and Claude for independent perspectives. Compare agreement, disagreement, confidence, and action recommendations.`;
  }
  if (skillId === "check-local-agents") {
    return `${common}\n\nCheck local Gemini, Claude, and opencode availability. Report each status, likely failure causes, and concrete command-level remediation steps.`;
  }
  return paperDeepSummaryTemplate(common, outputLanguage);
}

function figureTableTemplate(common, outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n请结构化解析论文中的截图、图表、表格或实验结果。优先结合图片附件、PDF/摘要上下文和用户问题；若没有图片附件，则只从文本上下文中抽取。输出 Markdown，至少包含：对象类型、可读内容、结论解释、可复用信息、不确定性。不要编造看不清的数字；所有来自文本上下文的判断标注 [chunk:<id>] 或 [metadata]，来自图片观察的判断标注 [image]。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n論文中のスクリーンショット、図、表、実験結果を構造化して解析してください。画像添付、PDF/要約コンテキスト、ユーザー質問を優先して使い、画像がない場合はテキスト根拠だけで抽出してください。読めない数値は推測せず、テキスト根拠は [chunk:<id>] または [metadata]、画像観察は [image] と明記してください。`;
  }
  return `${common}\n\nExtract structured information from screenshots, figures, tables, formulas, or experimental-result panels. Prefer attached images plus the provided paper/PDF context and the user question; if no image is attached, extract only from the text context. Include object type, readable content, interpretation, reusable review/experiment notes, and uncertainty. Do not invent unreadable numbers. Mark text-grounded claims with [chunk:<id>] or [metadata], and visual observations with [image].`;
}

function literatureMatrixTemplate(common, outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n生成 literature matrix。若上下文包含 Comparison paper，请同时比较焦点论文和所有对比论文；否则先为当前论文建立单篇矩阵。输出 Markdown，至少包含：论文清单、对比矩阵、交叉分析、综述草稿要点。每个矩阵单元必须引用 [chunk:<id>]、[paper2:<id>] 或 [metadata] 等证据；缺证据时写低置信度，不要补全不存在的信息。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\nliterature matrix を作成してください。Comparison paper がある場合は、焦点論文と比較論文を同時に比較してください。ない場合は、現在の論文だけで単一論文の行列を作成してください。各セルには [chunk:<id>]、[paper2:<id>]、または [metadata] のような根拠ラベルを付け、根拠が弱い場合は低信頼と明記してください。`;
  }
  return `${common}\n\nCreate a literature matrix. If the context contains Comparison papers, compare the focal paper against every comparison paper; otherwise build a single-paper matrix for the current paper first. Include a paper inventory, comparison matrix, cross-paper analysis, and review-draft notes. Every matrix cell must cite evidence labels such as [chunk:<id>], [paper2:<id>], or [metadata]. Mark unsupported cells as low-confidence instead of filling gaps.`;
}

function literatureReviewSynthesisTemplate(common, outputLanguage) {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n生成可直接用于文献综述写作的跨论文综合。若上下文包含 Comparison papers，请把焦点论文和所有对比论文一起综合；若只有当前论文，先输出单篇综述骨架并明确缺少对比论文。使用 Markdown，固定包含：综述主题与范围、论文分组与研究谱系、共同问题与核心共识、方法/数据/实验对比、关键分歧与证据强弱、研究空白、可写入正文的综述段落草稿、后续补充文献与验证清单。每个判断都必须引用 [metadata]、[chunk:<id>]、[paper2:<id>] 等证据标签；不要把低置信推断写成确定结论。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n文献レビュー執筆に使える横断的な統合を作成してください。Comparison papers がある場合は焦点論文と比較論文をまとめて扱い、ない場合は単一論文のレビュー骨子として不足を明記してください。各判断には [metadata]、[chunk:<id>]、[paper2:<id>] などの根拠ラベルを付けてください。`;
  }
  return `${common}\n\nCreate a cross-paper synthesis for literature-review writing. If the context contains Comparison papers, synthesize the focal paper together with every comparison paper; otherwise produce a single-paper review scaffold and state that comparison papers are missing. Include review scope, paper groups and lineage, shared problem and consensus, method/data/experiment comparison, disagreements and evidence strength, research gaps, draft review paragraphs, and follow-up verification. Every judgment must cite evidence labels such as [metadata], [chunk:<id>], or [paper2:<id>]. Mark low-confidence inferences explicitly.`;
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

async function readText(path) {
  if (IOUtils.readUTF8) return IOUtils.readUTF8(path);
  return new TextDecoder().decode(await IOUtils.read(path));
}

async function writeText(path, text) {
  if (Zotero.File?.putContentsAsync) return Zotero.File.putContentsAsync(path, text);
  if (IOUtils.writeUTF8) return IOUtils.writeUTF8(path, text);
  return IOUtils.write(path, new TextEncoder().encode(text));
}

async function ensureDirectory(path) {
  if (!await IOUtils.exists(path)) {
    await IOUtils.makeDirectory(path, { createAncestors: true, ignoreExisting: true });
  }
}

function parentDir(path) {
  const slashIndex = Math.max(String(path).lastIndexOf("/"), String(path).lastIndexOf("\\"));
  return slashIndex === -1 ? "." : String(path).slice(0, slashIndex);
}

window.ZoteroMarkdownSummaryPrefs = ZoteroMarkdownSummaryPrefs;
