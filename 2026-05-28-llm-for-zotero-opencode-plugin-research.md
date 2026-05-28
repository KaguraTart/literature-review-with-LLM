# Zotero 论文阅读插件调研

调研时间：2026-05-28 21:44:01 CST

## 结论先行

1. `yilewang/llm-for-zotero` 可以作为功能和架构参考，但不建议把它的源码直接并入一个闭源或非 AGPL 项目。该项目许可证为 `AGPL-3.0-or-later`，如果复制、修改、分发或做成强耦合衍生项目，后续发布和网络服务形态都要认真处理源码开放、许可证保留、修改声明等义务。
2. 如果只是参考“Zotero 插件 + 文库工具 + 技能文件 + 人工确认 + PDF 解析缓存 + 跨论文分析”的产品机制，然后完全重新实现，可以不把它作为依赖写进产品主叙事；但建议在内部调研或 README 的 `Related work` / `Acknowledgements` 部分简短提及，避免后续争议。
3. 可以按 `anomalyco/opencode` 的方式写一个“相似但独立”的插件：使用独立项目名、独立代码、独立 UI、独立数据结构，并声明非官方、不从属于上游项目。`opencode` 自身 README 的规则是：如果相关项目名称包含 `opencode`，需要在 README 里说明不是官方团队构建、也没有从属关系。我们这个 Zotero 插件不需要使用 `opencode` 名称，原则上只借鉴这种品牌边界声明即可。
4. 更合理的路线是：自研 Zotero 插件主体，保留本地优先的文库读取、集合级 RAG、跨论文证据矩阵、论文总结分析技能库、可回溯引用、写操作确认和撤销机制。`llm-for-zotero` 已有不少类似能力，但我们的差异点应放在“论文合集级知识库”和“面向科研任务的技能体系”。

## 上游项目机制

### yilewang/llm-for-zotero

项目定位：Zotero 阅读器内的研究助手插件，支持当前论文问答、论文总结、图表分析、多论文比较、保存笔记、文库级读写工具、技能文件和外部代理连接。

当前状态：

- GitHub 仓库显示为公开项目，README 标注支持 Zotero 7、8、9。
- 最新 release 查询结果为 `v3.8.12`，发布时间为 2026-05-28 UTC。
- `package.json` 当前版本为 `3.8.12`，许可证字段为 `AGPL-3.0-or-later`。
- 技术栈主要是 TypeScript、`zotero-plugin-scaffold`、`zotero-plugin-toolkit`，构建目标包含 `firefox115`。
- 插件 ID 为 `zotero-llm@github.com.yilewang`，偏好项前缀为 `extensions.zotero.llmforzotero`。

已实现或已公开说明的关键能力：

- 当前 PDF 问答、选中文本解释、全文总结、图表/截图理解。
- 多论文比较：可把多个 Zotero 标签页或外部文件加入上下文。
- 文库级 Agent Mode：读取文库、搜索条目/集合、读取论文、搜索段落、渲染 PDF 页、检查附件。
- 文献发现：通过 CrossRef 和 Semantic Scholar 查元数据、推荐、参考文献、引用。
- 文库写操作：标签、元数据、集合、附件、重复项、导入和删除等，设计上有人工确认和撤销机制。
- 技能系统：内置 `simple-paper-qa`、`evidence-based-qa`、`analyze-figures`、`compare-papers`、`library-analysis`、`literature-review`、`write-note`、`import-cited-reference`。
- PDF 解析：支持 MinerU，能缓存解析结果，处理表格、公式、图像和复杂版面。
- MCP 服务：文档说明插件内置 MCP server，端点为 `http://localhost:23119/llm-for-zotero/mcp`，可让外部兼容客户端调用 Zotero 文库工具。

### anomalyco/opencode

项目定位：开源代码代理工具。

当前状态：

- GitHub README 显示许可证为 MIT。
- 最新 release 查询结果为 `v1.15.11`，发布时间为 2026-05-27 UTC。
- README 明确说明：如果相关项目使用 `opencode` 作为名称的一部分，需要在 README 中说明不是官方团队构建，且不从属于官方团队。

