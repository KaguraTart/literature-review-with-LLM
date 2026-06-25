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
  modelOptionsByProvider: Object.create(null),
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
    this.refreshModelRecommendations({ selectDefault: true, resetVendor: true });
    this.refreshProviderGuide();
    this.bindProfileStatusEvents();
    this.bindOutputDirEvents();
    this.bindModelPickerEvents();
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
    const storedProfile = storedProfileForProviderPreset(provider, readProfilesFromEditor());
    const nextProfile = storedProfile ? hydrateProfile({ ...defaults, ...storedProfile, id: defaults.id, name: storedProfile.name || defaults.name }) : defaults;
    const activeProfileId = document.getElementById("zms-activeProfileId");
    const baseURL = document.getElementById("zms-baseURL");
    const apiKey = document.getElementById("zms-apiKey");
    const model = document.getElementById("zms-model");
    if (activeProfileId) activeProfileId.value = nextProfile.id || defaults.id;
    if (baseURL) baseURL.value = nextProfile.baseURL || defaults.baseURL || "";
    if (apiKey) apiKey.value = nextProfile.apiKey || "";
    if (model) model.value = nextProfile.model || defaults.model || "";
    document.getElementById("zms-profileName").value = nextProfile.name || defaults.name;
    document.getElementById("zms-profileProtocol").value = nextProfile.protocol || defaults.protocol;
    document.getElementById("zms-profileEndpointMode").value = nextProfile.endpointMode || defaults.endpointMode;
    document.getElementById("zms-profileFullURL").value = nextProfile.fullURL || defaults.fullURL || "";
    document.getElementById("zms-profileBodyExtra").value = JSON.stringify(nextProfile.bodyExtra || defaults.bodyExtra || {}, null, 2);
    document.getElementById("zms-profileCustomHeaders").value = JSON.stringify(nextProfile.customHeaders || defaults.customHeaders || {}, null, 2);
    this.setCapabilityValues(nextProfile.capabilities || defaults.capabilities);
    this.refreshModelRecommendations({ selectDefault: true, resetVendor: true });
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
    if (!outputDir) {
      this.setStatus(this.t("outputDirMissing"));
      return false;
    }
    try {
      await ensureDirectory(outputDir);
      Zotero.Prefs.set(`${this.prefix}.outputDir`, outputDir, true);
      if (element.dataset) element.dataset.zmsLastSaved = outputDir;
      await this.refreshSkillMenu();
      this.setStatus(`${this.t("outputDirSaved")}: ${outputDir}`);
      return true;
    } catch (err) {
      this.setStatus(`${this.t("outputDirCreateFailed")}: ${safeError(err)}`);
      return false;
    }
  },

  async chooseOutputDir() {
    if (this._choosingOutputDir) return false;
    this._choosingOutputDir = true;
    const element = document.getElementById("zms-outputDir");
    try {
      if (!element) return false;
      const selected = await chooseOutputDirectory(element.value, this.t("chooseOutputDirTitle"));
      if (!selected) return false;
      element.value = selected;
      return this.saveOutputDir();
    } catch (err) {
      this.setStatus(`${this.t("outputDirChooseFailed")}: ${safeError(err)}`);
      return false;
    } finally {
      this._choosingOutputDir = false;
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
    this.populateProfileEditor(profile);
  },

  populateProfileEditor(profile) {
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
    this.refreshModelRecommendations({ resetVendor: true });
    this.refreshProfileStatus();
    this.refreshProviderGuide();
  },

  applyProviderEnvFromText() {
    const element = document.getElementById("zms-providerEnvText");
    const raw = element?.value || "";
    const draft = profileDraftFromEditor();
    if (draft.errors.length) {
      this.setStatus(this.t("jsonInvalid"));
      return null;
    }
    const result = applyProviderEnvTextToProfile(draft.profile, raw, providerFromProfile(draft.profile));
    if (!result.changed.length) {
      this.setStatus(this.t(raw.trim() ? "providerEnvNoMatch" : "providerEnvNoInput"));
      return result;
    }
    this.populateProfileEditor(result.profile);
    if (this.upsertProfileFromEditor() && this.save({ updateProfile: false, statusKey: "" })) {
      this.setStatus(`${this.t("providerEnvApplied")}: ${result.changed.join(", ")}`);
    }
    return result;
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
    const timeoutSeconds = localAgentTimeoutSecondsForEditor(localAgent);
    document.getElementById("zms-profileLocalAgentTimeout").value = timeoutSeconds ? String(timeoutSeconds) : "";
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
    syncCapabilityCheckboxesFromModelPicker({
      providerId: document.getElementById("zms-provider")?.value || "",
      protocol: document.getElementById("zms-profileProtocol")?.value || "",
      imageCheckboxId: "zms-cap-imageBase64",
      pdfCheckboxId: "zms-cap-pdfBase64",
      selectId: "zms-model-select",
      inputId: "zms-model"
    });
    const id = normalizeProfileId(document.getElementById("zms-activeProfileId").value || document.getElementById("zms-profileName").value) || "custom";
    document.getElementById("zms-activeProfileId").value = id;
    const name = (document.getElementById("zms-profileName").value || id).trim();
    const customHeaders = jsonObjectFromTextarea("zms-profileCustomHeaders", this);
    if (customHeaders === null) return null;
    const localAgent = this.localAgentFromEditor();
    if (localAgent === null) return null;
    let bodyExtra = jsonObjectFromTextarea("zms-profileBodyExtra", this);
    if (bodyExtra === null) return null;
    if (localAgent) {
      bodyExtra.localAgent = localAgent;
    } else if (bodyExtra.localAgent !== undefined) {
      delete bodyExtra.localAgent;
    }
    bodyExtra = bodyExtraWithModelPickerFeatureHints(bodyExtra, "zms-model-select", "zms-model");
    return {
      id,
      name,
      protocol: document.getElementById("zms-profileProtocol").value || "openai_chat",
      endpointMode: document.getElementById("zms-profileEndpointMode").value || "base_url",
      baseURL: document.getElementById("zms-baseURL").value,
      fullURL: document.getElementById("zms-profileFullURL").value,
      apiKey: document.getElementById("zms-apiKey").value,
      model: modelValueFromPicker("zms-model-select", "zms-model"),
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

  persistProfileCompatibilityFallback(profile, result) {
    const fields = normalizeProviderFallbackFieldList(result?.compatibilityFallbackFields);
    if (!fields.length || !profile) return profile;
    const effectiveProfile = result?.effectiveProfile && typeof result.effectiveProfile === "object"
      ? result.effectiveProfile
      : profile;
    const currentId = String(profile.id || "");
    const effectiveId = String(effectiveProfile.id || currentId);
    if (currentId && effectiveId && currentId !== effectiveId) return profile;
    const nextProfile = profileWithProviderCompatibilityFallback(profile, effectiveProfile, fields);
    if (JSON.stringify(nextProfile) === JSON.stringify(profile)) return profile;
    this.populateProfileEditor(nextProfile);
    document.getElementById("zms-profilesJson").value = JSON.stringify(replaceActiveProfile(readProfilesFromEditor(), nextProfile), null, 2);
    this.applyProfileToBasicFields(nextProfile);
    this.refreshProfileOptions();
    this.refreshProfileStatus();
    this.refreshProviderGuide();
    this.save({ updateProfile: false, statusKey: "" });
    return nextProfile;
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
      const result = await runProviderConnectionTest(profile, request);
      const { response, text } = result;
      if (!response.ok) {
        this.setStatus(`${this.t("testFailed")}: ${providerErrorText(response.status, text)}`);
        return;
      }
      const persistedProfile = this.persistProfileCompatibilityFallback(profile, result);
      extractProviderConnectionText(persistedProfile?.protocol || profile.protocol, text);
      this.setStatus(this.t("testOk"));
    } catch (err) {
      this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
    }
  },

  async loadModels() {
    const profile = this.profileFromEditor();
    if (!profile) return;
    const modelInput = document.getElementById("zms-model");
    const wasModelBlank = !String(modelInput?.value || "").trim();
    const resetVendor = shouldResetSettingsModelVendorFilter(profile);
    const recommended = this.refreshModelRecommendations({ selectDefault: true, resetVendor });
    if (!profileHasUsableAuth(profile)) {
      if (recommended.length) this.commitModelPickerSelection();
      this.setStatus(recommended.length ? `${this.t("modelRecommendationsLoaded")}: ${recommended.length}` : this.t("apiKeyMissing"));
      return;
    }
    const request = modelListRequestForProfile(profile);
    if (!request) {
      if (recommended.length) this.commitModelPickerSelection();
      this.setStatus(recommended.length ? `${this.t("modelRecommendationsLoaded")}: ${recommended.length}` : this.t("modelListUnavailable"));
      return;
    }
    this.setStatus(this.t("modelListLoading"));
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
      const persistedProfile = this.persistProfileCompatibilityFallback(profile, request);
      const cacheProfile = persistedProfile || profile;
      const displayOptions = mergeModelOptions(
        tagModelOptions(modelOptions, "online"),
        tagModelOptions(recommended, "recommended")
      );
      this.cacheModelOptionsForProfile(cacheProfile, displayOptions);
      renderModelOptions(displayOptions, { resetVendor });
      if (displayOptions.length && (wasModelBlank || !String(modelInput?.value || "").trim())) {
        if (modelInput) modelInput.value = displayOptions[0].id;
      }
      syncModelSelectFromInput(displayOptions);
      this.setStatus(modelOptions.length ? `${this.t("modelListLoaded")}: ${modelOptions.length}` : `${this.t("modelRecommendationsLoaded")}: ${displayOptions.length}`);
    } catch (err) {
      if (recommended.length) {
        const fallbackOptions = tagModelOptions(recommended, "recommended");
        this.cacheModelOptionsForProfile(profile, fallbackOptions);
        renderModelOptions(fallbackOptions, { resetVendor });
        syncModelSelectFromInput(recommended);
        this.commitModelPickerSelection();
        this.setStatus(`${this.t("modelListFailedUsingRecommendations")}: ${safeError(err)}`);
        return;
      }
      this.setStatus(`${this.t("testFailed")}: ${safeError(err)}`);
    }
  },

  refreshModelRecommendations(options = {}) {
    const profile = profileDraftFromEditor().profile;
    const recommendations = recommendedModelOptionsForProfile(profile);
    const cached = options.useCache === false ? [] : this.cachedModelOptionsForProfile(profile);
    const displayOptions = cached.length ? cached : tagModelOptions(recommendations, "recommended");
    renderModelOptions(displayOptions, { resetVendor: options.resetVendor === true });
    const model = document.getElementById("zms-model");
    if (model && options.selectDefault && shouldSelectProviderDefaultModel(model.value, displayOptions) && displayOptions[0]?.id) {
      model.value = displayOptions[0].id;
    }
    syncModelSelectFromInput(displayOptions);
    return recommendations;
  },

  cacheModelOptionsForProfile(profile, modelOptions) {
    const key = settingsModelOptionsCacheKey(profile);
    if (!key) return;
    const entries = normalizeModelOptions(modelOptions);
    if (!entries.length) return;
    this.modelOptionsByProvider[key] = entries;
  },

  cachedModelOptionsForProfile(profile) {
    const key = settingsModelOptionsCacheKey(profile);
    return key ? normalizeModelOptions(this.modelOptionsByProvider[key] || []) : [];
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

  checkProviderConfig() {
    const element = document.getElementById("zms-profileStatus");
    const draft = profileDraftFromEditor();
    const lang = resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale());
    const report = providerConfigDoctor(draft.profile, lang);
    const ok = report.ok && !draft.errors.length;
    const text = draft.errors.length ? `${report.text}\n${this.t("jsonInvalid")}` : report.text;
    if (element) element.textContent = text;
    this.setStatus(ok ? this.t("doctorOk") : `${this.t("doctorFailed")}: ${report.summary}`);
    return ok;
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
    if (element && element.dataset?.zmsOutputDirBound !== "1") {
      if (element.dataset) element.dataset.zmsLastSaved = String(element.value || "");
      const saveIfChanged = () => {
        if (element.dataset && element.dataset.zmsLastSaved === String(element.value || "")) return;
        this.saveOutputDir();
      };
      element.addEventListener("change", saveIfChanged);
      element.addEventListener("blur", saveIfChanged);
      if (element.dataset) element.dataset.zmsOutputDirBound = "1";
    }
    this.bindOutputDirButton("zms-choose-outputDir-button", "zmsOutputDirChooseBound", () => this.chooseOutputDir());
    this.bindOutputDirButton("zms-save-outputDir-button", "zmsOutputDirSaveBound", () => this.saveOutputDir());
  },

  bindOutputDirButton(id, flag, handler) {
    const button = document.getElementById(id);
    if (!button || button.dataset?.[flag] === "1" || typeof button.addEventListener !== "function") return;
    const run = (event) => {
      event?.preventDefault?.();
      handler();
    };
    button.addEventListener("click", run);
    button.addEventListener("command", run);
    if (button.dataset) button.dataset[flag] = "1";
  },

  bindModelPickerEvents() {
    const provider = document.getElementById("zms-provider");
    if (provider && provider.dataset?.zmsProviderPickerBound !== "1") {
      const apply = () => this.applyProviderPreset();
      provider.addEventListener("command", apply);
      provider.addEventListener("change", apply);
      if (provider.dataset) provider.dataset.zmsProviderPickerBound = "1";
    }
    const select = document.getElementById("zms-model-select");
    if (select && select.dataset?.zmsModelSelectBound !== "1") {
      select.addEventListener("change", () => this.selectModelFromDropdown({ commit: true }));
      if (select.dataset) select.dataset.zmsModelSelectBound = "1";
    }
    const vendorSelect = document.getElementById("zms-model-vendor-select");
    if (vendorSelect && vendorSelect.dataset?.zmsModelVendorBound !== "1") {
      vendorSelect.addEventListener("change", () => this.renderModelOptionsFromCache({ selectFirstVisible: true, commitSelection: true }));
      if (vendorSelect.dataset) vendorSelect.dataset.zmsModelVendorBound = "1";
    }
    const model = document.getElementById("zms-model");
    if (!model || model.dataset?.zmsModelPickerBound === "1") return;
    const sync = () => syncModelSelectFromInput();
    model.addEventListener("input", sync);
    model.addEventListener("change", () => {
      sync();
      this.commitModelPickerSelection();
    });
    model.addEventListener("blur", () => this.commitModelPickerSelection());
    if (model.dataset) model.dataset.zmsModelPickerBound = "1";
    syncModelSelectFromInput();
  },

  renderModelOptionsFromCache(options = {}) {
    renderModelOptions(modelOptionsFromOptionsElement("zms-model-options"), options);
    if (options.selectFirstVisible) {
      this.refreshProfileStatus();
      this.refreshProviderGuide();
    }
    if (options.commitSelection) this.commitModelPickerSelection();
  },

  selectModelFromDropdown(options = {}) {
    const select = document.getElementById("zms-model-select");
    const model = document.getElementById("zms-model");
    if (!select || !model) return;
    const selected = String(select.value || "");
    if (selected && selected !== "__custom") {
      model.value = selected;
      setCustomModelInputVisible(model, false);
      syncCapabilityCheckboxesFromModelPicker({
        providerId: document.getElementById("zms-provider")?.value || "",
        protocol: document.getElementById("zms-profileProtocol")?.value || "",
        imageCheckboxId: "zms-cap-imageBase64",
        pdfCheckboxId: "zms-cap-pdfBase64",
        selectId: "zms-model-select",
        inputId: "zms-model"
      });
      this.refreshProfileStatus();
      this.refreshProviderGuide();
      if (options.commit === true) this.commitModelPickerSelection();
      return;
    }
    setCustomModelInputVisible(model, true);
    model.focus?.();
  },

  commitModelPickerSelection() {
    const profile = this.upsertProfileFromEditor();
    if (!profile) return null;
    if (!this.save({ updateProfile: false, statusKey: "" })) return null;
    return profile;
  },

  applyLanguage() {
    const lang = resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale());
    const setLabel = (id, key) => {
      const element = document.getElementById(id);
      if (!element) return;
      const text = this.t(key, lang);
      if (element.localName === "button") {
        element.setAttribute("label", text);
        element.label = text;
        element.textContent = text;
      } else if (element.localName === "h2") {
        element.textContent = text;
      } else {
        element.setAttribute("value", text);
        element.value = text;
      }
    };
    const setTooltip = (id, key) => {
      const element = document.getElementById(id);
      if (!element) return;
      const text = this.t(key, lang);
      element.setAttribute("tooltiptext", text);
      element.setAttribute("title", text);
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
      "providerEnv",
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
    setLabel("zms-doctor-button", "doctor");
    setLabel("zms-choose-outputDir-button", "chooseOutputDir");
    setLabel("zms-save-outputDir-button", "saveOutputDir");
    setTooltip("zms-choose-outputDir-button", "chooseOutputDirTooltip");
    setTooltip("zms-save-outputDir-button", "saveOutputDirTooltip");
    setLabel("zms-test-button", "saveAndTest");
    setLabel("zms-load-models-button", "loadModels");
    setLabel("zms-apply-provider-env-button", "applyProviderEnv");
    setLabel("zms-load-profile-button", "loadProfile");
    setLabel("zms-save-profile-button", "saveProfile");
    setLabel("zms-delete-profile-button", "deleteProfile");
    setLabel("zms-reset-profiles-button", "resetProfiles");
    setLabel("zms-load-skill-button", "loadSkill");
    setLabel("zms-save-skill-button", "saveSkill");
    setLabel("zms-reset-skill-button", "resetSkill");
    applyPreferenceMenuLabels(lang);
    applyPreferenceTextLabels(lang);
    applyPreferencePlaceholders(lang);
  },

  t(key, lang) {
    const resolved = lang || resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale());
    const message = prefMessage(key, resolved);
    if (message && message !== key) return message;
    return prefFallbackMessage(key, resolved);
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

function prefFallbackMessage(key, lang) {
  const zh = String(lang || "").toLowerCase().startsWith("zh");
  const fallback = {
    title: "Literature Review with LLM",
    uiLanguage: zh ? "界面语言" : "UI language",
    outputLanguage: zh ? "输出语言" : "Output language",
    promptPackId: zh ? "提示模板包" : "Prompt pack",
    activeProfileId: zh ? "默认接口档案" : "Default profile",
    provider: zh ? "接口厂商" : "Provider",
    baseURL: zh ? "接口地址" : "Base URL",
    apiKey: zh ? "API 密钥" : "API Key",
    model: zh ? "模型" : "Model",
    modelVendorFilter: zh ? "模型厂商" : "Model vendor",
    allModelVendors: zh ? "全部模型厂商" : "All model vendors",
    modelSelectPlaceholder: zh ? "选择接口厂商推荐模型" : "Choose provider model",
    modelSelectCustom: zh ? "自定义/私有部署模型..." : "Custom/private model...",
    modelPickerHelp: zh
      ? "先选接口厂商，推荐模型会自动显示；OpenRouter、LiteLLM、Cline API 这类聚合服务可再选模型厂商。只有私有部署或列表里没有的模型才需要自定义；有 API Key 时点“加载在线模型”会追加厂商实时返回的模型。"
      : "Choose a provider first; recommended models appear automatically. For aggregators such as OpenRouter, LiteLLM, or Cline API, choose a model vendor and then pick a concrete model from the dropdown. Use custom only for private deployments or missing models; Load online models appends provider-returned models when an API key is available.",
    onlineModels: zh ? "在线模型" : "Online",
    recommendedModels: zh ? "推荐模型" : "Recommended",
    providerEnv: zh ? "粘贴环境变量配置" : "Paste env config",
    providerGuide: zh ? "配置指南" : "Setup guide",
    profileStatus: zh ? "档案状态" : "Profile status",
    outputDir: zh ? "输出目录" : "Output directory",
    inputMode: zh ? "输入模式" : "Input mode",
    maxOutputTokens: zh ? "最大输出 token" : "Max output tokens",
    temperature: zh ? "温度" : "Temperature",
    stream: zh ? "流式输出" : "Streaming",
    profileEditor: zh ? "接口档案编辑器" : "Provider profile editor",
    profileName: zh ? "档案名称" : "Profile name",
    profileProtocol: zh ? "接口协议" : "Protocol",
    profileEndpointMode: zh ? "接口模式" : "Endpoint mode",
    profileFullURL: zh ? "完整接口地址" : "Full URL",
    profileCapabilities: zh ? "能力声明" : "Capabilities",
    profileCustomHeaders: zh ? "自定义请求头（JSON）" : "Custom headers JSON",
    profileBodyExtra: zh ? "额外请求体（JSON）" : "Body extra JSON",
    profileLocalAgent: zh ? "本地代理" : "Local agent",
    profileLocalAgentEnabled: zh ? "启用本地代理" : "Enable local agent",
    profileLocalAgentEndpoint: zh ? "代理地址" : "Endpoint",
    profileLocalAgentTool: zh ? "默认工具名" : "Default tool",
    profileLocalAgentPayloadMode: zh ? "请求格式" : "Payload mode",
    profileLocalAgentTimeout: zh ? "超时（秒）" : "Timeout (seconds)",
    profileLocalAgentHeaders: zh ? "代理请求头（JSON）" : "Agent headers JSON",
    profileLocalAgentSkills: zh ? "技能级配置（JSON，可选）" : "Skill-level config JSON (optional)",
    profileLocalAgentFallback: zh ? "失败后回退远端" : "Fallback to remote",
    systemPrompt: zh ? "系统提示词" : "System prompt",
    userPrompt: zh ? "总结提示词" : "Summary prompt",
    skillTemplate: zh ? "聊天技能提示词" : "Chat skill prompt",
    skillId: zh ? "技能" : "Skill",
    profilesJson: zh ? "接口档案 JSON" : "Provider profiles JSON",
    advancedSettings: zh ? "高级设置" : "Advanced settings",
    advancedSettingsHelp: zh
      ? "通常不需要修改；用于自定义接口协议、请求头、提示词和技能模板。"
      : "Usually not needed. Use this for custom protocols, request headers, prompts, and skill templates.",
    save: zh ? "保存设置" : "Save settings",
    doctor: zh ? "配置预检" : "Check config",
    chooseOutputDir: zh ? "选择文件夹..." : "Choose Folder...",
    chooseOutputDirTitle: zh ? "选择 Literature Review with LLM 输出文件夹" : "Choose Literature Review with LLM output folder",
    chooseOutputDirTooltip: zh ? "从系统文件管理器选择输出文件夹" : "Choose an output folder with the system file manager",
    saveOutputDir: zh ? "保存" : "Save",
    saveOutputDirTooltip: zh ? "保存当前输入的输出目录" : "Save the current output directory",
    applyProviderEnv: zh ? "应用到当前档案" : "Apply to current profile",
    test: zh ? "测试连接" : "Test connection",
    saveAndTest: zh ? "保存并测试" : "Save and Test",
    testing: zh ? "正在测试连接" : "Testing connection",
    loadModels: zh ? "加载在线模型" : "Load online models",
    loadProfile: zh ? "加载档案" : "Load profile",
    saveProfile: zh ? "保存档案" : "Save profile",
    deleteProfile: zh ? "删除档案" : "Delete profile",
    resetProfiles: zh ? "重置默认档案" : "Reset default profiles",
    loadSkill: zh ? "加载技能模板" : "Load skill template",
    saveSkill: zh ? "保存技能模板" : "Save skill template",
    resetSkill: zh ? "重置为内置模板" : "Reset to built-in template",
    saved: zh ? "已保存" : "Saved",
    apiKeyMissing: zh ? "请先填写 API Key" : "Enter an API key first",
    modelMissing: zh ? "请先选择或填写模型名称" : "Select or enter a model name first",
    modelListUnavailable: zh ? "当前档案不支持在线模型列表，已显示推荐模型" : "This profile cannot fetch an online model list; recommended models are shown",
    modelListLoaded: zh ? "已加载在线模型" : "Models loaded",
    modelListEmpty: zh ? "未返回在线模型，已保留推荐模型" : "No online models returned; kept recommendations",
    modelListLoading: zh ? "正在加载模型列表" : "Loading model list",
    modelRecommendationsLoaded: zh ? "已加载推荐模型" : "Recommended models loaded",
    modelListFailedUsingRecommendations: zh ? "在线模型列表加载失败，已保留推荐模型" : "Online model list failed; kept recommendations",
    testOk: zh ? "连接成功" : "Connection succeeded",
    testFailed: zh ? "连接失败" : "Connection failed",
    onlineModels: zh ? "在线模型" : "Online",
    recommendedModels: zh ? "推荐模型" : "Recommended",
    doctorOk: zh ? "配置预检通过" : "Configuration preflight passed",
    doctorFailed: zh ? "配置预检未通过" : "Configuration preflight failed",
    profileSaved: zh ? "接口档案已保存" : "Provider profile saved",
    profileDeleted: zh ? "接口档案已删除" : "Provider profile deleted",
    profilesReset: zh ? "已重置为默认接口档案" : "Default provider profiles restored",
    jsonInvalid: zh ? "接口档案 JSON 格式错误" : "Provider profiles JSON is invalid",
    providerEnvApplied: zh ? "已导入配置" : "Config imported",
    providerEnvNoInput: zh ? "请先粘贴 KEY=value 配置" : "Paste KEY=value config first",
    providerEnvNoMatch: zh ? "没有找到当前档案可用的环境变量" : "No matching environment variables for this profile",
    skillSaved: zh ? "技能模板已保存" : "Skill template saved",
    skillLoaded: zh ? "技能模板已加载" : "Skill template loaded",
    skillReset: zh ? "已重置为内置模板" : "Reset to built-in template",
    noProfile: zh ? "请先配置接口档案" : "Configure a provider profile first",
    profileProtocolStatus: zh ? "协议" : "Protocol",
    profileModelStatus: zh ? "模型" : "Model",
    profileEndpointStatus: zh ? "接口" : "Endpoint",
    profileEndpointMissing: zh ? "未配置" : "Not configured",
    profileModelMissing: zh ? "未配置" : "Not configured",
    profileModelOptional: zh ? "可选" : "Optional",
    profileAuthReady: zh ? "鉴权已配置" : "Authentication configured",
    profileAuthMissing: zh ? "缺少 API Key 或鉴权 Header" : "Missing API key or auth header",
    profilePdfReady: zh ? "支持 PDF 原文输入" : "Raw PDF input supported",
    profilePdfTextOnly: zh ? "仅使用文本输入" : "Text input only",
    profileImageReady: zh ? "支持图片输入" : "Image input supported",
    profileImageOff: zh ? "未启用图片输入" : "Image input disabled",
    profileStreamReady: zh ? "支持流式输出" : "Streaming supported",
    profileStreamOff: zh ? "未启用流式输出" : "Streaming disabled",
    profileLocalAgentReady: zh ? "本地代理已配置" : "Local agent configured",
    outputDirChooseFailed: zh ? "无法打开文件夹选择器" : "Could not open the folder picker",
    outputDirCreateFailed: zh ? "输出目录已保存，但无法创建或访问" : "Output directory was saved, but could not be created or accessed",
    outputDirSaved: zh ? "输出目录已保存" : "Output directory saved",
    outputDirMissing: zh ? "请先填写输出目录" : "Enter an output directory first"
  };
  return fallback[key] || key;
}

function applyPreferenceMenuLabels(lang) {
  const zh = String(lang || "").toLowerCase().startsWith("zh");
  const maps = {
    "zms-uiLanguage": {
      auto: zh ? "自动" : "Auto",
      "zh-CN": zh ? "中文" : "Chinese",
      "en-US": "English"
    },
    "zms-outputLanguage": {
      "zh-CN": zh ? "中文" : "Chinese",
      "en-US": "English",
      "ja-JP": zh ? "日文" : "Japanese"
    },
    "zms-promptPackId": {
      general: zh ? "通用阅读" : "General",
      "ai-ml": zh ? "AI / ML / 系统" : "AI / ML / Systems",
      transportation: zh ? "交通与城市空域" : "Transportation",
      biomedicine: zh ? "医学与生命科学" : "Biomedicine",
      "social-science": zh ? "社科与政策" : "Social science",
      "review-writing": zh ? "综述写作" : "Review writing"
    },
    "zms-provider": providerMenuLabels(zh),
    "zms-inputMode": {
      text: zh ? "提取文本" : "Extracted text",
      pdf_base64: zh ? "PDF 原文" : "Raw PDF"
    },
    "zms-profileProtocol": {
      openai_chat: zh ? "OpenAI 聊天补全" : "OpenAI Chat",
      openai_responses: zh ? "OpenAI Responses" : "OpenAI Responses",
      anthropic_messages: zh ? "Anthropic Messages" : "Anthropic Messages"
    },
    "zms-profileEndpointMode": {
      base_url: zh ? "Base URL 自动拼接" : "Base URL",
      full_url: zh ? "完整 URL" : "Full URL"
    },
    "zms-profileLocalAgentPayloadMode": {
      jsonrpc: zh ? "JSON-RPC" : "JSON-RPC",
      simple: zh ? "简化请求" : "Simple"
    }
  };
  for (const [id, valueMap] of Object.entries(maps)) {
    localizeMenuItems(id, valueMap);
  }
}

function providerMenuLabels(zh) {
  return {
    minimax: zh ? "MiniMax OpenAI 兼容" : "MiniMax OpenAI Compatible",
    openai: zh ? "OpenAI 原生" : "OpenAI Native",
    openai_compatible: zh ? "OpenAI 兼容接口" : "OpenAI Compatible Chat",
    openai_responses_compatible: zh ? "OpenAI Responses 兼容接口" : "OpenAI Responses Compatible",
    anthropic: zh ? "Anthropic 原生" : "Anthropic Native",
    anthropic_compatible: zh ? "Anthropic 兼容接口" : "Anthropic Compatible",
    gemini: zh ? "Gemini OpenAI 兼容" : "Gemini OpenAI Compatible",
    azure_openai: zh ? "Azure OpenAI" : "Azure OpenAI",
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
    github_models: zh ? "GitHub Models" : "GitHub Models",
    huggingface: zh ? "Hugging Face" : "Hugging Face",
    deepinfra: zh ? "DeepInfra" : "DeepInfra",
    fireworks: zh ? "Fireworks AI" : "Fireworks AI",
    cerebras: zh ? "Cerebras" : "Cerebras",
    nvidia_nim: zh ? "NVIDIA NIM" : "NVIDIA NIM",
    sambanova: zh ? "SambaNova 聊天接口" : "SambaNova Chat",
    sambanova_responses: zh ? "SambaNova Responses 接口" : "SambaNova Responses",
    sambanova_anthropic: zh ? "SambaNova Anthropic 接口" : "SambaNova Anthropic",
    xai: zh ? "xAI" : "xAI",
    groq: zh ? "Groq" : "Groq",
    mistral: zh ? "Mistral" : "Mistral",
    together: zh ? "Together AI" : "Together AI",
    kimi: zh ? "Kimi / Moonshot" : "Kimi / Moonshot",
    perplexity: zh ? "Perplexity Sonar" : "Perplexity Sonar",
    deepseek: zh ? "DeepSeek 聊天接口" : "DeepSeek Chat",
    deepseek_anthropic: zh ? "DeepSeek Anthropic 接口" : "DeepSeek Anthropic",
    zai_anthropic: zh ? "Z.AI Anthropic 接口" : "Z.AI Anthropic",
    openrouter: zh ? "OpenRouter" : "OpenRouter",
    dashscope: zh ? "Qwen / DashScope" : "Qwen / DashScope",
    siliconflow: zh ? "SiliconFlow" : "SiliconFlow",
    zhipu: zh ? "智谱 / GLM" : "Zhipu / GLM",
    volcengine: zh ? "火山方舟 / Doubao" : "Volcengine Ark / Doubao",
    qianfan: zh ? "百度千帆" : "Baidu Qianfan",
    hunyuan: zh ? "腾讯混元" : "Tencent Hunyuan",
    ollama: zh ? "Ollama 本地接口" : "Ollama Local",
    lm_studio: zh ? "LM Studio 本地接口" : "LM Studio Local",
    local_agents: zh ? "本地代理工具" : "Local Agents"
  };
}

function localizeMenuItems(id, valueMap) {
  const element = document.getElementById(id);
  const items = menuItemsForElement(element);
  for (const item of items) {
    const value = String(item?.getAttribute?.("value") || item?.value || "").trim();
    const label = valueMap[value];
    if (!label) continue;
    item.setAttribute?.("label", label);
    item.label = label;
    item.textContent = label;
  }
}

function menuItemsForElement(element) {
  if (!element) return [];
  try {
    const queried = element.querySelectorAll?.("menuitem, option");
    if (queried?.length) return Array.from(queried);
  } catch (_err) {}
  const items = [];
  const visit = (node) => {
    for (const child of Array.from(node?.children || [])) {
      if (child?.localName === "menuitem" || child?.localName === "option") items.push(child);
      visit(child);
    }
  };
  visit(element);
  return items;
}

function applyPreferenceTextLabels(lang) {
  const zh = String(lang || "").toLowerCase().startsWith("zh");
  const labels = {
    "zms-cap-text-label": zh ? "文本" : "Text",
    "zms-cap-pdfBase64-label": zh ? "PDF 原文" : "PDF base64",
    "zms-cap-imageBase64-label": zh ? "图片输入" : "Image input",
    "zms-cap-streaming-label": zh ? "流式输出" : "Streaming",
    "zms-cap-fileReference-label": zh ? "文件引用" : "File reference",
    "zms-cap-embeddings-label": zh ? "向量嵌入" : "Embeddings",
    "zms-cap-jsonMode-label": zh ? "JSON 模式" : "JSON mode",
    "zms-cap-toolUse-label": zh ? "工具调用" : "Tool use",
    "zms-cap-modelList-label": zh ? "在线模型列表" : "Model list",
    "zms-model-vendor-filter-label": zh ? "模型厂商" : "Model vendor",
    "zms-model-select-label": zh ? "具体模型" : "Concrete model",
    "zms-model-help": zh
      ? "先选接口厂商，推荐模型会自动显示；OpenRouter、LiteLLM、Cline API 这类聚合服务可再选模型厂商。只有私有部署或列表里没有的模型才需要自定义；有 API Key 时点“加载在线模型”会追加厂商实时返回的模型。"
      : "Choose a provider first; recommended models appear automatically. For aggregators such as OpenRouter, LiteLLM, or Cline API, choose a model vendor and then pick a concrete model from the dropdown. Use custom only for private deployments or missing models; Load online models appends provider-returned models when an API key is available.",
    "zms-advancedSettings-summary": zh ? "高级设置" : "Advanced settings",
    "zms-advancedSettings-help": zh
      ? "通常不需要修改；用于自定义接口协议、请求头、提示词和技能模板。"
      : "Usually not needed. Use this for custom protocols, request headers, prompts, and skill templates.",
    "zms-local-agent-note-1": zh
      ? "按 skill id 配置 endpoint/tool/timeout/payloadMode，值可为空对象。ask-all/check 未配置独立映射时将默认使用 ask-gemini / ask-claude / ask-opencode；ask-gemini-claude 可只调用 Gemini 和 Claude。"
      : "Configure endpoint/tool/timeout/payloadMode by skill id. Empty objects are allowed. ask-all/check fall back to ask-gemini / ask-claude / ask-opencode when no separate mapping is set; ask-gemini-claude can call only Gemini and Claude.",
    "zms-local-agent-note-2": zh
      ? "三位子技能可共用同一 endpoint，若某 skill 未单独配置 tool，会按 skill id 自动映射到对应工具名（ask_gemini/ask_claude/ask_opencode）。"
      : "Subskills can share one endpoint. If a skill has no explicit tool, the tool name is inferred from its skill id.",
    "zms-local-agent-note-3": zh
      ? "支持在技能配置中透传 args/body/params/payload。"
      : "Skill config can pass args/body/params/payload through to the local endpoint.",
    "zms-local-agent-note-4": zh
      ? "若接口使用非 tools/call 方法，可在技能配置里设置 method。"
      : "If the endpoint does not use tools/call, set method in the skill config.",
    "zms-local-agent-note-5": zh
      ? "本地代理需是可 HTTP 调用的 JSON-RPC 端点；原生 stdio MCP 可执行文件请先用 HTTP 桥接层转发后再配置。"
      : "Local agents must expose an HTTP JSON-RPC endpoint. Bridge stdio MCP tools to HTTP before configuring them here."
  };
  for (const [id, text] of Object.entries(labels)) {
    setTextLikeLabel(id, text);
  }
  const modelVendor = document.getElementById("zms-model-vendor-select");
  if (modelVendor) {
    const label = zh ? "模型厂商" : "Model vendor";
    modelVendor.setAttribute?.("aria-label", label);
    modelVendor.setAttribute?.("title", label);
  }
}

function setTextLikeLabel(id, text) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.value = text;
  element.setAttribute?.("value", text);
}

