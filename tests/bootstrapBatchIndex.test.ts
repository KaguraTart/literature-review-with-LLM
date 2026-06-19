import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadBootstrapHelpers(files = new Map<string, string>()) {
  const writes = new Map<string, string>();
  const directories: string[] = [];
  const linkedAttachments: any[] = [];
  const providerCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-provider.js"), "utf8");
  const settingsCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-settings.js"), "utf8");
  const summaryStoreCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-summary-store.js"), "utf8");
  const zoteroItemCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-zotero-item.js"), "utf8");
  const uiCode = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-ui.js"), "utf8");
  const code = readFileSync(resolve(process.cwd(), "addon/bootstrap.js"), "utf8");
  const sandbox: any = {
    ZMS_I18N: {},
    Zotero: {
      File: {},
      Attachments: {
        linkFromFile: async (payload: any) => {
          linkedAttachments.push(payload);
          return payload;
        }
      },
      debug() {},
      Promise: {
        delay: () => Promise.resolve()
      }
    },
    Services: {
      wm: {
        getMostRecentWindow: () => null
      },
      ww: {},
      io: {}
    },
    Cc: {},
    Ci: {},
    PathUtils: {
      join: (...parts: string[]) => parts.filter(Boolean).join("/")
    },
    IOUtils: {
      exists: async (path: string) => files.has(path),
      makeDirectory: async (path: string) => {
        directories.push(path);
      },
      readUTF8: async (path: string) => files.get(path) || "",
      writeUTF8: async (path: string, text: string) => {
        writes.set(path, text);
        files.set(path, text);
      }
    },
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    console
  };
  const context = createContext(sandbox);
  runInContext(providerCode, context, { filename: "bootstrap-provider.js" });
  runInContext(settingsCode, context, { filename: "bootstrap-settings.js" });
  runInContext(summaryStoreCode, context, { filename: "bootstrap-summary-store.js" });
  runInContext(zoteroItemCode, context, { filename: "bootstrap-zotero-item.js" });
  runInContext(code, context, { filename: "bootstrap.js" });
  runInContext(uiCode, context, { filename: "bootstrap-ui.js" });
  return {
    writes,
    directories,
    linkedAttachments,
    helpers: context as {
      batchStats: (results: any[]) => any;
      writeBatchPapersIndex: (settings: any, collectionContext: any, results: any[]) => Promise<string>;
      writeCollectionWorkspace: (settings: any, collectionContext: any, results: any[]) => Promise<any>;
      writeBatchRunReport: (settings: any, collectionContext: any, results: any[], options?: any) => Promise<string>;
      batchRunReportPayload: (settings: any, collectionContext: any, results: any[], options?: any) => any;
      renderMarkdown: (item: any, pdf: any, settings: any, result: any) => string;
      linkOrUpdateAttachment: (item: any, outputPath: string, existing?: any) => Promise<any>;
    }
  };
}

