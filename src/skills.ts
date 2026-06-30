import type { OutputLanguage } from "./locale.js";

export type SkillId = string;

export interface SkillDefinition {
  id: SkillId;
  titleMessageId: string;
  descriptionMessageId: string;
  version: string;
  inputScope: "current_paper" | "current_or_comparison_papers";
  evidencePolicy: "fulltext_or_abstract";
  templatePath: string;
  outputSchema: string;
}

export const defaultSkills: SkillDefinition[] = [
  {
    id: "paper-deep-summary",
    titleMessageId: "skill-paper-deep-summary-title",
    descriptionMessageId: "skill-paper-deep-summary-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/paper-deep-summary.md",
    outputSchema: "paper-summary-v1"
  },
  {
    id: "method-extractor",
    titleMessageId: "skill-method-extractor-title",
    descriptionMessageId: "skill-method-extractor-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/method-extractor.md",
    outputSchema: "method-extraction-v1"
  },
  {
    id: "experiment-table-builder",
    titleMessageId: "skill-experiment-table-builder-title",
    descriptionMessageId: "skill-experiment-table-builder-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/experiment-table-builder.md",
    outputSchema: "experiment-table-v1"
  },
  {
    id: "figure-table-extractor",
    titleMessageId: "skill-figure-table-extractor-title",
    descriptionMessageId: "skill-figure-table-extractor-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/figure-table-extractor.md",
    outputSchema: "figure-table-extraction-v1"
  },
  {
    id: "literature-matrix-builder",
    titleMessageId: "skill-literature-matrix-builder-title",
    descriptionMessageId: "skill-literature-matrix-builder-description",
    version: "1",
    inputScope: "current_or_comparison_papers",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/literature-matrix-builder.md",
    outputSchema: "literature-matrix-v1"
  },
  {
    id: "literature-review-synthesis",
    titleMessageId: "skill-literature-review-synthesis-title",
    descriptionMessageId: "skill-literature-review-synthesis-description",
    version: "1",
    inputScope: "current_or_comparison_papers",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/literature-review-synthesis.md",
    outputSchema: "literature-review-synthesis-v1"
  },
  {
    id: "collection-literature-review",
    titleMessageId: "skill-collection-literature-review-title",
    descriptionMessageId: "skill-collection-literature-review-description",
    version: "1",
    inputScope: "current_or_comparison_papers",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/collection-literature-review.md",
    outputSchema: "collection-literature-review-v1"
  },
  {
    id: "citation-audit",
    titleMessageId: "skill-citation-audit-title",
    descriptionMessageId: "skill-citation-audit-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/citation-audit.md",
    outputSchema: "citation-audit-v1"
  },
  {
    id: "custom-summary",
    titleMessageId: "skill-custom-summary-title",
    descriptionMessageId: "skill-custom-summary-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/custom-summary.md",
    outputSchema: "custom-summary-v1"
  },
  {
    id: "ask-gemini",
    titleMessageId: "skill-ask-gemini-title",
    descriptionMessageId: "skill-ask-gemini-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/ask-gemini.md",
    outputSchema: "ask-gemini-v1"
  },
  {
    id: "ask-claude",
    titleMessageId: "skill-ask-claude-title",
    descriptionMessageId: "skill-ask-claude-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/ask-claude.md",
    outputSchema: "ask-claude-v1"
  },
  {
    id: "ask-opencode",
    titleMessageId: "skill-ask-opencode-title",
    descriptionMessageId: "skill-ask-opencode-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/ask-opencode.md",
    outputSchema: "ask-opencode-v1"
  },
  {
    id: "ask-all-agents",
    titleMessageId: "skill-ask-all-agents-title",
    descriptionMessageId: "skill-ask-all-agents-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/ask-all-agents.md",
    outputSchema: "ask-all-agents-v1"
  },
  {
    id: "ask-gemini-claude",
    titleMessageId: "skill-ask-gemini-claude-title",
    descriptionMessageId: "skill-ask-gemini-claude-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/ask-gemini-claude.md",
    outputSchema: "ask-gemini-claude-v1"
  },
  {
    id: "check-local-agents",
    titleMessageId: "skill-check-local-agents-title",
    descriptionMessageId: "skill-check-local-agents-description",
    version: "1",
    inputScope: "current_paper",
    evidencePolicy: "fulltext_or_abstract",
    templatePath: "skills/check-local-agents.md",
    outputSchema: "check-local-agents-v1"
  }
];

