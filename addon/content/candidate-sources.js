var ZMSCandidateSources = (() => {
  const SEMANTIC_SCHOLAR_FIELDS = [
    "paperId",
    "title",
    "authors",
    "year",
    "abstract",
    "venue",
    "url",
    "externalIds",
    "openAccessPdf",
    "citationCount",
    "publicationDate"
  ].join(",");

  const SEMANTIC_SCHOLAR_NETWORK_PAPER_FIELDS = [
    "paperId",
    "title",
    "authors",
    "year",
    "abstract",
    "venue",
    "url",
    "externalIds",
    "openAccessPdf",
    "citationCount",
    "publicationDate"
  ];

  const CROSSREF_SELECT_FIELDS = [
    "DOI",
    "title",
    "author",
    "published-print",
    "published-online",
    "issued",
    "container-title",
    "URL",
    "abstract",
    "score",
    "type"
  ].join(",");

  async function searchCandidateSources(fetchImpl, options, existingRecords = []) {
    const requests = buildCandidateSearchRequests(options);
    const settled = await Promise.allSettled(requests.map((request) => fetchCandidateRequest(fetchImpl, request)));
    const papers = [];
    const errors = [];
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      const request = requests[index];
      if (result.status === "fulfilled") {
        papers.push(...result.value);
      } else {
        errors.push({ source: request.source, error: safeError(result.reason) });
      }
    }
    const now = options.now || new Date().toISOString();
    const existingIdentities = candidateIdentitiesFromRecords(existingRecords);
    const records = sortCandidateRecords(dedupeCandidatePapers(papers).map((paper) => candidateRecordFromPaper(paper, {
      query: options.query,
      collectionKey: options.collectionKey,
      now,
      existing: existingIdentities
    })));
    return {
      records,
      papers,
      errors,
      requests
    };
  }

  async function expandCandidateCitationNetwork(fetchImpl, options, existingRecords = []) {
    const papers = [];
    const errors = [];
    const requests = [];
    const maxHops = clamp(Number(options?.maxHops) || 1, 1, 3);
    const maxNetworkRequests = clamp(Number(options?.maxNetworkRequests || options?.maxRequests) || 12, 1, 100);
    const nextHopSeedLimit = clamp(Number(options?.nextHopSeedLimit || options?.seedLimit) || 4, 1, 20);
    let frontier = normalizeCitationSeeds(options?.seeds || []);
    const seenSeedKeys = new Set(frontier.map((seed) => citationSeedKey(seed)));
    const seenRequestKeys = new Set();
    let completedHops = 0;
    for (let hop = 1; hop <= maxHops && frontier.length && requests.length < maxNetworkRequests; hop += 1) {
      const hopRequests = buildCitationNetworkRequests({ ...options, seeds: frontier })
        .map((request) => ({ ...request, networkHop: hop }))
        .filter((request) => {
          const key = citationRequestKey(request);
          if (seenRequestKeys.has(key)) return false;
          seenRequestKeys.add(key);
          return true;
        })
        .slice(0, Math.max(0, maxNetworkRequests - requests.length));
      if (!hopRequests.length) break;
      requests.push(...hopRequests);
      const settled = await Promise.allSettled(hopRequests.map((request) => fetchCandidateRequest(fetchImpl, request)));
      const hopPapers = [];
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        const request = hopRequests[index];
        if (result.status === "fulfilled") {
          hopPapers.push(...result.value);
        } else {
          errors.push({ source: `${request.source}:${request.networkDirection || "network"}:hop${hop}`, error: safeError(result.reason) });
        }
      }
      papers.push(...hopPapers);
      completedHops = hop;
      frontier = nextCitationFrontier(hopPapers, seenSeedKeys, nextHopSeedLimit);
    }
    const now = options.now || new Date().toISOString();
    const existingIdentities = candidateIdentitiesFromRecords(existingRecords);
    const records = sortCandidateRecords(dedupeCandidatePapers(papers).map((paper) => candidateRecordFromPaper(paper, {
      query: options.query || "citation-network",
      collectionKey: options.collectionKey,
      now,
      existing: existingIdentities
    })));
    return {
      records,
      papers,
      errors,
      requests,
      hops: completedHops
    };
  }

  async function fetchCandidateRequest(fetchImpl, request) {
    const response = await fetchImpl(request.url, {
      method: request.method || "GET",
      headers: request.headers || {}
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${request.source} HTTP ${response.status}: ${text.slice(0, 300)}`);
    if (request.source === "arxiv") return parseArxivAtom(text);
    const data = text ? JSON.parse(text) : {};
    if (request.source === "semantic_scholar" && request.networkDirection) {
      return parseSemanticScholarCitationNetworkResponse(data, request.networkDirection, {
        semanticScholarId: request.seedId,
        title: request.seedTitle,
        hop: request.networkHop
      });
    }
    if (request.source === "semantic_scholar") return parseSemanticScholarResponse(data);
    if (request.source === "crossref") return parseCrossrefWorksResponse(data);
    if (request.source === "unpaywall") return parseUnpaywallSearchResponse(data);
    return [];
  }

  function buildCandidateSearchRequests(options) {
    const query = String(options?.query || "").trim();
    if (!query) return [];
    const requests = [
      { source: "arxiv", method: "GET", url: arxivSearchUrl(options) },
      {
        source: "semantic_scholar",
        method: "GET",
        url: semanticScholarSearchUrl(options),
        headers: options.semanticScholarApiKey ? { "x-api-key": options.semanticScholarApiKey } : undefined
      },
      { source: "crossref", method: "GET", url: crossrefSearchUrl(options) }
    ];
    if (options.email) {
      requests.push({ source: "unpaywall", method: "GET", url: unpaywallTitleSearchUrl(options) });
    }
    return requests;
  }

  function buildCitationNetworkRequests(options) {
    const directions = normalizeCitationDirections(options?.directions);
    const perSeedLimit = clamp(Number(options?.perSeedLimit || options?.limit) || 8, 1, 100);
    const seeds = (options?.seeds || [])
      .map((seed) => ({ raw: seed, semanticScholarId: semanticScholarSeedId(seed) }))
      .filter((seed) => seed.semanticScholarId);
    const requests = [];
    for (const seed of seeds) {
      for (const direction of directions) {
        requests.push({
          source: "semantic_scholar",
          method: "GET",
          url: semanticScholarCitationNetworkUrl(seed.semanticScholarId, direction, perSeedLimit),
          headers: options?.semanticScholarApiKey ? { "x-api-key": options.semanticScholarApiKey } : undefined,
          networkDirection: direction,
          seedId: seed.semanticScholarId,
          seedTitle: cleanText(seed.raw?.title) || undefined
        });
      }
    }
    return requests;
  }

  function arxivSearchUrl(options) {
    const params = new URLSearchParams({
      search_query: `all:${String(options.query || "").trim()}`,
      start: String(Math.max(0, Number(options.offset) || 0)),
      max_results: String(clamp(Number(options.limit) || 20, 1, 100)),
      sortBy: "relevance",
      sortOrder: "descending"
    });
    return `https://export.arxiv.org/api/query?${params.toString()}`;
  }

  function semanticScholarSearchUrl(options) {
    const params = new URLSearchParams({
      query: String(options.query || "").trim(),
      limit: String(clamp(Number(options.limit) || 20, 1, 100)),
      fields: SEMANTIC_SCHOLAR_FIELDS
    });
    if (options.offset) params.set("offset", String(Math.max(0, Number(options.offset) || 0)));
    if (options.year) params.set("year", String(options.year));
    if (options.openAccessOnly) params.set("openAccessPdf", "true");
    return `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;
  }

  function semanticScholarCitationNetworkUrl(paperId, direction, limit = 8, offset = 0) {
    const normalizedDirection = direction === "citations" ? "citations" : "references";
    const fieldPrefix = normalizedDirection === "references" ? "citedPaper" : "citingPaper";
    const params = new URLSearchParams({
      limit: String(clamp(Number(limit) || 8, 1, 100)),
      offset: String(Math.max(0, Number(offset) || 0)),
      fields: SEMANTIC_SCHOLAR_NETWORK_PAPER_FIELDS.map((field) => `${fieldPrefix}.${field}`).join(",")
    });
    return `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/${normalizedDirection}?${params.toString()}`;
  }

  function crossrefSearchUrl(options) {
    const params = new URLSearchParams({
      "query.bibliographic": String(options.query || "").trim(),
      rows: String(clamp(Number(options.limit) || 20, 1, 100)),
      offset: String(Math.max(0, Number(options.offset) || 0)),
      select: CROSSREF_SELECT_FIELDS
    });
    if (options.email) params.set("mailto", String(options.email));
    return `https://api.crossref.org/works?${params.toString()}`;
  }

  function unpaywallTitleSearchUrl(options) {
    if (!options.email) throw new Error("Unpaywall search requires an email address");
    const params = new URLSearchParams({
      query: String(options.query || "").trim(),
      email: String(options.email)
    });
    if (options.openAccessOnly) params.set("is_oa", "true");
    if (options.offset) params.set("page", String(Math.floor(Math.max(0, Number(options.offset) || 0) / 50) + 1));
    return `https://api.unpaywall.org/v2/search/?${params.toString()}`;
  }

  function parseArxivAtom(xml) {
    const entries = Array.from(String(xml || "").matchAll(/<entry\b[\s\S]*?<\/entry>/g)).map((match) => match[0]);
    return entries.map((entry) => {
      const title = cleanText(xmlValue(entry, "title"));
      if (!title) return null;
      const idUrl = cleanText(xmlValue(entry, "id"));
      const arxivId = arxivIdFromUrl(idUrl);
      const doi = cleanText(xmlValue(entry, "arxiv:doi")) || undefined;
      const authors = Array.from(entry.matchAll(/<author\b[\s\S]*?<\/author>/g))
        .map((match) => cleanText(xmlValue(match[0], "name")))
        .filter(Boolean);
      const pdfUrl = linkHref(entry, "related") || linkHrefByTitle(entry, "pdf");
      return candidate({
        source: "arxiv",
        sourceId: arxivId || idUrl || title,
        title,
        authors,
        year: yearFromDate(xmlValue(entry, "published")),
        doi,
        arxivId,
        url: linkHref(entry, "alternate") || idUrl || undefined,
        pdfUrl: pdfUrl || undefined,
        abstract: cleanText(xmlValue(entry, "summary")) || undefined,
        isOpenAccess: !!pdfUrl || !!idUrl
      });
    }).filter(Boolean);
  }

  function parseSemanticScholarResponse(data) {
    const records = Array.isArray(data?.data) ? data.data : [];
    return records.map((item) => semanticScholarPaperFromItem(item)).filter(Boolean);
  }

  function parseSemanticScholarCitationNetworkResponse(data, direction, seed) {
    const records = Array.isArray(data?.data) ? data.data : [];
    const normalizedDirection = direction === "citations" ? "citations" : "references";
    const paperKey = normalizedDirection === "references" ? "citedPaper" : "citingPaper";
    const seedId = semanticScholarSeedId(seed || {}) || cleanText(seed?.candidateId) || cleanText(seed?.doi) || cleanText(seed?.arxivId);
    const seedTitle = cleanText(seed?.title) || undefined;
    const hop = numberOrUndefined(seed?.hop);
    return records.map((item) => {
      const paper = semanticScholarPaperFromItem(item?.[paperKey]);
      if (!paper || !seedId) return paper;
      return {
        ...paper,
        networkOrigins: mergeNetworkOrigins(paper.networkOrigins, [{ direction: normalizedDirection, seedId, seedTitle, ...(hop ? { hop } : {}) }])
      };
    }).filter(Boolean);
  }

  function parseCrossrefWorksResponse(data) {
    const items = Array.isArray(data?.message?.items) ? data.message.items : [];
    return items.map((item) => {
      const title = cleanText(first(item?.title));
      if (!title) return null;
      const doi = normalizeDoi(item?.DOI);
      return candidate({
        source: "crossref",
        sourceId: doi || cleanText(item?.URL) || title,
        title,
        authors: crossrefAuthorNames(item?.author),
        year: crossrefYear(item),
        doi,
        venue: cleanText(first(item?.["container-title"])) || undefined,
        abstract: stripMarkup(item?.abstract) || undefined,
        url: cleanText(item?.URL) || undefined,
        score: numberOrUndefined(item?.score)
      });
    }).filter(Boolean);
  }

  function parseUnpaywallSearchResponse(data) {
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((item) => {
      const paper = parseUnpaywallDoiResponse(item?.response);
      if (!paper) return null;
      return { ...paper, score: numberOrUndefined(item?.score) ?? paper.score };
    }).filter(Boolean);
  }

  function parseUnpaywallDoiResponse(data) {
    const title = cleanText(data?.title);
    if (!title) return null;
    const doi = normalizeDoi(data?.doi);
    const bestLocation = data?.best_oa_location || {};
    const pdfUrl = cleanText(bestLocation.url_for_pdf || bestLocation.url);
    return candidate({
      source: "unpaywall",
      sourceId: doi || title,
      title,
      authors: crossrefAuthorNames(data?.z_authors),
      year: numberOrUndefined(data?.year) || yearFromDate(data?.published_date),
      doi,
      venue: cleanText(data?.journal_name) || undefined,
      url: cleanText(data?.doi_url || bestLocation.url) || undefined,
      pdfUrl: pdfUrl || undefined,
      isOpenAccess: Boolean(data?.is_oa)
    });
  }

  function dedupeCandidatePapers(papers) {
    const byKey = new Map();
    for (const paper of papers || []) {
      const key = candidateFingerprint(paper);
      byKey.set(key, byKey.has(key) ? mergeCandidatePaper(byKey.get(key), paper) : { ...paper });
    }
    return [...byKey.values()];
  }

  function candidateRecordFromPaper(paper, options = {}) {
    const sourceType = candidateSourceType(paper);
    const quality = candidateQuality(paper, sourceType, options.existing || []);
    const now = options.now || new Date().toISOString();
    return withCandidatePriority({
      candidateId: paper.id || candidateFingerprint(paper),
      title: paper.title,
      authors: [...(paper.authors || [])],
      year: paper.year,
      venue: paper.venue,
      abstract: paper.abstract,
      sourceUrl: paper.url || paper.pdfUrl || "",
      pdfUrl: paper.pdfUrl,
      sourceType,
      sources: [...(paper.sources || [paper.source]).filter(Boolean)],
      sourceIds: { ...(paper.sourceIds || {}) },
      ids: {
        doi: paper.doi,
        arxivId: paper.arxivId,
        semanticScholarId: paper.sourceIds?.semantic_scholar,
        unpaywallDoi: (paper.sources || []).includes("unpaywall") ? paper.doi : undefined
      },
      quality,
      decision: "user_pending",
      query: options.query,
      collectionKey: options.collectionKey,
      discoveredAt: now,
      updatedAt: now,
      isOpenAccess: paper.isOpenAccess,
      citationCount: paper.citationCount,
      score: paper.score,
      networkOrigins: paper.networkOrigins ? paper.networkOrigins.map((origin) => ({ ...origin })) : undefined
    });
  }

  function mergeCandidateRecords(existing, incoming) {
    const byId = new Map();
    for (const record of existing || []) byId.set(record.candidateId, withCandidatePriority(cloneCandidateRecord(record)));
    for (const record of incoming || []) {
      const previous = byId.get(record.candidateId);
      if (!previous) {
        byId.set(record.candidateId, withCandidatePriority(cloneCandidateRecord(record)));
        continue;
      }
      byId.set(record.candidateId, withCandidatePriority({
        ...previous,
        ...record,
        discoveredAt: previous.discoveredAt,
        decision: previous.decision === "user_pending" ? record.decision : previous.decision,
        sources: [...new Set([...(previous.sources || []), ...(record.sources || [])])],
        sourceIds: { ...(previous.sourceIds || {}), ...(record.sourceIds || {}) },
        ids: { ...(previous.ids || {}), ...(record.ids || {}) },
        networkOrigins: mergeNetworkOrigins(previous.networkOrigins, record.networkOrigins),
        quality: record.quality,
        updatedAt: record.updatedAt
      }));
    }
    return sortCandidateRecords([...byId.values()]);
  }

  function candidateIdentitiesFromRecords(records) {
    return (records || []).map((record) => ({
      title: record.title,
      year: record.year,
      doi: record.ids?.doi,
      arxivId: record.ids?.arxivId
    }));
  }

  function candidateSourceType(paper) {
    const url = String(paper.url || paper.pdfUrl || "").toLowerCase();
    if (paper.pdfUrl || /\.pdf(?:[?#].*)?$/.test(url)) return "direct_pdf";
    if (paper.arxivId || /arxiv\.org\/(abs|pdf)\//.test(url)) return "arxiv";
    if (paper.doi || /doi\.org\//.test(url)) return "doi";
    if (/proceedings|conference|conf|symposium|workshop/.test(url)) return "proceedings";
    if (/abstract|\/abs\/|\/record\/|\/paper\/summary/.test(url)) return "abstract_page";
    if (paper.isOpenAccess) return "publisher";
    return "webpage";
  }

  function candidateQuality(paper, sourceType, existing = []) {
    const duplicate = candidateMatchesExistingPaper(paper, existing);
    const hasPdfSignal = Boolean(paper.pdfUrl || /\.pdf(?:[?#].*)?$/i.test(String(paper.url || "")));
    const hasIdentifier = Boolean(normalizeDoi(paper.doi) || normalizeArxivId(paper.arxivId));
    const hasFullPaperSignal = hasPdfSignal || hasIdentifier || Boolean(paper.isOpenAccess && sourceType !== "abstract_page");
    const isAbstractOnly = !hasPdfSignal && !hasIdentifier && (sourceType === "abstract_page" || sourceType === "webpage");
    if (duplicate.status === "duplicate") {
      return { hasFullPaperSignal, hasPdfSignal, isAbstractOnly, dedupeStatus: "duplicate", reason: "matched existing paper identity" };
    }
    if (duplicate.status === "uncertain") {
      return { hasFullPaperSignal, hasPdfSignal, isAbstractOnly, dedupeStatus: "uncertain", reason: "similar title to an existing paper" };
    }
    return { hasFullPaperSignal, hasPdfSignal, isAbstractOnly, dedupeStatus: "new", reason: qualityReason({ hasPdfSignal, hasIdentifier, isAbstractOnly, isOpenAccess: !!paper.isOpenAccess, sourceType }) };
  }

  function candidateMatchesExistingPaper(paper, existing) {
    const doi = normalizeDoi(paper.doi);
    const arxivId = normalizeArxivId(paper.arxivId);
    const title = normalizeTitle(paper.title);
    for (const item of existing || []) {
      if (doi && normalizeDoi(item.doi) === doi) return { status: "duplicate" };
      if (arxivId && normalizeArxivId(item.arxivId) === arxivId) return { status: "duplicate" };
      const itemTitle = normalizeTitle(item.title);
      if (title && itemTitle && paper.year && item.year === paper.year && title === itemTitle) return { status: "duplicate" };
    }
    for (const item of existing || []) {
      if (titleTokenOverlap(title, normalizeTitle(item.title)) >= 0.7) return { status: "uncertain" };
    }
    return { status: "new" };
  }

  function candidate(input) {
    const paper = {
      ...input,
      doi: normalizeDoi(input.doi) || undefined,
      arxivId: normalizeArxivId(input.arxivId) || undefined,
      authors: (input.authors || []).filter(Boolean),
      sources: [input.source],
      sourceIds: { [input.source]: input.sourceId }
    };
    return { ...paper, id: candidateFingerprint(paper) };
  }

  function semanticScholarPaperFromItem(item) {
    const title = cleanText(item?.title);
    if (!title) return null;
    const externalIds = item?.externalIds || {};
    const doi = normalizeDoi(externalIds.DOI || externalIds.Doi);
    const arxivId = cleanText(externalIds.ArXiv || externalIds.arXiv);
    const pdfUrl = cleanText(item?.openAccessPdf?.url);
    return candidate({
      source: "semantic_scholar",
      sourceId: cleanText(item?.paperId) || doi || arxivId || title,
      title,
      authors: authorNames(item?.authors),
      year: numberOrUndefined(item?.year) || yearFromDate(item?.publicationDate),
      doi,
      arxivId: arxivId || undefined,
      venue: cleanText(item?.venue) || undefined,
      abstract: cleanText(item?.abstract) || undefined,
      url: cleanText(item?.url) || undefined,
      pdfUrl: pdfUrl || undefined,
      isOpenAccess: !!pdfUrl,
      citationCount: numberOrUndefined(item?.citationCount)
    });
  }

  function candidateFingerprint(paper) {
    const doi = normalizeDoi(paper.doi);
    if (doi) return `doi:${doi}`;
    const arxivId = normalizeArxivId(paper.arxivId);
    if (arxivId) return `arxiv:${arxivId}`;
    return `title:${normalizeTitle(paper.title)}:${paper.year || ""}`;
  }

  function mergeCandidatePaper(left, right) {
    const sources = [...new Set([...(left.sources || []), ...(right.sources || [])])];
    const merged = {
      ...left,
      sources,
      sourceIds: { ...(left.sourceIds || {}), ...(right.sourceIds || {}) },
      authors: (left.authors || []).length >= (right.authors || []).length ? left.authors : right.authors,
      doi: left.doi || right.doi,
      arxivId: left.arxivId || right.arxivId,
      venue: left.venue || right.venue,
      abstract: longer(left.abstract, right.abstract),
      url: left.url || right.url,
      pdfUrl: left.pdfUrl || right.pdfUrl,
      isOpenAccess: left.isOpenAccess || right.isOpenAccess,
      citationCount: maxNumber(left.citationCount, right.citationCount),
      score: maxNumber(left.score, right.score),
      networkOrigins: mergeNetworkOrigins(left.networkOrigins, right.networkOrigins)
    };
    return { ...merged, id: candidateFingerprint(merged) };
  }

  function mergeNetworkOrigins(left = [], right = []) {
    const byKey = new Map();
    for (const origin of [...(left || []), ...(right || [])]) {
      if (!origin?.direction || !origin?.seedId) continue;
      const hop = numberOrUndefined(origin.hop);
      byKey.set(`${origin.direction}:${origin.seedId}:${hop || ""}`, {
        direction: origin.direction,
        seedId: origin.seedId,
        seedTitle: origin.seedTitle,
        ...(hop ? { hop } : {})
      });
    }
    const origins = [...byKey.values()];
    return origins.length ? origins : undefined;
  }

  function cloneCandidateRecord(record) {
    return {
      ...record,
      authors: [...(record.authors || [])],
      sources: [...(record.sources || [])],
      sourceIds: { ...(record.sourceIds || {}) },
      ids: { ...(record.ids || {}) },
      quality: { ...(record.quality || {}) },
      priority: record.priority ? { ...record.priority, reasons: [...(record.priority.reasons || [])] } : undefined,
      networkOrigins: record.networkOrigins ? record.networkOrigins.map((origin) => ({ ...origin })) : undefined
    };
  }

  function qualityReason(input) {
    if (input.hasPdfSignal) return "direct PDF or PDF URL available";
    if (input.hasIdentifier) return "stable DOI or arXiv identifier available";
    if (input.isOpenAccess) return "open access location available";
    if (input.isAbstractOnly) return "abstract or weak webpage source only";
    return `${input.sourceType} source needs manual review`;
  }

  function withCandidatePriority(record) {
    return {
      ...record,
      priority: candidatePriority(record)
    };
  }

  function candidatePriority(record) {
    const quality = record.quality || {};
    const reasons = [];
    let score = 0;
    if (quality.dedupeStatus === "duplicate") {
      return {
        score: 0,
        tier: "duplicate",
        recommendedDecision: "exclude",
        reasons: ["duplicate candidate or existing Zotero item"]
      };
    }
    if (quality.hasPdfSignal || record.pdfUrl) {
      score += 32;
      reasons.push("PDF available");
    }
    if (record.ids?.doi || record.ids?.arxivId) {
      score += 22;
      reasons.push("stable DOI or arXiv identifier");
    }
    if (record.isOpenAccess) {
      score += 10;
      reasons.push("open access signal");
    }
    const sourceCount = new Set(record.sources || []).size;
    if (sourceCount > 1) {
      score += Math.min(14, (sourceCount - 1) * 7);
      reasons.push(`${sourceCount} sources agree`);
    }
    if (Number.isFinite(record.citationCount)) {
      const citationScore = Math.min(14, Math.floor(Math.log10(Number(record.citationCount) + 1) * 7));
      if (citationScore > 0) {
        score += citationScore;
        reasons.push(`${record.citationCount} citations`);
      }
    }
    if (Number.isFinite(record.score)) {
      const sourceScore = Math.min(8, Math.floor(Number(record.score) / 10));
      if (sourceScore > 0) {
        score += sourceScore;
        reasons.push("source relevance score");
      }
    }
    const networkCount = Array.isArray(record.networkOrigins) ? record.networkOrigins.length : 0;
    if (networkCount > 0) {
      score += Math.min(8, networkCount * 4);
      reasons.push("citation-network relation");
    }
    if (Number(record.year) >= 2023) {
      score += 8;
      reasons.push("recent publication");
    } else if (Number(record.year) >= 2020) {
      score += 5;
    } else if (Number(record.year) >= 2015) {
      score += 2;
    }
    if (quality.dedupeStatus === "uncertain") {
      score -= 18;
      reasons.push("possible duplicate");
    }
    if (quality.isAbstractOnly) {
      score -= 18;
      reasons.push("abstract-only source");
    }
    if (!quality.hasFullPaperSignal) score -= 8;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const tier = score >= 70 ? "high" : score >= 42 ? "medium" : "low";
    const recommendedDecision = tier === "high" ? "include" : tier === "medium" ? "to_read" : "user_pending";
    return { score, tier, recommendedDecision, reasons: reasons.length ? reasons : [quality.reason || "needs manual review"] };
  }

  function sortCandidateRecords(records) {
    return [...(records || [])].map(withCandidatePriority).sort(candidateRecordCompare);
  }

  function candidateRecordCompare(left, right) {
    const groupDelta = candidateSortGroup(left) - candidateSortGroup(right);
    if (groupDelta) return groupDelta;
    const scoreDelta = (right.priority?.score || 0) - (left.priority?.score || 0);
    if (scoreDelta) return scoreDelta;
    const yearDelta = Number(right.year || 0) - Number(left.year || 0);
    if (yearDelta) return yearDelta;
    return String(left.title || left.candidateId).localeCompare(String(right.title || right.candidateId));
  }

  function candidateSortGroup(record) {
    if (record.quality?.dedupeStatus === "duplicate" || record.priority?.tier === "duplicate") return 5;
    if (record.decision === "include") return 0;
    if (record.decision === "to_read") return 1;
    if (record.decision === "exclude") return 4;
    if (record.quality?.dedupeStatus === "uncertain") return 3;
    return 2;
  }

  function normalizeCitationDirections(directions) {
    const valid = (directions || []).filter((direction) => direction === "references" || direction === "citations");
    return valid.length ? [...new Set(valid)] : ["references", "citations"];
  }

  function normalizeCitationSeeds(seeds) {
    const byKey = new Map();
    for (const seed of seeds || []) {
      const normalized = {
        ...seed,
        semanticScholarId: semanticScholarSeedId(seed),
        title: cleanText(seed?.title) || undefined
      };
      if (!normalized.semanticScholarId) continue;
      const key = citationSeedKey(normalized);
      if (!byKey.has(key)) byKey.set(key, normalized);
    }
    return [...byKey.values()];
  }

  function nextCitationFrontier(papers, seenSeedKeys, limit) {
    const deduped = dedupeCandidatePapers(papers)
      .map((paper) => ({ paper, record: withCandidatePriority(candidateRecordFromPaper(paper, { existing: [] })) }))
      .sort((left, right) => candidateRecordCompare(left.record, right.record));
    const out = [];
    for (const { paper } of deduped) {
      const seed = citationSeedFromPaper(paper);
      const key = citationSeedKey(seed);
      if (!key || seenSeedKeys.has(key)) continue;
      seenSeedKeys.add(key);
      out.push(seed);
      if (out.length >= limit) break;
    }
    return out;
  }

  function citationSeedFromPaper(paper) {
    return {
      semanticScholarId: cleanText(paper?.sourceIds?.semantic_scholar) || undefined,
      doi: paper?.doi,
      arxivId: paper?.arxivId,
      url: paper?.url,
      candidateId: paper?.id,
      title: paper?.title
    };
  }

  function citationSeedKey(seed) {
    return semanticScholarSeedId(seed).toLowerCase();
  }

  function citationRequestKey(request) {
    return [
      request.source || "",
      request.seedId || "",
      request.networkDirection || "",
      request.url || ""
    ].join("|").toLowerCase();
  }

  function semanticScholarSeedId(seed) {
    const semanticScholarId = cleanText(seed?.semanticScholarId);
    if (semanticScholarId) return semanticScholarId;
    const doi = normalizeDoi(seed?.doi || candidateIdValue(seed?.candidateId, "doi"));
    if (doi) return `DOI:${doi}`;
    const arxivId = normalizeArxivId(seed?.arxivId || candidateIdValue(seed?.candidateId, "arxiv"));
    if (arxivId) return `ARXIV:${arxivId}`;
    const url = cleanText(seed?.url);
    if (/^(https?:\/\/)?(www\.)?(semanticscholar|arxiv|doi)\./i.test(url) || /^https?:\/\/doi\.org\//i.test(url)) return url;
    const candidateId = cleanText(seed?.candidateId);
    if (candidateId && !candidateId.startsWith("title:")) return candidateId;
    return "";
  }

  function candidateIdValue(candidateId, prefix) {
    const text = cleanText(candidateId);
    return text.toLowerCase().startsWith(`${prefix}:`) ? text.slice(prefix.length + 1) : "";
  }

  function xmlValue(xml, tag) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(xml || "").match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
    return decodeXml(match?.[1] || "");
  }

  function linkHref(entry, rel) {
    const links = Array.from(String(entry || "").matchAll(/<link\b[^>]*>/g)).map((match) => match[0]);
    const link = links.find((value) => new RegExp(`\\brel=["']${rel}["']`).test(value));
    return decodeXml(attributeValue(link || "", "href"));
  }

  function linkHrefByTitle(entry, title) {
    const links = Array.from(String(entry || "").matchAll(/<link\b[^>]*>/g)).map((match) => match[0]);
    const link = links.find((value) => new RegExp(`\\btitle=["']${title}["']`, "i").test(value));
    return decodeXml(attributeValue(link || "", "href"));
  }

  function attributeValue(tag, name) {
    const match = String(tag || "").match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
    return match?.[1] || "";
  }

  function arxivIdFromUrl(value) {
    return normalizeArxivId(String(value || "").match(/arxiv\.org\/abs\/([^/?#]+)/i)?.[1]);
  }

  function normalizeArxivId(value) {
    return cleanText(value).replace(/^arxiv:/i, "").toLowerCase();
  }

  function normalizeDoi(value) {
    return cleanText(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
  }

  function normalizeTitle(value) {
    return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function cleanText(value) {
    return decodeXml(String(value ?? "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function decodeXml(value) {
    return String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'");
  }

  function stripMarkup(value) {
    return cleanText(value) || undefined;
  }

  function authorNames(value) {
    return Array.isArray(value) ? value.map((item) => cleanText(item?.name || item)).filter(Boolean) : [];
  }

  function crossrefAuthorNames(value) {
    if (!Array.isArray(value)) return [];
    return value.map((author) => [author.given, author.family].map(cleanText).filter(Boolean).join(" ")).filter(Boolean);
  }

  function crossrefYear(item) {
    return yearFromDateParts(item?.["published-print"]) || yearFromDateParts(item?.["published-online"]) || yearFromDateParts(item?.issued);
  }

  function yearFromDateParts(value) {
    return numberOrUndefined(value?.["date-parts"]?.[0]?.[0]);
  }

  function yearFromDate(value) {
    return numberOrUndefined(String(value || "").match(/^(\d{4})/)?.[1]);
  }

  function numberOrUndefined(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function first(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function longer(left, right) {
    if (!left) return right;
    if (!right) return left;
    return right.length > left.length ? right : left;
  }

  function maxNumber(left, right) {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.max(left, right);
  }

  function titleTokenOverlap(left, right) {
    const leftTokens = new Set(String(left || "").split(/\s+/).filter((token) => token.length >= 3));
    const rightTokens = new Set(String(right || "").split(/\s+/).filter((token) => token.length >= 3));
    if (!leftTokens.size || !rightTokens.size) return 0;
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return shared / Math.max(leftTokens.size, rightTokens.size);
  }

  function safeError(err) {
    return String(err?.message || err || "Unknown error").slice(0, 800);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  return {
    buildCandidateSearchRequests,
    buildCitationNetworkRequests,
    normalizeCitationSeeds,
    nextCitationFrontier,
    searchCandidateSources,
    expandCandidateCitationNetwork,
    parseArxivAtom,
    parseSemanticScholarResponse,
    parseSemanticScholarCitationNetworkResponse,
    semanticScholarCitationNetworkUrl,
    parseCrossrefWorksResponse,
    parseUnpaywallSearchResponse,
    dedupeCandidatePapers,
    candidateRecordFromPaper,
    mergeCandidateRecords,
    sortCandidateRecords
  };
})();

if (typeof window !== "undefined") {
  window.ZMSCandidateSources = ZMSCandidateSources;
}
