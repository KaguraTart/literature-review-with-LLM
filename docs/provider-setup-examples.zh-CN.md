# 大模型厂商配置示例

本页给出 `Literature Review with LLM` 的常见厂商配置示例。对应入口是：

`Tools -> Literature Review with LLM 设置`

示例里的 API key 都是占位符。真实 key 请保存在 Zotero 设置或本地未提交的 `.env.local` 文件中。

## 快速选择

| 需求 | 推荐档案 | 说明 |
| --- | --- | --- |
| 中英文论文阅读和摘要 | `MiniMax` 或 `DeepSeek` | 使用内置 OpenAI-compatible Chat 预设和模型下拉框。 |
| 使用 Google Gemini endpoint | `Gemini OpenAI Compatible` | 图片理解取决于所选模型。 |
| 通过聚合路由选择多个模型厂商 | `OpenRouter`、`Cline API` 或 `Vercel AI Gateway` | 先选路由，再选 `模型厂商` 和具体模型。 |
| 本机模型推理 | `Ollama` 或 `LM Studio` | 先启动本地服务，再点 `保存并测试`；通常不需要 API key。 |
| 调用本机辅助 agent | `Local Agents` | 先启动本地 bridge，并运行 service check。 |

## MiniMax、DeepSeek、Gemini

![OpenAI-compatible 配置卡片](assets/provider-card-openai-compatible.svg)

### MiniMax

1. 选择 `Provider -> MiniMax`。
2. `Base URL` 保持 `https://api.minimaxi.com/v1`，除非你使用代理。
3. 在 `API Key` 粘贴 `MINIMAX_API_KEY`。
4. 从模型下拉框选择 `MiniMax-M3` 或其他推荐 MiniMax 模型。
5. 点击 `保存并测试`。

本地 live check：

```bash
MINIMAX_API_KEY= \
MINIMAX_MODEL=MiniMax-M3 \
npm run verify:provider:live -- --include minimax --fail-on-skip
```

### DeepSeek

1. 选择 `Provider -> DeepSeek`。
2. `Base URL` 保持 `https://api.deepseek.com`，除非你使用代理。
3. 在 `API Key` 粘贴 `DEEPSEEK_API_KEY`。
4. 快速阅读可先选 `deepseek-v4-flash`，也可以从下拉框选择其他 DeepSeek 模型。
5. 点击 `保存并测试`。

本地 live check：

```bash
DEEPSEEK_API_KEY= \
DEEPSEEK_MODEL=deepseek-v4-flash \
npm run verify:provider:live -- --include deepseek --fail-on-skip
```

### Gemini OpenAI-compatible

1. 选择 `Provider -> Gemini OpenAI Compatible`。
2. 如果没有组织网关，保持默认 Gemini OpenAI-compatible Base URL。
3. 在 `API Key` 粘贴 `GEMINI_API_KEY`。
4. 从模型下拉框选择 Gemini 模型。
5. 点击 `保存并测试`。

本地 live check：

```bash
GEMINI_API_KEY= \
GEMINI_MODEL= \
npm run verify:provider:live -- --include gemini --fail-on-skip
```

## 聚合路由

![聚合路由配置卡片](assets/provider-card-aggregators.svg)

### OpenRouter

1. 选择 `Provider -> OpenRouter`。
2. `Base URL` 保持 `https://openrouter.ai/api/v1`。
3. 在 `API Key` 粘贴 `OPENROUTER_API_KEY`。
4. 先用 `模型厂商` 缩小范围，再选择具体路由模型。
5. 点击 `保存并测试`。

如果 OpenRouter 账号要求请求来源 header，可在高级设置的 `Custom headers JSON` 填写，例如：

```json
{
  "HTTP-Referer": "https://example.org",
  "X-Title": "Literature Review with LLM"
}
```

### Cline API

1. 选择 `Provider -> Cline API`。
2. `Base URL` 保持 `https://api.cline.bot/api/v1`。
3. 在 `API Key` 粘贴 `CLINE_API_KEY`。
4. 从模型下拉框选择 `provider/model` 路由 ID。
5. 每次切换路由模型后都点一次 `保存并测试`。

### Vercel AI Gateway

按需要选择对应协议预设：

- `Vercel AI Gateway Chat`：通用 OpenAI-compatible Chat 路由。
- `Vercel AI Gateway Responses`：需要 Responses 风格图片或 PDF 输入时使用，前提是路由模型本身支持。
- `Vercel AI Gateway Anthropic`：用于 Anthropic Messages 风格路由模型。

在 `API Key` 填 AI Gateway key，再从下拉框选择路由模型。

## 本地档案

![本地 provider 配置卡片](assets/provider-card-local.svg)

### Ollama

1. 先启动 Ollama，并确认本地模型已经拉取。
2. 选择 `Provider -> Ollama`。
3. `Base URL` 保持 `http://localhost:11434/v1`。
4. `API Key` 通常留空，除非你的本地代理要求鉴权。
5. 输入或选择本地模型 id，再点击 `保存并测试`。

本地 live check：

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1 \
OLLAMA_MODEL=llama3.2 \
npm run verify:provider:live -- --include ollama --fail-on-skip
```

### LM Studio

1. 先启动 LM Studio 的 OpenAI-compatible local server。
2. 选择 `Provider -> LM Studio`。
3. `Base URL` 保持 `http://127.0.0.1:1234/v1`。
4. `API Key` 通常留空，除非本地服务要求鉴权。
5. 输入已经加载的本地模型 id，再点击 `保存并测试`。

### Local Agents

这个档案用于通过本地 bridge 调用 Gemini、Claude 或 opencode 命令行工具。

```bash
npm run local-agent:service:check
```

如果服务没有安装或未运行：

```bash
npm run local-agent:service:install
npm run local-agent:service:start
npm run local-agent:service:check
```

然后选择 `Provider -> Local Agents`，bridge endpoint 保持 `http://127.0.0.1:3333/mcp`。

## 排错清单

- `401` 或 `403`：API key 缺失、过期，或当前 endpoint 不接受这个 key。
- `404`：Base URL 的协议路径可能重复或缺失，优先恢复内置预设。
- `No text returned from model`：先点 `保存并测试`，再从推荐模型下拉框换一个模型。
- 图片提问失败：确认当前档案声明支持图片输入，并且所选模型本身真的支持图片。
- PDF 输入失败：把 `输入模式` 切回抽取文本，或改用声明支持 PDF 的 Responses / Anthropic 风格档案。
- 本地档案失败：先确认本地服务已经监听对应端口，再从 Zotero 测试。