export function builtInSkillTemplate(skillId: SkillId, outputLanguage: OutputLanguage): string {
  const languageInstruction = outputLanguage === "zh-CN"
    ? "请使用中文输出。"
    : outputLanguage === "ja-JP"
      ? "日本語で出力してください。"
      : "Write the output in English.";
  const common = [
    languageInstruction,
    "Use only the provided paper metadata and context excerpts.",
    "Mark every claim with an evidence note such as [metadata], [abstract], or [chunk:<id>].",
    "If evidence is missing, say that the conclusion is low-confidence instead of inventing details."
  ].join("\n");

  if (skillId === "method-extractor") {
    return `${common}\n\nExtract the method, model, algorithm flow, inputs, outputs, constraints, and reusable implementation details.`;
  }
  if (skillId === "experiment-table-builder") {
    return `${common}\n\nBuild a Markdown table for datasets, baselines, metrics, ablations, results, and limitations.`;
  }
  if (skillId === "figure-table-extractor") {
    return figureTableTemplate(common, outputLanguage);
  }
  if (skillId === "literature-matrix-builder") {
    return literatureMatrixTemplate(common, outputLanguage);
  }
  if (skillId === "literature-review-synthesis") {
    return literatureReviewSynthesisTemplate(common, outputLanguage);
  }
  if (skillId === "collection-literature-review") {
    return collectionLiteratureReviewTemplate(common, outputLanguage);
  }
  if (skillId === "citation-audit") {
    return `${common}\n\nAudit the current summary or answer. List unsupported claims, weak evidence, and what source is needed.`;
  }
  if (skillId === "custom-summary") {
    return `${common}\n\nFollow the user's custom research goal and produce a structured Markdown note.`;
  }
  if (skillId === "ask-gemini") {
    return `${common}\n\nSummarize what Gemini-style reasoning should focus on and provide a review note for the user prompt. Mention assumptions, risks, and missing evidence. Keep each paragraph concise.`;
  }
  if (skillId === "ask-claude") {
    return `${common}\n\nProvide a careful reviewer-style analysis for the paper context and user prompt, with clear strengths, weaknesses, and specific action recommendations.`;
  }
  if (skillId === "ask-opencode") {
    return `${common}\n\nProduce a practical implementation-oriented critique of methods and experiment choices, including code-level checklists, tooling suggestions, and reproducibility checks.`;
  }
  if (skillId === "ask-all-agents") {
    return `${common}\n\nCompare answers from multiple agents over the same paper context, highlight agreement, disagreement, and confidence, and produce a merged recommendation set.`;
  }
  if (skillId === "ask-gemini-claude") {
    return `${common}\n\nCompare Gemini and Claude perspectives over the same paper context, highlight agreement, disagreement, and confidence, and produce a merged recommendation set.`;
  }
  if (skillId === "check-local-agents") {
    return `${common}\n\nCheck whether local agent tooling is reachable, report reachable/unreachable components, and suggest concrete remediation steps.`;
  }
  return paperDeepSummaryTemplate(common, outputLanguage);
}

