import type { OutputLanguage } from "./locale.js";

export type SkillId = string;

export interface SkillDefinition {
  id: SkillId;
  titleMessageId: string;
  descriptionMessageId: string;
  version: string;
  inputScope: "current_paper";
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
