import { candidateFingerprint, type CandidatePaper, type CandidateSource } from "./candidates.js";

export type CandidateSourceType = "doi" | "arxiv" | "publisher" | "direct_pdf" | "proceedings" | "abstract_page" | "webpage";
export type CandidateDedupeStatus = "new" | "duplicate" | "uncertain";
export type CandidateDecision = "include" | "exclude" | "to_read" | "user_pending";
export type ImportLedgerAction =
  | "discovered"
  | "confirmed"
  | "excluded"
  | "to_read"
  | "imported"
  | "skipped_duplicate"
  | "attached_pdf"
  | "missing_pdf"
  | "failed";

export interface ExistingPaperIdentity {
  itemKey?: string;
  title?: string;
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
}

export interface ImportCandidateQuality {
  hasFullPaperSignal: boolean;
  hasPdfSignal: boolean;
  isAbstractOnly: boolean;
  dedupeStatus: CandidateDedupeStatus;
  reason: string;
  matchedItemKey?: string;
  matchedCandidateId?: string;
}

export interface ImportCandidateRecord {
  candidateId: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  sourceUrl: string;
  pdfUrl?: string;
  sourceType: CandidateSourceType;
  sources: CandidateSource[];
  sourceIds: Partial<Record<CandidateSource, string>>;
  ids: {
    doi?: string;
    arxivId?: string;
    semanticScholarId?: string;
    unpaywallDoi?: string;
  };
  quality: ImportCandidateQuality;
  decision: CandidateDecision;
  query?: string;
  collectionKey?: string;
  discoveredAt: string;
  updatedAt: string;
  isOpenAccess?: boolean;
  citationCount?: number;
  score?: number;
  importStatus?: "imported" | "skipped_duplicate" | "failed";
  zoteroItemID?: number;
  zoteroItemKey?: string;
  importError?: string;
  importedAt?: string;
  pdfAttachmentStatus?: "attached_pdf" | "missing_pdf" | "failed";
  pdfAttachmentKey?: string;
  pdfAttachmentError?: string;
  pdfAttachedAt?: string;
}

export interface CandidateRecordOptions {
  query?: string;
  collectionKey?: string;
  now?: string;
  decision?: CandidateDecision;
  existing?: ExistingPaperIdentity[];
}

export interface ImportLedgerEntry {
  id: string;
  candidateId: string;
  action: ImportLedgerAction;
  at: string;
  title: string;
  collectionKey?: string;
  zoteroItemID?: number;
  zoteroItemKey?: string;
  attachmentKey?: string;
  doi?: string;
  arxivId?: string;
  sourceUrl?: string;
  decision?: CandidateDecision;
  dedupeStatus?: CandidateDedupeStatus;
  message?: string;
  error?: string;
}

export interface ImportLedgerEntryOptions {
  action: ImportLedgerAction;
  at?: string;
  zoteroItemID?: number;
  zoteroItemKey?: string;
  attachmentKey?: string;
  message?: string;
  error?: string;
}

export interface ImportableCandidateOptions {
  includeToRead?: boolean;
  allowAbstractOnly?: boolean;
  allowUncertainDuplicates?: boolean;
}

export function candidateRecordFromPaper(paper: CandidatePaper, options: CandidateRecordOptions = {}): ImportCandidateRecord {
  const now = options.now || new Date().toISOString();
  const sourceType = candidateSourceType(paper);
  const quality = candidateQuality(paper, sourceType, options.existing || []);
  return {
    candidateId: paper.id || candidateFingerprint(paper),
    title: paper.title,
    authors: [...paper.authors],
    year: paper.year,
    venue: paper.venue,
    abstract: paper.abstract,
    sourceUrl: paper.url || paper.pdfUrl || "",
    pdfUrl: paper.pdfUrl,
    sourceType,
    sources: [...paper.sources],
    sourceIds: { ...paper.sourceIds },
    ids: {
      doi: paper.doi,
      arxivId: paper.arxivId,
      semanticScholarId: paper.sourceIds.semantic_scholar,
      unpaywallDoi: paper.sources.includes("unpaywall") ? paper.doi : undefined
    },
    quality,
    decision: options.decision || "user_pending",
    query: options.query,
    collectionKey: options.collectionKey,
    discoveredAt: now,
    updatedAt: now,
    isOpenAccess: paper.isOpenAccess,
    citationCount: paper.citationCount,
    score: paper.score
  };
}

