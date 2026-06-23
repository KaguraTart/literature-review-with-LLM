import { describe, expect, it } from "vitest";
// @ts-expect-error Executable .mjs helper exports are covered by runtime tests.
import { collectReadinessChecks, parseArgs, readDefaultProfiles } from "../scripts/project-readiness-check.mjs";

describe("project readiness check", () => {
  it("parses CLI flags for package checks", () => {
    expect(parseArgs(["--json", "--require-xpi", "--xpi", "/tmp/addon.xpi"])).toEqual({
      json: true,
      includeXpi: true,
      requireXpi: true,
      xpiPath: "/tmp/addon.xpi"
    });
    expect(parseArgs(["--skip-xpi"])).toMatchObject({ includeXpi: false });
  });

  it("reads default provider profiles from prefs", () => {
    const ids = readDefaultProfiles().map((profile: { id: string }) => profile.id);
    expect(ids).toEqual(expect.arrayContaining([
      "openai",
      "anthropic",
      "xai",
      "groq",
      "mistral",
      "together",
      "kimi",
      "perplexity",
      "deepseek",
      "zai-anthropic",
      "openrouter",
      "dashscope",
      "siliconflow",
      "zhipu",
      "volcengine",
      "qianfan",
      "hunyuan",
      "local-agents"
    ]));
  });

  it("passes source-level readiness checks", () => {
    const report = collectReadinessChecks({ includeXpi: false });
    const failed = report.checks.filter((check: { status: string }) => check.status === "fail");
    expect(failed).toEqual([]);
    expect(report.summary.warn).toBe(0);
  });

  it("keeps package zip verification in the default check chain", () => {
    const report = collectReadinessChecks({ includeXpi: false });
    const checkById = new Map(report.checks.map((check: { id: string; status: string }) => [check.id, check.status]));

    expect(checkById.get("package.script.verify:zip")).toBe("pass");
    expect(checkById.get("package.script.check-zip")).toBe("pass");
  });

  it("keeps README download links on latest release URLs", () => {
    const report = collectReadinessChecks({ includeXpi: false });
    const checkById = new Map(report.checks.map((check: { id: string; status: string }) => [check.id, check.status]));

    expect(checkById.get("readme.release-link.latest.README.md")).toBe("pass");
    expect(checkById.get("readme.release-link.xpi.README.md")).toBe("pass");
    expect(checkById.get("readme.release-link.no-versioned.README.md")).toBe("pass");
    expect(checkById.get("readme.release-link.latest.README.zh-CN.md")).toBe("pass");
    expect(checkById.get("readme.release-link.xpi.README.zh-CN.md")).toBe("pass");
    expect(checkById.get("readme.release-link.no-versioned.README.zh-CN.md")).toBe("pass");
  });
});
