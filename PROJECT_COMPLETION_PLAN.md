# Zotero Markdown Summary 完整项目总计划

## 完成定义

这个插件的完成目标是把 Zotero 里的单篇论文阅读、总结、追问、技能化分析、Markdown 文档维护和批量处理做成一个稳定的本地工作流。用户不需要离开 Zotero 主界面，就能选择论文、配置模型接口、读取 PDF 上下文、与大模型对话、运行总结技能，并把确认后的结果写入对应 Markdown 总结文档。

完整成品必须满足以下条件：

- 聊天工作台嵌入 Zotero 右侧栏，不依赖独立弹窗完成主要操作。
- 顶部 logo、右侧栏入口、条目右键菜单、工具菜单都能打开相关功能。
- UI 语言自动跟随 Zotero。中文界面显示中文，其他语言显示英文，并允许手动覆盖。
- 模型接口可自由配置，支持多个档案、不同协议、完整 URL 模式、自定义 header、额外请求体、连接测试和能力声明。
- 单篇论文上下文只发送必要内容，包括元数据、摘要、相关全文片段、注释、已有 Markdown 摘要和近期对话。
- 总结技能可查看、增加、修改、重置，用户自定义模板优先于内置模板。
- 聊天结果和技能输出能通过预览、备份、确认写入 Markdown 总结文档。
- Markdown 阅读器内置在插件工作流中，支持阅读本地总结文档和从工作台跳转。
- 批量生成摘要时自动跳过没有 PDF 的条目，不弹窗打断。
- 所有写文件操作有明确路径、备份或错误回滚，不静默改写整篇文档。

## 模块清单

### Zotero 主界面集成

- 顶部工具栏 logo：点击打开当前条目的聊天工作台，下拉菜单提供生成、更新、批量处理、阅读器和设置入口。
- 右侧栏入口：在 Zotero 右侧 pane 的侧边按钮区域注入工作台入口，点击后在右侧内容区打开聊天面板。
- 条目右键菜单：对选中条目提供打开工作台、生成总结、更新总结、打开总结、打开 Markdown 阅读器。
- 工具菜单：提供当前选择、当前列表和设置相关操作；没有菜单上下文时回退到 Zotero 当前选中条目，避免已选中条目但入口不可用。
- 打开工作台支持父条目、父条目下的附件、顶层 PDF 附件；生成摘要和批量处理仍限制为 regular item，避免误把普通附件纳入批量生成。
- 主窗口卸载时清理按钮、右侧面板、事件监听和临时样式。

### 聊天工作台

- 工作台以内嵌面板为主，窗口模式只作为阅读器或兼容备用。
- 内嵌面板优先使用 Zotero 主 pane stack 的固定右侧覆盖层；按宿主类型创建元素，HTML pane 使用 HTML section/iframe，XUL pane 使用 XUL 容器；嵌入失败时自动退回独立工作台窗口。
- 支持当前条目绑定、论文元数据展示、接口档案选择、skill 选择、会话列表、发送、停止、复制、保存、写入总结。
- 工作台会阻止一次模型请求未完成时重复发送，避免第二次点击覆盖当前 abort controller，保证停止按钮仍指向正在运行的请求。
- 工作台按钮和初始化由脚本统一绑定，不依赖 XUL 内联事件，避免 Zotero chrome 环境中页面可见但点击无响应。
- 输入区在点击、指针按下和嵌入 frame 加载后都会显式聚焦，并支持 `Ctrl/Command+Enter` 发送，减少右侧 iframe 内看得到但难以输入的问题。
- 内嵌工作台默认只呈现聊天主界面：顶部轻量标题、当前模型入口、设置按钮、消息区和输入框；接口档案、skill、会话与候选论文等配置统一收进设置抽屉，避免右侧面板第一屏被表单挤满。
- 聊天输出按流式 Markdown 渲染，支持标题、列表、表格、代码块、引用、链接和 `$...$` / `$$...$$` / `\\(...\\)` / `\\[...\\]` 公式节点显示。
- 顶部工具栏入口同时监听 `command` 和普通点击事件，降低不同 Zotero 版本中 menu-button 点击不触发工作台的风险。
- 支持流式输出和非流式输出。
- 会话按条目 key 保存为 JSONL。
- 对话上下文包括近期消息和相关论文片段，不默认上传整篇全文。
- 错误信息脱敏，不泄露 API Key 或 Authorization。

