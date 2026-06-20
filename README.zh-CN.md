# literature-review-with-LLM

Zotero 文献阅读、论文问答和 Markdown 摘要插件。它把 Zotero 中选中的论文变成一个 Markdown 优先的阅读工作流：生成或更新论文摘要、在论文聊天工作台里继续追问、复制 Markdown 回答、保存会话，并可选地通过本地桥接调用 Gemini / Claude / opencode 命令行工具做交叉建议。

[English README](README.md)

> 当前状态：已经可以用于单篇论文阅读、摘要、图片提问、图表/截图结构化解析、单篇论文阅读日志导出、开题/课题申报笔记导出、期刊/报告写作提纲导出、正式综述草稿导出、多篇论文对比与 Markdown 文献矩阵报告、带证据支持综合主张、综合路线图和正式综述报告草稿的集合级主题聚类工作区，以及可配置的受控引用网络扩展，但仍处于早期版本。跨集合综述和更强的跨文献分析仍在继续完善。

![Zotero 论文聊天工作台](docs/assets/workbench-chat.png)

## 核心特色

- **在 Zotero 内直接读论文和追问**：选中一篇论文后打开工作台，问题、回答和当前条目绑定，不需要在多个窗口之间来回复制。
- **Markdown 原生工作流**：生成本地 Markdown 摘要文件，自动链接回 Zotero；回答可复制为原始 Markdown，也可以导出带证据标签的论文阅读日志、开题/课题申报笔记、期刊/报告写作提纲和正式综述草稿，或预览后写回摘要文件。
- **多模型厂商配置**：同一个设置页中配置 MiniMax、DeepSeek、OpenAI-compatible Chat、OpenAI-compatible Responses、Anthropic / Anthropic-compatible、Gemini OpenAI-compatible、OpenRouter、DashScope、SiliconFlow、Ollama、LM Studio 等档案，并显示内置配置指南和 live-check 命令模板。
- **模型接口诊断**：对 OpenAI-compatible、OpenAI Responses、Anthropic 和常见代理包装响应统一解析文本、流式错误、模型列表和 token usage 元数据，并保存到会话记录。
- **多篇论文对比与文献矩阵**：多选 Zotero 条目打开工作台时，会把第一篇作为焦点论文，其余论文作为对比上下文；工作台可导出带证据标签的 Markdown 文献矩阵，内置 `文献矩阵` 技能可继续调用大模型深化分析。
- **集合级综述工作区**：对 collection 批量生成时，会写出 `papers.json`、论文笔记索引、方法矩阵、研究空白矩阵、启发式主题聚类、综合主张矩阵、综合路线图、研究问题卡、研究想法列表、手动综述草稿和正式综述报告草稿。
- **图片提问与图表解析**：工作台支持粘贴截图、拖入图片或选择本地图片；内置 `图表/截图解析` 技能可把论文图片、表格和实验结果整理成结构化 Markdown。
- **插件完全开源免费**：插件本身不收费；如果使用远程大模型服务，需要自行准备对应厂商的 API key。
- **本地 agent 咨询**：可选连接本机 Gemini、Claude、opencode 命令行工具，让多个本地工具分别给出阅读建议。
- **面向论文阅读的技能模板**：内置深度摘要、方法抽取、实验表格、图表/截图解析、文献矩阵、引用核查、候选论文发现等提示模板。
- **候选论文审阅队列**：arXiv / Crossref / Semantic Scholar / Unpaywall 的结果会去重、按可解释优先级排序，也可基于 Semantic Scholar references/citations 做可配置的受控扩展，支持保存人工审阅备注，导出 Markdown 审阅报告，写入 JSONL，并且只在人工确认后导入 Zotero。
- **研究领域提示模板包**：可选择通用阅读、AI/ML/系统、交通与城市空域、医学与生命科学、社科与政策、综述写作等模板包；工作台问答和直接生成摘要都会使用当前模板包。

## 安装

从 GitHub Release 下载最新 XPI：

