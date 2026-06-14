export interface MarkdownMeta {
  zoteroItemKey: string;
  pdfAttachmentKey: string;
  sourceHash: string;
  summaryVersion: string;
  provider: string;
  model: string;
  generatedAt: string;
  inputMode?: string;
  summaryType?: string;
  evidenceLevel?: string;
  outputLanguage?: string;
  sourceLanguage?: string;
  templateVersion?: string;
  skillId?: string;
  skillVersion?: string;
  lastEditedAt?: string;
  lastEditSource?: string;
  chatSessionId?: string;
  editCount?: number;
}

export function renderFrontmatter(meta: MarkdownMeta): string {
  return [
    "---",
    `zoteroItemKey: ${meta.zoteroItemKey}`,
    `pdfAttachmentKey: ${meta.pdfAttachmentKey}`,
    `sourceHash: ${meta.sourceHash}`,
    `summaryVersion: ${meta.summaryVersion}`,
    `provider: ${meta.provider}`,
    `model: ${meta.model}`,
    `generatedAt: ${meta.generatedAt}`,
    ...optionalMetaLines(meta),
    "---"
  ].join("\n");
}

export function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

export type MarkdownEditAction = "replace_section" | "append_section" | "append_research_notes";

export interface MarkdownEditRequest {
  itemKey: string;
  summaryPath: string;
  chatSessionId: string;
  messageId: string;
  action: MarkdownEditAction;
  targetSection?: string;
  replacementText: string;
  skillId?: string;
  now: string;
}

export interface MarkdownEditPreview {
  before: string;
  after: string;
  diff: string;
  backupPath: string;
  tempPath: string;
  frontmatterPatch: Record<string, string | number>;
}

interface HeadingRange {
  start: number;
  contentStart: number;
  end: number;
  level: number;
  title: string;
}

