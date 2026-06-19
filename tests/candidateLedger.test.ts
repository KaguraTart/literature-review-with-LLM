import { describe, expect, it } from "vitest";
import type { CandidatePaper } from "../src/candidates.js";
import {
  candidateMatchesExistingPaper,
  candidateQuality,
  candidateRecordFromPaper,
  candidateRecordsFromPapers,
  candidateSourceType,
  filterImportableCandidates,
  importLedgerEntry,
  mergeCandidateRecords,
  parseCandidateJsonl,
  parseImportLedgerJsonl,
  renderJsonl,
  sortCandidateRecords
} from "../src/candidateLedger.js";

function paper(overrides: Partial<CandidatePaper> = {}): CandidatePaper {
  return {
    id: "doi:10.1000/test",
    source: "crossref",
    sources: ["crossref"],
    sourceIds: { crossref: "10.1000/test" },
    title: "Low Altitude UAV Conflict Resolution",
    authors: ["A One"],
    year: 2024,
    doi: "10.1000/test",
    url: "https://doi.org/10.1000/test",
    ...overrides
  };
}

describe("candidate import ledger helpers", () => {
  it("turns candidate papers into JSONL-ready import records", () => {
    const record = candidateRecordFromPaper(paper({
      id: "doi:10.1000/pdf",
      doi: "10.1000/pdf",
      pdfUrl: "https://example.test/paper.pdf",
      isOpenAccess: true,
      sources: ["crossref", "unpaywall"],
      sourceIds: { crossref: "10.1000/pdf", unpaywall: "10.1000/pdf" }
    }), {
      query: "UAV conflict",
      collectionKey: "COL",
      now: "2026-06-13T00:00:00.000Z",
      decision: "include"
    });

    expect(record).toMatchObject({
      candidateId: "doi:10.1000/pdf",
      sourceType: "direct_pdf",
      sourceUrl: "https://doi.org/10.1000/test",
      pdfUrl: "https://example.test/paper.pdf",
      ids: { doi: "10.1000/pdf", unpaywallDoi: "10.1000/pdf" },
      quality: {
        hasFullPaperSignal: true,
        hasPdfSignal: true,
        isAbstractOnly: false,
        dedupeStatus: "new"
      },
      priority: {
        tier: "high",
        recommendedDecision: "include"
      },
      decision: "include",
      query: "UAV conflict",
      collectionKey: "COL",
      discoveredAt: "2026-06-13T00:00:00.000Z"
    });
  });

  it("classifies source types and weak abstract-only records", () => {
    const summaryOnly = paper({
      id: "title:summary-only:2024",
      doi: undefined,
      arxivId: undefined,
      url: "https://example.test/paper/summary/123",
      pdfUrl: undefined,
      isOpenAccess: false
    });

    expect(candidateSourceType(summaryOnly)).toBe("abstract_page");
    expect(candidateQuality(summaryOnly)).toMatchObject({
      hasFullPaperSignal: false,
      hasPdfSignal: false,
      isAbstractOnly: true,
      dedupeStatus: "new",
      reason: "abstract or weak webpage source only"
    });
  });

  it("detects exact and uncertain duplicates before import", () => {
    const existing = [
      { itemKey: "ITEM1", doi: "https://doi.org/10.1000/test", title: "Different", year: 2022 },
      { itemKey: "ITEM2", title: "Low Altitude UAV Conflict Resolution and Safety", year: 2025 }
    ];

    expect(candidateMatchesExistingPaper(paper(), existing)).toEqual({
      status: "duplicate",
      itemKey: "ITEM1"
    });
    expect(candidateMatchesExistingPaper(paper({ doi: undefined, year: 2025 }), existing)).toEqual({
      status: "uncertain",
      itemKey: "ITEM2"
    });
  });

  it("filters importable candidates by decision, duplicate status, and abstract-only status", () => {
    const records = candidateRecordsFromPapers([
      paper({ id: "doi:10.1000/include", doi: "10.1000/include", pdfUrl: "https://example.test/include.pdf" }),
      paper({ id: "doi:10.1000/to-read", doi: "10.1000/to-read", pdfUrl: "https://example.test/to-read.pdf" }),
      paper({ id: "doi:10.1000/duplicate", doi: "10.1000/duplicate" }),
      paper({ id: "title:summary-only:2024", doi: undefined, url: "https://example.test/paper/summary/123" })
    ], {
      now: "2026-06-13T00:00:00.000Z",
      existing: [{ itemKey: "DUP", doi: "10.1000/duplicate" }]
    });
    records.find((record) => record.candidateId === "doi:10.1000/include")!.decision = "include";
    records.find((record) => record.candidateId === "doi:10.1000/to-read")!.decision = "to_read";
    records.find((record) => record.candidateId === "doi:10.1000/duplicate")!.decision = "include";
    records.find((record) => record.candidateId === "title:summary-only:2024")!.decision = "include";

    expect(filterImportableCandidates(records).map((record) => record.candidateId)).toEqual(["doi:10.1000/include"]);
    expect(filterImportableCandidates(records, { includeToRead: true }).map((record) => record.candidateId))
      .toEqual(["doi:10.1000/include", "doi:10.1000/to-read"]);
    expect(filterImportableCandidates(records, { allowAbstractOnly: true }).map((record) => record.candidateId))
      .toEqual(["doi:10.1000/include", "title:summary-only:2024"]);
  });

  it("ranks candidate records by manual decision, source strength, and duplicate risk", () => {
    const high = candidateRecordFromPaper(paper({
      id: "doi:10.1000/high",
      doi: "10.1000/high",
      pdfUrl: "https://example.test/high.pdf",
      isOpenAccess: true,
      citationCount: 45,
      sources: ["crossref", "semantic_scholar"],
      sourceIds: { crossref: "10.1000/high", semantic_scholar: "S2-HIGH" }
    }), { now: "2026-06-13T00:00:00.000Z" });
    const weak = candidateRecordFromPaper(paper({
      id: "title:weak abstract only candidate:2024",
      doi: undefined,
      arxivId: undefined,
      title: "Weak abstract-only candidate",
      url: "https://example.test/paper/summary/weak",
      pdfUrl: undefined,
      isOpenAccess: false,
      sources: ["crossref"],
      sourceIds: { crossref: "weak" }
    }), { now: "2026-06-13T00:00:00.000Z" });
    const duplicate = candidateRecordFromPaper(paper({
      id: "doi:10.1000/duplicate",
      doi: "10.1000/duplicate"
    }), {
      now: "2026-06-13T00:00:00.000Z",
      existing: [{ itemKey: "EXISTING", doi: "10.1000/duplicate" }]
    });

    high.decision = "to_read";
    const ranked = sortCandidateRecords([weak, duplicate, high]);

    expect(ranked.map((record) => record.candidateId)).toEqual([
      "doi:10.1000/high",
      "title:weak abstract only candidate:2024",
      "doi:10.1000/duplicate"
    ]);
    expect(ranked[0].priority).toMatchObject({ tier: "high", recommendedDecision: "include" });
    expect(ranked[1].priority).toMatchObject({ tier: "low", recommendedDecision: "user_pending" });
    expect(ranked[2].priority).toMatchObject({ tier: "duplicate", recommendedDecision: "exclude" });
  });

  it("generates import ledger entries and parses JSONL files", () => {
    const record = candidateRecordFromPaper(paper(), {
      now: "2026-06-13T00:00:00.000Z",
      collectionKey: "COL",
      decision: "include"
    });
    const entry = importLedgerEntry(record, {
      action: "imported",
      at: "2026-06-13T00:01:00.000Z",
      zoteroItemKey: "ITEM1",
      attachmentKey: "ATT1",
      message: "Imported after review"
    });

    expect(entry).toMatchObject({
      id: "doi:10.1000/test:imported:2026-06-13T00:01:00.000Z",
      candidateId: "doi:10.1000/test",
      action: "imported",
      collectionKey: "COL",
      zoteroItemKey: "ITEM1",
      attachmentKey: "ATT1",
      doi: "10.1000/test",
      decision: "include"
    });
    expect(parseCandidateJsonl(renderJsonl([record]))).toEqual([record]);
    expect(parseImportLedgerJsonl(renderJsonl([entry]))).toEqual([entry]);
    expect(() => parseCandidateJsonl("{bad json}\n")).toThrow("Invalid JSONL at line 1");
  });

  it("merges repeated discovery records without discarding prior human decisions", () => {
    const existing = candidateRecordFromPaper(paper({
      id: "doi:10.1000/test",
      sources: ["crossref"],
      sourceIds: { crossref: "10.1000/test" }
    }), {
      now: "2026-06-13T00:00:00.000Z",
      decision: "include"
    });
    const incoming = candidateRecordFromPaper(paper({
      id: "doi:10.1000/test",
      sources: ["semantic_scholar"],
      sourceIds: { semantic_scholar: "S2-1" },
      citationCount: 12,
      pdfUrl: "https://example.test/paper.pdf"
    }), {
      now: "2026-06-13T00:02:00.000Z",
      decision: "user_pending"
    });

    expect(mergeCandidateRecords([existing], [incoming])).toEqual([
      expect.objectContaining({
        candidateId: "doi:10.1000/test",
        decision: "include",
        discoveredAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:02:00.000Z",
        sources: ["crossref", "semantic_scholar"],
        sourceIds: { crossref: "10.1000/test", semantic_scholar: "S2-1" },
        citationCount: 12,
        pdfUrl: "https://example.test/paper.pdf"
      })
    ]);
  });
});
