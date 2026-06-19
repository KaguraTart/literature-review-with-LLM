# literature-review-with-LLM

Zotero 文献阅读、论文问答和 Markdown 摘要插件。它把 Zotero 中选中的论文变成一个 Markdown 优先的阅读工作流：生成或更新论文摘要、在论文聊天工作台里继续追问、复制 Markdown 回答、保存会话，并可选地通过本地桥接调用 Gemini / Claude / opencode 命令行工具做交叉建议。

[English README](README.md)

> 当前状态：已经可以用于单篇论文阅读、摘要和图片提问，但仍处于早期版本。多篇论文对比、批量综述等能力还在计划中。

![Zotero 论文聊天工作台](docs/assets/workbench-chat.png)

## 核心特色

- **在 Zotero 内直接读论文和追问**：选中一篇论文后打开工作台，问题、回答和当前条目绑定，不需要在多个窗口之间来回复制。
- **Markdown 原生工作流**：生成本地 Markdown 摘要文件，自动链接回 Zotero；回答可复制为原始 Markdown，也可以预览后写回摘要文件。
- **多模型厂商配置**：同一个设置页中配置 MiniMax、DeepSeek、OpenAI-compatible、Anthropic / Anthropic-compatible、Gemini OpenAI-compatible、OpenRouter、DashScope、SiliconFlow、Ollama、LM Studio 等档案。
- **图片提问入口**：工作台支持粘贴截图、拖入图片或选择本地图片；发送前会检查当前模型档案是否声明支持图片输入。
- **插件完全开源免费**：插件本身不收费；如果使用远程大模型服务，需要自行准备对应厂商的 API key。
- **本地 agent 咨询**：可选连接本机 Gemini、Claude、opencode 命令行工具，让多个本地工具分别给出阅读建议。
- **面向论文阅读的技能模板**：内置深度摘要、方法抽取、实验表格、引用核查、候选论文发现等提示模板。

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
5. 需要询问图表或截图时，可在工作台输入框粘贴截图、拖入图片，或点击 `+` 选择本地图片；图片理解依赖所选模型本身的多模态能力。

生成的 Markdown 文件会保存到设置中的输出目录。默认会按条目创建摘要、会话和候选论文文件，并把摘要文件链接回 Zotero。

## 配置大模型厂商和 API key

打开 `Tools -> Literature Review with LLM 设置`：

![配置模型厂商和 API key](docs/assets/provider-settings.png)

主要字段：

- `默认接口档案`：当前启用的模型档案。
- `Provider`：选择厂商或协议预设，例如 MiniMax、DeepSeek、OpenAI-compatible、Anthropic、Anthropic-compatible、Gemini OpenAI-compatible、OpenRouter、DashScope、SiliconFlow、Ollama、LM Studio、Local Agents 等。
- `Base URL`：接口根地址，例如 `https://api.minimaxi.com/v1`、`https://api.deepseek.com` 或 `http://127.0.0.1:11434/v1`。
- `API Key`：对应厂商的 API key。本地模型服务如 Ollama 可能不需要远程 API key。
- `Model`：使用的模型名称，例如 MiniMax、DeepSeek 或本地模型服务中的模型 id。
- `输入模式`：选择抽取文本输入，或在厂商支持时使用原始 PDF 输入。
- `流式输出`：厂商支持流式响应时可以开启。
- `输出目录`：Markdown 摘要、会话、候选论文和日志的保存目录。

说明：

- MiniMax 是当前包里的默认预设，但仍建议确认模型名和 API key。
- DeepSeek 可使用 OpenAI-compatible 风格的接口配置。
- Anthropic 官方接口使用 `Anthropic` 档案；第三方 Anthropic 风格路由或代理使用 `Anthropic Compatible Messages`，默认走 Bearer auth。
- Gemini 当前通过 OpenAI-compatible endpoint 风格配置。
- Local Agents 走本地 HTTP bridge，不直接调用远程模型 API。
- API keys 存在本机 Zotero 偏好设置中。不要把 `.env` 文件或本地偏好导出提交到仓库。

## 论文聊天工作台

工作台是一个紧凑的论文阅读界面：

- 顶栏显示当前论文、模型档案和设置入口。
- 中间区域渲染 Markdown 回答，支持标题、列表、表格、代码块和轻量公式显示。
- 输入框可以继续围绕当前论文提问。
- 输入框支持粘贴截图、拖入图片和选择本地图片；图片会以当前模型协议支持的格式发送。
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

Release 中上传 XPI 产物，仓库本身不提交构建出的 XPI。

## 当前局限

- 尚未加入多篇论文对比、聚类和综述矩阵生成。
- 已支持单轮图片附件提问，但图表、表格和手写笔记的理解质量取决于模型能力；暂未做专门的图表结构化抽取流程。
- 公式渲染仍是轻量支持，不是完整 TeX 引擎。
- 候选论文发现还是工具级能力，去重、排序和审阅流程需要继续加强。
- 工作台 UI 仍在打磨，部分控件和设置项后续会继续简化。
- 原始 PDF 输入依赖厂商能力，很多厂商仍主要使用 Zotero 抽取文本。
- 本地 agent 调用依赖本机 CLI 工具及其认证状态。
- 真实厂商接口验证需要用户自己的 API key，默认检查不会运行 live 验证。
- 目前主要覆盖 Zotero 9.x。

## TODO

- 加入多篇论文对比、聚类和 literature matrix。
- 增强图片、PDF 图表、表格和实验结果的结构化抽取能力。
- 加强候选论文排序、引用网络扩展和去重。
- 补充更多厂商配置截图和教程。
- 加入自动更新元数据工作流。
- 增加 Zotero 侧边工作台 UI 测试。
- 加入面向不同研究领域的提示模板包。
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
