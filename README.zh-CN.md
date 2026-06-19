# literature-review-with-LLM

Zotero 文献阅读、论文问答和 Markdown 摘要插件。它把 Zotero 中选中的论文变成一个 Markdown 优先的阅读工作流：生成或更新论文摘要、在论文聊天工作台里继续追问、复制 Markdown 回答、保存会话，并可选地通过本地桥接调用 Gemini / Claude / opencode 命令行工具做交叉建议。

[English README](README.md)

> 当前状态：已经可以用于单篇论文阅读、摘要、图片提问、图表/截图结构化解析、多篇论文对比和集合级主题聚类工作区，但仍处于早期版本。跨集合综述和更强的跨文献分析还在计划中。

![Zotero 论文聊天工作台](docs/assets/workbench-chat.png)

## 核心特色

- **在 Zotero 内直接读论文和追问**：选中一篇论文后打开工作台，问题、回答和当前条目绑定，不需要在多个窗口之间来回复制。
- **Markdown 原生工作流**：生成本地 Markdown 摘要文件，自动链接回 Zotero；回答可复制为原始 Markdown，也可以预览后写回摘要文件。
- **多模型厂商配置**：同一个设置页中配置 MiniMax、DeepSeek、OpenAI-compatible Chat、OpenAI-compatible Responses、Anthropic / Anthropic-compatible、Gemini OpenAI-compatible、OpenRouter、DashScope、SiliconFlow、Ollama、LM Studio 等档案。
- **多篇论文对比与文献矩阵**：多选 Zotero 条目打开工作台时，会把第一篇作为焦点论文，其余论文作为对比上下文；内置 `文献矩阵` 技能可生成 evidence-grounded literature matrix。
- **集合级综述工作区**：对 collection 批量生成时，会写出 `papers.json`、论文笔记索引、方法矩阵、研究空白矩阵、启发式主题聚类、研究问题卡、研究想法列表和手动综述草稿。
- **图片提问与图表解析**：工作台支持粘贴截图、拖入图片或选择本地图片；内置 `图表/截图解析` 技能可把论文图片、表格和实验结果整理成结构化 Markdown。
- **插件完全开源免费**：插件本身不收费；如果使用远程大模型服务，需要自行准备对应厂商的 API key。
- **本地 agent 咨询**：可选连接本机 Gemini、Claude、opencode 命令行工具，让多个本地工具分别给出阅读建议。
- **面向论文阅读的技能模板**：内置深度摘要、方法抽取、实验表格、图表/截图解析、文献矩阵、引用核查、候选论文发现等提示模板。
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
- `输入模式`：选择抽取文本输入，或在厂商支持时使用原始 PDF 输入。
- `流式输出`：厂商支持流式响应时可以开启。
- `提示模板包`：选择当前论文所属研究领域，用于调整模型阅读重点。
- `输出目录`：Markdown 摘要、会话、候选论文和日志的保存目录。

说明：

- MiniMax 是当前包里的默认预设，但仍建议确认模型名和 API key。
- DeepSeek 可使用 OpenAI-compatible Chat 风格的接口配置。
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
- 设置面板可调整模型、咨询模式、论文元信息、会话和候选论文工具。

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

- 多篇论文对比目前限制在工作台上下文内，默认最多纳入 5 篇对比论文；collection 批量生成已加入启发式主题聚类和集合级 synthesis 矩阵，但聚类是确定性规则，需要在正式写作前人工复核。
- 已支持单轮图片附件提问和 `图表/截图解析` 技能，但图表、表格和手写笔记的理解质量仍取决于模型能力；暂未做本地 OCR 或图表数据重建。
- 公式渲染仍是轻量支持，不是完整 TeX 引擎。
- 候选论文发现还是工具级能力，去重、排序和审阅流程需要继续加强。
- 工作台 UI 仍在打磨，部分控件和设置项后续会继续简化。
- 原始 PDF 输入依赖厂商能力，很多厂商仍主要使用 Zotero 抽取文本。
- 本地 agent 调用依赖本机 CLI 工具及其认证状态。
- 真实厂商接口验证需要用户自己的 API key，默认检查不会运行 live 验证。
- 目前主要覆盖 Zotero 9.x。

## TODO

- 完善跨集合聚类、更丰富的 synthesis 矩阵和批量报告生成。
- 增强图片、PDF 图表、表格和实验结果的结构化抽取质量，加入本地 OCR/表格重建。
- 加强候选论文排序、引用网络扩展和去重。
- 补充更多厂商配置截图和教程。
- 增加 Zotero 侧边工作台 UI 测试。
- 增加论文阅读报告、开题笔记、综述草稿等导出模板。

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
