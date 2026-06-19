# literature-review-with-LLM

Zotero literature review and Markdown summary plugin. It helps turn a selected Zotero paper into a Markdown-first reading workflow: generate or update paper summaries, ask questions in a paper chat workbench, save sessions, and optionally consult local Gemini / Claude / opencode command-line agents through a local bridge.

[中文说明](README.zh-CN.md)

> Current status: usable but still early. The core single-paper workflow, image-question flow, figure/table extraction prompt, first-pass multi-paper comparison, and collection topic-cluster workspace are in place; cross-collection synthesis and richer cross-paper analysis are still planned.

![Zotero paper chat workbench](docs/assets/workbench-chat.png)

## Highlights

- **Paper-first chat inside Zotero**: open a compact workbench from the selected item and keep the conversation anchored to the current paper.
- **Markdown-native reading notes**: generate summaries as local Markdown files, link them back to Zotero, copy raw Markdown answers, and write selected answers back with a preview step.
- **Provider-flexible setup**: use MiniMax, DeepSeek, OpenAI-compatible Chat providers, OpenAI Responses-compatible providers, Anthropic / Anthropic-compatible providers, Gemini OpenAI-compatible endpoints, OpenRouter, DashScope, SiliconFlow, Ollama, LM Studio, and other profiles from one settings page.
- **Multi-paper comparison and literature matrix**: when multiple Zotero items are selected, the first item becomes the focal paper and the rest become comparison context; the built-in `Literature Matrix` skill creates an evidence-grounded cross-paper matrix.
- **Collection synthesis workspace**: collection batch runs write `papers.json`, paper-note indexes, method matrices, research-gap matrices, heuristic topic clusters, research-question cards, idea lists, and a manual review draft scaffold.
- **Image questions and figure extraction**: paste screenshots, drop images, or choose local image files; the built-in `Figure/Table Extractor` skill turns paper figures, tables, and result panels into structured Markdown.
- **Bring-your-own-key**: the plugin is free and open source; remote model providers require your own API keys.
- **Local agent consultation**: optionally ask local Gemini, Claude, and opencode command-line tools for independent reading suggestions through the local bridge.
- **Research workflow utilities**: includes skill prompts for deep summary, method extraction, experiment tables, figure/table extraction, literature matrix, citation checks, and candidate-paper discovery.
- **Candidate-paper review queue**: arXiv / Crossref / Semantic Scholar / Unpaywall results are deduplicated, ranked with explainable priority signals, saved as JSONL, and can be imported after manual review.
- **Research-domain prompt packs**: choose general reading, AI/ML systems, transportation and urban airspace, biomedicine, social science/policy, or literature-review writing packs. The selected pack is applied in both the paper chat workbench and direct summary generation.

## Features

- Generate Markdown summaries as linked Zotero attachments.
- Open a paper chat workbench for the currently selected Zotero item.
- Stream assistant output into Markdown rendering, including common headings, lists, tables, code blocks, and lightweight formula display.
- Copy raw Markdown answers from the chat workbench.
- Ask image-based questions by pasting screenshots, dropping images, or selecting local image files in the workbench; image-only sends use a default image-analysis prompt.
- Write selected answers back into the Markdown summary with a preview step and backup file.
- Configure multiple model providers from Zotero preferences.
- Generate collection workspace artifacts during collection batch runs, including method matrices, topic clusters, gap matrices, and review-draft scaffolds.
- Use built-in skill prompts for deep summary, method extraction, experiment tables, figure/table extraction, literature matrix, citation audit, and local-agent review.
- Select a research-domain prompt pack from Zotero preferences or the workbench settings drawer.
- Optional local-agent bridge for Gemini, Claude, and opencode CLI tools.
- Candidate-paper discovery utilities for arXiv / Crossref / Semantic Scholar workflows.
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
- `Provider`: built-in presets include MiniMax, OpenAI, OpenAI Compatible Chat, OpenAI Compatible Responses, Anthropic, Anthropic-compatible, Gemini OpenAI-compatible, Azure OpenAI, OpenRouter, DeepSeek, DashScope, SiliconFlow, Ollama, LM Studio, Local Agents, and others.
- `Base URL`: provider endpoint root, for example `https://api.openai.com/v1` or `http://127.0.0.1:11434/v1`.
- `API Key`: provider API key. Local providers such as Ollama may not require one.
- `Model`: model name used by the selected provider.
- `输入模式`: choose extracted text or raw PDF input where supported.
- `流式输出`: enable streaming responses when the provider profile supports it.
- `输出目录`: where Markdown summaries, sessions, candidate files, and logs are written.

Provider notes:

- OpenAI Compatible Chat profiles use the chat-completions style endpoint. Use this for most routers and providers that expose `/v1/chat/completions`.
- OpenAI Compatible Responses profiles use the Responses style endpoint. Use this when a provider or router exposes `/v1/responses`; this profile can declare raw PDF and image input when the model supports it.
- Anthropic profiles use the messages endpoint. Use `Anthropic` for the official API key header, and `Anthropic Compatible Messages` for routers that expose Anthropic-style `/v1/messages` with bearer auth.
- Gemini is currently configured through the OpenAI-compatible endpoint style.
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
- Settings drawer: model, consultation mode, paper metadata, session tools, and candidate-paper utilities.

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

The full check runs tests, type checking, provider mock/catalog checks, writeback smoke tests, package verification, readiness checks, and whitespace validation.

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

- Multi-paper comparison is available as a first-pass workbench workflow, with up to 5 comparison papers by default. Collection batch runs now generate heuristic topic clusters and synthesis matrices, but the clustering is deterministic and should be reviewed before final writing.
- Single-turn image attachments and the `Figure/Table Extractor` skill are supported, but chart, table, and handwritten-note understanding still depends on the selected model. Local OCR and chart-data reconstruction are not implemented yet.
- Formula rendering is lightweight. It supports common inline/display math patterns, but it is not a full TeX engine.
- Candidate-paper search now has explainable ranking and duplicate reconciliation, but citation-network expansion and richer review workflows still need more work.
- The workbench UI is still being refined; some controls and settings are intentionally compact but may need more usability work.
- Raw PDF input depends on provider capability. Many providers still use extracted Zotero text instead.
- Local-agent calls depend on local CLI tools and their own authentication state.
- Live provider verification requires real API credentials and is not run by default.
- Zotero version coverage is currently focused on Zotero 9.x.

## TODO

- Improve cross-collection clustering, richer synthesis matrices, and batch report generation.
- Improve structured extraction quality for screenshots, PDF figures, tables, and experimental results with local OCR/table reconstruction.
- Add citation-network expansion and richer candidate-paper review workflows.
- Add per-provider setup guides with screenshots.
- Add stronger UI tests for the embedded Zotero side panel.
- Add export templates for thesis notes, review reports, and paper reading logs.

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