function figureTableTemplate(common: string, outputLanguage: OutputLanguage): string {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n请结构化解析论文中的截图、图表、表格或实验结果。优先结合图片附件、PDF/摘要上下文和用户问题；若没有图片附件，则只从文本上下文中抽取。输出 Markdown，至少包含：对象类型、可读内容、结论解释、可复用信息、不确定性。不要编造看不清的数字；所有来自文本上下文的判断标注 [chunk:<id>] 或 [metadata]，来自图片观察的判断标注 [image]。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n論文中のスクリーンショット、図、表、実験結果を構造化して解析してください。画像添付、PDF/要約コンテキスト、ユーザー質問を優先して使い、画像がない場合はテキスト根拠だけで抽出してください。読めない数値は推測せず、テキスト根拠は [chunk:<id>] または [metadata]、画像観察は [image] と明記してください。`;
  }
  return `${common}\n\nExtract structured information from screenshots, figures, tables, formulas, or experimental-result panels. Prefer attached images plus the provided paper/PDF context and the user question; if no image is attached, extract only from the text context. Include object type, readable content, interpretation, reusable review/experiment notes, and uncertainty. Do not invent unreadable numbers. Mark text-grounded claims with [chunk:<id>] or [metadata], and visual observations with [image].`;
}

function literatureMatrixTemplate(common: string, outputLanguage: OutputLanguage): string {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n生成 literature matrix。若上下文包含 Comparison paper，请同时比较焦点论文和所有对比论文；否则先为当前论文建立单篇矩阵。输出 Markdown，至少包含：论文清单、对比矩阵、交叉分析、综述草稿要点。每个矩阵单元必须引用 [chunk:<id>]、[paper2:<id>] 或 [metadata] 等证据；缺证据时写低置信度，不要补全不存在的信息。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\nliterature matrix を作成してください。Comparison paper がある場合は、焦点論文と比較論文を同時に比較してください。ない場合は、現在の論文だけで単一論文の行列を作成してください。各セルには [chunk:<id>]、[paper2:<id>]、または [metadata] のような根拠ラベルを付け、根拠が弱い場合は低信頼と明記してください。`;
  }
  return `${common}\n\nCreate a literature matrix. If the context contains Comparison papers, compare the focal paper against every comparison paper; otherwise build a single-paper matrix for the current paper first. Include a paper inventory, comparison matrix, cross-paper analysis, and review-draft notes. Every matrix cell must cite evidence labels such as [chunk:<id>], [paper2:<id>], or [metadata]. Mark unsupported cells as low-confidence instead of filling gaps.`;
}

