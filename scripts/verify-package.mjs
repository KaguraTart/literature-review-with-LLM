import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const xpiPath = "build/zotero-markdown-summary.xpi";

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
const readerJs = unzipText("content/reader.js");
const messagesJs = unzipText("content/messages.js");

const requiredMarkers = [
  [bootstrap, "zotero-markdown-summary-toolbar-button", "toolbar entry"],
  [bootstrap, "zotero-markdown-summary-sidenav-button", "right side entry"],
  [bootstrap, "runSelfCheckForContext", "runtime self check entry"],
  [bootstrap, "selfCheck", "localized self check menu"],
  [bootstrap, "selfCheckLocalAgentEndpoint", "local agent self check status"],
  [bootstrap, "checkLocalAgentBridge", "local agent bridge probe"],
  [bootstrap, "writeBatchRunReport", "per-run batch report writer"],
  [bootstrap, "writeCollectionWorkspace", "collection workspace writer"],
  [bootstrap, "collectionWorkspaceArtifactPaths", "localized collection artifact paths"],
  [bootstrap, "renderMethodMatrix", "collection method matrix writer"],
  [bootstrap, "renderResearchQuestionCards", "collection research question cards writer"],
  [bootstrap, "renderResearchGapMatrix", "collection research gap matrix writer"],
  [bootstrap, "renderIdeaList", "collection idea list writer"],
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
  [bootstrap, "endpointForProtocol(protocol, baseURL)", "versioned provider endpoint routing in bootstrap"],
  [bootstrap, "summaryPromptsForSettings", "localized direct summary prompts in bootstrap"],
  [bootstrap, "defaultSummaryUserPrompt", "localized direct paper summary template in bootstrap"],
  [bootstrap, "typeof ZMS_I18N === \"undefined\"", "safe bootstrap message loading"],
  [bootstrap, "loadSharedMessages", "shared message loader"],
  [bootstrapProvider, "setHeaderIfMissing(headers", "custom auth header preservation in bootstrap provider"],
  [bootstrapProvider, "extractAnthropicStreamText", "Anthropic stream parser in bootstrap provider"],
  [bootstrapProvider, "isProviderStreamSnapshot", "OpenAI Responses snapshot detector in bootstrap provider"],
  [bootstrapProvider, "extractOpenAIEventContainer", "OpenAI Responses event container parser in bootstrap provider"],
  [bootstrapProvider, "streamErrorText", "provider stream error parser in bootstrap provider"],
  [bootstrapProvider, "Provider error:", "provider JSON error parser in bootstrap provider"],
  [bootstrapProvider, "openaiResponsesInputForSummary", "structured OpenAI Responses input in bootstrap provider"],
  [bootstrapProvider, "jsonModeBodyDefaults", "protocol-specific JSON mode defaults in bootstrap provider"],
  [bootstrapProvider, "openAICompatibleBaseWithVersion", "OpenAI-compatible versioned base URL helper in bootstrap provider"],
  [bootstrapProvider, "usesVersionlessOpenAICompatibleBase", "versionless OpenAI-compatible base URL helper in bootstrap provider"],
  [bootstrapProvider, "hasExplicitAuthHeader", "explicit auth header preservation in bootstrap provider"],
  [bootstrapProvider, "anthropicAuthHeaderName", "Anthropic-compatible auth header selection in bootstrap provider"],
  [bootstrapProvider, "shouldAddAnthropicDirectBrowserAccess", "Anthropic direct browser access opt-in in bootstrap provider"],
  [bootstrapSettings, "getSettings", "bootstrap settings reader"],
  [bootstrapSettings, "settingsHasUsableAuth", "custom auth readiness for batch generation"],
  [bootstrapSettings, "settingsProviderDefaults", "provider defaults in bootstrap settings"],
  [bootstrapSettings, "azure_openai", "Azure OpenAI provider detection in bootstrap settings"],
  [bootstrapSettings, "gemini", "Gemini provider detection in bootstrap settings"],
  [bootstrapSettings, "ask-gemini-claude", "local-agent default skill fallback in bootstrap settings"],
  [bootstrapSettings, "activeProfile", "active profile reader in bootstrap settings"],
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
  [bootstrapUi, "openEmbeddedWorkbench", "embedded workbench opener in bootstrap UI"],
  [bootstrapUi, "openEmbeddedReader", "embedded reader opener in bootstrap UI"],
  [bootstrapUi, "ensureEmbeddedWorkbenchPanel", "embedded panel builder in bootstrap UI"],
  [bootstrapUi, "showProgress", "progress notification in bootstrap UI"],
  [preferencesXhtml, "zms-profileProtocol", "profile protocol editor"],
  [preferencesXhtml, "zms-profileEndpointMode", "profile endpoint mode editor"],
  [preferencesXhtml, "zms-profileCustomHeaders", "custom header editor"],
  [preferencesXhtml, "zms-profileBodyExtra", "body extra editor"],
  [preferencesXhtml, "zms-load-models-button", "model list loader button"],
  [preferencesXhtml, "value=\"local_agents\"", "local agents provider preset"],
  [preferencesXhtml, "value=\"gemini\"", "Gemini provider preset"],
  [preferencesXhtml, "value=\"azure_openai\"", "Azure OpenAI provider preset"],
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
  [preferencesXhtml, "value=\"ask-gemini-claude\"", "Gemini and Claude skill preset"],
  [preferencesXhtml, "zms-reset-profiles-button", "default profiles reset button"],
  [preferencesXhtml, "zms-profileStatus", "settings profile status summary"],
  [workbenchXhtml, "zms-write-summary", "write preview summary panel"],
  [workbenchXhtml, "zms-profile-status", "workbench profile status panel"],
  [preferencesJs, "saveProfileFromEditor", "profile save action"],
  [preferencesJs, "loadProfileEditor", "profile load action"],
  [preferencesJs, "refreshProfileStatus", "settings profile status refresh"],
  [preferencesJs, "profileStatusText", "settings profile status formatter"],
  [preferencesJs, "deleteProfileFromEditor", "profile delete action"],
  [preferencesJs, "resetProfilesToDefaults", "default profiles reset action"],
  [preferencesJs, "mergeDefaultProviderProfiles", "default profile migration in settings"],
  [preferencesJs, "providerFromProfile", "local agents profile provider detection"],
  [preferencesJs, "providerBodyExtra", "provider body extra filtering in settings"],
  [preferencesJs, "anthropicAuthHeaderName", "Anthropic-compatible auth header selection in settings"],
  [preferencesJs, "shouldAddAnthropicDirectBrowserAccess", "Anthropic direct browser access opt-in in settings"],
  [preferencesJs, "connectionTestRequestForProfile", "edited profile connection test"],
  [preferencesJs, "providerErrorText", "settings provider error formatter"],
  [preferencesJs, "localAgentConnectionTestRequestForProfile", "local agent settings connection test"],
  [preferencesJs, "profileHasUsableAuth", "custom auth settings readiness"],
  [preferencesJs, "modelListRequestForProfile", "provider model list request"],
  [preferencesJs, "modelIdsFromResponse", "provider model list parser"],
  [preferencesJs, "fetchModelOptions", "provider model list pagination loader"],
  [preferencesJs, "MODEL_LIST_MAX_PAGES", "bounded provider model list pagination"],
  [preferencesJs, "normalizeProfileId", "safe profile id normalization"],
  [preferencesJs, "jsonModeBodyDefaults", "settings JSON mode request defaults"],
  [preferencesJs, "hasExplicitAuthHeader", "settings explicit auth header preservation"],
  [preferencesJs, "openAICompatibleBaseWithVersion", "settings OpenAI-compatible versioned base URL helper"],
  [preferencesJs, "refreshSkillMenu", "settings skill menu refresh"],
  [preferencesJs, "availableSkillTemplateIds", "settings custom skill discovery"],
  [messagesJs, "modelMissing", "missing model validation message"],
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
  [messagesJs, "candidateImportDone", "candidate import status message"],
  [messagesJs, "candidatePdfDone", "candidate PDF attachment status message"],
  [messagesJs, "candidateDedupeDone", "candidate duplicate reconciliation status message"],
  [messagesJs, "profilesReset", "profile reset status message"],
  [messagesJs, "copyAnswer", "answer copy button message"],
  [messagesJs, "quickSettings", "simplified settings heading message"],
  [markdownRenderJs, "ZMSMarkdownRenderer", "shared Markdown renderer runtime"],
  [markdownRenderJs, "zms-math-display", "display math rendering"],
  [markdownRenderJs, "zms-math-inline", "inline math rendering"],
  [markdownRenderJs, "zms-tex-frac", "fraction math rendering"],
  [markdownRenderJs, "zmsAppendTex", "lightweight TeX rendering"],
  [candidateSourcesJs, "searchCandidateSources", "candidate source search runtime"],
  [candidateSourcesJs, "parseArxivAtom", "candidate arXiv parser"],
  [candidateSourcesJs, "mergeCandidateRecords", "candidate JSONL merge helper"],
  [workbenchXhtml, "candidate-sources.js", "candidate source runtime script"],
  [workbenchXhtml, "markdown-render.js", "workbench shared Markdown renderer script"],
  [workbenchXhtml, "zms-settings-toggle", "workbench settings drawer button"],
  [workbenchXhtml, "zms-profile-trigger", "compact model switcher button"],
  [workbenchXhtml, "zms-composer-toolbar", "p2-style composer toolbar"],
  [workbenchXhtml, "zms-composer-profile", "composer model pill"],
  [workbenchXhtml, "zms-composer-skill", "composer skill pill"],
  [workbenchXhtml, "zms-send-button", "composer circular send button"],
  [workbenchXhtml, "zms-quick-settings-heading", "simplified settings primary section"],
  [workbenchXhtml, "zms-settings-details", "collapsible advanced settings sections"],
  [workbenchXhtml, "zms-search-candidates", "candidate search button"],
  [workbenchXhtml, "zms-import-candidates", "candidate import button"],
  [workbenchXhtml, "zms-attach-candidate-pdfs", "candidate PDF attachment button"],
  [workbenchXhtml, "zms-reconcile-candidate-duplicates", "candidate duplicate reconciliation button"],
  [workbenchJs, "requestModelWithRetry", "chat request retry"],
  [workbenchJs, "renderMessageContent", "streaming Markdown message rendering"],
  [workbenchJs, "profileCompactLabel", "compact model profile label"],
  [workbenchJs, "zms-message-copy", "prominent answer copy control"],
  [workbenchJs, "copyText(message.content", "answer copy uses raw Markdown"],
  [workbenchJs, "openSkillSettings", "composer skill settings shortcut"],
  [workbenchCss, "zms-composer-toolbar", "composer toolbar styles"],
  [workbenchCss, "zms-send-button", "circular send button styles"],
  [workbenchCss, "-moz-user-select: text", "copyable message text selection"],
  [workbenchJs, "providerErrorText", "provider error formatter in workbench"],
  [workbenchJs, "writeTextAtomic", "atomic markdown write"],
  [workbenchJs, "writePreviewSummary", "write preview safety summary"],
  [workbenchJs, "requestInputStatusText", "request input status display"],
  [workbenchJs, "profileStatusText", "workbench profile status display"],
  [workbenchJs, "mergeDefaultProviderProfiles", "default profile migration in workbench"],
  [workbenchJs, "stableChunkId", "hash-stable context chunk ids"],
  [workbenchJs, "chunkEvidenceLabel", "context evidence labels"],
  [workbenchJs, "existingPath && (!IOUtils.exists", "stale summary attachment path guard"],
  [workbenchJs, "readPdfAnnotations", "annotation context"],
  [workbenchJs, "availableSkillIds", "local skill discovery"],
  [workbenchJs, "providerBodyExtra", "provider body extra filtering in workbench"],
  [workbenchJs, "shouldAddAnthropicDirectBrowserAccess", "Anthropic direct browser access opt-in in workbench"],
  [workbenchJs, "normalizeSkillId", "safe custom skill ids"],
  [workbenchJs, "sessionIdFromPath", "loaded session id restoration"],
  [workbenchJs, "recentSessionFiles", "session history listing"],
  [workbenchJs, "localAgentConfig", "local agent profile routing"],
  [workbenchJs, "localAgentRequestCwd", "local agent safe working directory routing"],
  [workbenchJs, "localAgent.method", "local agent custom method passthrough"],
  [workbenchJs, "shouldStream(profile", "runtime stream setting"],
  [workbenchJs, "profileHasUsableAuth", "custom auth workbench readiness"],
  [workbenchJs, "openaiResponsesInput", "structured OpenAI Responses input in workbench"],
  [workbenchJs, "jsonModeBodyDefaults", "workbench JSON mode request defaults"],
  [workbenchJs, "hasExplicitAuthHeader", "workbench explicit auth header preservation"],
  [workbenchJs, "openAICompatibleBaseWithVersion", "workbench OpenAI-compatible versioned base URL helper"],
  [workbenchJs, "mergeConsecutiveAnthropicMessages", "Anthropic consecutive role normalization"],
  [workbenchJs, "streamErrorText", "workbench provider stream error parser"],
  [workbenchJs, "Provider error:", "workbench provider JSON error parser"],
  [workbenchJs, "streamTextFromData", "workbench stream tail parser"],
  [workbenchJs, "modelTextFromStreamContainer", "OpenAI Responses stream container parser in workbench"],
  [workbenchJs, "!parsed.snapshot || !text", "OpenAI Responses stream snapshot dedupe in workbench"],
  [workbenchJs, "searchCandidates", "workbench candidate search action"],
  [workbenchJs, "importIncludedCandidates", "workbench candidate import action"],
  [workbenchJs, "importCandidateIntoZotero", "workbench Zotero candidate import helper"],
  [workbenchJs, "importableCandidateRecords", "workbench candidate import filter"],
  [workbenchJs, "normalizedCandidateTitle", "workbench candidate title dedupe fallback"],
  [workbenchJs, "attachCandidatePdfs", "workbench candidate PDF attachment action"],
  [workbenchJs, "attachCandidatePdfToZotero", "workbench Zotero candidate PDF attachment helper"],
  [workbenchJs, "pdfAttachableCandidateRecords", "workbench candidate PDF attachment filter"],
  [workbenchJs, "reconcileCandidateDuplicates", "workbench candidate duplicate reconciliation action"],
  [workbenchJs, "reconcileCandidateDuplicateRecords", "workbench candidate duplicate reconciliation helper"],
  [workbenchJs, "candidateSearchOptionsFromDom", "workbench candidate search form reader"],
  [workbenchJs, "importLedgerJsonlPath", "workbench import ledger path"],
  [workbenchJs, "appendImportLedgerEntries", "workbench import ledger append"],
  [readerJs, "backToWorkbench", "reader back action"],
  [readerJs, "copyMarkdown", "reader markdown copy"],
  [prefs, '"id":"openai"', "default OpenAI profile"],
  [prefs, '"protocol":"openai_responses"', "OpenAI Responses protocol"],
  [prefs, '"id":"openai-compatible"', "default OpenAI-compatible chat profile"],
  [prefs, '"id":"anthropic"', "default Anthropic profile"],
  [prefs, '"protocol":"anthropic_messages"', "Anthropic Messages protocol"],
  [prefs, '"id":"gemini"', "default Gemini OpenAI-compatible profile"],
  [prefs, '"baseURL":"https://generativelanguage.googleapis.com/v1beta/openai"', "Gemini OpenAI-compatible base URL"],
  [prefs, '"id":"azure-openai"', "default Azure OpenAI profile"],
  [prefs, '"baseURL":"https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1"', "Azure OpenAI v1 base URL template"],
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
  [prefs, '"endpoint":"http://127.0.0.1:3333/mcp"', "local agents bridge endpoint"],
  [prefs, '"ask-gemini":{"tool":"ask_gemini"}', "default Gemini local-agent skill mapping"],
  [prefs, '"ask-claude":{"tool":"ask_claude"}', "default Claude local-agent skill mapping"],
  [prefs, '"ask-opencode":{"tool":"ask_opencode"}', "default opencode local-agent skill mapping"],
  [prefs, '"ask-all-agents":{"tool":"ask_all_agents"}', "default all-agents local-agent skill mapping"],
  [prefs, '"ask-gemini-claude":{"tool":"ask_all_agents","args":{"agents":["gemini","claude"]}}', "default Gemini and Claude local-agent skill mapping"],
  [prefs, '"check-local-agents":{"tool":"check_local_agents","args":{"timeoutSeconds":30}}', "bounded local agents health check"]
];

for (const [text, marker, description] of requiredMarkers) {
  if (!text.includes(marker)) fail(`Package missing ${description}: ${marker}`);
}

console.log(`Package verification passed: ${xpiPath}`);

function unzipText(entry) {
  return execFileSync("unzip", ["-p", xpiPath, entry], { encoding: "utf8" });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