对本项目的启发：

- 可以学习它的品牌边界写法：如果项目参考了某个生态或名称容易混淆，应在 README 里加入“非官方、无从属关系”的短声明。
- 不需要采用它的许可证或项目结构。它是 MIT，和 `llm-for-zotero` 的 AGPL 风险完全不同。

## 是否可以加入我们的项目

分三种情况判断：

1. 直接复制或修改 `llm-for-zotero` 源码：不建议，除非我们的项目也准备遵守 AGPL，并公开相应源码、保留许可证和修改说明。
2. 作为独立外部依赖或桥接调用：可以考虑，但要保持边界清晰。比如只调用其公开 MCP 端点或让用户自行安装插件，此时我们的项目不复制其源码，风险明显低于直接并入。
3. 参考功能机制后自研：推荐。可以复用 Zotero 插件生态的通用公开接口和通用工程路线，但不要复制源文件、提示词、技能文件、UI 文案、图标、数据结构实现或测试样例。

我的建议：不要把 `llm-for-zotero` 源码加入我们的项目主线；可以把它列为竞品/参考项目，单独保留调研记录。实际实现应从空白插件框架开始，自研核心模块。

## 是否需要提及

建议分场景：

- 如果复用源码、修改源码、fork、打包其代码或使用其技能文件：必须提及，并按许可证处理。
- 如果只做机制参考，产品代码完全独立：法律上通常不必在主界面反复提及，但建议在 README 的 `Related work` 或 `Acknowledgements` 中简短写一句，保持透明。
- 如果担心被认为是同类复刻：可以采用 `opencode` 式声明，说明本项目不是 `llm-for-zotero` 官方项目，也不与其作者存在从属关系。

建议措辞：

> Related work: This project is an independent Zotero research workflow plugin. It is not affiliated with `llm-for-zotero`; that project was reviewed as prior art during product research.

如果 README 用中文：

> 相关工作：本项目是独立的 Zotero 科研阅读工作流插件，不隶属于 `llm-for-zotero`。该项目仅作为调研阶段的同类开源参考。

## 可行的自研插件形态

目标定位：Zotero 内的“论文合集级研究工作台”，重点不是单篇对话，而是围绕集合、课题、专题文献包构建可追溯知识库。

核心功能建议：

1. 单篇论文总结
   - 结构化摘要：研究问题、方法、数据/实验、主要结论、创新点、局限性、可复用方法。
   - 精读模式：按章节拆解，保留页码/段落证据。
   - 图表模式：提取图表标题、实验变量、指标、结论和可引用说明。

2. 跨论文阅读
   - 集合级对比：同一 Zotero collection 内论文按方法、场景、数据、指标、结论矩阵化。
   - 证据链：每个判断绑定论文、页码、段落、图表或注释来源。
   - 冲突识别：自动标出结论不一致、实验假设不同、数据口径不同的论文组。

3. 论文合集 RAG 知识库
   - 每个 Zotero collection 生成一个独立索引。
   - 索引粒度建议为：论文元数据、章节块、段落块、图表说明、参考文献、用户注释。
   - 向量检索之外增加结构化过滤：年份、期刊/会议、作者、标签、研究对象、方法类别、指标。
   - 知识库需要可重建：索引文件只作为缓存，源头仍是 Zotero 条目、PDF、注释和 Markdown 总结。

4. 科研技能库
   - `paper-deep-summary`：单篇深度总结。
   - `method-extractor`：方法、模型、公式、流程抽取。
   - `experiment-table-builder`：实验设置和指标表格。
   - `cross-paper-comparison`：多篇横向对比。
   - `literature-gap-finder`：研究空白和可做方向。
   - `proposal-background-builder`：把文献证据转成基金/开题背景。
   - `citation-audit`：检查总结中的论断是否都有文献支撑。
   - `collection-rag-builder`：为集合建立和更新知识库。

5. 写操作安全
   - 默认只读。
   - 写入 Zotero 标签、笔记、集合、元数据前必须预览。
   - 支持撤销最近批量写入。
   - 明确区分“缓存更新”和“Zotero 文库修改”。

