import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Executable .mjs helper exports are covered by runtime tests.
import { buildUpdateManifestFromFiles, latestReleaseAssetURL, parseArgs, releaseAssetURL, repositorySlug, stableJson, verifyUpdateManifest, writeUpdateManifest } from "../scripts/build-update-manifest.mjs";

describe("update manifest builder", () => {
  it("parses release options and GitHub repository URLs", () => {
    expect(parseArgs(["--check", "--json", "--tag", "v1.2.3", "--repo", "owner/repo"])).toMatchObject({
      check: true,
      json: true,
      tag: "v1.2.3",
      repo: "owner/repo"
    });
    expect(repositorySlug({ url: "https://github.com/KaguraTart/literature-review-with-LLM.git" })).toBe(
      "KaguraTart/literature-review-with-LLM"
    );
    expect(repositorySlug("git@github.com:KaguraTart/literature-review-with-LLM.git")).toBe(
      "KaguraTart/literature-review-with-LLM"
    );
  });

  it("builds Zotero update metadata with release links and sha256 hashes", () => {
    withTempProject((dir) => {
      const manifest = buildUpdateManifestFromFiles(projectOptions(dir));
      const update = manifest.addons["zotero-markdown-summary@diantao.local"].updates[0];

      expect(update).toMatchObject({
        version: "0.1.1",
        update_link: "https://github.com/KaguraTart/literature-review-with-LLM/releases/download/v0.1.1/literature-review-with-llm.xpi",
        applications: {
          zotero: {
            strict_min_version: "9.0",
            strict_max_version: "9.*"
          }
        }
      });
      expect(update.update_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  it("writes and verifies update.json as an exact build artifact", () => {
    withTempProject((dir) => {
      const options = projectOptions(dir);
      const result = writeUpdateManifest(options);
      expect(result.outputPath).toBe(join(dir, "build", "update.json"));
      expect(JSON.parse(readFileSync(result.outputPath, "utf8"))).toEqual(result.manifest);

      expect(verifyUpdateManifest(options).manifest).toEqual(result.manifest);
      writeFileSync(result.outputPath, `${stableJson(result.manifest).replace("0.1.1", "0.1.0")}`);
      expect(() => verifyUpdateManifest(options)).toThrow("is stale");
    });
  });

  it("uses stable latest and tagged release asset URLs", () => {
    const repo = "KaguraTart/literature-review-with-LLM";
    expect(latestReleaseAssetURL({ repo, assetName: "update.json" })).toBe(
      "https://github.com/KaguraTart/literature-review-with-LLM/releases/latest/download/update.json"
    );
    expect(releaseAssetURL({ repo, tag: "v0.1.1", assetName: "literature-review-with-llm.xpi" })).toBe(
      "https://github.com/KaguraTart/literature-review-with-LLM/releases/download/v0.1.1/literature-review-with-llm.xpi"
    );
  });
});

function withTempProject(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "zms-update-manifest-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      version: "0.1.1",
      repository: {
        type: "git",
        url: "https://github.com/KaguraTart/literature-review-with-LLM.git"
      }
    }));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      version: "0.1.1",
      applications: {
        zotero: {
          id: "zotero-markdown-summary@diantao.local",
          update_url: "https://github.com/KaguraTart/literature-review-with-LLM/releases/latest/download/update.json",
          strict_min_version: "9.0",
          strict_max_version: "9.*"
        }
      }
    }));
    writeFileSync(join(dir, "addon.xpi"), "xpi-content");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function projectOptions(dir: string) {
  return {
    packagePath: join(dir, "package.json"),
    addonManifestPath: join(dir, "manifest.json"),
    xpiPath: join(dir, "addon.xpi"),
    outputPath: join(dir, "build", "update.json")
  };
}