### 模型接口配置

- ProviderProfile 字段包括 id、name、protocol、endpointMode、baseURL、fullURL、apiKey、model、capabilities、customHeaders、bodyExtra、isDefault。
- 支持兼容聊天接口、Responses 接口、Anthropic Messages。
- 支持 base URL 拼接和 full URL 直连。
- base URL 模式会自动归一化用户粘贴的完整调用地址，避免重复拼接 `/chat/completions`、`/responses` 或 `/messages`。
- 支持连接测试、默认档案候选列表切换、从简化字段同步到 JSON 档案。
- 设置页加载模型列表时支持有限分页游标，避免 OpenAI/Anthropic 兼容接口只返回第一页导致模型选择不完整。
- 设置页展示当前档案的协议、模型、Endpoint、PDF/stream 能力、鉴权和本地代理状态，避免保存前误判接口可用性。
- 连接测试和模型列表只使用当前编辑档案；高级 JSON 无效时直接停止，不回退到旧档案造成误判。
- 导入或手工修改 ProviderProfile JSON 后会规范化 id、protocol、endpointMode、capabilities、customHeaders 和 bodyExtra，避免坏字段直接进入实际请求。
- PDF/base64 输入只在档案显式声明支持且协议允许时启用；聊天工作台和批量生成使用同一条能力边界，避免兼容聊天接口误直传 PDF。
- 顶部菜单、右键菜单和批量生成使用同一套规范化后的活动档案；Local Agents 档案可通过 MCP `tools/call` 调用本机代理生成摘要，不强制填写远程模型名。
- 主入口鉴权检查会直接识别 Local Agents 的 MCP endpoint；即使 baseURL 只是兼容占位地址，也不会误判为缺少远程 API Key。
- 自定义鉴权 header 只有在存在非空值时才覆盖 API Key；空 `Authorization`、`api-key` 或 `x-api-key` 会被默认鉴权覆盖，不会形成重复或空鉴权头。
- Anthropic Messages 会按档案或 baseURL 选择鉴权 header；官方 Anthropic 默认使用 `x-api-key`，DeepSeek Anthropic 与 Z.AI Anthropic 默认使用 `Authorization: Bearer`，仍允许通过高级配置覆盖。
- Local Agents 深度检查区分 MCP 初始化、工具注册、CLI 版本、实际烟测、额度错误和网络错误，避免把外部服务问题误判为桥接未安装。
- Local Agents 健康检查只传递健康检查参数，不混入论文 prompt 或 cwd；默认检查超时为 30 秒，并允许通过配置限定 Gemini、Claude 或 opencode。
- Local Agents 服务诊断支持 `--agents` 过滤，可在 opencode 额度不足时单独确认 Gemini 和 Claude 通道可用。
- 设置页的 Local Agents 连接测试会在 MCP initialize 后继续检查 `tools/list`，确认 `ask_gemini`、`ask_claude`、`ask_opencode`、`ask_all_agents` 和 `check_local_agents` 已注册，避免只连通服务但 skill 不可调用。
- Local Agents 技能默认不自动退回远程模型，只有显式配置 `fallbackToRemote` 时才允许 fallback，避免掩盖本机代理真实错误。
- Local Agents 默认档案显式映射 `ask-gemini`、`ask-claude`、`ask-opencode`、`ask-all-agents`、`ask-gemini-claude` 和 `check-local-agents`，设置页和工作台都能直接作为技能调用；其中 `ask-gemini-claude` 用 `agents: ["gemini", "claude"]` 在 Opencode 不可用时保留双模型交叉复核。
- Local Agents 聚合调用按顺序执行被选择的本机代理，并按总超时分配每个代理的预算；允许部分代理失败并返回成功代理的结果，当所有被选择的代理都失败时必须返回 MCP error，避免工作台把纯错误内容当成有效回答。
- Bootstrap 旧偏好 fallback 在 `profilesJson` 损坏或缺失时仍保留主流 provider 默认 endpoint，并为 Local Agents 注入同一套 MCP skill 映射，避免生成入口退化成远程兼容接口。
- 支持流式解析、错误重试、错误脱敏；401/400 等不可重试 provider 错误直接失败，只有 429、5xx 和网络类错误进入退避重试。
- OpenAI Responses 流式解析支持 delta 优先和 done/completed 快照兜底，避免标准流末尾重复写入正文。
- 默认档案覆盖 OpenAI Responses、OpenAI-compatible Chat、Anthropic Messages、Gemini OpenAI-compatible、Azure OpenAI、xAI、Groq、Mistral、Together AI、Kimi/Moonshot、Perplexity Sonar、DeepSeek、DeepSeek Anthropic、Z.AI Anthropic、OpenRouter、Qwen/DashScope、SiliconFlow、Zhipu/GLM、Volcengine Ark/Doubao、Baidu Qianfan、Tencent Hunyuan、Ollama、LM Studio、MiniMax 和 Local Agents。
- 默认 provider catalog 可离线验收生成 endpoint、鉴权 header、模型列表能力和请求体形状，避免主流 API 档案在没有真实 key 时悄悄漂移。

