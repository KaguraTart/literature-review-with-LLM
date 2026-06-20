#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3333;
const DEFAULT_MCP_COMMAND = `${homedir()}/.local/bin/local-agent-mcp.mjs`;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const options = parseArgs(process.argv.slice(2));

const server = createServer(async (request, response) => {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== "POST" || new URL(request.url || "/", "http://localhost").pathname !== options.path) {
    writeJSON(response, 404, { error: "Not found" });
    return;
  }
  try {
    const bodyText = await readBody(request);
    const payload = JSON.parse(bodyText || "{}");
    const result = await forwardToStdioMcp(payload, options);
    writeJSON(response, 200, result);
  } catch (error) {
    writeJSON(response, 500, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: error?.message || String(error)
      }
    });
  }
});

server.listen(options.port, options.host, () => {
  process.stderr.write(`local-agent HTTP bridge listening on http://${options.host}:${options.port}${options.path}\n`);
});

function parseArgs(args) {
  const parsed = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    path: "/mcp",
    command: process.env.LOCAL_AGENT_MCP_COMMAND || DEFAULT_MCP_COMMAND,
    cwd: process.env.LOCAL_AGENT_BRIDGE_CWD || homedir(),
    timeoutMs: Number(process.env.LOCAL_AGENT_HTTP_TIMEOUT_MS) || 180000
  };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--host" && value) {
      parsed.host = value;
      index += 1;
    } else if (key === "--port" && value) {
      parsed.port = Number(value) || parsed.port;
      index += 1;
    } else if (key === "--path" && value) {
      parsed.path = value.startsWith("/") ? value : `/${value}`;
      index += 1;
    } else if (key === "--mcp-command" && value) {
      parsed.command = value;
      index += 1;
    } else if (key === "--cwd" && value) {
      parsed.cwd = value;
      index += 1;
    } else if (key === "--timeout-ms" && value) {
      parsed.timeoutMs = Number(value) || parsed.timeoutMs;
      index += 1;
    }
  }
  return parsed;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function forwardToStdioMcp(payload, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, [], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Timed out after ${options.timeoutMs}ms`));
    }, Math.max(options.timeoutMs, 5000));

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      const message = readFirstFramedMessage(stdout);
      if (message) {
        child.kill();
        finish(resolve, message);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(reject, error));
    child.on("exit", (code) => {
      if (settled) return;
      const message = readFirstFramedMessage(stdout);
      if (message) {
        finish(resolve, message);
        return;
      }
      finish(reject, new Error(stderr.trim() || `MCP process exited with code ${code}`));
    });

    const text = JSON.stringify(payload);
    child.stdin.end(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
  });
}

function readFirstFramedMessage(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return null;
  const header = buffer.subarray(0, headerEnd).toString("utf8");
  const match = /^Content-Length:\s*(\d+)$/im.exec(header);
  if (!match) return null;
  const length = Number(match[1]);
  const start = headerEnd + 4;
  const end = start + length;
  if (buffer.length < end) return null;
  return JSON.parse(buffer.subarray(start, end).toString("utf8"));
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, authorization");
}

function writeJSON(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