function literatureReviewSynthesisTemplate(common: string, outputLanguage: OutputLanguage): string {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n请做跨论文综合综述。若上下文包含 Comparison paper，请围绕焦点论文和所有对比论文组织；若只有当前论文，先给出可扩展的综述框架，并明确缺少对比论文。不要按论文逐篇流水账总结；请使用 synthesis matrix 思维，把论文按主题、问题、方法族、应用场景、证据强度、分歧和研究空白组织。小方向不一样但问题相近的论文，应放入一个更大的分析框架下讨论；完全不相关的论文必须拆成独立分点或独立小节，不要强行合并。请梳理论文关系和研究脉络：哪些工作继承共同问题，哪些扩展方法或场景，哪些相互冲突，哪些只是提供背景。输出 Markdown，至少包含：综述主题边界、综合框架、论文分组与研究谱系、方法维度与证据矩阵、共识与关键分歧、批判性评论、研究空白、可直接放入文献综述的段落草稿、后续补充文献与验证清单。每个判断必须标注 [chunk:<id>]、[paper2:<id>] 或 [metadata]；证据不足时写低置信度。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n複数論文を横断したレビュー統合を作成してください。Comparison paper がある場合は焦点論文と比較論文をまとめて扱い、現在の論文だけの場合は拡張可能なレビュー枠組みを提示し、比較論文が不足していることを明記してください。論文を 1 本ずつ並べるのではなく、テーマ、問題、手法ファミリー、シナリオ、証拠強度、相違点、研究ギャップで統合してください。近いが小方向が異なる論文は大きな枠組みの下にまとめ、完全に無関係な論文は独立したレビュー節として分けてください。レビュー範囲、統合フレーム、研究系譜、方法軸とエビデンス行列、合意と相違、批判的コメント、研究ギャップ、本文用段落案、追加確認リストを含めてください。判断には [chunk:<id>]、[paper2:<id>]、または [metadata] を付け、根拠が弱い場合は低信頼と明記してください。`;
  }
  return `${common}\n\nCreate a cross-paper synthesis for a literature review. If Comparison papers are present, organize the focal paper and every comparison paper together; if only the current paper is available, produce an expandable review framework and state that comparison papers are missing. Do not summarize papers one by one. Use synthesis matrix thinking: group by theme, research problem, method family, scenario, evidence strength, disagreement, and research gap. Group related but smaller different directions under a larger framework; split completely unrelated papers into independent sections instead of forcing a merger. Explain the research lineage and relationships: what each group inherits, extends, challenges, or leaves unresolved. Include review scope, synthesis framework, paper groups and lineage, method dimensions and evidence matrix, consensus and key disagreements, critical review, research gaps, draft literature-review paragraphs, and follow-up literature/search checklist. Cite every judgment with [chunk:<id>], [paper2:<id>], or [metadata]. Mark weak evidence as low-confidence.`;
}

function collectionLiteratureReviewTemplate(common: string, outputLanguage: OutputLanguage): string {
  const extra = [
    "The input may contain a full Zotero collection, local paper summaries, deterministic matrices, and online search evidence.",
    "Treat online search evidence as external candidates and gap-checking context; do not treat external candidates as fully read collection papers unless the input provides their summaries.",
    "Separate in-collection evidence from external candidate evidence in the output."
  ].join("\n");
  if (outputLanguage === "zh-CN") {
    return `${common}\n${extra}\n\n请为整个 Zotero 分类写一份可直接保存为 Markdown 的 collection-level literature review。目标不是逐篇摘要，而是梳理分类内所有论文之间的问题脉络、方法谱系、证据强弱和研究空白。请把小方向不同但可归入同一大问题的论文放进更大的分析框架；完全不相关的论文必须分开成独立小节。若输入包含联网检索证据，请单独列出“外部候选文献与后续检索”，说明它们如何补充、校验或挑战分类内论文。固定章节：综述范围、分类内论文地图、综合框架、研究谱系、方法与场景对比、共识与分歧、批判性评论、研究空白、外部候选文献与后续检索、可写入正文的综述段落。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n${extra}\n\nZotero collection 全体を対象に、Markdown として保存できる collection-level literature review を作成してください。1 本ずつ要約するのではなく、問題系譜、方法ファミリー、証拠強度、研究ギャップを統合してください。小方向が異なっても大きな問題の下に整理できる論文は同じ枠組みに置き、完全に無関係な論文は独立節に分けてください。オンライン検索証拠がある場合は、外部候補と追加検索として別節にしてください。`;
  }
  return `${common}\n${extra}\n\nWrite a collection-level literature review for the whole Zotero collection as Markdown. Do not summarize papers one by one. Build a research map across problem lineage, method families, evidence strength, scenarios, disagreements, and research gaps. Group related smaller directions under a larger analytical framework; split completely unrelated papers into independent sections. If online search evidence is present, add a separate External Candidates and Follow-up Search section explaining how those candidates supplement, validate, or challenge the in-collection papers.`;
}

function paperDeepSummaryTemplate(common: string, outputLanguage: OutputLanguage): string {
  if (outputLanguage === "zh-CN") {
    return `${common}\n\n请生成单篇深度阅读报告，使用以下 Markdown 章节：基本信息、研究背景、研究问题、方法框架、实验与验证、主要发现、贡献、局限、后续想法。每节只写有证据支持的内容，缺证据处标注低置信度。`;
  }
  if (outputLanguage === "ja-JP") {
    return `${common}\n\n単一論文の詳細読解レポートを作成してください。Markdown の章立ては、基本情報、研究背景、研究課題、手法、実験と検証、主な知見、貢献、限界、次の検討事項にしてください。根拠のある内容だけを書き、根拠が弱い箇所は低信頼として明記してください。`;
  }
  return `${common}\n\nCreate a deep paper reading report with Markdown sections for basic information, background, research question, method, experiments and validation, findings, contributions, limitations, and follow-up ideas. Keep every section evidence-grounded and mark unsupported points as low-confidence.`;
}

export function pickSkillTemplate(localTemplate: string | undefined, skillId: SkillId, outputLanguage: OutputLanguage): string {
  const trimmed = localTemplate?.trim();
  return trimmed ? trimmed : builtInSkillTemplate(skillId, outputLanguage);
}

export function skillIdFromTemplatePath(path: string): string | undefined {
  const leaf = path.split(/[\\/]/).pop() || "";
  if (!leaf.endsWith(".md")) return undefined;
  const id = normalizeSkillId(leaf.slice(0, -3));
  return id || undefined;
}

export function availableSkillIds(localTemplatePaths: string[], builtIns = defaultSkills): string[] {
  const ids = new Set<string>(builtIns.map((skill) => skill.id));
  for (const path of localTemplatePaths) {
    const id = skillIdFromTemplatePath(path);
    if (id) ids.add(id);
  }
  return [...ids];
}

export function normalizeSkillId(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
