#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { cwd as currentDirectory } from "node:process";
import { TextDecoder } from "node:util";

const decoder = new TextDecoder();
const inputChunks = [];
let transportMode = "header";
let activeRequests = 0;
let stdinEnded = false;

const GEMINI_BIN = process.env.LOCAL_AGENT_GEMINI_BIN || "/opt/homebrew/bin/gemini";
const CLAUDE_BIN = process.env.LOCAL_AGENT_CLAUDE_BIN || `${homedir()}/.local/bin/claude`;
const OPENCODE_BIN = process.env.LOCAL_AGENT_OPENCODE_BIN || "/opt/homebrew/bin/opencode";
const BREW_BIN = process.env.LOCAL_AGENT_BREW_BIN || "/opt/homebrew/bin/brew";
const TESSERACT_BIN = process.env.LOCAL_AGENT_TESSERACT_BIN || "/opt/homebrew/bin/tesseract";
const TESSERACT_LANG = process.env.LOCAL_AGENT_TESSERACT_LANG || "eng";
const PDFTOTEXT_BIN = process.env.LOCAL_AGENT_PDFTOTEXT_BIN || "/opt/homebrew/bin/pdftotext";
const PDFTOPPM_BIN = process.env.LOCAL_AGENT_PDFTOPPM_BIN || "/opt/homebrew/bin/pdftoppm";
const CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "NO_COLOR",
  "SSH_AUTH_SOCK",
  "DISPLAY",
  "__CF_USER_TEXT_ENCODING",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "LOCAL_AGENT_GEMINI_MODEL",
  "LOCAL_AGENT_OPENCODE_MODEL",
  "LOCAL_AGENT_OPENCODE_SPAWN_CWD",
  "LOCAL_AGENT_TESSERACT_BIN",
  "LOCAL_AGENT_TESSERACT_LANG",
  "LOCAL_AGENT_PDFTOTEXT_BIN",
  "LOCAL_AGENT_PDFTOPPM_BIN",
  "LOCAL_AGENT_MCP_MAX_TIMEOUT_SECONDS"
];

const tools = [
  {
    name: "ask_gemini",
    description: "Ask the local Gemini CLI for an independent answer or review.",
    inputSchema: promptSchema("Gemini")
  },
  {
    name: "ask_claude",
    description: "Ask the local Claude CLI for an independent answer or review.",
    inputSchema: promptSchema("Claude")
  },
  {
    name: "ask_opencode",
    description: "Ask the local opencode CLI for an independent answer or review.",
    inputSchema: promptSchema("opencode")
  },
  {
    name: "ask_all_agents",
    description: "Ask Gemini, Claude, and opencode with the same prompt and return their separate answers.",
    inputSchema: promptSchema("all local agents")
  },
  {
    name: "check_local_agents",
    description: "Check whether the local Gemini, Claude, and opencode CLIs are reachable from this session.",
    inputSchema: healthCheckSchema()
  },
  {
    name: "ocr_image",
    description: "Run local OCR on a base64 image using the local OCR CLI and return recognized text.",
    inputSchema: ocrImageSchema()
  },
  {
    name: "extract_pdf_pages",
    description: "Extract page-level text from a local PDF using pdftotext and return JSON page entries.",
    inputSchema: pdfPagesSchema()
  }
];

process.stdin.on("data", (chunk) => {
  inputChunks.push(chunk);
  readMessages();
});

process.stdin.on("end", () => {
  stdinEnded = true;
  maybeExit();
});

process.stderr.write(`[local-agent-mcp] ready ${randomUUID()}\n`);

function promptSchema(label) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: {
        type: "string",
        description: `Question or review request to send to ${label}.`
      },
      cwd: {
        type: "string",
        description: "Working directory for the CLI call. Defaults to the current directory."
      },
      model: {
        type: "string",
        description: "Optional model selector supported by the target CLI."
      },
      timeoutSeconds: {
        type: "number",
        description: "Timeout in seconds. Defaults to 180 and is capped at LOCAL_AGENT_MCP_MAX_TIMEOUT_SECONDS or 600."
      },
      agents: {
        type: "array",
        description: "Optional for ask_all_agents: limit the fan-out to gemini, claude, and/or opencode.",
        items: {
          type: "string",
          enum: ["gemini", "claude", "opencode"]
        }
      }
    },
    required: ["prompt"]
  };
}

function healthCheckSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      timeoutSeconds: {
        type: "number",
        description: "Per-agent smoke-test timeout in seconds. Defaults to 45 and is capped at 120."
      },
      agents: {
        type: "array",
        description: "Optional: limit health checks to gemini, claude, and/or opencode.",
        items: {
          type: "string",
          enum: ["gemini", "claude", "opencode"]
        }
      }
    },
    required: []
  };
}

function ocrImageSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      imageBase64: {
        type: "string",
        description: "Base64-encoded image bytes without a data URL prefix."
      },
      image: {
        type: "object",
        description: "Alternative image object with base64, mimeType, and name fields.",
        additionalProperties: true
      },
      mimeType: {
        type: "string",
        description: "Image MIME type, for example image/png."
      },
      name: {
        type: "string",
        description: "Optional image filename."
      },
      language: {
        type: "string",
        description: "Tesseract language list, for example eng or eng+chi_sim."
      },
      timeoutSeconds: {
        type: "number",
        description: "Timeout in seconds. Defaults to 30 and is capped at 120."
      }
    },
    required: []
  };
}

function pdfPagesSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      filePath: {
        type: "string",
        description: "Local PDF file path."
      },
      pdfBase64: {
        type: "string",
        description: "Base64-encoded PDF bytes without a data URL prefix."
      },
      pdf: {
        type: "object",
        description: "Alternative PDF object with path, filePath, base64, data, and name fields.",
        additionalProperties: true
      },
      name: {
        type: "string",
        description: "Optional PDF filename."
      },
      timeoutSeconds: {
        type: "number",
        description: "Timeout in seconds. Defaults to 45 and is capped at 180."
      },
      ocrFallback: {
        type: "boolean",
        description: "When true, render and OCR the first PDF pages if pdftotext returns little or no text."
      },
      ocrLanguage: {
        type: "string",
        description: "Tesseract language list for OCR fallback, for example eng or eng+chi_sim."
      },
      maxOcrPages: {
        type: "number",
        description: "Maximum number of pages to OCR during fallback. Defaults to 3 and is capped at 12."
      },
      minTextChars: {
        type: "number",
        description: "Minimum extracted character count before OCR fallback is skipped. Defaults to 40."
      }
    },
    required: []
  };
}

function readMessages() {
  let buffer = Buffer.concat(inputChunks);
  inputChunks.length = 0;

  while (buffer.length > 0) {
    let headerEnd = buffer.indexOf("\r\n\r\n");
    let separatorLength = 4;
    if (headerEnd === -1) {
      headerEnd = buffer.indexOf("\n\n");
      separatorLength = 2;
    }
    if (headerEnd === -1) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) break;
      const line = decoder.decode(buffer.subarray(0, lineEnd)).trim();
      if (line.startsWith("{")) {
        buffer = buffer.subarray(lineEnd + 1);
        transportMode = "line";
        handleRawMessage(line);
        continue;
      }
      break;
    }

    const header = decoder.decode(buffer.subarray(0, headerEnd));
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + separatorLength);
      continue;
    }

    const length = Number(match[1]);
    const messageStart = headerEnd + separatorLength;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) break;

    const body = decoder.decode(buffer.subarray(messageStart, messageEnd));
    buffer = buffer.subarray(messageEnd);
    handleRawMessage(body);
  }

  if (buffer.length > 0) inputChunks.push(buffer);
}

async function handleRawMessage(body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch (error) {
    sendError(null, -32700, error.message);
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;

  activeRequests += 1;
  try {
    const result = await route(message.method, message.params ?? {});
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    sendError(message.id, -32000, error.message || String(error));
  } finally {
    activeRequests -= 1;
    maybeExit();
  }
}

async function route(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: {
        name: "local-agent-mcp",
        version: "0.1.5"
      }
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools };
  if (method === "resources/list") return { resources: [] };
  if (method === "prompts/list") return { prompts: [] };
  if (method === "tools/call") {
    const result = await callTool(params.name, params.arguments ?? {});
    return { content: [{ type: "text", text: result }] };
  }
  throw new Error(`Unsupported method: ${method}`);
}