function applyPreferencePlaceholders(lang) {
  const zh = String(lang || "").toLowerCase().startsWith("zh");
  const providerEnv = document.getElementById("zms-providerEnvText");
  if (providerEnv) {
    providerEnv.setAttribute?.("placeholder", zh
      ? "粘贴如：\nDEEPSEEK_API_KEY=...\nDEEPSEEK_MODEL=deepseek-chat"
      : "Paste for example:\nOPENAI_API_KEY=...\nOPENAI_MODEL=gpt-5.4-mini");
  }
  const model = document.getElementById("zms-model");
  if (model) {
    model.setAttribute?.("placeholder", zh ? "自定义或私有部署模型名称" : "Custom or private model name");
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
    return runtimeZotero()?.DataDirectory?.dir || "";
  } catch (_err) {
    return "";
  }
}

function zoteroProfileDirectory() {
  try {
    return runtimeServices()?.dirsvc?.get?.("ProfD", runtimeCi()?.nsIFile)?.path || "";
  } catch (_err) {
    return "";
  }
}

async function chooseOutputDirectory(currentPath, title) {
  const cc = runtimeCc();
  const ci = runtimeCi();
  const nsIFilePicker = ci?.nsIFilePicker;
  const pickerFactory = cc?.["@mozilla.org/filepicker;1"];
  const pickerTitle = title || "Choose output folder";
  const displayPath = pathFromPickerString(currentPath);
  const displayDirectory = fileForDirectoryPicker(currentPath);
  const pickerErrors = [];
  const zoteroFilePicker = zoteroFilePickerClass();
  if (zoteroFilePicker) {
    try {
      return await chooseOutputDirectoryWithZoteroFilePicker(zoteroFilePicker, pickerTitle, displayPath);
    } catch (err) {
      pickerErrors.push(`Zotero FilePicker: ${safeError(err)}`);
      // Fall back to the raw nsIFilePicker path below.
    }
  }
  if (!pickerFactory || !nsIFilePicker) {
    throw new Error(folderPickerFailureMessage(["Folder picker is not available in this Zotero runtime", ...pickerErrors]));
  }
  try {
    const picker = pickerFactory.createInstance(nsIFilePicker);
    return await chooseOutputDirectoryWithPicker(picker, pickerTitle, nsIFilePicker, displayDirectory, true);
  } catch (err) {
    pickerErrors.push(`native FilePicker/window: ${safeError(err)}`);
  }
  try {
    const picker = pickerFactory.createInstance(nsIFilePicker);
    return chooseOutputDirectoryWithPicker(picker, pickerTitle, nsIFilePicker, displayDirectory, false);
  } catch (err) {
    pickerErrors.push(`native FilePicker/no-window: ${safeError(err)}`);
    throw new Error(folderPickerFailureMessage(pickerErrors));
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
    const chromeUtils = runtimeChromeUtils();
    if (chromeUtils) return chromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs")?.FilePicker || null;
  } catch (_err) {}
  try {
    return runtimeZotero()?.FilePicker || null;
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
  for (const win of zoteroDirectoryPickerWindowCandidates()) addWindow(win);
  const services = runtimeServices();
  try { addWindow(services?.wm?.getMostRecentWindow?.("navigator:browser")); } catch (_err) {}
  try { addWindow(services?.wm?.getMostRecentWindow?.("zotero:pref")); } catch (_err) {}
  try { addWindow(services?.wm?.getMostRecentWindow?.(null)); } catch (_err) {}
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
  for (const win of zoteroDirectoryPickerWindowCandidates()) add(win);
  const services = runtimeServices();
  try { add(services?.wm?.getMostRecentWindow?.("navigator:browser")); } catch (_err) {}
  try { add(services?.wm?.getMostRecentWindow?.("zotero:pref")); } catch (_err) {}
  try { add(services?.wm?.getMostRecentWindow?.(null)); } catch (_err) {}
  add(null);
  return candidates;
}

function zoteroDirectoryPickerWindowCandidates() {
  const candidates = [];
  const add = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };
  const zotero = runtimeZotero();
  try { add(zotero?.getMainWindow?.()); } catch (_err) {}
  try { add(zotero?.getActiveZoteroPane?.()?.document?.defaultView); } catch (_err) {}
  try { add(zotero?.getActiveZoteroPane?.()?.window); } catch (_err) {}
  return candidates;
}

