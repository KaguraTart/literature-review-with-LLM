# Literature Review with LLM：Zotero 文献综述工作台实践方案

文档名称：literature-review-with-LLM.md  
形成时间：2026-05-28 22:20:00 CST  
参考输入：2026-05-28-llm-for-zotero-opencode-plugin-research.md、当前 Zotero Markdown Summary 插件代码  
外部复审状态：已尝试调用本机 Claude CLI 做架构复审，但当前会话额度受限，返回 `resets 12:30am (Asia/Shanghai)`；本文档先形成可执行版本，保留 Claude 复审清单。

## 1. 结论

当前项目已经具备一个可工作的 Zotero 9 插件基线：能注册设置页、读取选中文献 PDF 附件、从 Zotero 全文索引读取文本、调用兼容接口生成 Markdown，并把结果作为 linked attachment 挂回 Zotero 条目。

下一步不建议直接跳到“全自动文献综述系统”。更稳的路线是把现有单篇总结能力拆成可复用模块，再逐步扩展为 collection 级文献综述工作台：

1. 先把单篇总结做稳：缓存、证据定位、失败恢复、重复生成覆盖。
2. 再做 collection 级索引：每个集合独立缓存、独立检索、独立综合。
3. 最后做联网检索、多源去重、研究空白发现和写作草稿导出。

产品定位建议保持清晰：这是面向 Zotero 的文献发现、开放全文阅读、集合级知识库、证据矩阵和研究想法挖掘工具，不是单篇论文聊天窗口。

## 2. 当前代码基线

现有代码主要集中在 `addon/bootstrap.js`：

- 插件启动：等待 Zotero 初始化、解锁和 UI ready 后注册 chrome、设置页和菜单。
- 设置页：Provider、Base URL、API Key、Model、输出目录、输入模式、token、temperature、stream。
- 手动菜单：生成 Markdown 总结、更新 Markdown 总结、打开 Markdown 总结。
- PDF 输入：默认读取 Zotero `attachmentText`；非 MiniMax provider 可读 PDF 二进制并转 base64。
- 模型调用：兼容接口走 `/chat/completions`，原生 PDF 路径走 `/responses` 或 Anthropic Messages。
- 输出：写入 OneDrive 摘要目录，并作为 Zotero linked attachment 绑定到父条目。

当前基线适合继续扩展，但需要尽快拆分模块。`bootstrap.js` 已经同时承担 UI、Zotero 访问、PDF 输入、模型适配、文件写入、附件绑定、错误处理，后续如果直接叠加 collection、搜索和索引功能，会很快不可维护。

## 3. 目标形态

目标是做成“文献综述工作台”，围绕一个 Zotero collection 或本地专题完成如下闭环：

1. 收集论文：从 Zotero 已有集合开始，后续扩展联网检索。
2. 解析论文：读取元数据、摘要、全文文本、PDF、注释和已有 Markdown 总结。
3. 结构化总结：按固定模板产出单篇深度总结。
4. 集合知识库：按 collection 建本地索引和证据缓存。
5. 跨论文综合：生成方法矩阵、实验矩阵、研究空白矩阵、争议点和代表论文列表。
6. 研究想法生成：基于共同不足和用户课题约束给出可验证研究方向。
7. 安全写回：用户确认后再写 Zotero 标签、笔记、linked attachment 或导出文件。

## 4. 实施路线

### 阶段 0：重构当前单篇摘要插件

目标：不新增大功能，先把当前能力拆成稳定模块。

交付物：

- `SettingsManager`：统一读写 Zotero prefs，屏蔽 API key 日志输出。
- `ZoteroItemService`：负责选中条目、PDF 附件、linked attachment、打开文件。
- `PdfInputService`：负责 `text` 与 `pdf_base64` 输入。
- `ProviderClient`：负责 MiniMax、OpenAI、Anthropic 的请求映射、重试、stream 解析。
- `MarkdownSummaryStore`：负责输出路径、frontmatter、覆盖更新和摘要版本。

验收标准：

- 设置页可打开并保存。
- 选中单篇有 PDF 的条目后可生成 Markdown。
- 重复生成不会堆多个附件。
- 无 PDF、全文为空、key 错误、网络错误都有明确提示。
- `npm test`、`npm run build`、`unzip -t` 必须通过。

### 阶段 1：单篇论文深度阅读

目标：把“摘要”升级为“可追溯单篇阅读报告”。

新增能力：

- 单篇报告固定结构：
  - 基本信息
  - 研究背景
  - 研究问题
  - 方法与算法
  - 实验设置
  - 主要结论
  - 创新点
  - 局限性
  - 可借鉴点
  - 后续研究启发
- frontmatter 增加：
  - `summaryType`
  - `inputMode`
  - `zoteroItemKey`
  - `pdfAttachmentKey`
  - `sourceHash`
  - `summaryVersion`
  - `evidenceLevel`