### 论文上下文

- 读取 Zotero 条目的题名、作者、年份、DOI、摘要、PDF 全文索引、注释和已有 Markdown 总结。
- 将全文切为稳定 chunk，每个 chunk 带 chunkId、locator、sourceType、sourceHash。
- 根据用户问题和 skill 目标选择相关片段。
- 对缺少 PDF、缺少全文索引、附件路径不可用等情况给出明确状态。

### 总结技能

- 内置技能：单篇深度总结、方法抽取、实验表格、证据检查、自定义总结。
- 首次使用时复制模板到 `outputDir/skills/`。
- 本地模板优先于内置模板。
- 设置页支持加载、保存、重置 skill 模板。
- 自定义总结 skill 使用设置页保存的总结提示词。
- 每个技能输出都要求证据标记和低置信度声明。

### Markdown 总结文档

- 生成文档时写入 frontmatter，记录条目 key、PDF key、sourceHash、summaryVersion、inputMode、outputLanguage、provider、model、生成时间。
- 写回支持替换章节、追加到章节、追加到聊天摘录。
- 写回前生成 diff 预览。
- 确认写回前强制创建 `.bak` 备份。
- 写回后更新 lastEditedAt、lastEditSource、chatSessionId、skillId、editCount。
- 保留原 frontmatter 和标题层级，不破坏已有手写内容。

### Markdown 阅读器

- 内置 Markdown 阅读界面，支持标题、正文、表格、代码块、引用、列表的基础渲染。
- 支持打开当前条目的总结附件或任意 Markdown 附件。
- 支持从聊天工作台打开当前总结文档。
- 支持复制原文和打开本地文件。
- 支持内嵌阅读器返回聊天工作台。

### 批量处理

- 支持为选中条目生成摘要。
- 支持为当前列表全部条目生成摘要。
- 支持更新当前列表全部摘要。
- 没有 PDF 的条目自动跳过，不弹窗打断。
- 完成后只显示汇总：成功、跳过、失败。
- 批量过程不能因单个条目失败中断全部任务。

### 双语 UI

- UiLanguage 支持 auto、zh-CN、en-US。
- auto 下读取 Zotero/runtime locale，zh 开头显示中文，否则显示英文。
- 菜单、设置页、工作台、阅读器、错误提示、skill 名称和描述都走统一字典。
- UI 语言与总结输出语言分离。
- OutputLanguage 支持 zh-CN、en-US、ja-JP。

