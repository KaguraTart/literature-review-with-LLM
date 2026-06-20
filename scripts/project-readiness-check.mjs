import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_XPI_PATH = "build/literature-review-with-llm.xpi";

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
  "github-models",
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
    files: ["addon/manifest.json", "scripts/build-update-manifest.mjs", "package.json", ".github/workflows/ci.yml"],
    markers: ["update_url", "buildUpdateManifest", "verify:update-manifest", "build/update.json"]
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
    markers: ["openai_responses", "anthropic_messages", "jsonModeBodyDefaults", "openAIChatTokenLimit", "openAIChatOptionalDefaults", "openAIChatStreamOptions", "providerCompatibilityFallback"]
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
    markers: ["--stream", "verify:provider:stream:mock", "mockProviderStreamResponse", "streamTextFromBody", "streamUsageFromBody", "parseStreamChunk", "parseStreamUsage", "stream_options", "runs built-in mock stream checks", "runs live provider stream checks"]
  },
  {
    id: "provider.multimodal-smoke",
    description: "Provider smoke verification covers OpenAI image, Responses PDF/image, and Anthropic image/document request bodies",
    files: ["scripts/verify-provider-smoke.mjs", "package.json", "tests/providerSmokeScript.test.ts"],
    markers: ["--image", "--pdf", "verify:provider:multimodal:mock", "input_image", "input_file", "document", "runs built-in mock image checks", "runs built-in mock PDF checks"]
  },
  {
    id: "provider.catalog-shape-verifier",
    description: "Default provider profiles can be checked offline for endpoint, auth header, model-list capability, and text/image/PDF request-body shape",
    files: ["scripts/verify-provider-smoke.mjs", "package.json", "tests/providerSmokeScript.test.ts"],
    markers: ["runProviderCatalog", "catalogProfileResult", "catalogProfileIssues", "catalogInputChecks", "catalogInputCheck", "--catalog", "verify:provider:catalog", "model-list endpoint present while capability is disabled", "inputChecks", "image_url", "input_file", "document"]
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
    markers: ["zms-providerGuide", "providerSetupGuide", "providerLiveVerifyGuide", "OPENAI_COMPATIBLE_BASE_URL", "ANTHROPIC_COMPATIBLE_BASE_URL", "not.toContain", "routed-secret", "providerGuide"]
  },
  {
    id: "provider.retry-boundary",
    description: "Provider requests retry only retryable HTTP failures and fail fast on bad credentials or invalid requests",
    files: ["addon/bootstrap.js", "addon/content/workbench.js", "tests/bootstrapProvider.test.ts", "tests/workbenchWriteback.test.ts"],
    markers: ["providerHTTPError", "retryableProviderError", "does not retry non-retryable", "retries retryable"]
  },
  {
    id: "provider.input-capability-boundary",
    description: "PDF/base64 input is gated by the same explicit provider capability rule in bootstrap batch generation and the workbench",
    files: ["addon/bootstrap.js", "addon/content/workbench.js", "tests/bootstrapProvider.test.ts"],
    markers: ["canUsePdfBase64Input", "capabilities?.pdfBase64 === true", "protocol !== \"openai_chat\"", "same PDF/base64 capability rule"]
  },
  {
    id: "provider.live-script",
    description: "Provider live verification can skip missing env config and run configured OpenAI, OpenAI-compatible, OpenAI Responses-compatible, Anthropic, image, and PDF checks",
    files: ["scripts/verify-provider-live.mjs", "package.json", "tests/providerSmokeScript.test.ts"],
    markers: ["runProviderLive", "OPENAI_API_KEY", "OPENAI_RESPONSES_COMPATIBLE_BASE_URL", "ANTHROPIC_API_KEY", "OPENAI_COMPATIBLE_BASE_URL", "MINIMAX_API_KEY", "GEMINI_API_KEY", "AZURE_OPENAI_API_KEY", "GITHUB_MODELS_API_KEY", "FIREWORKS_API_KEY", "CEREBRAS_API_KEY", "NVIDIA_NIM_API_KEY", "SAMBANOVA_API_KEY", "SAMBANOVA_ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "ZAI_ANTHROPIC_API_KEY", "allowLocalNoAuth", "isLocalEndpoint", "failOnSkip", "verify:provider:live", "verify:provider:image:live", "verify:provider:pdf:live", "verify:provider:models:live", "runProviderModels", "unsupportedInputReason"]
  },
  {
    id: "provider.model-list-pagination",
    description: "Settings model list loading follows bounded pagination cursors",
    files: ["addon/content/preferences.js"],
    markers: ["fetchModelOptions", "nextModelListURL", "MODEL_LIST_MAX_PAGES"]
  },
  {
    id: "local-agents.bridge",
    description: "Gemini, Claude, opencode, all-agent, and health-check MCP tools are exposed by the local bridge",
    files: ["scripts/local-agent-mcp.mjs"],
    markers: ["ask_gemini", "ask_claude", "ask_opencode", "ask_all_agents", "check_local_agents", "selectedAgentEntries", "allAgentCallArgs", "allAgentTimeoutSeconds"]
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
    description: "Local-agent service diagnostics can check selected agents independently",
    files: ["scripts/local-agent-bridge-service.mjs"],
    markers: ["--agents", "parseAgents", "selectedAgentIds", "localAgentCheckArguments"]
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
      "fullTextEvidenceUpdatedAt",
      "sourceEvidenceLocator",
      "indexed-text:",
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
      "exportComparisonReport",
      "renderComparisonReportMarkdown",
      "comparisonReportMarkdownPath",
      "templateVersion: literature-matrix-v1",
      "comparisonReportDone"
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
    description: "Workbench exports proposal notes and journal/report outlines with evidence labels",
    files: ["addon/content/workbench.xhtml", "addon/content/workbench.js", "addon/content/messages.js", "tests/workbenchWriteback.test.ts"],
    markers: [
      "zms-export-proposal-note",
      "zms-export-journal-outline",
      "exportProposalNote",
      "renderProposalNoteMarkdown",
      "proposalNoteMarkdownPath",
      "templateVersion: proposal-note-v1",
      "exportJournalOutline",
      "renderJournalOutlineMarkdown",
      "journalOutlineMarkdownPath",
      "templateVersion: journal-outline-v1",
      "proposalNoteDone",
      "journalOutlineDone"
    ]
  },
  {
    id: "collection.workspace",
    description: "Collection workspace artifacts, cross-collection synthesis index, topic clustering, synthesis claims, conflict ledger, synthesis roadmap, and summary insight extraction are wired",
    files: ["addon/bootstrap.js"],
    markers: ["writeCollectionWorkspace", "writeCrossCollectionSynthesisIndex", "cross-collection-synthesis", "loadBatchSummaryInsights", "extractSummaryInsights", "renderMethodMatrix", "renderResearchGapMatrix", "renderTopicClusters", "renderSynthesisClaimsMatrix", "renderSynthesisConflictLedger", "renderSynthesisRoadmap", "renderFormalReviewReport", "formal-review-report", "synthesis-claims", "synthesis-conflicts", "synthesis-roadmap", "topicClusterEntries", "synthesisClaimEntries", "synthesisConflictEntries", "synthesisRoadmapEntries"]
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
    markers: ["registerToolbarButton", "registerSidenavButton", "openEmbeddedWorkbench", "openEmbeddedReader"]
  },
  {
    id: "ui.runtime-wiring",
    description: "Bootstrap UI runtime creates and exercises toolbar, side pane, embedded workbench, reader, close, refresh, and frame fallback behavior",
    files: ["tests/bootstrapUiRuntime.test.ts"],
    markers: [
      "registerToolbarButton",
      "registerSidenavButton",
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
      "-moz-user-select: text",
      "copies assistant Markdown from the prominent answer button"
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
      "zms-send-button",
      "saveProfileSettings",
      "zms-attach-image"
    ]
  },
  {
    id: "workbench.figure-table-extraction-contract",
    description: "Figure/table extraction uses a structured visual OCR, table reconstruction, evidence-map, and review-checklist output contract",
    files: ["addon/content/workbench.js", "tests/workbenchWriteback.test.ts", "README.md", "README.zh-CN.md"],
    markers: [
      "Visual OCR Text",
      "Reconstructed Data Table",
      "项目、数值/文本、单位、来源、置信度、备注",
      "Interpretation And Evidence Map",
      "视觉 OCR 文本",
      "表格/数据重建",
      "uses a structured visual OCR and table reconstruction contract"
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
    ["check-local-agents", "check_local_agents"]
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
