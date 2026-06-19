import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PACKAGE_PATH = "package.json";
const DEFAULT_ADDON_MANIFEST_PATH = "addon/manifest.json";
const DEFAULT_XPI_PATH = "build/literature-review-with-llm.xpi";
const DEFAULT_OUTPUT_PATH = "build/update.json";
const DEFAULT_ASSET_NAME = "literature-review-with-llm.xpi";

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    packagePath: DEFAULT_PACKAGE_PATH,
    addonManifestPath: DEFAULT_ADDON_MANIFEST_PATH,
    xpiPath: DEFAULT_XPI_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    assetName: DEFAULT_ASSET_NAME,
    check: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--package") {
      options.packagePath = requireValue(argv, ++index, arg);
    } else if (arg === "--manifest") {
      options.addonManifestPath = requireValue(argv, ++index, arg);
    } else if (arg === "--xpi") {
      options.xpiPath = requireValue(argv, ++index, arg);
    } else if (arg === "--out") {
      options.outputPath = requireValue(argv, ++index, arg);
    } else if (arg === "--asset-name") {
      options.assetName = requireValue(argv, ++index, arg);
    } else if (arg === "--tag") {
      options.tag = requireValue(argv, ++index, arg);
    } else if (arg === "--repo") {
      options.repo = requireValue(argv, ++index, arg);
    } else if (arg === "--update-link") {
      options.updateLink = requireValue(argv, ++index, arg);
    } else if (arg === "--update-url") {
      options.updateUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function repositorySlug(repository) {
  const value = typeof repository === "string" ? repository : repository?.url;
  if (!value) return "";
  const normalized = value.replace(/^git\+/, "").replace(/\.git$/, "");
  const match = normalized.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+)/i);
  return match ? `${match[1]}/${match[2]}` : "";
}

export function releaseAssetURL({ repo, tag, assetName }) {
  if (!repo) throw new Error("Missing GitHub repository slug");
  if (!tag) throw new Error("Missing release tag");
  if (!assetName) throw new Error("Missing release asset name");
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export function latestReleaseAssetURL({ repo, assetName }) {
  if (!repo) throw new Error("Missing GitHub repository slug");
  if (!assetName) throw new Error("Missing release asset name");
  return `https://github.com/${repo}/releases/latest/download/${encodeURIComponent(assetName)}`;
}

export function sha256File(path) {
  if (!existsSync(path)) throw new Error(`Missing XPI package: ${path}`);
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildUpdateManifest({ addonId, version, updateLink, updateHash, zoteroCompatibility }) {
  if (!addonId) throw new Error("Missing Zotero addon id");
  if (!version) throw new Error("Missing addon version");
  if (!updateLink) throw new Error("Missing update link");
  if (!/^sha256:[a-f0-9]{64}$/i.test(updateHash || "")) {
    throw new Error("Missing or invalid sha256 update hash");
  }
  if (!zoteroCompatibility?.strict_min_version) {
    throw new Error("Missing Zotero strict_min_version");
  }

  const zotero = {
    strict_min_version: zoteroCompatibility.strict_min_version
  };
  if (zoteroCompatibility.strict_max_version) {
    zotero.strict_max_version = zoteroCompatibility.strict_max_version;
  }

  return {
    addons: {
      [addonId]: {
        updates: [
          {
            version,
            update_link: updateLink,
            update_hash: updateHash,
            applications: {
              zotero
            }
          }
        ]
      }
    }
  };
}

export function buildUpdateManifestFromFiles(options = {}) {
  const packagePath = options.packagePath || DEFAULT_PACKAGE_PATH;
  const addonManifestPath = options.addonManifestPath || DEFAULT_ADDON_MANIFEST_PATH;
  const xpiPath = options.xpiPath || DEFAULT_XPI_PATH;
  const assetName = options.assetName || DEFAULT_ASSET_NAME;

  const packageJson = readJson(packagePath);
  const addonManifest = readJson(addonManifestPath);
  const zotero = addonManifest.applications?.zotero || {};
  const repo = options.repo || repositorySlug(packageJson.repository);
  const tag = options.tag || `v${packageJson.version}`;
  const expectedUpdateUrl = options.updateUrl || latestReleaseAssetURL({ repo, assetName: "update.json" });
  const updateLink = options.updateLink || releaseAssetURL({ repo, tag, assetName });

  if (!zotero.update_url) {
    throw new Error("addon/manifest.json applications.zotero.update_url is required");
  }
  if (zotero.update_url !== expectedUpdateUrl) {
    throw new Error(`Unexpected update_url: ${zotero.update_url}`);
  }

  return buildUpdateManifest({
    addonId: zotero.id,
    version: addonManifest.version || packageJson.version,
    updateLink,
    updateHash: `sha256:${sha256File(xpiPath)}`,
    zoteroCompatibility: zotero
  });
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeUpdateManifest(options = {}) {
  const outputPath = options.outputPath || DEFAULT_OUTPUT_PATH;
  const manifest = buildUpdateManifestFromFiles(options);
  const text = stableJson(manifest);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, text);
  return { outputPath, manifest };
}

export function verifyUpdateManifest(options = {}) {
  const outputPath = options.outputPath || DEFAULT_OUTPUT_PATH;
  if (!existsSync(outputPath)) {
    throw new Error(`Missing update manifest: ${outputPath}`);
  }
  const expected = stableJson(buildUpdateManifestFromFiles(options));
  const actual = readFileSync(outputPath, "utf8");
  if (actual !== expected) {
    throw new Error(`${outputPath} is stale; run npm run build:update-manifest`);
  }
  return { outputPath, manifest: JSON.parse(actual) };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usage() {
  return [
    "Usage: node scripts/build-update-manifest.mjs [--check] [--json]",
    "       [--package package.json] [--manifest addon/manifest.json]",
    "       [--xpi build/literature-review-with-llm.xpi] [--out build/update.json]",
    "       [--repo owner/repo] [--tag v0.1.1] [--asset-name literature-review-with-llm.xpi]"
  ].join("\n");
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = options.check ? verifyUpdateManifest(options) : writeUpdateManifest(options);
  const addonIds = Object.keys(result.manifest.addons);
  const report = {
    ok: true,
    mode: options.check ? "check" : "write",
    outputPath: result.outputPath,
    addonId: addonIds[0],
    version: result.manifest.addons[addonIds[0]].updates[0].version,
    updateLink: result.manifest.addons[addonIds[0]].updates[0].update_link
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Update manifest ${report.mode} passed: ${report.outputPath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.message || String(err));
    process.exit(1);
  });
}
