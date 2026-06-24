# literature-review-with-LLM

Zotero literature review and Markdown summary plugin. It helps turn a selected Zotero paper into a Markdown-first reading workflow: generate or update paper summaries, ask questions in a paper chat workbench, save sessions, and optionally consult local Gemini / Claude / opencode command-line agents through a local bridge.

[中文说明](README.zh-CN.md)

> Current status: usable but still early. The core single-paper workflow, image-question flow, optional local OCR metadata for images, figure/table extraction prompt, reviewable chart-data drafts from reconstructed tables/OCR, model-estimated pixel/coordinate data drafts, single-paper reading-log export, proposal-note export with domain writing checklists, journal/report-outline export with domain writing checklists, formal review-draft export, multi-paper comparison with a reusable Markdown literature-matrix report, evidence coverage maps, pairwise contrasts, gap ledgers, collection topic-cluster workspace with evidence-backed synthesis claims, a conflict/gap ledger, a synthesis roadmap, a formal review report scaffold, a cross-collection synthesis index/map with theme-bridge, recurring-gap, and priority boards, and configurable bounded citation-network expansion are in place; richer cross-paper analysis is still being improved.

![Zotero paper chat workbench](docs/assets/workbench-chat.png)

## Highlights

- **Paper-first chat inside Zotero**: open a compact workbench from the selected item and keep the conversation anchored to the current paper.
- **Markdown-native reading notes**: generate summaries as local Markdown files, link them back to Zotero, copy raw Markdown answers, export evidence-labeled paper reading logs, proposal notes and journal/report outlines with prompt-pack-specific writing checklists, plus formal review drafts, and write selected answers back with a preview step.
- **Provider-flexible setup**: use MiniMax, DeepSeek, OpenAI-compatible Chat providers, OpenAI Responses-compatible providers, Anthropic / Anthropic-compatible providers, Gemini OpenAI-compatible endpoints, GitHub Models, Fireworks AI, Cerebras, NVIDIA NIM, SambaNova, OpenRouter, DashScope, SiliconFlow, Ollama, LM Studio, and other profiles from one settings page with an in-app setup guide and live-check command template.
- **Provider diagnostics**: OpenAI-compatible, OpenAI Responses, Anthropic, and wrapped router responses are normalized for text, stream errors, model lists, and token usage metadata in saved sessions; the workbench can export a redacted provider diagnostics Markdown report with endpoint, auth, model-list, live-check, and text/image/PDF request-body previews.
- **Multi-paper comparison and literature matrix**: when multiple Zotero items are selected, the first item becomes the focal paper and the rest become comparison context; the workbench can export an evidence-labeled Markdown literature matrix with a comparison table, evidence coverage map, pairwise contrasts, and a gap ledger, and the built-in `Literature Matrix` skill can continue the analysis with an LLM.
- **Collection synthesis workspace**: collection batch runs write `papers.json`, paper-note indexes, method matrices, research-gap matrices, heuristic topic clusters, synthesis-claims matrices, synthesis-conflict ledgers, synthesis roadmaps, research-question cards, idea lists, a manual review draft scaffold, a formal review report scaffold, plus a global `collections/index.json` and cross-collection synthesis map with theme-bridge, recurring-gap, and priority boards.
- **Image questions and figure extraction**: paste screenshots, drop images, or choose local image files; optional local OCR can attach recognized text from the local-agent bridge for review and correction, and the built-in `Figure/Table Extractor` skill turns paper figures, tables, and result panels into structured Markdown with visual OCR text, reconstructed-data-table fields, dense point-data drafts, evidence mapping, a review checklist, pixel/coordinate data drafts with linear axis-calibration value inference, a chart review action queue with editable review-state fields, and reusable Markdown plus JSON/CSV extraction exports.
- **Bring-your-own-key**: the plugin is free and open source; remote model providers require your own API keys.
- **Local agent consultation**: optionally ask local Gemini, Claude, and opencode command-line tools for independent reading suggestions through the local bridge.
- **Research workflow utilities**: includes skill prompts for deep summary, method extraction, experiment tables, figure/table extraction, literature matrix, citation checks, and candidate-paper discovery.
- **Candidate-paper review queue**: arXiv / Crossref / Semantic Scholar / Unpaywall results are deduplicated, ranked with explainable priority signals, expanded through configurable bounded Semantic Scholar references/citations policies, reviewed with saved manual notes, structured full-text screening stages, exclusion reasons, and a screening board, optionally updated from high-confidence recommendations, exported as a Markdown review report with source-evidence snippets, hit context, short hashes, Zotero annotation page labels when matched, page-level PDF text locators from Zotero page text or the local `pdftotext` bridge when available, bounded OCR fallback for scanned PDFs, ranked indexed-text evidence that avoids table-of-contents noise, and best-effort indexed page hints from form-feed or standalone page markers, saved as JSONL, and imported only after manual review.
- **Research-domain prompt packs**: choose general reading, AI/ML systems, transportation and urban airspace, biomedicine, social science/policy, or literature-review writing packs. The selected pack is applied in both the paper chat workbench and direct summary generation.