function fileForDirectoryPicker(path) {
  const raw = pathFromPickerString(path);
  if (!raw) return null;
  try {
    const cc = runtimeCc();
    const ci = runtimeCi();
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
    const nsIFile = runtimeCi()?.nsIFile;
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
    const nsIFileURL = runtimeCi()?.nsIFileURL;
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

function folderPickerFailureMessage(errors) {
  const details = (errors || []).map((entry) => String(entry || "").trim()).filter(Boolean);
  return details.length
    ? `Folder picker could not open (${details.join("; ")})`
    : "Folder picker could not open";
}

function runtimeCc() {
  if (typeof Cc !== "undefined" && Cc) return Cc;
  const components = runtimeComponents();
  return runtimeWindowValue("Cc") || components?.classes;
}

function runtimeCi() {
  if (typeof Ci !== "undefined" && Ci) return Ci;
  const components = runtimeComponents();
  return runtimeWindowValue("Ci") || components?.interfaces;
}

function runtimeServices() {
  if (typeof Services !== "undefined" && Services) return Services;
  return runtimeWindowValue("Services");
}

function runtimeZotero() {
  if (typeof Zotero !== "undefined" && Zotero) return Zotero;
  return runtimeWindowValue("Zotero");
}

function runtimeChromeUtils() {
  if (typeof ChromeUtils !== "undefined" && ChromeUtils) return ChromeUtils;
  return runtimeWindowValue("ChromeUtils");
}

function runtimeComponents() {
  if (typeof Components !== "undefined" && Components) return Components;
  return runtimeWindowValue("Components");
}

function runtimeWindowValue(key) {
  try {
    if (typeof window !== "undefined" && window?.[key]) return window[key];
  } catch (_err) {}
  try {
    if (typeof window !== "undefined" && window?.parent?.[key]) return window.parent[key];
  } catch (_err) {}
  try {
    if (typeof globalThis !== "undefined" && globalThis?.[key]) return globalThis[key];
  } catch (_err) {}
  return undefined;
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
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::|\/|$)/.test(String(url || "").trim().toLowerCase());
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
    ...modelCapabilityStatusLines(profile, t),
    profile?.capabilities?.streaming === true ? t("profileStreamReady") : t("profileStreamOff"),
    profileHasUsableAuth(profile) ? t("profileAuthReady") : t("profileAuthMissing")
  ];
  if (isLocalAgent) parts.push(t("profileLocalAgentReady"));
  return parts.filter(Boolean).join("\n");
}

