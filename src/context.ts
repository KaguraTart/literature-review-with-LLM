export interface TextChunk {
  chunkId: string;
  sourceType: "metadata" | "abstract" | "fulltext" | "annotation" | "note" | "summary";
  locator: string;
  text: string;
  sourceHash: string;
}

export function chunkText(text: string, options: { sourceType: TextChunk["sourceType"]; maxChars?: number }): TextChunk[] {
  const maxChars = options.maxChars ?? 1800;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }
    for (let index = 0; index < paragraph.length; index += maxChars) {
      chunks.push(paragraph.slice(index, index + maxChars));
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => ({
    chunkId: stableChunkId(options.sourceType, chunk, index),
    sourceType: options.sourceType,
    locator: `${options.sourceType}:${index + 1}`,
    text: chunk,
    sourceHash: hashString(chunk)
  }));
}

export function selectRelevantChunks(chunks: TextChunk[], query: string, limit = 6): TextChunk[] {
  const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((term) => term.length >= 2);
  return [...chunks]
    .map((chunk, index) => ({ chunk, score: scoreChunk(chunk, terms), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.chunk);
}

function scoreChunk(chunk: TextChunk, terms: string[]): number {
  const lower = chunk.text.toLowerCase();
  const termScore = terms.reduce((score, term) => score + termFrequency(lower, term), 0);
  return termScore * 10 + sourceWeight(chunk.sourceType);
}

function termFrequency(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function sourceWeight(sourceType: TextChunk["sourceType"]): number {
  return {
    summary: 6,
    annotation: 5,
    note: 4,
    abstract: 3,
    metadata: 2,
    fulltext: 1
  }[sourceType] || 0;
}

function stableChunkId(sourceType: TextChunk["sourceType"], chunk: string, index: number): string {
  return `${sourceType}-${hashString(chunk).slice(0, 8)}-${String(index + 1).padStart(4, "0")}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
