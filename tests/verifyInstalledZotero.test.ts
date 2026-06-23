import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Executable .mjs helper exports are covered by runtime tests.
import { compareEntryHashMaps, parseArgs, readExtensionStatus, sha256 } from "../scripts/verify-installed-zotero.mjs";

describe("installed Zotero package verifier", () => {
  it("parses profile, xpi, expected build, and comparison flags", () => {
    expect(parseArgs([
      "--profile-dir", "/tmp/profile",
      "--xpi", "/tmp/addon.xpi",
      "--expected-xpi", "/tmp/build.xpi",
      "--skip-build-compare"
    ])).toEqual({
      profileDir: "/tmp/profile",
      xpi: "/tmp/addon.xpi",
      expectedXpi: "/tmp/build.xpi",
      skipBuildCompare: true
    });
  });

  it("reads installed extension state and computes package hashes", () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-installed-"));
    try {
      writeFileSync(join(dir, "extensions.json"), JSON.stringify({
        addons: [
          { id: "other", active: true },
          {
            id: "zotero-markdown-summary@diantao.local",
            active: true,
            userDisabled: false,
            appDisabled: false,
            version: "0.1.0"
          }
        ]
      }));
      const payloadPath = join(dir, "payload.txt");
      writeFileSync(payloadPath, "package");

      expect(readExtensionStatus(dir)).toMatchObject({
        active: true,
        userDisabled: false,
        appDisabled: false,
        version: "0.1.0"
      });
      expect(sha256(payloadPath)).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compares installed package content by entry hashes instead of zip metadata", () => {
    expect(compareEntryHashMaps(
      new Map([
        ["manifest.json", "a"],
        ["content/preferences.xhtml", "b"]
      ]),
      new Map([
        ["content/preferences.xhtml", "b"],
        ["manifest.json", "a"]
      ])
    )).toEqual({ ok: true, message: "" });

    expect(compareEntryHashMaps(
      new Map([
        ["manifest.json", "a"],
        ["content/preferences.xhtml", "b"]
      ]),
      new Map([
        ["manifest.json", "changed"],
        ["content/extra.js", "c"]
      ])
    )).toEqual({
      ok: false,
      message: "missing content/preferences.xhtml; extra content/extra.js; changed manifest.json"
    });
  });
});