function optionalMetaLines(meta: MarkdownMeta): string[] {
  const fields: Array<[string, unknown]> = [
    ["inputMode", meta.inputMode],
    ["summaryType", meta.summaryType],
    ["evidenceLevel", meta.evidenceLevel],
    ["outputLanguage", meta.outputLanguage],
    ["sourceLanguage", meta.sourceLanguage],
    ["templateVersion", meta.templateVersion],
    ["skillId", meta.skillId],
    ["skillVersion", meta.skillVersion],
    ["lastEditedAt", meta.lastEditedAt],
    ["lastEditSource", meta.lastEditSource],
    ["chatSessionId", meta.chatSessionId],
    ["editCount", meta.editCount]
  ];
  return fields
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${value}`);
}

export function applyMarkdownEdit(original: string, request: MarkdownEditRequest): MarkdownEditPreview {
  const frontmatterPatch = {
    lastEditedAt: request.now,
    lastEditSource: "chat",
    chatSessionId: request.chatSessionId,
    skillId: request.skillId || "",
    editCount: nextEditCount(original)
  };
  const withEditedBody = applyBodyEdit(original, request);
  const after = upsertFrontmatter(withEditedBody, frontmatterPatch);
  return {
    before: original,
    after,
    diff: simpleDiff(original, after),
    backupPath: backupPathFor(request.summaryPath, request.now),
    tempPath: tempPathFor(request.summaryPath, request.now),
    frontmatterPatch
  };
}

export function backupPathFor(summaryPath: string, timestamp: string): string {
  const normalized = timestamp.replace(/[:.]/g, "-");
  const slashIndex = Math.max(summaryPath.lastIndexOf("/"), summaryPath.lastIndexOf("\\"));
  const dir = slashIndex === -1 ? "." : summaryPath.slice(0, slashIndex);
  const file = slashIndex === -1 ? summaryPath : summaryPath.slice(slashIndex + 1);
  return `${dir}/.bak/${file}.${normalized}.md`;
}

export function tempPathFor(summaryPath: string, timestamp: string): string {
  const normalized = timestamp.replace(/[:.]/g, "-");
  const slashIndex = Math.max(summaryPath.lastIndexOf("/"), summaryPath.lastIndexOf("\\"));
  const dir = slashIndex === -1 ? "." : summaryPath.slice(0, slashIndex);
  const file = slashIndex === -1 ? summaryPath : summaryPath.slice(slashIndex + 1);
  return `${dir}/.${file}.${normalized}.tmp`;
}

export function upsertFrontmatter(markdown: string, patch: Record<string, string | number>): string {
  if (!markdown.startsWith("---\n")) {
    return `---\n${formatFrontmatterPatch(patch)}\n---\n\n${markdown}`;
  }
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return `---\n${formatFrontmatterPatch(patch)}\n---\n\n${markdown}`;
  const raw = markdown.slice(4, end).split("\n");
  const seen = new Set<string>();
  const updated = raw.map((line) => {
    const key = line.split(":")[0]?.trim();
    if (key && Object.prototype.hasOwnProperty.call(patch, key)) {
      seen.add(key);
      return `${key}: ${patch[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(patch)) {
    if (!seen.has(key) && value !== "") updated.push(`${key}: ${value}`);
  }
  return `---\n${updated.join("\n")}\n---${markdown.slice(end + 4)}`;
}

function applyBodyEdit(original: string, request: MarkdownEditRequest): string {
  if (request.action === "append_research_notes") {
    return appendToNamedSection(original, request.targetSection || "Research Notes", request.replacementText);
  }
  const target = request.targetSection?.trim();
  if (!target) throw new Error("Target section is required");
  const range = findHeadingRange(original, target);
  if (!range) {
    if (request.action === "append_section") return appendToNamedSection(original, target, request.replacementText);
    throw new Error(`Section not found: ${target}`);
  }
  if (request.action === "replace_section") {
    return `${original.slice(0, range.contentStart)}\n${request.replacementText.trim()}\n${original.slice(range.end)}`;
  }
  return `${original.slice(0, range.end).replace(/\s*$/, "")}\n\n${request.replacementText.trim()}\n${original.slice(range.end)}`;
}

function appendToNamedSection(original: string, title: string, text: string): string {
  const range = findHeadingRange(original, title);
  if (range) {
    return `${original.slice(0, range.end).replace(/\s*$/, "")}\n\n${text.trim()}\n${original.slice(range.end)}`;
  }
  const suffix = original.endsWith("\n") ? "" : "\n";
  return `${original}${suffix}\n## ${title}\n\n${text.trim()}\n`;
}

function findHeadingRange(markdown: string, title: string): HeadingRange | undefined {
  const headingPattern = /^(#{1,6})\s+(.+?)\s*$/gm;
  const normalizedTitle = normalizeHeading(title);
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(markdown))) {
    const level = match[1].length;
    const currentTitle = normalizeHeading(match[2]);
    if (currentTitle !== normalizedTitle) continue;
    const contentStart = headingPattern.lastIndex;
    const nextPattern = new RegExp(`^#{1,${level}}\\s+.+?\\s*$`, "gm");
    nextPattern.lastIndex = contentStart;
    const next = nextPattern.exec(markdown);
    return {
      start: match.index,
      contentStart,
      end: next?.index ?? markdown.length,
      level,
      title: match[2]
    };
  }
  return undefined;
}

function normalizeHeading(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function nextEditCount(markdown: string): number {
  const match = markdown.match(/^editCount:\s*(\d+)\s*$/m);
  return match ? Number(match[1]) + 1 : 1;
}

function formatFrontmatterPatch(patch: Record<string, string | number>): string {
  return Object.entries(patch)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function simpleDiff(before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix++;
  }
  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (beforeSuffix >= prefix && afterSuffix >= prefix && beforeLines[beforeSuffix] === afterLines[afterSuffix]) {
    beforeSuffix--;
    afterSuffix--;
  }
  const removed = beforeLines.slice(prefix, beforeSuffix + 1).map((line) => `- ${line}`);
  const added = afterLines.slice(prefix, afterSuffix + 1).map((line) => `+ ${line}`);
  return [...removed, ...added].join("\n");
}
