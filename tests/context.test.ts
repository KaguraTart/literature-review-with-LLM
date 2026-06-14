import { describe, expect, it } from "vitest";
import { chunkText, selectRelevantChunks } from "../src/context.js";

describe("paper context helpers", () => {
  it("builds stable chunks", () => {
    const chunks = chunkText("Intro paragraph.\n\nMethod paragraph.\n\nResult paragraph.", {
      sourceType: "fulltext",
      maxChars: 24
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ sourceType: "fulltext" });
    expect(chunks[0].chunkId).toMatch(/^fulltext-[0-9a-f]{8}-0001$/);
    expect(chunks[0].sourceHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps chunk ids tied to content hashes", () => {
    const first = chunkText("Stable paragraph.", { sourceType: "summary", maxChars: 18 })[0];
    const second = chunkText("New paragraph.\n\nStable paragraph.", { sourceType: "summary", maxChars: 18 })[1];

    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.chunkId).toContain(first.sourceHash);
    expect(second.chunkId).toContain(first.sourceHash);
  });

  it("selects chunks by query terms", () => {
    const chunks = chunkText("Alpha method.\n\nBeta experiment.\n\nGamma result.", {
      sourceType: "fulltext",
      maxChars: 20
    });
    expect(selectRelevantChunks(chunks, "experiment", 1)[0].text).toContain("experiment");
  });

  it("uses source quality as a tiebreaker without overriding direct term matches", () => {
    const chunks = [
      ...chunkText("General prior summary without target.", { sourceType: "summary", maxChars: 80 }),
      ...chunkText("The decisive experiment appears here.", { sourceType: "fulltext", maxChars: 80 }),
      ...chunkText("Reviewer note without target.", { sourceType: "note", maxChars: 80 })
    ];

    expect(selectRelevantChunks(chunks, "experiment", 1)[0].sourceType).toBe("fulltext");
    expect(selectRelevantChunks(chunks, "missing-target", 1)[0].sourceType).toBe("summary");
  });

  it("keeps annotation, note, and summary chunks source-labeled", () => {
    const annotationChunks = chunkText("Highlighted claim with page label.", {
      sourceType: "annotation",
      maxChars: 80
    });
    const noteChunks = chunkText("Reviewer note about assumptions.", {
      sourceType: "note",
      maxChars: 80
    });
    const summaryChunks = chunkText("Existing Markdown summary mentions limitations.", {
      sourceType: "summary",
      maxChars: 80
    });
    expect(annotationChunks[0].chunkId).toMatch(/^annotation-[0-9a-f]{8}-0001$/);
    expect(noteChunks[0].chunkId).toMatch(/^note-[0-9a-f]{8}-0001$/);
    expect(summaryChunks[0].chunkId).toMatch(/^summary-[0-9a-f]{8}-0001$/);
  });
});