## 执行顺序

1. 固化完整项目计划和验收标准。
2. 稳定 Zotero 主界面入口，增加右侧栏入口，保留顶部 logo 和菜单入口。
3. 稳定内嵌聊天工作台启动链路，确保 itemID、itemKey、embedded 参数都可用。
4. 补齐工作台的模型请求能力，统一使用 ProviderProfile。
5. 补齐论文上下文构建，把注释和已有 Markdown 总结纳入上下文。
6. 完善 skill 模板管理，支持用户新增自定义 skill。
7. 完善 Markdown 写回预览、备份、确认、回滚边界。
8. 完善 Markdown 阅读器入口和渲染能力。
9. 完善批量处理状态、跳过逻辑和结果汇总。
10. 补齐 locale 字典完整性和 UI 语言自动切换测试。
11. 补齐 provider、context、skills、markdown、locale 单元测试。
12. 构建 XPI，安装到本地 Zotero profile，重启 Zotero 后做手动验证。

## 验收标准

- `npm test` 通过。
- `npm run build` 通过。
- `unzip -t build/zotero-markdown-summary.xpi` 通过。
- `npm run verify:package` 通过，确认 XPI 内含顶部入口、右侧栏入口、内嵌工作台、内嵌阅读器、写回和接口档案编辑器资源。
- Zotero 已运行时，`npm run verify:zotero-runtime` 通过，确认扩展处于 active 状态、本机 Connector 可访问、本地只读 item API 可访问。
- `npm run readiness:check` 通过，确认 provider、local agents、候选论文、集合工作区、写回和打包资源关键链路未断开。
- `npm run verify:provider:live -- --json` 在未配置环境变量时安全跳过；配置 `OPENAI_API_KEY` / `OPENAI_MODEL`、`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` 或 `OPENAI_COMPATIBLE_*` 后可对真实 provider 执行端到端请求验收；当 `OPENAI_COMPATIBLE_BASE_URL` 指向本地 endpoint 时，`OPENAI_COMPATIBLE_API_KEY` 可省略。
- `npm run verify:provider:catalog` 通过，确认默认 provider 档案的 endpoint、鉴权 header、模型列表能力和 OpenAI/Anthropic 请求体结构可离线验收，且不会输出占位密钥。
- `npm run verify:provider:models:mock` 通过，确认 OpenAI-compatible、OpenAI Responses 与 Anthropic Messages 的模型列表 endpoint、鉴权 header、分页游标和模型名解析可用；配置真实 key 时可用 `npm run verify:provider:models -- --profile ... --api-key-env ...` 验收实际 provider。
- `npm run verify:provider:models:live -- --json` 在未配置环境变量时安全跳过；配置 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 或 `OPENAI_COMPATIBLE_*` 后可对真实 provider 的模型列表 endpoint 执行端到端验收，且模型列表验收不要求预先填写模型名。
- `npm run verify:provider -- --profile openai-compatible --base-url http://127.0.0.1:11434/v1 --model <local-model> --dry-run --json` 不要求 API key；远程 endpoint 仍必须配置 API key 或显式鉴权 header。
- `npm run verify:writeback` 通过，确认真实临时文件系统上的写入预览、备份、原子写入、过期预览拒绝和失败回滚边界。
- `git diff --check` 通过。
- Zotero 中文界面显示中文 UI，非中文界面显示英文 UI。
- 选中带 PDF 的条目后，顶部 logo 和右侧栏入口都能打开内嵌聊天工作台。
- 工作台能读取当前论文上下文并连续追问。
- 设置页能新增或修改总结提示词和 skill 模板，并能从默认档案候选列表直接选择主流 API 或 Local Agents 档案。
- 运行任一 skill 后可以把回答预览写入 Markdown 总结文档。
- 写入前生成备份，写入失败时原文不变。
- 当前列表批量总结能跳过无 PDF 条目并给出汇总。
- Markdown 阅读器能打开当前条目的总结文档。