- 对 Zotero 已索引文本做简单章节切分，至少支持摘要、引言、方法、实验、结论的关键词级定位。

验收标准：

- 同一篇论文可输出固定结构 Markdown。
- 如果只有摘要或全文提取不完整，报告必须标明低证据等级。
- 输出不写入任何第三方生成声明。

### 阶段 2：collection 级知识库

目标：每个 Zotero collection 可以形成独立知识库。

新增模块：

- `CollectionReader`：读取 collection 下所有常规条目、PDF、已有 Markdown 总结。
- `ChunkBuilder`：把论文拆成元数据块、摘要块、章节块、注释块、总结块。
- `IndexStore`：在本地保存 collection 索引缓存。
- `EvidenceStore`：记录每个结论对应的论文、字段、chunk、页码或附件来源。
- `ReviewWorkspace`：管理一个专题文献包的状态。

建议缓存位置：

```text
/Users/tart/Library/CloudStorage/OneDrive-个人/Zotero_PDFs/Zotero_MD_Summaries/
  collections/
    <collection-key>/
      papers.json
      chunks.jsonl
      evidence.jsonl
      summaries/
      reviews/
```

验收标准：

- 可对一个 collection 生成 `papers.json`。
- 可重建 `chunks.jsonl`，缓存不是唯一真源。
- 删除缓存后可从 Zotero 条目和 Markdown 总结重建。
- 每篇论文记录至少包含 Zotero key、标题、作者、年份、PDF key、摘要路径、文本可用状态。

### 阶段 3：跨论文综述生成

目标：从 collection 索引生成真正的文献综述材料，而不是拼接单篇摘要。

新增输出：

- 方法矩阵：论文、任务、场景、方法、输入、输出、指标、优势、不足。
- 实验矩阵：数据集、仿真环境、基线、指标、结果、限制。
- 研究空白矩阵：作者自述 gap、系统推断 gap、共同 gap、潜力 gap。
- 证据聚类：按方法路线、应用场景、数据来源、评价指标聚类。
- 综述草稿：研究背景、研究现状、问题归纳、未来方向。

关键约束：

- 每个跨论文判断必须列出支持论文。
- 没有证据的方向只能标为“推测方向”。
- 只有摘要的论文不能支撑细粒度实验结论。
- 综述草稿中要区分“作者声称”和“系统归纳”。

验收标准：

- 对一个 5 到 20 篇论文的 collection 生成可读 Markdown 综述。
- 文档内至少包含方法矩阵、gap 矩阵、代表论文表。
- 每条核心结论有来源列表。

### 阶段 4：联网检索与人工确认导入

目标：把调研文档中的联网检索做成可控入口。

第一批数据源：

- arXiv：预印本检索、开放 PDF。
- Semantic Scholar：相关论文、引用和被引网络。
- Crossref：DOI 和出版元数据补全。
- Unpaywall：合法开放全文状态。
- OpenAlex：主题、作者、开放位置和引用图谱补全。

工作流：

1. 用户输入研究问题。
2. 系统生成英文检索式和排除词。
3. 多源检索候选论文。
4. 去重合并 DOI、arXiv ID、OpenAlex ID、Semantic Scholar ID。
5. 判断开放全文、摘要、元数据可用等级。
6. UI 展示候选列表，用户勾选后才导入 Zotero 或专题缓存。

验收标准：

- 默认不绕过访问控制。
- 默认不自动批量下载付费全文。
- 每篇候选论文显示来源、开放状态、入选理由和排除理由。
- 用户确认后才写 Zotero。

### 阶段 5：研究想法挖掘与写作导出

目标：服务博士论文、基金申请、论文选题和研究现状写作。

新增能力：

- 从共同 gap 生成研究问题。
- 从方法矩阵组合可迁移技术路线。
- 生成开题背景草稿、基金背景草稿、研究现状段落。
- 输出“问题定义、文献证据、方法路线、实验验证、风险清单”。

验收标准：

- 每个 idea 必须绑定文献证据。
- 每个 idea 都要有可验证实验方案。
- 导出前用户可选择 Markdown、Zotero note、表格或 Word 草稿。

## 5. 数据模型

### PaperRecord

```json
{
  "zotero": {
    "itemKey": "",
    "pdfAttachmentKey": "",
    "collectionKeys": [],
    "tags": []
  },
  "ids": {
    "doi": "",
    "arxivId": "",
    "openalexId": "",
    "semanticScholarId": "",
    "pmid": "",
    "pmcid": ""
  },
  "metadata": {
    "title": "",
    "authors": [],
    "year": null,
    "venue": "",
    "abstract": "",
    "keywords": []
  },
  "access": {
    "status": "fulltext_open",
    "license": "",
    "pdfUrl": "",
    "landingPageUrl": "",
    "source": ""
  },
  "analysis": {
    "summaryStatus": "not_started",
    "summaryPath": "",
    "sourceHash": "",
    "evidenceLevel": "unknown"
  }
}
```

### EvidenceRef