function providerConfigDoctor(profile, language = "en-US") {
  const zh = /^zh/i.test(String(language || ""));
  const missing = [];
  const conflicts = [];
  const warnings = [];
  const endpoint = endpointForProfileSafe(profile);
  const modelList = providerModelListGuide(profile);
  const provider = providerFromProfile(profile);
  const verify = providerLiveVerifyGuide(profile, provider);
  const isLocalAgent = isLocalAgentProfile(profile);
  const localEndpoint = isLocalEndpoint(endpoint);
  const authReady = isLocalAgent || localEndpoint || verify.apiKeyOptional || profileHasUsableAuth(profile);
  const model = String(profile?.model || "").trim();
  const baseURL = String(profile?.baseURL || "").trim();
  const fullURL = String(profile?.fullURL || "").trim();
  const needsBaseURL = verify.includeBaseURL && profile?.endpointMode !== "full_url";
  if (!endpoint) missing.push(zh ? "请求地址" : "request endpoint");
  if (needsBaseURL && (!baseURL || isPlaceholderEndpoint(baseURL))) missing.push(zh ? "基础地址" : "Base URL");
  if (profile?.endpointMode === "full_url" && (!fullURL || isPlaceholderEndpoint(fullURL))) missing.push(zh ? "完整接口地址" : "Full URL");
  if (!authReady) missing.push(zh ? "API Key 或自定义认证 header" : "API key or custom auth header");
  if (!isLocalAgent && (!model || model === "...")) missing.push(zh ? "模型名称" : "model name");
  if (modelLikelyTextOnlyForProfile(profile, "image") && canUseImageInput(profile)) {
    conflicts.push(zh ? `模型 ${model} 疑似仅支持文本，但已开启图片输入。` : `Model ${model} appears to be text-only, but image input is enabled.`);
  }
  if (modelLikelyTextOnlyForProfile(profile, "pdf") && canUsePdfBase64Input(profile)) {
    conflicts.push(zh ? `模型 ${model} 疑似仅支持文本，但已开启 PDF 原文输入。` : `Model ${model} appears to be text-only, but raw PDF input is enabled.`);
  }
  if (profile?.protocol === "openai_chat" && profile?.capabilities?.pdfBase64 === true) {
    warnings.push(zh ? "OpenAI Chat 档案会使用 Zotero 文本抽取，不能直接发送原始 PDF。" : "OpenAI Chat profiles use Zotero text extraction instead of raw PDF input.");
  }
  if (profile?.capabilities?.imageBase64 === true && profile?.protocol === "openai_chat" && provider === "openai_compatible") {
    warnings.push(zh ? "通用兼容路由的图片能力取决于具体模型，发送前请用图片联网检查确认。" : "Image support on generic compatible routes depends on the selected model; confirm with the image live check before use.");
  }
  const capabilityText = [
    profile?.capabilities?.text !== false ? (zh ? "文本" : "text") : "",
    canUseImageInput(profile) ? (zh ? "图片" : "image") : "",
    canUsePdfBase64Input(profile) ? "PDF base64" : "",
    profile?.capabilities?.streaming === true ? (zh ? "流式" : "streaming") : "",
    profile?.capabilities?.modelList !== false ? (zh ? "模型列表" : "model list") : ""
  ].filter(Boolean).join(", ") || (zh ? "未声明" : "none declared");
  const authStatus = authReady
    ? (localEndpoint ? (zh ? "本地接口，可不填 API Key" : "local endpoint, API key optional") : (zh ? "已配置" : "configured"))
    : (zh ? "缺失" : "missing");
  const ok = missing.length === 0 && conflicts.length === 0;
  const title = zh ? `配置预检：${ok ? "通过" : "未通过"}` : `Configuration preflight: ${ok ? "passed" : "failed"}`;
  const lines = [
    title,
    `${zh ? "档案" : "Profile"}: ${profile?.name || profile?.id || provider || ""}`,
    `${zh ? "协议" : "Protocol"}: ${providerProtocolLabel(profile?.protocol, zh)}`,
    `${zh ? "请求地址" : "Request endpoint"}: ${endpoint || (zh ? "未配置" : "not configured")}`,
    `${zh ? "模型列表地址" : "Model-list endpoint"}: ${modelList || (zh ? "不可用" : "not available")}`,
    `${zh ? "模型" : "Model"}: ${model || (isLocalAgent ? (zh ? "可选" : "optional") : (zh ? "缺失" : "missing"))}`,
    `${zh ? "鉴权" : "Auth"}: ${authStatus}`,
    `${zh ? "能力" : "Capabilities"}: ${capabilityText}`,
    `${zh ? "下一步" : "Next"}: ${verify.doctorCommand}`,
    `${zh ? "同协议族检查" : "Protocol family check"}: ${verify.protocolGroupDoctorCommand || verify.doctorCommand}`,
    `${zh ? "核心协议检查" : "Core protocol check"}: ${verify.coreDoctorCommand}`
  ];
  if (missing.length) {
    lines.push(`${zh ? "缺失项" : "Missing"}: ${missing.join(", ")}`);
  }
  if (conflicts.length) {
    lines.push(`${zh ? "冲突项" : "Conflicts"}: ${conflicts.join(" ")}`);
  }
  if (warnings.length) {
    lines.push(`${zh ? "提醒" : "Notes"}: ${warnings.join(" ")}`);
  }
  return {
    ok,
    missing,
    conflicts,
    warnings,
    summary: [...missing, ...conflicts].length ? [...missing, ...conflicts].join(", ") : (zh ? "可以继续测试连接" : "ready for connection test"),
    text: lines.join("\n")
  };
}

function isPlaceholderEndpoint(value) {
  return /\bYOUR[-_A-Z0-9]*\b|example(?:\.com|[-_])/i.test(String(value || ""));
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
      `基础地址：${profile.baseURL || defaults.baseURL || "未填写"}`,
      `请求地址：${endpoint || "未配置"}`,
      `鉴权：${auth}`,
      `模型：${profile.model || "请先从“具体模型”下拉选择，必要时加载在线模型"}`,
      `能力：${capabilities || "文本"}`,
      `模型列表：${modelList || "当前档案不支持在线模型刷新"}`,
      `保存后测试：点击“测试连接”；失败信息会隐藏完整 API Key。`,
      `复制环境变量模板：${verify.envTemplateCommand}`,
      `.env.local 草稿：${verify.dotenvTemplateCommand}`,
      `.env.local 配置预检：${verify.doctorCommand}`,
      `.env.local 联网检查：${verify.envFileCommand}`,
      `终端联网检查：${verify.liveCommand}`,
      `图片联网检查：${verify.imageCommand || "当前档案不支持图片输入"}`,
      ...(verify.imageOverrideCommand ? [`图片能力覆盖检查：${verify.imageOverrideCommand}`] : []),
      `PDF 联网检查：${verify.pdfCommand || "当前档案使用 Zotero 文本抽取"}`,
      ...(verify.pdfOverrideCommand ? [`PDF 能力覆盖检查：${verify.pdfOverrideCommand}`] : []),
      `模型列表联网检查：${verify.modelsCommand}`,
      `当前协议族检查：${verify.protocolGroupDoctorCommand || "当前档案没有可归类协议族"}`,
      `当前协议族模型列表检查：${verify.protocolGroupModelsCommand || "当前档案没有可归类协议族"}`,
      `核心协议检查：${verify.coreDoctorCommand}`,
      `主流厂商检查：${verify.mainstreamDoctorCommand}`
    ].join("\n");
  }
  return [
    `Active profile: ${profile.name || defaults.name || profile.id || provider}`,
    `Protocol: ${providerProtocolLabel(profile.protocol, zh)}`,
    `Base URL: ${profile.baseURL || defaults.baseURL || "not set"}`,
    `Request endpoint: ${endpoint || "not configured"}`,
    `Auth: ${auth}`,
    `Model: ${profile.model || "choose a concrete model, or refresh online models"}`,
    `Capabilities: ${capabilities || "text"}`,
    `Model list: ${modelList || "not available for this profile"}`,
    "After saving: click Test connection. Failure messages hide full API keys.",
    `Copy env template: ${verify.envTemplateCommand}`,
    `Draft .env.local: ${verify.dotenvTemplateCommand}`,
    `.env.local config doctor: ${verify.doctorCommand}`,
    `Env-file live check: ${verify.envFileCommand}`,
    `Terminal live check: ${verify.liveCommand}`,
    `Image live check: ${verify.imageCommand || "not supported by this profile"}`,
    ...(verify.imageOverrideCommand ? [`Image capability override check: ${verify.imageOverrideCommand}`] : []),
    `PDF live check: ${verify.pdfCommand || "uses Zotero extracted text"}`,
    ...(verify.pdfOverrideCommand ? [`PDF capability override check: ${verify.pdfOverrideCommand}`] : []),
    `Model-list live check: ${verify.modelsCommand}`,
    `Protocol-family check: ${verify.protocolGroupDoctorCommand || "not available"}`,
    `Protocol-family model-list check: ${verify.protocolGroupModelsCommand || "not available"}`,
    `Core protocol check: ${verify.coreDoctorCommand}`,
    `Mainstream provider check: ${verify.mainstreamDoctorCommand}`
  ].join("\n");
}

function providerProtocolLabel(protocol, zh = false) {
  if (protocol === "openai_responses") return zh ? "OpenAI Responses" : "OpenAI Responses";
  if (protocol === "anthropic_messages") return zh ? "Anthropic 消息接口" : "Anthropic Messages";
  return zh ? "OpenAI 聊天补全" : "OpenAI Chat Completions";
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
  const protocolGroup = providerLiveProtocolGroup(profile);
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
  const dotenvTemplateCommand = `npm run verify:provider:live -- --env-template --dotenv-template --include ${entry.include} > .env.local`;
  const doctorCommand = `npm run verify:provider:live -- --doctor --include ${entry.include} --provider-env-file .env.local`;
  const envFileCommand = `npm run verify:provider:live -- --include ${entry.include} --provider-env-file .env.local`;
  const envFileImageCommand = canUseImageInput(profile) ? `npm run verify:provider:image:live -- --include ${entry.include} --provider-env-file .env.local` : "";
  const envFilePdfCommand = canUsePdfBase64Input(profile) ? `npm run verify:provider:pdf:live -- --include ${entry.include} --provider-env-file .env.local` : "";
  const envFileModelsCommand = `npm run verify:provider:models:live -- --include ${entry.include} --provider-env-file .env.local`;
  const overrideCommands = providerCapabilityOverrideCommands(profile, provider, entry, prefix);
  return {
    ...entry,
    liveCommand,
    imageCommand,
    pdfCommand,
    modelsCommand,
    envTemplateCommand,
    dotenvTemplateCommand,
    doctorCommand,
    envFileCommand,
    envFileImageCommand,
    envFilePdfCommand,
    envFileModelsCommand,
    protocolGroup,
    protocolGroupDoctorCommand: protocolGroup ? `npm run verify:provider:live -- --doctor --include ${protocolGroup} --provider-env-file .env.local` : "",
    protocolGroupModelsCommand: protocolGroup ? `npm run verify:provider:models:live -- --include ${protocolGroup} --provider-env-file .env.local` : "",
    coreDoctorCommand: "npm run verify:provider:live -- --doctor --include core --provider-env-file .env.local",
    mainstreamDoctorCommand: "npm run verify:provider:live -- --doctor --include mainstream --provider-env-file .env.local",
    ...overrideCommands
  };
}