async function callTool(name, args) {
  if (name === "check_local_agents") return checkLocalAgents(args);
  if (name === "ocr_image") return ocrImage(args);
  if (name === "extract_pdf_pages") return extractPdfPages(args);

  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) throw new Error("prompt is required");

  if (name === "ask_gemini") return askGemini(args);
  if (name === "ask_claude") return askClaude(args);
  if (name === "ask_opencode") return askOpencode(args);
  if (name === "ask_all_agents") {
    const selected = selectedAgentEntries(args.agents);
    const fanoutArgs = allAgentCallArgs(args, selected.length);
    const settled = await settleAgentCalls(selected, fanoutArgs);
    const fulfilled = settled.filter((entry) => entry.status === "fulfilled" && String(entry.value || "").trim());
    if (!fulfilled.length) {
      throw new Error(`All local agents failed: ${selected.map((agent, index) => renderSettled(agent.label, settled[index])).join("\n\n")}`);
    }
    return selected.map((agent, index) => renderSettled(agent.label, settled[index])).join("\n\n");
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function ocrImage(args = {}) {
  const image = args.image && typeof args.image === "object" && !Array.isArray(args.image) ? args.image : {};
  const imageBase64 = String(args.imageBase64 || image.base64 || image.data || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!imageBase64) throw new Error("imageBase64 is required");
  const mimeType = String(args.mimeType || image.mimeType || image.type || "image/png").trim();
  const language = String(args.language || TESSERACT_LANG).replace(/[^A-Za-z0-9_+.-]+/g, "").slice(0, 80) || "eng";
  const ext = imageExtensionForMimeType(mimeType);
  const dir = await mkdtemp(join(tmpdir(), "zms-ocr-"));
  const imagePath = join(dir, `input.${ext}`);
  try {
    await writeFile(imagePath, Buffer.from(imageBase64, "base64"));
    const text = await runCommand(TESSERACT_BIN, [imagePath, "stdout", "-l", language], {
      cwd: dir,
      timeoutSeconds: ocrTimeoutSeconds(args.timeoutSeconds),
      requireOutput: false
    });
    return JSON.stringify({
      engine: "tesseract",
      language,
      mimeType,
      name: String(args.name || image.name || ""),
      text: cleanOutput(text)
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractPdfPages(args = {}) {
  const pdf = args.pdf && typeof args.pdf === "object" && !Array.isArray(args.pdf) ? args.pdf : {};
  const filePath = String(args.filePath || pdf.filePath || pdf.path || "").trim();
  const pdfBase64 = String(args.pdfBase64 || pdf.base64 || pdf.data || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!filePath && !pdfBase64) throw new Error("filePath or pdfBase64 is required");

  let dir = "";
  let sourcePath = filePath;
  let textError = null;
  try {
    if (!sourcePath) {
      dir = await mkdtemp(join(tmpdir(), "zms-pdf-text-"));
      sourcePath = join(dir, "input.pdf");
      await writeFile(sourcePath, Buffer.from(pdfBase64, "base64"));
    }
    let pages = [];
    try {
      const output = await runCommand(PDFTOTEXT_BIN, ["-layout", sourcePath, "-"], {
        cwd: dir || currentDirectory(),
        timeoutSeconds: pdfTextTimeoutSeconds(args.timeoutSeconds),
        requireOutput: false
      });
      pages = pdfPageEntriesFromText(output === "(empty response)" ? "" : output);
    } catch (error) {
      textError = error;
      if (!pdfOcrFallbackEnabled(args)) throw error;
    }
    if (shouldRunPdfOcrFallback(args, pages)) {
      const ocrPages = await extractPdfOcrPages(sourcePath, args);
      if (ocrPages.length) {
        return JSON.stringify(pdfPagesResult(args, pdf, filePath, "tesseract", ocrPages, {
          ocrFallbackUsed: true,
          textPageCount: pages.length,
          textError: textError ? cleanPdfPageText(textError.message || String(textError)).slice(0, 500) : ""
        }));
      }
    }
    if (textError) throw textError;
    return JSON.stringify(pdfPagesResult(args, pdf, filePath, "pdftotext", pages, {
      ocrFallbackUsed: shouldRunPdfOcrFallback(args, pages),
      textPageCount: pages.length
    }));
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

async function extractPdfOcrPages(sourcePath, args = {}) {
  const renderDir = await mkdtemp(join(tmpdir(), "zms-pdf-ocr-"));
  const prefix = join(renderDir, "page");
  const maxPages = pdfOcrMaxPages(args.maxOcrPages);
  const language = pdfOcrLanguage(args.ocrLanguage || args.language);
  try {
    await runCommand(PDFTOPPM_BIN, ["-png", "-r", "200", "-f", "1", "-l", String(maxPages), sourcePath, prefix], {
      cwd: renderDir,
      timeoutSeconds: pdfRenderTimeoutSeconds(args.timeoutSeconds),
      requireOutput: false
    });
    const rendered = await pdfRenderedImagePaths(renderDir);
    const pages = [];
    const pageTimeout = pdfOcrPageTimeoutSeconds(args.timeoutSeconds, maxPages);
    for (const imagePath of rendered.slice(0, maxPages)) {
      const page = pdfRenderedImagePage(imagePath) || (pages.length + 1);
      const text = await runCommand(TESSERACT_BIN, [imagePath, "stdout", "-l", language], {
        cwd: renderDir,
        timeoutSeconds: pageTimeout,
        requireOutput: false
      });
      const cleaned = cleanPdfPageText(text === "(empty response)" ? "" : text);
      if (cleaned) {
        pages.push({
          page,
          pageLabel: String(page),
          text: cleaned
        });
      }
    }
    return pages;
  } finally {
    await rm(renderDir, { recursive: true, force: true });
  }
}

function pdfPagesResult(args, pdf, filePath, engine, pages, extra = {}) {
  return {
    engine,
    name: String(args.name || pdf.name || (filePath ? basename(filePath) : "input.pdf")),
    pageCount: pages.length,
    pages,
    ...extra
  };
}

function imageExtensionForMimeType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("tiff")) return "tif";
  return "png";
}

function ocrTimeoutSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(Math.max(Math.round(parsed), 5), 120);
}

function pdfTextTimeoutSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 45;
  return Math.min(Math.max(Math.round(parsed), 5), 180);
}

function pdfRenderTimeoutSeconds(value) {
  return Math.min(pdfTextTimeoutSeconds(value), 60);
}

function pdfOcrPageTimeoutSeconds(value, maxPages) {
  const total = pdfTextTimeoutSeconds(value);
  const pages = Math.max(1, Number(maxPages) || 1);
  return Math.min(Math.max(Math.floor(total / pages), 5), 60);
}

function pdfOcrFallbackEnabled(args = {}) {
  return args.ocrFallback === true || args.ocrFallback === "true" || args.ocrFallback === 1;
}

function shouldRunPdfOcrFallback(args = {}, pages = []) {
  if (!pdfOcrFallbackEnabled(args)) return false;
  return pdfPagesTotalTextLength(pages) < pdfOcrFallbackMinChars(args.minTextChars);
}

function pdfOcrFallbackMinChars(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 40;
  return Math.min(Math.round(parsed), 1000);
}

function pdfOcrMaxPages(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3;
  return Math.min(Math.max(Math.round(parsed), 1), 12);
}

function pdfOcrLanguage(value) {
  return String(value || TESSERACT_LANG).replace(/[^A-Za-z0-9_+.-]+/g, "").slice(0, 80) || "eng";
}

function pdfPagesTotalTextLength(pages = []) {
  return (pages || []).reduce((total, page) => total + String(page?.text || "").trim().length, 0);
}

async function pdfRenderedImagePaths(renderDir) {
  const files = await readdir(renderDir);
  return files
    .filter((file) => /\.(?:png|jpe?g|tiff?)$/i.test(file))
    .map((file) => join(renderDir, file))
    .sort((left, right) => pdfRenderedImagePage(left) - pdfRenderedImagePage(right));
}

function pdfRenderedImagePage(path) {
  const match = String(path || "").match(/-(\d+)\.[^.]+$/);
  return match ? Number(match[1]) : 0;
}

function pdfPageEntriesFromText(text) {
  return String(text || "")
    .split(/\f+/)
    .map((pageText, index) => ({
      page: index + 1,
      pageLabel: String(index + 1),
      text: cleanPdfPageText(pageText)
    }))
    .filter((entry) => entry.text);
}

function cleanPdfPageText(pageText) {
  return String(pageText || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

async function settleAgentCalls(selected, args) {
  const settled = [];
  for (const agent of selected) {
    try {
      settled.push({ status: "fulfilled", value: await agent.run(args) });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }
  return settled;
}

function allAgentCallArgs(args, agentCount = 1) {
  return {
    ...args,
    timeoutSeconds: allAgentTimeoutSeconds(args.timeoutSeconds, agentCount)
  };
}

function allAgentTimeoutSeconds(value, agentCount = 1) {
  const maxTimeoutSeconds = Math.min(Math.max(Number(process.env.LOCAL_AGENT_MCP_MAX_TIMEOUT_SECONDS) || 600, 5), 600);
  const parsed = Number(value);
  const outerTimeout = Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.max(Math.round(parsed), 5), maxTimeoutSeconds)
    : Math.min(180, maxTimeoutSeconds);
  if (outerTimeout <= 10) return 5;
  const calls = Math.max(1, Math.round(Number(agentCount) || 1));
  const sequentialBudget = Math.floor((outerTimeout - 5) / calls);
  return Math.max(5, Math.min(outerTimeout - 5, sequentialBudget));
}

function selectedAgentEntries(value) {
  const entries = [
    { id: "gemini", label: "Gemini", run: askGemini, probe: () => probeCli(GEMINI_BIN, ["--version"]) },
    { id: "claude", label: "Claude", run: askClaude, probe: () => probeCli(CLAUDE_BIN, ["--version"]) },
    { id: "opencode", label: "opencode", run: askOpencode, probe: () => probeOpencodeCli(["--version"]) }
  ];
  if (value === undefined || value === null || value === "" || value === "all") return entries;
  const raw = Array.isArray(value) ? value : String(value).split(/[,\s]+/);
  const wanted = new Set(raw.map(normalizeAgentName).filter(Boolean));
  if (wanted.has("all")) return entries;
  const selected = entries.filter((entry) => wanted.has(entry.id));
  if (!selected.length) {
    throw new Error("agents must include at least one of: gemini, claude, opencode");
  }
  return selected;
}

function normalizeAgentName(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return "";
  if (normalized === "all") return "all";
  if (normalized === "gemini" || normalized === "google") return "gemini";
  if (normalized === "claude" || normalized === "anthropic") return "claude";
  if (normalized === "opencode" || normalized === "open_code") return "opencode";
  return normalized;
}

async function checkLocalAgents(args = {}) {
  const selected = selectedAgentEntries(args.agents);
  const timeoutSeconds = healthCheckTimeoutSeconds(args.timeoutSeconds);
  const smokeArgs = {
    prompt: "Reply exactly: OK",
    cwd: currentDirectory(),
    timeoutSeconds
  };
  const versionChecksPromise = Promise.allSettled(selected.map((agent) => agent.probe()));
  const smokeChecksPromise = Promise.allSettled(selected.map((agent) => {
    const model = agent.id === "gemini" ? { model: "gemini-2.5-flash" } : {};
    return agent.run({ ...smokeArgs, ...model });
  }));
  const [versionChecks, smokeChecks] = await Promise.all([versionChecksPromise, smokeChecksPromise]);
  return [
    "# CLI versions",
    ...selected.map((agent, index) => renderSettled(agent.label, versionChecks[index])),
    "# Answer smoke test",
    ...selected.map((agent, index) => renderSettled(agent.label, smokeChecks[index]))
  ].join("\n\n");
}

function healthCheckTimeoutSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 45;
  return Math.min(Math.max(Math.round(parsed), 5), 120);
}

function renderSettled(label, settled) {
  if (settled.status === "fulfilled") return `## ${label}\n${settled.value}`;
  return `## ${label}\nERROR: ${settled.reason?.message || String(settled.reason)}`;
}

function probeCli(command, args) {
  return runCommand(command, args, { timeoutSeconds: 10, cwd: currentDirectory() });
}

function probeOpencodeCli(args) {
  if (args?.includes("--version")) return probeOpencodeAvailability();
  return runCommand(OPENCODE_BIN, args, { timeoutSeconds: 10, cwd: opencodeSpawnDirectory() });
}

async function probeOpencodeAvailability() {
  try {
    return await runCommand(BREW_BIN, ["list", "--versions", "opencode"], {
      timeoutSeconds: 10,
      cwd: opencodeSpawnDirectory(),
      requireOutput: true
    });
  } catch {
    return runCommand("/bin/test", ["-x", OPENCODE_BIN], {
      timeoutSeconds: 10,
      cwd: opencodeSpawnDirectory()
    }).then(() => `opencode available at ${OPENCODE_BIN}`);
  }
}

function askGemini(args) {
  const commandArgs = [
    "-p",
    args.prompt,
    "--output-format",
    "text",
    "--skip-trust",
    "--allowed-mcp-server-names",
    "none"
  ];
  const model = args.model || process.env.LOCAL_AGENT_GEMINI_MODEL || "gemini-2.5-flash";
  if (model) commandArgs.push("--model", String(model));
  return runCommand(GEMINI_BIN, commandArgs, { ...args, requireOutput: true, retries: 2 });
}

function askClaude(args) {
  const commandArgs = [
    "-p",
    args.prompt,
    "--output-format",
    "text",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--mcp-config",
    "{\"mcpServers\":{}}",
    "--tools",
    ""
  ];
  if (args.model) commandArgs.push("--model", String(args.model));
  return runCommand(CLAUDE_BIN, commandArgs, { ...args, requireOutput: true, retries: 2 });
}

function askOpencode(args) {
  const commandArgs = [
    "run",
    "--pure",
    "--dir",
    workingDirectory(args.cwd),
    args.prompt
  ];
  const model = args.model || process.env.LOCAL_AGENT_OPENCODE_MODEL || "github-copilot/claude-haiku-4.5";
  if (model) commandArgs.splice(2, 0, "--model", String(model));
  return runCommand(OPENCODE_BIN, commandArgs, {
    ...args,
    cwd: opencodeSpawnDirectory(),
    requireOutput: true,
    retries: 2
  });
}

async function runCommand(command, args, options) {
  const attempts = Math.min(Math.max(Number(options.retries) || 1, 1), 3);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await runCommandOnce(command, args, options);
    } catch (error) {
      lastError = error;
      if (!shouldRetryCommandError(error) || attempt === attempts - 1) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

function shouldRetryCommandError(error) {
  const message = error?.message || String(error || "");
  return /empty response|EINTR|interrupted system call|uv_cwd/i.test(message);
}

function runCommandOnce(command, args, options) {
  const maxTimeoutSeconds = Math.min(Math.max(Number(process.env.LOCAL_AGENT_MCP_MAX_TIMEOUT_SECONDS) || 600, 5), 600);
  const timeout = Math.min(Math.max(Number(options.timeoutSeconds) || 180, 5), maxTimeoutSeconds) * 1000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory(options.cwd),
      stdio: ["ignore", "pipe", "pipe"],
      env: commandEnvironment()
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`CLI call timed out after ${timeout / 1000}s`));
    }, timeout);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024 * 8) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 1024 * 1024 * 8) child.kill("SIGTERM");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const cleanStdout = cleanOutput(stdout);
      const cleanStderr = cleanOutput(stderr);
      if (code !== 0) {
        const prefix = signal ? `CLI call ended with ${signal}` : `CLI call exited with code ${code}`;
        reject(new Error([prefix, cleanStdout, cleanStderr].filter(Boolean).join("\n")));
        return;
      }
      const output = cleanStdout || cleanStderr;
      if (!output && options.requireOutput) {
        reject(new Error("CLI returned empty response"));
        return;
      }
      resolve(output || "(empty response)");
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function workingDirectory(value) {
  return value ? String(value) : currentDirectory();
}

