import { describe, expect, it } from "vitest";
import { renderFrontmatter, sanitizeFilename } from "../src/markdown";

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

  it("sanitizes filenames", () => {
    expect(sanitizeFilename("A/B:C*D?E")).toBe("A B C D E");
  });
});