## Features

- Generate Markdown summaries as linked Zotero attachments.
- Open a paper chat workbench for the currently selected Zotero item.
- Stream assistant output into Markdown rendering, including common headings, lists, tables, code blocks, and lightweight formula display.
- Preserve normalized provider usage metadata in saved chat sessions when the provider returns token counts.
- Copy raw Markdown answers from the chat workbench.
- Ask image-based questions by pasting screenshots, dropping images, or selecting local image files in the workbench; image-only sends use a default image-analysis prompt, optional local OCR metadata can be recorded, reviewed, and corrected through the local bridge workflow, and visual extraction answers can be exported as Markdown reports plus structured JSON/CSV table sidecars, including reviewable axis-calibration anchors and inferred axis values for model-estimated pixel points when the model returns enough anchors.
- Write selected answers back into the Markdown summary with a preview step and backup file.
- Export a structured paper reading log with context-quality diagnostics, reading checklist, evidence snippets, and reuse-plan fields.
- Export proposal notes and journal/report outlines with evidence labels, writing-positioning fields, prompt-pack-specific domain writing checklists, and manual follow-up checklists.
- Export a formal review-draft scaffold with positioning notes, taxonomy tables, evidence-backed draft sections, risk checks, and an evidence index.
- Configure multiple model providers from Zotero preferences.
- Generate collection workspace artifacts during collection batch runs, including method matrices, topic clusters, synthesis-claims matrices, synthesis-conflict ledgers, synthesis roadmaps, gap matrices, review-draft scaffolds, a cross-collection theme-bridge board, recurring-gap board, priority board, and a formal review report scaffold.
- Use built-in skill prompts for deep summary, method extraction, experiment tables, figure/table extraction, literature matrix, citation audit, and local-agent review.
- Select a research-domain prompt pack from Zotero preferences or the workbench settings drawer.
- Optional local-agent bridge for Gemini, Claude, and opencode CLI tools.
- Candidate-paper discovery utilities for arXiv / Crossref / Semantic Scholar workflows, including configurable references/citations expansion from seeded papers and a Markdown review report export.
- Candidate-paper ranking stores priority tier, score, recommended decision, and reasons in `candidates.jsonl`.

## Installation

Download the latest XPI from the GitHub release page:

