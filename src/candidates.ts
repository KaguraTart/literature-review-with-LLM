export type CandidateSource = "arxiv" | "semantic_scholar" | "crossref" | "unpaywall";
export type CitationNetworkDirection = "references" | "citations";

export interface CitationNetworkOrigin {
  direction: CitationNetworkDirection;
  seedId: string;
  seedTitle?: string;
}

export interface CandidatePaper {
  id: string;
  source: CandidateSource;
  sources: CandidateSource[];
  sourceIds: Partial<Record<CandidateSource, string>>;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  venue?: string;
  abstract?: string;
  url?: string;
  pdfUrl?: string;
  isOpenAccess?: boolean;
  citationCount?: number;
  score?: number;
  networkOrigins?: CitationNetworkOrigin[];
}

export interface CandidateSearchRequest {
  source: CandidateSource;
  method: "GET";
  url: string;
  headers?: Record<string, string>;
  networkDirection?: CitationNetworkDirection;
  seedId?: string;
  seedTitle?: string;
}

export interface CandidateSearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  year?: string;
  email?: string;
  openAccessOnly?: boolean;
  semanticScholarApiKey?: string;
}

export interface CandidateNetworkSeed {
  candidateId?: string;
  title?: string;
  doi?: string;
  arxivId?: string;
  semanticScholarId?: string;
  url?: string;
}

export interface CandidateNetworkOptions {
  seeds: CandidateNetworkSeed[];
  limit?: number;
  perSeedLimit?: number;
  directions?: CitationNetworkDirection[];
  semanticScholarApiKey?: string;
}

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