## 建议架构

```text
Zotero 插件层
  - UI：阅读器侧栏、独立窗口、集合知识库面板
  - Zotero API：条目、集合、附件、注释、笔记、标签
  - 权限控制：只读工具、写操作确认、撤销记录

本地服务层
  - PDF 解析队列：文本、章节、图表、公式
  - 索引服务：集合级 chunk、embedding、BM25、元数据过滤
  - RAG 服务：检索、重排、证据合并、引用回跳
  - 任务队列：批量解析、批量总结、增量更新

技能层
  - Markdown 技能文件
  - 任务路由规则
  - 输出模板
  - 证据要求

数据层
  - Zotero 原始数据
  - 本地解析缓存
  - 集合级索引
  - 结构化总结和证据矩阵
```

## 实施路线

第一阶段：只读原型

- 建立 Zotero 插件骨架。
- 读取当前论文、当前集合、条目元数据、PDF 文本和注释。
- 完成单篇总结、集合论文列表、基础问答。

第二阶段：集合级知识库

- 为单个 collection 建立本地索引。
- 支持增量更新和重建。
- 输出回答时强制带来源定位。

第三阶段：科研技能体系

- 做 6 到 8 个高质量技能文件。
- 每个技能都规定输入、步骤、证据要求、输出格式。
- 支持用户自定义技能。

第四阶段：跨论文分析

- 做方法矩阵、实验矩阵、结论矩阵和研究空白分析。
- 支持导出 Markdown、Zotero note、Word 草稿或表格。

第五阶段：安全写入

- 标签、笔记、集合整理等写操作全部走确认卡片。
- 加入撤销日志。
- 加入批量操作预检和冲突提示。

## 风险点

- 许可证风险：不要复制 AGPL 项目的源码、技能文件、UI 文案或实现细节，除非项目整体接受 AGPL。
- 数据隐私：PDF、注释和用户笔记可能含未公开材料，默认应提供本地处理选项，并清楚显示外部服务数据流。
- 性能：集合级 RAG 需要处理大量 PDF，必须有队列、缓存、失败重试和增量更新。
- 证据可靠性：跨论文总结容易生成无来源判断，必须把引用、页码、段落或图表来源作为一等数据。
- Zotero 版本兼容：需要明确支持 Zotero 7/8/9 的范围，并做实际安装测试。

## 推荐决策

推荐采用“独立实现 + 透明提及 + 明确差异化”的方案：

- 不直接并入 `llm-for-zotero`。
- 不使用容易混淆的项目名。
- README 可以简短提及其为同类开源参考。
- 主功能聚焦在 collection 级 RAG、跨论文证据矩阵、科研写作技能库和可追溯知识库。
- 若未来确实需要复用其某个模块，先单独做许可证评估，再决定是否接受 AGPL 约束。

## 主要资料来源

- `yilewang/llm-for-zotero` GitHub 仓库：https://github.com/yilewang/llm-for-zotero
- `llm-for-zotero` README：https://raw.githubusercontent.com/yilewang/llm-for-zotero/main/README.md
- `llm-for-zotero` LICENSE：https://raw.githubusercontent.com/yilewang/llm-for-zotero/main/LICENSE
- `llm-for-zotero` package.json：https://raw.githubusercontent.com/yilewang/llm-for-zotero/main/package.json
- `llm-for-zotero` 最新 release API：https://api.github.com/repos/yilewang/llm-for-zotero/releases/latest
- `llm-for-zotero` 文档站：https://yilewang.github.io/llm-for-zotero/
- `anomalyco/opencode` GitHub 仓库：https://github.com/anomalyco/opencode
- `opencode` CONTRIBUTING：https://github.com/anomalyco/opencode/blob/dev/CONTRIBUTING.md
- `opencode` 最新 release API：https://api.github.com/repos/anomalyco/opencode/releases/latest

## 补充调研：联网论文搜索与多智能体科研工作流

补充调研时间：2026-05-28 21:58:45 CST

### 结论先行

