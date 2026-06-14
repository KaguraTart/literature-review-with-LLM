#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readExtensionStatus, resolveProfileDir, sha256 } from "./verify-installed-zotero.mjs";

const ADDON_ID = "zotero-markdown-summary@diantao.local";
const DEFAULT_BUILD_XPI = "build/literature-review-with-llm.xpi";
const DEFAULT_BASE_URL = "http://127.0.0.1:23119";
const DEFAULT_PROFILE_ROOT = join(homedir(), "Library/Application Support/Zotero/Profiles");

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const report = await verifyZoteroRuntime(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
  } catch (err) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    baseURL: DEFAULT_BASE_URL,
    expectedXpi: DEFAULT_BUILD_XPI,
    skipBuildCompare: false,
    timeoutMs: 5000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile-dir") {
      options.profileDir = argv[index + 1];
      index += 1;
    } else if (arg === "--base-url") {
      options.baseURL = argv[index + 1] || DEFAULT_BASE_URL;
      index += 1;
    } else if (arg === "--expected-xpi") {
      options.expectedXpi = argv[index + 1] || DEFAULT_BUILD_XPI;
      index += 1;
    } else if (arg === "--skip-build-compare") {
      options.skipBuildCompare = true;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[index + 1]) || options.timeoutMs;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/verify-zotero-runtime.mjs [--profile-dir DIR] [--base-url URL] [--expected-xpi PATH] [--skip-build-compare] [--timeout-ms MS]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function verifyZoteroRuntime(options = {}, fetchImpl = globalThis.fetch) {
  const profileDir = resolveProfileDir(options.profileDir);
  const installedXpi = join(profileDir, "extensions", `${ADDON_ID}.xpi`);
  const extensionStatus = readExtensionStatus(profileDir);
  const installedHash = existsSync(installedXpi) ? sha256(installedXpi) : "";
  const expectedXpi = options.expectedXpi || DEFAULT_BUILD_XPI;
  const buildHash = !options.skipBuildCompare && existsSync(expectedXpi) ? sha256(expectedXpi) : "";
  const baseURL = normalizeBaseURL(options.baseURL || DEFAULT_BASE_URL);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 5000;
  const connector = await probeEndpoint(`${baseURL}/connector/ping`, { timeoutMs, fetchImpl });
  const localApi = await probeEndpoint(`${baseURL}/api/users/0/items/top?limit=1`, { timeoutMs, fetchImpl });
  const itemProbe = parseItemProbe(localApi);
  const checks = {
    profileExists: existsSync(profileDir),
    installedXpi: !!installedHash,
    buildHashMatches: !buildHash || installedHash === buildHash,
    extensionActive: extensionStatus?.active === true && extensionStatus?.userDisabled !== true && extensionStatus?.appDisabled !== true,
    connectorRunning: connector.ok && connector.status === 200,
    localApiRunning: localApi.ok && localApi.status === 200 && Array.isArray(itemProbe.items)
  };
  const ok = Object.values(checks).every(Boolean);
  return {
    ok,
    addonId: ADDON_ID,
    profileDir,
    profileRoot: DEFAULT_PROFILE_ROOT,
    installedXpi,
    installedHash: installedHash || null,
    buildHash: buildHash || null,
    baseURL,
    extension: extensionStatus ? {
      active: extensionStatus.active,
      userDisabled: extensionStatus.userDisabled,
      appDisabled: extensionStatus.appDisabled,
      version: extensionStatus.version
    } : null,
    zotero: {
      version: connector.headers["x-zotero-version"] || localApi.headers["x-zotero-version"] || "",
      connectorApiVersion: connector.headers["x-zotero-connector-api-version"] || "",
      apiVersion: localApi.headers["zotero-api-version"] || "",
      schemaVersion: localApi.headers["zotero-schema-version"] || "",
      totalResults: itemProbe.totalResults
    },
    connector: summarizeProbe(connector),
    localApi: {
      ...summarizeProbe(localApi),
      itemCount: itemProbe.items?.length || 0,
      firstItemKey: itemProbe.items?.[0]?.key || ""
    },
    checks
  };
}

async function probeEndpoint(url, { timeoutMs, fetchImpl }) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, status: 0, headers: {}, body: "", error: "fetch is unavailable" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      headers: headersObject(response.headers),
      body,
      error: ""
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      headers: {},
      body: "",
      error: err?.message || String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseItemProbe(probe) {
  const totalResults = Number(probe.headers?.["total-results"] || 0) || 0;
  try {
    const items = JSON.parse(probe.body || "[]");
    return { totalResults, items: Array.isArray(items) ? items : [] };
  } catch (_err) {
    return { totalResults, items: [] };
  }
}

function summarizeProbe(probe) {
  return {
    ok: probe.ok,
    status: probe.status,
    error: probe.error || ""
  };
}

function headersObject(headers) {
  const result = {};
  if (!headers) return result;
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      result[String(key).toLowerCase()] = String(value);
    });
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    result[String(key).toLowerCase()] = String(value);
  }
  return result;
}

function normalizeBaseURL(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}

export {
  parseArgs,
  verifyZoteroRuntime,
  probeEndpoint
};
