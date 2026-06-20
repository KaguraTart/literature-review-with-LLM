import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("local agent stdio MCP runtime", () => {
  it("is valid JavaScript", () => {
    execFileSync(process.execPath, ["--check", "scripts/local-agent-mcp.mjs"], { encoding: "utf8" });
  });

  it("handles fragmented Content-Length headers", async () => {
    const runtime = startRuntime();
    try {
      const responsePromise = runtime.nextMessage();
      runtime.writeFramed({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, 12);
      const response = await responsePromise;

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          serverInfo: { name: "local-agent-mcp" },
          capabilities: { tools: {} }
        }
      });
    } finally {
      runtime.stop();
    }
  });

  it("lists callable local agent tools with bounded check schema", async () => {
    const runtime = startRuntime();
    try {
      const responsePromise = runtime.nextMessage();
      runtime.writeFramed({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const response = await responsePromise;
      const tools = response.result.tools;
      const names = tools.map((tool: any) => tool.name);

      expect(names).toEqual([
        "ask_gemini",
        "ask_claude",
        "ask_opencode",
        "ask_all_agents",
        "check_local_agents",
        "ocr_image",
        "extract_pdf_pages"
      ]);
      expect(tools.find((tool: any) => tool.name === "check_local_agents").inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
        properties: {
          timeoutSeconds: { type: "number" },
          agents: {
            type: "array",
            items: { enum: ["gemini", "claude", "opencode"] }
          }
        },
        required: []
      });
      expect(tools.find((tool: any) => tool.name === "ask_claude").inputSchema.required).toEqual(["prompt"]);
      expect(tools.find((tool: any) => tool.name === "ask_all_agents").inputSchema.properties.agents).toMatchObject({
        type: "array",
        items: {
          enum: ["gemini", "claude", "opencode"]
        }
      });
      expect(tools.find((tool: any) => tool.name === "ocr_image").inputSchema.properties.imageBase64).toMatchObject({
        type: "string"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.filePath).toMatchObject({
        type: "string"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.pdfBase64).toMatchObject({
        type: "string"
      });
    } finally {
      runtime.stop();
    }
  });

  it("runs local OCR through the configured image OCR CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const tesseractBin = fakeBin(dir, "tesseract", "Axis Delay 12 ms");
      const runtime = startRuntime({
        LOCAL_AGENT_TESSERACT_BIN: tesseractBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: {
            name: "ocr_image",
            arguments: {
              imageBase64: Buffer.from("fake image").toString("base64"),
              mimeType: "image/png",
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "tesseract",
          language: "eng",
          mimeType: "image/png",
          text: "Axis Delay 12 ms"
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts page-level PDF text through the configured pdftotext CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const pdftotextBin = fakeBin(
        dir,
        "pdftotext",
        "The proposed method uses graph attention.\fExperiments evaluate delay metrics."
      );
      const runtime = startRuntime({
        LOCAL_AGENT_PDFTOTEXT_BIN: pdftotextBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "extract_pdf_pages",
            arguments: {
              pdfBase64: Buffer.from("%PDF fake").toString("base64"),
              name: "candidate.pdf",
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "pdftotext",
          name: "candidate.pdf",
          pageCount: 2,
          pages: [
            {
              page: 1,
              pageLabel: "1",
              text: "The proposed method uses graph attention."
            },
            {
              page: 2,
              pageLabel: "2",
              text: "Experiments evaluate delay metrics."
            }
          ]
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("limits check_local_agents health checks to requested agents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini health OK");
      const claudeBin = fakeBin(dir, "claude", "Claude should not run", 1);
      const opencodeBin = fakeBin(dir, "opencode", "opencode should not run", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "check_local_agents",
            arguments: {
              agents: ["gemini"],
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini health OK");
        expect(text).not.toContain("## Claude");
        expect(text).not.toContain("## opencode");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns partial ask_all_agents output when one CLI fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini partial answer");
      const claudeBin = fakeBin(dir, "claude", "Claude partial answer");
      const opencodeBin = fakeBin(dir, "opencode", "quota_exceeded", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini partial answer");
        expect(text).toContain("## Claude\nClaude partial answer");
        expect(text).toContain("## opencode\nERROR:");
        expect(text).toContain("quota_exceeded");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an MCP error when every selected ask_all_agents CLI fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini failed", 1);
      const claudeBin = fakeBin(dir, "claude", "Claude failed", 1);
      const opencodeBin = fakeBin(dir, "opencode", "opencode should not run", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              agents: ["gemini", "claude"],
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;

        expect(response.error).toMatchObject({
          code: -32000
        });
        expect(response.error.message).toContain("All local agents failed");
        expect(response.error.message).toContain("Gemini failed");
        expect(response.error.message).toContain("Claude failed");
        expect(response).not.toHaveProperty("result");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns partial ask_all_agents output before the outer timeout when one CLI hangs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini before hang");
      const claudeBin = fakeBin(dir, "claude", "Claude before hang");
      const opencodeBin = slowBin(dir, "opencode", 20000, "opencode too late");
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage(9000);
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 10
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini before hang");
        expect(text).toContain("## Claude\nClaude before hang");
        expect(text).toContain("## opencode\nERROR: CLI call timed out after 5s");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);

  it("limits ask_all_agents fan-out to the requested agents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini selected");
      const claudeBin = fakeBin(dir, "claude", "Claude selected");
      const opencodeBin = fakeBin(dir, "opencode", "opencode should not run", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              agents: ["gemini", "claude"],
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini selected");
        expect(text).toContain("## Claude\nClaude selected");
        expect(text).not.toContain("## opencode");
        expect(text).not.toContain("opencode should not run");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retries transient CLI cwd errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = flakyBin(dir, "gemini", "Gemini recovered after retry");
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "ask_gemini",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;

        expect(response.result.content[0].text).toBe("Gemini recovered after retry");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not pass launchd XPC variables to child CLIs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = envProbeBin(dir, "gemini", "XPC_SERVICE_NAME");
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        XPC_SERVICE_NAME: "local.test.service"
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "ask_gemini",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;

        expect(response.result.content[0].text).toBe("clean");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function startRuntime(env: Record<string, string> = {}) {
  const child = spawn(process.execPath, ["scripts/local-agent-mcp.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env
    }
  });
  let buffer = Buffer.alloc(0);
  const pending: Array<(message: any) => void> = [];
  const messages: any[] = [];

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const message = readFramedMessage();
      if (!message) break;
      const resolve = pending.shift();
      if (resolve) resolve(message);
      else messages.push(message);
    }
  });

  return {
    writeFramed(payload: any, splitAt = 0) {
      const text = JSON.stringify(payload);
      const frame = `Content-Length: ${Buffer.byteLength(text, "utf8")}\r\n\r\n${text}`;
      if (splitAt > 0) {
        child.stdin.write(frame.slice(0, splitAt));
        setTimeout(() => child.stdin.write(frame.slice(splitAt)), 10);
        return;
      }
      child.stdin.write(frame);
    },
    nextMessage(timeoutMs = 5000) {
      const message = messages.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for MCP response")), timeoutMs);
        pending.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    },
    stop() {
      child.kill();
    }
  };

  function readFramedMessage() {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return null;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) return null;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    const end = start + length;
    if (buffer.length < end) return null;
    const message = JSON.parse(buffer.subarray(start, end).toString("utf8"));
    buffer = buffer.subarray(end);
    return message;
  }
}

function fakeBin(dir: string, name: string, output: string, code = 0) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    code === 0
      ? `process.stdout.write(${JSON.stringify(output)});`
      : `process.stderr.write(${JSON.stringify(output)});`,
    `process.exit(${code});`,
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function flakyBin(dir: string, name: string, output: string) {
  const path = join(dir, name);
  const marker = join(dir, `${name}.called`);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const marker = ${JSON.stringify(marker)};`,
    "if (!fs.existsSync(marker)) {",
    "  fs.writeFileSync(marker, '1');",
    "  process.stderr.write('Error: EINTR: process.cwd failed with error interrupted system call, uv_cwd');",
    "  process.exit(1);",
    "}",
    `process.stdout.write(${JSON.stringify(output)});`,
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function slowBin(dir: string, name: string, delayMs: number, output: string) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    `setTimeout(() => process.stdout.write(${JSON.stringify(output)}), ${delayMs});`,
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function envProbeBin(dir: string, name: string, key: string) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    `const key = ${JSON.stringify(key)};`,
    "process.stdout.write(process.env[key] || 'clean');",
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}