可以在当前设想基础上新增联网搜索论文能力，而且建议把它做成项目的核心能力之一。合理边界是：

1. 对 arXiv、开放获取期刊、开放仓储、公开会议平台，优先获取元数据、摘要、许可信息、PDF 或可机读全文。
2. 对无法合法获取全文的论文，只获取公开元数据、摘要、DOI、引用关系、开放获取状态、期刊/会议、作者和链接，不绕过访问控制。
3. 搜索、去重、分类、单篇总结、跨论文总结、研究空白发现、科研想法生成应拆成多个可审计智能体，而不是一个大提示词完成所有步骤。
4. 每个结论必须绑定证据来源：论文 ID、DOI、URL、页码或段落块。没有全文时，只允许输出“基于摘要/元数据”的低置信分析。

### 可接入的数据源

| 数据源 | 适合用途 | 可获得内容 | 主要限制 |
| --- | --- | --- | --- |
| arXiv API | 预印本搜索、开放 PDF 获取、按主题持续监控 | 标题、作者、摘要、分类、发布时间、更新日期、arXiv ID、PDF 链接 | 旧 API 限流为全部机器合计 3 秒 1 次；元数据可用性好，但全文版权和再分发许可逐篇不同 |
| Semantic Scholar Graph API | 跨学科检索、引用/被引网络、开放 PDF 发现、相关论文扩展 | 标题、摘要、作者、年份、引用数、参考文献、被引文献、领域、开放 PDF 信息、片段检索 | 相关性搜索最多返回 1000 条；大规模任务应使用 bulk search 或数据集 |
| OpenAlex | 大规模开放学术图谱、跨库去重、主题分类、开放获取状态 | DOI、标题、作者、年份、引用数、主题、关键词、参考文献、相关论文、开放获取位置、PDF URL、摘要倒排索引 | 当前 API 采用 key 和用量预算；摘要不是明文，需要从倒排索引还原 |
| Crossref | DOI 元数据补全、出版信息、许可信息、摘要兜底 | DOI、题名、作者、期刊/会议、出版日期、许可、基金、ORCID、部分摘要 | 摘要不一定有；部分摘要版权归出版社或作者 |
| Unpaywall | DOI 到合法开放获取版本的发现 | 是否开放获取、开放获取类型、最佳开放位置、PDF URL、许可、仓储/出版社位置 | 必须带 email 参数；只覆盖 DOI 资源 |
| Europe PMC / PubMed / PMC | 生物医学方向文献、摘要和开放全文 | PubMed/PMC 元数据、摘要、开放全文、补充材料、注释 | 领域偏生物医学；全文只覆盖开放子集 |
| CORE | 开放仓储全文聚合 | 开放获取论文元数据、全文、仓储来源 | 需要 API key；质量取决于仓储元数据和全文解析情况 |
| OpenReview | 机器学习会议论文、公开评审和讨论 | 投稿、PDF、评审、回复、决定、会议元数据 | 只应读取公开内容；不同会议和年份使用的 API/数据结构可能不同 |

### 推荐搜索策略

联网论文搜索不要只做一个搜索框。建议设计为“查询规划 + 多源检索 + 去重合并 + 可获取性判断 + 人工确认导入”的流水线：

1. 查询规划智能体
   - 将用户问题拆成关键词、同义词、英文术语、缩写、方法名、应用场景和排除词。
   - 生成多个查询：宽检索、精准检索、最新论文检索、综述检索、方法检索、数据集/代码检索。
   - 对中文研究主题自动生成英文检索式。

2. 多源检索智能体
   - arXiv：优先查预印本和最新方法论文。
   - Semantic Scholar：查相关论文、引用链、被引链、相似论文。
   - OpenAlex：补全跨库元数据、主题、开放获取状态和参考文献网络。
   - Crossref：用 DOI 补全出版元数据。
   - Unpaywall：判断 DOI 是否存在合法开放全文。
   - Europe PMC / PubMed / CORE / OpenReview：按学科和场景启用。

