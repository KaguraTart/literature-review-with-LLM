export interface MarkdownMeta {
  zoteroItemKey: string;
  pdfAttachmentKey: string;
  sourceHash: string;
  summaryVersion: string;
  provider: string;
  model: string;
  generatedAt: string;
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
    "---"
  ].join("\n");
}

export function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}
