# literature-review-with-LLM

Zotero literature review and Markdown summary plugin. It helps turn a selected Zotero paper into a Markdown-first reading workflow: generate or update paper summaries, ask questions in a paper chat workbench, save sessions, and optionally consult local Gemini / Claude / opencode command-line agents through a local bridge.

[中文说明](README.zh-CN.md)

> Current status: usable but still early. The core single-paper workflow, image-question flow, figure/table extraction prompt, single-paper reading-log export, proposal-note export with domain writing checklists, journal/report-outline export with domain writing checklists, formal review-draft export, first-pass multi-paper comparison with a reusable Markdown literature-matrix report, collection topic-cluster workspace with evidence-backed synthesis claims, a conflict/gap ledger, a synthesis roadmap, a formal review report scaffold, a cross-collection synthesis index/map, and configurable bounded citation-network expansion are in place; richer cross-paper analysis is still being improved.

![Zotero paper chat workbench](docs/assets/workbench-chat.png)

## Highlights

- **Paper-first chat inside Zotero**: open a compact workbench from the selected item and keep the conversation anchored to the current paper.
- **Markdown-native reading notes**: generate summaries as local Markdown files, link them back to Zotero, copy raw Markdown answers, export evidence-labeled paper reading logs, proposal notes and journal/report outlines with prompt-pack-specific writing checklists, plus formal review drafts, and write selected answers back with a preview step.
- **Provider-flexible setup**: use MiniMax, DeepSeek, OpenAI-compatible Chat providers, OpenAI Responses-compatible providers, Anthropic / Anthropic-compatible providers, Gemini OpenAI-compatible endpoints, GitHub Models, Fireworks AI, Cerebras, NVIDIA NIM, SambaNova, OpenRouter, DashScope, SiliconFlow, Ollama, LM Studio, and other profiles from one settings page with an in-app setup guide and live-check command template.
- **Provider diagnostics**: OpenAI-compatible, OpenAI Responses, Anthropic, and wrapped router responses are normalized for text, stream errors, model lists, and token usage metadata in saved sessions.
- **Multi-paper comparison and literature matrix**: when multiple Zotero items are selected, the first item becomes the focal paper and the rest become comparison context; the workbench can export an evidence-labeled Markdown literature matrix, and the built-in `Literature Matrix` skill can continue the analysis with an LLM.
- **Collection synthesis workspace**: collection batch runs write `papers.json`, paper-note indexes, method matrices, research-gap matrices, heuristic topic clusters, synthesis-claims matrices, synthesis-conflict ledgers, synthesis roadmaps, research-question cards, idea lists, a manual review draft scaffold, a formal review report scaffold, plus a global `collections/index.json` and cross-collection synthesis map.
- **Image questions and figure extraction**: paste screenshots, drop images, or choose local image files; the built-in `Figure/Table Extractor` skill turns paper figures, tables, and result panels into structured Markdown with visual OCR text, reconstructed-data-table fields, evidence mapping, and a review checklist.
- **Bring-your-own-key**: the plugin is free and open source; remote model providers require your own API keys.
- **Local agent consultation**: optionally ask local Gemini, Claude, and opencode command-line tools for independent reading suggestions through the local bridge.
- **Research workflow utilities**: includes skill prompts for deep summary, method extraction, experiment tables, figure/table extraction, literature matrix, citation checks, and candidate-paper discovery.
- **Candidate-paper review queue**: arXiv / Crossref / Semantic Scholar / Unpaywall results are deduplicated, ranked with explainable priority signals, expanded through configurable bounded Semantic Scholar references/citations policies, reviewed with saved manual notes, structured full-text screening stages, exclusion reasons, and a screening board, optionally updated from high-confidence recommendations, exported as a Markdown review report with source-evidence snippets, hit context, short hashes, Zotero annotation page labels when matched, and best-effort indexed page hints from form-feed or standalone page markers, saved as JSONL, and imported only after manual review.
- **Research-domain prompt packs**: choose general reading, AI/ML systems, transportation and urban airspace, biomedicine, social science/policy, or literature-review writing packs. The selected pack is applied in both the paper chat workbench and direct summary generation.

## Features

