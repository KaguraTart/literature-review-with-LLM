# literature-review-with-LLM

Zotero 文献阅读、论文问答和 Markdown 摘要插件。它把 Zotero 中选中的论文变成一个 Markdown 优先的阅读工作流：生成或更新论文摘要、在论文聊天工作台里继续追问、复制 Markdown 回答、保存会话，并可选地通过本地桥接调用 Gemini / Claude / opencode 命令行工具做交叉建议。

[English README](README.md)

> 当前状态：已经可以用于单篇论文阅读、摘要、图片提问、可选本地 OCR 图片元数据、图表/截图结构化解析、可复核图表数据草稿、模型估计的像素/坐标数据草稿、工作台内图表复核状态编辑、单篇论文阅读日志导出、带领域化写作清单的开题/课题申报笔记导出、带领域化写作清单的期刊/报告写作提纲导出、正式综述草稿导出、多篇论文对比与 Markdown 文献矩阵报告、证据覆盖图、两两对比、缺口台账、带证据支持综合主张、综合路线图和正式综述报告草稿的集合级主题聚类工作区、带主题桥接板、重复缺口看板和优先级看板的跨集合综合索引/地图，以及可配置的受控引用网络扩展，但仍处于早期版本。更强的跨文献分析仍在继续完善。

![Zotero 论文聊天工作台](docs/assets/workbench-chat.png)

## 核心特色

- **在 Zotero 内直接读论文和追问**：选中一篇论文后打开工作台，问题、回答和当前条目绑定，不需要在多个窗口之间来回复制。
- **Markdown 原生工作流**：生成本地 Markdown 摘要文件，自动链接回 Zotero；回答可复制为原始 Markdown，也可以导出带证据标签的论文阅读日志、带提示模板包写作清单的开题/课题申报笔记和期刊/报告写作提纲、正式综述草稿，或预览后写回摘要文件。
- **多模型厂商配置**：同一个设置页中配置 MiniMax、DeepSeek、OpenAI-compatible Chat、OpenAI-compatible Responses、Anthropic / Anthropic-compatible、Gemini OpenAI-compatible、Azure OpenAI、Vercel AI Gateway、Cloudflare AI、GitHub Models、Hugging Face、DeepInfra、Fireworks AI、Cerebras、NVIDIA NIM、SambaNova、OpenRouter、DashScope、SiliconFlow、Ollama、LM Studio 等档案，并显示内置配置指南和 live-check 命令模板。
- **模型接口诊断**：对 OpenAI-compatible、OpenAI Responses、Anthropic 和常见代理包装响应统一解析文本、流式错误、模型列表和 token usage 元数据，并保存到会话记录；工作台可导出隐藏密钥明文的模型厂商诊断 Markdown，用来排查 endpoint、认证、模型列表、live-check，以及文本/图片/PDF 请求体形态。
- **多篇论文对比与文献矩阵**：多选 Zotero 条目打开工作台时，会把第一篇作为焦点论文，其余论文作为对比上下文；工作台可导出带证据标签的 Markdown 文献矩阵，包含对比表、证据覆盖图、两两对比和缺口台账，内置 `文献矩阵` 技能可继续调用大模型深化分析。
- **集合级综述工作区**：对 collection 批量生成时，会写出 `papers.json`、论文笔记索引、方法矩阵、研究空白矩阵、启发式主题聚类、综合主张矩阵、综合冲突与缺口台账、综合路线图、研究问题卡、研究想法列表、手动综述草稿、正式综述报告草稿，以及全局 `collections/index.json` 和带主题桥接板、重复缺口看板、优先级看板的跨集合综合地图。
- **图片提问与图表解析**：工作台支持粘贴截图、拖入图片或选择本地图片；可选本地 OCR 会先通过本机 bridge 记录识别文本，并可在工作台里复核校正；内置 `图表/截图解析` 技能可把论文图片、表格和实验结果整理成带视觉 OCR 文本、表格/数据重建、密集点位数据草稿、证据映射、复核清单、像素/坐标数据草稿，并可用坐标轴校准锚点线性补全像素点的轴值，生成可在工作台内编辑且重新导出时会保留人工填写状态的图表人工复核任务队列，以及可复用 Markdown + JSON/CSV 导出文件的结构化结果。
- **插件完全开源免费**：插件本身不收费；如果使用远程大模型服务，需要自行准备对应厂商的 API key。
- **本地 agent 咨询**：可选连接本机 Gemini、Claude、opencode 命令行工具，让多个本地工具分别给出阅读建议。
- **面向论文阅读的技能模板**：内置深度摘要、方法抽取、实验表格、图表/截图解析、文献矩阵、引用核查、候选论文发现等提示模板。
- **候选论文审阅队列**：arXiv / Crossref / Semantic Scholar / Unpaywall 的结果会去重、按可解释优先级排序，也可基于 Semantic Scholar references/citations 做可配置的受控扩展，支持保存人工审阅备注、结构化全文筛选阶段、排除理由、审阅状态看板、应用高置信建议、导出带来源证据摘录、命中上下文、匹配到的 Zotero 批注页标签、来自 Zotero 页文本或本地 `pdftotext` bridge 的 PDF 页级文本定位、扫描版 PDF 的受控 OCR fallback、短哈希、降低目录噪声优先级的 indexed-text 证据排序，以及来自分页符或独占行页标记的 best-effort indexed page hints 的 Markdown 审阅报告、写入 JSONL，并且只在人工确认后导入 Zotero。
- **研究领域提示模板包**：可选择通用阅读、AI/ML/系统、交通与城市空域、医学与生命科学、社科与政策、综述写作等模板包；工作台问答、直接生成摘要、开题笔记和期刊/报告提纲都会使用当前模板包。

