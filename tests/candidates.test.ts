import { describe, expect, it } from "vitest";
import {
  arxivSearchUrl,
  buildCandidateSearchRequests,
  buildCitationNetworkRequests,
  candidateFingerprint,
  crossrefSearchUrl,
  dedupeCandidatePapers,
  parseArxivAtom,
  parseCrossrefWorksResponse,
  parseSemanticScholarCitationNetworkResponse,
  parseSemanticScholarResponse,
  parseUnpaywallDoiResponse,
  parseUnpaywallSearchResponse,
  semanticScholarCitationNetworkUrl,
  semanticScholarSearchUrl,
  unpaywallDoiUrl,
  unpaywallTitleSearchUrl
} from "../src/candidates.js";

describe("candidate source adapters", () => {
  it("builds candidate search requests for configured sources", () => {
    const requests = buildCandidateSearchRequests({
      query: "low altitude UAV conflict resolution",
      limit: 5,
      offset: 10,
      year: "2023-2026",
      email: "researcher@example.test",
      openAccessOnly: true,
      semanticScholarApiKey: "ss-test-key"
    });

    expect(requests.map((request) => request.source)).toEqual([
      "arxiv",
      "semantic_scholar",
      "crossref",
      "unpaywall"
    ]);
    expect(requests.find((request) => request.source === "semantic_scholar")?.headers).toEqual({
      "x-api-key": "ss-test-key"
    });
    expect(requests.find((request) => request.source === "unpaywall")?.url).toContain("email=researcher%40example.test");
  });

  it("omits Unpaywall title search without an email address", () => {
    const requests = buildCandidateSearchRequests({ query: "traffic flow", limit: 5 });
    expect(requests.map((request) => request.source)).toEqual(["arxiv", "semantic_scholar", "crossref"]);
  });

  it("constructs source-specific search URLs", () => {
    expect(new URL(arxivSearchUrl({ query: "multi agent RL", limit: 3 })).searchParams.get("search_query"))
      .toBe("all:multi agent RL");
    expect(new URL(semanticScholarSearchUrl({ query: "multi agent RL", year: "2024" })).searchParams.get("fields"))
      .toContain("openAccessPdf");
    expect(new URL(crossrefSearchUrl({ query: "multi agent RL", email: "me@example.test" })).searchParams.get("mailto"))
      .toBe("me@example.test");
    expect(new URL(unpaywallTitleSearchUrl({
      query: "multi agent RL",
      email: "me@example.test",
      openAccessOnly: true
    })).searchParams.get("is_oa")).toBe("true");
    expect(unpaywallDoiUrl("https://doi.org/10.1000/XYZ", "me@example.test"))
      .toBe("https://api.unpaywall.org/v2/10.1000%2Fxyz?email=me%40example.test");
  });

  it("builds Semantic Scholar citation-network requests from DOI and paper IDs", () => {
    const requests = buildCitationNetworkRequests({
      seeds: [
        { title: "Seed Paper", doi: "10.1000/Seed" },
        { title: "S2 Seed", semanticScholarId: "S2-Seed" },
        { title: "Title Only" }
      ],
      limit: 6,
      directions: ["references", "citations"],
      semanticScholarApiKey: "ss-test-key"
    });

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.networkDirection)).toEqual([
      "references",
      "citations",
      "references",
      "citations"
    ]);
    expect(requests[0]).toMatchObject({
      source: "semantic_scholar",
      headers: { "x-api-key": "ss-test-key" },
      seedId: "DOI:10.1000/seed",
      seedTitle: "Seed Paper"
    });
    const url = new URL(requests[0].url);
    expect(url.pathname).toContain("/paper/DOI%3A10.1000%2Fseed/references");
    expect(url.searchParams.get("fields")).toContain("citedPaper.title");
    expect(new URL(requests[1].url).searchParams.get("fields")).toContain("citingPaper.title");
    expect(semanticScholarCitationNetworkUrl("S2-Seed", "citations", 3)).toContain("/paper/S2-Seed/citations?");
  });

  it("parses arXiv Atom records", () => {
    const papers = parseArxivAtom(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
        <entry>
          <id>http://arxiv.org/abs/2401.01234v2</id>
          <published>2024-01-02T00:00:00Z</published>
          <title>Low-altitude UAV Conflict Resolution &amp; Safety</title>
          <summary> A CTDE safety-filter method. </summary>
          <author><name>Ada Chen</name></author>
          <author><name>Bo Liu</name></author>
          <arxiv:doi>10.48550/arXiv.2401.01234</arxiv:doi>
          <link href="http://arxiv.org/abs/2401.01234v2" rel="alternate" type="text/html"/>
          <link title="pdf" href="http://arxiv.org/pdf/2401.01234v2" rel="related" type="application/pdf"/>
        </entry>
      </feed>`);

    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      source: "arxiv",
      title: "Low-altitude UAV Conflict Resolution & Safety",
      authors: ["Ada Chen", "Bo Liu"],
      year: 2024,
      doi: "10.48550/arxiv.2401.01234",
      arxivId: "2401.01234v2",
      url: "http://arxiv.org/abs/2401.01234v2",
      pdfUrl: "http://arxiv.org/pdf/2401.01234v2",
      isOpenAccess: true
    });
  });

  it("parses Semantic Scholar paper search records", () => {
    const papers = parseSemanticScholarResponse({
      data: [
        {
          paperId: "S2-123",
          title: "Learning Airspace Conflict Resolution",
          authors: [{ name: "R. Zhang" }, { name: "M. Chen" }],
          year: 2025,
          abstract: "A graph policy for tactical deconfliction.",
          venue: "Transportation Research Part C",
          url: "https://www.semanticscholar.org/paper/S2-123",
          externalIds: { DOI: "10.1016/j.trc.2025.01.001", ArXiv: "2501.00001" },
          openAccessPdf: { url: "https://example.test/paper.pdf" },
          citationCount: 17
        }
      ]
    });

    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      source: "semantic_scholar",
      sourceIds: { semantic_scholar: "S2-123" },
      doi: "10.1016/j.trc.2025.01.001",
      arxivId: "2501.00001",
      authors: ["R. Zhang", "M. Chen"],
      pdfUrl: "https://example.test/paper.pdf",
      citationCount: 17
    });
  });

  it("parses Semantic Scholar references and citations into network-origin candidates", () => {
    const references = parseSemanticScholarCitationNetworkResponse({
      data: [
        {
          citedPaper: {
            paperId: "S2-Ref",
            title: "Foundational Conflict Resolution",
            authors: [{ name: "A. Ref" }],
            year: 2020,
            externalIds: { DOI: "10.1000/ref" },
            citationCount: 41
          }
        }
      ]
    }, "references", { semanticScholarId: "S2-Seed", title: "Seed Paper" });
    const citations = parseSemanticScholarCitationNetworkResponse({
      data: [
        {
          citingPaper: {
            paperId: "S2-Cite",
            title: "Recent Conflict Resolution",
            authors: [{ name: "A. Cite" }],
            year: 2025,
            externalIds: { ArXiv: "2501.00001" },
            openAccessPdf: { url: "https://example.test/cite.pdf" }
          }
        }
      ]
    }, "citations", { doi: "10.1000/seed", title: "Seed DOI Paper" });

    expect(references[0]).toMatchObject({
      id: "doi:10.1000/ref",
      sourceIds: { semantic_scholar: "S2-Ref" },
      networkOrigins: [{ direction: "references", seedId: "S2-Seed", seedTitle: "Seed Paper" }]
    });
    expect(citations[0]).toMatchObject({
      id: "arxiv:2501.00001",
      pdfUrl: "https://example.test/cite.pdf",
      networkOrigins: [{ direction: "citations", seedId: "DOI:10.1000/seed", seedTitle: "Seed DOI Paper" }]
    });
  });

  it("parses Crossref works records", () => {
    const papers = parseCrossrefWorksResponse({
      message: {
        items: [
          {
            DOI: "10.1109/TITS.2024.1234567",
            title: ["Risk-aware UAV Route Planning"],
            author: [{ given: "Lin", family: "Wang" }],
            "published-online": { "date-parts": [[2024, 6, 1]] },
            "container-title": ["IEEE Transactions on Intelligent Transportation Systems"],
            URL: "https://doi.org/10.1109/TITS.2024.1234567",
            abstract: "<jats:p>Risk-aware planning with <i>formal</i> constraints.</jats:p>",
            score: 42.5
          }
        ]
      }
    });

    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      source: "crossref",
      title: "Risk-aware UAV Route Planning",
      doi: "10.1109/tits.2024.1234567",
      authors: ["Lin Wang"],
      year: 2024,
      venue: "IEEE Transactions on Intelligent Transportation Systems",
      abstract: "Risk-aware planning with formal constraints.",
      score: 42.5
    });
  });

  it("parses Unpaywall search and DOI records", () => {
    const doiPaper = parseUnpaywallDoiResponse({
      doi: "10.1145/1234567",
      title: "Open Access Conflict Detection",
      year: 2023,
      z_authors: [{ given: "Eva", family: "Ma" }],
      journal_name: "ACM Journal",
      doi_url: "https://doi.org/10.1145/1234567",
      is_oa: true,
      best_oa_location: {
        url: "https://publisher.example.test/article",
        url_for_pdf: "https://publisher.example.test/article.pdf"
      }
    });

    expect(doiPaper).toMatchObject({
      source: "unpaywall",
      doi: "10.1145/1234567",
      title: "Open Access Conflict Detection",
      authors: ["Eva Ma"],
      year: 2023,
      venue: "ACM Journal",
      pdfUrl: "https://publisher.example.test/article.pdf",
      isOpenAccess: true
    });

    const searchPapers = parseUnpaywallSearchResponse({
      results: [{ score: 0.91, response: doiPaper }]
    });
    expect(searchPapers[0]).toMatchObject({ score: 0.91, doi: "10.1145/1234567" });
  });

  it("deduplicates papers by DOI, arXiv ID, then normalized title and year", () => {
    const [crossrefPaper] = parseCrossrefWorksResponse({
      message: {
        items: [
          {
            DOI: "10.1000/ABC",
            title: ["Urban Air Mobility Conflict Resolution"],
            author: [{ given: "A", family: "One" }],
            issued: { "date-parts": [[2024]] },
            URL: "https://doi.org/10.1000/ABC",
            abstract: "Short abstract."
          }
        ]
      }
    });
    const [semanticPaper] = parseSemanticScholarResponse({
      data: [
        {
          paperId: "S2-ABC",
          title: "Urban Air Mobility Conflict Resolution",
          authors: [{ name: "A One" }, { name: "B Two" }],
          year: 2024,
          externalIds: { DOI: "https://doi.org/10.1000/abc", ArXiv: "2402.00002" },
          abstract: "A longer abstract that should replace the short abstract during merge.",
          openAccessPdf: { url: "https://example.test/abc.pdf" },
          citationCount: 9
        }
      ]
    });
    const unpaywallPaper = parseUnpaywallDoiResponse({
      doi: "doi:10.1000/ABC",
      title: "Urban Air Mobility Conflict Resolution",
      year: 2024,
      is_oa: true,
      best_oa_location: { url_for_pdf: "https://example.test/unpaywall.pdf" }
    });
    const [titleOnly] = parseCrossrefWorksResponse({
      message: {
        items: [
          {
            title: ["Urban-Air Mobility: Conflict Resolution"],
            issued: { "date-parts": [[2024]] },
            URL: "https://example.test/title-only"
          }
        ]
      }
    });

    const deduped = dedupeCandidatePapers([crossrefPaper, semanticPaper, unpaywallPaper!, titleOnly]);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toMatchObject({
      id: "doi:10.1000/abc",
      doi: "10.1000/abc",
      arxivId: "2402.00002",
      sources: ["crossref", "semantic_scholar", "unpaywall"],
      sourceIds: {
        crossref: "10.1000/abc",
        semantic_scholar: "S2-ABC",
        unpaywall: "10.1000/abc"
      },
      authors: ["A One", "B Two"],
      abstract: "A longer abstract that should replace the short abstract during merge.",
      pdfUrl: "https://example.test/abc.pdf",
      isOpenAccess: true,
      citationCount: 9
    });
    expect(candidateFingerprint(titleOnly)).toBe("title:urban air mobility conflict resolution:2024");
  });
});
