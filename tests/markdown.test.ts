import { describe, expect, it } from "vitest";
import { applyMarkdownEdit, backupPathFor, renderFrontmatter, sanitizeFilename, tempPathFor, upsertFrontmatter } from "../src/markdown.js";

describe("markdown helpers", () => {
  it("renders required frontmatter fields", () => {
    const text = renderFrontmatter({
      zoteroItemKey: "ITEM",
      pdfAttachmentKey: "PDF",
      sourceHash: "abcd",
      summaryVersion: "1",
      provider: "minimax",
      model: "MiniMax-M2.7",
      generatedAt: "2026-05-28T00:00:00.000Z"
    });
    expect(text).toContain("zoteroItemKey: ITEM");
    expect(text).toContain("sourceHash: abcd");
  });

  it("renders optional workflow metadata frontmatter fields", () => {
    const text = renderFrontmatter({
      zoteroItemKey: "ITEM",
      pdfAttachmentKey: "PDF",
      sourceHash: "abcd",
      summaryVersion: "1",
      provider: "openai",
      model: "model-a",
      generatedAt: "2026-05-28T00:00:00.000Z",
      inputMode: "text",
      summaryType: "paper-deep-summary",
      evidenceLevel: "fulltext_or_indexed_text",
      outputLanguage: "zh-CN",
      sourceLanguage: "auto",
      templateVersion: "summary-v1"
    });

    expect(text).toContain("inputMode: text");
    expect(text).toContain("summaryType: paper-deep-summary");
    expect(text).toContain("evidenceLevel: fulltext_or_indexed_text");
    expect(text).toContain("outputLanguage: zh-CN");
    expect(text).toContain("sourceLanguage: auto");
    expect(text).toContain("templateVersion: summary-v1");
  });

  it("sanitizes filenames", () => {
    expect(sanitizeFilename("A/B:C*D?E")).toBe("A B C D E");
  });

  it("updates frontmatter without removing existing fields", () => {
    const updated = upsertFrontmatter("---\nzoteroItemKey: ITEM\n---\n\n# Title\n", {
      lastEditedAt: "2026-05-31T00:00:00.000Z",
      editCount: 1
    });
    expect(updated).toContain("zoteroItemKey: ITEM");
    expect(updated).toContain("lastEditedAt: 2026-05-31T00:00:00.000Z");
    expect(updated).toContain("editCount: 1");
  });

  it("replaces a section and generates a backup path", () => {
    const original = "---\nzoteroItemKey: ITEM\n---\n\n# Paper\n\n## Method\n\nOld method.\n\n## Results\n\nOld results.\n";
    const preview = applyMarkdownEdit(original, {
      itemKey: "ITEM",
      summaryPath: "/tmp/paper.md",
      chatSessionId: "chat-1",
      messageId: "msg-1",
      action: "replace_section",
      targetSection: "Method",
      replacementText: "New method.",
      skillId: "method-extractor",
      now: "2026-05-31T00:00:00.000Z"
    });
    expect(preview.after).toContain("## Method\n\nNew method.");
    expect(preview.after).toContain("## Results\n\nOld results.");
    expect(preview.after).toContain("skillId: method-extractor");
    expect(preview.backupPath).toBe("/tmp/.bak/paper.md.2026-05-31T00-00-00-000Z.md");
    expect(preview.tempPath).toBe("/tmp/.paper.md.2026-05-31T00-00-00-000Z.tmp");
  });

  it("appends research notes when the section does not exist", () => {
    const preview = applyMarkdownEdit("# Paper\n", {
      itemKey: "ITEM",
      summaryPath: "/tmp/paper.md",
      chatSessionId: "chat-1",
      messageId: "msg-1",
      action: "append_research_notes",
      replacementText: "A useful note.",
      now: "2026-05-31T00:00:00.000Z"
    });
    expect(preview.after).toContain("## Research Notes\n\nA useful note.");
  });

  it("builds backup paths in a .bak sibling directory", () => {
    expect(backupPathFor("/a/b/file.md", "2026-05-31T01:02:03.004Z")).toBe("/a/b/.bak/file.md.2026-05-31T01-02-03-004Z.md");
  });

  it("builds temporary write paths beside the target summary", () => {
    expect(tempPathFor("/a/b/file.md", "2026-05-31T01:02:03.004Z")).toBe("/a/b/.file.md.2026-05-31T01-02-03-004Z.tmp");
  });
});