function opencodeSpawnDirectory() {
  return process.env.LOCAL_AGENT_OPENCODE_SPAWN_CWD || homedir();
}

function commandEnvironment() {
  const env = {};
  for (const key of CHILD_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== "") {
      env[key] = process.env[key];
    }
  }
  env.PATH = env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  env.HOME = env.HOME || homedir();
  env.USER = env.USER || env.LOGNAME || homedir().split("/").filter(Boolean).pop() || "user";
  env.LOGNAME = env.LOGNAME || env.USER;
  env.SHELL = env.SHELL || "/bin/zsh";
  env.TMPDIR = env.TMPDIR || "/tmp";
  env.LANG = env.LANG || "C.UTF-8";
  env.LC_ALL = env.LC_ALL || env.LANG;
  env.LC_CTYPE = env.LC_CTYPE || env.LANG;
  env.NO_COLOR = "1";
  env.TERM = env.TERM || "dumb";
  return env;
}

function cleanOutput(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter((line) => !/^>\s+build\s+·/.test(line.trim()))
    .join("\n")
    .trim();
}

function sendError(id, code, message) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  });
}

function send(message) {
  const payload = JSON.stringify(message);
  if (transportMode === "line") {
    process.stdout.write(`${payload}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

function maybeExit() {
  if (stdinEnded && activeRequests === 0 && inputChunks.length === 0) {
    process.exit(0);
  }
}
