import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Executable .mjs helper exports are covered by runtime tests.
import { parseArgs, verifyZoteroRuntime } from "../scripts/verify-zotero-runtime.mjs";

describe("Zotero runtime verifier", () => {
  it("parses runtime verification arguments", () => {
    expect(parseArgs([
      "--profile-dir", "/tmp/profile",
      "--base-url", "http://127.0.0.1:23119/",
      "--expected-xpi", "/tmp/build.xpi",
      "--skip-build-compare",
      "--timeout-ms", "1234"
    ])).toEqual({
      profileDir: "/tmp/profile",
      baseURL: "http://127.0.0.1:23119/",
      expectedXpi: "/tmp/build.xpi",
      skipBuildCompare: true,
      timeoutMs: 1234
    });
  });

  it("checks installed extension state plus Connector and local API probes", async () => {
    const profileDir = mkdtempSync(join(tmpdir(), "zms-runtime-"));
    try {
      mkdirSync(join(profileDir, "extensions"));
      writeFileSync(join(profileDir, "extensions", "zotero-markdown-summary@diantao.local.xpi"), "xpi");
      writeFileSync(join(profileDir, "extensions.json"), JSON.stringify({
        addons: [{
          id: "zotero-markdown-summary@diantao.local",
          active: true,
          userDisabled: false,
          appDisabled: false,
          version: "0.1.0"
        }]
      }));
      const calls: string[] = [];
      const fetchImpl = async (url: string) => {
        calls.push(url);
        if (url.endsWith("/connector/ping")) {
          return response("Zotero is running", {
            "x-zotero-version": "9.0.4",
            "x-zotero-connector-api-version": "3"
          });
        }
        return response(JSON.stringify([{ key: "ABC12345" }]), {
          "x-zotero-version": "9.0.4",
          "zotero-api-version": "3",
          "zotero-schema-version": "42",
          "total-results": "7"
        });
      };

      const report = await verifyZoteroRuntime({
        profileDir,
        baseURL: "http://127.0.0.1:23119/",
        skipBuildCompare: true
      }, fetchImpl as any);

      expect(report.ok).toBe(true);
      expect(calls).toEqual([
        "http://127.0.0.1:23119/connector/ping",
        "http://127.0.0.1:23119/api/users/0/items/top?limit=1"
      ]);
      expect(report.extension).toMatchObject({ active: true, version: "0.1.0" });
      expect(report.zotero).toMatchObject({
        version: "9.0.4",
        connectorApiVersion: "3",
        apiVersion: "3",
        schemaVersion: "42",
        totalResults: 7
      });
      expect(report.localApi).toMatchObject({ itemCount: 1, firstItemKey: "ABC12345" });
      expect(report.checks).toMatchObject({
        installedXpi: true,
        extensionActive: true,
        connectorRunning: true,
        localApiRunning: true
      });
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
    }
  });
});

function response(body: string, headers: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    text: async () => body
  };
}
