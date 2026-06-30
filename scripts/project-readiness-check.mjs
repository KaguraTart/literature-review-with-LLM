import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_XPI_PATH = "build/literature-review-with-llm.xpi";
const LATEST_RELEASE_URL = "https://github.com/KaguraTart/literature-review-with-LLM/releases/latest";
const LATEST_XPI_URL = "https://github.com/KaguraTart/literature-review-with-LLM/releases/latest/download/literature-review-with-llm.xpi";
const VERSIONED_RELEASE_LINK_PATTERN = /https:\/\/github\.com\/KaguraTart\/literature-review-with-LLM\/releases\/(?:tag|download)\/v\d+\.\d+\.\d+/;

const REQUIRED_FILES = [
  "addon/bootstrap.js",
  "addon/prefs.js",
  "addon/content/bootstrap-provider.js",
  "addon/content/bootstrap-settings.js",
  "addon/content/bootstrap-summary-store.js",
  "addon/content/bootstrap-zotero-item.js",
  "addon/content/bootstrap-ui.js",
  "addon/content/candidate-sources.js",
  "addon/content/markdown-render.js",
  "addon/content/messages.js",
  "addon/content/preferences.xhtml",
  "addon/content/preferences.js",
  "addon/content/workbench.xhtml",
  "addon/content/workbench.js",
  "addon/content/reader.xhtml",
  "addon/content/reader.js",
  "scripts/local-agent-mcp.mjs",
  "scripts/local-agent-http-bridge.mjs",
  "scripts/local-agent-bridge-service.mjs",
  "scripts/build-update-manifest.mjs",
  "scripts/verify-package.mjs",
  "scripts/verify-installed-zotero.mjs",
  "scripts/verify-zotero-runtime.mjs",
  "scripts/verify-provider-smoke.mjs",
  "scripts/verify-provider-live.mjs",
  "scripts/verify-writeback-smoke.mjs",
  "tests/providerCatalogConsistency.test.ts",
  "tests/bootstrapUiRuntime.test.ts",
  "tests/providerSmokeScript.test.ts",
  "tests/updateManifest.test.ts",
  "tests/writebackSmokeScript.test.ts",
  "src/providerAdapters.ts",
  "src/skills.ts"
];

const REQUIRED_PACKAGE_SCRIPTS = [
  "build",
  "build:update-manifest",
  "test",
  "typecheck",
  "verify:zip",
  "verify:update-manifest",
  "verify:package",
  "verify:installed",
  "verify:zotero-runtime",
  "verify:provider",
  "verify:provider:mock",
  "verify:provider:catalog",
  "verify:provider:models",
  "verify:provider:models:mock",
  "verify:provider:live",
  "verify:provider:models:live",
  "verify:writeback",
  "readiness:check",
  "check",
  "local-agent:service:check",
  "local-agent:service:doctor"
];

const REQUIRED_PROFILE_IDS = [
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
];

const REQUIRED_SKILL_IDS = [
  "ask-all-agents",
  "ask-gemini-claude",
  "ask-gemini",
  "ask-claude",
  "ask-opencode",
  "check-local-agents"
];

const REQUIRED_XPI_ENTRIES = [
  "bootstrap.js",
  "prefs.js",
  "content/auto-update.js",
  "content/bootstrap-provider.js",
  "content/bootstrap-settings.js",
  "content/bootstrap-summary-store.js",
  "content/bootstrap-zotero-item.js",
  "content/bootstrap-ui.js",
  "content/candidate-sources.js",
  "content/markdown-render.js",
  "content/preferences.xhtml",
  "content/preferences.js",
  "content/workbench.xhtml",
  "content/workbench.js",
  "content/reader.xhtml",
  "content/reader.js",
  "locale/zh-CN/zotero-markdown-summary.ftl",
  "locale/en-US/zotero-markdown-summary.ftl"
];

