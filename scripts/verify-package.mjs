import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const xpiPath = "build/literature-review-with-llm.xpi";

if (!existsSync(xpiPath)) {
  fail(`Missing package: ${xpiPath}`);
}

if (!existsSync("scripts/local-agent-http-bridge.mjs")) {
  fail("Missing local agent HTTP bridge script");
}

if (!existsSync("scripts/local-agent-bridge-service.mjs")) {
  fail("Missing local agent bridge service script");
}

if (!existsSync("scripts/verify-installed-zotero.mjs")) {
  fail("Missing installed Zotero package verifier");
}

if (!existsSync("scripts/verify-zotero-runtime.mjs")) {
  fail("Missing Zotero runtime verifier");
}

if (!existsSync("scripts/verify-provider-smoke.mjs")) {
  fail("Missing provider smoke verifier");
}

if (!existsSync("scripts/verify-provider-live.mjs")) {
  fail("Missing provider live verifier");
}

if (!existsSync("scripts/verify-writeback-smoke.mjs")) {
  fail("Missing writeback smoke verifier");
}

if (!existsSync("scripts/project-readiness-check.mjs")) {
  fail("Missing project readiness checker");
}

const packageJson = readFileSync("package.json", "utf8");
const localAgentMcpSource = readFileSync("scripts/local-agent-mcp.mjs", "utf8");
const localAgentBridgeServiceSource = readFileSync("scripts/local-agent-bridge-service.mjs", "utf8");
const providerAdaptersSource = readFileSync("src/providerAdapters.ts", "utf8");
const providerSmokeSource = readFileSync("scripts/verify-provider-smoke.mjs", "utf8");
if (!packageJson.includes("local-agent:service:install")) {
  fail("Missing local agent service npm scripts");
}

if (!packageJson.includes("local-agent:service:check")) {
  fail("Missing local agent service check script");
}

if (!packageJson.includes("local-agent:service:doctor")) {
  fail("Missing local agent service doctor script");
}

if (!packageJson.includes("verify:installed")) {
  fail("Missing installed verification npm script");
}

if (!packageJson.includes("verify:zotero-runtime")) {
  fail("Missing Zotero runtime verification npm script");
}

if (!packageJson.includes("verify:provider")) {
  fail("Missing provider smoke verification npm script");
}

if (!packageJson.includes("verify:provider:mock")) {
  fail("Missing provider mock smoke verification npm script");
}

if (!packageJson.includes("verify:provider:catalog")) {
  fail("Missing provider catalog shape verification npm script");
}

if (!packageJson.includes("verify:provider:models")) {
  fail("Missing provider model-list verification npm script");
}

if (!packageJson.includes("verify:provider:models:mock")) {
  fail("Missing provider model-list mock verification npm script");
}

if (!packageJson.includes("verify:provider:live")) {
  fail("Missing provider live verification npm script");
}

if (!packageJson.includes("verify:provider:models:live")) {
  fail("Missing provider live model-list verification npm script");
}

if (!packageJson.includes("verify:writeback")) {
  fail("Missing writeback smoke verification npm script");
}

if (!packageJson.includes("verify:zip")) {
  fail("Missing package zip verification npm script");
}

if (!packageJson.includes("build:update-manifest")) {
  fail("Missing update manifest build npm script");
}

if (!packageJson.includes("verify:update-manifest")) {
  fail("Missing update manifest verification npm script");
}

if (!packageJson.includes("readiness:check")) {
  fail("Missing project readiness npm script");
}

execFileSync("unzip", ["-t", xpiPath], { stdio: "pipe" });