describe("batch papers index", () => {
  it("repairs stale summary attachments instead of linking duplicates", async () => {
    const { linkedAttachments, helpers } = loadBootstrapHelpers();
    let saved = false;
    const existing = {
      attachmentPath: "",
      attachmentContentType: "",
      fields: { title: "old" } as Record<string, string>,
      setField(field: string, value: string) {
        this.fields[field] = value;
      },
      async saveTx() {
        saved = true;
      }
    };

    const result = await helpers.linkOrUpdateAttachment({ id: 42, key: "ITEM" }, "/out/ITEM.zh-CN.summary.md", existing);

    expect(result).toBe(existing);
    expect(saved).toBe(true);
    expect(existing.attachmentPath).toBe("/out/ITEM.zh-CN.summary.md");
    expect(existing.attachmentContentType).toBe("text/markdown");
    expect(existing.fields.title).toBe("Markdown 摘要 - ITEM.md");
    expect(linkedAttachments).toHaveLength(0);
  });

  it("falls back to a fresh summary attachment and restores fields when repair fails", async () => {
    const { linkedAttachments, helpers } = loadBootstrapHelpers();
    const existing = {
      attachmentPath: "/out/missing.md",
      attachmentContentType: "text/plain",
      fields: { title: "old" } as Record<string, string>,
      getField(field: string) {
        return this.fields[field] || "";
      },
      setField(field: string, value: string) {
        this.fields[field] = value;
      },
      async saveTx() {
        throw new Error("save failed");
      }
    };

    const result = await helpers.linkOrUpdateAttachment({ id: 42, key: "ITEM" }, "/out/ITEM.zh-CN.summary.md", existing);

    expect(result).toMatchObject({
      file: "/out/ITEM.zh-CN.summary.md",
      parentItemID: 42,
      contentType: "text/markdown",
      title: "Markdown 摘要 - ITEM.md"
    });
    expect(existing.attachmentPath).toBe("/out/missing.md");
    expect(existing.attachmentContentType).toBe("text/plain");
    expect(existing.fields.title).toBe("old");
    expect(linkedAttachments).toHaveLength(1);
  });

  it("summarizes batch statuses in papers.json", async () => {
    const { writes, helpers } = loadBootstrapHelpers();
    const results = [
      { status: "generated", itemKey: "A", title: "A", year: "2026", pdfKey: "PA", summaryPath: "/out/a.md", provider: "openai", model: "m" },
      { status: "skipped_no_pdf", itemKey: "B", title: "B", year: "2025" },
      { status: "skipped_existing", itemKey: "C", title: "C", year: "2024", pdfKey: "PC", summaryPath: "/out/c.md" },
      { status: "failed", itemKey: "D", title: "D", year: "2023", error: "boom" }
    ];

    expect(helpers.batchStats(results)).toEqual({
      total: 4,
      generated: 1,
      skippedNoPdf: 1,
      skippedExisting: 1,
      failed: 1
    });

    const indexPath = await helpers.writeBatchPapersIndex(
      { outputLanguage: "zh-CN", summaryVersion: "1", outputDir: "/out" },
      { key: "COL", name: "Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/COL" },
      results
    );
    expect(indexPath).toBe("/out/collections/COL/papers.json");
    const payload = JSON.parse(writes.get(indexPath) || "{}");
    expect(payload.stats).toEqual({
      total: 4,
      generated: 1,
      skippedNoPdf: 1,
      skippedExisting: 1,
      failed: 1
    });
    expect(payload.items).toHaveLength(4);
    expect(payload.items[3]).toMatchObject({ status: "failed", error: "boom" });
  });

  it("writes a per-run batch report for selected and collection batches", async () => {
    const { writes, helpers } = loadBootstrapHelpers();
    const results = [
      {
        status: "generated",
        itemKey: "A",
        title: "A",
        year: "2026",
        pdfKey: "PA",
        summaryPath: "/out/a.md",
        provider: "openai",
        model: "m",
        sourceHash: "hash-a",
        updatedAt: "2026-06-13T00:00:00.000Z"
      },
      {
        status: "failed",
        itemKey: "B",
        title: "B",
        year: "2025",
        error: "HTTP 429 - rate_limit_exceeded",
        updatedAt: "2026-06-13T00:00:01.000Z"
      }
    ];
    const settings = { outputLanguage: "en-US", summaryVersion: "2", outputDir: "/out" };
    const reportPath = await helpers.writeBatchRunReport(settings, null, results, {
      force: true,
      now: "2026-06-13T01:02:03.004Z"
    });

    expect(reportPath).toBe("/out/batch-runs/batch-2026-06-13T01-02-03-004Z.json");
    const payload = JSON.parse(writes.get(reportPath) || "{}");
    expect(payload).toMatchObject({
      generatedAt: "2026-06-13T01:02:03.004Z",
      force: true,
      collection: null,
      stats: { total: 2, generated: 1, failed: 1 }
    });
    expect(payload.items[0]).toMatchObject({
      status: "generated",
      itemKey: "A",
      summaryPath: "/out/a.md",
      sourceHash: "hash-a"
    });
    expect(payload.items[1]).toMatchObject({
      status: "failed",
      itemKey: "B",
      error: "HTTP 429 - rate_limit_exceeded"
    });
    expect(helpers.batchRunReportPayload(settings, { key: "COL", name: "Collection", type: "collection", parentLibraryID: 1 }, results, {
      generatedAt: "2026-06-13T01:02:03.004Z"
    }).collection).toMatchObject({ key: "COL", name: "Collection" });
  });

  it("writes collection workspace directories, method matrix, and review draft", async () => {
    const { writes, directories, helpers } = loadBootstrapHelpers();
    const results = [
      {
        status: "generated",
        itemKey: "A",
        title: "A | Paper",
        year: "2026",
        pdfKey: "PA",
        summaryPath: "/out/a.md",
        provider: "openai",
        model: "m",
        sourceHash: "hash-a"
      },
      { status: "skipped_no_pdf", itemKey: "B", title: "B", year: "2025" }
    ];
    const artifacts = await helpers.writeCollectionWorkspace(
      { outputLanguage: "zh-CN", summaryVersion: "1", outputDir: "/out" },
      { key: "COL", name: "Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/COL" },
      results
    );

    expect(artifacts).toMatchObject({
      papersIndexPath: "/out/collections/COL/papers.json",
      paperNotesIndexPath: "/out/collections/COL/paper-notes/index.zh-CN.md",
      methodMatrixPath: "/out/collections/COL/knowledge/method-matrix.zh-CN.md",
      gapMatrixPath: "/out/collections/COL/knowledge/research-gaps.zh-CN.md",
      topicClustersPath: "/out/collections/COL/knowledge/topic-clusters.zh-CN.md",
      researchQuestionCardsPath: "/out/collections/COL/knowledge/research-question-cards.zh-CN.md",
      reviewDraftPath: "/out/collections/COL/writing/manual-review-draft.zh-CN.md",
      ideaListPath: "/out/collections/COL/writing/idea-list.zh-CN.md"
    });
    expect(directories).toEqual(expect.arrayContaining([
      "/out/collections/COL",
      "/out/collections/COL/paper-notes",
      "/out/collections/COL/knowledge",
      "/out/collections/COL/writing"
    ]));
    expect(JSON.parse(writes.get(artifacts.papersIndexPath) || "{}").items).toHaveLength(2);
    expect(writes.get(artifacts.paperNotesIndexPath)).toContain("A \\| Paper");
    expect(writes.get(artifacts.methodMatrixPath)).toContain("方法矩阵");
    expect(writes.get(artifacts.gapMatrixPath)).toContain("研究空白矩阵");
    expect(writes.get(artifacts.gapMatrixPath)).toContain("缺失证据");
    expect(writes.get(artifacts.topicClustersPath)).toContain("主题聚类");
    expect(writes.get(artifacts.topicClustersPath)).toContain("综合线索");
    expect(writes.get(artifacts.researchQuestionCardsPath)).toContain("研究问题卡");
    expect(writes.get(artifacts.researchQuestionCardsPath)).toContain("最小下一步动作");
    expect(writes.get(artifacts.reviewDraftPath)).toContain("手动综述草稿");
    expect(writes.get(artifacts.reviewDraftPath)).toContain("已生成 1 篇");
    expect(writes.get(artifacts.ideaListPath)).toContain("研究想法列表");
    expect(writes.get(artifacts.ideaListPath)).toContain("推翻条件");
  });

  it("extracts research gaps and ideas from existing single-paper summaries", async () => {
    const files = new Map<string, string>([
      ["/out/a.md", [
        "---",
        "zoteroItemKey: A",
        "---",
        "",
        "# Paper A",
        "",
        "## 方法",
        "",
        "- PPO-based CTDE scheduler with a safety filter.",
        "",
        "## 实验与验证",
        "",
        "- Tested in a grid simulation with multi-seed conflict scenarios.",
        "",
        "## 评价指标",
        "",
        "- Conflict rate and delay minutes.",
        "",
        "## 发现",
        "",
        "- The safety filter reduced conflicts in simulation.",
        "",
        "## 局限",
        "",
        "- Only tested in grid simulation.",
        "",
        "## 缺失证据",
        "",
        "- No field data or ablation against rule-based baselines.",
        "",
        "## 下一步",
        "",
        "- Stress-test under mixed priority flights.",
        "- Validate on a multi-airport scenario.",
        "",
        "## 推翻条件",
        "",
        "- If mixed priority traffic erases the safety gain."
      ].join("\n")]
    ]);
    const { writes, helpers } = loadBootstrapHelpers(files);
    const results = [{
      status: "generated",
      itemKey: "A",
      title: "Paper A",
      year: "2026",
      summaryPath: "/out/a.md"
    }];

    const artifacts = await helpers.writeCollectionWorkspace(
      { outputLanguage: "zh-CN", summaryVersion: "1", outputDir: "/out" },
      { key: "COL", name: "Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/COL" },
      results
    );

    expect(writes.get(artifacts.methodMatrixPath)).toContain("PPO-based CTDE scheduler");
    expect(writes.get(artifacts.methodMatrixPath)).toContain("Conflict rate and delay minutes");
    expect(writes.get(artifacts.gapMatrixPath)).toContain("Only tested in grid simulation");
    expect(writes.get(artifacts.gapMatrixPath)).toContain("No field data or ablation");
    expect(writes.get(artifacts.gapMatrixPath)).toContain("Stress-test under mixed priority flights");
    expect(writes.get(artifacts.ideaListPath)).toContain("候选想法: Stress-test under mixed priority flights.");
    expect(writes.get(artifacts.ideaListPath)).toContain("现有证据: /out/a.md; The safety filter reduced conflicts in simulation.");
    expect(writes.get(artifacts.ideaListPath)).toContain("推翻条件: If mixed priority traffic erases the safety gain.");
  });

  it("builds heuristic collection topic clusters from summary insights", async () => {
    const files = new Map<string, string>([
      ["/out/a.md", [
        "# Urban airspace conflict resolution",
        "",
        "## 方法",
        "",
        "- PPO-based CTDE scheduler with a safety filter.",
        "",
        "## 实验与验证",
        "",
        "- Tested with mixed priority flights in an urban airspace simulation.",
        "",
        "## 局限",
        "",
        "- No field data from real flight operations."
      ].join("\n")],
      ["/out/b.md", [
        "# Transformer baseline selection",
        "",
        "## Method",
        "",
        "- Transformer attention baseline with ablation experiments.",
        "",
        "## Evaluation",
        "",
        "- Evaluated on public benchmark datasets.",
        "",
        "## Limitation",
        "",
        "- Compute cost is not reported."
      ].join("\n")]
    ]);
    const { writes, helpers } = loadBootstrapHelpers(files);
    const artifacts = await helpers.writeCollectionWorkspace(
      { outputLanguage: "zh-CN", summaryVersion: "1", outputDir: "/out" },
      { key: "COL", name: "Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/COL" },
      [
        { status: "generated", itemKey: "A", title: "Urban airspace conflict resolution", year: "2026", summaryPath: "/out/a.md" },
        { status: "generated", itemKey: "B", title: "Transformer baseline selection", year: "2025", summaryPath: "/out/b.md" }
      ]
    );
    const clusters = writes.get(artifacts.topicClustersPath) || "";
    expect(clusters).toContain("交通与城市空域");
    expect(clusters).toContain("AI 与模型方法");
    expect(clusters).toContain("Urban airspace conflict resolution");
    expect(clusters).toContain("Transformer baseline selection");
    expect(clusters).toContain("No field data from real flight operations");
    expect(clusters).toContain("Compute cost is not reported");
  });

  it("localizes collection review and research question templates", async () => {
    const { writes, helpers } = loadBootstrapHelpers();
    const results = [{ status: "generated", itemKey: "A", title: "Paper A", year: "2026", summaryPath: "/out/a.md" }];

    const english = await helpers.writeCollectionWorkspace(
      { outputLanguage: "en-US", summaryVersion: "1", outputDir: "/out" },
      { key: "EN", name: "English Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/EN" },
      results
    );
    expect(writes.get(english.reviewDraftPath)).toContain("Manual Review Draft");
    expect(writes.get(english.researchQuestionCardsPath)).toContain("Research Question Cards");
    expect(writes.get(english.researchQuestionCardsPath)).toContain("Minimum next action");
    expect(writes.get(english.gapMatrixPath)).toContain("Research Gap Matrix");
    expect(writes.get(english.topicClustersPath)).toContain("Topic Clusters");
    expect(writes.get(english.ideaListPath)).toContain("Reject condition");

    const japanese = await helpers.writeCollectionWorkspace(
      { outputLanguage: "ja-JP", summaryVersion: "1", outputDir: "/out" },
      { key: "JA", name: "日本語Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/JA" },
      results
    );
    expect(writes.get(japanese.reviewDraftPath)).toContain("手動レビュー草稿");
    expect(writes.get(japanese.researchQuestionCardsPath)).toContain("研究課題カード");
    expect(writes.get(japanese.researchQuestionCardsPath)).toContain("最小の次アクション");
    expect(writes.get(japanese.gapMatrixPath)).toContain("研究ギャップマトリクス");
    expect(writes.get(japanese.topicClustersPath)).toContain("トピッククラスタ");
    expect(writes.get(japanese.ideaListPath)).toContain("棄却条件");
  });

  it("keeps collection Markdown artifacts for different output languages side by side", async () => {
    const { writes, helpers } = loadBootstrapHelpers();
    const results = [{ status: "generated", itemKey: "A", title: "Paper A", year: "2026", summaryPath: "/out/a.md" }];
    const collectionContext = {
      key: "COL",
      name: "Shared Collection",
      type: "collection",
      parentLibraryID: 1,
      outputDir: "/out/collections/COL"
    };

    const english = await helpers.writeCollectionWorkspace(
      { outputLanguage: "en-US", summaryVersion: "1", outputDir: "/out" },
      collectionContext,
      results
    );
    const japanese = await helpers.writeCollectionWorkspace(
      { outputLanguage: "ja-JP", summaryVersion: "1", outputDir: "/out" },
      collectionContext,
      results
    );

    expect(english.methodMatrixPath).toBe("/out/collections/COL/knowledge/method-matrix.en-US.md");
    expect(japanese.methodMatrixPath).toBe("/out/collections/COL/knowledge/method-matrix.ja-JP.md");
    expect(english.gapMatrixPath).toBe("/out/collections/COL/knowledge/research-gaps.en-US.md");
    expect(japanese.gapMatrixPath).toBe("/out/collections/COL/knowledge/research-gaps.ja-JP.md");
    expect(english.topicClustersPath).toBe("/out/collections/COL/knowledge/topic-clusters.en-US.md");
    expect(japanese.topicClustersPath).toBe("/out/collections/COL/knowledge/topic-clusters.ja-JP.md");
    expect(english.reviewDraftPath).not.toBe(japanese.reviewDraftPath);
    expect(english.ideaListPath).not.toBe(japanese.ideaListPath);
    expect(writes.get(english.reviewDraftPath)).toContain("Manual Review Draft");
    expect(writes.get(japanese.reviewDraftPath)).toContain("手動レビュー草稿");
    expect(writes.get(english.ideaListPath)).toContain("Idea List");
    expect(writes.get(japanese.ideaListPath)).toContain("アイデアリスト");
    expect(writes.get(english.paperNotesIndexPath)).toContain("Paper Notes");
    expect(writes.get(japanese.paperNotesIndexPath)).toContain("論文ノート");
  });

  it("renders batch summary frontmatter with workflow metadata", () => {
    const { helpers } = loadBootstrapHelpers();
    const markdown = helpers.renderMarkdown(
      {
        key: "ITEM",
        getField: (field: string) => field === "title" ? "Paper Title" : ""
      },
      { key: "PDF" },
      {
        inputMode: "text",
        outputLanguage: "zh-CN",
        summaryVersion: "1"
      },
      {
        sourceHash: "hash",
        provider: "openai",
        model: "model-a",
        markdown: "Summary body."
      }
    );

    expect(markdown).toContain("inputMode: text");
    expect(markdown).toContain("summaryType: paper-deep-summary");
    expect(markdown).toContain("evidenceLevel: fulltext_or_indexed_text");
    expect(markdown).toContain("outputLanguage: zh-CN");
    expect(markdown).toContain("sourceLanguage: auto");
    expect(markdown).toContain("templateVersion: summary-v1");
  });
});
