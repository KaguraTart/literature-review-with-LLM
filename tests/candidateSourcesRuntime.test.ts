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

  it("expands Semantic Scholar references and citations into ranked runtime records", async () => {
    const runtime = loadRuntime();
    const calls: any[] = [];
    const fetchImpl = async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.includes("/references?")) {
        return ok(JSON.stringify({
          data: [
            {
              citedPaper: {
                paperId: "S2-Ref",
                title: "Foundational UAV Conflict Resolution",
                authors: [{ name: "R. Ref" }],
                year: 2020,
                externalIds: { DOI: "10.1000/ref" },
                citationCount: 58
              }
            }
          ]
        }));
      }
      if (url.includes("/citations?")) {
        return ok(JSON.stringify({
          data: [
            {
              citingPaper: {
                paperId: "S2-Cite",
                title: "Recent UAV Conflict Resolution",
                authors: [{ name: "R. Cite" }],
                year: 2025,
                externalIds: { ArXiv: "2501.00001" },
                openAccessPdf: { url: "https://example.test/cite.pdf" },
                citationCount: 6
              }
            }
          ]
        }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await runtime.ZMSCandidateSources.expandCandidateCitationNetwork(fetchImpl, {
      seeds: [{ doi: "10.1000/seed", title: "Seed Paper" }],
      directions: ["references", "citations"],
      limit: 4,
      semanticScholarApiKey: "ss-key",
      collectionKey: "COL",
      now: "2026-06-19T00:00:00.000Z"
    }, []);

    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers).toEqual({ "x-api-key": "ss-key" });
    expect(result.records).toHaveLength(2);
    expect(result.records.map((record: any) => record.candidateId)).toEqual([
      "arxiv:2501.00001",
      "doi:10.1000/ref"
    ]);
    expect(result.records[0]).toMatchObject({
      collectionKey: "COL",
      pdfUrl: "https://example.test/cite.pdf",
      networkOrigins: [{ direction: "citations", seedId: "DOI:10.1000/seed", seedTitle: "Seed Paper" }],
      priority: { tier: "high", recommendedDecision: "include" }
    });
    expect(result.records[1]).toMatchObject({
      networkOrigins: [{ direction: "references", seedId: "DOI:10.1000/seed", seedTitle: "Seed Paper" }]
    });
  });

  it("follows a bounded second hop from high-value citation-network results", async () => {
    const runtime = loadRuntime();
    const calls: any[] = [];
    const fetchImpl = async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.includes("/paper/S2-Hop1/references?")) {
        return ok(JSON.stringify({ data: [] }));
      }
      if (url.includes("/paper/S2-Hop1/citations?")) {
        return ok(JSON.stringify({
          data: [
            {
              citingPaper: {
                paperId: "S2-Hop2",
                title: "Second Hop Conflict Resolution",
                authors: [{ name: "H. Two" }],
                year: 2024,
                externalIds: { DOI: "10.1000/hop2" },
                citationCount: 21
              }
            }
          ]
        }));
      }
      if (url.includes("/references?")) {
        return ok(JSON.stringify({
          data: [
            {
              citedPaper: {
                paperId: "S2-Hop1",
                title: "First Hop Conflict Resolution",
                authors: [{ name: "H. One" }],
                year: 2025,
                externalIds: { DOI: "10.1000/hop1" },
                openAccessPdf: { url: "https://example.test/hop1.pdf" },
                citationCount: 42
              }
            }
          ]
        }));
      }
      if (url.includes("/citations?")) {
        return ok(JSON.stringify({ data: [] }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await runtime.ZMSCandidateSources.expandCandidateCitationNetwork(fetchImpl, {
      seeds: [{ doi: "10.1000/seed", title: "Seed Paper" }],
      directions: ["references", "citations"],
      limit: 2,
      maxHops: 2,
      nextHopSeedLimit: 1,
      maxNetworkRequests: 4,
      collectionKey: "COL",
      now: "2026-06-19T00:00:00.000Z"
    }, []);

    expect(result.hops).toBe(2);
    expect(calls).toHaveLength(4);
    expect(calls[2].url).toContain("/paper/S2-Hop1/references?");
    expect(calls[3].url).toContain("/paper/S2-Hop1/citations?");
    const hop1 = result.records.find((record: any) => record.candidateId === "doi:10.1000/hop1");
    const hop2 = result.records.find((record: any) => record.candidateId === "doi:10.1000/hop2");
    expect(hop1).toMatchObject({
      pdfUrl: "https://example.test/hop1.pdf",
      networkOrigins: [{ direction: "references", seedId: "DOI:10.1000/seed", seedTitle: "Seed Paper", hop: 1 }]
    });
    expect(hop2).toMatchObject({
      networkOrigins: [{ direction: "citations", seedId: "S2-Hop1", seedTitle: "First Hop Conflict Resolution", hop: 2 }]
    });
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