## 安装

从 GitHub Release 下载最新 XPI：

- [最新 release](https://github.com/KaguraTart/literature-review-with-LLM/releases/latest)
- [literature-review-with-llm.xpi](https://github.com/KaguraTart/literature-review-with-LLM/releases/latest/download/literature-review-with-llm.xpi)

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
5. 需要询问图表或截图时，可在工作台输入框粘贴截图、拖入图片，或点击 `+` 选择本地图片；如果只发送图片，工作台会自动使用默认图片解析问题。图片理解依赖所选模型本身的多模态能力；如果本地 bridge 已运行，也可以开启 `Local OCR` 记录本地 OCR 文本。图表/截图解析回答可导出为 Markdown 报告。

生成的 Markdown 文件会保存到设置中的输出目录。可以在 Zotero 设置页点击 `选择文件夹...` 调用系统文件夹选择器，也可以在工作台设置面板中选择和保存同一个输出目录，不需要手动输入 macOS 或 Windows 路径。默认会按条目创建摘要、会话和候选论文文件，并把摘要文件链接回 Zotero。

## 配置大模型厂商和 API key

打开 `Tools -> Literature Review with LLM 设置`：

![配置模型厂商和 API key](docs/assets/provider-settings.png)

主要字段：

- `默认接口档案`：当前启用的模型档案。
- `Provider`：选择厂商或协议预设，例如 MiniMax、DeepSeek、OpenAI Compatible Chat、OpenAI Compatible Responses、Anthropic、Anthropic-compatible、Gemini OpenAI-compatible、Azure OpenAI、Vercel AI Gateway Chat、Vercel AI Gateway Responses、Vercel AI Gateway Anthropic、Cloudflare AI OpenAI Chat、Cloudflare AI Responses、Cloudflare AI Anthropic、GitHub Models、Hugging Face、DeepInfra、Fireworks AI、Cerebras、NVIDIA NIM、SambaNova、OpenRouter、DashScope、SiliconFlow、Ollama、LM Studio、Local Agents 等。
- `Base URL`：接口根地址，例如 `https://api.minimaxi.com/v1`、`https://api.deepseek.com` 或 `http://127.0.0.1:11434/v1`。
- 如果网关或 Azure 风格接口要求查询参数，`Base URL` 可以保留 `?api-version=preview` 这类参数；插件会先追加 `/chat/completions`、`/responses`、`/messages` 或 `/models`，再保留查询参数。
- `API Key`：对应厂商的 API key。本地模型服务如 Ollama 可能不需要远程 API key。
- `Model`：使用的模型名称，例如 MiniMax、DeepSeek 或本地模型服务中的模型 id。
- `配置指南`：显示当前档案解析后的协议、请求 endpoint、鉴权方式、模型列表地址、输入能力和可复制的终端 live-check 命令，不显示已保存的完整 API key。
- `输入模式`：选择抽取文本输入，或在厂商支持时使用原始 PDF 输入。
- `流式输出`：厂商支持流式响应时可以开启。
- `提示模板包`：选择当前论文所属研究领域，用于调整模型阅读重点。
- `输出目录`：Markdown 摘要、会话、候选论文和日志的保存目录。可点击 `选择文件夹...` 直接选择文件夹，避免手动输入平台路径。

说明：

- MiniMax 是当前包里的默认预设，但仍建议确认模型名和 API key。
- DeepSeek 可使用 OpenAI-compatible Chat 风格的接口配置。
- OpenAI Compatible Chat 默认发送 `max_tokens`，检测到 `o` 系列 reasoning 模型时会改用 `max_completion_tokens`，并默认避开很多 reasoning 路由会拒绝的 `temperature` / `n` 字段；自定义路由可在 `bodyExtra.tokenLimitField` 中显式填写 `max_completion_tokens` 或 `max_tokens`，显式填写的 `bodyExtra.temperature` 或 `bodyExtra.n` 仍会生效。
- OpenAI Compatible Chat 的流式请求会默认发送 `stream_options.include_usage`，方便在厂商返回时保存 token usage 元数据；流式解析同时支持 `choices[].delta` 和 Gemini/常见路由风格的 `candidates[].content.parts[]` 正文片段，并会过滤 reasoning/thinking 片段。
- 如果某些路由或 reasoning 模型拒收默认字段，可在 `bodyExtra.omitFields` 填写要移除的顶层请求字段，例如 `["temperature", "n", "max_tokens"]`，发送前会自动剔除。
- OpenAI-compatible Chat 和 Responses 请求在厂商明确拒收 `stream_options`、JSON mode 格式、token limit 或 `temperature` 等可选字段时，会自动用更窄的请求体重试；常见网关返回的结构化 `param` / `parameters` 错误也会被识别。
- 如果某个厂商或路由提供 `/v1/responses`，选择 `OpenAI Compatible Responses`；这个档案可在模型支持时声明 PDF 原文和图片输入能力。
- Anthropic 官方接口使用 `Anthropic` 档案；第三方 Anthropic 风格路由或代理使用 `Anthropic Compatible Messages`，默认走 Bearer auth。
- Anthropic-compatible 请求在路由明确拒收 `stream`、`metadata`、`thinking`、`top_p`、`top_k`、`stop_sequences`、`tools` 或 `tool_choice` 等可选 body 字段时，也会自动移除后重试。如果路由拒收 `anthropic-version` header，设置页测试、工作台和直接摘要路径都会自动去掉该 header 再试一次；也可以在 `bodyExtra.omitAnthropicVersion` 填 `true` 固定关闭。
- Gemini 当前通过 OpenAI-compatible endpoint 风格配置。
- Vercel AI Gateway 内置三种档案：OpenAI Chat 和 Responses 使用 `https://ai-gateway.vercel.sh/v1`；Anthropic Messages 使用 `https://ai-gateway.vercel.sh`。API key 处填写 AI Gateway API key。Chat 档案在所选网关模型支持时可使用图片输入；Responses 和 Anthropic 档案也允许原始 PDF 输入。
- Cloudflare AI 预设使用 `https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1`；需要把 `YOUR_ACCOUNT_ID` 替换为你的 Cloudflare account ID，API key 处填写 Cloudflare API token。内置三种档案：OpenAI Chat、OpenAI Responses 和 Anthropic-compatible Messages。模型列表、原始图片和 PDF 输入默认关闭，因为实际支持取决于所选 Workers AI 或路由模型。
- GitHub Models 使用 `https://models.github.ai/inference`，不会自动追加 `/v1`，并内置 GitHub API headers；API key 处填写具备 Models 访问权限的 PAT。
- Hugging Face 使用 `https://router.huggingface.co/v1` 的 OpenAI-compatible Chat Completions 路由；API key 处填写 Hugging Face access token。该预设默认开启图片输入声明，但具体能否理解图片取决于所选模型。
- DeepInfra 使用 `https://api.deepinfra.com/v1/openai` 的 OpenAI-compatible Chat Completions 路由；API key 处填写 DeepInfra API key。该预设默认开启图片输入声明，因为 DeepInfra 的视觉/OCR 模型支持 OpenAI 风格图片内容；具体能否理解图片仍取决于所选模型。
- Fireworks AI、Cerebras、NVIDIA NIM、SambaNova 已作为 OpenAI-compatible 命名预设加入；SambaNova 也提供 Responses 和 Anthropic-compatible 预设。
- Local Agents 走本地 HTTP bridge，不直接调用远程模型 API。同一个 bridge 也提供可选本地 OCR 使用的 `ocr_image` 和本地 PDF 页文本抽取使用的 `extract_pdf_pages`，后者可在文本过少时对扫描页做 OCR fallback。
- API keys 存在本机 Zotero 偏好设置中。不要把 `.env` 文件或本地偏好导出提交到仓库。

### 主流接口 live-check 快速配置

在写入 Zotero 设置前，可以先生成一个本地草稿：

```bash
npm run verify:provider:live -- --env-template --dotenv-template --include core > .env.local
```

填好对应变量后，先做一次不触网的配置预检，确认 API key、模型名和 Base URL 没有漏填：

```bash
npm run verify:provider:live -- --doctor --include core --provider-env-file .env.local
```

预检通过后，按实际接口类型运行：

```bash
# OpenAI 官方 Responses 格式
npm run verify:provider:live -- --include openai --provider-env-file .env.local --fail-on-skip

# 通用 OpenAI-compatible Chat 格式
npm run verify:provider:live -- --include openai-compatible --provider-env-file .env.local --fail-on-skip

# 通用 OpenAI-compatible Responses 格式
npm run verify:provider:live -- --include openai-responses-compatible --provider-env-file .env.local --fail-on-skip

# Anthropic 官方 Messages 格式
npm run verify:provider:live -- --include anthropic --provider-env-file .env.local --fail-on-skip

# 通用 Anthropic-compatible Messages 格式
npm run verify:provider:live -- --include anthropic-compatible --provider-env-file .env.local --fail-on-skip
```

本地 OpenAI-compatible 运行时可用 `--include local` 检查，并填写 `OLLAMA_MODEL` / `OLLAMA_BASE_URL` 或 `LM_STUDIO_MODEL` / `LM_STUDIO_BASE_URL`；除非本地网关要求鉴权，API key 可以留空。

## 论文聊天工作台

工作台是一个紧凑的论文阅读界面：

- 顶栏显示当前论文、模型档案和设置入口。
- 中间区域渲染 Markdown 回答，支持标题、列表、表格、代码块和轻量公式显示。
- 输入框可以继续围绕当前论文提问。
- 输入框支持粘贴截图、拖入图片和选择本地图片；图片会以当前模型协议支持的格式发送。只贴图片直接发送时，会自动请求模型解析图片。开启 `Local OCR` 后，本地 bridge 可把可编辑 OCR 元数据写入会话和图表解析报告。最近一次图表/截图解析回答可从会话与文件面板导出。
- 回答可以复制为 Markdown，也可以预览后写回摘要。
- 设置面板可调整模型、咨询模式、论文元信息，导出隐藏密钥明文的模型厂商诊断报告，并管理会话、阅读日志/综述草稿导出和候选论文工具。

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

可选本地 OCR 和 PDF 页文本抽取：

- bridge 暴露 `ocr_image` 工具，默认 OCR 命令是 `/opt/homebrew/bin/tesseract`，默认 OCR 语言是 `eng`。
- 启动服务前可用 `LOCAL_AGENT_TESSERACT_BIN=/path/to/tesseract` 覆盖 OCR 命令，用 `LOCAL_AGENT_TESSERACT_LANG=eng+chi_sim` 覆盖服务默认语言；工作台设置面板也可以修改本地 OCR endpoint、工具名和单次请求语言。中文 OCR 需要本机已安装对应 Tesseract 语言包。
- 在工作台设置面板启用 `Local OCR` 后，图片提问会先尝试记录本地 OCR 文本；OCR 失败只会写入本机会话元数据，不会阻断远程模型请求。
- 同一个 bridge 也暴露 `extract_pdf_pages` 工具，用于对本地 PDF 文件或内存中的 PDF 字节做 best-effort 页级文本抽取。默认文本抽取命令是 `/opt/homebrew/bin/pdftotext`，启动服务前可用 `LOCAL_AGENT_PDFTOTEXT_BIN=/path/to/pdftotext` 覆盖；当抽取文本过少且调用方启用 OCR fallback 时，bridge 会用 `/opt/homebrew/bin/pdftoppm` 渲染有限页数，再用 Tesseract OCR。渲染命令可用 `LOCAL_AGENT_PDFTOPPM_BIN=/path/to/pdftoppm` 覆盖。返回 JSON 会包含 `quality` 对象，记录文本长度、可读页数、空页数、是否使用 OCR fallback，以及 `ocr_fallback_used`、`sparse_text` 等告警。

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
npm run verify:provider:live -- --list
npm run verify:provider:live -- --list --include mainstream
npm run verify:provider:live -- --include core --provider-env-file .env.local --fail-on-skip
npm run verify:provider:live -- --include openai-chat --stream --provider-env-file .env.local
npm run verify:provider:models:live -- --include anthropic-messages --provider-env-file .env.local
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

如果你配置的路由支持某项输入能力，但内置默认档案没有打开，可以用每个 case 对应的能力覆盖变量。例如某个 Anthropic-compatible 路由支持 PDF document 输入，可以这样检查：

```bash
ANTHROPIC_COMPATIBLE_CAPABILITIES_JSON='{"pdfBase64":true}' npm run verify:provider:pdf:live -- --include anthropic-compatible
```

如果某个兼容路由支持图片但默认档案没有打开，可使用图片 live 检查并临时开启能力，例如：`ANTHROPIC_COMPATIBLE_CAPABILITIES_JSON='{"imageBase64":true}' npm run verify:provider:image:live -- --include anthropic-compatible`。

临时检查也可以用全局参数：`--capabilities-json '{"pdfBase64":true}'` 或 `--capabilities-json '{"imageBase64":true}'`。

命名厂商的 live 检查使用各自的环境变量：

```bash
MINIMAX_API_KEY=... MINIMAX_MODEL=... npm run verify:provider:live -- --include minimax
GEMINI_API_KEY=... GEMINI_MODEL=... npm run verify:provider:live -- --include gemini
AZURE_OPENAI_API_KEY=... AZURE_OPENAI_MODEL=... AZURE_OPENAI_BASE_URL=... npm run verify:provider:live -- --include azure-openai
VERCEL_AI_API_KEY=... VERCEL_AI_MODEL=... npm run verify:provider:live -- --include vercel-ai-chat
VERCEL_AI_RESPONSES_API_KEY=... VERCEL_AI_RESPONSES_MODEL=... npm run verify:provider:live -- --include vercel-ai-responses
VERCEL_AI_ANTHROPIC_API_KEY=... VERCEL_AI_ANTHROPIC_MODEL=... npm run verify:provider:live -- --include vercel-ai-anthropic
CLOUDFLARE_API_KEY=... CLOUDFLARE_MODEL=... CLOUDFLARE_BASE_URL=https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1 npm run verify:provider:live -- --include cloudflare-ai-chat
CLOUDFLARE_RESPONSES_API_KEY=... CLOUDFLARE_RESPONSES_MODEL=... CLOUDFLARE_RESPONSES_BASE_URL=https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1 npm run verify:provider:live -- --include cloudflare-ai-responses
CLOUDFLARE_ANTHROPIC_API_KEY=... CLOUDFLARE_ANTHROPIC_MODEL=... CLOUDFLARE_ANTHROPIC_BASE_URL=https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1 npm run verify:provider:live -- --include cloudflare-ai-anthropic
GITHUB_MODELS_API_KEY=... GITHUB_MODELS_MODEL=... npm run verify:provider:live -- --include github-models
HUGGINGFACE_API_KEY=... HUGGINGFACE_MODEL=... npm run verify:provider:live -- --include huggingface
DEEPINFRA_API_KEY=... DEEPINFRA_MODEL=... npm run verify:provider:live -- --include deepinfra
FIREWORKS_API_KEY=... FIREWORKS_MODEL=... npm run verify:provider:live -- --include fireworks
CEREBRAS_API_KEY=... CEREBRAS_MODEL=... npm run verify:provider:live -- --include cerebras
NVIDIA_NIM_API_KEY=... NVIDIA_NIM_MODEL=... npm run verify:provider:live -- --include nvidia-nim
SAMBANOVA_API_KEY=... SAMBANOVA_MODEL=... npm run verify:provider:live -- --include sambanova
SAMBANOVA_RESPONSES_API_KEY=... SAMBANOVA_RESPONSES_MODEL=... npm run verify:provider:live -- --include sambanova-responses
SAMBANOVA_ANTHROPIC_API_KEY=... SAMBANOVA_ANTHROPIC_MODEL=... npm run verify:provider:live -- --include sambanova-anthropic
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=... npm run verify:provider:live -- --include deepseek
OPENROUTER_API_KEY=... OPENROUTER_MODEL=... npm run verify:provider:live -- --include openrouter
GROQ_API_KEY=... GROQ_MODEL=... npm run verify:provider:live -- --include groq
MISTRAL_API_KEY=... MISTRAL_MODEL=... npm run verify:provider:live -- --include mistral
DASHSCOPE_API_KEY=... DASHSCOPE_MODEL=... npm run verify:provider:live -- --include dashscope
SILICONFLOW_API_KEY=... SILICONFLOW_MODEL=... npm run verify:provider:live -- --include siliconflow
OLLAMA_MODEL=llama3.1 OLLAMA_BASE_URL=http://localhost:11434/v1 npm run verify:provider:live -- --include ollama
LM_STUDIO_MODEL=local-model LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1 npm run verify:provider:live -- --include lm-studio
```

同样的命名规则也适用于 `XAI_*`、`TOGETHER_*`、`KIMI_*`、`PERPLEXITY_*`、`DEEPSEEK_ANTHROPIC_*`、`ZAI_ANTHROPIC_*`、`ZHIPU_*`、`VOLCENGINE_*`、`QIANFAN_*`、`HUNYUAN_*`、`HUGGINGFACE_*`、`DEEPINFRA_*`、`VERCEL_AI_*`、`VERCEL_AI_RESPONSES_*`、`VERCEL_AI_ANTHROPIC_*`、`CLOUDFLARE_*`、`CLOUDFLARE_RESPONSES_*` 和 `CLOUDFLARE_ANTHROPIC_*`。远程命名厂商只有覆盖内置 endpoint 或使用代理时，才需要额外设置对应的 `*_BASE_URL`。Ollama、LM Studio 这类本地 provider 的 live 检查会显式要求 `*_BASE_URL`，这样在没有环境变量时不会误打到本机端口；API key 默认可选，除非你的本地服务要求鉴权。

运行 `npm run verify:provider:live -- --list --json` 可以直接列出全部 live-check case、协议、profile id 和对应环境变量名。

`--include` 支持填写 case id，也支持填写验证 group。内置 group 包括：`core`（基础 OpenAI / OpenAI-compatible / Anthropic）、`openai-chat`、`openai-responses`、`anthropic-messages`、`mainstream`、`remote`、`local` 和 `all`。`mainstream` 是覆盖设置页当前全部内置 provider case 的宽口径首轮检查组；如果只想跑最小协议族 smoke set，请使用 `core`。如果 group 名和 case id 可能冲突，会优先按 case id 处理，所以 `--include anthropic` 只检查官方 Anthropic；要检查整个 Anthropic Messages 协议族，请使用 `--include anthropic-messages`。
`--include` 同时接受 hyphen 和 underscore 写法，例如 `openai-compatible`、`openai_compatible`、`anthropic-messages`、`anthropic_messages` 会解析到同一组规范 live-check selector。

运行 `npm run verify:provider:live -- --doctor --include core --provider-env-file .env.local` 可以只检查本地配置完整性，不会调用远程接口。输出会列出每个 case 的缺失环境变量、解析后的 endpoint、模型来源、鉴权状态、输入能力和下一步可复制命令；API key 只显示是否已配置，不会打印明文。doctor 模式下即使指定的 env 文件还没创建，也会把它作为 warning 继续诊断，方便先看到必须填写的变量；真正的 live 检查仍要求指定的 env 文件存在。

运行 `npm run verify:provider:live -- --env-template --include openai-compatible` 可以打印选中 live-check case 的可复制环境变量模板，并带上默认 endpoint 提示；加 `--dotenv-template` 可以生成普通 `.env.local` 草稿，例如 `npm run verify:provider:live -- --env-template --dotenv-template --include core > .env.local`。如果要写进 CI secrets 或本地 shell 脚本，可以再加 `--json` 输出结构化模板。Zotero 设置页指南和导出的厂商诊断报告也会显示同一条模板命令。

live 检查也可以读取不提交到仓库的本地 env 文件：

```bash
npm run verify:provider:live -- --include openai-compatible --provider-env-file .env.local
```

`--provider-env-file` 读取 `KEY=value` 行，也支持可选的 `export KEY=value`；它只补充缺失或空值，当前 shell 里已经存在的环境变量优先。`--env-file` 仍作为兼容别名保留，但建议使用较长的参数名，避免和较新 Node.js CLI 选项冲突。

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

- 多篇论文对比目前限制在工作台上下文内，默认最多纳入 5 篇对比论文，并已支持导出包含证据覆盖、两两对比和缺口台账的 Markdown 文献矩阵；collection 批量生成已加入启发式主题聚类、有证据来源的综合主张矩阵、综合冲突与缺口台账、综合路线图、正式综述报告草稿，以及带主题桥接板、重复缺口看板和优先级看板的跨集合综合地图，但聚类和矩阵综合都是确定性规则，报告在正式写作前仍需要人工复核。
- 已支持单轮图片附件提问和 `图表/截图解析` 技能，并加入可复核校正的本地 OCR 元数据、结构化视觉 OCR / 表格重建输出契约、最近一次图表解析回答的 Markdown 导出报告、从重建 Markdown 表格解析出的 JSON/CSV sidecar、从表格/OCR/文本抽取的低置信图表数据草稿、从专门图表表格识别出的密集点位数据草稿、从模型回答中抽取的像素/坐标数据草稿、显式坐标轴校准锚点导出、有足够锚点时对像素点做线性轴值补全、针对坐标轴校准/校准锚点质量/置信度/证据标签/点位覆盖的自动质量审阅，以及带默认 `todo` 状态、复核人/期限/备注工作台编辑、完成条件和重新导出状态保留能力的图表复核任务队列；图表、表格和手写笔记的理解质量仍取决于模型能力和本地 OCR 语言包，密集点位、像素坐标、校准锚点和补全轴值都是可复核草稿，不是精确自动数字化结果。
- 公式渲染仍是轻量支持，不是完整 TeX 引擎。
- 论文阅读日志和正式综述草稿目前是带证据摘录和人工填写字段的结构化 Markdown 草稿，仍需要人工编辑后才能作为完整长篇综述使用。
- 候选论文发现已加入可解释排序、重复项协调、可配置的受控引用网络扩展、人工审阅备注、结构化全文筛选阶段、排除理由、高置信建议应用、审阅状态看板、证据链复核队列、来源证据摘录、已导入且附加 PDF 候选项的 Zotero 全文索引证据摘录（含命中上下文、匹配到的批注页标签、来自已有页文本、本地文件路径或内存 PDF 字节的 PDF 页级文本定位、扫描版 PDF 的受控 OCR fallback 与结构化抽取质量诊断、indexed-text 定位、重复页眉/页脚清理、目录/参考文献噪声降权、简单断词恢复、分页符或 `Page 12` 这类独占页标记存在时的 best-effort 页提示和短哈希）和 Markdown 候选审阅报告。bridge 页文本抽取仍依赖可访问的 PDF 字节以及本机 Poppler/Tesseract 工具；整篇扫描件 OCR、PDF 字节不可访问的场景还需要继续加强。
- 工作台 UI 仍在打磨，部分控件和设置项后续会继续简化。
- 原始 PDF 输入依赖厂商能力，很多厂商仍主要使用 Zotero 抽取文本。
- 本地 agent 调用依赖本机 CLI 工具及其认证状态。
- 真实厂商接口验证需要用户自己的 API key，默认检查不会运行 live 验证。
- 目前主要覆盖 Zotero 9.x。

## TODO

- 完善跨集合聚类，并继续精修全局综合地图、重复缺口看板、优先级看板、集合级综合主张、综合路线图和报告生成。
- 在当前可复核校正的本地 OCR、提示词级视觉 OCR 契约、JSON/CSV 表格 sidecar 导出、可复核图表数据草稿、密集点位数据草稿解析、模型估计像素/坐标草稿、坐标轴校准锚点导出、线性轴值补全、校准质量诊断、自动质量审阅、可跨重新导出保留状态的图表复核任务队列和工作台内复核状态编辑基础上，继续增强非线性/分段坐标轴的稳健数字化，以及更批量化的复核流程。
- 在当前 Zotero 页文本、本地路径/base64 bridge、受控 OCR fallback 和结构化抽取质量诊断基础上，继续增强整篇扫描件 OCR、PDF 字节不可访问场景、更细的 OCR 置信度信号和无 bridge 原始字节抽取。
- 在内置配置指南之外，继续补充更多厂商配置截图和教程。
- 在当前按提示模板包生成的开题/课题申报笔记和期刊/报告提纲写作清单基础上，继续补充更深入的领域化写作格式。

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
