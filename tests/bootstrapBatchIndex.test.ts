import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadBootstrapHelpers(files = new Map<string, string>()) {
  const writes = new Map<string, string>();
  const directories: string[] = [];
  const linkedAttachments: any[] = [];
  const fetchCalls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
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
    fetch: async (url: string, init: any) => {
      fetchCalls.push({
        url,
        body: JSON.parse(init.body),
        headers: init.headers
      });
      const payload = {
        choices: [
          {
            message: {
              content: "## 综合框架\n- 相关方向放入一个大框架。\n\n## 独立方向\n- 完全不相关的论文分开讨论。"
            }
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      };
      return {
        ok: true,
        status: 200,
        headers: {},
        json: async () => payload,
        text: async () => JSON.stringify(payload)
      };
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
    fetchCalls,
    helpers: context as {
      batchStats: (results: any[]) => any;
      writeBatchPapersIndex: (settings: any, collectionContext: any, results: any[]) => Promise<string>;
      writeCollectionWorkspace: (settings: any, collectionContext: any, results: any[], options?: any) => Promise<any>;
      writeBatchRunReport: (settings: any, collectionContext: any, results: any[], options?: any) => Promise<string>;
      batchRunReportPayload: (settings: any, collectionContext: any, results: any[], options?: any) => any;
      crossCollectionIndexPath: (settings: any) => string;
      crossCollectionSynthesisPath: (settings: any, outputLanguage: string) => string;
      renderMarkdown: (item: any, pdf: any, settings: any, result: any) => string;
      linkOrUpdateAttachment: (item: any, outputPath: string, existing?: any) => Promise<any>;
      linkCollectionWorkspaceMarkdownArtifacts: (collectionContext: any, artifacts: any) => Promise<any[]>;
      currentListRegularItems: (collection?: any) => Promise<any[]>;
    }
  };
}

describe("batch papers index", () => {
  it("prefers explicit collection children when building a collection batch", async () => {
    const { helpers } = loadBootstrapHelpers();
    const collectionItem = { id: 1, key: "COLITEM", isRegularItem: () => true };
    const ignoredNote = { id: 2, key: "NOTE", isRegularItem: () => false };

    await expect(helpers.currentListRegularItems({
      async getChildItems() {
        return [collectionItem, ignoredNote];
      }
    })).resolves.toEqual([collectionItem]);
  });

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
      synthesisClaimsPath: "/out/collections/COL/knowledge/synthesis-claims.zh-CN.md",
      synthesisConflictsPath: "/out/collections/COL/knowledge/synthesis-conflicts.zh-CN.md",
      synthesisRoadmapPath: "/out/collections/COL/knowledge/synthesis-roadmap.zh-CN.md",
      researchQuestionCardsPath: "/out/collections/COL/knowledge/research-question-cards.zh-CN.md",
      reviewDraftPath: "/out/collections/COL/writing/manual-review-draft.zh-CN.md",
      reviewReportPath: "/out/collections/COL/writing/formal-review-report.zh-CN.md",
      modelReviewPath: "/out/collections/COL/writing/model-literature-review.zh-CN.md",
      ideaListPath: "/out/collections/COL/writing/idea-list.zh-CN.md",
      crossCollectionIndexPath: "/out/collections/index.json",
      crossCollectionSynthesisPath: "/out/collections/cross-collection-synthesis.zh-CN.md"
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
    expect(writes.get(artifacts.synthesisClaimsPath)).toContain("综合主张矩阵");
    expect(writes.get(artifacts.synthesisClaimsPath)).toContain("主张风险检查清单");
    expect(writes.get(artifacts.synthesisConflictsPath)).toContain("综合冲突与缺口台账");
    expect(JSON.parse(writes.get(artifacts.crossCollectionIndexPath) || "{}")).toMatchObject({
      templateVersion: "cross-collection-index-v1",
      stats: { collections: 1, totalPapers: 2, availableSummaries: 1 },
      collections: [
        expect.objectContaining({
          key: "COL",
          name: "Collection",
          artifacts: expect.objectContaining({
            reviewReportPath: "/out/collections/COL/writing/formal-review-report.zh-CN.md"
          })
        })
      ]
    });
    expect(writes.get(artifacts.crossCollectionSynthesisPath)).toContain("跨集合综合地图");
    expect(writes.get(artifacts.crossCollectionSynthesisPath)).toContain("Collection");
    expect(writes.get(artifacts.crossCollectionSynthesisPath)).toContain("主题归并复核板");
    expect(writes.get(artifacts.crossCollectionSynthesisPath)).toContain("跨集合缺口看板");
    expect(writes.get(artifacts.crossCollectionSynthesisPath)).toContain("跨集合综述写作包");
    expect(writes.get(artifacts.synthesisConflictsPath)).toContain("支持强度");
    expect(writes.get(artifacts.synthesisConflictsPath)).toContain("冲突审查清单");
    expect(writes.get(artifacts.synthesisRoadmapPath)).toContain("综合路线图");
    expect(writes.get(artifacts.synthesisRoadmapPath)).toContain("跨主题证据地图");
    expect(writes.get(artifacts.synthesisRoadmapPath)).toContain("候选检索词");
    expect(writes.get(artifacts.researchQuestionCardsPath)).toContain("研究问题卡");
    expect(writes.get(artifacts.researchQuestionCardsPath)).toContain("最小下一步动作");
    expect(writes.get(artifacts.reviewDraftPath)).toContain("手动综述草稿");
    expect(writes.get(artifacts.reviewDraftPath)).toContain("已生成 1 篇");
    expect(writes.get(artifacts.reviewReportPath)).toContain("正式综述报告草稿");
    expect(writes.get(artifacts.reviewReportPath)).toContain("论文清单与证据地图");
    expect(writes.get(artifacts.reviewReportPath)).toContain("有证据支持的综合主张");
    expect(writes.get(artifacts.reviewReportPath)).toContain("综合冲突与证据缺口");
    expect(writes.get(artifacts.reviewReportPath)).toContain("综合写作包");
    expect(writes.get(artifacts.reviewReportPath)).toContain("写作任务");
    expect(writes.get(artifacts.reviewReportPath)).toContain("模型深化提示");
    expect(writes.get(artifacts.reviewReportPath)).toContain("风险核查清单");
    expect(writes.get(artifacts.ideaListPath)).toContain("研究想法列表");
    expect(writes.get(artifacts.ideaListPath)).toContain("推翻条件");
    expect(writes.has(artifacts.modelReviewPath)).toBe(false);
  });

  it("writes an optional model-generated collection literature review from paper summaries", async () => {
    const { writes, fetchCalls, helpers } = loadBootstrapHelpers();
    const results = [
      {
        status: "generated",
        itemKey: "A",
        title: "Safe UAV Routing",
        year: "2026",
        pdfKey: "PA",
        summaryPath: "/out/a.md",
        summaryText: [
          "# Safe UAV Routing",
          "## 方法",
          "- Uses graph reinforcement learning.",
          "## 局限",
          "- Lacks field validation."
        ].join("\n")
      },
      {
        status: "generated",
        itemKey: "B",
        title: "Crowdsourced Traffic Data",
        year: "2025",
        pdfKey: "PB",
        summaryPath: "/out/b.md",
        summaryText: [
          "# Crowdsourced Traffic Data",
          "## 方法",
          "- Builds a sensor-data pipeline.",
          "## 缺失证据",
          "- Lacks controlled comparison."
        ].join("\n")
      }
    ];

    const artifacts = await helpers.writeCollectionWorkspace(
      {
        outputLanguage: "zh-CN",
        summaryVersion: "1",
        outputDir: "/out",
        provider: "openai",
        protocol: "openai_chat",
        baseURL: "https://api.example.test/v1",
        apiKey: "test-key",
        model: "model-a",
        temperature: 0.2,
        maxOutputTokens: 4096,
        stream: false,
        customHeaders: {},
        bodyExtra: {},
        capabilities: {}
      },
      { key: "COL", name: "Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/COL" },
      results,
      { modelReview: true }
    );

    expect(writes.get(artifacts.modelReviewPath)).toContain("summaryType: literature-review-synthesis");
    expect(writes.get(artifacts.modelReviewPath)).toContain("模型生成的分类文献综述");
    expect(writes.get(artifacts.modelReviewPath)).toContain("相关方向放入一个大框架");
    expect(fetchCalls).toHaveLength(1);
    expect(JSON.stringify(fetchCalls[0].body)).toContain("小方向不一样但问题相近");
    expect(JSON.stringify(fetchCalls[0].body)).toContain("完全不相关的论文");
    expect(JSON.stringify(fetchCalls[0].body)).toContain("Safe UAV Routing");
  });

  it("links key collection Markdown artifacts back to the selected collection when possible", async () => {
    const { linkedAttachments, helpers } = loadBootstrapHelpers();
    const collection = {
      id: 10,
      libraryID: 7,
      async getChildItems() {
        return [];
      }
    };
    const artifacts = await helpers.writeCollectionWorkspace(
      { outputLanguage: "zh-CN", summaryVersion: "1", outputDir: "/out" },
      { id: 10, key: "COL", name: "Collection", type: "collection", parentLibraryID: 7, libraryID: 7, collection, outputDir: "/out/collections/COL" },
      [
        { status: "generated", itemKey: "A", title: "A Paper", year: "2026", summaryPath: "/out/a.md" }
      ]
    );

    const linked = await helpers.linkCollectionWorkspaceMarkdownArtifacts(
      { id: 10, key: "COL", name: "Collection", parentLibraryID: 7, libraryID: 7, collection },
      artifacts
    );

    expect(linked.length).toBeGreaterThan(0);
    expect(linkedAttachments.map((item) => item.title)).toContain("Literature Review with LLM - Collection - formal-review-report.zh-CN.md");
    expect(linkedAttachments.every((item) => item.libraryID === 7)).toBe(true);
    expect(linkedAttachments.every((item) => item.contentType === "text/markdown")).toBe(true);
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
    expect(writes.get(artifacts.synthesisClaimsPath)).toContain("PPO-based CTDE scheduler");
    expect(writes.get(artifacts.synthesisClaimsPath)).toContain("Only tested in grid simulation");
    expect(writes.get(artifacts.synthesisClaimsPath)).toContain("Stress-test under mixed priority flights");
    expect(writes.get(artifacts.synthesisConflictsPath)).toContain("单篇证据支持");
    expect(writes.get(artifacts.synthesisConflictsPath)).toContain("Only tested in grid simulation");
    expect(writes.get(artifacts.synthesisConflictsPath)).toContain("Stress-test under mixed priority flights");
    expect(writes.get(artifacts.synthesisRoadmapPath)).toContain("PPO-based CTDE scheduler");
    expect(writes.get(artifacts.synthesisRoadmapPath)).toContain("No field data or ablation");
    expect(writes.get(artifacts.synthesisRoadmapPath)).toContain("Stress-test under mixed priority flights");
    expect(writes.get(artifacts.reviewReportPath)).toContain("PPO-based CTDE scheduler");
    expect(writes.get(artifacts.reviewReportPath)).toContain("Conflict rate and delay minutes");
    expect(writes.get(artifacts.reviewReportPath)).toContain("No field data or ablation");
    expect(writes.get(artifacts.reviewReportPath)).toContain("综合冲突与证据缺口");
    expect(writes.get(artifacts.reviewReportPath)).toContain("Stress-test under mixed priority flights");
    expect(writes.get(artifacts.reviewReportPath)).toContain("综合写作包");
    expect(writes.get(artifacts.reviewReportPath)).toContain("基于已引用的总结深化");
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

  it("upserts collection entries into the cross-collection synthesis index", async () => {
    const existingIndex = {
      templateVersion: "cross-collection-index-v1",
      generatedAt: "2026-06-19T00:00:00.000Z",
      outputLanguage: "en-US",
      stats: { collections: 1, totalPapers: 2, availableSummaries: 2, skippedNoPdf: 0, failed: 0 },
      collections: [
        {
          key: "OLD",
          name: "Old Collection",
          type: "collection",
          outputLanguage: "en-US",
          stats: { total: 2, generated: 2, skippedExisting: 0, skippedNoPdf: 0, failed: 0 },
          artifacts: { reviewReportPath: "/out/collections/OLD/writing/formal-review-report.en-US.md" },
          clusters: [
            {
              label: "Safety / Risk",
              paperCount: 2,
              methodSignals: ["Bayesian risk model"],
              gapSignals: ["No deployment evidence"]
            },
            {
              label: "Transportation / Urban Airspace",
              paperCount: 1,
              methodSignals: ["Bayesian route planner"],
              gapSignals: ["No field deployment"]
            }
          ],
          openGaps: ["No deployment evidence"],
          candidateQueries: ["Safety / Risk Bayesian risk model No deployment evidence"]
        }
      ]
    };
    const files = new Map<string, string>([
      ["/out/collections/index.json", JSON.stringify(existingIndex, null, 2)],
      ["/out/new.md", [
        "# Urban airspace conflict resolution",
        "",
        "## Method",
        "",
        "- PPO-based CTDE scheduler with safety constraints.",
        "",
        "## Limitation",
        "",
        "- No deployment evidence."
      ].join("\n")]
    ]);
    const { writes, helpers } = loadBootstrapHelpers(files);

    const artifacts = await helpers.writeCollectionWorkspace(
      { outputLanguage: "en-US", summaryVersion: "1", outputDir: "/out" },
      { key: "NEW", name: "New Collection", type: "collection", parentLibraryID: 1, outputDir: "/out/collections/NEW" },
      [{ status: "generated", itemKey: "N", title: "Urban airspace conflict resolution", year: "2026", summaryPath: "/out/new.md" }]
    );

    const payload = JSON.parse(writes.get(artifacts.crossCollectionIndexPath) || "{}");
    expect(payload.stats).toMatchObject({ collections: 2, totalPapers: 3, availableSummaries: 3 });
    expect(payload.collections.map((collection: any) => collection.key)).toEqual(["NEW", "OLD"]);
    expect(payload.collections.find((collection: any) => collection.key === "OLD").clusters[0].label).toBe("Safety / Risk");
    expect(payload.collections.find((collection: any) => collection.key === "NEW").artifacts.reviewReportPath)
      .toBe("/out/collections/NEW/writing/formal-review-report.en-US.md");
    expect(payload.gapBoard).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gap: "No deployment evidence",
        collectionCount: 2,
        collections: expect.arrayContaining(["Old Collection", "New Collection"]),
        candidateQueries: expect.arrayContaining(["Safety / Risk Bayesian risk model No deployment evidence"])
      })
    ]));
    expect(payload.themeBridgeBoard).toEqual(expect.arrayContaining([
      expect.objectContaining({
        theme: "Transportation / Urban Airspace",
        collectionCount: 2,
        collections: expect.arrayContaining(["Old Collection", "New Collection"]),
        methodSignals: expect.arrayContaining(["Bayesian route planner", "PPO-based CTDE scheduler with safety constraints."]),
        gapSignals: expect.arrayContaining(["No field deployment", "No deployment evidence."])
      })
    ]));
    expect(payload.themeMergeBoard).toEqual(expect.arrayContaining([
      expect.objectContaining({
        collections: expect.arrayContaining(["Old Collection", "New Collection"]),
        themeCandidates: expect.arrayContaining(["Safety / Risk", "Transportation / Urban Airspace"]),
        sharedSignals: expect.arrayContaining(["No deployment evidence."])
      })
    ]));
    expect(payload.priorityBoard).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "recurring_gap",
        priority: "Recurring gap: No deployment evidence",
        reason: "Gap repeats across 2 collections",
        collections: expect.arrayContaining(["Old Collection", "New Collection"])
      })
    ]));
    const synthesis = writes.get(artifacts.crossCollectionSynthesisPath) || "";
    expect(synthesis).toContain("Cross-Collection Synthesis Map");
    expect(synthesis).toContain("Theme Merge Review Board");
    expect(synthesis).toContain("Cross-Collection Bridge Board");
    expect(synthesis).toContain("Cross-Collection Gap Board");
    expect(synthesis).toContain("Cross-Collection Priority Board");
    expect(synthesis).toContain("Cross-Collection Review Pack");
    expect(synthesis).toContain("Model Deepening Prompt");
    expect(synthesis).toContain("Review possible theme merge");
    expect(synthesis).toContain("How should Transportation / Urban Airspace connect evidence across 2 collections");
    expect(synthesis).toContain("Recurring gap: No deployment evidence");
    expect(synthesis).toContain("Old Collection");
    expect(synthesis).toContain("New Collection");
    expect(synthesis).toContain("Urban Airspace");
    expect(synthesis).toContain("Prioritize candidate search; this gap recurs in 2 collections");
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
    expect(writes.get(english.synthesisClaimsPath)).toContain("Synthesis Claims Matrix");
    expect(writes.get(english.synthesisConflictsPath)).toContain("Synthesis Conflict Ledger");
    expect(writes.get(english.synthesisConflictsPath)).toContain("Support Level");
    expect(writes.get(english.synthesisRoadmapPath)).toContain("Synthesis Roadmap");
    expect(writes.get(english.synthesisRoadmapPath)).toContain("Cross-theme Evidence Map");
    expect(writes.get(english.crossCollectionSynthesisPath)).toContain("Theme Merge Review Board");
    expect(writes.get(english.crossCollectionSynthesisPath)).toContain("Cross-Collection Bridge Board");
    expect(writes.get(english.crossCollectionSynthesisPath)).toContain("Cross-Collection Priority Board");
    expect(writes.get(english.crossCollectionSynthesisPath)).toContain("Cross-Collection Review Pack");
    expect(writes.get(english.reviewReportPath)).toContain("Formal Review Report");
    expect(writes.get(english.reviewReportPath)).toContain("Evidence-backed Synthesis Claims");
    expect(writes.get(english.reviewReportPath)).toContain("Synthesis Conflicts and Evidence Gaps");
    expect(writes.get(english.reviewReportPath)).toContain("Synthesis Writing Pack");
    expect(writes.get(english.reviewReportPath)).toContain("Risk Checklist");
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
    expect(writes.get(japanese.synthesisClaimsPath)).toContain("統合主張マトリクス");
    expect(writes.get(japanese.synthesisConflictsPath)).toContain("統合コンフリクト台帳");
    expect(writes.get(japanese.synthesisConflictsPath)).toContain("支持レベル");
    expect(writes.get(japanese.synthesisRoadmapPath)).toContain("統合ロードマップ");
    expect(writes.get(japanese.synthesisRoadmapPath)).toContain("テーマ横断エビデンスマップ");
    expect(writes.get(japanese.crossCollectionSynthesisPath)).toContain("テーマ統合確認ボード");
    expect(writes.get(japanese.crossCollectionSynthesisPath)).toContain("Collection 横断ブリッジボード");
    expect(writes.get(japanese.crossCollectionSynthesisPath)).toContain("Collection 横断優先度ボード");
    expect(writes.get(japanese.crossCollectionSynthesisPath)).toContain("Collection 横断レビュー執筆パック");
    expect(writes.get(japanese.reviewReportPath)).toContain("正式レビュー報告書");
    expect(writes.get(japanese.reviewReportPath)).toContain("証拠に基づく統合主張");
    expect(writes.get(japanese.reviewReportPath)).toContain("統合コンフリクトと証拠ギャップ");
    expect(writes.get(japanese.reviewReportPath)).toContain("統合執筆パック");
    expect(writes.get(japanese.reviewReportPath)).toContain("リスク確認リスト");
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
    expect(english.synthesisClaimsPath).toBe("/out/collections/COL/knowledge/synthesis-claims.en-US.md");
    expect(japanese.synthesisClaimsPath).toBe("/out/collections/COL/knowledge/synthesis-claims.ja-JP.md");
    expect(english.synthesisConflictsPath).toBe("/out/collections/COL/knowledge/synthesis-conflicts.en-US.md");
    expect(japanese.synthesisConflictsPath).toBe("/out/collections/COL/knowledge/synthesis-conflicts.ja-JP.md");
    expect(english.synthesisRoadmapPath).toBe("/out/collections/COL/knowledge/synthesis-roadmap.en-US.md");
    expect(japanese.synthesisRoadmapPath).toBe("/out/collections/COL/knowledge/synthesis-roadmap.ja-JP.md");
    expect(english.reviewDraftPath).not.toBe(japanese.reviewDraftPath);
    expect(english.reviewReportPath).toBe("/out/collections/COL/writing/formal-review-report.en-US.md");
    expect(japanese.reviewReportPath).toBe("/out/collections/COL/writing/formal-review-report.ja-JP.md");
    expect(english.ideaListPath).not.toBe(japanese.ideaListPath);
    expect(writes.get(english.reviewDraftPath)).toContain("Manual Review Draft");
    expect(writes.get(japanese.reviewDraftPath)).toContain("手動レビュー草稿");
    expect(writes.get(english.reviewReportPath)).toContain("Formal Review Report");
    expect(writes.get(japanese.reviewReportPath)).toContain("正式レビュー報告書");
    expect(writes.get(english.synthesisRoadmapPath)).toContain("Synthesis Roadmap");
    expect(writes.get(japanese.synthesisRoadmapPath)).toContain("統合ロードマップ");
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
