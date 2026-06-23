import { describe, expect, it } from "vitest";
import { availableSkillIds, builtInSkillTemplate, defaultSkills, normalizeSkillId, pickSkillTemplate, skillIdFromTemplatePath } from "../src/skills.js";

describe("skills", () => {
  it("declares the default skills", () => {
    expect(defaultSkills.map((skill) => skill.id)).toEqual([
      "paper-deep-summary",
      "method-extractor",
      "experiment-table-builder",
      "figure-table-extractor",
      "literature-matrix-builder",
      "literature-review-synthesis",
      "citation-audit",
      "custom-summary",
      "ask-gemini",
      "ask-claude",
      "ask-opencode",
      "ask-all-agents",
      "ask-gemini-claude",
      "check-local-agents"
    ]);
  });

  it("uses local templates before built-in templates", () => {
    expect(pickSkillTemplate("Local template", "paper-deep-summary", "zh-CN")).toBe("Local template");
    expect(pickSkillTemplate("", "paper-deep-summary", "zh-CN")).toContain("中文");
    expect(pickSkillTemplate("Custom local template", "my-analysis", "en-US")).toBe("Custom local template");
  });

  it("keeps skill templates evidence-oriented", () => {
    expect(builtInSkillTemplate("citation-audit", "en-US")).toContain("evidence");
    expect(builtInSkillTemplate("figure-table-extractor", "en-US")).toContain("[image]");
    expect(builtInSkillTemplate("literature-matrix-builder", "en-US")).toContain("[paper2:<id>]");
    expect(builtInSkillTemplate("literature-review-synthesis", "en-US")).toContain("cross-paper synthesis");
    expect(builtInSkillTemplate("paper-deep-summary", "ja-JP")).toContain("日本語");
  });

  it("uses localized deep paper report sections", () => {
    expect(builtInSkillTemplate("paper-deep-summary", "zh-CN")).toContain("研究问题");
    expect(builtInSkillTemplate("paper-deep-summary", "en-US")).toContain("research question");
    expect(builtInSkillTemplate("paper-deep-summary", "ja-JP")).toContain("研究課題");
  });

  it("discovers user-defined skill templates from markdown filenames", () => {
    expect(skillIdFromTemplatePath("/tmp/skills/roadmap-audit.md")).toBe("roadmap-audit");
    expect(skillIdFromTemplatePath("/tmp/skills/readme.txt")).toBeUndefined();
    expect(availableSkillIds(["/tmp/skills/roadmap-audit.md"])).toContain("roadmap-audit");
  });

  it("normalizes custom skill ids to safe filenames", () => {
    expect(normalizeSkillId("../My Custom:Audit?.md")).toBe("My-Custom-Audit");
    expect(normalizeSkillId("  local review  ")).toBe("local-review");
    expect(normalizeSkillId("...")).toBe("");
  });
});
