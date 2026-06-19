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
  "check_local_agents"
];
const MODEL_LIST_MAX_PAGES = 5;

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
      const value = Zotero.Prefs.get(`${this.prefix}.${field}`, true);
      if (field === "stream") element.checked = !!value;
      else element.value = value ?? "";
    }
    this.applyLanguage();
    this.mergeDefaultProfilesIntoEditor();
    this.refreshProfileOptions();
    this.loadProfileEditor();
    this.bindProfileStatusEvents();
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
      if (field === "maxOutputTokens") value = Number(value) || 8192;
      if (field === "temperature") value = Number(value) || 1;
      Zotero.Prefs.set(`${this.prefix}.${field}`, value, true);
    }
    this.refreshProfileOptions();
    this.applyLanguage();
    this.refreshProfileStatus();
    if (options.statusKey !== "") this.setStatus(this.t(options.statusKey || "saved"));
    return true;
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
      const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
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
      element.addEventListener("input", () => this.refreshProfileStatus());
      element.addEventListener("change", () => this.refreshProfileStatus());
      element.addEventListener("command", () => this.refreshProfileStatus());
    }
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
  if (id === "anthropic-compatible" || id === "anthropic_compatible" || id === "deepseek-anthropic" || id === "deepseek_anthropic" || id === "zai-anthropic" || id === "zai_anthropic") return "authorization";
  if (baseURL === "https://api.deepseek.com/anthropic" || baseURL.startsWith("https://api.deepseek.com/anthropic/")) return "authorization";
  if (baseURL === "https://api.z.ai/api/anthropic" || baseURL.startsWith("https://api.z.ai/api/anthropic/")) return "authorization";
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
    body: withProviderBodyDefaults(profile, body)
  };
}

function modelListRequestForProfile(profile) {
  const url = modelsEndpointForProfile(profile);
  if (!url) return null;
  return {
    url,
    headers: headersForProfile(profile)
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
          version: "0.1.1"
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
  for (let page = 0; nextUrl && page < MODEL_LIST_MAX_PAGES; page += 1) {
    if (seenUrls.has(nextUrl)) break;
    seenUrls.add(nextUrl);
    const response = await fetch(nextUrl, { method: "GET", headers: request.headers });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(providerErrorText(response.status, text));
    }
    const data = safeParseJSON(text);
    items.push(...modelListItemsFromResponse(data));
    nextUrl = nextModelListURL(nextUrl, data);
  }
  return modelOptionsFromItems(items);
}

function nextModelListURL(currentUrl, data) {
  if (!data || typeof data !== "object") return "";
  const direct = stringField(data.next_page, data.nextPage, data.next);
  if (direct) return modelListURLFromNextValue(currentUrl, direct);
  if (data.has_more !== true && data.hasMore !== true) return "";
  const tokenPairs = [
    ["after_id", stringField(data.last_id, data.lastId, data.after_id, data.afterId)],
    ["page_token", stringField(data.next_page_token, data.nextPageToken, data.next_token, data.nextToken)],
    ["after", stringField(data.next_cursor, data.nextCursor, data.cursor, data.after)]
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

function modelListItemsFromResponse(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data?.model)
          ? data.model
          : [];
  return source;
}

function modelOptionFromItem(item) {
  if (typeof item === "string") return { id: item.trim(), label: "" };
  const id = String(item?.id || item?.name || item?.model || "").trim();
  const label = String(item?.display_name || item?.displayName || item?.label || "").trim();
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
    : String(text || "").trim();
  if (!String(value || "").trim()) throw new Error("No text returned from model");
  return String(value).trim();
}

function providerResponseErrorDetail(data) {
  if (!data || typeof data !== "object") return "";
  const error = data.error || (data.type === "error" ? data : null);
  if (!error) return "";
  if (typeof error === "string") return error;
  const message = error.message || data.message || "";
  const code = error.code || data.code || "";
  const type = error.type || data.type || "";
  return [code, type, message || JSON.stringify(error)].filter(Boolean).join(" - ");
}

function providerTextFromResponse(protocol, data) {
  if (protocol === "anthropic_messages") return anthropicTextFromResponse(data);
  return data?.output_text
    || modelTextFromValue(data?.choices?.[0]?.message?.content)
    || modelTextFromValue(data?.choices?.[0]?.delta?.content)
    || data?.choices?.[0]?.text
    || data?.choices?.[0]?.delta?.text
    || modelTextFromValue(data?.output)
    || modelTextFromValue(data?.content)
    || modelTextFromValue(data?.part)
    || modelTextFromValue(data?.item)
    || modelTextFromValue(data?.message)
    || modelTextFromValue(data?.response)
    || "";
}

function anthropicTextFromResponse(data) {
  const content = data?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return typeof data?.text === "string" ? data.text : "";
}

function modelTextFromValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => modelTextFromValue(part)).filter(Boolean).join("\n");
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

function isReasoningModelPart(value) {
  const type = String(value?.type || "");
  return type.includes("reasoning") || type === "thinking";
}

function localAgentErrorText(status, text) {
  const detail = redact(providerErrorDetail(text));
  return status && Number(status) !== 200 ? `HTTP ${status}: ${detail}` : detail;
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
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
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
  if (profile.protocol === "anthropic_messages") {
    return {
      model: profile.model,
      max_tokens: 32,
      messages: [{ role: "user", content: "ping" }]
    };
  }
  if (profile.protocol === "openai_responses") {
    return {
      model: profile.model,
      input: "ping",
      max_output_tokens: 32
    };
  }
  return {
    model: profile.model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 32,
    n: 1
  };
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
    ...rest
  } = bodyExtra;
  return rest;
}

function withProviderBodyDefaults(profile, body) {
  return { ...body, ...jsonModeBodyDefaults(profile), ...providerBodyExtra(profile.bodyExtra) };
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
    .replace(/\/(?:chat\/completions|responses|messages)$/i, "");
}

function openAICompatibleBaseWithVersion(baseURL) {
  const base = String(baseURL || "").replace(/\/+$/, "");
  return hasOpenAICompatibleVersionPath(base) || usesVersionlessOpenAICompatibleBase(base) ? base : `${base}/v1`;
}

function hasOpenAICompatibleVersionPath(baseURL) {
  return /\/v\d+(?:[a-z]+)?$/i.test(baseURL) || /\/v\d+(?:[a-z]+)?\/openai$/i.test(baseURL);
}

function usesVersionlessOpenAICompatibleBase(baseURL) {
  return /^https:\/\/api\.perplexity\.ai$/i.test(String(baseURL || "").replace(/\/+$/, ""));
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
    imageBase64: true,
    fileReference: false,
    streaming: true,
    embeddings: false,
    jsonMode: false,
    toolUse: false,
    modelList: true
  };
  if (id === "anthropic") {
    return {
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: true },
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
      capabilities: { ...commonCapabilities, pdfBase64: true },
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
      capabilities: { ...commonCapabilities, pdfBase64: true },
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
      capabilities: { ...commonCapabilities, pdfBase64: false },
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
      capabilities: { ...commonCapabilities, pdfBase64: true },
      customHeaders: {},
      bodyExtra: {}
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
          "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } }
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
  return ["minimax", "openai", "openai_compatible", "openai_responses_compatible", "anthropic", "anthropic_compatible", "gemini", "azure_openai", "xai", "groq", "mistral", "together", "kimi", "perplexity", "deepseek", "deepseek_anthropic", "zai_anthropic", "openrouter", "dashscope", "siliconflow", "zhipu", "volcengine", "qianfan", "hunyuan", "ollama", "lm_studio", "local_agents"].map((provider, index) => {
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