3. 去重与规范化智能体
   - DOI 优先，其次 arXiv ID、OpenAlex ID、Semantic Scholar paper ID、标题近似匹配。
   - 合并同一论文的预印本和正式发表版本，保留版本关系。
   - 记录每个字段来自哪个数据源，避免错误覆盖。

4. 可获取性判断智能体
   - `fulltext_open`：可合法获取 PDF 或全文。
   - `abstract_only`：只有摘要和元数据。
   - `metadata_only`：只有题名、作者、发表信息。
   - `needs_user_access`：需要用户通过学校、机构或个人权限打开。
   - 禁止绕过访问控制，只提供 DOI、出版社页、开放副本或作者主页线索。

5. 相关性筛选智能体
   - 结合标题、摘要、关键词、引用网络和用户课题目标评分。
   - 输出“必须读 / 值得读 / 背景材料 / 暂不相关”四级。
   - 每篇给出简短入选理由和排除理由。

6. 导入与归档智能体
   - 用户确认后再写入 Zotero 或本地项目。
   - 自动打标签：主题、方法、场景、数据集、是否综述、是否开放全文、待读/精读/已读。
   - 为每个论文集合建立独立索引和阅读状态。

### 单篇论文总结结构

单篇论文总结应固定输出结构，且每一项标注证据来源和置信度：

1. 基本信息
   - 标题、作者、年份、来源、DOI / arXiv ID、开放获取状态、版本。

2. 研究背景
   - 该论文解决什么大问题。
   - 为什么该问题重要。
   - 背景论断对应的原文段落或摘要句。

3. 研究现状
   - 论文认为已有方法是什么。
   - 已有方法分为哪些类别。
   - 相关工作的关键脉络。

4. 当前研究空白
   - 论文明确指出的不足。
   - 根据方法和实验可推断的隐含不足。
   - 区分作者声称和系统推断。

5. 本文提出的方法或算法
   - 核心算法流程。
   - 输入、输出、约束、目标函数、关键模块。
   - 如有公式，记录公式含义而不是只复述符号。

6. 假设与适用边界
   - 数据假设、场景假设、模型假设、实验假设。
   - 哪些条件变化后方法可能失效。

7. 实验结果
   - 数据集/场景、指标、对比方法、消融实验。
   - 只在全文可获得时做细粒度实验表；只有摘要时仅做摘要级结论。

8. 创新点和贡献
   - 作者声称的贡献。
   - 与相关论文相比真正新的地方。
   - 贡献是否被实验充分支撑。

9. 不足
   - 作者自述限制。
   - 实验范围不足。
   - 可复现性、泛化性、鲁棒性、计算开销等风险。

10. 对后续研究的启发
    - 可直接延伸的研究问题。
    - 可组合的其他方法。
    - 可做博士/基金方向的切入点。

### 跨论文总结能力

跨论文总结不应简单拼接单篇摘要。建议围绕“矩阵 + 聚类 + 证据链”实现：

1. 方法矩阵
   - 行：论文。
   - 列：任务、场景、核心方法、输入特征、约束建模、优化目标、数据集、指标、优势、不足。

2. 研究空白矩阵
   - 每篇论文显式 gap。
   - 系统推断 gap。
   - 多篇论文共同 gap。
   - 只在单篇出现但潜力高的 gap。

3. 证据聚类
   - 将论文按方法路线聚类：强化学习、图模型、优化算法、控制屏障函数、仿真验证、真实数据验证等。
   - 将论文按应用场景聚类：低空交通、无人机集群、任务分配、冲突消解、通信感知一体化等。
   - 每个聚类给出代表论文和边界。

4. 共同不足发现
   - 数据规模不足。
   - 动态扰动不足。
   - 异构主体不足。
   - 安全约束弱。
   - 真实空域规则缺失。
   - 跨场景泛化不足。
   - 计算效率和实时性不足。

5. 创新点生成
   - 不是直接生成“新颖”口号，而是从共同不足中组合：
     - 未解决约束 + 可迁移方法。
     - 高价值场景 + 现有方法盲区。
     - 已有算法 + 新评价指标。
     - 单论文方法 + 跨论文补强模块。
   - 每个 idea 输出：问题、为什么现有文献没解决、可行技术路线、验证方案、风险。