- Generate Markdown summaries as linked Zotero attachments.
- Open a paper chat workbench for the currently selected Zotero item.
- Stream assistant output into Markdown rendering, including common headings, lists, tables, code blocks, and lightweight formula display.
- Preserve normalized provider usage metadata in saved chat sessions when the provider returns token counts.
- Copy raw Markdown answers from the chat workbench.
- Ask image-based questions by pasting screenshots, dropping images, or selecting local image files in the workbench; image-only sends use a default image-analysis prompt.
- Write selected answers back into the Markdown summary with a preview step and backup file.
- Export a structured paper reading log with context-quality diagnostics, reading checklist, evidence snippets, and reuse-plan fields.
- Export proposal notes and journal/report outlines with evidence labels, writing-positioning fields, prompt-pack-specific domain writing checklists, and manual follow-up checklists.
- Export a formal review-draft scaffold with positioning notes, taxonomy tables, evidence-backed draft sections, risk checks, and an evidence index.
- Configure multiple model providers from Zotero preferences.
- Generate collection workspace artifacts during collection batch runs, including method matrices, topic clusters, synthesis-claims matrices, synthesis-conflict ledgers, synthesis roadmaps, gap matrices, review-draft scaffolds, and a formal review report scaffold.
- Use built-in skill prompts for deep summary, method extraction, experiment tables, figure/table extraction, literature matrix, citation audit, and local-agent review.
- Select a research-domain prompt pack from Zotero preferences or the workbench settings drawer.
- Optional local-agent bridge for Gemini, Claude, and opencode CLI tools.
- Candidate-paper discovery utilities for arXiv / Crossref / Semantic Scholar workflows, including configurable references/citations expansion from seeded papers and a Markdown review report export.
- Candidate-paper ranking stores priority tier, score, recommended decision, and reasons in `candidates.jsonl`.

## Installation

Download the latest XPI from the GitHub release page:

- [v0.1.1 release](https://github.com/KaguraTart/literature-review-with-LLM/releases/tag/v0.1.1)
- [literature-review-with-llm.xpi](https://github.com/KaguraTart/literature-review-with-LLM/releases/download/v0.1.1/literature-review-with-llm.xpi)

Then install it in Zotero:

1. Open Zotero.
2. Go to `Tools -> Plugins`.
3. Choose `Install Plugin From File...`.
4. Select `literature-review-with-llm.xpi`.
5. Restart Zotero if prompted.

This plugin targets Zotero 9.x.

## Quick Start

1. Select a regular Zotero item that has a PDF attachment.
2. Open `Tools -> Literature Review with LLM Settings` and configure a provider profile.
3. Run `Tools -> 生成 Markdown 总结` or `Tools -> 打开论文聊天工作台`.
4. Ask questions in the workbench, copy Markdown answers, or write an answer back into the summary file.
5. For figure or screenshot questions, paste a screenshot, drop an image, or use the `+` button to select a local image. If you send only an image, the workbench automatically uses a default image-analysis question. Image understanding depends on the selected model provider.

The generated Markdown files are saved under the configured output directory. By default, the plugin creates per-item summary/session files and links summary files back to Zotero.

## API Configuration

Open `Tools -> Literature Review with LLM Settings`.

![Provider profile and API key settings](docs/assets/provider-settings.png)

Important fields:

- `默认接口档案`: choose the active provider profile.
- `Provider`: built-in presets include MiniMax, OpenAI, OpenAI Compatible Chat, OpenAI Compatible Responses, Anthropic, Anthropic-compatible, Gemini OpenAI-compatible, Azure OpenAI, GitHub Models, Fireworks AI, Cerebras, NVIDIA NIM, SambaNova, OpenRouter, DeepSeek, DashScope, SiliconFlow, Ollama, LM Studio, Local Agents, and others.
- `Base URL`: provider endpoint root, for example `https://api.openai.com/v1` or `http://127.0.0.1:11434/v1`.
- `API Key`: provider API key. Local providers such as Ollama may not require one.
- `Model`: model name used by the selected provider.
- `Setup guide`: shows the resolved protocol, request endpoint, auth behavior, model-list endpoint, supported inputs, and a copyable terminal live-check command without showing the saved API key.
- `输入模式`: choose extracted text or raw PDF input where supported.
- `流式输出`: enable streaming responses when the provider profile supports it.
- `输出目录`: where Markdown summaries, sessions, candidate files, and logs are written.

Provider notes:

- OpenAI Compatible Chat profiles use the chat-completions style endpoint. Use this for most routers and providers that expose `/v1/chat/completions`.
- OpenAI Compatible Chat profiles send `max_tokens` by default, but switch to `max_completion_tokens` for `o`-series reasoning models and avoid default `temperature` / `n` fields that many reasoning routes reject. For custom routers, set `bodyExtra.tokenLimitField` to `max_completion_tokens` or `max_tokens` to force either field; explicit `bodyExtra.temperature` or `bodyExtra.n` values are still respected.
- Streaming OpenAI Compatible Chat requests include `stream_options.include_usage` so the workbench can preserve token usage metadata when the provider returns it.
- Strict routers or reasoning models that reject default request fields can use `bodyExtra.omitFields`, for example `["temperature", "n", "max_tokens"]`. These names remove top-level request body fields before the request is sent.
- OpenAI Compatible Responses profiles use the Responses style endpoint. Use this when a provider or router exposes `/v1/responses`; this profile can declare raw PDF and image input when the model supports it.
- Anthropic profiles use the messages endpoint. Use `Anthropic` for the official API key header, and `Anthropic Compatible Messages` for routers that expose Anthropic-style `/v1/messages` with bearer auth.
- Gemini is currently configured through the OpenAI-compatible endpoint style.
- GitHub Models uses `https://models.github.ai/inference` without an added `/v1` segment and includes the required GitHub API headers; use a PAT with Models access as the API key.
- Fireworks AI, Cerebras, NVIDIA NIM, and SambaNova are available as named OpenAI-compatible presets. SambaNova also includes Responses and Anthropic-compatible presets.
- MiniMax is the default preset in the current package, but you should still confirm the model and API key in preferences.
- Local Agents route through a local HTTP bridge instead of directly calling remote model APIs.

API keys are stored in Zotero preferences on your local machine. Do not commit `.env` files or local preference exports.

## Local Agents

The plugin can call local Gemini, Claude, and opencode command-line tools through a local bridge. This is useful when you want independent paper-review suggestions or cross-agent critique.

Install dependencies:

```bash
npm install
```

Start or install the local-agent service:

```bash
npm run local-agent:service:start
npm run local-agent:service:check
```

Useful commands:

```bash
npm run local-agent:service:install
npm run local-agent:service:restart
npm run local-agent:service:doctor
npm run local-agent:service:stop
```

Expected local endpoint:

```text
http://127.0.0.1:3333/mcp
```

The CLI tools themselves must be installed and authenticated separately on the machine. The plugin does not manage vendor logins for those tools.

## Workbench Usage

The workbench is designed as a compact paper chat surface:

- Top bar: current paper title, active model profile, settings button.
- Message area: rendered Markdown answers with raw Markdown copy support.
- Composer: ask questions about the selected paper.
- Image attachments: paste screenshots, drop images, or select local image files; requests are sent in the active provider protocol's image format. Image-only sends are converted into a default analysis request.
- Settings drawer: model, consultation mode, paper metadata, session tools, reading-log/review-draft export, and candidate-paper utilities.

Typical questions:

- Summarize the main contribution.
- Extract the method pipeline.
- Compare claimed results with experimental evidence.
- List limitations and possible follow-up experiments.
- Check whether a conclusion is supported by the paper text.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build the XPI:

```bash
npm run build
```

Full verification:

```bash
npm run check
```

The full check runs tests, type checking, provider text/stream/image/PDF mock checks, provider catalog checks, writeback smoke tests, package verification, readiness checks, and whitespace validation.

Optional live provider checks use your own API credentials:

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

For router or local endpoints, set the matching `*_BASE_URL` variable and use `openai-compatible`, `openai-responses-compatible`, or `anthropic-compatible`. Raw PDF live checks skip OpenAI-compatible Chat profiles because those profiles use extracted text input.

Named provider live checks use provider-specific environment variables:

```bash
MINIMAX_API_KEY=... MINIMAX_MODEL=... npm run verify:provider:live -- --include minimax
GEMINI_API_KEY=... GEMINI_MODEL=... npm run verify:provider:live -- --include gemini
AZURE_OPENAI_API_KEY=... AZURE_OPENAI_MODEL=... AZURE_OPENAI_BASE_URL=... npm run verify:provider:live -- --include azure-openai
GITHUB_MODELS_API_KEY=... GITHUB_MODELS_MODEL=... npm run verify:provider:live -- --include github-models
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
```

The same naming pattern is available for `XAI_*`, `TOGETHER_*`, `KIMI_*`, `PERPLEXITY_*`, `DEEPSEEK_ANTHROPIC_*`, `ZAI_ANTHROPIC_*`, `ZHIPU_*`, `VOLCENGINE_*`, `QIANFAN_*`, and `HUNYUAN_*`. Add the matching `*_BASE_URL` only when you override the built-in endpoint or use a proxy.

Live checks also accept request headers and request-body overrides. Use repeated `--header name=value` or per-case env vars such as `OPENAI_COMPATIBLE_HEADERS_JSON`, `OPENAI_RESPONSES_COMPATIBLE_HEADERS_JSON`, and `ANTHROPIC_COMPATIBLE_HEADERS_JSON` for custom gateways. Use `--body-extra-json` for all selected cases, or per-case env vars such as `OPENAI_COMPATIBLE_BODY_EXTRA_JSON`, `OPENAI_RESPONSES_COMPATIBLE_BODY_EXTRA_JSON`, `ANTHROPIC_COMPATIBLE_BODY_EXTRA_JSON`, `OPENAI_BODY_EXTRA_JSON`, and `ANTHROPIC_BODY_EXTRA_JSON`.

```bash
OPENAI_COMPATIBLE_API_KEY=... \
OPENAI_COMPATIBLE_MODEL=... \
OPENAI_COMPATIBLE_BASE_URL=... \
OPENAI_COMPATIBLE_HEADERS_JSON='{"HTTP-Referer":"https://example.org","X-Title":"Literature Review with LLM"}' \
OPENAI_COMPATIBLE_BODY_EXTRA_JSON='{"omitFields":["temperature","n","max_tokens"]}' \
npm run verify:provider:live -- --include openai-compatible
```

## Release Packaging

The packaged plugin is generated at:

```text
build/literature-review-with-llm.xpi
```

The Zotero update manifest is generated at:

```text
build/update.json
```

`addon/manifest.json` points Zotero to the stable GitHub Releases URL for `update.json`. The update manifest records the tagged XPI download URL, the current XPI `sha256` hash, and Zotero compatibility bounds. Both `literature-review-with-llm.xpi` and `update.json` are uploaded as release artifacts rather than committed to the repository.

## Current Limitations

- Multi-paper comparison is available as a first-pass workbench workflow, with up to 5 comparison papers by default and a reusable Markdown literature-matrix export. Collection batch runs now generate heuristic topic clusters, evidence-backed synthesis-claims matrices, synthesis-conflict ledgers, synthesis roadmaps, a formal review report scaffold, and a cross-collection synthesis map, but the clustering is deterministic and the reports still need human review before final writing.
- Single-turn image attachments and the `Figure/Table Extractor` skill are supported, including a structured visual OCR / table-reconstruction output contract, but chart, table, and handwritten-note understanding still depends on the selected model. A local OCR engine and automatic chart-data reconstruction are not implemented yet.
- Formula rendering is lightweight. It supports common inline/display math patterns, but it is not a full TeX engine.
- Paper reading logs and formal review drafts are structured Markdown scaffolds with evidence excerpts and manual fields; they still need human editing before becoming polished long-form review reports.
- Candidate-paper search now has explainable ranking, duplicate reconciliation, configurable bounded citation-network expansion, saved manual review notes, structured full-text screening stages, exclusion reasons, high-confidence recommendation application, a screening board, an evidence-chain follow-up queue, source-evidence snippets, Zotero indexed full-text evidence snippets with hit context, matched annotation page labels, indexed-text locators, best-effort page hints when indexed text preserves form-feed page breaks or standalone page markers such as `Page 12`, and short hashes for imported candidates with attached PDFs, plus a Markdown candidate-review report. True page-accurate source-to-PDF evidence extraction for unannotated PDF text still needs more work.
- The workbench UI is still being refined; some controls and settings are intentionally compact but may need more usability work.
- Raw PDF input depends on provider capability. Many providers still use extracted Zotero text instead.
- Local-agent calls depend on local CLI tools and their own authentication state.
- Live provider verification requires real API credentials and is not run by default.
- Zotero version coverage is currently focused on Zotero 9.x.

## TODO

- Improve cross-collection clustering and continue polishing the global synthesis map, collection-level synthesis claims, synthesis roadmaps, and report generation.
- Replace the current prompt-level visual OCR/table-reconstruction contract with local OCR, table parsing, and chart-data reconstruction for screenshots, PDF figures, tables, and experimental results.
- Add true page-accurate source-to-PDF evidence extraction for unannotated PDF text on top of the current screening stages, exclusion reasons, screening board, evidence-chain queue, source-evidence snippets, Zotero indexed full-text snippets with hit context, matched annotation page labels, best-effort form-feed/page-marker hints, locators and hashes, and configurable citation-network policies.
- Add more per-provider screenshots and tutorial examples beyond the in-app setup guide.
- Continue adding deeper domain-specific writing formats beyond the current prompt-pack-specific proposal-note and journal/report-outline checklists.

## Security and Privacy

- Keep API keys local.
- Do not commit `.env` files.
- Review generated Markdown before writing it back to a summary file.
- Use the writeback preview step for any destructive or replacement operation.
- Be careful when sending unpublished PDFs or sensitive notes to remote providers.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Author

kaguratart <kaguratart@gmail.com>
