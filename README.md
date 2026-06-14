# literature-review-with-LLM

Zotero literature review and Markdown summary plugin. It helps turn a selected Zotero paper into a Markdown-first reading workflow: generate or update paper summaries, ask questions in a paper chat workbench, save sessions, and optionally consult local Gemini / Claude / opencode command-line agents through a local bridge.

> Current status: usable but still early. The core single-paper workflow is in place; several larger research-assistant workflows are still planned.

![Zotero paper chat workbench](docs/assets/workbench-chat.png)

## Features

- Generate Markdown summaries as linked Zotero attachments.
- Open a paper chat workbench for the currently selected Zotero item.
- Stream assistant output into Markdown rendering, including common headings, lists, tables, code blocks, and lightweight formula display.
- Copy raw Markdown answers from the chat workbench.
- Write selected answers back into the Markdown summary with a preview step and backup file.
- Configure multiple model providers from Zotero preferences.
- Use built-in skill prompts for deep summary, method extraction, experiment table building, citation audit, and local-agent review.
- Optional local-agent bridge for Gemini, Claude, and opencode CLI tools.
- Candidate-paper discovery utilities for arXiv / Crossref / Semantic Scholar workflows.

## Installation

Download the latest XPI from the GitHub release page:

- [v0.1.0 release](https://github.com/KaguraTart/literature-review-with-LLM/releases/tag/v0.1.0)
- [zotero-markdown-summary.xpi](https://github.com/KaguraTart/literature-review-with-LLM/releases/download/v0.1.0/zotero-markdown-summary.xpi)

Then install it in Zotero:

1. Open Zotero.
2. Go to `Tools -> Plugins`.
3. Choose `Install Plugin From File...`.
4. Select `zotero-markdown-summary.xpi`.
5. Restart Zotero if prompted.

This plugin targets Zotero 9.x.

## Quick Start

1. Select a regular Zotero item that has a PDF attachment.
2. Open `Tools -> Markdown 摘要设置` and configure a provider profile.
3. Run `Tools -> 生成 Markdown 总结` or `Tools -> 打开论文聊天工作台`.
4. Ask questions in the workbench, copy Markdown answers, or write an answer back into the summary file.

The generated Markdown files are saved under the configured output directory. By default, the plugin creates per-item summary/session files and links summary files back to Zotero.

## API Configuration

Open `Tools -> Markdown 摘要设置`.

Important fields:

- `默认接口档案`: choose the active provider profile.
- `Provider`: built-in presets include MiniMax, OpenAI, Anthropic, Gemini OpenAI-compatible, Azure OpenAI, OpenRouter, DeepSeek, DashScope, SiliconFlow, Ollama, LM Studio, Local Agents, and others.
- `Base URL`: provider endpoint root, for example `https://api.openai.com/v1` or `http://127.0.0.1:11434/v1`.
- `API Key`: provider API key. Local providers such as Ollama may not require one.
- `Model`: model name used by the selected provider.
- `输入模式`: choose extracted text or raw PDF input where supported.
- `流式输出`: enable streaming responses when the provider profile supports it.
- `输出目录`: where Markdown summaries, sessions, candidate files, and logs are written.

Provider notes:

- OpenAI-compatible providers use the chat-completions style endpoint.
- Anthropic profiles use the messages endpoint.
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
build/zotero-markdown-summary.xpi
```

The release asset is uploaded under GitHub Releases rather than committed to the repository.

## Current Limitations

- Multi-paper comparison and cross-paper synthesis are not implemented yet.
- Screenshot input and image-based question answering are not supported yet.
- Formula rendering is lightweight. It supports common inline/display math patterns, but it is not a full TeX engine.
- Candidate-paper search is still utility-grade and needs stronger deduplication, ranking, and review workflows.
- The workbench UI is still being refined; some controls and settings are intentionally compact but may need more usability work.
- Raw PDF input depends on provider capability. Many providers still use extracted Zotero text instead.
- Local-agent calls depend on local CLI tools and their own authentication state.
- Live provider verification requires real API credentials and is not run by default.
- Zotero version coverage is currently focused on Zotero 9.x.

## TODO

- Add multi-paper comparison, clustering, and literature-matrix generation.
- Add screenshot/image input for figures, tables, and handwritten notes.
- Add richer chart/table extraction from PDF content.
- Add better candidate-paper ranking and citation-network expansion.
- Add per-provider setup guides with screenshots.
- Add automatic update metadata workflow for XPI releases.
- Add stronger UI tests for the embedded Zotero side panel.
- Add configurable prompt packs for different research domains.
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