### 多智能体设计

建议先做 8 个核心智能体，后续再扩展：

1. `search-planner`
   - 输入：用户研究问题。
   - 输出：多语言检索词、检索式、数据源选择、时间范围、排除条件。

2. `paper-harvester`
   - 输入：检索计划。
   - 输出：候选论文池。
   - 工具：arXiv、Semantic Scholar、OpenAlex、Crossref、Unpaywall、Europe PMC、CORE、OpenReview。

3. `dedupe-normalizer`
   - 输入：候选论文池。
   - 输出：规范化论文记录。
   - 关键：合并 DOI / arXiv / 发表版本，保留来源证据。

4. `access-resolver`
   - 输入：规范化论文记录。
   - 输出：全文可获取状态、PDF URL、许可、摘要可用性。

5. `auto-classifier`
   - 输入：标题、摘要、关键词、全文块。
   - 输出：主题标签、方法标签、场景标签、读文优先级。

6. `single-paper-reader`
   - 输入：单篇论文全文或摘要。
   - 输出：固定结构深度总结。
   - 要求：所有判断带来源和置信度。

7. `cross-paper-synthesizer`
   - 输入：一组单篇总结和证据块。
   - 输出：方法矩阵、共同 gap、冲突点、研究脉络、代表论文。

8. `idea-miner`
   - 输入：跨论文总结、用户课题约束、已有 Zotero 文库。
   - 输出：科研 idea、创新方向、可验证假设、实验计划、风险清单。

可选增强智能体：

- `citation-graph-expander`：从种子论文沿引用和被引方向扩展。
- `review-paper-detector`：识别综述、教程、benchmark、survey。
- `dataset-code-linker`：从论文中提取数据集、代码库、项目页。
- `zotero-curator`：负责标签、集合、笔记和阅读状态整理，所有写操作都要用户确认。

### 数据模型建议

每篇论文建议保存成结构化记录：

```json
{
  "ids": {
    "doi": "",
    "arxiv_id": "",
    "openalex_id": "",
    "semantic_scholar_id": "",
    "pmid": "",
    "pmcid": ""
  },
  "metadata": {
    "title": "",
    "authors": [],
    "year": null,
    "venue": "",
    "type": "",
    "abstract": "",
    "keywords": []
  },
  "access": {
    "status": "fulltext_open | abstract_only | metadata_only | needs_user_access",
    "license": "",
    "pdf_url": "",
    "landing_page_url": "",
    "source": ""
  },
  "classification": {
    "topics": [],
    "methods": [],
    "scenarios": [],
    "priority": "must_read | useful | background | exclude"
  },
  "analysis": {
    "summary_status": "not_started | abstract_level | fulltext_level",
    "confidence": "low | medium | high",
    "evidence_refs": []
  }
}
```

集合级知识库建议保存：

- `collection_id`：对应 Zotero collection 或本地专题。
- `source_papers`：论文记录列表。
- `chunks`：段落、章节、图表说明、摘要、注释。
- `embeddings`：向量索引。
- `metadata_index`：年份、方法、场景、期刊/会议、开放状态。
- `evidence_graph`：论文之间的引用、方法相似、gap 相似、结论冲突。
- `synthesis_outputs`：跨论文矩阵、研究空白、idea 列表。

### RAG 检索策略

集合级 RAG 需要混合检索，而不是只做向量相似：

1. 元数据过滤
   - 年份、领域、场景、方法、是否综述、是否开放全文。

2. 关键词检索
   - BM25 或全文倒排索引，用于精确术语、算法名、数据集名。

3. 向量检索
   - 用于语义相似问题和跨语言查询。

4. 引用图扩展
   - 从命中论文扩展到其参考文献、被引文献和相关论文。

5. 证据重排
   - 优先全文证据，其次摘要证据，再次元数据证据。
   - 优先正式发表版本，其次预印本；但最新方向监测可反过来优先预印本。