function providerLiveProtocolGroup(profile) {
  if (profile?.protocol === "openai_chat") return "openai-chat";
  if (profile?.protocol === "openai_responses") return "openai-responses";
  if (profile?.protocol === "anthropic_messages") return "anthropic-messages";
  return "";
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
  if (provider === "vercel_ai_chat") {
    return { include: "vercel-ai-chat", apiKeyEnv: "VERCEL_AI_API_KEY", modelEnv: "VERCEL_AI_MODEL", baseURLEnv: "VERCEL_AI_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "vercel_ai_responses") {
    return { include: "vercel-ai-responses", apiKeyEnv: "VERCEL_AI_RESPONSES_API_KEY", modelEnv: "VERCEL_AI_RESPONSES_MODEL", baseURLEnv: "VERCEL_AI_RESPONSES_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "vercel_ai_anthropic") {
    return { include: "vercel-ai-anthropic", apiKeyEnv: "VERCEL_AI_ANTHROPIC_API_KEY", modelEnv: "VERCEL_AI_ANTHROPIC_MODEL", baseURLEnv: "VERCEL_AI_ANTHROPIC_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "cline_api") {
    return { include: "cline-api", apiKeyEnv: "CLINE_API_KEY", modelEnv: "CLINE_MODEL", baseURLEnv: "CLINE_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "litellm_proxy_chat") {
    return { include: "litellm-proxy-chat", apiKeyEnv: "LITELLM_PROXY_API_KEY", modelEnv: "LITELLM_PROXY_MODEL", baseURLEnv: "LITELLM_PROXY_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (provider === "litellm_proxy_responses") {
    return { include: "litellm-proxy-responses", apiKeyEnv: "LITELLM_PROXY_RESPONSES_API_KEY", modelEnv: "LITELLM_PROXY_RESPONSES_MODEL", baseURLEnv: "LITELLM_PROXY_RESPONSES_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (provider === "litellm_proxy_anthropic") {
    return { include: "litellm-proxy-anthropic", apiKeyEnv: "LITELLM_PROXY_ANTHROPIC_API_KEY", modelEnv: "LITELLM_PROXY_ANTHROPIC_MODEL", baseURLEnv: "LITELLM_PROXY_ANTHROPIC_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (provider === "cloudflare_ai_chat") {
    return { include: "cloudflare-ai-chat", apiKeyEnv: "CLOUDFLARE_API_KEY", modelEnv: "CLOUDFLARE_MODEL", baseURLEnv: "CLOUDFLARE_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (provider === "cloudflare_ai_responses") {
    return { include: "cloudflare-ai-responses", apiKeyEnv: "CLOUDFLARE_RESPONSES_API_KEY", modelEnv: "CLOUDFLARE_RESPONSES_MODEL", baseURLEnv: "CLOUDFLARE_RESPONSES_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (provider === "cloudflare_ai_anthropic") {
    return { include: "cloudflare-ai-anthropic", apiKeyEnv: "CLOUDFLARE_ANTHROPIC_API_KEY", modelEnv: "CLOUDFLARE_ANTHROPIC_MODEL", baseURLEnv: "CLOUDFLARE_ANTHROPIC_BASE_URL", includeBaseURL: true, apiKeyOptional };
  }
  if (provider === "github_models") {
    return { include: "github-models", apiKeyEnv: "GITHUB_MODELS_API_KEY", modelEnv: "GITHUB_MODELS_MODEL", baseURLEnv: "GITHUB_MODELS_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "huggingface") {
    return { include: "huggingface", apiKeyEnv: "HUGGINGFACE_API_KEY", modelEnv: "HUGGINGFACE_MODEL", baseURLEnv: "HUGGINGFACE_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
  }
  if (provider === "deepinfra") {
    return { include: "deepinfra", apiKeyEnv: "DEEPINFRA_API_KEY", modelEnv: "DEEPINFRA_MODEL", baseURLEnv: "DEEPINFRA_BASE_URL", includeBaseURL: includeNamedBaseURL, apiKeyOptional };
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

function applyProviderEnvTextToProfile(profile, raw, provider = providerFromProfile(profile)) {
  const env = parseProviderEnvText(raw);
  const next = hydrateProfile(profile || {});
  const entry = providerLiveVerifyCase(next, provider);
  const changed = [];
  const apiKey = providerEnvFirstValue(env, providerEnvCandidateNames(entry, provider, "apiKey"));
  const model = providerEnvFirstValue(env, providerEnvCandidateNames(entry, provider, "model"));
  const baseURL = providerEnvFirstValue(env, providerEnvCandidateNames(entry, provider, "baseURL"));
  const capabilities = providerEnvJSONValue(env, providerEnvCandidateNames(entry, provider, "capabilities"));
  const headers = providerEnvJSONValue(env, providerEnvCandidateNames(entry, provider, "headers"));
  const bodyExtra = providerEnvJSONValue(env, providerEnvCandidateNames(entry, provider, "bodyExtra"));

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

function parseProviderEnvText(raw) {
  const env = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const parsed = parseProviderEnvLine(line);
    if (parsed) env[parsed.key] = parsed.value;
  }
  return env;
}

function parseProviderEnvLine(line) {
  let text = String(line || "").trim();
  if (!text || text.startsWith("#")) return null;
  text = text.replace(/^export\s+/i, "").trim();
  const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
  if (!match) return null;
  return { key: match[1], value: normalizeProviderEnvValue(match[2]) };
}

function normalizeProviderEnvValue(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  const quote = text[0];
  if ((quote === "\"" || quote === "'") && text.length >= 2) {
    const end = findProviderEnvQuoteEnd(text, quote);
    if (end > 0) return unquoteProviderEnvValue(text.slice(0, end + 1));
  }
  text = text.replace(/\s+#.*$/, "").trim();
  return unquoteProviderEnvValue(text);
}

function findProviderEnvQuoteEnd(text, quote) {
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] !== quote) continue;
    if (quote === "\"" && text[index - 1] === "\\") continue;
    return index;
  }
  return -1;
}

function unquoteProviderEnvValue(value) {
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

function providerEnvFirstValue(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (providerEnvValueUsable(value)) return String(value).trim();
  }
  return undefined;
}

function providerEnvJSONValue(env, names) {
  const value = providerEnvFirstValue(env, names);
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function providerEnvValueUsable(value) {
  const text = String(value ?? "").trim();
  return !!text && text !== "..." && !/^YOUR[_-]/i.test(text);
}

function providerEnvCandidateNames(entry, provider, field) {
  const prefix = String(entry?.apiKeyEnv || "").replace(/_API_KEY$/, "");
  const aliases = providerEnvAliases(provider, prefix);
  if (field === "apiKey") return providerEnvUniqueNames(entry?.apiKeyEnv, `${prefix}_KEY`, ...aliases.apiKey, "API_KEY");
  if (field === "model") return providerEnvUniqueNames(entry?.modelEnv, `${prefix}_MODEL`, ...aliases.model, "MODEL");
  if (field === "baseURL") return providerEnvUniqueNames(entry?.baseURLEnv, `${prefix}_BASE_URL`, `${prefix}_ENDPOINT`, ...aliases.baseURL, "BASE_URL", "ENDPOINT");
  if (field === "capabilities") return providerEnvUniqueNames(providerCapabilitiesEnvName(entry), `${prefix}_CAPABILITIES_JSON`, "CAPABILITIES_JSON");
  if (field === "headers") return providerEnvUniqueNames(`${prefix}_HEADERS_JSON`, `${prefix}_CUSTOM_HEADERS_JSON`, "HEADERS_JSON", "CUSTOM_HEADERS_JSON");
  if (field === "bodyExtra") return providerEnvUniqueNames(`${prefix}_BODY_EXTRA_JSON`, `${prefix}_EXTRA_BODY_JSON`, "BODY_EXTRA_JSON", "EXTRA_BODY_JSON");
  return [];
}

function providerEnvAliases(provider, prefix) {
  const key = String(provider || "").replace(/-/g, "_");
  const aliases = { apiKey: [], model: [], baseURL: [] };
  if (key.includes("vercel_ai")) {
    aliases.apiKey.push("AI_GATEWAY_API_KEY", "VERCEL_API_KEY");
    aliases.model.push("AI_GATEWAY_MODEL");
    aliases.baseURL.push("AI_GATEWAY_BASE_URL");
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
  if (key === "gemini") {
    aliases.apiKey.push("GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY");
    aliases.model.push("GOOGLE_MODEL", "GOOGLE_GENERATIVE_AI_MODEL");
    aliases.baseURL.push("GOOGLE_BASE_URL", "GOOGLE_GENERATIVE_AI_BASE_URL");
  }
  if (key === "azure_openai") {
    aliases.baseURL.push("AZURE_OPENAI_ENDPOINT");
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

function providerEnvUniqueNames(...names) {
  return Array.from(new Set(names.map((name) => String(name || "").trim()).filter(Boolean)));
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

function modelLikelyTextOnlyForProfile(profile, inputFeature = "") {
  const hints = modelFeatureHintsForProfile(profile);
  const feature = String(inputFeature || "").trim().toLowerCase();
  if (feature && hints.includes(feature)) return false;
  if (!feature && (hints.includes("image") || hints.includes("pdf"))) return false;
  if (typeof zmsModelLikelyTextOnlyForProviderModel !== "function") return false;
  const provider = providerFromProfile(profile);
  return zmsModelLikelyTextOnlyForProviderModel(provider, profile?.model || "", profile?.model || "");
}

function modelFeatureHintsForProfile(profile) {
  const bodyExtra = profile?.bodyExtra || {};
  const hints = normalizeModelFeatureList(bodyExtra.modelFeatureHints || bodyExtra.modelFeatures || bodyExtra.featureHints);
  if (!hints.length) return [];
  const hintModel = String(bodyExtra.modelFeatureHintsModel || bodyExtra.modelFeaturesModel || "").trim();
  const model = String(profile?.model || "").trim();
  if (hintModel && model && hintModel !== model) return [];
  return hints;
}

function modelCapabilityStatusLines(profile, translate = (key) => key) {
  const t = typeof translate === "function" ? translate : (key) => key;
  const textOnly = modelLikelyTextOnlyForProfile(profile);
  const imageMismatch = canUseImageInput(profile) && modelLikelyTextOnlyForProfile(profile, "image");
  const pdfMismatch = canUsePdfBase64Input(profile) && modelLikelyTextOnlyForProfile(profile, "pdf");
  if (!textOnly && !imageMismatch && !pdfMismatch) return [];
  const lines = [];
  if (textOnly) lines.push(t("profileModelTextOnly"));
  if (imageMismatch) lines.push(t("profileImageModelMismatch"));
  if (pdfMismatch) lines.push(t("profilePdfModelMismatch"));
  return lines;
}

function profileDraftFromEditor() {
  const errors = [];
  const customHeaders = jsonObjectFromValue(document.getElementById("zms-profileCustomHeaders")?.value, errors) || {};
  let bodyExtra = jsonObjectFromValue(document.getElementById("zms-profileBodyExtra")?.value, errors) || {};
  const localAgent = localAgentDraftFromEditor(errors);
  if (localAgent) {
    bodyExtra.localAgent = localAgent;
  } else if (bodyExtra.localAgent !== undefined) {
    delete bodyExtra.localAgent;
  }
  bodyExtra = bodyExtraWithModelPickerFeatureHints(bodyExtra, "zms-model-select", "zms-model");
  const profile = {
    id: normalizeProfileId(document.getElementById("zms-activeProfileId")?.value || document.getElementById("zms-profileName")?.value) || "custom",
    name: String(document.getElementById("zms-profileName")?.value || "").trim(),
    protocol: document.getElementById("zms-profileProtocol")?.value || "openai_chat",
    endpointMode: document.getElementById("zms-profileEndpointMode")?.value || "base_url",
    baseURL: document.getElementById("zms-baseURL")?.value || "",
    fullURL: document.getElementById("zms-profileFullURL")?.value || "",
    apiKey: document.getElementById("zms-apiKey")?.value || "",
    model: modelValueFromPicker("zms-model-select", "zms-model"),
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
  let effectiveProfile = hydrateProfile(profile || {});
  const usedFallbackFields = [];
  let lastResponse = null;
  let lastText = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(request.url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await response.text();
    lastResponse = response;
    lastText = text;
    const fallbackFields = providerCompatibilityFallbackFields(effectiveProfile?.protocol, body, response.status, text, usedFallbackFields);
    if (response.ok && !fallbackFields.length) {
      return { response, text, compatibilityFallbackFields: normalizeProviderFallbackFieldList(usedFallbackFields), effectiveProfile };
    }
    if (!fallbackFields.length) {
      return { response, text, compatibilityFallbackFields: normalizeProviderFallbackFieldList(usedFallbackFields), effectiveProfile };
    }
    effectiveProfile = profileWithProviderConnectionTestFallback(effectiveProfile, body, fallbackFields, usedFallbackFields);
    usedFallbackFields.splice(0, usedFallbackFields.length, ...normalizeProviderFallbackFieldList([...usedFallbackFields, ...fallbackFields]));
    body = omitProviderRequestBodyFields(body, fallbackFields, usedFallbackFields);
    headers = providerRequestHeadersWithFallback(headers, fallbackFields);
  }
  return { response: lastResponse, text: lastText, compatibilityFallbackFields: normalizeProviderFallbackFieldList(usedFallbackFields), effectiveProfile };
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
          version: "0.1.6"
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
    return /\/v\d+$/i.test(providerURLPath(base)) ? appendProviderURLPath(base, "models") : appendProviderURLPath(base, "v1/models");
  }
  return appendProviderURLPath(openAICompatibleBaseWithVersion(base), "models");
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
  let effectiveProfile = request.profile ? hydrateProfile(request.profile) : null;
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
      if (effectiveProfile) effectiveProfile = profileWithProviderConnectionTestFallback(effectiveProfile, {}, fallbackFields, usedFallbackFields);
      headers = providerRequestHeadersWithFallback(headers, fallbackFields);
      usedFallbackFields.splice(0, usedFallbackFields.length, ...normalizeProviderFallbackFieldList([...usedFallbackFields, ...fallbackFields]));
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
  request.compatibilityFallbackFields = normalizeProviderFallbackFieldList(usedFallbackFields);
  if (effectiveProfile) request.effectiveProfile = effectiveProfile;
  return modelOptionsFromItems(items);
}

function nextModelListURL(currentUrl, data) {
  const envelope = modelListPaginationEnvelope(data);
  if (!envelope) return "";
  const direct = stringField(envelope.next_page, envelope.nextPage, envelope.next, envelope.next_url, envelope.nextUrl, envelope.nextPageUrl);
  if (direct) return modelListURLFromNextValue(currentUrl, direct);
  const hasMore = envelope.has_more === true || envelope.hasMore === true;
  const nextCursor = stringField(envelope.next_cursor, envelope.nextCursor);
  const nextPageToken = stringField(envelope.next_page_token, envelope.nextPageToken, envelope.next_token, envelope.nextToken);
  if (!hasMore && !nextCursor && !nextPageToken) return "";
  const tokenPairs = [
    ["after_id", stringField(envelope.last_id, envelope.lastId, envelope.after_id, envelope.afterId)],
    ["page_token", nextPageToken],
    ["cursor", nextCursor],
    ["after", hasMore ? stringField(envelope.cursor, envelope.after) : ""]
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
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1):11434/i.test(String(baseURL || ""));
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
  for (const key of PREFERENCES_MODEL_LIST_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const items = modelListItemsFromResponse(value, depth + 1);
    if (items.length) return items;
  }
  return [];
}

function directModelListItemsFromResponse(data) {
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
    const items = modelListItemsFromObjectMap(data?.[field]);
    if (items.length) return items;
  }
  return [];
}

function modelListItemsFromObjectMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  if (modelOptionFromItem(value).id) return [];
  if (directModelListItemsFromResponse(value).length) return [];
  const items = [];
  for (const [key, item] of Object.entries(value)) {
    const id = String(key || "").trim();
    if (!id || modelListMapMetadataKeys().has(id)) continue;
    if (typeof item === "string") {
      const label = item.trim();
      if (label) items.push({ id, label });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const option = modelOptionFromItem(item);
    items.push(option.id ? item : { ...item, id });
  }
  return items;
}

function modelListMapMetadataKeys() {
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

function modelListPaginationEnvelope(data, depth = 0) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (hasModelListPaginationFields(data)) return data;
  if (depth >= 2) return null;
  for (const key of PREFERENCES_MODEL_LIST_WRAPPER_KEYS) {
    const value = data?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const envelope = modelListPaginationEnvelope(value, depth + 1);
    if (envelope) return envelope;
  }
  return null;
}

function hasModelListPaginationFields(data) {
  return !!stringField(
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

function modelOptionFromItem(item, depth = 0) {
  if (typeof item === "string") {
    const id = item.trim();
    return { id, label: id };
  }
  if (!item || typeof item !== "object") return { id: "", label: "" };
  const explicitVendor = modelVendorFromModelListItem(item);
  const explicitFeatures = modelFeaturesFromModelListItem(item);
  const id = stringField(
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
  const label = stringField(
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
        const option = modelOptionFromItem(nested, depth + 1);
        if (option.id) {
          return compactModelOption({
            ...option,
            vendor: explicitVendor || option.vendor,
            features: mergeModelFeatureHints(explicitFeatures, option.features)
          });
        }
      }
    }
  }
  return compactModelOption({ id, label, vendor: explicitVendor || inferredModelVendorFromModelListId(id, label), features: explicitFeatures });
}

function inferredModelVendorFromModelListId(id, label) {
  const value = String(id || "").trim();
  return value.includes("/") ? inferredModelVendor({ id: value, label }) : "";
}

function compactModelOption(option) {
  const result = {
    id: String(option?.id || "").trim(),
    label: String(option?.label || option?.id || "").trim()
  };
  const vendor = canonicalModelVendorLabel(option?.vendor);
  const features = normalizeModelFeatureList(option?.features);
  if (vendor) result.vendor = vendor;
  if (features.length) result.features = features;
  return result;
}

function modelVendorFromModelListItem(item) {
  return canonicalModelVendorLabel(firstModelVendorValue(
    item?.provider,
    item?.provider_id,
    item?.providerId,
    item?.provider_name,
    item?.providerName,
    item?.vendor,
    item?.vendor_id,
    item?.vendorId,
    item?.owner,
    item?.owned_by,
    item?.ownedBy,
    item?.publisher,
    item?.organization,
    item?.org,
    item?.family,
    item?.model_family,
    item?.modelFamily,
    item?.top_provider,
    item?.topProvider,
    item?.metadata?.provider,
    item?.metadata?.vendor,
    item?.meta?.provider,
    item?.meta?.vendor,
    item?.architecture?.provider,
    item?.details?.family
  ));
}

function firstModelVendorValue(...values) {
  for (const value of values) {
    const candidate = modelVendorValue(value);
    if (candidate) return candidate;
  }
  return "";
}

function modelVendorValue(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return stringField(
    value.display_name,
    value.displayName,
    value.label,
    value.title,
    value.name,
    value.id,
    value.slug,
    value.key,
    value.value
  );
}

function canonicalModelVendorLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (typeof zmsModelVendorForProviderModel === "function") {
    const inferred = zmsModelVendorForProviderModel("", raw, raw);
    if (inferred) return inferred;
  }
  return raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modelFeaturesFromModelListItem(item) {
  const features = [];
  collectModelFeatureHints(features, item?.features);
  collectModelFeatureHints(features, item?.featureHints);
  collectModelFeatureHints(features, item?.traits);
  collectModelFeatureHints(features, item?.modalities);
  collectModelFeatureHints(features, item?.input_modalities);
  collectModelFeatureHints(features, item?.inputModalities);
  collectModelFeatureHints(features, item?.supported_modalities);
  collectModelFeatureHints(features, item?.supportedModalities);
  collectModelFeatureHints(features, item?.input);
  collectModelFeatureHints(features, item?.inputs);
  collectModelFeatureHints(features, item?.input_formats);
  collectModelFeatureHints(features, item?.inputFormats);
  collectModelFeatureHints(features, item?.supported_input_formats);
  collectModelFeatureHints(features, item?.supportedInputFormats);
  collectModelFeatureHints(features, item?.content_types);
  collectModelFeatureHints(features, item?.contentTypes);
  collectModelFeatureHints(features, item?.supported_content_types);
  collectModelFeatureHints(features, item?.supportedContentTypes);
  collectModelFeatureHints(features, item?.capabilities);
  collectModelFeatureHints(features, item?.architecture);
  collectModelFeatureHints(features, item?.metadata);
  collectModelFeatureHints(features, item?.metadata?.capabilities);
  collectModelFeatureHints(features, item?.metadata?.modalities);
  collectModelFeatureHints(features, item?.meta);
  collectModelFeatureHints(features, item?.meta?.capabilities);
  collectModelFeatureHints(features, item?.model_info);
  collectModelFeatureHints(features, item?.modelInfo);
  collectModelFeatureHints(features, item?.details);
  collectModelFeatureHints(features, item?.supported_parameters);
  collectModelFeatureHints(features, item?.supportedParameters);
  return normalizeModelFeatureList(features);
}

function collectModelFeatureHints(features, value, depth = 0) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" || typeof value === "number") {
    pushModelFeatureHintsFromText(features, String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModelFeatureHints(features, item, depth + 1);
    return;
  }
  if (typeof value !== "object" || depth >= 5) return;
  for (const [key, entry] of Object.entries(value)) {
    const keyText = String(key || "");
    if (entry === true || entry === "true" || entry === 1 || entry === "1") {
      pushModelFeatureHintsFromText(features, keyText);
    }
    if (entry && typeof entry === "object") {
      pushModelFeatureHintsFromText(features, keyText);
    }
    if (typeof entry === "string" || typeof entry === "number" || Array.isArray(entry) || (entry && typeof entry === "object")) {
      collectModelFeatureHints(features, entry, depth + 1);
    }
  }
}

function pushModelFeatureHintsFromText(features, value) {
  const text = String(value || "").toLowerCase();
  if (!text) return;
  if (/image|vision|visual|multimodal|input_image|\bvl\b|pixtral/.test(text)) features.push("image");
  if (/pdf|document|file/.test(text)) features.push("pdf");
  if (/reason|thinking|chain-of-thought|\bo\d\b|\bo\d-|r1/.test(text)) features.push("reasoning");
  if (/fast|flash|mini|nano|lite|highspeed|turbo|instant|small/.test(text)) features.push("fast");
  if (/local|ollama|lm studio/.test(text)) features.push("local");
}

function mergeModelFeatureHints(left, right) {
  return normalizeModelFeatureList([...(left || []), ...(right || [])]);
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
  const visibleText = stripThink(value);
  if (!visibleText) throw new Error("No text returned from model");
  return visibleText;
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
  const lines = (buffer || []).map((line) => String(line || "").trim()).filter(Boolean);
  const payload = lines.join("\n").trim();
  if (lines.length > 1 && !safeParseJSON(payload)) {
    payloads.push(...lines);
    return;
  }
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
    const details = providerErrorDetailsText(error.details, error.detail, error.errors, data.details, data.detail, data.errors);
    return [code, type, providerErrorMessageWithDetails(message, details) || JSON.stringify(error)].filter(Boolean).join(" - ");
  }
  if (Array.isArray(data.errors) && data.errors.length) {
    const text = data.errors.map((entry) => directProviderResponseErrorDetail({ error: entry })).filter(Boolean).join("; ");
    if (text) return text;
  }
  const message = errorString(data.message, data.detail, data.error_description, data.errorMessage, data.error_message);
  const details = providerErrorDetailsText(data.details, data.detail, data.errors);
  const code = errorString(data.code, data.error_code, data.errorCode);
  const type = errorString(data.type, data.error_type, data.errorType);
  const status = errorString(data.status, data.status_code, data.statusCode);
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
  const type = errorString(value);
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
  const message = errorString(value.msg, value.message, value.detail, value.reason, value.description, value.type, value.code);
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
const PREFERENCES_MODEL_LIST_WRAPPER_KEYS = [...PREFERENCES_PROVIDER_RESPONSE_WRAPPER_KEYS, "meta", "metadata", "pagination", "paging", "page", "links"];
const PREFERENCES_PROVIDER_FALLBACK_BODY_FIELDS = new Set([
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
  "completion",
  "parsed",
  "json",
  "output_parsed",
  "outputParsed"
];

function openAITextFromResponse(data, depth = 0) {
  return data?.output_text
    || modelTextFromChoices(data?.choices)
    || openAIEventDeltaText(data)
    || modelTextFromValue(data?.output)
    || modelTextFromValue(data?.content)
    || modelTextFromValue(data?.candidates)
    || modelTextFromValue(data?.part)
    || modelTextFromValue(data?.item)
    || modelTextFromValue(data?.message)
    || modelTextFromValue(data?.response)
    || modelTextFromValue(data?.text)
    || modelTextFromValue(data?.refusal)
    || wrappedProviderTextFromResponse("openai", data, depth)
    || "";
}

function anthropicTextFromResponse(data, depth = 0) {
  if (data?.type === "content_block_delta") {
    if (typeof data?.delta?.text === "string") return data.delta.text;
    if (typeof data?.delta?.partial_json === "string") return data.delta.partial_json;
  }
  if (data?.type === "content_block_start") {
    return modelTextFromValue(data?.content_block);
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
  if (type === "response.refusal.delta" && typeof data?.delta === "string") return data.delta;
  if (type === "response.output_text.done" && typeof data?.text === "string") return data.text;
  if (type === "response.refusal.done" && typeof data?.refusal === "string") return data.refusal;
  if (type === "response.content_part.done") return modelTextFromValue(data?.part);
  if (type === "response.output_item.done") return modelTextFromValue(data?.item);
  if (type === "response.completed") return modelTextFromValue(data?.response);
  if (typeof data?.delta?.text === "string") return data.delta.text;
  if (typeof data?.delta?.content === "string") return data.delta.content;
  const deltaText = modelTextFromValue(data?.delta);
  if (deltaText) return deltaText;
  return "";
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
    for (const key of PREFERENCES_MODEL_TEXT_CONTAINER_KEYS) {
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

function renderModelOptions(modelOptions, options = {}) {
  const list = document.getElementById("zms-model-options");
  const select = document.getElementById("zms-model-select");
  const vendorSelect = document.getElementById("zms-model-vendor-select");
  const entries = normalizeModelOptions(modelOptions);
  const translate = (key) => prefFallbackMessage(key, resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale()));
  renderModelVendorFilter(vendorSelect, entries, translate, { reset: options.resetVendor === true });
  const visibleEntries = filterModelOptionsByVendor(entries, selectedModelVendor(vendorSelect));
  clearOptionsElement(list);
  if (select) {
    clearOptionsElement(select);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = providerModelSelectPlaceholderForPreferences(visibleEntries.length ? visibleEntries : entries);
    select.appendChild(placeholder);
  }
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.id;
    if (entry.label && entry.label !== entry.id) {
      option.label = entry.label;
      option.setAttribute?.("label", entry.label);
    }
    option.setAttribute?.("data-source", entry.source || "");
    option.setAttribute?.("data-vendor", entry.vendor || inferredModelVendor(entry) || "");
    option.setAttribute?.("data-features", normalizeModelFeatureList(entry.features).join(" "));
    if (list) list.appendChild(option);
  }
  if (select) {
    appendGroupedModelSelectOptions(
      select,
      visibleEntries,
      translate
    );
  }
  if (select) {
    const custom = document.createElement("option");
    custom.value = "__custom";
    custom.textContent = prefFallbackMessage("modelSelectCustom", resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale()));
    select.appendChild(custom);
    syncModelSelectFromInput(visibleEntries, options);
  }
}

function clearOptionsElement(element) {
  if (!element) return;
  element.textContent = "";
  if (Array.isArray(element.children)) element.children = [];
}

function modelOptionsFromOptionsElement(id) {
  return Array.from(document.getElementById(id)?.children || [])
    .map((option) => ({
      id: String(option.value || "").trim(),
      label: String(option.label || optionAttribute(option, "label") || option.value || "").trim(),
      source: String(optionAttribute(option, "data-source") || option.dataset?.source || "").trim(),
      vendor: String(optionAttribute(option, "data-vendor") || option.dataset?.vendor || "").trim(),
      features: String(optionAttribute(option, "data-features") || option.dataset?.features || "").split(/\s+/).filter(Boolean)
    }))
    .filter((entry) => entry.id);
}

function settingsModelOptionsCacheKey(profile) {
  const provider = providerFromProfile(profile) || document.getElementById("zms-provider")?.value || "";
  const protocol = String(profile?.protocol || "").trim();
  const endpointMode = String(profile?.endpointMode || "base_url").trim();
  const endpoint = endpointMode === "full_url"
    ? String(profile?.fullURL || "").trim()
    : String(profile?.baseURL || "").trim();
  return [provider, protocol, endpointMode, endpoint].map((part) => String(part || "").trim()).join("|");
}

function shouldResetSettingsModelVendorFilter(profile) {
  const select = document.getElementById("zms-model-vendor-select");
  const key = settingsModelOptionsCacheKey(profile);
  const previous = String(select?.dataset?.zmsModelOptionsKey || "");
  if (select?.dataset) select.dataset.zmsModelOptionsKey = key;
  return previous !== key;
}

function optionAttribute(option, name) {
  return option?.getAttribute?.(name)
    || option?.attributes?.[name]
    || option?.[name]
    || "";
}

function renderModelVendorFilter(select, entries, translate = (key) => key, options = {}) {
  if (!select) return [];
  const vendors = modelVendorNames(entries);
  const previous = String(select.value || "");
  clearOptionsElement(select);
  const all = document.createElement("option");
  all.value = "";
  all.textContent = translate("allModelVendors") || "All model vendors";
  select.appendChild(all);
  for (const vendor of vendors) {
    const option = document.createElement("option");
    option.value = vendor;
    option.textContent = modelVendorDisplayLabel(vendor, translate);
    select.appendChild(option);
  }
  select.value = !options.reset && vendors.includes(previous) ? previous : "";
  select.disabled = vendors.length <= 1;
  select.setAttribute?.("aria-label", translate("modelVendorFilter") || "Model vendor");
  select.setAttribute?.("title", translate("modelVendorFilter") || "Model vendor");
  return vendors;
}

function modelVendorNames(entries) {
  const names = [];
  for (const entry of normalizeModelOptions(entries)) {
    const vendor = entry.vendor || inferredModelVendor(entry);
    if (vendor && !names.includes(vendor)) names.push(vendor);
  }
  return names;
}

function selectedModelVendor(select) {
  return String(select?.value || "").trim();
}

function modelVendorDisplayLabel(vendor, translate = (key) => key) {
  if (typeof zmsLocalizedModelVendorLabel === "function") {
    return zmsLocalizedModelVendorLabel(vendor, translate);
  }
  return String(vendor || "");
}

function filterModelOptionsByVendor(entries, vendor) {
  const selected = String(vendor || "").trim();
  const normalized = normalizeModelOptions(entries);
  if (!selected) return normalized;
  return normalized.filter((entry) => (entry.vendor || inferredModelVendor(entry)) === selected);
}

function syncModelSelectFromInput(modelOptions, options = {}) {
  const select = document.getElementById("zms-model-select");
  const model = document.getElementById("zms-model");
  if (!select || !model) return;
  const value = String(model.value || "").trim();
  if (!value) {
    select.value = "";
    setCustomModelInputVisible(model, false);
    return;
  }
  const entries = modelOptions || Array.from(document.getElementById("zms-model-options")?.children || [])
    .map((option) => ({ id: String(option.value || ""), label: String(option.label || option.value || "") }));
  if (entries.some((entry) => entry.id === value)) {
    select.value = value;
    setCustomModelInputVisible(model, false);
    return;
  }
  if (options.selectFirstVisible && entries[0]?.id) {
    model.value = entries[0].id;
    select.value = entries[0].id;
    setCustomModelInputVisible(model, false);
    return;
  }
  select.value = "__custom";
  setCustomModelInputVisible(model, true);
}

function modelValueFromPicker(selectId, inputId) {
  const select = document.getElementById(selectId);
  const input = document.getElementById(inputId);
  const selected = String(select?.value || "").trim();
  if (selected && selected !== "__custom") return selected;
  return String(input?.value || "").trim();
}

function bodyExtraWithModelPickerFeatureHints(bodyExtra, selectId, inputId) {
  const next = { ...(bodyExtra || {}) };
  const picked = modelPickerFeatureHints(selectId, inputId);
  if (picked.model && picked.features.length) {
    next.modelFeatureHints = picked.features;
    next.modelFeatureHintsModel = picked.model;
    next.modelFeatureHintsSource = "model-picker";
    return next;
  }
  if (next.modelFeatureHintsSource === "model-picker") {
    delete next.modelFeatureHints;
    delete next.modelFeatureHintsModel;
    delete next.modelFeatureHintsSource;
  }
  return next;
}

function modelPickerFeatureHints(selectId, inputId) {
  const model = modelValueFromPicker(selectId, inputId);
  const option = modelPickerSelectedOption(selectId, model);
  const features = normalizeModelFeatureList(
    optionAttribute(option, "data-features")
    || option?.dataset?.features
    || ""
  );
  return { model, features };
}

function modelPickerSelectedOption(selectId, model) {
  const select = document.getElementById(selectId);
  const value = String(model || "").trim();
  if (!select || !value) return null;
  return flattenedOptionChildren(select).find((option) => String(option?.value || "").trim() === value) || null;
}

function syncCapabilityCheckboxesFromModelPicker(options = {}) {
  const model = modelValueFromPicker(options.selectId, options.inputId);
  const option = modelPickerSelectedOption(options.selectId, model);
  if (!option) return { imageChanged: false, pdfChanged: false };
  const features = normalizeModelFeatureList(
    optionAttribute(option, "data-features")
    || option?.dataset?.features
    || ""
  );
  const textOnly = typeof zmsModelLikelyTextOnlyForProviderModel === "function"
    && zmsModelLikelyTextOnlyForProviderModel(options.providerId || "", model, option.textContent || option.label || model);
  const hasFeatureHints = features.length > 0 || textOnly;
  if (!hasFeatureHints) return { imageChanged: false, pdfChanged: false };
  const image = document.getElementById(options.imageCheckboxId);
  const pdf = document.getElementById(options.pdfCheckboxId);
  let imageChanged = false;
  let pdfChanged = false;
  if (image) {
    const next = features.includes("image") && !textOnly;
    imageChanged = image.checked !== next;
    image.checked = next;
  }
  if (pdf) {
    const next = String(options.protocol || "") !== "openai_chat" && features.includes("pdf") && !textOnly;
    pdfChanged = pdf.checked !== next;
    pdf.checked = next;
  }
  return { imageChanged, pdfChanged };
}

function flattenedOptionChildren(element) {
  const result = [];
  for (const child of Array.from(element?.children || [])) {
    if (String(child?.localName || "").toLowerCase() === "optgroup" || Array.isArray(child?.children)) {
      result.push(...flattenedOptionChildren(child));
    }
    if (String(child?.value || "").trim()) result.push(child);
  }
  return result;
}

function setCustomModelInputVisible(model, visible) {
  if (!model) return;
  model.hidden = !visible;
  model.setAttribute?.("aria-hidden", visible ? "false" : "true");
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

function recommendedModelOptionsForProfile(profile) {
  const provider = providerFromProfile(profile) || document.getElementById("zms-provider")?.value || "openai_compatible";
  const defaults = providerDefaults(provider);
  const options = [
    ...recommendedModelOptionsForProvider(provider),
    defaults?.model ? { id: defaults.model, label: defaults.model } : null
  ].filter(Boolean);
  return mergeModelOptions(options, []);
}

function recommendedModelOptionsForProvider(provider) {
  return zmsRecommendedModelOptionsForProvider(provider);
}

function providerModelSelectPlaceholderForPreferences(entries) {
  const lang = resolveUiLanguage(document.getElementById("zms-uiLanguage")?.value, runtimeLocale());
  const provider = providerFromProfile(profileDraftFromEditor().profile) || document.getElementById("zms-provider")?.value || "";
  const providerLabel = providerModelSelectProviderLabel(provider, entries, lang);
  return providerModelSelectPlaceholder(providerLabel, lang, (key) => prefFallbackMessage(key, lang));
}

function providerModelSelectPlaceholder(providerLabel, lang, translate = (key) => key) {
  const zh = String(lang || "").toLowerCase().startsWith("zh");
  const label = String(providerLabel || "").trim();
  if (!label) return translate("modelSelectPlaceholder");
  return zh ? `选择 ${label} 推荐模型` : `Choose ${label} model`;
}

function providerModelSelectProviderLabel(provider, entries = [], language = "") {
  const key = String(provider || "").trim();
  if (key && typeof zmsProviderModelCatalogLabel === "function") {
    return zmsProviderModelCatalogLabel(key, language);
  }
  const vendor = normalizeModelOptions(entries)[0]?.vendor || "";
  return modelVendorDisplayLabel(vendor, (messageKey) => prefFallbackMessage(messageKey, language)) || key;
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
  return groupInfo.vendor ? `${modelVendorDisplayLabel(groupInfo.vendor, translate)} · ${suffix}` : suffix;
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
  for (const field of fields) {
    if (applyNestedProviderBodyOmitField(next, field)) continue;
    delete next[field];
  }
  return next;
}

function applyNestedProviderBodyOmitField(body, field) {
  if (field === "instructions") {
    moveInstructionsIntoOpenAIResponsesInput(body);
    return true;
  }
  if (field === "system") {
    moveAnthropicSystemIntoMessages(body);
    return true;
  }
  if (field === "text.format") {
    removeOpenAIResponsesTextField(body, "format");
    return true;
  }
  if (field === "text.verbosity") {
    removeOpenAIResponsesTextField(body, "verbosity");
    return true;
  }
  if (field === "input_file.file_data") {
    switchOpenAIResponsesInputFileField(body, "file_data", "file_url");
    return true;
  }
  if (field === "input_file.file_url") {
    switchOpenAIResponsesInputFileField(body, "file_url", "file_data");
    return true;
  }
  if (field === "image_url.url") {
    switchOpenAIChatImageURLToString(body);
    return true;
  }
  if (field === "messages.content.image_url") {
    removeOpenAIChatImageParts(body);
    return true;
  }
  if (field === "input.content.input_image") {
    removeOpenAIResponsesInputImages(body);
    return true;
  }
  if (field === "messages.role.system") {
    moveOpenAIChatSystemIntoMessages(body);
    return true;
  }
  if (field === "messages.content") {
    switchAnthropicStringMessagesToTextBlocks(body);
    return true;
  }
  if (field === "messages.content.document") {
    removeAnthropicDocumentBlocks(body);
    return true;
  }
  if (field === "messages.content.image") {
    removeAnthropicImageBlocks(body);
    return true;
  }
  return false;
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
  if (
    !providerStructuredUnsupportedFields(body, text, protocol).length
    && !providerUnsupportedCustomBodyFields(body, String(text || "").toLowerCase()).length
  ) {
    return false;
  }
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

const PREFERENCES_PROVIDER_OPTIONAL_BODY_FIELD_PATTERNS = [
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
  return PREFERENCES_PROVIDER_OPTIONAL_BODY_FIELD_PATTERNS
    .filter(([field, pattern]) => body?.[field] !== undefined && (pattern.test(detail) || providerDetailMentionsCanonicalField(detail, field)))
    .map(([field]) => field);
}

function providerUnsupportedCustomBodyFields(body, detail) {
  const text = String(detail || "").toLowerCase();
  if (!providerDetailLooksLikeUnsupportedField(text)) return [];
  return Object.keys(body || {})
    .filter((field) => !PREFERENCES_PROVIDER_REQUIRED_BODY_FIELDS.has(field))
    .filter((field) => !PREFERENCES_PROVIDER_FALLBACK_BODY_FIELDS.has(field))
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
    .filter(Boolean);
  return segments.length ? `body.${segments.join(".")}` : "";
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
  if (PREFERENCES_PROVIDER_FALLBACK_BODY_FIELDS.has(field)) return true;
  return providerFallbackCustomBodyFieldPresent(body, field);
}

function providerFallbackCustomBodyFieldPresent(body, field) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) return false;
  if (PREFERENCES_PROVIDER_REQUIRED_BODY_FIELDS.has(field.toLowerCase())) return false;
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
    if (field === "text.format") {
      removeOpenAIResponsesTextField(next, "format");
      continue;
    }
    if (field === "text.verbosity") {
      removeOpenAIResponsesTextField(next, "verbosity");
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
    if (field === "messages.content.image_url") {
      removeOpenAIChatImageParts(next);
      continue;
    }
    if (field === "input.content.input_image") {
      removeOpenAIResponsesInputImages(next);
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
    if (field === "messages.content.image") {
      removeAnthropicImageBlocks(next);
      continue;
    }
    delete next[field];
  }
  return next;
}

function profileWithProviderConnectionTestFallback(profile, body, fields, usedFallback = []) {
  const normalizedFields = normalizeProviderFallbackFieldList(fields);
  const base = hydrateProfile({
    ...(profile || {}),
    bodyExtra: mergeProviderFallbackBodyExtra(profile?.bodyExtra, body, normalizedFields, usedFallback)
  });
  return profileWithProviderCompatibilityFallback(profile, base, normalizedFields);
}

function profileWithProviderCompatibilityFallback(currentProfile, effectiveProfile, fields) {
  const normalizedFields = normalizeProviderFallbackFieldList(fields);
  const base = hydrateProfile({
    ...(currentProfile || {}),
    ...(effectiveProfile || {}),
    id: effectiveProfile?.id || currentProfile?.id,
    isDefault: currentProfile?.isDefault !== false
  });
  const downgrades = providerCapabilityDowngradesFromFallback(base, normalizedFields);
  if (!Object.keys(downgrades).length) return base;
  return hydrateProfile({
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

function removeOpenAIResponsesTextField(body, field) {
  const text = body.text;
  if (!text || typeof text !== "object" || Array.isArray(text)) return;
  const nextText = { ...text };
  delete nextText[field];
  if (Object.keys(nextText).length) body.text = nextText;
  else delete body.text;
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

function removeOpenAIChatImageParts(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message) => {
    const content = Array.isArray(message?.content) ? message.content : null;
    if (!content) return message;
    return {
      ...message,
      content: content.filter((part) => part?.type !== "image_url")
    };
  });
}

function removeOpenAIResponsesInputImages(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  body.input = input.map((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    return {
      ...item,
      content: content.filter((part) => part?.type !== "input_image")
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

function removeAnthropicImageBlocks(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  body.messages = messages.map((message) => {
    const content = Array.isArray(message?.content) ? message.content : null;
    if (!content) return message;
    return {
      ...message,
      content: content.filter((part) => part?.type !== "image")
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
  return withDefaultProviderModel(provider, providerDefaultsRaw(provider));
}

function providerDefaultsRaw(provider) {
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
  if (id === "vercel_ai_chat" || id === "vercel-ai-chat" || id === "vercel_ai_gateway" || id === "vercel-ai-gateway") {
    return {
      id: "vercel-ai-chat",
      name: "Vercel AI Gateway Chat",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "vercel_ai_responses" || id === "vercel-ai-responses") {
    return {
      id: "vercel-ai-responses",
      name: "Vercel AI Gateway Responses",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      bodyExtra: {}
    };
  }
  if (id === "vercel_ai_anthropic" || id === "vercel-ai-anthropic") {
    return {
      id: "vercel-ai-anthropic",
      name: "Vercel AI Gateway Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://ai-gateway.vercel.sh",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    };
  }
  if (id === "cline_api" || id === "cline-api") {
    return {
      id: "cline-api",
      name: "Cline API",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cline.bot/api/v1",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "litellm_proxy_chat" || id === "litellm-proxy-chat") {
    return {
      id: "litellm-proxy-chat",
      name: "LiteLLM Proxy Chat",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "http://localhost:4000",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "litellm_proxy_responses" || id === "litellm-proxy-responses") {
    return {
      id: "litellm-proxy-responses",
      name: "LiteLLM Proxy Responses",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "http://localhost:4000",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      bodyExtra: {}
    };
  }
  if (id === "litellm_proxy_anthropic" || id === "litellm-proxy-anthropic") {
    return {
      id: "litellm-proxy-anthropic",
      name: "LiteLLM Proxy Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "http://localhost:4000",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: true },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
    };
  }
  if (id === "cloudflare_ai_chat" || id === "cloudflare-ai-chat" || id === "cloudflare_workers_ai" || id === "cloudflare-workers-ai") {
    return {
      id: "cloudflare-ai-chat",
      name: "Cloudflare AI OpenAI Chat",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false, modelList: false },
      bodyExtra: {}
    };
  }
  if (id === "cloudflare_ai_responses" || id === "cloudflare-ai-responses") {
    return {
      id: "cloudflare-ai-responses",
      name: "Cloudflare AI Responses",
      protocol: "openai_responses",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false, modelList: false },
      bodyExtra: {}
    };
  }
  if (id === "cloudflare_ai_anthropic" || id === "cloudflare-ai-anthropic") {
    return {
      id: "cloudflare-ai-anthropic",
      name: "Cloudflare AI Anthropic",
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
      fullURL: "",
      model: "",
      capabilities: { ...commonCapabilities, pdfBase64: false, modelList: false },
      bodyExtra: { authHeader: "authorization", anthropicDirectBrowserAccess: false }
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
  if (id === "huggingface" || id === "hugging_face" || id === "hf") {
    return {
      id: "huggingface",
      name: "Hugging Face",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.huggingface.co/v1",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: false },
      bodyExtra: {}
    };
  }
  if (id === "deepinfra" || id === "deep_infra") {
    return {
      id: "deepinfra",
      name: "DeepInfra",
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://api.deepinfra.com/v1/openai",
      fullURL: "",
      model: "",
      capabilities: { ...imageCapabilities, pdfBase64: false },
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
    model: "",
    capabilities: { ...commonCapabilities, pdfBase64: false },
    bodyExtra: { extra_body: { reasoning_split: true } }
  };
}

function withDefaultProviderModel(provider, defaults) {
  const current = String(defaults?.model || "").trim();
  if (current) return defaults;
  const model = recommendedDefaultModelForProvider(provider, defaults);
  return model ? { ...defaults, model } : defaults;
}

function recommendedDefaultModelForProvider(provider, defaults = {}) {
  const key = String(defaults?.id || provider || "").replace(/-/g, "_");
  if (key === "azure_openai" || key === "local_agents") return "";
  return recommendedModelOptionsForProvider(key)[0]?.id || "";
}

function defaultProviderProfiles() {
  return ["minimax", "openai", "openai_compatible", "openai_responses_compatible", "anthropic", "anthropic_compatible", "gemini", "azure_openai", "vercel_ai_chat", "vercel_ai_responses", "vercel_ai_anthropic", "cline_api", "litellm_proxy_chat", "litellm_proxy_responses", "litellm_proxy_anthropic", "cloudflare_ai_chat", "cloudflare_ai_responses", "cloudflare_ai_anthropic", "github_models", "huggingface", "deepinfra", "fireworks", "cerebras", "nvidia_nim", "sambanova", "sambanova_responses", "sambanova_anthropic", "xai", "groq", "mistral", "together", "kimi", "perplexity", "deepseek", "deepseek_anthropic", "zai_anthropic", "openrouter", "dashscope", "siliconflow", "zhipu", "volcengine", "qianfan", "hunyuan", "ollama", "lm_studio", "local_agents"].map((provider, index) => {
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
    "vercel-ai-chat",
    "vercel_ai_chat",
    "vercel-ai-gateway",
    "vercel_ai_gateway",
    "vercel-ai-responses",
    "vercel_ai_responses",
    "vercel-ai-anthropic",
    "vercel_ai_anthropic",
    "cline-api",
    "cline_api",
    "litellm-proxy-chat",
    "litellm_proxy_chat",
    "litellm-proxy-responses",
    "litellm_proxy_responses",
    "litellm-proxy-anthropic",
    "litellm_proxy_anthropic",
    "cloudflare-ai-chat",
    "cloudflare_ai_chat",
    "cloudflare-workers-ai",
    "cloudflare_workers_ai",
    "cloudflare-ai-responses",
    "cloudflare_ai_responses",
    "cloudflare-ai-anthropic",
    "cloudflare_ai_anthropic",
    "github-models",
    "github_models",
    "huggingface",
    "hugging_face",
    "hf",
    "deepinfra",
    "deep_infra",
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
    "https://ai-gateway.vercel.sh",
    "https://ai-gateway.vercel.sh/v1",
    "https://api.cline.bot/api/v1",
    "http://localhost:4000",
    "http://localhost:4000/v1",
    "http://127.0.0.1:4000",
    "http://127.0.0.1:4000/v1",
    "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
    "https://models.github.ai/inference",
    "https://router.huggingface.co/v1",
    "https://api.deepinfra.com/v1/openai",
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
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (["MiniMax-M2.7", "deepseek-v4-flash", "deepseek-v4-pro", "deepseek/deepseek-v4-flash"].includes(normalized)) return true;
  return allRecommendedProviderModelIds().has(normalized);
}

function allRecommendedProviderModelIds() {
  const providerKeys = [
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
  return new Set(providerKeys.flatMap((provider) => recommendedModelOptionsForProvider(provider).map((entry) => entry.id)));
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

function localAgentTimeoutSecondsForEditor(localAgent) {
  const timeoutMs = toFinitePositiveInt(localAgent?.timeoutMs, localAgent?.timeout_ms);
  if (timeoutMs) return Math.max(1, Math.ceil(timeoutMs / 1000));
  const timeoutSeconds = toFinitePositiveInt(localAgent?.timeoutSeconds, localAgent?.timeoutSec, localAgent?.timeout_seconds);
  if (timeoutSeconds) return timeoutSeconds;
  const timeout = toFinitePositiveInt(localAgent?.timeout);
  if (!timeout) return null;
  return timeout <= 1200 ? timeout : Math.max(1, Math.ceil(timeout / 1000));
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

function readProfilesFromEditor() {
  try {
    const parsed = JSON.parse(document.getElementById("zms-profilesJson")?.value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function replaceActiveProfile(profiles, profile) {
  const nextProfile = hydrateProfile({ ...(profile || {}), isDefault: true });
  const updated = (Array.isArray(profiles) ? profiles : [])
    .filter((item) => item?.id !== nextProfile.id)
    .map((item) => ({ ...item, isDefault: false }));
  updated.unshift(nextProfile);
  return updated;
}

function storedProfileForProviderPreset(provider, profiles) {
  const providerId = String(provider || "").trim();
  const defaults = providerDefaults(providerId);
  const defaultId = normalizeProfileId(defaults.id);
  const providerValue = providerFromProfile(defaults);
  return (profiles || []).find((profile) => {
    const profileId = normalizeProfileId(profile?.id);
    return profileId === defaultId || providerFromProfile(profile) === providerValue;
  }) || null;
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
  if (id === "github-models" || id === "github_models") return "github_models";
  if (id === "huggingface" || id === "hugging_face" || id === "hf") return "huggingface";
  if (id === "deepinfra" || id === "deep_infra") return "deepinfra";
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
    model: String(source.model || (shouldUseDefaultProviderModelForProfile(source, defaults) ? defaults.model : "") || "").trim(),
    capabilities: normalizeProviderCapabilities(source.capabilities, defaults.capabilities || {}),
    customHeaders: normalizeObjectStringMap(source.customHeaders) || normalizeObjectStringMap(defaults.customHeaders) || {},
    bodyExtra: normalizeObjectStringMap(source.bodyExtra) || normalizeObjectStringMap(defaults.bodyExtra) || {},
    isDefault: source.isDefault === true
  };
}

function shouldUseDefaultProviderModelForProfile(source, defaults) {
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
    return `${common}\n\n请结构化解析论文中的截图、图表、表格或实验结果。优先结合图片附件、PDF/摘要上下文和用户问题；若没有图片附件，则只从文本上下文中抽取。输出 Markdown，至少包含：对象类型、可读内容、表格/数据重建、密集点位数据草稿、像素/坐标数据草稿、坐标轴校准锚点、结论解释、可复用信息、不确定性。不要编造看不清的数字；所有来自文本上下文的判断标注 [chunk:<id>] 或 [metadata]，来自图片观察的判断标注 [image]。密集点位表只列能直接观察、读数或明确估计的点，不要插值补全。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n論文中のスクリーンショット、図、表、実験結果を構造化して解析してください。画像添付、PDF/要約コンテキスト、ユーザー質問を優先して使い、画像がない場合はテキスト根拠だけで抽出してください。読めない数値は推測せず、テキスト根拠は [chunk:<id>] または [metadata]、画像観察は [image] と明記してください。読める場合は、Series、Point、Axis X、Axis Y、Unit、Confidence、Source、Notes を持つ密集ポイント表も出力してください。`;
  }
  return `${common}\n\nExtract structured information from screenshots, figures, tables, formulas, or experimental-result panels. Prefer attached images plus the provided paper/PDF context and the user question; if no image is attached, extract only from the text context. Include object type, readable content, reconstructed data, dense point data drafts, pixel/coordinate drafts, axis calibration anchors, interpretation, reusable review/experiment notes, and uncertainty. Do not invent unreadable numbers. Mark text-grounded claims with [chunk:<id>] or [metadata], and visual observations with [image]. Dense point tables must include only directly visible, read, or explicitly estimated points, not interpolated values.`;
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