- [Latest release](https://github.com/KaguraTart/literature-review-with-LLM/releases/latest)
- [literature-review-with-llm.xpi](https://github.com/KaguraTart/literature-review-with-LLM/releases/latest/download/literature-review-with-llm.xpi)

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
5. For figure or screenshot questions, paste a screenshot, drop an image, or use the `+` button to select a local image. If you send only an image, the workbench automatically uses a default image-analysis question. Image understanding depends on the selected model provider; when the local bridge is running, the workbench can also record optional local OCR text before sending.

The generated Markdown files are saved under the configured output directory. Use `Browse...` in the Zotero settings page, or the same output-directory field in the workbench settings drawer, to choose a folder with the system file manager. By default, the plugin creates per-item summary/session files and links summary files back to Zotero.

## API Configuration

Open `Tools -> Literature Review with LLM Settings`.

![Provider profile and API key settings](docs/assets/provider-settings.png)

Important fields:

- `默认接口档案`: choose the active provider profile.
- `Provider`: built-in presets include MiniMax, OpenAI, OpenAI Compatible Chat, OpenAI Compatible Responses, Anthropic, Anthropic-compatible, Gemini OpenAI-compatible, Azure OpenAI, GitHub Models, Fireworks AI, Cerebras, NVIDIA NIM, SambaNova, OpenRouter, DeepSeek, DashScope, SiliconFlow, Ollama, LM Studio, Local Agents, and others.
- `Base URL`: provider endpoint root, for example `https://api.openai.com/v1` or `http://127.0.0.1:11434/v1`.
- Base URLs may include query parameters required by a gateway or Azure-style route, for example `?api-version=preview`; the plugin appends `/chat/completions`, `/responses`, `/messages`, or `/models` before the query string.
- `API Key`: provider API key. Local providers such as Ollama may not require one.
- `Model`: model name used by the selected provider.
- `Setup guide`: shows the resolved protocol, request endpoint, auth behavior, model-list endpoint, supported inputs, and a copyable terminal live-check command without showing the saved API key.
- `输入模式`: choose extracted text or raw PDF input where supported.
- `流式输出`: enable streaming responses when the provider profile supports it.
- `输出目录`: where Markdown summaries, sessions, candidate files, and logs are written. Use `Browse...` to choose the folder instead of typing a platform-specific path by hand.

Provider notes:

- OpenAI Compatible Chat profiles use the chat-completions style endpoint. Use this for most routers and providers that expose `/v1/chat/completions`.
- OpenAI Compatible Chat profiles send `max_tokens` by default, but switch to `max_completion_tokens` for `o`-series reasoning models and avoid default `temperature` / `n` fields that many reasoning routes reject. For custom routers, set `bodyExtra.tokenLimitField` to `max_completion_tokens` or `max_tokens` to force either field; explicit `bodyExtra.temperature` or `bodyExtra.n` values are still respected.
- Streaming OpenAI Compatible Chat requests include `stream_options.include_usage` so the workbench can preserve token usage metadata when the provider returns it. The stream parser accepts both `choices[].delta` and Gemini/router-style `candidates[].content.parts[]` text fragments while filtering reasoning/thinking fragments from the visible answer.
- Strict routers or reasoning models that reject default request fields can use `bodyExtra.omitFields`, for example `["temperature", "n", "max_tokens"]`. These names remove top-level request body fields before the request is sent.
- OpenAI-compatible Chat and Responses requests also retry with a narrower body when a provider explicitly rejects optional fields such as `stream_options`, JSON-mode formatting, token-limit fields, or `temperature`, including structured `param` / `parameters` error payloads returned by routers.
- OpenAI Compatible Responses profiles use the Responses style endpoint. Use this when a provider or router exposes `/v1/responses`; this profile can declare raw PDF and image input when the model supports it.
- Anthropic profiles use the messages endpoint. Use `Anthropic` for the official API key header, and `Anthropic Compatible Messages` for routers that expose Anthropic-style `/v1/messages` with bearer auth.
- Anthropic-compatible requests also retry without optional body fields such as `stream`, `metadata`, `thinking`, `top_p`, `top_k`, `stop_sequences`, `tools`, or `tool_choice` when a router explicitly rejects them. If a router rejects the `anthropic-version` header, the settings test, workbench, and direct summary path retry once without that header; you can also set `bodyExtra.omitAnthropicVersion` to `true`.
- Gemini is currently configured through the OpenAI-compatible endpoint style.
- GitHub Models uses `https://models.github.ai/inference` without an added `/v1` segment and includes the required GitHub API headers; use a PAT with Models access as the API key.
- Fireworks AI, Cerebras, NVIDIA NIM, and SambaNova are available as named OpenAI-compatible presets. SambaNova also includes Responses and Anthropic-compatible presets.
- MiniMax is the default preset in the current package, but you should still confirm the model and API key in preferences.
- Local Agents route through a local HTTP bridge instead of directly calling remote model APIs. The same bridge also exposes `ocr_image` for optional local OCR and `extract_pdf_pages` for best-effort local PDF page text extraction with OCR fallback for scanned pages.

API keys are stored in Zotero preferences on your local machine. Do not commit `.env` files or local preference exports.

### Provider Live-Check Recipes

For local verification before entering the same values in Zotero, generate a local draft:

```bash
npm run verify:provider:live -- --env-template --dotenv-template --include core > .env.local
```

Fill the relevant variables, then run a no-network configuration preflight to catch missing API keys, model names, or Base URLs:

```bash
npm run verify:provider:live -- --doctor --include core --provider-env-file .env.local
```

After the preflight is clean, run one of these checks:

```bash
# Official OpenAI Responses format
npm run verify:provider:live -- --include openai --provider-env-file .env.local --fail-on-skip

# Generic OpenAI-compatible Chat format
npm run verify:provider:live -- --include openai-compatible --provider-env-file .env.local --fail-on-skip

# Generic OpenAI-compatible Responses format
npm run verify:provider:live -- --include openai-responses-compatible --provider-env-file .env.local --fail-on-skip

# Official Anthropic Messages format
npm run verify:provider:live -- --include anthropic --provider-env-file .env.local --fail-on-skip

# Generic Anthropic-compatible Messages format
npm run verify:provider:live -- --include anthropic-compatible --provider-env-file .env.local --fail-on-skip
```

For local OpenAI-compatible runtimes, use `--include local` and fill `OLLAMA_MODEL` / `OLLAMA_BASE_URL` or `LM_STUDIO_MODEL` / `LM_STUDIO_BASE_URL`; API keys are optional unless your local gateway requires one.

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

Optional local OCR and PDF page extraction:

- The bridge exposes an `ocr_image` tool. The default engine command is `/opt/homebrew/bin/tesseract`, and the default OCR language is `eng`.
- Override the OCR command with `LOCAL_AGENT_TESSERACT_BIN=/path/to/tesseract` and the default service language with `LOCAL_AGENT_TESSERACT_LANG=eng+chi_sim` before starting the service. The workbench settings drawer also exposes the local OCR endpoint, tool name, and per-request language. Chinese OCR requires the matching local Tesseract language data.
- In the workbench settings drawer, enable `Local OCR` for image questions. OCR failures are recorded in the local session metadata and do not block the remote model request.
- The same bridge exposes `extract_pdf_pages` for best-effort page-level text extraction from local PDF files or in-memory PDF bytes. The default text command is `/opt/homebrew/bin/pdftotext`; override it with `LOCAL_AGENT_PDFTOTEXT_BIN=/path/to/pdftotext` before starting the service. When the extracted text is too sparse, callers can enable OCR fallback: the bridge renders a bounded number of pages with `/opt/homebrew/bin/pdftoppm` and OCRs them with Tesseract. Override the renderer with `LOCAL_AGENT_PDFTOPPM_BIN=/path/to/pdftoppm`.

## Workbench Usage

The workbench is designed as a compact paper chat surface:

- Top bar: current paper title, active model profile, settings button.
- Message area: rendered Markdown answers with raw Markdown copy support.
- Composer: ask questions about the selected paper.
- Image attachments: paste screenshots, drop images, or select local image files; requests are sent in the active provider protocol's image format. Image-only sends are converted into a default analysis request. When `Local OCR` is enabled, the local bridge can add editable OCR metadata to the saved session and visual extraction report. Recent figure/table extraction answers can be exported from the Sessions and Files panel as Markdown with machine-readable JSON/CSV table sidecars.
- Settings drawer: model, consultation mode, paper metadata, redacted provider diagnostics export, session tools, reading-log/review-draft export, and candidate-paper utilities.

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

For router or local endpoints, set the matching `*_BASE_URL` variable and use `openai-compatible`, `openai-responses-compatible`, or `anthropic-compatible`. Raw PDF live checks skip OpenAI-compatible Chat profiles because those profiles use extracted text input.

If your configured route supports an input capability that is disabled in the built-in default profile, pass a per-case capability override. For example, an Anthropic-compatible route that accepts PDF documents can be checked with:

```bash
ANTHROPIC_COMPATIBLE_CAPABILITIES_JSON='{"pdfBase64":true}' npm run verify:provider:pdf:live -- --include anthropic-compatible
```

For image-capable compatible routes that are disabled by default, use the matching image live check with an image override, for example `ANTHROPIC_COMPATIBLE_CAPABILITIES_JSON='{"imageBase64":true}' npm run verify:provider:image:live -- --include anthropic-compatible`.

The same override can be passed globally with `--capabilities-json '{"pdfBase64":true}'` or `--capabilities-json '{"imageBase64":true}'` for ad-hoc checks.

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
OLLAMA_MODEL=llama3.1 OLLAMA_BASE_URL=http://localhost:11434/v1 npm run verify:provider:live -- --include ollama
LM_STUDIO_MODEL=local-model LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1 npm run verify:provider:live -- --include lm-studio
```

The same naming pattern is available for `XAI_*`, `TOGETHER_*`, `KIMI_*`, `PERPLEXITY_*`, `DEEPSEEK_ANTHROPIC_*`, `ZAI_ANTHROPIC_*`, `ZHIPU_*`, `VOLCENGINE_*`, `QIANFAN_*`, and `HUNYUAN_*`. For remote named providers, add the matching `*_BASE_URL` only when you override the built-in endpoint or use a proxy. For local providers such as Ollama and LM Studio, `*_BASE_URL` is explicit in live checks so running all live checks without env config does not accidentally call a local port; API keys are optional unless your local server requires one.

Run `npm run verify:provider:live -- --list --json` to print every live-check case with its protocol, profile id, and environment variable names.

`--include` accepts case ids and verification groups. The built-in groups are `core` for the basic OpenAI / OpenAI-compatible / Anthropic cases, `openai-chat`, `openai-responses`, `anthropic-messages`, `mainstream`, `remote`, `local`, and `all`. Case ids still take priority, so `--include anthropic` checks only the official Anthropic case; use `--include anthropic-messages` for the whole Anthropic Messages protocol family.

Run `npm run verify:provider:live -- --doctor --include core --provider-env-file .env.local` to inspect local configuration without calling remote providers. The report lists missing environment variables, resolved endpoints, model source, auth status, input capabilities, and copyable next-step commands. API keys are reported only as configured or missing; secret values are not printed. In doctor mode, a missing env file is reported as a warning and the check continues so you can still see the required variables; actual live checks still require the requested env file to exist.

Run `npm run verify:provider:live -- --env-template --include openai-compatible` to print copyable env lines with default endpoint hints for selected live-check cases. Add `--dotenv-template` to generate a plain `.env.local` draft, for example `npm run verify:provider:live -- --env-template --dotenv-template --include core > .env.local`. Add `--json` if you want a machine-readable template for CI secrets or local shell setup. The same template command is shown in the Zotero settings guide and exported provider diagnostics.

You can keep live-check credentials in a local env file that is not committed:

```bash
npm run verify:provider:live -- --include openai-compatible --provider-env-file .env.local
```

`--provider-env-file` reads `KEY=value` lines, supports optional `export KEY=value`, and only fills missing or empty values; variables already present in the shell take precedence. `--env-file` remains a compatibility alias, but the longer name is preferred because it avoids collisions with newer Node.js CLI options.

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

- Multi-paper comparison is available as a workbench workflow, with up to 5 comparison papers by default and a reusable Markdown literature-matrix export that includes evidence coverage, pairwise contrast, and gap-ledger sections. Collection batch runs now generate heuristic topic clusters, evidence-backed synthesis-claims matrices, synthesis-conflict ledgers, synthesis roadmaps, a formal review report scaffold, and a cross-collection synthesis map with theme-bridge, recurring-gap, and priority boards, but the clustering and matrix synthesis are deterministic and still need human review before final writing.
- Single-turn image attachments and the `Figure/Table Extractor` skill are supported, including optional reviewable local OCR metadata, a structured visual OCR / table-reconstruction output contract, a reusable Markdown export, JSON/CSV sidecars parsed from reconstructed Markdown tables, low-confidence chart-data drafts extracted from tables/OCR/text, dense point-data drafts recognized from dedicated chart tables, pixel/coordinate data drafts parsed from model answers, explicit axis-calibration anchor export, linear axis-value inference for pixel points when enough anchors are available, an automatic chart-data quality review for axis calibration, calibration-anchor quality, confidence, evidence labels, and point coverage, plus a chart review action queue with default `todo` states, reviewer/due/notes placeholders, and done criteria for human follow-up. Chart, table, and handwritten-note understanding still depends on the selected model and local OCR language data; dense point lists, pixel coordinates, calibration anchors, and inferred axis values are reviewable estimates rather than precise automatic digitization.
- Formula rendering is lightweight. It supports common inline/display math patterns, but it is not a full TeX engine.
- Paper reading logs and formal review drafts are structured Markdown scaffolds with evidence excerpts and manual fields; they still need human editing before becoming polished long-form review reports.
- Candidate-paper search now has explainable ranking, duplicate reconciliation, configurable bounded citation-network expansion, saved manual review notes, structured full-text screening stages, exclusion reasons, high-confidence recommendation application, a screening board, an evidence-chain follow-up queue, source-evidence snippets, Zotero indexed full-text evidence snippets with hit context, matched annotation page labels, page-level PDF text locators from existing page text, local file paths, or in-memory PDF bytes through the local bridge, bounded OCR fallback for scanned PDFs, indexed-text locators, repeated page-header/footer cleanup, simple line-break dehyphenation, table-of-contents/reference noise downranking, best-effort page hints when indexed text preserves form-feed page breaks or standalone page markers such as `Page 12`, and short hashes for imported candidates with attached PDFs, plus a Markdown candidate-review report. Bridge-based page extraction still depends on accessible PDF bytes and local Poppler/Tesseract tools; full-document scanned OCR and unavailable-byte cases still need more work.
- The workbench UI is still being refined; some controls and settings are intentionally compact but may need more usability work.
- Raw PDF input depends on provider capability. Many providers still use extracted Zotero text instead.
- Local-agent calls depend on local CLI tools and their own authentication state.
- Live provider verification requires real API credentials and is not run by default.
- Zotero version coverage is currently focused on Zotero 9.x.

## TODO

- Improve cross-collection clustering and continue polishing the global synthesis map, recurring-gap and priority boards, collection-level synthesis claims, synthesis roadmaps, and report generation.
- Continue hardening chart digitization beyond the current prompt-level visual OCR contract, editable local OCR metadata, JSON/CSV table sidecar export, reviewable chart-data drafts, dense point-data draft parsing, model-estimated pixel/coordinate drafts, axis-calibration anchor export, linear axis-value inference, calibration-quality diagnostics, automatic quality review, and stateful chart review action queues; the next gaps are robust non-linear/segmented digitization and persisted review-state editing inside the workbench.
- Harden PDF page extraction beyond the current Zotero page text, local path/base64 bridge, and bounded OCR fallback path, especially full-document scanned OCR, attachments with unavailable bytes, OCR quality review, and no-bridge raw-byte extraction.
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