6. 输出约束
   - 所有跨论文结论必须列出支持论文。
   - 没有证据的想法必须标为“推测方向”。
   - 只有摘要时不得输出细粒度实验结论。

### 实施路线更新

第零阶段：联网检索 PoC

- 实现 arXiv 检索和 PDF 获取。
- 实现 Semantic Scholar 检索和 openAccessPdf 字段读取。
- 实现 Crossref DOI 元数据补全。
- 实现 Unpaywall DOI 开放获取查询。
- 输出统一候选论文 JSON。

第一阶段：人工确认式论文收集

- 搜索结果展示：标题、作者、年份、摘要、来源、开放状态、相关性分数。
- 用户勾选后导入 Zotero 或本地专题。
- 不自动批量下载，默认只下载开放获取 PDF。

第二阶段：自动分类和单篇总结

- 对已确认论文生成标签和优先级。
- 全文开放的论文做全文级总结。
- 只有摘要的论文做摘要级总结，并标低置信度。

第三阶段：集合级知识库

- 每个 collection 建立独立索引。
- 支持增量更新、重建和证据追踪。
- 支持“这个集合里哪些论文共同指出了某个 gap”这类问题。

第四阶段：跨论文综合

- 自动生成方法矩阵、gap 矩阵、实验矩阵。
- 输出研究脉络和核心论文地图。
- 支持根据用户课题约束筛选可做方向。

第五阶段：科研 idea 挖掘

- 从共同 gap、未覆盖场景、弱实验假设中生成 idea。
- 每个 idea 给出：问题定义、文献证据、方法路线、实验验证、潜在风险。
- 用户确认后可生成开题、基金、论文引言或研究计划草稿。

### 合规与风险边界

- 不能绕过出版社、学校图书馆或数据库的访问控制。
- 对付费论文，只保存公开元数据、摘要、DOI、出版社页和合法开放副本线索。
- arXiv PDF 可读不等于可任意再分发；需要记录每篇论文的许可。
- Crossref 元数据一般可用，但其中部分摘要可能受版权保护，系统应只保存必要摘要，不做大规模再发布。
- OpenReview 只读取公开 venue 的公开内容，不访问匿名身份、隐藏评审或非公开数据。
- 批量任务必须有速率限制、缓存、重试和停止按钮。
- 任何写入 Zotero 的标签、笔记、集合移动和附件下载都应先展示预览并要求确认。

### 推荐产品定位

这个项目不应定位为“单篇论文聊天插件”，而应定位为：

> 面向 Zotero 的联网文献发现、开放全文阅读、集合级知识库和科研想法挖掘工具。

核心差异点：

- 从“找论文”到“形成研究方向”的完整链路。
- 对开放全文和仅摘要论文做分级处理。
- 每个专题文献包都有独立 RAG 知识库。
- 多智能体分工明确，输出可追踪、可确认、可回滚。
- 面向博士论文、基金申请、论文选题和研究现状写作，而不只是问答。

### 补充资料来源

- arXiv API User Manual：https://info.arxiv.org/help/api/user-manual.html
- arXiv API Terms of Use：https://info.arxiv.org/help/api/tou.html
- Semantic Scholar Graph API：https://api.semanticscholar.org/api-docs/graph
- Semantic Scholar API overview：https://www.semanticscholar.org/product/api
- OpenAlex Works API：https://developers.openalex.org/api-reference/works
- OpenAlex single work schema：https://developers.openalex.org/api-reference/works/get-a-single-work
- OpenAlex authentication and pricing：https://developers.openalex.org/api-reference/authentication
- Crossref REST API：https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- Crossref REST API filters：https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/
- Unpaywall REST API：https://unpaywall.org/products/api
- Unpaywall data format：https://unpaywall.org/data-format
- Europe PMC RESTful Web Service：https://europepmc.org/RestfulWebService
- NCBI APIs：https://www.ncbi.nlm.nih.gov/home/develop/api/
- CORE API：https://core.ac.uk/services/api
- DOAJ OpenURL docs：https://doaj.org/docs/openurl/
- OpenReview API docs：https://docs.openreview.net/getting-started/using-the-api