const entries = execFileSync("unzip", ["-Z1", xpiPath], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const entrySet = new Set(entries);

const requiredEntries = [
  "bootstrap.js",
  "manifest.json",
  "prefs.js",
  "content/auto-update.js",
  "content/bootstrap-provider.js",
  "content/bootstrap-settings.js",
  "content/bootstrap-summary-store.js",
  "content/bootstrap-zotero-item.js",
  "content/bootstrap-ui.js",
  "content/candidate-sources.js",
  "content/markdown-render.js",
  "content/logo.svg",
  "content/messages.js",
  "content/preferences.xhtml",
  "content/preferences.js",
  "content/preferences.css",
  "content/workbench.xhtml",
  "content/workbench.js",
  "content/workbench.css",
  "content/reader.xhtml",
  "content/reader.js",
  "content/reader.css",
  "locale/zh-CN/zotero-markdown-summary.ftl",
  "locale/en-US/zotero-markdown-summary.ftl"
];

for (const entry of requiredEntries) {
  if (!entrySet.has(entry)) fail(`Package missing ${entry}`);
}

const bootstrap = unzipText("bootstrap.js");
const autoUpdateJs = unzipText("content/auto-update.js");
const bootstrapProvider = unzipText("content/bootstrap-provider.js");
const bootstrapSettings = unzipText("content/bootstrap-settings.js");
const bootstrapSummaryStore = unzipText("content/bootstrap-summary-store.js");
const bootstrapZoteroItem = unzipText("content/bootstrap-zotero-item.js");
const bootstrapUi = unzipText("content/bootstrap-ui.js");
const candidateSourcesJs = unzipText("content/candidate-sources.js");
const markdownRenderJs = unzipText("content/markdown-render.js");
const prefs = unzipText("prefs.js");
const preferencesXhtml = unzipText("content/preferences.xhtml");
const preferencesJs = unzipText("content/preferences.js");
const workbenchXhtml = unzipText("content/workbench.xhtml");
const workbenchJs = unzipText("content/workbench.js");
const workbenchCss = unzipText("content/workbench.css");
const readerXhtml = unzipText("content/reader.xhtml");
const readerJs = unzipText("content/reader.js");
const messagesJs = unzipText("content/messages.js");
const manifestJson = unzipText("manifest.json");
const packageMeta = JSON.parse(packageJson);
const manifest = JSON.parse(manifestJson);

assertXmlTagBalance(preferencesXhtml, "content/preferences.xhtml");
assertXmlTagBalance(workbenchXhtml, "content/workbench.xhtml");
assertXmlTagBalance(readerXhtml, "content/reader.xhtml");

if (manifest.name !== "Literature Review with LLM") {
  fail(`Unexpected manifest name: ${manifest.name}`);
}

if (manifest.version !== packageMeta.version) {
  fail(`Manifest version ${manifest.version} does not match package version ${packageMeta.version}`);
}

if (manifest.applications?.zotero?.id !== "zotero-markdown-summary@diantao.local") {
  fail("Manifest missing stable Zotero addon id");
}

if (manifest.applications?.zotero?.update_url !== "https://github.com/KaguraTart/literature-review-with-LLM/releases/latest/download/update.json") {
  fail("Manifest missing Zotero update URL");
}

if (!manifest.applications?.zotero?.strict_min_version || !manifest.applications?.zotero?.strict_max_version) {
  fail("Manifest missing Zotero compatibility bounds");
}

const requiredMarkers = [
  [bootstrap, "zotero-markdown-summary-toolbar-button", "toolbar entry"],
  [bootstrap, "zotero-markdown-summary-sidenav-button", "right side entry"],
  [bootstrap, "runSelfCheckForContext", "runtime self check entry"],
  [bootstrap, "selfCheck", "localized self check menu"],
  [bootstrap, "selfCheckLocalAgentEndpoint", "local agent self check status"],
  [bootstrap, "checkLocalAgentBridge", "local agent bridge probe"],
  [bootstrap, "writeBatchRunReport", "per-run batch report writer"],
  [bootstrap, "writeCollectionWorkspace", "collection workspace writer"],
  [bootstrap, "writeCrossCollectionSynthesisIndex", "cross-collection synthesis index writer"],
  [bootstrap, "cross-collection-synthesis", "cross-collection synthesis path"],
  [bootstrap, "crossCollectionGapEntries", "cross-collection gap board entries"],
  [bootstrap, "Cross-Collection Gap Board", "cross-collection gap board heading"],
  [bootstrap, "crossCollectionThemeMergeEntries", "cross-collection theme merge review entries"],
  [bootstrap, "Theme Merge Review Board", "cross-collection theme merge review heading"],
  [bootstrap, "renderCrossCollectionReviewPack", "cross-collection review writing pack"],
  [bootstrap, "Cross-Collection Review Pack", "cross-collection review writing pack heading"],
  [bootstrap, "collectionWorkspaceArtifactPaths", "localized collection artifact paths"],
  [bootstrap, "renderMethodMatrix", "collection method matrix writer"],
  [bootstrap, "renderResearchQuestionCards", "collection research question cards writer"],
  [bootstrap, "renderResearchGapMatrix", "collection research gap matrix writer"],
  [bootstrap, "renderTopicClusters", "collection topic clusters writer"],
  [bootstrap, "renderSynthesisClaimsMatrix", "collection synthesis claims writer"],
  [bootstrap, "renderSynthesisConflictLedger", "collection synthesis conflict ledger writer"],
  [bootstrap, "renderSynthesisRoadmap", "collection synthesis roadmap writer"],
  [bootstrap, "roadmapFinalReportCalibrationEntries", "collection final report calibration helper"],
  [bootstrap, "Final Report Calibration Matrix", "collection final report calibration heading"],
  [bootstrap, "最终报告校准矩阵", "localized collection final report calibration heading"],
  [bootstrap, "renderIdeaList", "collection idea list writer"],
  [bootstrap, "renderFormalReviewReport", "collection formal review report writer"],
  [bootstrap, "renderFormalReportWritingReadinessGate", "collection formal review writing readiness gate"],
  [bootstrap, "formalReportWritingReadinessSummary", "collection formal review readiness scoring"],
  [bootstrap, "Writing Readiness Gate", "collection formal review readiness heading"],
  [bootstrap, "Formal report readiness score", "collection formal review readiness score label"],
  [bootstrap, "renderCollectionSynthesisWritingPack", "collection synthesis writing pack"],
  [bootstrap, "Synthesis Writing Pack", "collection synthesis writing pack heading"],
  [bootstrap, "formal-review-report", "collection formal review report path"],
  [bootstrap, "synthesis-claims", "collection synthesis claims path"],
  [bootstrap, "synthesis-conflicts", "collection synthesis conflict ledger path"],
  [bootstrap, "synthesis-roadmap", "collection synthesis roadmap path"],
  [bootstrap, "topicClusterEntries", "collection topic clustering helper"],
  [bootstrap, "synthesisClaimEntries", "collection synthesis claims helper"],
  [bootstrap, "synthesisConflictEntries", "collection synthesis conflict helper"],
  [bootstrap, "synthesisRoadmapEntries", "collection synthesis roadmap helper"],
  [bootstrap, "loadBatchSummaryInsights", "collection summary insight loader"],
  [bootstrap, "extractSummaryInsights", "collection summary insight extractor"],
  [bootstrap, "collectionTemplateLabels", "localized collection templates"],
  [bootstrap, "providerErrorText", "provider error formatter in bootstrap"],
  [bootstrap, "loadBootstrapProviderModule", "bootstrap provider module loader"],
  [bootstrap, "loadBootstrapSettingsModule", "bootstrap settings module loader"],
  [bootstrap, "loadBootstrapSummaryStoreModule", "bootstrap summary-store module loader"],
  [bootstrap, "loadBootstrapZoteroItemModule", "bootstrap Zotero item module loader"],
  [bootstrap, "loadBootstrapUiModule", "bootstrap UI module loader"],
  [bootstrap, "readProviderStream", "provider stream reader in bootstrap"],
  [bootstrap, "parseProviderStreamLine", "provider stream tail parser in bootstrap"],
  [bootstrap, "!parsed.snapshot || !text", "OpenAI Responses stream snapshot dedupe in bootstrap"],
  [bootstrap, "withOpenAIChatBodyDefaults", "OpenAI Chat stream usage defaults in bootstrap"],
  [bootstrap, "endpointForProtocol(protocol, baseURL)", "versioned provider endpoint routing in bootstrap"],
  [bootstrap, "summaryPromptsForSettings", "localized direct summary prompts in bootstrap"],
  [bootstrap, "promptPackInstructionBlock", "prompt pack direct summary instructions in bootstrap"],
  [bootstrap, "defaultSummaryUserPrompt", "localized direct paper summary template in bootstrap"],
  [bootstrap, "typeof ZMS_I18N === \"undefined\"", "safe bootstrap message loading"],
  [bootstrap, "loadSharedMessages", "shared message loader"],
  [bootstrap, "applyConfiguredAddonAutoUpdatePolicy", "add-on auto update preference sync"],
  [autoUpdateJs, "applyBackgroundUpdates", "add-on background update policy setter"],
  [autoUpdateJs, "AddonManager.sys.mjs", "modern add-on manager import"],
  [workbenchXhtml, "auto-update.js", "workbench auto update policy helper"],
  [workbenchXhtml, "zms-workbench-auto-update-input", "workbench automatic update opt-out toggle"],
  [localAgentMcpSource, "ocrAutoRepair", "local PDF OCR auto-repair option"],
  [localAgentMcpSource, "ocrRepairPsms", "local PDF OCR PSM repair option"],
  [localAgentMcpSource, "ocrPreprocessRepair", "local PDF OCR preprocessing repair option"],
  [localAgentMcpSource, "ocrPreprocessModes", "local PDF OCR preprocessing mode option"],
  [localAgentMcpSource, "pdfOcrRepairPsmModes", "local PDF OCR PSM repair parser"],
  [localAgentMcpSource, "pdfOcrPreprocessRepairEnabled", "local PDF OCR preprocessing repair parser"],
  [localAgentMcpSource, "pdfOcrPreprocessRepairModes", "local PDF OCR preprocessing mode parser"],
  [localAgentMcpSource, "\"-mono\"", "local PDF OCR monochrome preprocessing render"],
  [localAgentMcpSource, "repairPdfOcrPage", "local PDF OCR failed page repair"],
  [localAgentMcpSource, "ocr_auto_repair_used", "local PDF OCR repair warning"],
  [localAgentMcpSource, "ocr_psm_repair_used", "local PDF OCR PSM repair warning"],
  [localAgentMcpSource, "ocr_preprocess_repair_used", "local PDF OCR preprocessing repair warning"],
  [bootstrapProvider, "setHeaderIfMissing(headers", "custom auth header preservation in bootstrap provider"],
  [bootstrapProvider, "extractAnthropicStreamText", "Anthropic stream parser in bootstrap provider"],
  [bootstrapProvider, "isNonAnswerStreamEvent", "bootstrap provider stream non-answer event guard"],
  [bootstrapProvider, "isProviderStreamSnapshot", "OpenAI Responses snapshot detector in bootstrap provider"],
  [bootstrapProvider, "extractOpenAIEventContainer", "OpenAI Responses event container parser in bootstrap provider"],
  [bootstrapProvider, "streamErrorText", "provider stream error parser in bootstrap provider"],
  [bootstrapProvider, "Provider error:", "provider JSON error parser in bootstrap provider"],
  [bootstrapProvider, "openaiResponsesInputForSummary", "structured OpenAI Responses input in bootstrap provider"],
  [bootstrapProvider, "openAIChatSummaryMessages", "structured OpenAI Chat image input in bootstrap provider"],
  [bootstrapProvider, "requestInputImages", "shared bootstrap image attachment helper"],
  [bootstrapProvider, "jsonModeBodyDefaults", "protocol-specific JSON mode defaults in bootstrap provider"],
  [bootstrapProvider, "openAIChatTokenLimit", "OpenAI Chat token limit field selection in bootstrap provider"],
  [bootstrapProvider, "openAIChatOptionalDefaults", "OpenAI Chat optional reasoning defaults in bootstrap provider"],
  [bootstrapProvider, "providerCompatibilityFallbackFields", "OpenAI Chat compatibility fallback fields in bootstrap provider"],
  [bootstrapProvider, "openAIChatStreamOptions", "OpenAI Chat stream usage options in bootstrap provider"],
  [bootstrapProvider, "openAICompatibleBaseWithVersion", "OpenAI-compatible versioned base URL helper in bootstrap provider"],
  [bootstrapProvider, "usesVersionlessOpenAICompatibleBase", "versionless OpenAI-compatible base URL helper in bootstrap provider"],
  [bootstrapProvider, "hasExplicitAuthHeader", "explicit auth header preservation in bootstrap provider"],
  [bootstrapProvider, "anthropicAuthHeaderName", "Anthropic-compatible auth header selection in bootstrap provider"],
  [bootstrapProvider, "shouldAddAnthropicDirectBrowserAccess", "Anthropic direct browser access opt-in in bootstrap provider"],
  [bootstrapSettings, "getSettings", "bootstrap settings reader"],
  [bootstrapSettings, "settingsHasUsableAuth", "custom auth readiness for batch generation"],
  [bootstrapSettings, "settingsProviderDefaults", "provider defaults in bootstrap settings"],
  [bootstrapSettings, "azure_openai", "Azure OpenAI provider detection in bootstrap settings"],
  [bootstrapSettings, "vercel_ai_chat", "Vercel AI Gateway Chat provider detection in bootstrap settings"],
  [bootstrapSettings, "vercel_ai_responses", "Vercel AI Gateway Responses provider detection in bootstrap settings"],
  [bootstrapSettings, "vercel_ai_anthropic", "Vercel AI Gateway Anthropic provider detection in bootstrap settings"],
  [bootstrapSettings, "gemini", "Gemini provider detection in bootstrap settings"],
  [bootstrapSettings, "ask-gemini-claude", "local-agent default skill fallback in bootstrap settings"],
  [bootstrapSettings, "activeProfile", "active profile reader in bootstrap settings"],
  [bootstrapSettings, "promptPackId", "prompt pack setting in bootstrap settings"],
  [bootstrapSummaryStore, "writeSummaryMarkdown", "summary markdown writer in bootstrap summary-store"],
  [bootstrapSummaryStore, "writeTextAtomic", "atomic text writer in bootstrap summary-store"],
  [bootstrapSummaryStore, "backupSummaryPath", "backup path builder in bootstrap summary-store"],
  [bootstrapSummaryStore, "pathExists", "path existence helper in bootstrap summary-store"],
  [bootstrapSummaryStore, "countMarkdownFiles", "skill markdown counter in bootstrap summary-store"],
  [bootstrapZoteroItem, "findPdfAttachment", "PDF attachment resolver in bootstrap Zotero item"],
  [bootstrapZoteroItem, "findExistingSummaryAttachment", "summary attachment resolver in bootstrap Zotero item"],
  [bootstrapZoteroItem, "linkOrUpdateAttachment", "summary attachment linker in bootstrap Zotero item"],
  [bootstrapZoteroItem, "currentListRegularItems", "current list item resolver in bootstrap Zotero item"],
  [bootstrapZoteroItem, "collectionContextFromItem", "collection context builder in bootstrap Zotero item"],
  [bootstrapZoteroItem, "indexedTextLength", "indexed text counter in bootstrap Zotero item"],
  [bootstrapUi, "registerToolbarButton", "toolbar button registrar in bootstrap UI"],
  [bootstrapUi, "registerSidenavButton", "right side button registrar in bootstrap UI"],
  [bootstrapUi, "removeFallbackWorkbenchButton", "stale floating fallback cleanup in bootstrap UI"],
  [bootstrapUi, "data-zms-discoverable", "discoverable labeled toolbar entry in bootstrap UI"],
  [bootstrapUi, "openEmbeddedWorkbench", "embedded workbench opener in bootstrap UI"],
  [bootstrapUi, "openEmbeddedReader", "embedded reader opener in bootstrap UI"],
  [bootstrapUi, "ensureEmbeddedWorkbenchPanel", "embedded panel builder in bootstrap UI"],
  [bootstrapUi, "showProgress", "progress notification in bootstrap UI"],
  [preferencesXhtml, "zms-profileProtocol", "profile protocol editor"],
  [preferencesXhtml, "zms-profileEndpointMode", "profile endpoint mode editor"],
  [preferencesXhtml, "zms-profileCustomHeaders", "custom header editor"],
  [preferencesXhtml, "zms-profileBodyExtra", "body extra editor"],
  [preferencesXhtml, "zms-promptPackId", "prompt pack setting editor"],
  [preferencesXhtml, "zms-load-models-button", "model list loader button"],
  [preferencesXhtml, "zms-choose-outputDir-button", "output directory folder picker button"],
  [preferencesXhtml, "value=\"local_agents\"", "local agents provider preset"],
  [preferencesXhtml, "value=\"gemini\"", "Gemini provider preset"],
  [preferencesXhtml, "value=\"azure_openai\"", "Azure OpenAI provider preset"],
  [preferencesXhtml, "value=\"vercel_ai_chat\"", "Vercel AI Gateway Chat provider preset"],
  [preferencesXhtml, "value=\"vercel_ai_responses\"", "Vercel AI Gateway Responses provider preset"],
  [preferencesXhtml, "value=\"vercel_ai_anthropic\"", "Vercel AI Gateway Anthropic provider preset"],
  [preferencesXhtml, "value=\"litellm_proxy_chat\"", "LiteLLM Proxy Chat provider preset"],
  [preferencesXhtml, "value=\"litellm_proxy_responses\"", "LiteLLM Proxy Responses provider preset"],
  [preferencesXhtml, "value=\"litellm_proxy_anthropic\"", "LiteLLM Proxy Anthropic provider preset"],
  [preferencesXhtml, "value=\"cloudflare_ai_chat\"", "Cloudflare AI OpenAI Chat provider preset"],
  [preferencesXhtml, "value=\"cloudflare_ai_responses\"", "Cloudflare AI Responses provider preset"],
  [preferencesXhtml, "value=\"cloudflare_ai_anthropic\"", "Cloudflare AI Anthropic provider preset"],
  [preferencesXhtml, "value=\"github_models\"", "GitHub Models provider preset"],
  [preferencesXhtml, "value=\"huggingface\"", "Hugging Face provider preset"],
  [preferencesXhtml, "value=\"deepinfra\"", "DeepInfra provider preset"],
  [preferencesXhtml, "value=\"fireworks\"", "Fireworks AI provider preset"],
  [preferencesXhtml, "value=\"cerebras\"", "Cerebras provider preset"],
  [preferencesXhtml, "value=\"nvidia_nim\"", "NVIDIA NIM provider preset"],
  [preferencesXhtml, "value=\"sambanova\"", "SambaNova provider preset"],
  [preferencesXhtml, "value=\"sambanova_responses\"", "SambaNova Responses provider preset"],
  [preferencesXhtml, "value=\"sambanova_anthropic\"", "SambaNova Anthropic provider preset"],
  [preferencesXhtml, "value=\"xai\"", "xAI provider preset"],
  [preferencesXhtml, "value=\"groq\"", "Groq provider preset"],
  [preferencesXhtml, "value=\"mistral\"", "Mistral provider preset"],
  [preferencesXhtml, "value=\"together\"", "Together AI provider preset"],
  [preferencesXhtml, "value=\"kimi\"", "Kimi provider preset"],
  [preferencesXhtml, "value=\"perplexity\"", "Perplexity provider preset"],
  [preferencesXhtml, "value=\"deepseek\"", "DeepSeek provider preset"],
  [preferencesXhtml, "value=\"deepseek_anthropic\"", "DeepSeek Anthropic provider preset"],
  [preferencesXhtml, "value=\"zai_anthropic\"", "Z.AI Anthropic provider preset"],
  [preferencesXhtml, "value=\"openrouter\"", "OpenRouter provider preset"],
  [preferencesXhtml, "value=\"dashscope\"", "DashScope provider preset"],
  [preferencesXhtml, "value=\"siliconflow\"", "SiliconFlow provider preset"],
  [preferencesXhtml, "value=\"zhipu\"", "Zhipu provider preset"],
  [preferencesXhtml, "value=\"volcengine\"", "Volcengine provider preset"],
  [preferencesXhtml, "value=\"qianfan\"", "Qianfan provider preset"],
  [preferencesXhtml, "value=\"hunyuan\"", "Hunyuan provider preset"],
  [preferencesXhtml, "value=\"ollama\"", "Ollama provider preset"],
  [preferencesXhtml, "value=\"lm_studio\"", "LM Studio provider preset"],
  [preferencesXhtml, "value=\"figure-table-extractor\"", "figure/table extraction skill preset"],
  [preferencesXhtml, "value=\"literature-matrix-builder\"", "literature matrix skill preset"],
  [preferencesXhtml, "value=\"literature-review-synthesis\"", "literature review synthesis skill preset"],
  [preferencesXhtml, "value=\"ask-gemini-claude\"", "Gemini and Claude skill preset"],
  [preferencesXhtml, "zms-reset-profiles-button", "default profiles reset button"],
  [preferencesXhtml, "zms-providerGuide", "settings provider setup guide"],
  [preferencesXhtml, "zms-profileStatus", "settings profile status summary"],
  [workbenchXhtml, "zms-write-summary", "write preview summary panel"],
  [workbenchXhtml, "zms-profile-status", "workbench profile status panel"],
  [workbenchXhtml, "zms-prompt-pack", "workbench prompt pack selector"],
  [preferencesJs, "saveProfileFromEditor", "profile save action"],
  [preferencesJs, "loadProfileEditor", "profile load action"],
  [preferencesJs, "refreshProfileStatus", "settings profile status refresh"],
  [preferencesJs, "profileStatusText", "settings profile status formatter"],
  [preferencesXhtml, "zms-doctor-button", "settings provider doctor button"],
  [preferencesJs, "checkProviderConfig", "settings provider doctor action"],
  [preferencesJs, "providerConfigDoctor", "settings provider no-network doctor"],
  [preferencesJs, "providerSetupGuide", "settings provider setup guide formatter"],
  [preferencesJs, "providerLiveVerifyGuide", "settings provider live verification command guide"],
  [preferencesJs, "doctorCommand", "settings provider doctor command guide"],
  [preferencesJs, "providerCapabilityOverrideCommands", "settings provider capability override live-check guide"],
  [preferencesJs, "CAPABILITIES_JSON", "settings provider capability override env var"],
  [preferencesJs, "chooseOutputDir", "output directory folder picker action"],
  [preferencesJs, "modeGetFolder", "native folder picker mode"],
  [preferencesJs, "MINIMAX_API_KEY", "MiniMax named live-check command"],
  [preferencesJs, "GEMINI_API_KEY", "Gemini named live-check command"],
  [preferencesJs, "AZURE_OPENAI_API_KEY", "Azure OpenAI named live-check command"],
  [preferencesJs, "CLOUDFLARE_API_KEY", "Cloudflare AI OpenAI Chat named live-check command"],
  [preferencesJs, "CLOUDFLARE_RESPONSES_API_KEY", "Cloudflare AI Responses named live-check command"],
  [preferencesJs, "CLOUDFLARE_ANTHROPIC_API_KEY", "Cloudflare AI Anthropic named live-check command"],
  [preferencesJs, "GITHUB_MODELS_API_KEY", "GitHub Models named live-check command"],
  [preferencesJs, "HUGGINGFACE_API_KEY", "Hugging Face named live-check command"],
  [preferencesJs, "DEEPINFRA_API_KEY", "DeepInfra named live-check command"],
  [preferencesJs, "SAMBANOVA_ANTHROPIC_API_KEY", "SambaNova Anthropic named live-check command"],
  [preferencesJs, "DEEPSEEK_API_KEY", "DeepSeek named live-check command"],
  [preferencesJs, "OPENROUTER_API_KEY", "OpenRouter named live-check command"],
  [preferencesJs, "GROQ_API_KEY", "Groq named live-check command"],
  [preferencesJs, "providerGuideEnvValue", "settings provider guide env formatting"],
  [preferencesJs, "deleteProfileFromEditor", "profile delete action"],
  [preferencesJs, "resetProfilesToDefaults", "default profiles reset action"],
  [preferencesJs, "mergeDefaultProviderProfiles", "default profile migration in settings"],
  [preferencesJs, "providerFromProfile", "local agents profile provider detection"],
  [preferencesJs, "providerBodyExtra", "provider body extra filtering in settings"],
  [preferencesJs, "openAIChatTokenLimit", "OpenAI Chat token limit field selection in settings"],
  [preferencesJs, "openAIChatOptionalDefaults", "OpenAI Chat optional reasoning defaults in settings"],
  [preferencesJs, "openAIChatStreamOptions", "OpenAI Chat stream usage options in settings"],
  [preferencesJs, "anthropicAuthHeaderName", "Anthropic-compatible auth header selection in settings"],
  [preferencesJs, "shouldAddAnthropicDirectBrowserAccess", "Anthropic direct browser access opt-in in settings"],
  [preferencesJs, "connectionTestRequestForProfile", "edited profile connection test"],
  [messagesJs, "chooseOutputDir", "localized output directory folder picker label"],
  [preferencesJs, "providerTextFromStreamText", "settings provider stream response parser"],
  [preferencesJs, "providerErrorText", "settings provider error formatter"],
  [preferencesJs, "localAgentConnectionTestRequestForProfile", "local agent settings connection test"],
  [preferencesJs, "profileHasUsableAuth", "custom auth settings readiness"],
  [preferencesJs, "modelListRequestForProfile", "provider model list request"],
  [preferencesJs, "modelIdsFromResponse", "provider model list parser"],
  [preferencesJs, "fetchModelOptions", "provider model list pagination loader"],
  [preferencesJs, "providerRequestHeadersWithFallback", "settings model list header fallback"],
  [preferencesJs, "MODEL_LIST_MAX_PAGES", "bounded provider model list pagination"],
  [preferencesJs, "normalizeProfileId", "safe profile id normalization"],
  [preferencesJs, "jsonModeBodyDefaults", "settings JSON mode request defaults"],
  [preferencesJs, "hasExplicitAuthHeader", "settings explicit auth header preservation"],
  [preferencesJs, "openAICompatibleBaseWithVersion", "settings OpenAI-compatible versioned base URL helper"],
  [preferencesJs, "refreshSkillMenu", "settings skill menu refresh"],
  [preferencesJs, "availableSkillTemplateIds", "settings custom skill discovery"],
  [messagesJs, "modelMissing", "missing model validation message"],
  [messagesJs, "providerGuide", "provider setup guide label message"],
  [messagesJs, "modelListLoaded", "model list status message"],
  [messagesJs, "batchReport", "batch report status message"],
  [messagesJs, "zmsResolveUiLanguage", "shared UI language resolver"],
  [messagesJs, "inputTextMode", "text input status message"],
  [messagesJs, "inputPdfBase64", "PDF input status message"],
  [messagesJs, "inputFallbackUnsupported", "PDF input fallback status message"],
  [messagesJs, "inputFallbackNoPdf", "missing PDF fallback status message"],
  [messagesJs, "inputFallbackNoPath", "missing PDF path fallback status message"],
  [messagesJs, "inputFallbackReadFailed", "PDF read fallback status message"],
  [messagesJs, "candidateSearchDone", "candidate search status message"],
  [messagesJs, "candidateCitationNetworkDone", "citation-network status message"],
  [messagesJs, "citationPolicy", "citation-network policy label message"],
  [messagesJs, "citationPolicyBroad", "citation-network broad policy message"],
  [messagesJs, "candidateReviewDone", "candidate review export status message"],
  [messagesJs, "candidateReviewNotePlaceholder", "candidate review note placeholder"],
  [messagesJs, "comparisonReportDone", "comparison report export status message"],
  [messagesJs, "readingLogDone", "paper reading log export status message"],
  [messagesJs, "reviewDraftDone", "review draft export status message"],
  [messagesJs, "proposalNoteDone", "proposal note export status message"],
  [messagesJs, "journalOutlineDone", "journal/report outline export status message"],
  [messagesJs, "candidateImportDone", "candidate import status message"],
  [messagesJs, "candidatePdfDone", "candidate PDF attachment status message"],
  [messagesJs, "candidateDedupeDone", "candidate duplicate reconciliation status message"],
  [messagesJs, "candidateScreeningStageFullTextScreened", "candidate full-text screening stage message"],
  [messagesJs, "candidateExclusionReasonWeakEvidence", "candidate exclusion reason message"],
  [messagesJs, "profilesReset", "profile reset status message"],
  [messagesJs, "copyAnswer", "answer copy button message"],
  [messagesJs, "localOcrRunning", "local OCR running status message"],
  [messagesJs, "ocrReview", "OCR review heading message"],
  [messagesJs, "ocrCorrected", "OCR corrected status message"],
  [messagesJs, "quickSettings", "simplified settings heading message"],
  [markdownRenderJs, "ZMSMarkdownRenderer", "shared Markdown renderer runtime"],
  [markdownRenderJs, "zms-math-display", "display math rendering"],
  [markdownRenderJs, "zms-math-inline", "inline math rendering"],
  [markdownRenderJs, "zms-tex-frac", "fraction math rendering"],
  [markdownRenderJs, "zmsAppendTex", "lightweight TeX rendering"],
  [candidateSourcesJs, "searchCandidateSources", "candidate source search runtime"],
  [candidateSourcesJs, "expandCandidateCitationNetwork", "candidate citation-network runtime"],
  [candidateSourcesJs, "maxHops", "bounded multi-hop citation-network option"],
  [candidateSourcesJs, "maxNetworkRequests", "citation-network request cap"],
  [candidateSourcesJs, "nextCitationFrontier", "citation-network next-hop frontier"],
  [candidateSourcesJs, "networkHop", "citation-network hop metadata"],
  [candidateSourcesJs, "parseSemanticScholarCitationNetworkResponse", "Semantic Scholar citation-network parser"],
  [candidateSourcesJs, "parseArxivAtom", "candidate arXiv parser"],
  [candidateSourcesJs, "mergeCandidateRecords", "candidate JSONL merge helper"],
  [candidateSourcesJs, "sortCandidateRecords", "candidate priority sorting helper"],
  [candidateSourcesJs, "candidatePriority", "candidate explainable priority scorer"],
  [workbenchXhtml, "candidate-sources.js", "candidate source runtime script"],
  [workbenchXhtml, "markdown-render.js", "workbench shared Markdown renderer script"],
  [workbenchXhtml, "zms-settings-toggle", "workbench settings drawer button"],
  [workbenchXhtml, "zms-settings-toggle", "single settings button"],
  [workbenchXhtml, "zms-composer-toolbar", "p2-style composer toolbar"],
  [workbenchXhtml, "zms-composer-profile", "composer model pill"],
  [workbenchXhtml, "zms-skill", "settings skill selector"],
  [workbenchXhtml, "zms-local-ocr-input", "optional local OCR checkbox"],
  [workbenchXhtml, "zms-local-ocr-endpoint", "optional local OCR endpoint input"],
  [workbenchXhtml, "zms-local-ocr-language", "optional local OCR language input"],
  [workbenchXhtml, "zms-send-button", "composer circular send button"],
  [workbenchXhtml, "zms-quick-settings-heading", "simplified settings primary section"],
  [workbenchXhtml, "zms-settings-details", "collapsible advanced settings sections"],
  [workbenchXhtml, "zms-search-candidates", "candidate search button"],
  [workbenchXhtml, "zms-export-comparison-report", "comparison report export button"],
  [workbenchXhtml, "zms-start-cross-review", "workbench cross-paper review button"],
  [workbenchXhtml, "zms-export-reading-log", "paper reading log export button"],
  [workbenchXhtml, "zms-export-visual-report", "figure/table extraction report export button"],
  [workbenchXhtml, "zms-load-visual-review", "figure/table review state load button"],
  [workbenchXhtml, "zms-save-visual-review", "figure/table review state save button"],
  [workbenchXhtml, "zms-export-review-draft", "review draft export button"],
  [workbenchXhtml, "zms-export-proposal-note", "proposal note export button"],
  [workbenchXhtml, "zms-export-journal-outline", "journal/report outline export button"],
  [workbenchXhtml, "zms-expand-citation-network", "candidate citation-network button"],
  [workbenchXhtml, "zms-citation-policy", "candidate citation-network policy selector"],
  [workbenchXhtml, "zms-citation-direction", "candidate citation-network direction selector"],
  [workbenchXhtml, "zms-citation-hops", "candidate citation-network hop control"],
  [workbenchXhtml, "zms-citation-max-requests", "candidate citation-network request cap control"],
  [workbenchXhtml, "zms-apply-candidate-recommendations", "candidate recommendation application button"],
  [workbenchXhtml, "zms-export-candidate-review", "candidate review export button"],
  [workbenchXhtml, "zms-import-candidates", "candidate import button"],
  [workbenchXhtml, "zms-attach-candidate-pdfs", "candidate PDF attachment button"],
  [workbenchXhtml, "zms-reconcile-candidate-duplicates", "candidate duplicate reconciliation button"],
  [workbenchJs, "requestModelWithRetry", "chat request retry"],
  [workbenchJs, "renderMessageContent", "streaming Markdown message rendering"],
  [workbenchJs, "profileCompactLabel", "compact model profile label"],
  [workbenchJs, "zms-message-copy", "prominent answer copy control"],
  [workbenchJs, "copyText(answerTextForMessage", "answer copy excludes folded reasoning"],
  [workbenchJs, "copySelectedWorkbenchText", "native selected answer copy helper"],
  [workbenchJs, "selectedWorkbenchText", "message selection text extraction"],
  [workbenchJs, "saveProfileSettings", "workbench provider settings persistence"],
  [workbenchJs, "localOcrForImage", "workbench optional local OCR request"],
  [workbenchJs, "syncLocalOcrPreference", "workbench local OCR preference persistence"],
  [workbenchJs, "localOcrLanguage", "workbench local OCR language setting"],
  [workbenchJs, "appendUserImageReview", "workbench user image OCR review controls"],
  [workbenchJs, "userImageOcrSummary", "workbench user image OCR status summary"],
  [workbenchCss, "zms-composer-toolbar", "composer toolbar styles"],
  [workbenchCss, "zms-send-button", "circular send button styles"],
  [workbenchCss, "zms-user-image-review", "user image OCR review styles"],
  [workbenchCss, "zms-candidate-review-controls", "candidate review control layout"],
  [workbenchCss, "-moz-user-select: text", "copyable message text selection"],
  [workbenchJs, "providerErrorText", "provider error formatter in workbench"],
  [workbenchJs, "writeTextAtomic", "atomic markdown write"],
  [workbenchJs, "writePreviewSummary", "write preview safety summary"],
  [workbenchJs, "requestInputStatusText", "request input status display"],
  [workbenchJs, "profileStatusText", "workbench profile status display"],
  [workbenchJs, "mergeDefaultProviderProfiles", "default profile migration in workbench"],
  [workbenchJs, "stableChunkId", "hash-stable context chunk ids"],
  [workbenchJs, "chunkEvidenceLabel", "context evidence labels"],
  [workbenchJs, "exportComparisonReport", "workbench comparison report export action"],
  [workbenchJs, "startCrossPaperReview", "workbench cross-paper review action"],
  [workbenchJs, "crossReviewPromptWithScope", "workbench scoped cross-paper review prompt"],
  [workbenchJs, "renderComparisonReportMarkdown", "comparison report Markdown renderer"],
  [workbenchJs, "comparisonReportMarkdownPath", "comparison report Markdown path"],
  [workbenchJs, "templateVersion: literature-matrix-v1", "comparison report template version"],
  [workbenchJs, "synthesisVersion: evidence-synthesis-v1", "comparison report synthesis version"],
  [workbenchJs, "comparisonSynthesisRows", "comparison evidence coverage synthesis"],
  [workbenchJs, "comparisonPairwiseContrastRows", "comparison pairwise contrast synthesis"],
  [workbenchJs, "comparisonGapLedgerRows", "comparison gap ledger synthesis"],
  [messagesJs, "crossReviewNeedsSelection", "cross-paper review empty selection status message"],
  [workbenchJs, "exportReadingLog", "workbench paper reading log export action"],
  [workbenchJs, "renderReadingLogMarkdown", "paper reading log Markdown renderer"],
  [workbenchJs, "readingLogMarkdownPath", "paper reading log Markdown path"],
  [workbenchJs, "templateVersion: paper-reading-log-v1", "paper reading log template version"],
  [workbenchJs, "exportReviewDraft", "workbench review draft export action"],
  [workbenchJs, "renderReviewDraftMarkdown", "review draft Markdown renderer"],
  [workbenchJs, "reviewDraftMarkdownPath", "review draft Markdown path"],
  [workbenchJs, "templateVersion: formal-review-draft-v1", "review draft template version"],
  [workbenchJs, "exportProposalNote", "workbench proposal note export action"],
  [workbenchJs, "renderProposalNoteMarkdown", "proposal note Markdown renderer"],
  [workbenchJs, "proposalNoteMarkdownPath", "proposal note Markdown path"],
  [workbenchJs, "templateVersion: proposal-note-v3", "proposal note template version"],
  [workbenchJs, "proposalDomainChecklist", "proposal domain writing checklist"],
  [workbenchJs, "proposalDisciplineWritingExamples", "proposal discipline writing examples"],
  [workbenchJs, "exportJournalOutline", "workbench journal/report outline export action"],
  [workbenchJs, "renderJournalOutlineMarkdown", "journal/report outline Markdown renderer"],
  [workbenchJs, "journalOutlineMarkdownPath", "journal/report outline Markdown path"],
  [workbenchJs, "templateVersion: journal-outline-v5", "journal/report outline template version"],
  [workbenchJs, "journalDomainChecklist", "journal/report domain writing checklist"],
  [workbenchJs, "journalDisciplineWritingExamples", "journal/report discipline writing examples"],
  [workbenchJs, "journalVenueReviewerCriteria", "journal/report venue reviewer criteria"],
  [workbenchJs, "journalLongManuscriptParagraphExamples", "journal/report longer paragraph examples"],
  [workbenchJs, "journalVenueAcceptanceExamples", "journal/report acceptance examples"],
  [workbenchJs, "journalFullSectionDraftExamples", "journal/report full section drafts"],
  [workbenchJs, "Domain Writing Format", "domain writing format heading"],
  [workbenchJs, "Venue-Specific Reviewer Criteria", "venue reviewer criteria heading"],
  [workbenchJs, "Venue-Specific Acceptance Examples", "venue acceptance examples heading"],
  [workbenchJs, "Discipline-Style Writing Examples", "discipline writing examples heading"],
  [workbenchJs, "Longer Manuscript Paragraph Examples", "longer paragraph examples heading"],
  [workbenchJs, "Full-Section Manuscript Drafts", "full section drafts heading"],
  [workbenchJs, "existingPath && (!IOUtils.exists", "stale summary attachment path guard"],
  [workbenchJs, "readPdfAnnotations", "annotation context"],
  [workbenchJs, "availableSkillIds", "local skill discovery"],
  [workbenchJs, "figureTableTemplate", "workbench figure/table extraction skill template"],
  [workbenchJs, "Visual OCR Text", "figure/table extraction visual OCR section"],
  [workbenchJs, "Reconstructed Data Table", "figure/table extraction table reconstruction section"],
  [workbenchJs, "renderVisualExtractionReportMarkdown", "figure/table extraction report renderer"],
  [workbenchJs, "visual-extraction-report-v2", "figure/table extraction report template version"],
  [workbenchJs, "renderVisualExtractionReportCsv", "figure/table extraction CSV sidecar renderer"],
  [workbenchJs, "loadVisualReviewState", "figure/table review-state editor loader"],
  [workbenchJs, "saveVisualReviewState", "figure/table review-state editor save action"],
  [workbenchJs, "visualReviewActionUpdateMapFromDom", "figure/table review-state DOM reader"],
  [workbenchJs, "applyVisualReviewActionUpdates", "figure/table review-state persistence helper"],
  [workbenchJs, "visualExtractionChartDataDrafts", "figure/table extraction chart data draft helper"],
  [workbenchJs, "chartDataDraftCount", "figure/table extraction chart data draft metadata"],
  [workbenchJs, "visualExtractionChartQualityReview", "figure/table extraction chart quality review helper"],
  [workbenchJs, "chartQualityStatus", "figure/table extraction chart quality status metadata"],
  [workbenchJs, "Chart Data Quality Review", "figure/table extraction chart quality review section"],
  [workbenchJs, "Chart Data Drafts", "figure/table extraction chart data draft section"],
  [workbenchJs, "visualExtractionPanelSplitCandidates", "figure/table extraction panel split candidate helper"],
  [workbenchJs, "chartPanelSplitCandidateCount", "figure/table extraction panel split candidate metadata"],
  [workbenchJs, "panelSplitValidationStatus", "figure/table extraction panel split validation metadata"],
  [workbenchJs, "visualExtractionPanelSplitGeometryHints", "figure/table extraction gutter-aware panel split hints"],
  [workbenchJs, "geometryStatus", "figure/table extraction panel split geometry metadata"],
  [workbenchJs, "columnGutter", "figure/table extraction panel split gutter metadata"],
  [workbenchJs, "panel-split-validation", "figure/table extraction panel split validation quality check"],
  [workbenchJs, "validate-panel-split-candidates", "figure/table extraction panel split validation review action"],
  [workbenchJs, "Automatic Panel Split Candidates", "figure/table extraction panel split candidate section"],
  [workbenchJs, "layout-split:", "figure/table extraction panel split structured rows"],
  [workbenchJs, "chartAxisSegmentCalibrationMapCount", "figure/table extraction broken-axis calibration map metadata"],
  [workbenchJs, "Broken-Axis Calibration Map", "figure/table extraction broken-axis calibration map section"],
  [workbenchJs, "calibrationConfidence", "figure/table extraction broken-axis calibration confidence export"],
  [workbenchJs, "calibrationRisk", "figure/table extraction broken-axis calibration risk export"],
  [workbenchJs, "pixelGapToNextSegment", "figure/table extraction broken-axis pixel gap export"],
  [workbenchJs, "valueGapToNextSegment", "figure/table extraction broken-axis value gap export"],
  [workbenchJs, "gapStatusToNextSegment", "figure/table extraction broken-axis gap status export"],
  [workbenchJs, "gapRiskToNextSegment", "figure/table extraction broken-axis gap risk export"],
  [workbenchJs, "visualExtractionPixelDataDrafts", "figure/table extraction pixel data draft helper"],
  [workbenchJs, "pixelDataDraftCount", "figure/table extraction pixel data draft metadata"],
  [workbenchJs, "Pixel / Coordinate Data Draft", "figure/table extraction pixel coordinate prompt section"],
  [workbenchJs, "Pixel / Coordinate Data Drafts", "figure/table extraction pixel data draft section"],
  [workbenchJs, "latestVisualExtractionExchange", "latest visual extraction answer selector"],
  [workbenchJs, "defaultImageQuestion", "image-only default prompt"],
  [workbenchJs, "literatureMatrixTemplate", "workbench literature matrix skill template"],
  [workbenchJs, "literatureReviewSynthesisTemplate", "workbench literature review synthesis skill template"],
  [workbenchJs, "promptTextForRequest", "workbench prompt pack request composition"],
  [workbenchJs, "promptPackInstructionBlock", "workbench prompt pack instructions"],
  [workbenchJs, "providerBodyExtra", "provider body extra filtering in workbench"],
  [workbenchJs, "providerCompatibilityFallback", "workbench provider optional-field fallback"],
  [workbenchJs, "openAIChatTokenLimit", "OpenAI Chat token limit field selection in workbench"],
  [workbenchJs, "openAIChatOptionalDefaults", "OpenAI Chat optional reasoning defaults in workbench"],
  [workbenchJs, "openAIChatStreamOptions", "OpenAI Chat stream usage options in workbench"],
  [workbenchJs, "shouldAddAnthropicDirectBrowserAccess", "Anthropic direct browser access opt-in in workbench"],
  [workbenchJs, "normalizeSkillId", "safe custom skill ids"],
  [workbenchJs, "sessionIdFromPath", "loaded session id restoration"],
  [workbenchJs, "sessionScopeKey", "parent-scoped session key"],
  [workbenchJs, "sessionFilesForItem", "merged parent and legacy session listing"],
  [workbenchJs, "compareSessionPath", "session timestamp ordering"],
  [workbenchJs, "recentSessionFiles", "session history listing"],
  [workbenchJs, "localAgentConfig", "local agent profile routing"],
  [workbenchJs, "localAgentRequestCwd", "local agent safe working directory routing"],
  [workbenchJs, "localAgent.method", "local agent custom method passthrough"],
  [workbenchJs, "shouldStream(profile", "runtime stream setting"],
  [workbenchJs, "profileHasUsableAuth", "custom auth workbench readiness"],
  [workbenchXhtml, "zms-export-provider-diagnostics", "provider diagnostics export button"],
  [workbenchJs, "renderProviderDiagnosticsMarkdown", "provider diagnostics report renderer"],
  [workbenchJs, "provider-diagnostics-v1", "provider diagnostics report template version"],
  [workbenchJs, "providerLiveVerifyGuideForWorkbench", "provider diagnostics live-check command builder"],
  [workbenchJs, ".env.local Configuration Doctor", "provider diagnostics doctor command section"],
  [workbenchJs, "providerCapabilityOverrideCommandsForWorkbench", "provider diagnostics capability override live-check builder"],
  [workbenchJs, "Capability Override Check", "provider diagnostics capability override section"],
  [workbenchJs, "providerRequestPreviews", "provider diagnostics request preview builder"],
  [workbenchJs, "sanitizeProviderRequestPreview", "provider diagnostics request preview redaction"],
  [workbenchJs, "openaiResponsesInput", "structured OpenAI Responses input in workbench"],
  [workbenchJs, "jsonModeBodyDefaults", "workbench JSON mode request defaults"],
  [workbenchJs, "hasExplicitAuthHeader", "workbench explicit auth header preservation"],
  [workbenchJs, "openAICompatibleBaseWithVersion", "workbench OpenAI-compatible versioned base URL helper"],
  [workbenchJs, "mergeConsecutiveAnthropicMessages", "Anthropic consecutive role normalization"],
  [workbenchJs, "streamErrorText", "workbench provider stream error parser"],
  [workbenchJs, "Provider error:", "workbench provider JSON error parser"],
  [workbenchJs, "streamTextFromData", "workbench stream tail parser"],
  [workbenchJs, "isNonAnswerStreamEvent", "workbench stream non-answer event guard"],
  [workbenchJs, "providerUsageFromResponse", "workbench provider usage extractor"],
  [workbenchJs, "response.zmsUsage", "workbench stream usage capture"],
  [workbenchJs, "message?.usage", "workbench session usage metadata export"],
  [workbenchJs, "modelTextFromStreamContainer", "OpenAI Responses stream container parser in workbench"],
  [workbenchJs, "!parsed.snapshot || !text", "OpenAI Responses stream snapshot dedupe in workbench"],
  [providerAdaptersSource, "extractProviderUsage", "provider adapter usage extractor"],
  [providerAdaptersSource, "parseStreamUsage", "provider stream usage extractor"],
  [providerAdaptersSource, "openAIChatStreamOptions", "provider adapter OpenAI Chat stream usage options"],
  [providerAdaptersSource, "openAIChatOptionalDefaults", "provider adapter OpenAI Chat optional reasoning defaults"],
  [providerAdaptersSource, "isNonAnswerStreamEvent", "provider adapter stream non-answer event guard"],
  [providerAdaptersSource, "providerCompatibilityFallbackFields", "provider adapter OpenAI Chat compatibility fallback fields"],
  [providerSmokeSource, "streamUsageFromBody", "provider smoke stream usage report"],
  [providerSmokeSource, "omitProviderRequestBodyFields", "provider smoke OpenAI Chat compatibility fallback"],
  [providerSmokeSource, "providerRequestHeadersWithFallback", "provider smoke Anthropic-compatible header fallback"],
  [workbenchJs, "searchCandidates", "workbench candidate search action"],
  [workbenchJs, "expandCandidateCitationNetwork", "workbench citation-network action"],
  [workbenchJs, "citationNetworkOptionsFromDom", "workbench configurable citation-network options"],
  [workbenchJs, "citationNetworkPolicyDefaults", "workbench citation-network policy presets"],
  [workbenchJs, "applyCitationNetworkPolicyToDom", "workbench citation-network preset application"],
  [workbenchJs, "citationNetworkSeedsForWorkbench", "workbench citation-network seed selector"],
  [workbenchJs, "exportCandidateReview", "workbench candidate review export action"],
  [workbenchJs, "renderCandidateReviewMarkdown", "candidate review Markdown renderer"],
  [workbenchJs, "candidateReviewScreeningBoard", "candidate review screening board renderer"],
  [workbenchJs, "candidateReviewScreeningRows", "candidate review screening board rows"],
  [workbenchJs, "Screening Board", "candidate review screening board heading"],
  [workbenchJs, "candidateReviewEvidenceChainQueue", "candidate evidence-chain queue renderer"],
  [workbenchJs, "candidateReviewEvidenceRows", "candidate evidence-chain rows"],
  [workbenchJs, "Evidence-chain Follow-up", "candidate evidence-chain report heading"],
  [workbenchJs, "candidateReviewSourceEvidenceSnippets", "candidate source evidence snippet renderer"],
  [workbenchJs, "candidateReviewSourceEvidenceRows", "candidate source evidence rows"],
  [workbenchJs, "Source Evidence Snippets", "candidate source evidence report heading"],
  [workbenchJs, "enrichCandidatesWithFullTextEvidence", "candidate Zotero full-text evidence enrichment"],
  [workbenchJs, "candidateFullTextEvidenceSnippets", "candidate full-text evidence extraction"],
  [workbenchJs, "candidateFullTextEvidenceDisplayText", "candidate full-text evidence context display"],
  [workbenchJs, "candidatePdfEvidenceSource", "candidate PDF page-text source selection"],
  [workbenchJs, "candidatePdfTextPagesFromLocalBridge", "candidate local bridge PDF page extraction"],
  [workbenchJs, "candidatePdfTextPagesFromRawBytes", "candidate no-bridge raw PDF byte text fallback"],
  [workbenchJs, "raw_pdf_byte_text_fallback", "candidate raw PDF byte quality warning"],
  [workbenchJs, "pdfExtractionQuality", "candidate PDF extraction quality persistence"],
  [workbenchJs, "candidatePdfExtractionQualitySummary", "candidate PDF extraction quality summary"],
  [workbenchJs, "PDF extraction quality", "candidate PDF extraction quality report row"],
  [workbenchJs, "candidatePdfBridgeArguments", "candidate local bridge PDF argument selection"],
[workbenchJs, "attachmentPdfBase64", "candidate/local raw PDF base64 fallback"],
  [workbenchJs, "indexedTextForEvidence", "candidate indexed-text page splitting"],
  [workbenchJs, "normalizePdfTextPagesForEvidence", "candidate page-level PDF text normalization"],
  [workbenchJs, "indexedPageMarker", "candidate indexed-text page marker parsing"],
  [workbenchJs, "cleanIndexedPageText", "candidate indexed-text page noise cleanup"],
  [workbenchJs, "repeatedIndexedPageEdgeLines", "candidate repeated page header/footer cleanup"],
  [workbenchJs, "dehyphenateIndexedText", "candidate indexed-text dehyphenation"],
  [workbenchJs, "candidatePdfAnnotationForHit", "candidate PDF annotation page matching"],
  [workbenchJs, "annotationPageLabel", "candidate annotation page-label evidence"],
  [workbenchJs, "fullTextEvidenceUpdatedAt", "candidate full-text evidence timestamp"],
  [workbenchJs, "sourceEvidenceLocator", "candidate source evidence locator column"],
  [workbenchJs, "indexed-text:", "candidate indexed-text evidence locator"],
  [workbenchJs, "pdf-page-text:", "candidate page-level PDF text evidence locator"],
  [workbenchJs, "page-label:", "candidate annotation page-label locator"],
  [workbenchJs, "page-span:", "candidate indexed-text page-span locator"],
  [workbenchJs, "sourceHash", "candidate source evidence snippet hash"],
  [workbenchJs, "candidateReviewMarkdownPath", "candidate review Markdown path"],
  [workbenchJs, "candidateReviewUpdateMapFromDom", "workbench candidate review note collection"],
  [workbenchJs, "candidateScreeningStageLabel", "candidate screening stage UI labels"],
  [workbenchJs, "candidateExclusionReasonLabel", "candidate exclusion reason UI labels"],
  [workbenchJs, "review_screening", "candidate screening ledger action"],
  [workbenchJs, "candidateRecommendationUpdates", "workbench candidate recommendation update helper"],
  [workbenchJs, "candidateReviewNote", "workbench candidate review note persistence"],
  [workbenchJs, "review_note", "candidate review-note ledger action"],
  [workbenchJs, "importIncludedCandidates", "workbench candidate import action"],
  [workbenchJs, "importCandidateIntoZotero", "workbench Zotero candidate import helper"],
  [workbenchJs, "importableCandidateRecords", "workbench candidate import filter"],
  [workbenchJs, "normalizedCandidateTitle", "workbench candidate title dedupe fallback"],
  [workbenchJs, "attachCandidatePdfs", "workbench candidate PDF attachment action"],
  [workbenchJs, "attachCandidatePdfToZotero", "workbench Zotero candidate PDF attachment helper"],
  [workbenchJs, "pdfAttachableCandidateRecords", "workbench candidate PDF attachment filter"],
  [workbenchJs, "reconcileCandidateDuplicates", "workbench candidate duplicate reconciliation action"],
  [workbenchJs, "reconcileCandidateDuplicateRecords", "workbench candidate duplicate reconciliation helper"],
  [workbenchJs, "candidatePriorityMetaText", "workbench candidate priority metadata"],
  [workbenchJs, "citationNetworkMetaText", "workbench citation-network metadata"],
  [workbenchJs, "candidateSearchOptionsFromDom", "workbench candidate search form reader"],
  [workbenchJs, "importLedgerJsonlPath", "workbench import ledger path"],
  [workbenchJs, "appendImportLedgerEntries", "workbench import ledger append"],
  [readerJs, "backToWorkbench", "reader back action"],
  [readerJs, "copyMarkdown", "reader markdown copy"],
  [prefs, '"id":"openai"', "default OpenAI profile"],
  [prefs, '"protocol":"openai_responses"', "OpenAI Responses protocol"],
  [prefs, '"id":"openai-compatible"', "default OpenAI-compatible chat profile"],
  [prefs, '"id":"openai-responses-compatible"', "default OpenAI-compatible Responses profile"],
  [prefs, '"baseURL":"https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1"', "OpenAI-compatible Responses base URL template"],
  [prefs, '"id":"anthropic"', "default Anthropic profile"],
  [prefs, '"id":"anthropic-compatible"', "default Anthropic-compatible messages profile"],
  [prefs, '"baseURL":"https://YOUR-ANTHROPIC-COMPATIBLE-ENDPOINT"', "Anthropic-compatible base URL template"],
  [prefs, '"protocol":"anthropic_messages"', "Anthropic Messages protocol"],
  [prefs, '"id":"gemini"', "default Gemini OpenAI-compatible profile"],
  [prefs, '"baseURL":"https://generativelanguage.googleapis.com/v1beta/openai"', "Gemini OpenAI-compatible base URL"],
  [prefs, '"id":"azure-openai"', "default Azure OpenAI profile"],
  [prefs, '"baseURL":"https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1"', "Azure OpenAI v1 base URL template"],
  [prefs, '"id":"vercel-ai-chat"', "default Vercel AI Gateway Chat profile"],
  [prefs, '"id":"vercel-ai-responses"', "default Vercel AI Gateway Responses profile"],
  [prefs, '"id":"vercel-ai-anthropic"', "default Vercel AI Gateway Anthropic profile"],
  [prefs, '"id":"cline-api"', "default Cline API profile"],
  [prefs, '"baseURL":"https://ai-gateway.vercel.sh/v1"', "Vercel AI Gateway OpenAI-compatible base URL"],
  [prefs, '"baseURL":"https://ai-gateway.vercel.sh"', "Vercel AI Gateway Anthropic base URL"],
  [prefs, '"baseURL":"https://api.cline.bot/api/v1"', "Cline API OpenAI-compatible base URL"],
  [prefs, '"id":"cloudflare-ai-chat"', "default Cloudflare AI OpenAI Chat profile"],
  [prefs, '"id":"cloudflare-ai-responses"', "default Cloudflare AI Responses profile"],
  [prefs, '"id":"cloudflare-ai-anthropic"', "default Cloudflare AI Anthropic profile"],
  [prefs, '"baseURL":"https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1"', "Cloudflare AI OpenAI-compatible base URL template"],
  [prefs, '"id":"xai"', "default xAI profile"],
  [prefs, '"baseURL":"https://api.x.ai/v1"', "xAI OpenAI-compatible base URL"],
  [prefs, '"id":"groq"', "default Groq profile"],
  [prefs, '"baseURL":"https://api.groq.com/openai/v1"', "Groq OpenAI-compatible base URL"],
  [prefs, '"id":"mistral"', "default Mistral profile"],
  [prefs, '"baseURL":"https://api.mistral.ai/v1"', "Mistral OpenAI-compatible base URL"],
  [prefs, '"id":"together"', "default Together AI profile"],
  [prefs, '"baseURL":"https://api.together.ai/v1"', "Together AI OpenAI-compatible base URL"],
  [prefs, '"id":"kimi"', "default Kimi profile"],
  [prefs, '"baseURL":"https://api.moonshot.ai/v1"', "Kimi OpenAI-compatible base URL"],
  [prefs, '"id":"perplexity"', "default Perplexity profile"],
  [prefs, '"baseURL":"https://api.perplexity.ai"', "Perplexity OpenAI-compatible base URL"],
  [prefs, '"id":"deepseek"', "default DeepSeek profile"],
  [prefs, '"baseURL":"https://api.deepseek.com"', "DeepSeek OpenAI-compatible base URL"],
  [prefs, '"id":"deepseek-anthropic"', "default DeepSeek Anthropic-compatible profile"],
  [prefs, '"baseURL":"https://api.deepseek.com/anthropic"', "DeepSeek Anthropic-compatible base URL"],
  [prefs, '"id":"zai-anthropic"', "default Z.AI Anthropic-compatible profile"],
  [prefs, '"baseURL":"https://api.z.ai/api/anthropic"', "Z.AI Anthropic-compatible base URL"],
  [prefs, '"id":"github-models"', "default GitHub Models profile"],
  [prefs, '"baseURL":"https://models.github.ai/inference"', "GitHub Models OpenAI-compatible base URL"],
  [prefs, '"id":"huggingface"', "default Hugging Face profile"],
  [prefs, '"baseURL":"https://router.huggingface.co/v1"', "Hugging Face OpenAI-compatible base URL"],
  [prefs, '"id":"deepinfra"', "default DeepInfra profile"],
  [prefs, '"baseURL":"https://api.deepinfra.com/v1/openai"', "DeepInfra OpenAI-compatible base URL"],
  [prefs, '"id":"fireworks"', "default Fireworks AI profile"],
  [prefs, '"baseURL":"https://api.fireworks.ai/inference/v1"', "Fireworks AI OpenAI-compatible base URL"],
  [prefs, '"id":"cerebras"', "default Cerebras profile"],
  [prefs, '"baseURL":"https://api.cerebras.ai/v1"', "Cerebras OpenAI-compatible base URL"],
  [prefs, '"id":"nvidia-nim"', "default NVIDIA NIM profile"],
  [prefs, '"baseURL":"https://integrate.api.nvidia.com/v1"', "NVIDIA NIM OpenAI-compatible base URL"],
  [prefs, '"id":"sambanova"', "default SambaNova profile"],
  [prefs, '"id":"sambanova-responses"', "default SambaNova Responses profile"],
  [prefs, '"id":"sambanova-anthropic"', "default SambaNova Anthropic profile"],
  [prefs, '"bodyExtra":{"authHeader":"authorization"}', "default Bearer auth for Anthropic-compatible profiles"],
  [prefs, '"baseURL":"https://api.sambanova.ai/v1"', "SambaNova compatible base URL"],
  [prefs, '"id":"openrouter"', "default OpenRouter profile"],
  [prefs, '"baseURL":"https://openrouter.ai/api/v1"', "OpenRouter OpenAI-compatible base URL"],
  [prefs, '"id":"dashscope"', "default DashScope profile"],
  [prefs, '"baseURL":"https://dashscope.aliyuncs.com/compatible-mode/v1"', "DashScope OpenAI-compatible base URL"],
  [prefs, '"id":"siliconflow"', "default SiliconFlow profile"],
  [prefs, '"baseURL":"https://api.siliconflow.com/v1"', "SiliconFlow OpenAI-compatible base URL"],
  [prefs, '"id":"zhipu"', "default Zhipu profile"],
  [prefs, '"baseURL":"https://open.bigmodel.cn/api/paas/v4"', "Zhipu OpenAI-compatible base URL"],
  [prefs, '"id":"volcengine"', "default Volcengine profile"],
  [prefs, '"baseURL":"https://ark.cn-beijing.volces.com/api/v3"', "Volcengine OpenAI-compatible base URL"],
  [prefs, '"id":"qianfan"', "default Qianfan profile"],
  [prefs, '"baseURL":"https://qianfan.baidubce.com/v2"', "Qianfan OpenAI-compatible base URL"],
  [prefs, '"id":"hunyuan"', "default Hunyuan profile"],
  [prefs, '"baseURL":"https://api.hunyuan.cloud.tencent.com/v1"', "Hunyuan OpenAI-compatible base URL"],
  [prefs, '"id":"ollama"', "default Ollama profile"],
  [prefs, '"baseURL":"http://localhost:11434/v1"', "Ollama OpenAI-compatible base URL"],
  [prefs, '"id":"lm-studio"', "default LM Studio profile"],
  [prefs, '"baseURL":"http://127.0.0.1:1234/v1"', "LM Studio OpenAI-compatible base URL"],
  [prefs, '"id":"local-agents"', "default local agents profile"],
  [prefs, 'pref("extensions.zoteroMarkdownSummary.promptPackId", "general")', "default prompt pack setting"],
  [prefs, '"endpoint":"http://127.0.0.1:3333/mcp"', "local agents bridge endpoint"],
  [prefs, 'pref("extensions.zoteroMarkdownSummary.localOcrEnabled", false)', "default local OCR disabled setting"],
  [prefs, 'pref("extensions.zoteroMarkdownSummary.localOcrTool", "ocr_image")', "default local OCR MCP tool"],
  [prefs, 'pref("extensions.zoteroMarkdownSummary.localOcrLanguage", "eng")', "default local OCR language"],
  [prefs, '"ask-gemini":{"tool":"ask_gemini"}', "default Gemini local-agent skill mapping"],
  [prefs, '"ask-claude":{"tool":"ask_claude"}', "default Claude local-agent skill mapping"],
  [prefs, '"ask-opencode":{"tool":"ask_opencode"}', "default opencode local-agent skill mapping"],
  [prefs, '"ask-all-agents":{"tool":"ask_all_agents"}', "default all-agents local-agent skill mapping"],
  [prefs, '"ask-gemini-claude":{"tool":"ask_all_agents","args":{"agents":["gemini","claude"]}}', "default Gemini and Claude local-agent skill mapping"],
  [prefs, '"check-local-agents":{"tool":"check_local_agents","args":{"timeoutSeconds":30}}', "bounded local agents health check"],
  [prefs, '"extract-pdf-pages":{"tool":"extract_pdf_pages"}', "default local PDF extraction tool mapping"],
  [localAgentMcpSource, "extract_pdf_pages", "local PDF page extraction MCP tool"],
  [localAgentMcpSource, "LOCAL_AGENT_PDFTOTEXT_BIN", "local PDF text extraction binary override"],
  [localAgentMcpSource, "LOCAL_AGENT_PDFTOPPM_BIN", "local PDF page render binary override"],
  [localAgentMcpSource, "pdfPageEntriesFromText", "local PDF page text parser"],
  [localAgentMcpSource, "fullDocumentOcr", "local PDF full-document OCR opt-in"],
  [localAgentMcpSource, "pdfFullDocumentOcrEnabled", "local PDF full-document OCR option parser"],
  [localAgentMcpSource, "ocrPageStrategy", "local PDF OCR page-selection option"],
  [localAgentMcpSource, "pdfOcrPageNumbers", "local PDF sparse page OCR selection"],
  [localAgentMcpSource, "pdfOcrPageNumberPlan", "local PDF OCR page plan diagnostics"],
  [localAgentMcpSource, "pdfMergeTextAndOcrPages", "local PDF text and OCR page merge"],
  [localAgentMcpSource, "shouldRunPdfOcrFallback", "local PDF OCR fallback gate"],
  [localAgentMcpSource, "extractPdfOcrPages", "local scanned PDF OCR fallback"],
  [localAgentMcpSource, "pdfPageExtractionQuality", "local PDF extraction quality diagnostics"],
  [localAgentMcpSource, "ocr_fallback_used", "local PDF OCR fallback quality warning"],
  [localAgentMcpSource, "ocr_full_document_used", "local PDF full-document OCR quality warning"],
  [localAgentBridgeServiceSource, "REQUIRED_MCP_TOOL_NAMES", "local bridge service required tool check"],
  [localAgentBridgeServiceSource, "LOCAL_AGENT_PDFTOTEXT_BIN", "local bridge service PDF text env passthrough"],
  [localAgentBridgeServiceSource, "LOCAL_AGENT_PDFTOPPM_BIN", "local bridge service PDF render env passthrough"]
];

for (const [text, marker, description] of requiredMarkers) {
  if (!text.includes(marker)) fail(`Package missing ${description}: ${marker}`);
}

console.log(`Package verification passed: ${xpiPath}`);

function unzipText(entry) {
  return execFileSync("unzip", ["-p", xpiPath, entry], { encoding: "utf8" });
}

function assertXmlTagBalance(source, label) {
  const stack = [];
  const tagPattern = /<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*)?>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    const raw = match[0];
    const name = match[1];
    if (raw.startsWith("</")) {
      const open = stack.pop();
      if (!open || open.name !== name) {
        const expected = open ? `</${open.name}>` : "no closing tag";
        fail(`${label} has mismatched tag at line ${lineNumberAt(source, match.index)}: expected ${expected}, found </${name}>`);
      }
      continue;
    }
    if (raw.endsWith("/>")) continue;
    stack.push({ name, line: lineNumberAt(source, match.index) });
  }
  const open = stack.pop();
  if (open) fail(`${label} has unclosed tag <${open.name}> opened at line ${open.line}`);
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (source.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