export function candidateRecordsFromPapers(papers: CandidatePaper[], options: CandidateRecordOptions = {}): ImportCandidateRecord[] {
  return papers.map((paper) => candidateRecordFromPaper(paper, options));
}

export function candidateSourceType(paper: Pick<CandidatePaper, "doi" | "arxivId" | "url" | "pdfUrl" | "isOpenAccess">): CandidateSourceType {
  const url = String(paper.url || paper.pdfUrl || "").toLowerCase();
  if (paper.pdfUrl || /\.pdf(?:[?#].*)?$/.test(url)) return "direct_pdf";
  if (paper.arxivId || /arxiv\.org\/(abs|pdf)\//.test(url)) return "arxiv";
  if (paper.doi || /doi\.org\//.test(url)) return "doi";
  if (/proceedings|conference|conf|symposium|workshop/.test(url)) return "proceedings";
  if (/abstract|\/abs\/|\/record\/|\/paper\/summary/.test(url)) return "abstract_page";
  if (paper.isOpenAccess) return "publisher";
  return "webpage";
}

export function candidateQuality(
  paper: Pick<CandidatePaper, "id" | "title" | "year" | "doi" | "arxivId" | "url" | "pdfUrl" | "isOpenAccess">,
  sourceType = candidateSourceType(paper),
  existing: ExistingPaperIdentity[] = []
): ImportCandidateQuality {
  const duplicate = candidateMatchesExistingPaper(paper, existing);
  const hasPdfSignal = Boolean(paper.pdfUrl || /\.pdf(?:[?#].*)?$/i.test(String(paper.url || "")));
  const hasIdentifier = Boolean(normalizeDoi(paper.doi) || normalizeArxivId(paper.arxivId));
  const hasFullPaperSignal = hasPdfSignal || hasIdentifier || Boolean(paper.isOpenAccess && sourceType !== "abstract_page");
  const isAbstractOnly = !hasPdfSignal && !hasIdentifier && (sourceType === "abstract_page" || sourceType === "webpage");
  if (duplicate.status === "duplicate") {
    return {
      hasFullPaperSignal,
      hasPdfSignal,
      isAbstractOnly,
      dedupeStatus: "duplicate",
      matchedItemKey: duplicate.itemKey,
      reason: duplicate.itemKey ? `matched existing Zotero item ${duplicate.itemKey}` : "matched existing paper identity"
    };
  }
  if (duplicate.status === "uncertain") {
    return {
      hasFullPaperSignal,
      hasPdfSignal,
      isAbstractOnly,
      dedupeStatus: "uncertain",
      matchedItemKey: duplicate.itemKey,
      reason: duplicate.itemKey ? `similar to existing Zotero item ${duplicate.itemKey}` : "similar title to an existing paper"
    };
  }
  return {
    hasFullPaperSignal,
    hasPdfSignal,
    isAbstractOnly,
    dedupeStatus: "new",
    reason: qualityReason({ hasPdfSignal, hasIdentifier, isAbstractOnly, isOpenAccess: Boolean(paper.isOpenAccess), sourceType })
  };
}

export function candidateMatchesExistingPaper(
  paper: Pick<CandidatePaper, "title" | "year" | "doi" | "arxivId">,
  existing: ExistingPaperIdentity[] = []
): { status: CandidateDedupeStatus; itemKey?: string } {
  const doi = normalizeDoi(paper.doi);
  const arxivId = normalizeArxivId(paper.arxivId);
  const title = normalizeTitle(paper.title);
  for (const item of existing) {
    if (doi && normalizeDoi(item.doi) === doi) return { status: "duplicate", itemKey: item.itemKey };
    if (arxivId && normalizeArxivId(item.arxivId) === arxivId) return { status: "duplicate", itemKey: item.itemKey };
    const itemTitle = normalizeTitle(item.title);
    if (title && itemTitle && paper.year && item.year === paper.year && title === itemTitle) {
      return { status: "duplicate", itemKey: item.itemKey };
    }
  }
  for (const item of existing) {
    const overlap = titleTokenOverlap(title, normalizeTitle(item.title));
    if (overlap >= 0.7) return { status: "uncertain", itemKey: item.itemKey };
  }
  return { status: "new" };
}

export function filterImportableCandidates(
  records: ImportCandidateRecord[],
  options: ImportableCandidateOptions = {}
): ImportCandidateRecord[] {
  return records.filter((record) => {
    if (record.decision === "exclude") return false;
    if (record.decision === "to_read" && !options.includeToRead) return false;
    if (record.decision === "user_pending") return false;
    if (record.quality.dedupeStatus === "duplicate") return false;
    if (record.quality.dedupeStatus === "uncertain" && !options.allowUncertainDuplicates) return false;
    if (record.quality.isAbstractOnly && !options.allowAbstractOnly) return false;
    return true;
  });
}

export function importLedgerEntry(record: ImportCandidateRecord, options: ImportLedgerEntryOptions): ImportLedgerEntry {
  const at = options.at || new Date().toISOString();
  return {
    id: `${record.candidateId}:${options.action}:${at}`,
    candidateId: record.candidateId,
    action: options.action,
    at,
    title: record.title,
    collectionKey: record.collectionKey,
    zoteroItemID: options.zoteroItemID,
    zoteroItemKey: options.zoteroItemKey,
    attachmentKey: options.attachmentKey,
    doi: record.ids.doi,
    arxivId: record.ids.arxivId,
    sourceUrl: record.sourceUrl,
    decision: record.decision,
    dedupeStatus: record.quality.dedupeStatus,
    message: options.message,
    error: options.error
  };
}

export function mergeCandidateRecords(
  existing: ImportCandidateRecord[],
  incoming: ImportCandidateRecord[]
): ImportCandidateRecord[] {
  const byId = new Map<string, ImportCandidateRecord>();
  for (const record of existing) byId.set(record.candidateId, cloneCandidateRecord(record));
  for (const record of incoming) {
    const previous = byId.get(record.candidateId);
    if (!previous) {
      byId.set(record.candidateId, cloneCandidateRecord(record));
      continue;
    }
    byId.set(record.candidateId, {
      ...previous,
      ...record,
      discoveredAt: previous.discoveredAt,
      decision: previous.decision === "user_pending" ? record.decision : previous.decision,
      sources: [...new Set([...previous.sources, ...record.sources])],
      sourceIds: { ...previous.sourceIds, ...record.sourceIds },
      ids: { ...previous.ids, ...record.ids },
      quality: record.quality,
      updatedAt: record.updatedAt
    });
  }
  return [...byId.values()];
}

export function renderJsonl(records: unknown[]): string {
  if (!records.length) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function parseCandidateJsonl(text: string): ImportCandidateRecord[] {
  return parseJsonl(text, isImportCandidateRecord);
}

export function parseImportLedgerJsonl(text: string): ImportLedgerEntry[] {
  return parseJsonl(text, isImportLedgerEntry);
}

export function parseJsonl<T>(text: string, isRecord: (value: unknown) => value is T): T[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseJsonLine(line, index + 1))
    .filter(isRecord);
}

function parseJsonLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new Error(`Invalid JSONL at line ${lineNumber}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isImportCandidateRecord(value: unknown): value is ImportCandidateRecord {
  const item = value as ImportCandidateRecord;
  return !!item
    && typeof item.candidateId === "string"
    && typeof item.title === "string"
    && Array.isArray(item.sources)
    && !!item.quality
    && typeof item.quality.dedupeStatus === "string";
}

function isImportLedgerEntry(value: unknown): value is ImportLedgerEntry {
  const item = value as ImportLedgerEntry;
  return !!item
    && typeof item.id === "string"
    && typeof item.candidateId === "string"
    && typeof item.action === "string"
    && typeof item.at === "string";
}

function qualityReason(input: {
  hasPdfSignal: boolean;
  hasIdentifier: boolean;
  isAbstractOnly: boolean;
  isOpenAccess: boolean;
  sourceType: CandidateSourceType;
}): string {
  if (input.hasPdfSignal) return "direct PDF or PDF URL available";
  if (input.hasIdentifier) return "stable DOI or arXiv identifier available";
  if (input.isOpenAccess) return "open access location available";
  if (input.isAbstractOnly) return "abstract or weak webpage source only";
  return `${input.sourceType} source needs manual review`;
}

function cloneCandidateRecord(record: ImportCandidateRecord): ImportCandidateRecord {
  return {
    ...record,
    authors: [...record.authors],
    sources: [...record.sources],
    sourceIds: { ...record.sourceIds },
    ids: { ...record.ids },
    quality: { ...record.quality }
  };
}

function normalizeDoi(value: unknown): string {
  return cleanText(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function normalizeArxivId(value: unknown): string {
  return cleanText(value).replace(/^arxiv:/i, "").toLowerCase();
}

function normalizeTitle(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(/\s+/).filter((token) => token.length >= 3));
  const rightTokens = new Set(right.split(/\s+/).filter((token) => token.length >= 3));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}
