#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ADDON_ID = "zotero-markdown-summary@diantao.local";
const DEFAULT_BUILD_XPI = "build/literature-review-with-llm.xpi";
const DEFAULT_PROFILE_ROOT = join(homedir(), "Library/Application Support/Zotero/Profiles");

const REQUIRED_ENTRIES = [
  "bootstrap.js",
  "manifest.json",
  "prefs.js",
  "content/bootstrap-provider.js",
  "content/bootstrap-settings.js",
  "content/bootstrap-summary-store.js",
  "content/bootstrap-zotero-item.js",
  "content/bootstrap-ui.js",
  "content/candidate-sources.js",
  "content/messages.js",
  "content/preferences.xhtml",
  "content/preferences.js",
  "content/workbench.xhtml",
  "content/workbench.js",
  "content/reader.xhtml",
  "content/reader.js"
];

const REQUIRED_MARKERS = [
  ["bootstrap.js", "openEmbeddedWorkbench", "embedded workbench"],
  ["bootstrap.js", "writeBatchRunReport", "batch run report"],
  ["bootstrap.js", "writeCollectionWorkspace", "collection workspace"],
  ["bootstrap.js", "collectionWorkspaceArtifactPaths", "localized collection artifact paths"],
  ["bootstrap.js", "summaryPromptsForSettings", "localized direct summary prompts"],
  ["bootstrap.js", "renderMethodMatrix", "collection method matrix"],
  ["bootstrap.js", "renderResearchQuestionCards", "collection research question cards"],
  ["bootstrap.js", "renderResearchGapMatrix", "collection research gap matrix"],
  ["bootstrap.js", "renderTopicClusters", "collection topic clusters"],
  ["bootstrap.js", "renderIdeaList", "collection idea list"],
  ["bootstrap.js", "topicClusterEntries", "collection topic clustering helper"],
  ["bootstrap.js", "loadBatchSummaryInsights", "collection summary insight loader"],
  ["bootstrap.js", "extractSummaryInsights", "collection summary insight extractor"],
  ["bootstrap.js", "loadBootstrapProviderModule", "bootstrap provider module loader"],
  ["bootstrap.js", "loadBootstrapSettingsModule", "bootstrap settings module loader"],
  ["bootstrap.js", "loadBootstrapSummaryStoreModule", "bootstrap summary-store module loader"],
  ["bootstrap.js", "loadBootstrapZoteroItemModule", "bootstrap Zotero item module loader"],
  ["bootstrap.js", "loadBootstrapUiModule", "bootstrap UI module loader"],
  ["bootstrap.js", "endpointForProtocol(protocol, baseURL)", "versioned provider endpoint routing in bootstrap"],
  ["content/bootstrap-provider.js", "extractOpenAIText", "bootstrap provider OpenAI extraction"],
  ["content/bootstrap-provider.js", "extractAnthropicStreamText", "bootstrap provider Anthropic stream parser"],
  ["content/bootstrap-provider.js", "jsonModeBodyDefaults", "bootstrap provider JSON mode defaults"],
  ["content/bootstrap-provider.js", "openAICompatibleBaseWithVersion", "bootstrap provider OpenAI-compatible versioned base URL helper"],
  ["content/bootstrap-provider.js", "usesVersionlessOpenAICompatibleBase", "bootstrap provider versionless OpenAI-compatible base URL helper"],
  ["content/bootstrap-provider.js", "anthropicAuthHeaderName", "bootstrap provider Anthropic-compatible auth header selection"],
  ["content/bootstrap-provider.js", "shouldAddAnthropicDirectBrowserAccess", "bootstrap provider Anthropic direct browser access opt-in"],
  ["content/bootstrap-settings.js", "getSettings", "bootstrap settings reader"],
  ["content/bootstrap-settings.js", "settingsProviderDefaults", "bootstrap settings provider defaults"],
  ["content/bootstrap-settings.js", "azure_openai", "Azure OpenAI provider detection in bootstrap settings"],
  ["content/bootstrap-settings.js", "gemini", "Gemini provider detection in bootstrap settings"],
  ["content/bootstrap-settings.js", "ask-gemini-claude", "bootstrap settings local-agent default skill fallback"],
  ["content/bootstrap-summary-store.js", "writeSummaryMarkdown", "bootstrap summary-store writer"],
  ["content/bootstrap-summary-store.js", "writeTextAtomic", "bootstrap summary-store atomic writer"],
  ["content/bootstrap-zotero-item.js", "findPdfAttachment", "bootstrap Zotero item PDF resolver"],
  ["content/bootstrap-zotero-item.js", "collectionContextFromItem", "bootstrap Zotero item collection context"],
  ["content/bootstrap-ui.js", "openEmbeddedWorkbench", "bootstrap UI embedded workbench"],
  ["content/bootstrap-ui.js", "registerSidenavButton", "bootstrap UI side button"],
  ["content/candidate-sources.js", "searchCandidateSources", "candidate source search runtime"],
  ["content/candidate-sources.js", "mergeCandidateRecords", "candidate record merge runtime"],
  ["content/preferences.js", "providerErrorText", "settings provider error formatter"],
  ["content/preferences.js", "loadProfileEditor", "settings profile load action"],
  ["content/preferences.js", "openAICompatibleBaseWithVersion", "settings OpenAI-compatible versioned base URL helper"],
  ["content/preferences.js", "mergeDefaultProviderProfiles", "default profile migration in settings"],
  ["content/preferences.xhtml", "value=\"openai_responses_compatible\"", "OpenAI Responses-compatible provider preset"],
  ["content/preferences.xhtml", "value=\"gemini\"", "Gemini provider preset"],
  ["content/preferences.xhtml", "value=\"azure_openai\"", "Azure OpenAI provider preset"],
  ["content/preferences.xhtml", "value=\"xai\"", "xAI provider preset"],
  ["content/preferences.xhtml", "value=\"groq\"", "Groq provider preset"],
  ["content/preferences.xhtml", "value=\"mistral\"", "Mistral provider preset"],
  ["content/preferences.xhtml", "value=\"together\"", "Together AI provider preset"],
  ["content/preferences.xhtml", "value=\"kimi\"", "Kimi provider preset"],
  ["content/preferences.xhtml", "value=\"perplexity\"", "Perplexity provider preset"],
  ["content/preferences.xhtml", "value=\"deepseek\"", "DeepSeek provider preset"],
  ["content/preferences.xhtml", "value=\"deepseek_anthropic\"", "DeepSeek Anthropic provider preset"],
  ["content/preferences.xhtml", "value=\"zai_anthropic\"", "Z.AI Anthropic provider preset"],
  ["content/preferences.xhtml", "value=\"openrouter\"", "OpenRouter provider preset"],
  ["content/preferences.xhtml", "value=\"dashscope\"", "DashScope provider preset"],
  ["content/preferences.xhtml", "value=\"siliconflow\"", "SiliconFlow provider preset"],
  ["content/preferences.xhtml", "value=\"zhipu\"", "Zhipu provider preset"],
  ["content/preferences.xhtml", "value=\"volcengine\"", "Volcengine provider preset"],
  ["content/preferences.xhtml", "value=\"qianfan\"", "Qianfan provider preset"],
  ["content/preferences.xhtml", "value=\"hunyuan\"", "Hunyuan provider preset"],
  ["content/preferences.xhtml", "value=\"ollama\"", "Ollama provider preset"],
  ["content/preferences.xhtml", "value=\"lm_studio\"", "LM Studio provider preset"],
  ["content/preferences.xhtml", "value=\"ask-gemini-claude\"", "Gemini and Claude skill preset"],
  ["prefs.js", "\"id\":\"openai-responses-compatible\"", "default OpenAI-compatible Responses profile"],
  ["prefs.js", "\"baseURL\":\"https://YOUR-OPENAI-RESPONSES-COMPATIBLE-ENDPOINT/v1\"", "OpenAI-compatible Responses base URL template"],
  ["prefs.js", "\"id\":\"gemini\"", "default Gemini profile"],
  ["prefs.js", "\"baseURL\":\"https://generativelanguage.googleapis.com/v1beta/openai\"", "Gemini OpenAI-compatible base URL"],
  ["prefs.js", "\"id\":\"azure-openai\"", "default Azure OpenAI profile"],
  ["prefs.js", "\"baseURL\":\"https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1\"", "Azure OpenAI v1 base URL template"],
  ["prefs.js", "\"id\":\"xai\"", "default xAI profile"],
  ["prefs.js", "\"baseURL\":\"https://api.x.ai/v1\"", "xAI OpenAI-compatible base URL"],
  ["prefs.js", "\"id\":\"groq\"", "default Groq profile"],
  ["prefs.js", "\"baseURL\":\"https://api.groq.com/openai/v1\"", "Groq OpenAI-compatible base URL"],
  ["prefs.js", "\"id\":\"mistral\"", "default Mistral profile"],
  ["prefs.js", "\"baseURL\":\"https://api.mistral.ai/v1\"", "Mistral OpenAI-compatible base URL"],
  ["prefs.js", "\"id\":\"together\"", "default Together AI profile"],
  ["prefs.js", "\"baseURL\":\"https://api.together.ai/v1\"", "Together AI OpenAI-compatible base URL"],
  ["prefs.js", "\"id\":\"kimi\"", "default Kimi profile"],
  ["prefs.js", "\"baseURL\":\"https://api.moonshot.ai/v1\"", "Kimi OpenAI-compatible base URL"],
  ["prefs.js", "\"id\":\"perplexity\"", "default Perplexity profile"],
  ["prefs.js", "\"baseURL\":\"https://api.perplexity.ai\"", "Perplexity OpenAI-compatible base URL"],
  ["prefs.js", "\"id\":\"deepseek\"", "default DeepSeek profile"],
  ["prefs.js", "\"id\":\"anthropic-compatible\"", "default Anthropic-compatible profile"],
  ["prefs.js", "\"id\":\"deepseek-anthropic\"", "default DeepSeek Anthropic profile"],
  ["prefs.js", "\"id\":\"zai-anthropic\"", "default Z.AI Anthropic profile"],
  ["prefs.js", "\"id\":\"openrouter\"", "default OpenRouter profile"],
  ["prefs.js", "\"id\":\"dashscope\"", "default DashScope profile"],
  ["prefs.js", "\"id\":\"siliconflow\"", "default SiliconFlow profile"],
  ["prefs.js", "\"id\":\"zhipu\"", "default Zhipu profile"],
  ["prefs.js", "\"id\":\"volcengine\"", "default Volcengine profile"],
  ["prefs.js", "\"id\":\"qianfan\"", "default Qianfan profile"],
  ["prefs.js", "\"id\":\"hunyuan\"", "default Hunyuan profile"],
  ["prefs.js", "\"id\":\"ollama\"", "default Ollama profile"],
  ["prefs.js", "\"id\":\"lm-studio\"", "default LM Studio profile"],
  ["prefs.js", "\"ask-gemini-claude\":{\"tool\":\"ask_all_agents\",\"args\":{\"agents\":[\"gemini\",\"claude\"]}}", "default Gemini and Claude local-agent skill mapping"],
  ["content/workbench.js", "requestInputStatusText", "request input status display"],
  ["content/workbench.js", "mergeDefaultProviderProfiles", "default profile migration in workbench"],
  ["content/workbench.js", "openAICompatibleBaseWithVersion", "workbench OpenAI-compatible versioned base URL helper"],
  ["content/workbench.js", "searchCandidates", "workbench candidate search action"],
  ["content/workbench.js", "importIncludedCandidates", "workbench candidate import action"],
  ["content/workbench.js", "importCandidateIntoZotero", "workbench Zotero candidate import helper"],
  ["content/workbench.js", "normalizedCandidateTitle", "workbench candidate title dedupe fallback"],
  ["content/workbench.js", "attachCandidatePdfs", "workbench candidate PDF attachment action"],
  ["content/workbench.js", "attachCandidatePdfToZotero", "workbench Zotero candidate PDF attachment helper"],
  ["content/workbench.js", "reconcileCandidateDuplicates", "workbench candidate duplicate reconciliation action"],
  ["content/workbench.js", "reconcileCandidateDuplicateRecords", "workbench candidate duplicate reconciliation helper"],
  ["content/workbench.js", "appendImportLedgerEntries", "workbench import ledger append"],
  ["content/workbench.xhtml", "zms-import-candidates", "workbench candidate import button"],
  ["content/workbench.xhtml", "zms-attach-candidate-pdfs", "workbench candidate PDF attachment button"],
  ["content/workbench.xhtml", "zms-reconcile-candidate-duplicates", "workbench candidate duplicate reconciliation button"],
  ["content/messages.js", "candidateImportDone", "candidate import status message"],
  ["content/messages.js", "candidatePdfDone", "candidate PDF attachment status message"],
  ["content/messages.js", "candidateDedupeDone", "candidate duplicate reconciliation status message"],
  ["content/messages.js", "zmsResolveUiLanguage", "shared UI language resolver"],
  ["content/reader.js", "backToWorkbench", "reader back action"]
];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const profileDir = resolveProfileDir(options.profileDir);
  const installedXpi = options.xpi || join(profileDir, "extensions", `${ADDON_ID}.xpi`);
  if (!existsSync(installedXpi)) fail(`Installed XPI not found: ${installedXpi}`);

  execFileSync("unzip", ["-t", installedXpi], { stdio: "pipe" });
  const entries = unzipEntries(installedXpi);
  for (const entry of REQUIRED_ENTRIES) {
    if (!entries.has(entry)) fail(`Installed XPI missing ${entry}`);
  }
  for (const [entry, marker, label] of REQUIRED_MARKERS) {
    if (!unzipText(installedXpi, entry).includes(marker)) {
      fail(`Installed XPI missing ${label}: ${marker}`);
    }
  }

  const extensionStatus = readExtensionStatus(profileDir);
  if (!extensionStatus) fail(`Extension ${ADDON_ID} not found in ${join(profileDir, "extensions.json")}`);
  if (extensionStatus.active !== true || extensionStatus.userDisabled === true || extensionStatus.appDisabled === true) {
    fail(`Extension is not active: ${JSON.stringify(extensionStatus)}`);
  }

  const expectedXpi = options.expectedXpi || DEFAULT_BUILD_XPI;
  let buildHash = "";
  let installedHash = sha256(installedXpi);
  if (!options.skipBuildCompare && existsSync(expectedXpi)) {
    buildHash = sha256(expectedXpi);
    if (buildHash !== installedHash) {
      fail(`Installed XPI does not match ${expectedXpi}`);
    }
  }

  const report = {
    ok: true,
    addonId: ADDON_ID,
    profileDir,
    installedXpi,
    active: extensionStatus.active,
    userDisabled: extensionStatus.userDisabled,
    appDisabled: extensionStatus.appDisabled,
    version: extensionStatus.version,
    installedHash,
    buildHash: buildHash || null,
    buildCompared: !!buildHash
  };
  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile-dir") {
      options.profileDir = argv[index + 1];
      index += 1;
    } else if (arg === "--xpi") {
      options.xpi = argv[index + 1];
      index += 1;
    } else if (arg === "--expected-xpi") {
      options.expectedXpi = argv[index + 1];
      index += 1;
    } else if (arg === "--skip-build-compare") {
      options.skipBuildCompare = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/verify-installed-zotero.mjs [--profile-dir DIR] [--xpi PATH] [--expected-xpi PATH] [--skip-build-compare]");
      process.exit(0);
    }
  }
  return options;
}