const SOURCE_MARKERS = [
  {
    id: "release.update-manifest",
    description: "XPI releases publish Zotero update metadata with stable update URL and hash verification",
    files: ["addon/manifest.json", "scripts/build-update-manifest.mjs", "package.json", ".github/workflows/ci.yml", ".github/workflows/release.yml"],
    markers: ["update_url", "buildUpdateManifest", "verify:update-manifest", "build/update.json", "gh release upload", "--clobber"]
  },
  {
    id: "release.auto-update-opt-out",
    description: "XPI installs default to automatic update sync and expose an opt-out setting",
    files: ["addon/prefs.js", "addon/bootstrap.js", "addon/content/auto-update.js", "addon/content/preferences.xhtml", "addon/content/preferences.js", "addon/content/workbench.xhtml", "addon/content/workbench.js", "README.md", "README.zh-CN.md", "tests/preferencesLocalAgent.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["autoUpdateEnabled", "zms-autoUpdateEnabled", "zms-workbench-auto-update-input", "zmsApplyAddonAutoUpdatePreference", "applyConfiguredAddonAutoUpdatePolicy", "Automatically sync updates", "自动同步更新", "mode: 0"]
  },
  {
    id: "provider.endpoint-normalization",
    description: "OpenAI-compatible base URL normalization is available in runtime and settings surfaces",
    files: [
      "src/providerAdapters.ts",
      "addon/content/bootstrap-provider.js",
      "addon/content/preferences.js",
      "addon/content/workbench.js"
    ],
    markers: ["openAICompatibleBaseWithVersion", "hasOpenAICompatibleVersionPath", "usesVersionlessOpenAICompatibleBase"]
  },
  {
    id: "provider.auth",
    description: "Provider profiles use protocol-specific auth headers without treating empty auth headers as configured",
    files: [
      "src/providerAdapters.ts",
      "addon/content/preferences.js",
      "addon/content/workbench.js",
      "addon/content/bootstrap-provider.js"
    ],
    markers: ["usesAzureOpenAIAuth", "hasHeaderValue", "anthropicAuthHeaderName", "shouldAddAnthropicDirectBrowserAccess"]
  },
  {
    id: "provider.protocols",
    description: "OpenAI chat, OpenAI Responses, Anthropic Messages, JSON mode, Chat token limits, and streamed usage options are present",
    files: ["src/providerAdapters.ts", "addon/content/bootstrap-provider.js", "addon/content/preferences.js", "addon/content/workbench.js"],
    markers: ["openai_responses", "anthropic_messages", "jsonModeBodyDefaults", "openAIChatTokenLimit", "openAIChatOptionalDefaults", "openAIChatStreamOptions", "providerCompatibilityFallback", "providerCompatibilityFallbackFields", "providerStructuredUnsupportedFields", "isNonAnswerStreamEvent"]
  },
  {
    id: "provider.stream-snapshot-fallback",
    description: "OpenAI Responses stream snapshot containers are parsed only as fallback text",
    files: ["src/providerAdapters.ts", "addon/bootstrap.js", "addon/content/bootstrap-provider.js", "addon/content/workbench.js"],
    markers: ["extractOpenAIEventContainer", "isProviderStreamSnapshot", "modelTextFromStreamContainer", "!parsed.snapshot || !text"]
  },
  {
    id: "provider.usage-metadata",
    description: "OpenAI-compatible, Responses, Anthropic, and wrapped provider usage metadata is normalized and preserved",
    files: ["src/providerAdapters.ts", "addon/content/workbench.js", "scripts/verify-provider-smoke.mjs", "tests/providerAdapters.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["extractProviderUsage", "parseStreamUsage", "providerUsageFromResponse", "response.zmsUsage", "message?.usage", "normalizes provider token usage", "captures provider usage metadata"]
  },
  {
    id: "provider.bootstrap-runtime",
    description: "Bootstrap generation keeps provider identity and version-aware endpoint routing",
    files: ["addon/bootstrap.js", "addon/content/bootstrap-settings.js"],
    markers: ["endpointForProtocol(protocol, baseURL)", "settingsProviderFromProfile", "azure_openai", "gemini"]
  },
  {
    id: "provider.bootstrap-multimodal",
    description: "Bootstrap generation can build protocol-specific image request bodies for OpenAI Chat, OpenAI Responses, and Anthropic Messages",
    files: ["addon/bootstrap.js", "addon/content/bootstrap-provider.js", "tests/bootstrapProvider.test.ts"],
    markers: ["requestInputImages", "imageDataURL", "openAIChatSummaryMessages", "input_image", "image_url", "当前接口档案不支持图片输入", "sends image attachments through bootstrap"]
  },
  {
    id: "provider.bootstrap-defaults",
    description: "Bootstrap legacy provider fallback keeps mainstream endpoints and local-agent tools",
    files: ["addon/content/bootstrap-settings.js"],
    markers: ["https://api.openai.com/v1", "https://api.anthropic.com", "http://127.0.0.1:3333/mcp", "ask-gemini-claude"]
  },
  {
    id: "prompt.packs",
    description: "Research-domain prompt packs are configurable and applied in workbench and direct summary prompts",
    files: ["addon/prefs.js", "addon/bootstrap.js", "addon/content/bootstrap-settings.js", "addon/content/preferences.xhtml", "addon/content/workbench.xhtml", "addon/content/workbench.js", "tests/workbenchWriteback.test.ts", "tests/bootstrapProvider.test.ts"],
    markers: ["promptPackId", "promptPackInstructionBlock", "zms-promptPackId", "zms-prompt-pack", "promptTextForRequest", "adds prompt pack instructions"]
  },
  {
    id: "provider.profile-migration",
    description: "Settings and workbench merge missing built-in provider profiles without overwriting user profiles",
    files: ["addon/content/preferences.js", "addon/content/workbench.js"],
    markers: ["mergeDefaultProviderProfiles", "providerProfileCatalogKey", "defaultProviderProfiles"]
  },
  {
    id: "provider.catalog-consistency",
    description: "Default provider catalog stays aligned across prefs, settings, workbench, and bootstrap fallback",
    files: ["tests/providerCatalogConsistency.test.ts"],
    markers: ["loadPreferencesHelpers", "loadWorkbenchHelpers", "loadBootstrapSettingsHelpers", "defaultPrefsProfiles", "catalogCanonical"]
  },
  {
    id: "provider.smoke-script",
    description: "Provider smoke verification can call OpenAI-compatible, Responses, and Anthropic endpoints with sanitized output",
    files: ["scripts/verify-provider-smoke.mjs"],
    markers: ["runProviderSmoke", "runMockProviderSmoke", "runProviderModels", "runMockProviderModels", "endpointFor", "headersFor", "bodyFor", "extractResponseText", "extractProviderUsage", "api-key-env", "dryRun", "mockProviderResponse", "modelOptionsFromItems", "profileHasUsableAuth", "isLocalEndpoint", "smokeInputMode"]
  },
  {
    id: "provider.stream-smoke",
    description: "Provider smoke verification covers streaming OpenAI-compatible, Responses, and Anthropic text/event-stream output",
    files: ["scripts/verify-provider-smoke.mjs", "scripts/verify-provider-live.mjs", "package.json", "tests/providerSmokeScript.test.ts"],
    markers: ["--stream", "verify:provider:stream:mock", "mockProviderStreamResponse", "streamTextFromBody", "streamUsageFromBody", "parseStreamChunk", "parseStreamUsage", "stream_options", "candidates", "runs built-in mock stream checks", "runs live provider stream checks"]
  },
  {
    id: "provider.multimodal-smoke",
    description: "Provider smoke verification covers OpenAI image, Responses PDF/image, and Anthropic image/document request bodies",
    files: ["scripts/verify-provider-smoke.mjs", "package.json", "tests/providerSmokeScript.test.ts"],
    markers: ["--image", "--pdf", "verify:provider:multimodal:mock", "input_image", "input_file", "pdfInputFileField", "document", "runs built-in mock image checks", "runs built-in mock PDF checks"]
  },
  {
    id: "provider.catalog-shape-verifier",
    description: "Default provider profiles can be checked offline for endpoint, auth header, model-list capability, and text/image/PDF request-body shape",
    files: ["scripts/verify-provider-smoke.mjs", "package.json", "tests/providerSmokeScript.test.ts"],
    markers: ["runProviderCatalog", "catalogProfileResult", "catalogProfileIssues", "catalogInputChecks", "catalogInputCheck", "--catalog", "verify:provider:catalog", "model-list endpoint present while capability is disabled", "inputChecks", "image_url", "input_file", "pdfInputFileField", "document"]
  },
  {
    id: "provider.settings-connection-response",
    description: "Settings connection tests use generation-compatible request bodies, require parseable model text, and surface 200-level provider errors",
    files: ["addon/content/preferences.js", "addon/content/workbench.js", "tests/preferencesLocalAgent.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["extractProviderConnectionText", "providerTextFromStreamText", "connectionTestBodyForProfile", "Provider error", "No text returned from model", "input_text", "stream_options", "builds workbench settings connection tests with generation-compatible request bodies", "marks settings connection tests OK only after extracting model text", "fails settings connection tests when a 200 response still contains a provider error"]
  },
  {
    id: "provider.settings-guide",
    description: "Settings page shows a provider setup guide with endpoint, auth, capability, and live-check commands without exposing API keys",
    files: ["addon/content/preferences.xhtml", "addon/content/preferences.js", "addon/content/messages.js", "tests/preferencesLocalAgent.test.ts"],
    markers: ["zms-providerGuide", "zms-doctor-button", "checkProviderConfig", "providerConfigDoctor", "doctorOk", "providerSetupGuide", "providerLiveVerifyGuide", "envTemplateCommand", "dotenvTemplateCommand", "doctorCommand", "envFileCommand", "imageCommand", "pdfCommand", "providerCapabilityOverrideCommands", "CAPABILITIES_JSON", "--env-template", "--dotenv-template", "--doctor", "--provider-env-file", "OPENAI_COMPATIBLE_BASE_URL", "ANTHROPIC_COMPATIBLE_BASE_URL", "not.toContain", "routed-secret", "providerGuide"]
  },
  {
    id: "docs.provider-setup-examples",
    description: "README links provider-specific visual setup cards and short tutorial recipes",
    files: [
      "README.md",
      "README.zh-CN.md",
      "docs/provider-setup-examples.md",
      "docs/provider-setup-examples.zh-CN.md",
      "docs/assets/provider-card-openai-compatible.svg",
      "docs/assets/provider-card-aggregators.svg",
      "docs/assets/provider-card-local.svg"
    ],
    markers: [
      "Provider setup examples",
      "大模型厂商配置示例",
      "provider-card-openai-compatible.svg",
      "provider-card-aggregators.svg",
      "provider-card-local.svg",
      "MiniMax",
      "DeepSeek",
      "Gemini OpenAI Compatible",
      "OpenRouter",
      "Cline API",
      "Vercel AI Gateway",
      "Ollama",
      "LM Studio",
      "Local Agents",
      "Save and Test",
      "保存并测试"
    ]
  },
  {
    id: "preferences.output-dir-picker",
    description: "Settings page lets users choose the output directory with the native folder picker and saves the selected path",
    files: ["addon/content/preferences.xhtml", "addon/content/preferences.js", "addon/content/messages.js", "tests/preferencesLocalAgent.test.ts"],
    markers: ["zms-choose-outputDir-button", "chooseOutputDir", "chooseOutputDirectory", "modeGetFolder", "chooseOutputDirTitle", "chooses an output directory with the native folder picker and saves it", "keeps the current output directory when folder picking is cancelled"]
  },
  {
    id: "provider.workbench-diagnostics-report",
    description: "Workbench can export a redacted provider diagnostics report with endpoint, auth, capability, model-list, request-preview, and live-check details",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js", "addon/content/messages.js", "tests/workbenchWriteback.test.ts", "README.md", "README.zh-CN.md"],
    markers: ["zms-export-provider-diagnostics", "renderProviderDiagnosticsMarkdown", "provider-diagnostics-v1", "providerDiagnosticsMarkdownPath", "providerRequestPreviews", "Redacted Request Preview", "Copyable Env Template", "Draft .env.local", ".env.local Configuration Doctor", "doctorCommand", "--doctor", "dotenvTemplateCommand", "--dotenv-template", "envTemplateCommand", "envFileCommand", "Image Live Check", "PDF Live Check", "Capability Override Check", "CAPABILITIES_JSON", "data:image/png;base64,[omitted]", "renders raw PDF request previews", "DEEPSEEK_API_KEY=...", "exports provider diagnostics from the latest workbench settings", "renders provider diagnostics without exposing credentials", "redacted provider diagnostics"]
  },
  {
    id: "provider.retry-boundary",
    description: "Provider requests retry only retryable HTTP failures and fail fast on bad credentials or invalid requests",
    files: ["addon/bootstrap.js", "addon/content/workbench.js", "tests/bootstrapProvider.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["providerHTTPError", "retryableProviderError", "does not retry non-retryable", "retries retryable"]
  },
  {
    id: "provider.input-capability-boundary",
    description: "PDF/base64 input is gated by the same explicit provider capability rule in bootstrap batch generation, the workbench, and workbench settings",
    files: ["addon/bootstrap.js", "addon/content/workbench.xhtml", "addon/content/workbench.js", "tests/bootstrapProvider.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["canUsePdfBase64Input", "capabilities?.pdfBase64 === true", "protocol !== \"openai_chat\"", "zms-profile-pdf-input", "same PDF/base64 capability rule", "saves raw-PDF capability from the workbench settings panel"]
  },
  {
    id: "provider.live-script",
    description: "Provider live verification can skip missing env config and run configured OpenAI, OpenAI-compatible, OpenAI Responses-compatible, Anthropic, image, and PDF checks",
    files: ["scripts/verify-provider-live.mjs", "package.json", "tests/providerSmokeScript.test.ts"],
    markers: ["runProviderLive", "providerLiveCaseCatalog", "providerLiveEnvTemplate", "providerLiveDoctor", "providerLiveCaseGroups", "formatDotenvTemplate", "formatDoctorReport", "--list", "--env-template", "--dotenv-template", "--doctor", "--provider-env-file", "--env-file", "configurationReady", "generationWithEnvFile", "modelListWithEnvFile", "imageWithEnvFile", "pdfWithEnvFile", "envFileLoaded", "envFileMissing", "imageInput", "pdfInput", "imageCommand", "pdfCommand", "capabilitiesForCase", "capabilitiesEnvForCase", "--capabilities-json", "CAPABILITIES_JSON", "per-case capability overrides", "openai-chat", "openai-responses", "anthropic-messages", "mainstream", "OPENAI_API_KEY", "OPENAI_RESPONSES_COMPATIBLE_BASE_URL", "ANTHROPIC_API_KEY", "OPENAI_COMPATIBLE_BASE_URL", "MINIMAX_API_KEY", "GEMINI_API_KEY", "AZURE_OPENAI_API_KEY", "CLINE_API_KEY", "LITELLM_PROXY_API_KEY", "LITELLM_PROXY_RESPONSES_API_KEY", "LITELLM_PROXY_ANTHROPIC_API_KEY", "CLOUDFLARE_API_KEY", "CLOUDFLARE_RESPONSES_API_KEY", "CLOUDFLARE_ANTHROPIC_API_KEY", "GITHUB_MODELS_API_KEY", "HUGGINGFACE_API_KEY", "DEEPINFRA_API_KEY", "FIREWORKS_API_KEY", "CEREBRAS_API_KEY", "NVIDIA_NIM_API_KEY", "SAMBANOVA_API_KEY", "SAMBANOVA_ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "ZAI_ANTHROPIC_API_KEY", "OLLAMA_BASE_URL", "LM_STUDIO_BASE_URL", "allowLocalNoAuth", "isLocalEndpoint", "failOnSkip", "verify:provider:live", "verify:provider:image:live", "verify:provider:pdf:live", "verify:provider:models:live", "runProviderModels", "unsupportedInputReason"]
  },
  {
    id: "provider.model-list-pagination",
    description: "Settings and workbench model list loading follow bounded pagination cursors",
    files: ["addon/content/preferences.js", "addon/content/workbench.js", "tests/preferencesLocalAgent.test.ts", "tests/workbenchSession.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["fetchModelOptions", "nextModelListURL", "MODEL_LIST_MAX_PAGES", "workbenchFetchModelOptions", "workbenchNextModelListURL", "WORKBENCH_MODEL_LIST_MAX_PAGES", "providerRequestHeadersWithFallback", "retries settings model lists without a rejected Anthropic version header", "retries workbench model lists without a rejected Anthropic version header", "follows bounded wrapped model-list pagination in the workbench"]
  },
  {
    id: "provider.model-list-retry-after",
    description: "Provider smoke and live model-list checks honor explicit provider retry timing headers",
    files: ["scripts/verify-provider-smoke.mjs", "scripts/verify-provider-live.mjs", "tests/providerSmokeScript.test.ts"],
    markers: ["providerModelListRetryDelayMs", "providerRetryAfterMs", "PROVIDER_MODEL_LIST_MAX_ATTEMPTS", "honors Retry-After timing headers for model-list checks", "does not retry model-list checks without provider retry timing headers", "honors Retry-After timing headers in live model-list checks", "runProviderModels"]
  },
  {
    id: "provider.generation-retry-after",
    description: "Provider smoke and live generation checks honor explicit provider retry timing headers",
    files: ["scripts/verify-provider-smoke.mjs", "scripts/verify-provider-live.mjs", "tests/providerSmokeScript.test.ts"],
    markers: ["providerGenerationRetryDelayMs", "PROVIDER_GENERATION_MAX_ATTEMPTS", "honors Retry-After timing headers for generation checks", "does not retry generation checks without provider retry timing headers", "honors Retry-After timing headers in live generation checks", "runProviderSmoke"]
  },
  {
    id: "provider.model-picker-presets",
    description: "Settings and workbench expose provider-specific recommended model dropdowns before falling back to custom model input",
    files: ["addon/content/provider-models.js", "addon/content/preferences.xhtml", "addon/content/preferences.js", "addon/content/workbench.xhtml", "addon/content/workbench.js", "tests/preferencesLocalAgent.test.ts", "tests/workbenchWriteback.test.ts", "tests/providerCatalogConsistency.test.ts"],
    markers: ["MODEL_CATALOG", "zms-model-select", "zms-profile-model-select", "recommendedModelOptionsForProvider", "renderWorkbenchModelRecommendations", "appendGroupedModelSelectOptions", "Custom/private model", "自定义/私有部署模型", "Model vendor", "模型厂商", "preloads recommended provider models without requiring an API key", "loads recommended workbench models before API credentials are configured", "tags aggregate-provider recommendations with concrete model vendors"]
  },
  {
    id: "local-agents.bridge",
    description: "Gemini, Claude, opencode, all-agent, OCR, PDF page extraction, and health-check MCP tools are exposed by the local bridge",
    files: ["scripts/local-agent-mcp.mjs"],
    markers: ["ask_gemini", "ask_claude", "ask_opencode", "ask_all_agents", "ocr_image", "extract_pdf_pages", "check_local_agents", "selectedAgentEntries", "allAgentCallArgs", "allAgentTimeoutSeconds", "LOCAL_AGENT_TESSERACT_BIN", "LOCAL_AGENT_TESSERACT_LANG", "LOCAL_AGENT_PDFTOTEXT_BIN", "LOCAL_AGENT_PDFTOPPM_BIN", "fullDocumentOcr", "pdfFullDocumentOcrEnabled", "ocrPageStrategy", "pdfOcrPageNumbers", "pdfOcrPageNumberPlan", "pdfMergeTextAndOcrPages", "shouldRunPdfOcrFallback", "extractPdfOcrPages", "pdfPageExtractionQuality", "ocrAutoRepair", "ocrRepairPsms", "ocrPreprocessRepair", "ocrPreprocessModes", "pdfOcrAutoRepairEnabled", "pdfOcrRepairPsmModes", "pdfOcrPreprocessRepairEnabled", "pdfOcrPreprocessRepairModes", "renderPdfOcrPreprocessPage", "writeAdaptiveThresholdPbm", "parsePgm", "adaptive-threshold", "pdfOcrRenderColorMode", "\"-mono\"", "repairPdfOcrPage", "ocr_fallback_used", "ocr_full_document_used", "ocr_auto_repair_used", "ocr_psm_repair_used", "ocr_preprocess_repair_used"]
  },
  {
    id: "local-agents.ocr-workbench",
    description: "Workbench can optionally run local OCR on image attachments through the local-agent bridge and store the result as metadata",
    files: ["addon/prefs.js", "addon/content/workbench.xhtml", "addon/content/workbench.js", "addon/content/workbench.css", "addon/content/messages.js", "tests/workbenchWriteback.test.ts", "tests/localAgentMcpRuntime.test.ts", "README.md", "README.zh-CN.md"],
    markers: ["localOcrEnabled", "localOcrLanguage", "zms-local-ocr-input", "zms-local-ocr-endpoint", "zms-local-ocr-language", "localOcrForImage", "appendUserImageReview", "zms-user-image-review", "ocrCorrected", "imageMessageMetadataForSend", "localOcrRunning", "ocr_image", "stores optional local OCR metadata", "renders editable OCR review controls", "Local OCR", "本地 OCR"]
  },
  {
    id: "local-agents.aggregate-failure",
    description: "All-agent fan-out uses bounded sequential CLI calls, returns partial successes, and raises an MCP error when every selected CLI fails",
    files: ["scripts/local-agent-mcp.mjs", "tests/localAgentMcpRuntime.test.ts"],
    markers: ["settleAgentCalls", "All local agents failed", "fulfilled.length", "returns partial ask_all_agents output", "every selected ask_all_agents CLI fails"]
  },
  {
    id: "local-agents.workbench-routing",
    description: "Workbench routes local-agent skills through configurable MCP payload settings",
    files: ["addon/content/workbench.js"],
    markers: ["localAgentConfig", "localAgentPlan", "localAgentRequestBody", "localAgentCallArgs", "localAgentRequestCwd", "pickSkillLocalAgentConfig", "fallbackToRemote === true"]
  },
  {
    id: "local-agents.bootstrap-routing",
    description: "Bootstrap menus and batch summaries route Local Agents profiles without remote model credentials",
    files: ["addon/bootstrap.js", "addon/content/bootstrap-settings.js"],
    markers: ["settingsRequiresModel(settings)", "callLocalAgentSummary", "localAgentEndpointForProfile(settings)", "settingsHasUsableAuth"]
  },
  {
    id: "local-agents.settings-tools-check",
    description: "Settings Local Agents connection tests verify the MCP tool registry, not only initialize",
    files: ["addon/content/preferences.js", "tests/preferencesLocalAgent.test.ts"],
    markers: ["localAgentToolsListRequestForProfile", "tools/list", "Missing Local Agents MCP tools", "ask_opencode"]
  },
  {
    id: "local-agents.service-diagnostics",
    description: "Local-agent service diagnostics can check selected agents independently and verify the required MCP tool registry",
    files: ["scripts/local-agent-bridge-service.mjs"],
    markers: ["--agents", "parseAgents", "selectedAgentIds", "localAgentCheckArguments", "REQUIRED_MCP_TOOL_NAMES", "Missing MCP tools", "LOCAL_AGENT_PDFTOTEXT_BIN", "LOCAL_AGENT_PDFTOPPM_BIN"]
  },
  {
    id: "candidate.sources",
    description: "Candidate source search, bounded multi-hop citation-network expansion, merge, explainable ranking, and record conversion runtime is present",
    files: ["addon/content/candidate-sources.js"],
    markers: ["searchCandidateSources", "expandCandidateCitationNetwork", "buildCitationNetworkRequests", "maxHops", "maxNetworkRequests", "nextCitationFrontier", "networkHop", "parseSemanticScholarCitationNetworkResponse", "mergeCandidateRecords", "candidateRecordFromPaper", "sortCandidateRecords", "candidatePriority"]
  },
  {
    id: "candidate.actions",
    description: "Workbench supports candidate search, citation-network expansion, review export, import, PDF attachment, and duplicate reconciliation",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js"],
    markers: [
      "zms-search-candidates",
      "zms-expand-citation-network",
      "zms-citation-policy",
      "zms-citation-direction",
      "zms-candidate-note",
      "candidateScreeningStageLabel",
      "candidateExclusionReasonLabel",
      "candidateReviewUpdateMapFromDom",
      "candidateReviewNote",
      "review_screening",
      "review_note",
      "zms-apply-candidate-recommendations",
      "candidateRecommendationUpdates",
      "zms-export-candidate-review",
      "candidateReviewScreeningBoard",
      "candidateReviewScreeningRows",
      "Screening Board",
      "candidateReviewEvidenceChainQueue",
      "candidateReviewEvidenceRows",
      "Evidence-chain Follow-up",
      "candidateReviewSourceEvidenceSnippets",
      "candidateReviewSourceEvidenceRows",
      "Source Evidence Snippets",
      "enrichCandidatesWithFullTextEvidence",
      "candidateFullTextEvidenceSnippets",
      "candidateFullTextEvidenceDisplayText",
      "candidatePdfEvidenceSource",
      "candidatePdfTextPagesFromLocalBridge",
      "candidatePdfTextPagesFromRawBytes",
      "raw_pdf_byte_text_fallback",
      "pdf-raw-bytes",
      "pdfExtractionQuality",
      "candidatePdfExtractionQualitySummary",
      "candidatePdfBridgeDiagnosticQuality",
      "candidatePdfExtractionQualityNeedsFollowUp",
      "candidatePdfExtractionQualityNextAction",
      "PDF extraction quality",
      "pdf_bytes_unavailable",
      "local_bridge_request_failed",
      "pdf_page_text_unavailable",
      "indexed_text_fallback_used",
      "candidatePdfBridgeArguments",
      "attachmentPdfBase64",
      "indexedTextForEvidence",
      "normalizePdfTextPagesForEvidence",
      "indexedPageMarker",
      "cleanIndexedPageText",
      "repeatedIndexedPageEdgeLines",
      "dehyphenateIndexedText",
      "candidatePdfAnnotationForHit",
      "annotationPageLabel",
      "fullTextEvidenceUpdatedAt",
      "sourceEvidenceLocator",
      "indexed-text:",
      "pdf-page-text:",
      "page-label:",
      "page-span:",
      "sourceHash",
      "zms-import-candidates",
      "zms-attach-candidate-pdfs",
      "zms-reconcile-candidate-duplicates",
      "importIncludedCandidates",
      "expandCandidateCitationNetwork",
      "citationNetworkOptionsFromDom",
      "citationNetworkPolicyDefaults",
      "exportCandidateReview",
      "renderCandidateReviewMarkdown",
      "candidateReviewActionQueue",
      "candidateReviewNextAction",
      "attachCandidatePdfs",
      "reconcileCandidateDuplicates"
    ]
  },
  {
    id: "comparison.report",
    description: "Workbench exports a reusable multi-paper literature matrix report from comparison contexts",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js", "addon/content/messages.js", "tests/workbenchWriteback.test.ts"],
    markers: [
      "zms-export-comparison-report",
      "zms-start-cross-review",
      "exportComparisonReport",
      "startCrossPaperReview",
      "crossReviewPromptWithScope",
      "crossReviewNeedsSelection",
      "renderComparisonReportMarkdown",
      "comparisonReportMarkdownPath",
      "templateVersion: literature-matrix-v1",
      "synthesisVersion: evidence-synthesis-v1",
      "comparisonSynthesisRows",
      "comparisonPairwiseContrastRows",
      "comparisonGapLedgerRows",
      "comparisonReportDone",
      "does not start a cross-paper review when no comparison papers are loaded",
      "builds a scoped cross-paper review prompt"
    ]
  },
  {
    id: "reading-log.report",
    description: "Workbench exports a reusable single-paper reading log with evidence labels and manual note fields",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js", "addon/content/messages.js", "tests/workbenchWriteback.test.ts"],
    markers: [
      "zms-export-reading-log",
      "exportReadingLog",
      "renderReadingLogMarkdown",
      "readingLogMarkdownPath",
      "templateVersion: paper-reading-log-v1",
      "readingLogDone"
    ]
  },
  {
    id: "review-draft.report",
    description: "Workbench exports a reusable formal review draft with evidence labels, taxonomy sections, and writing checks",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js", "addon/content/messages.js", "tests/workbenchWriteback.test.ts"],
    markers: [
      "zms-export-review-draft",
      "exportReviewDraft",
      "renderReviewDraftMarkdown",
      "reviewDraftMarkdownPath",
      "templateVersion: formal-review-draft-v1",
      "reviewDraftDone"
    ]
  },
  {
    id: "proposal-journal.templates",
    description: "Workbench exports proposal notes and journal/report outlines with evidence labels, domain writing structures, and evidence requirements",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js", "addon/content/messages.js", "tests/workbenchWriteback.test.ts"],
    markers: [
      "zms-export-proposal-note",
      "zms-export-journal-outline",
      "exportProposalNote",
      "renderProposalNoteMarkdown",
      "proposalNoteMarkdownPath",
      "templateVersion: proposal-note-v3",
      "proposalDomainChecklist",
      "proposalDomainWritingStructure",
      "proposalDisciplineWritingExamples",
      "proposalDisciplineWritingStyleTemplates",
      "proposalDisciplineReviewerChecklist",
      "proposalParagraphLevelExamples",
      "exportJournalOutline",
      "renderJournalOutlineMarkdown",
      "journalOutlineMarkdownPath",
      "templateVersion: journal-outline-v5",
      "journalDomainChecklist",
      "journalDomainWritingStructure",
      "journalVenueWritingStructures",
      "journalVenueReviewerCriteria",
      "journalVenueAcceptanceExamples",
      "journalDisciplineWritingExamples",
      "journalDisciplineWritingStyleTemplates",
      "journalDisciplineReviewerChecklist",
      "journalParagraphLevelExamples",
      "journalLongManuscriptParagraphExamples",
      "journalFullSectionDraftExamples",
      "Domain Writing Format",
      "Venue-Specific Writing Patterns",
      "Venue-Specific Reviewer Criteria",
      "Venue-Specific Acceptance Examples",
      "Discipline-Style Writing Examples",
      "Writing Style Templates",
      "Field-Specific Reviewer Checklist",
      "Paragraph-Level Revision Examples",
      "Longer Manuscript Paragraph Examples",
      "Full-Section Manuscript Drafts",
      "投稿类型审稿标准",
      "投稿录用信号示例",
      "写作风格模板",
      "分领域审稿核查清单",
      "段落级改写示例",
      "长篇正文段落示例",
      "完整章节级正文草稿",
      "Writing Structure",
      "proposalNoteDone",
      "journalOutlineDone"
    ]
  },
  {
    id: "collection.workspace",
    description: "Collection workspace artifacts, cross-collection synthesis index, gap board, theme merge review board, chart review triage and drilldown, topic clustering, synthesis claims, conflict ledger, synthesis roadmap, review writing packs, and summary insight extraction are wired",
    files: ["addon/bootstrap.js"],
    markers: ["writeCollectionWorkspace", "writeCrossCollectionSynthesisIndex", "cross-collection-synthesis", "crossCollectionGapEntries", "crossCollectionGapPriorityRanking", "Gap Priority Score", "Gap Priority Signals", "Cross-Collection Gap Board", "crossCollectionSynthesisLayoutEntries", "Cross-Collection Synthesis Layout Board", "Layout Lane", "Layout Weight", "crossCollectionThemeMergeEntries", "Theme Merge Review Board", "crossCollectionClusterCalibrationEntries", "Cluster Threshold Calibration Board", "crossCollectionClusterEvidenceCardEntries", "crossCollectionClusterEvidenceCardRanking", "Evidence Card Rank", "Rank Signals", "crossCollectionChartReviewTriageEntries", "chartReviewTriage", "Cross-Collection Chart Review Triage", "renderCrossCollectionChartReviewDrilldown", "Chart Review Drilldown", "crossCollectionChartReviewWritebackTargets", "writebackTargets", "Batch Status Writeback Targets", "statusPatch", "crossCollectionChartReviewChecklistOpenIndexes", "renderCrossCollectionReviewPack", "Cross-Collection Review Pack", "loadBatchSummaryInsights", "extractSummaryInsights", "renderMethodMatrix", "renderResearchGapMatrix", "renderTopicClusters", "renderSynthesisClaimsMatrix", "synthesisClaimEvidenceAudit", "Claim Support Score", "Claim Evidence Audit", "synthesisRoadmapReadinessEntries", "Roadmap Readiness Board", "Readiness Score", "Blocking Issue", "roadmapFinalReportCalibrationEntries", "Final Report Calibration Matrix", "最终报告校准矩阵", "renderSynthesisConflictLedger", "renderSynthesisRoadmap", "renderFormalReviewReport", "renderFormalReportWritingReadinessGate", "formalReportWritingReadinessSummary", "Writing Readiness Gate", "Formal report readiness score", "formalReportSectionReadinessEntries", "renderFormalReportSectionReadinessMatrix", "Section Readiness Matrix", "章节就绪矩阵", "renderCollectionSynthesisWritingPack", "Synthesis Writing Pack", "loadCollectionChartReviewBatchIndex", "renderCollectionChartReviewBatchIndex", "chart-review-batch-index", "Cross-Report Batch Review Board", "formal-review-report", "synthesis-claims", "synthesis-conflicts", "synthesis-roadmap", "topicClusterEntries", "synthesisClaimEntries", "synthesisConflictEntries", "synthesisRoadmapEntries"]
  },
  {
    id: "markdown.writeback",
    description: "Summary writeback keeps preview, backup, and atomic write boundaries",
    files: ["addon/content/workbench.js", "addon/content/bootstrap-summary-store.js", "scripts/verify-writeback-smoke.mjs", "tests/writebackSmokeScript.test.ts"],
    markers: ["writePreviewSummary", "backupSummaryPath", "writeTextAtomic", "applyMarkdownEdit", "runWritebackSmoke", "verify:writeback", "failure.rollback"]
  },
  {
    id: "context.evidence-chunks",
    description: "Paper context chunks carry hash-stable evidence ids and prompt labels",
    files: ["addon/content/workbench.js", "src/context.ts"],
    markers: ["stableChunkId", "chunkEvidenceLabel", "sourceHash", "locator"]
  },
  {
    id: "ui.embedded-surfaces",
    description: "Toolbar, side pane, embedded workbench, and embedded reader entry points are present",
    files: ["addon/bootstrap.js", "addon/content/bootstrap-ui.js"],
    markers: ["registerToolbarButton", "registerSidenavButton", "openEmbeddedWorkbench", "openEmbeddedReader", "removeFallbackWorkbenchButton"]
  },
  {
    id: "ui.runtime-wiring",
    description: "Bootstrap UI runtime creates and exercises toolbar, side pane, embedded workbench, reader, close, refresh, and frame fallback behavior",
    files: ["tests/bootstrapUiRuntime.test.ts"],
    markers: [
      "registerToolbarButton",
      "registerSidenavButton",
      "does not create a floating fallback button when Zotero has no visible button host yet",
      "does not create a floating fallback button when only a side-nav icon is available",
      "removes a stale floating fallback button during button refresh",
      "openEmbeddedWorkbench",
      "opens the embedded workbench when the HTML side-nav button is clicked",
      "closes the embedded workbench and restores the dock host layout",
      "opens the embedded Markdown reader without letting selection refresh replace it",
      "retries an unusable embedded chrome frame with the root fallback URL",
      "zotero-markdown-summary-workbench-frame",
      "embedded=1",
      "uses HTML elements"
    ]
  },
  {
    id: "ui.entry-click-fallback",
    description: "Toolbar clicks and Tools menu entries can open the workbench from the current Zotero selection",
    files: ["addon/content/bootstrap-ui.js", "tests/bootstrapUiRuntime.test.ts"],
    markers: ["button.addEventListener(\"click\"", "selectedRegularItems().length > 0", "keeps tools menu entries enabled", "workbenchItemContextAvailable", "openWorkbenchDialog"]
  },
  {
    id: "workbench.standalone-pdf-selection",
    description: "Workbench can open parented attachments and top-level PDF attachments without enabling regular-item batch actions",
    files: ["addon/content/bootstrap-zotero-item.js", "addon/content/workbench.js", "tests/bootstrapProvider.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["selectedWorkbenchItems", "isPdfAttachmentItem", "top-level PDF", "standalone PDF attachments"]
  },
  {
    id: "workbench.concurrent-send-guard",
    description: "Workbench prevents overlapping model requests from replacing the active abort controller",
    files: ["addon/content/workbench.js", "tests/workbenchWriteback.test.ts"],
    markers: ["requestInFlight", "prevents overlapping send requests", "abortController = null"]
  },
  {
    id: "workbench.script-bound-actions",
    description: "Workbench actions are bound from script so Zotero chrome does not depend on inline XUL event handlers",
    files: ["addon/content/workbench.js", "addon/content/workbench.xhtml", "tests/workbenchWriteback.test.ts"],
    markers: ["bindActions", "window.addEventListener(\"load\"", "binds workbench actions from script", "zms-send", "zmsShortcutBound", "zmsFocusBound", "queueComposerFocus", "autofocus", "keydown"]
  },
  {
    id: "workbench.embedded-usable-layout",
    description: "Embedded workbench opens as a chat-first surface with configuration moved behind a settings drawer",
    files: ["addon/content/workbench.css", "addon/content/workbench.xhtml", "addon/content/bootstrap-ui.js"],
    markers: [
      "zms-chat-bar",
      "zms-settings-toggle",
      "data-settings-open",
      "zms-quick-settings-heading",
      "zms-settings-details",
      "zms-composer-toolbar",
      "zms-send-button",
      "data-zms-panel=\"paper\"",
      "data-zms-panel=\"candidates\"",
      "focusEmbeddedFrame"
    ]
  },
  {
    id: "workbench.markdown-stream-rendering",
    description: "Workbench assistant output is rendered as streaming Markdown with formula delimiters",
    files: ["addon/content/markdown-render.js", "addon/content/workbench.js", "addon/content/workbench.xhtml", "tests/markdownRenderRuntime.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: [
      "ZMSMarkdownRenderer",
      "renderMessageContent",
      "zms-math-display",
      "zms-math-inline",
      "zms-tex-frac",
      "zmsAppendTex",
      "renders assistant streaming output through the markdown renderer"
    ]
  },
  {
    id: "workbench.answer-copy-control",
    description: "Assistant answers expose a prominent raw Markdown copy button with feedback",
    files: ["addon/content/workbench.js", "addon/content/workbench.css", "addon/content/messages.js", "tests/workbenchWriteback.test.ts"],
    markers: [
      "zms-message-toolbar",
      "zms-message-copy",
      "copyAnswer",
      "copied",
      "copySelectedWorkbenchText",
      "selectedWorkbenchText",
      "-moz-user-select: text",
      "copies assistant Markdown from the prominent answer button",
      "copies the current native selection when it comes from message text"
    ]
  },
  {
    id: "workbench.p2-composer-controls",
    description: "Workbench composer uses compact controls, one settings drawer, and circular send/stop buttons inspired by modern chat inputs",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.css", "addon/content/workbench.js", "tests/workbenchWriteback.test.ts"],
    markers: [
      "zms-composer-toolbar",
      "zms-composer-profile",
      "zms-skill",
      "literature-review-synthesis",
      "zms-send-button",
      "saveProfileSettings",
      "zms-attach-image"
    ]
  },
  {
    id: "workbench.figure-table-extraction-contract",
    description: "Figure/table extraction uses a structured visual OCR, table reconstruction, evidence-map, review-checklist output contract, and reusable Markdown plus JSON/CSV export",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js", "tests/workbenchWriteback.test.ts", "README.md", "README.zh-CN.md"],
    markers: [
      "zms-export-visual-report",
      "zms-load-visual-review",
      "zms-save-visual-review",
      "renderVisualExtractionReportMarkdown",
      "visual-extraction-report-v2",
      "Visual OCR Text",
      "Reconstructed Data Table",
      "visualExtractionChartDataDrafts",
      "chartDataDraftCount",
      "visualExtractionChartQualityReview",
      "chartQualityStatus",
      "Chart Data Quality Review",
      "chartLayoutDiagnostics",
      "visualExtractionChartLayoutDiagnostics",
      "Chart Layout Diagnostics",
      "chartPanelCount",
      "chartAxisSegmentCount",
      "chartAxisSegmentCalibrationMapCount",
      "chartAxisBreakCueCount",
      "visualExtractionAxisBreakCues",
      "Axis Break Visual Cues",
      "axis-break-cues",
      "verify-axis-break-cues",
      "Broken-Axis Calibration Map",
      "calibrationConfidence",
      "calibrationRisk",
      "pixelGapToNextSegment",
      "valueGapToNextSegment",
      "gapStatusToNextSegment",
      "gapRiskToNextSegment",
      "layout-axis-break:",
      "panelSplitCandidates",
      "chartPanelSplitCandidateCount",
      "panelSplitValidationStatus",
      "panelSplitValidationScore",
      "visualExtractionPanelSplitGeometryHints",
      "visualExtractionPanelSplitGeometryQuality",
      "geometryStatus",
      "geometryScore",
      "columnGutter",
      "rowGutter",
      "Split validation score",
      "分割校验分",
      "panel-split-validation",
      "validate-panel-split-candidates",
      "Automatic Panel Split Candidates",
      "layout-split:",
      "heuristic-panel-split",
      "layout-coverage",
      "dense-confidence",
      "visualExtractionChartBatchReviewBoardRows",
      "chartReviewBatchCount",
      "Chart Batch Review Board",
      "Chart Data Drafts",
      "visualExtractionPixelDataDrafts",
      "pixelDataDraftCount",
      "Pixel / Coordinate Data Draft",
      "Pixel / Coordinate Data Drafts",
      "axis-calibration-range-table",
      "Pixel Start",
      "Value End",
      "rangeEndpoint",
      "visualExtractionReportJsonPath",
      "renderVisualExtractionReportCsv",
      "loadVisualReviewState",
      "saveVisualReviewState",
      "visualReviewActionUpdateMapFromDom",
      "applyVisualReviewActionUpdates",
      "visualExtractionLocalOcrMetadata",
      "项目、数值/文本、单位、来源、置信度、备注",
      "Interpretation And Evidence Map",
      "视觉 OCR 文本",
      "表格/数据重建",
      "uses a structured visual OCR and table reconstruction contract",
      "图表数据草稿",
      "renders a figure/table extraction report",
      "exports a figure/table extraction report"
    ]
  },
  {
    id: "runtime.zotero-verifier",
    description: "Installed package and live Zotero local runtime can be verified separately from build checks",
    files: ["scripts/verify-zotero-runtime.mjs"],
    markers: ["verifyZoteroRuntime", "/connector/ping", "/api/users/0/items/top?limit=1"]
  }
];

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    includeXpi: true,
    requireXpi: false,
    xpiPath: DEFAULT_XPI_PATH
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--skip-xpi") {
      options.includeXpi = false;
    } else if (arg === "--require-xpi") {
      options.requireXpi = true;
      options.includeXpi = true;
    } else if (arg === "--xpi") {
      options.xpiPath = argv[index + 1] || options.xpiPath;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function collectReadinessChecks(options = {}) {
  const normalizedOptions = {
    includeXpi: options.includeXpi !== false,
    requireXpi: Boolean(options.requireXpi),
    xpiPath: options.xpiPath || DEFAULT_XPI_PATH
  };
  const checks = [];

  addRequiredFileChecks(checks);
  addPackageScriptChecks(checks);
  addProfileChecks(checks);
  addSkillChecks(checks);
  addSourceMarkerChecks(checks);
  addReadmeReleaseLinkChecks(checks);
  addReadmeUiTextChecks(checks);
  addXpiChecks(checks, normalizedOptions);

  return {
    summary: summarizeChecks(checks),
    checks
  };
}

export function readDefaultProfiles(prefsPath = "addon/prefs.js") {
  const prefs = readText(prefsPath);
  const match = prefs.match(/pref\("profilesJson",\s*"((?:\\.|[^"\\])*)"\);/);
  if (!match) {
    throw new Error("profilesJson preference is missing");
  }
  const rawJson = JSON.parse(`"${match[1]}"`);
  const profiles = JSON.parse(rawJson);
  if (!Array.isArray(profiles)) {
    throw new Error("profilesJson must contain an array");
  }
  return profiles;
}

export function summarizeChecks(checks) {
  return checks.reduce((summary, check) => {
    summary.total += 1;
    summary[check.status] += 1;
    return summary;
  }, { total: 0, pass: 0, warn: 0, fail: 0 });
}

function addRequiredFileChecks(checks) {
  for (const file of REQUIRED_FILES) {
    checks.push(check(
      `file.${file}`,
      `Required project file exists: ${file}`,
      existsSync(file),
      file,
      "Required file is missing"
    ));
  }
}

function addPackageScriptChecks(checks) {
  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts || {};
  for (const script of REQUIRED_PACKAGE_SCRIPTS) {
    checks.push(check(
      `package.script.${script}`,
      `npm script is available: ${script}`,
      typeof scripts[script] === "string" && scripts[script].trim().length > 0,
      scripts[script] || "",
      "Missing npm script"
    ));
  }

  const checkScript = String(scripts.check || "");
  checks.push(check(
    "package.script.check-readiness",
    "npm run check includes readiness verification",
    checkScript.includes("readiness:check"),
    checkScript,
    "Add npm run readiness:check to the check chain"
  ));
  checks.push(check(
    "package.script.check-zip",
    "npm run check includes package zip integrity verification",
    checkScript.includes("verify:zip"),
    checkScript,
    "Add npm run verify:zip to the check chain"
  ));
  checks.push(check(
    "package.script.check-provider-mock",
    "npm run check includes provider mock smoke verification",
    checkScript.includes("verify:provider:mock"),
    checkScript,
    "Add npm run verify:provider:mock to the check chain"
  ));
  checks.push(check(
    "package.script.check-provider-multimodal-mock",
    "npm run check includes provider multimodal mock verification",
    checkScript.includes("verify:provider:multimodal:mock"),
    checkScript,
    "Add npm run verify:provider:multimodal:mock to the check chain"
  ));
  checks.push(check(
    "package.script.check-provider-catalog",
    "npm run check includes provider catalog shape verification",
    checkScript.includes("verify:provider:catalog"),
    checkScript,
    "Add npm run verify:provider:catalog to the check chain"
  ));
  checks.push(check(
    "package.script.check-provider-models-mock",
    "npm run check includes provider model-list mock verification",
    checkScript.includes("verify:provider:models:mock"),
    checkScript,
    "Add npm run verify:provider:models:mock to the check chain"
  ));
  checks.push(check(
    "package.script.check-writeback",
    "npm run check includes writeback smoke verification",
    checkScript.includes("verify:writeback"),
    checkScript,
    "Add npm run verify:writeback to the check chain"
  ));
}

function addProfileChecks(checks) {
  let profiles = [];
  try {
    profiles = readDefaultProfiles();
    checks.push(pass("profiles.parse", "Default provider profiles parse as JSON", `${profiles.length} profile(s)`));
  } catch (err) {
    checks.push(fail("profiles.parse", "Default provider profiles parse as JSON", err?.message || String(err)));
    return;
  }

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  for (const id of REQUIRED_PROFILE_IDS) {
    checks.push(check(
      `profiles.default.${id}`,
      `Default provider profile exists: ${id}`,
      byId.has(id),
      byId.get(id)?.protocol || "",
      "Missing default provider profile"
    ));
  }

  checks.push(check(
    "profiles.openai.responses",
    "OpenAI default uses Responses protocol",
    byId.get("openai")?.protocol === "openai_responses",
    byId.get("openai")?.protocol || "",
    "OpenAI profile should use openai_responses"
  ));
  checks.push(check(
    "profiles.anthropic.messages",
    "Anthropic default uses Messages protocol",
    byId.get("anthropic")?.protocol === "anthropic_messages",
    byId.get("anthropic")?.protocol || "",
    "Anthropic profile should use anthropic_messages"
  ));
  checks.push(check(
    "profiles.local-agents.endpoint",
    "Local Agents default routes to the local HTTP MCP bridge",
    byId.get("local-agents")?.bodyExtra?.localAgent?.endpoint === "http://127.0.0.1:3333/mcp",
    byId.get("local-agents")?.bodyExtra?.localAgent?.endpoint || "",
    "Local Agents endpoint should be http://127.0.0.1:3333/mcp"
  ));
  checks.push(check(
    "profiles.local-agents.health-timeout",
    "Local Agents health check has a bounded default timeout",
    byId.get("local-agents")?.bodyExtra?.localAgent?.["check-local-agents"]?.args?.timeoutSeconds === 30,
    byId.get("local-agents")?.bodyExtra?.localAgent?.["check-local-agents"]?.args?.timeoutSeconds || "",
    "Local Agents check-local-agents should default to args.timeoutSeconds=30"
  ));
  const localAgentConfig = byId.get("local-agents")?.bodyExtra?.localAgent || {};
  for (const [skillId, toolName] of [
    ["ask-gemini", "ask_gemini"],
    ["ask-claude", "ask_claude"],
    ["ask-opencode", "ask_opencode"],
    ["ask-all-agents", "ask_all_agents"],
    ["ask-gemini-claude", "ask_all_agents"],
    ["check-local-agents", "check_local_agents"],
    ["extract-pdf-pages", "extract_pdf_pages"]
  ]) {
    checks.push(check(
      `profiles.local-agents.skill.${skillId}`,
      `Local Agents default profile explicitly maps ${skillId}`,
      localAgentConfig?.[skillId]?.tool === toolName,
      localAgentConfig?.[skillId]?.tool || "",
      `Local Agents ${skillId} should map to ${toolName}`
    ));
  }
}

function addSkillChecks(checks) {
  const skills = readText("src/skills.ts");
  for (const id of REQUIRED_SKILL_IDS) {
    checks.push(check(
      `skills.local-agent.${id}`,
      `Local-agent skill is registered: ${id}`,
      skills.includes(`id: "${id}"`),
      id,
      "Missing local-agent skill registration"
    ));
  }
}

function addSourceMarkerChecks(checks) {
  for (const spec of SOURCE_MARKERS) {
    const fileText = spec.files.map((file) => ({ file, text: readText(file) }));
    for (const marker of spec.markers) {
      const matchingFiles = fileText.filter((entry) => entry.text.includes(marker)).map((entry) => entry.file);
      checks.push(check(
        `${spec.id}.${marker}`,
        `${spec.description}: ${marker}`,
        matchingFiles.length > 0,
        matchingFiles.join(", "),
        `Marker not found in ${spec.files.join(", ")}`
      ));
    }
  }
}

function addReadmeReleaseLinkChecks(checks) {
  for (const file of ["README.md", "README.zh-CN.md"]) {
    const text = readText(file);
    checks.push(check(
      `readme.release-link.latest.${file}`,
      `${file} points users at the latest GitHub release page`,
      text.includes(LATEST_RELEASE_URL),
      file,
      "Use the GitHub latest release URL instead of a fixed version tag"
    ));
    checks.push(check(
      `readme.release-link.xpi.${file}`,
      `${file} points users at the latest XPI download URL`,
      text.includes(LATEST_XPI_URL),
      file,
      "Use the GitHub latest XPI URL instead of a fixed version download"
    ));
    checks.push(check(
      `readme.release-link.no-versioned.${file}`,
      `${file} does not contain stale fixed-version release links`,
      !VERSIONED_RELEASE_LINK_PATTERN.test(text),
      file,
      "README release links should use /releases/latest"
    ));
  }
}

function addReadmeUiTextChecks(checks) {
  const specs = [
    {
      file: "README.md",
      required: [
        { id: "load-model-list", marker: "`Load model list`" },
        { id: "model-vendor", marker: "`Model vendor`" },
        { id: "restores-provider-credentials", marker: "switching back to a previously saved provider restores that provider's own key and model" }
      ],
      forbidden: [
        { id: "old-refresh-online-models", marker: "`Refresh online models`" },
        { id: "refresh-models", marker: "`Refresh models`" },
        { id: "clears-old-api-key", marker: "clears the old API key" }
      ]
    },
    {
      file: "README.zh-CN.md",
      required: [
        { id: "load-model-list", marker: "`加载模型列表`" },
        { id: "model-vendor", marker: "`模型厂商`" },
        { id: "restores-provider-credentials", marker: "切回已保存过的厂商时会恢复该厂商自己的 key 和模型" }
      ],
      forbidden: [
        { id: "old-refresh-online-models", marker: "`刷新在线模型`" },
        { id: "refresh-models", marker: "`刷新模型`" },
        { id: "clears-old-api-key", marker: "清空旧 API key" }
      ]
    }
  ];
  for (const spec of specs) {
    const text = readText(spec.file);
    for (const { id, marker } of spec.required) {
      checks.push(check(
        `readme.ui-text.required.${spec.file}.${id}`,
        `${spec.file} documents current provider/model-picker UI wording: ${marker}`,
        text.includes(marker),
        spec.file,
        "README should describe the current provider settings behavior"
      ));
    }
    for (const { id, marker } of spec.forbidden) {
      checks.push(check(
        `readme.ui-text.forbidden.${spec.file}.${id}`,
        `${spec.file} does not document stale provider/model-picker UI wording: ${marker}`,
        !text.includes(marker),
        spec.file,
        "Remove stale provider/model-picker wording from README"
      ));
    }
  }
}

function addXpiChecks(checks, options) {
  if (!options.includeXpi) return;

  if (!existsSync(options.xpiPath)) {
    const status = options.requireXpi ? "fail" : "warn";
    checks.push({
      id: "package.xpi.exists",
      description: `Build package exists: ${options.xpiPath}`,
      status,
      detail: options.xpiPath,
      message: "Run npm run build before package-level readiness checks"
    });
    return;
  }

  checks.push(pass("package.xpi.exists", `Build package exists: ${options.xpiPath}`, options.xpiPath));

  let entries = [];
  try {
    execFileSync("unzip", ["-t", options.xpiPath], { stdio: "pipe" });
    checks.push(pass("package.xpi.integrity", "Build package passes unzip integrity test", options.xpiPath));
    entries = execFileSync("unzip", ["-Z1", options.xpiPath], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (err) {
    checks.push(fail("package.xpi.integrity", "Build package passes unzip integrity test", err?.message || String(err)));
    return;
  }

  const entrySet = new Set(entries);
  for (const entry of REQUIRED_XPI_ENTRIES) {
    checks.push(check(
      `package.xpi.entry.${entry}`,
      `Build package contains ${entry}`,
      entrySet.has(entry),
      entry,
      "Package entry is missing"
    ));
  }
}

function check(id, description, condition, detail = "", message = "Check failed") {
  return condition ? pass(id, description, detail) : fail(id, description, message, detail);
}

function pass(id, description, detail = "") {
  return { id, description, status: "pass", detail: String(detail || "") };
}

function fail(id, description, message, detail = "") {
  return { id, description, status: "fail", detail: String(detail || ""), message };
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function printReport(report) {
  const { summary, checks } = report;
  const status = summary.fail ? "failed" : summary.warn ? "passed with warnings" : "passed";
  console.log(`Project readiness check ${status}: ${summary.pass} passed, ${summary.warn} warning(s), ${summary.fail} failed`);

  for (const checkItem of checks.filter((item) => item.status !== "pass")) {
    const suffix = checkItem.detail ? ` (${checkItem.detail})` : "";
    console.log(`- [${checkItem.status}] ${checkItem.id}: ${checkItem.message || checkItem.description}${suffix}`);
  }
}

function isMainModule() {
  const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
  return import.meta.url === entry || basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] || "");
}

if (isMainModule()) {
  try {
    const options = parseArgs();
    const report = collectReadinessChecks(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
    if (report.summary.fail > 0) process.exit(1);
  } catch (err) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}