- [v0.1.1 release](https://github.com/KaguraTart/literature-review-with-LLM/releases/tag/v0.1.1)
- [literature-review-with-llm.xpi](https://github.com/KaguraTart/literature-review-with-LLM/releases/download/v0.1.1/literature-review-with-llm.xpi)

在 Zotero 中安装：

1. 打开 Zotero。
2. 进入 `Tools -> Plugins`。
3. 选择 `Install Plugin From File...`。
4. 选择下载好的 `literature-review-with-llm.xpi`。
5. 如果 Zotero 提示重启，请重启 Zotero。

当前版本主要面向 Zotero 9.x。

## 快速开始

1. 在 Zotero 中选中一条带 PDF 附件的文献条目。
2. 打开 `Tools -> Literature Review with LLM 设置`，配置模型厂商、Base URL、API key 和模型名称。
3. 运行 `Tools -> 生成 Markdown 总结` 或 `Tools -> 打开论文聊天工作台`。
4. 在工作台里继续提问、复制 Markdown 回答，或把选中的回答写回摘要文件。
5. 需要询问图表或截图时，可在工作台输入框粘贴截图、拖入图片，或点击 `+` 选择本地图片；如果只发送图片，工作台会自动使用默认图片解析问题。图片理解依赖所选模型本身的多模态能力。

生成的 Markdown 文件会保存到设置中的输出目录。默认会按条目创建摘要、会话和候选论文文件，并把摘要文件链接回 Zotero。

## 配置大模型厂商和 API key

打开 `Tools -> Literature Review with LLM 设置`：

![配置模型厂商和 API key](docs/assets/provider-settings.png)

主要字段：

- `默认接口档案`：当前启用的模型档案。
- `Provider`：选择厂商或协议预设，例如 MiniMax、DeepSeek、OpenAI Compatible Chat、OpenAI Compatible Responses、Anthropic、Anthropic-compatible、Gemini OpenAI-compatible、OpenRouter、DashScope、SiliconFlow、Ollama、LM Studio、Local Agents 等。
- `Base URL`：接口根地址，例如 `https://api.minimaxi.com/v1`、`https://api.deepseek.com` 或 `http://127.0.0.1:11434/v1`。
- `API Key`：对应厂商的 API key。本地模型服务如 Ollama 可能不需要远程 API key。
- `Model`：使用的模型名称，例如 MiniMax、DeepSeek 或本地模型服务中的模型 id。
- `配置指南`：显示当前档案解析后的协议、请求 endpoint、鉴权方式、模型列表地址、输入能力和可复制的终端 live-check 命令，不显示已保存的完整 API key。
- `输入模式`：选择抽取文本输入，或在厂商支持时使用原始 PDF 输入。
- `流式输出`：厂商支持流式响应时可以开启。
- `提示模板包`：选择当前论文所属研究领域，用于调整模型阅读重点。
- `输出目录`：Markdown 摘要、会话、候选论文和日志的保存目录。

说明：

- MiniMax 是当前包里的默认预设，但仍建议确认模型名和 API key。
- DeepSeek 可使用 OpenAI-compatible Chat 风格的接口配置。
- OpenAI Compatible Chat 默认发送 `max_tokens`，检测到 `o` 系列 reasoning 模型时会改用 `max_completion_tokens`；自定义路由可在 `bodyExtra.tokenLimitField` 中显式填写 `max_completion_tokens` 或 `max_tokens`。
- OpenAI Compatible Chat 的流式请求会默认发送 `stream_options.include_usage`，方便在厂商返回时保存 token usage 元数据。
- 如果某些路由或 reasoning 模型拒收默认字段，可在 `bodyExtra.omitFields` 填写要移除的顶层请求字段，例如 `["temperature", "n", "max_tokens"]`，发送前会自动剔除。
- 如果某个厂商或路由提供 `/v1/responses`，选择 `OpenAI Compatible Responses`；这个档案可在模型支持时声明 PDF 原文和图片输入能力。
- Anthropic 官方接口使用 `Anthropic` 档案；第三方 Anthropic 风格路由或代理使用 `Anthropic Compatible Messages`，默认走 Bearer auth。
- Gemini 当前通过 OpenAI-compatible endpoint 风格配置。
- Local Agents 走本地 HTTP bridge，不直接调用远程模型 API。
- API keys 存在本机 Zotero 偏好设置中。不要把 `.env` 文件或本地偏好导出提交到仓库。

## 论文聊天工作台

工作台是一个紧凑的论文阅读界面：

- 顶栏显示当前论文、模型档案和设置入口。
- 中间区域渲染 Markdown 回答，支持标题、列表、表格、代码块和轻量公式显示。
- 输入框可以继续围绕当前论文提问。
- 输入框支持粘贴截图、拖入图片和选择本地图片；图片会以当前模型协议支持的格式发送。只贴图片直接发送时，会自动请求模型解析图片。
- 回答可以复制为 Markdown，也可以预览后写回摘要。
- 设置面板可调整模型、咨询模式、论文元信息、会话、阅读日志/综述草稿导出和候选论文工具。

常见提问：

- 总结这篇论文的主要贡献。
- 提取方法流程和核心模块。
- 把实验数据整理成 Markdown 表格。
- 找出结论和实验支撑之间是否存在缺口。
- 列出局限、风险和后续实验建议。

## 本地 Agents

插件可以通过本地 bridge 调用 Gemini、Claude 和 opencode 命令行工具，适合让多个本地工具独立给出阅读建议或审稿式反馈。

安装依赖：

```bash
npm install
```

启动或安装本地服务：

```bash
npm run local-agent:service:start
npm run local-agent:service:check
```

常用命令：

```bash
npm run local-agent:service:install
npm run local-agent:service:restart
npm run local-agent:service:doctor
npm run local-agent:service:stop
```

默认本地端点：

```text
http://127.0.0.1:3333/mcp
```

这些命令行工具需要在本机单独安装并完成认证。插件不负责管理各工具的账号登录。

## 开发

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

构建 XPI：

```bash
npm run build
```

完整检查：

```bash
npm run check
```

完整检查会运行测试、类型检查、provider 文本/流式/图片/PDF mock 校验、provider catalog 校验、写回 smoke 校验、打包校验、readiness 检查和空白字符检查。

可选的真实厂商接口检查需要使用你自己的 API credentials：

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai
OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:live -- --include openai --stream
OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:image:live -- --include openai
OPENAI_API_KEY=... OPENAI_MODEL=... npm run verify:provider:pdf:live -- --include openai
ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npm run verify:provider:live -- --include anthropic
ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npm run verify:provider:live -- --include anthropic --stream
ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npm run verify:provider:image:live -- --include anthropic
ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=... npm run verify:provider:pdf:live -- --include anthropic
```

第三方路由或本地接口请设置对应的 `*_BASE_URL`，并使用 `openai-compatible`、`openai-responses-compatible` 或 `anthropic-compatible`。Raw PDF live 检查会跳过 OpenAI-compatible Chat 档案，因为这类档案使用抽取文本输入。

live 检查也支持请求头和请求体覆盖。自定义网关可使用重复的 `--header name=value`，或使用更细的环境变量，例如 `OPENAI_COMPATIBLE_HEADERS_JSON`、`OPENAI_RESPONSES_COMPATIBLE_HEADERS_JSON`、`ANTHROPIC_COMPATIBLE_HEADERS_JSON`。`--body-extra-json` 会作用于本次选择的所有 case；也可以使用 `OPENAI_COMPATIBLE_BODY_EXTRA_JSON`、`OPENAI_RESPONSES_COMPATIBLE_BODY_EXTRA_JSON`、`ANTHROPIC_COMPATIBLE_BODY_EXTRA_JSON`、`OPENAI_BODY_EXTRA_JSON`、`ANTHROPIC_BODY_EXTRA_JSON`。

```bash
OPENAI_COMPATIBLE_API_KEY=... \
OPENAI_COMPATIBLE_MODEL=... \
OPENAI_COMPATIBLE_BASE_URL=... \
OPENAI_COMPATIBLE_HEADERS_JSON='{"HTTP-Referer":"https://example.org","X-Title":"Literature Review with LLM"}' \
OPENAI_COMPATIBLE_BODY_EXTRA_JSON='{"omitFields":["temperature","n","max_tokens"]}' \
npm run verify:provider:live -- --include openai-compatible
```

构建产物位置：

```text
build/literature-review-with-llm.xpi
```

Zotero 自动更新元数据位置：

```text
build/update.json
```

`addon/manifest.json` 会把 Zotero 指向稳定的 GitHub Releases `update.json` 地址。`update.json` 会记录当前版本的 XPI 下载地址、XPI `sha256` 校验值和 Zotero 兼容版本范围。发布时上传 `literature-review-with-llm.xpi` 和 `update.json` 两个产物，仓库本身不提交构建产物。

## 当前局限

- 多篇论文对比目前限制在工作台上下文内，默认最多纳入 5 篇对比论文，并已支持导出 Markdown 文献矩阵；collection 批量生成已加入启发式主题聚类、有证据来源的综合主张矩阵、综合路线图和正式综述报告草稿，但聚类是确定性规则，报告在正式写作前仍需要人工复核。
- 已支持单轮图片附件提问和 `图表/截图解析` 技能，但图表、表格和手写笔记的理解质量仍取决于模型能力；暂未做本地 OCR 或图表数据重建。
- 公式渲染仍是轻量支持，不是完整 TeX 引擎。
- 论文阅读日志和正式综述草稿目前是带证据摘录和人工填写字段的结构化 Markdown 草稿，仍需要人工编辑后才能作为完整长篇综述使用。
- 候选论文发现已加入可解释排序、重复项协调、可配置的受控引用网络扩展、人工审阅备注和 Markdown 候选审阅报告，但更完整的审阅流程还需要继续加强。
- 工作台 UI 仍在打磨，部分控件和设置项后续会继续简化。
- 原始 PDF 输入依赖厂商能力，很多厂商仍主要使用 Zotero 抽取文本。
- 本地 agent 调用依赖本机 CLI 工具及其认证状态。
- 真实厂商接口验证需要用户自己的 API key，默认检查不会运行 live 验证。
- 目前主要覆盖 Zotero 9.x。

## TODO

- 完善跨集合聚类，并继续精修集合级综合主张、综合路线图和报告生成。
- 增强图片、PDF 图表、表格和实验结果的结构化抽取质量，加入本地 OCR/表格重建。
- 在当前可配置引用网络策略基础上，继续加强更完整的候选论文审阅流程。
- 在内置配置指南之外，继续补充更多厂商配置截图和教程。
- 继续精修开题/课题申报笔记和期刊/报告提纲模板，补充更多领域化写作格式。

## 安全和隐私

- 妥善保存 API key，不要提交到仓库。
- 不要提交 `.env` 文件。
- 写回摘要前先检查生成内容。
- 替换或覆盖原文档前使用预览步骤。
- 向远程厂商发送未公开论文或敏感笔记前，请确认数据使用边界。

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Author

kaguratart <kaguratart@gmail.com>