function resolveProfileDir(explicitProfileDir) {
  if (explicitProfileDir) return resolve(explicitProfileDir);
  if (!existsSync(DEFAULT_PROFILE_ROOT)) fail(`Zotero profile root not found: ${DEFAULT_PROFILE_ROOT}`);
  const profiles = readdirSync(DEFAULT_PROFILE_ROOT)
    .map((name) => join(DEFAULT_PROFILE_ROOT, name))
    .filter((path) => statSync(path).isDirectory());
  const installedProfiles = profiles.filter((path) => existsSync(join(path, "extensions", `${ADDON_ID}.xpi`)));
  if (installedProfiles.length === 1) return installedProfiles[0];
  if (installedProfiles.length > 1) fail(`Multiple profiles have ${ADDON_ID}; pass --profile-dir`);
  if (profiles.length === 1) return profiles[0];
  fail(`No installed ${ADDON_ID} XPI found under ${DEFAULT_PROFILE_ROOT}`);
}

function readExtensionStatus(profileDir) {
  const extensionsJson = join(profileDir, "extensions.json");
  if (!existsSync(extensionsJson)) return null;
  const data = JSON.parse(readFileSync(extensionsJson, "utf8"));
  return (data.addons || []).find((entry) => entry.id === ADDON_ID) || null;
}

function unzipEntries(xpiPath) {
  return new Set(execFileSync("unzip", ["-Z1", xpiPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean));
}

function unzipText(xpiPath, entry) {
  return execFileSync("unzip", ["-p", xpiPath, entry], { encoding: "utf8" });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}

export {
  parseArgs,
  resolveProfileDir,
  readExtensionStatus,
  sha256
};