export function buildCandidateSearchRequests(options: CandidateSearchOptions): CandidateSearchRequest[] {
  const query = options.query.trim();
  if (!query) return [];
  const requests: CandidateSearchRequest[] = [
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

export function buildCitationNetworkRequests(options: CandidateNetworkOptions): CandidateSearchRequest[] {
  const directions = normalizeCitationDirections(options.directions);
  const perSeedLimit = clamp(options.perSeedLimit ?? options.limit ?? 8, 1, 100);
  const seeds = (options.seeds || []).map((seed) => ({
    raw: seed,
    semanticScholarId: semanticScholarSeedId(seed)
  })).filter((seed): seed is { raw: CandidateNetworkSeed; semanticScholarId: string } => !!seed.semanticScholarId);
  const requests: CandidateSearchRequest[] = [];
  for (const seed of seeds) {
    for (const direction of directions) {
      requests.push({
        source: "semantic_scholar",
        method: "GET",
        url: semanticScholarCitationNetworkUrl(seed.semanticScholarId, direction, perSeedLimit),
        headers: options.semanticScholarApiKey ? { "x-api-key": options.semanticScholarApiKey } : undefined,
        networkDirection: direction,
        seedId: seed.semanticScholarId,
        seedTitle: cleanText(seed.raw.title) || undefined
      });
    }
  }
  return requests;
}

export function arxivSearchUrl(options: CandidateSearchOptions): string {
  const params = new URLSearchParams({
    search_query: `all:${options.query.trim()}`,
    start: String(Math.max(0, options.offset ?? 0)),
    max_results: String(clamp(options.limit ?? 20, 1, 100)),
    sortBy: "relevance",
    sortOrder: "descending"
  });
  return `http://export.arxiv.org/api/query?${params.toString()}`;
}

export function semanticScholarSearchUrl(options: CandidateSearchOptions): string {
  const params = new URLSearchParams({
    query: options.query.trim(),
    limit: String(clamp(options.limit ?? 20, 1, 100)),
    fields: SEMANTIC_SCHOLAR_FIELDS
  });
  if (options.offset) params.set("offset", String(Math.max(0, options.offset)));
  if (options.year) params.set("year", options.year);
  if (options.openAccessOnly) params.set("openAccessPdf", "true");
  return `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;
}

export function semanticScholarCitationNetworkUrl(
  paperId: string,
  direction: CitationNetworkDirection,
  limit = 8,
  offset = 0
): string {
  const fieldPrefix = direction === "references" ? "citedPaper" : "citingPaper";
  const params = new URLSearchParams({
    limit: String(clamp(limit, 1, 100)),
    offset: String(Math.max(0, offset)),
    fields: SEMANTIC_SCHOLAR_NETWORK_PAPER_FIELDS.map((field) => `${fieldPrefix}.${field}`).join(",")
  });
  return `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/${direction}?${params.toString()}`;
}

export function crossrefSearchUrl(options: CandidateSearchOptions): string {
  const params = new URLSearchParams({
    "query.bibliographic": options.query.trim(),
    rows: String(clamp(options.limit ?? 20, 1, 100)),
    offset: String(Math.max(0, options.offset ?? 0)),
    select: CROSSREF_SELECT_FIELDS
  });
  if (options.email) params.set("mailto", options.email);
  return `https://api.crossref.org/works?${params.toString()}`;
}

export function unpaywallTitleSearchUrl(options: CandidateSearchOptions): string {
  if (!options.email) throw new Error("Unpaywall search requires an email address");
  const params = new URLSearchParams({
    query: options.query.trim(),
    email: options.email
  });
  if (options.openAccessOnly) params.set("is_oa", "true");
  if (options.offset) params.set("page", String(Math.floor(Math.max(0, options.offset) / 50) + 1));
  return `https://api.unpaywall.org/v2/search/?${params.toString()}`;
}

export function unpaywallDoiUrl(doi: string, email: string): string {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new Error("DOI is required");
  if (!email.trim()) throw new Error("Unpaywall DOI lookup requires an email address");
  const params = new URLSearchParams({ email: email.trim() });
  return `https://api.unpaywall.org/v2/${encodeURIComponent(normalized)}?${params.toString()}`;
}

export function parseArxivAtom(xml: string): CandidatePaper[] {
  const entries = Array.from(String(xml || "").matchAll(/<entry\b[\s\S]*?<\/entry>/g)).map((match) => match[0]);
  return entries
    .map((entry) => {
      const title = cleanText(xmlValue(entry, "title"));
      if (!title) return null;
      const idUrl = cleanText(xmlValue(entry, "id"));
      const arxivId = arxivIdFromUrl(idUrl);
      const doi = cleanText(xmlValue(entry, "arxiv:doi")) || undefined;
      const authors = Array.from(entry.matchAll(/<author\b[\s\S]*?<\/author>/g))
        .map((match) => cleanText(xmlValue(match[0], "name")))
        .filter(Boolean);
      const published = cleanText(xmlValue(entry, "published"));
      const alternateUrl = linkHref(entry, "alternate") || idUrl || undefined;
      const pdfUrl = linkHref(entry, "related") || linkHrefByTitle(entry, "pdf");
      return candidate({
        source: "arxiv",
        sourceId: arxivId || idUrl || title,
        title,
        authors,
        year: yearFromDate(published),
        doi,
        arxivId,
        url: alternateUrl,
        pdfUrl,
        abstract: cleanText(xmlValue(entry, "summary")) || undefined,
        isOpenAccess: !!pdfUrl || !!alternateUrl
      });
    })
    .filter((item): item is CandidatePaper => !!item);
}

export function parseSemanticScholarResponse(data: unknown): CandidatePaper[] {
  const records: any[] = Array.isArray((data as any)?.data) ? (data as any).data : [];
  return records
    .map((item: any): CandidatePaper | null => semanticScholarPaperFromItem(item))
    .filter((item): item is CandidatePaper => !!item);
}

export function parseSemanticScholarCitationNetworkResponse(
  data: unknown,
  direction: CitationNetworkDirection,
  seed: CandidateNetworkSeed
): CandidatePaper[] {
  const records: any[] = Array.isArray((data as any)?.data) ? (data as any).data : [];
  const paperKey = direction === "references" ? "citedPaper" : "citingPaper";
  const seedId = semanticScholarSeedId(seed) || cleanText(seed.candidateId) || cleanText(seed.doi) || cleanText(seed.arxivId);
  const seedTitle = cleanText(seed.title) || undefined;
  return records
    .map((item: any): CandidatePaper | null => {
      const paper = semanticScholarPaperFromItem(item?.[paperKey]);
      if (!paper || !seedId) return paper;
      return {
        ...paper,
        networkOrigins: mergeNetworkOrigins(paper.networkOrigins, [{ direction, seedId, seedTitle }])
      };
    })
    .filter((item): item is CandidatePaper => !!item);
}

export function parseCrossrefWorksResponse(data: unknown): CandidatePaper[] {
  const items: any[] = Array.isArray((data as any)?.message?.items) ? (data as any).message.items : [];
  return items
    .map((item: any): CandidatePaper | null => {
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
    })
    .filter((item): item is CandidatePaper => !!item);
}

export function parseUnpaywallSearchResponse(data: unknown): CandidatePaper[] {
  const results: any[] = Array.isArray((data as any)?.results) ? (data as any).results : [];
  return results
    .map((item: any): CandidatePaper | null => {
      const paper = parseUnpaywallDoiResponse(item?.response);
      if (!paper) return null;
      return { ...paper, score: numberOrUndefined(item?.score) ?? paper.score };
    })
    .filter((item): item is CandidatePaper => !!item);
}

export function parseUnpaywallDoiResponse(data: unknown): CandidatePaper | null {
  const item = data as any;
  const title = cleanText(item?.title);
  if (!title) return null;
  const doi = normalizeDoi(item?.doi);
  const bestLocation = item?.best_oa_location || {};
  const pdfUrl = cleanText(bestLocation.url_for_pdf || bestLocation.url);
  return candidate({
    source: "unpaywall",
    sourceId: doi || title,
    title,
    authors: unpaywallAuthorNames(item?.z_authors),
    year: numberOrUndefined(item?.year) || yearFromDate(item?.published_date),
    doi,
    venue: cleanText(item?.journal_name) || undefined,
    url: cleanText(item?.doi_url || bestLocation.url) || undefined,
    pdfUrl: pdfUrl || undefined,
    isOpenAccess: Boolean(item?.is_oa)
  });
}

export function dedupeCandidatePapers(papers: CandidatePaper[]): CandidatePaper[] {
  const byKey = new Map<string, CandidatePaper>();
  for (const paper of papers) {
    const key = candidateFingerprint(paper);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeCandidatePaper(existing, paper) : { ...paper });
  }
  return [...byKey.values()];
}

export function candidateFingerprint(paper: Pick<CandidatePaper, "title" | "doi" | "arxivId" | "year">): string {
  const doi = normalizeDoi(paper.doi);
  if (doi) return `doi:${doi}`;
  const arxivId = normalizeArxivId(paper.arxivId);
  if (arxivId) return `arxiv:${arxivId}`;
  const title = normalizeTitle(paper.title);
  return `title:${title}:${paper.year || ""}`;
}

function candidate(input: Omit<CandidatePaper, "id" | "sources" | "sourceIds"> & { sourceId: string }): CandidatePaper {
  const sourceIds = { [input.source]: input.sourceId };
  const paper = {
    ...input,
    doi: normalizeDoi(input.doi),
    arxivId: normalizeArxivId(input.arxivId),
    authors: input.authors.filter(Boolean),
    sources: [input.source],
    sourceIds
  };
  return {
    ...paper,
    id: candidateFingerprint(paper)
  };
}

function semanticScholarPaperFromItem(item: any): CandidatePaper | null {
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

function mergeCandidatePaper(left: CandidatePaper, right: CandidatePaper): CandidatePaper {
  const sources = [...new Set([...left.sources, ...right.sources])];
  const sourceIds = { ...left.sourceIds, ...right.sourceIds };
  const authors = left.authors.length >= right.authors.length ? left.authors : right.authors;
  return {
    ...left,
    sources,
    sourceIds,
    authors,
    doi: left.doi || right.doi,
    arxivId: left.arxivId || right.arxivId,
    venue: left.venue || right.venue,
    abstract: longer(left.abstract, right.abstract),
    url: left.url || right.url,
    pdfUrl: left.pdfUrl || right.pdfUrl,
    isOpenAccess: left.isOpenAccess || right.isOpenAccess,
    citationCount: maxNumber(left.citationCount, right.citationCount),
    score: maxNumber(left.score, right.score),
    networkOrigins: mergeNetworkOrigins(left.networkOrigins, right.networkOrigins),
    id: candidateFingerprint({ ...left, doi: left.doi || right.doi, arxivId: left.arxivId || right.arxivId })
  };
}

function mergeNetworkOrigins(left: CitationNetworkOrigin[] = [], right: CitationNetworkOrigin[] = []): CitationNetworkOrigin[] | undefined {
  const byKey = new Map<string, CitationNetworkOrigin>();
  for (const origin of [...left, ...right]) {
    if (!origin?.direction || !origin?.seedId) continue;
    const key = `${origin.direction}:${origin.seedId}`;
    byKey.set(key, {
      direction: origin.direction,
      seedId: origin.seedId,
      seedTitle: origin.seedTitle
    });
  }
  const origins = [...byKey.values()];
  return origins.length ? origins : undefined;
}

function normalizeCitationDirections(directions?: CitationNetworkDirection[]): CitationNetworkDirection[] {
  const valid = (directions || []).filter((direction): direction is CitationNetworkDirection => {
    return direction === "references" || direction === "citations";
  });
  return valid.length ? [...new Set(valid)] : ["references", "citations"];
}

function semanticScholarSeedId(seed: CandidateNetworkSeed): string {
  const semanticScholarId = cleanText(seed.semanticScholarId);
  if (semanticScholarId) return semanticScholarId;
  const doi = normalizeDoi(seed.doi || candidateIdValue(seed.candidateId, "doi"));
  if (doi) return `DOI:${doi}`;
  const arxivId = normalizeArxivId(seed.arxivId || candidateIdValue(seed.candidateId, "arxiv"));
  if (arxivId) return `ARXIV:${arxivId}`;
  const url = cleanText(seed.url);
  if (/^(https?:\/\/)?(www\.)?(semanticscholar|arxiv|doi)\./i.test(url) || /^https?:\/\/doi\.org\//i.test(url)) return url;
  const candidateId = cleanText(seed.candidateId);
  if (candidateId && !candidateId.startsWith("title:")) return candidateId;
  return "";
}

function candidateIdValue(candidateId: unknown, prefix: "doi" | "arxiv"): string {
  const text = cleanText(candidateId);
  return text.toLowerCase().startsWith(`${prefix}:`) ? text.slice(prefix.length + 1) : "";
}

function xmlValue(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
  return decodeXml(match?.[1] || "");
}

function linkHref(entry: string, rel: string): string {
  const links = Array.from(entry.matchAll(/<link\b[^>]*>/g)).map((match) => match[0]);
  const link = links.find((value) => new RegExp(`\\brel=["']${rel}["']`).test(value));
  return decodeXml(attributeValue(link || "", "href"));
}

function linkHrefByTitle(entry: string, title: string): string {
  const links = Array.from(entry.matchAll(/<link\b[^>]*>/g)).map((match) => match[0]);
  const link = links.find((value) => new RegExp(`\\btitle=["']${title}["']`, "i").test(value));
  return decodeXml(attributeValue(link || "", "href"));
}

function attributeValue(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] || "";
}

function arxivIdFromUrl(value: string): string | undefined {
  const match = String(value || "").match(/arxiv\.org\/abs\/([^/?#]+)/i);
  return normalizeArxivId(match?.[1]);
}

function normalizeArxivId(value: unknown): string | undefined {
  const text = cleanText(value).replace(/^arxiv:/i, "");
  return text || undefined;
}

function normalizeDoi(value: unknown): string | undefined {
  const text = cleanText(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  return text || undefined;
}

function normalizeTitle(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function cleanText(value: unknown): string {
  return decodeXml(String(value ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value: string): string {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripMarkup(value: unknown): string | undefined {
  const text = cleanText(value);
  return text || undefined;
}

function authorNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item: any) => cleanText(item?.name || item)).filter(Boolean) : [];
}

function crossrefAuthorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((author: any) => [author.given, author.family].map(cleanText).filter(Boolean).join(" ")).filter(Boolean);
}

function unpaywallAuthorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((author: any) => [author.given, author.family].map(cleanText).filter(Boolean).join(" ")).filter(Boolean);
}

function crossrefYear(item: any): number | undefined {
  return yearFromDateParts(item?.["published-print"])
    || yearFromDateParts(item?.["published-online"])
    || yearFromDateParts(item?.issued);
}

function yearFromDateParts(value: any): number | undefined {
  const year = value?.["date-parts"]?.[0]?.[0];
  return numberOrUndefined(year);
}

function yearFromDate(value: unknown): number | undefined {
  const match = String(value || "").match(/^(\d{4})/);
  return numberOrUndefined(match?.[1]);
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function longer(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function maxNumber(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
