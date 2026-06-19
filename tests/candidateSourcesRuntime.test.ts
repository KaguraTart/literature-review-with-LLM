import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadRuntime() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/candidate-sources.js"), "utf8");
  const sandbox: any = {
    window: {},
    URLSearchParams,
    console
  };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "candidate-sources.js" });
  return context as { ZMSCandidateSources: any; window: any };
}

function ok(text: string) {
  return { ok: true, status: 200, text: async () => text };
}

function fail(text: string, status = 503) {
  return { ok: false, status, text: async () => text };
}

describe("runtime candidate source search", () => {
  it("builds source requests and exposes the runtime on window", () => {
    const runtime = loadRuntime();
    const requests = runtime.ZMSCandidateSources.buildCandidateSearchRequests({
      query: "low altitude UAV conflict",
      limit: 5,
      email: "me@example.test",
      semanticScholarApiKey: "ss-key"
    });

    expect(runtime.window.ZMSCandidateSources).toBe(runtime.ZMSCandidateSources);
    expect(requests.map((request: any) => request.source)).toEqual([
      "arxiv",
      "semantic_scholar",
      "crossref",
      "unpaywall"
    ]);
    expect(requests.find((request: any) => request.source === "semantic_scholar").headers)
      .toEqual({ "x-api-key": "ss-key" });
  });

  it("searches, parses, deduplicates, and converts results into candidate records", async () => {
    const runtime = loadRuntime();
    const calls: any[] = [];
    const fetchImpl = async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.includes("export.arxiv.org")) {
        return ok(`<?xml version="1.0"?>
          <feed xmlns:arxiv="http://arxiv.org/schemas/atom">
            <entry>
              <id>https://arxiv.org/abs/2401.00001</id>
              <published>2024-01-01T00:00:00Z</published>
              <title>Low Altitude UAV Conflict Resolution</title>
              <summary>Arxiv abstract.</summary>
              <author><name>A One</name></author>
              <arxiv:doi>10.1000/uav</arxiv:doi>
              <link href="https://arxiv.org/abs/2401.00001" rel="alternate"/>
              <link title="pdf" href="https://arxiv.org/pdf/2401.00001" rel="related"/>
            </entry>
          </feed>`);
      }
      if (url.includes("semanticscholar.org")) {
        return ok(JSON.stringify({
          data: [
            {
              paperId: "S2-1",
              title: "Low Altitude UAV Conflict Resolution",
              authors: [{ name: "A One" }, { name: "B Two" }],
              year: 2024,
              externalIds: { DOI: "10.1000/UAV", ArXiv: "2401.00001" },
              openAccessPdf: { url: "https://example.test/uav.pdf" },
              citationCount: 11
            }
          ]
        }));
      }
      if (url.includes("crossref.org")) {
        return ok(JSON.stringify({
          message: {
            items: [
              {
                DOI: "10.1000/uav",
                title: ["Low Altitude UAV Conflict Resolution"],
                author: [{ given: "A", family: "One" }],
                issued: { "date-parts": [[2024]] },
                URL: "https://doi.org/10.1000/uav"
              }
            ]
          }
        }));
      }
      if (url.includes("unpaywall.org")) return fail("payment required", 402);
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await runtime.ZMSCandidateSources.searchCandidateSources(fetchImpl, {
      query: "low altitude UAV conflict",
      limit: 5,
      email: "me@example.test",
      semanticScholarApiKey: "ss-key",
      collectionKey: "COL",
      now: "2026-06-13T00:00:00.000Z"
    });

    expect(calls).toHaveLength(4);
    expect(result.errors).toEqual([{ source: "unpaywall", error: "unpaywall HTTP 402: payment required" }]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      candidateId: "doi:10.1000/uav",
      title: "Low Altitude UAV Conflict Resolution",
      authors: ["A One", "B Two"],
      collectionKey: "COL",
      decision: "user_pending",
      ids: {
        doi: "10.1000/uav",
        arxivId: "2401.00001",
        semanticScholarId: "S2-1"
      },
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
      pdfUrl: "https://arxiv.org/pdf/2401.00001",
      discoveredAt: "2026-06-13T00:00:00.000Z"
    });
  });

  it("sorts runtime candidate records by priority and duplicate risk", () => {
    const runtime = loadRuntime();
    const records = [
      {
        candidateId: "weak",
        title: "Weak abstract candidate",
        year: 2024,
        decision: "user_pending",
        sourceType: "abstract_page",
        sources: ["crossref"],
        sourceIds: {},
        ids: {},
        quality: { dedupeStatus: "new", isAbstractOnly: true, hasFullPaperSignal: false, hasPdfSignal: false }
      },
      {
        candidateId: "duplicate",
        title: "Duplicate candidate",
        year: 2025,
        decision: "user_pending",
        sourceType: "doi",
        sources: ["crossref"],
        sourceIds: {},
        ids: { doi: "10.1000/dup" },
        quality: { dedupeStatus: "duplicate", isAbstractOnly: false, hasFullPaperSignal: true, hasPdfSignal: false }
      },
      {
        candidateId: "strong",
        title: "Strong candidate",
        year: 2026,
        decision: "user_pending",
        sourceType: "direct_pdf",
        sources: ["arxiv", "semantic_scholar"],
        sourceIds: {},
        ids: { doi: "10.1000/strong", arxivId: "2601.00001" },
        pdfUrl: "https://example.test/strong.pdf",
        isOpenAccess: true,
        citationCount: 25,
        quality: { dedupeStatus: "new", isAbstractOnly: false, hasFullPaperSignal: true, hasPdfSignal: true }
      }
    ];

    const sorted = runtime.ZMSCandidateSources.sortCandidateRecords(records);

    expect(sorted.map((record: any) => record.candidateId)).toEqual(["strong", "weak", "duplicate"]);
    expect(sorted[0].priority).toMatchObject({ tier: "high", recommendedDecision: "include" });
    expect(sorted[1].priority).toMatchObject({ tier: "low", recommendedDecision: "user_pending" });
    expect(sorted[2].priority).toMatchObject({ tier: "duplicate", recommendedDecision: "exclude" });
  });

  it("preserves prior human decisions while merging new discoveries", () => {
    const runtime = loadRuntime();
    const existing = [{
      candidateId: "doi:10.1000/uav",
      title: "Low Altitude UAV Conflict Resolution",
      decision: "include",
      discoveredAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
      sources: ["crossref"],
      sourceIds: { crossref: "10.1000/uav" },
      ids: { doi: "10.1000/uav" },
      quality: { dedupeStatus: "new" }
    }];
    const incoming = [{
      ...existing[0],
      decision: "user_pending",
      updatedAt: "2026-06-13T00:02:00.000Z",
      sources: ["semantic_scholar"],
      sourceIds: { semantic_scholar: "S2-1" },
      ids: { doi: "10.1000/uav", semanticScholarId: "S2-1" }
    }];

    expect(runtime.ZMSCandidateSources.mergeCandidateRecords(existing, incoming)).toEqual([
      expect.objectContaining({
        decision: "include",
        discoveredAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:02:00.000Z",
        sources: ["crossref", "semantic_scholar"],
        sourceIds: { crossref: "10.1000/uav", semantic_scholar: "S2-1" }
      })
    ]);
  });
});