```json
{
  "id": "",
  "paperKey": "",
  "sourceType": "metadata | abstract | fulltext | note | summary",
  "locator": {
    "page": null,
    "section": "",
    "chunkId": "",
    "attachmentKey": ""
  },
  "quote": "",
  "claim": "",
  "confidence": "low | medium | high"
}
```

### CollectionWorkspace

```json
{
  "collectionKey": "",
  "name": "",
  "createdAt": "",
  "updatedAt": "",
  "paperKeys": [],
  "indexStatus": "not_started | indexing | ready | stale | failed",
  "cacheDir": "",
  "outputs": {
    "methodMatrix": "",
    "gapMatrix": "",
    "reviewDraft": "",
    "ideaList": ""
  }
}
```

## 6. UI 设计

当前右键菜单保留，但要新增一个独立工作台窗口。

### 条目右键菜单

- 生成单篇阅读报告
- 更新单篇阅读报告
- 打开 Markdown 报告
- 加入当前综述工作台

### Collection 菜单

- 建立集合知识库
- 更新集合知识库
- 生成方法矩阵
- 生成研究空白矩阵
- 生成综述草稿
- 打开工作台目录

### 工作台窗口

建议分 5 个 tab：

1. Papers：论文列表、开放状态、阅读状态。
2. Summaries：单篇总结状态和重建按钮。
3. Evidence：证据块、来源、置信度。
4. Synthesis：方法矩阵、gap 矩阵、综述草稿。
5. Ideas：研究想法、实验路线、风险。

## 7. 写操作边界

默认只读。以下操作必须用户确认：

- 写入 Zotero note。
- 添加、删除或修改标签。
- 移动 collection。
- 下载 PDF。
- 批量生成 linked attachment。
- 覆盖已有 Markdown 报告。

写操作要记录本地操作日志：

```json
{
  "operationId": "",
  "time": "",
  "type": "zotero_note | tag | attachment | collection | file",
  "target": "",
  "before": {},
  "after": {},
  "reversible": true
}
```

## 8. 技术风险

1. Zotero 插件内代码膨胀  
   规避：尽快拆模块；复杂索引和检索服务不要都塞进 `bootstrap.js`。

2. 全文解析质量不稳定  
   规避：先依赖 Zotero 已提取文本；后续再接外部 PDF 解析；所有输出标证据等级。

3. 跨论文结论无来源  
   规避：EvidenceRef 作为一等数据；没有 evidence 的结论不能进入正式综述。

4. API 调用成本和速率限制  
   规避：缓存单篇总结、缓存 chunk、批量任务排队、支持暂停和重试。

5. 许可证风险  
   规避：不复制 `llm-for-zotero` 源码、技能文件、UI 文案和测试样例；只保留调研记录。

6. 数据隐私  
   规避：设置页明确显示 provider、baseURL、输入模式；默认不自动上传全库内容。

## 9. 当前仓库下一步任务

优先级 P0：

- 把 `addon/bootstrap.js` 拆成 `settings`、`zoteroItem`、`provider`、`summaryStore`、`ui` 模块。
- 为 provider 请求映射补更多测试。
- 修正 OpenAI-compatible stream 的兼容解析，确保 MiniMax 返回能稳定抽取正文。
- 给 Markdown frontmatter 增加 `inputMode`、`summaryType`、`evidenceLevel`。

优先级 P1：

- 新增单篇深度报告模板。
- 支持 collection 读取和 `papers.json` 输出。
- 建立 `collections/<collection-key>/` 缓存目录。
- 生成 collection 级方法矩阵初版。

优先级 P2：

- 接入 arXiv、Semantic Scholar、Crossref、Unpaywall。
- 做候选论文确认 UI。
- 做研究空白矩阵和 idea 列表。

## 10. Claude 复审清单

待本机 Claude CLI 额度恢复后，建议重点复审：

1. 模块拆分是否适合 Zotero 9 插件运行环境。
2. collection 级缓存目录是否适合同步到 OneDrive。
3. EvidenceRef 是否足够支撑综述引用追踪。
4. 联网检索阶段是否应该做成本地服务，而不是插件内直接调用所有 API。
5. 哪些功能必须留到 v2，避免 v1 范围过大。

## 11. 最小可交付版本定义

v1 不做联网检索，不做全自动综述，不做复杂向量库。v1 只交付：

- 单篇深度阅读报告。
- collection 论文清单。
- 基于已有单篇报告的手动综述草稿。
- linked attachment 输出。
- 用户确认式写入。

v2 再交付：

- collection 级索引。
- 方法矩阵和 gap 矩阵。
- 证据追踪。
- 工作台窗口。

v3 再交付：

- 联网检索。
- 多源去重。
- 开放全文判断。
- 研究想法挖掘。
- 写作草稿导出。

这个拆法能最大限度复用当前代码，同时避免一开始就把搜索、解析、索引、综述和 Zotero 写操作全部耦合在一起。
