#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const LABEL = "local.zotero-markdown-summary.local-agent-bridge";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3333;
const DEFAULT_PATH = "/mcp";
const DEFAULT_MCP_COMMAND = `${homedir()}/.local/bin/local-agent-mcp.mjs`;
const DEFAULT_PATH_ENV = "/opt/homebrew/bin:/Users/tart/.local/bin:/usr/local/bin:/usr/bin:/bin";
const SAFE_INHERITED_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSH_AUTH_SOCK",
    "DISPLAY",
    "SSL_CERT_FILE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
  "LOCAL_AGENT_GEMINI_MODEL",
  "LOCAL_AGENT_OPENCODE_MODEL",
  "LOCAL_AGENT_OPENCODE_SPAWN_CWD",
  "LOCAL_AGENT_TESSERACT_BIN",
  "LOCAL_AGENT_TESSERACT_LANG",
  "LOCAL_AGENT_MCP_MAX_TIMEOUT_SECONDS",
  "LOCAL_AGENT_HTTP_TIMEOUT_MS"
];

const command = process.argv[2] || "status";
const options = parseArgs(process.argv.slice(3));

try {
  if (command === "install") installService(options);
  else if (command === "start") startService(options);
  else if (command === "stop") stopService(options);
  else if (command === "restart") restartService(options);
  else if (command === "status") statusService(options);
  else if (command === "uninstall") uninstallService(options);
  else if (command === "check") await checkService(options);
  else if (command === "print-plist") process.stdout.write(servicePlist(options));
  else usage(2);
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const projectDir = resolve(process.cwd());
  const parsed = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    path: DEFAULT_PATH,
    mcpCommand: process.env.LOCAL_AGENT_MCP_COMMAND || DEFAULT_MCP_COMMAND,
    projectDir,
    sourceBridgeScript: resolve(projectDir, "scripts/local-agent-http-bridge.mjs"),
    sourceMcpScript: resolve(projectDir, "scripts/local-agent-mcp.mjs"),
    bridgeScript: `${homedir()}/.local/share/zotero-markdown-summary/local-agent-http-bridge.mjs`,
    bridgeCwd: homedir(),
    workingDirectory: homedir(),
    plistPath: `${homedir()}/Library/LaunchAgents/${LABEL}.plist`,
    stdoutPath: `${homedir()}/Library/Logs/zotero-markdown-summary-local-agent-bridge.out.log`,
    stderrPath: `${homedir()}/Library/Logs/zotero-markdown-summary-local-agent-bridge.err.log`,
    nodePath: process.execPath,
    pathEnv: process.env.LOCAL_AGENT_BRIDGE_PATH_ENV || DEFAULT_PATH_ENV,
    checkDeep: false,
    checkAgents: [],
    checkTimeoutMs: Math.max(Number(process.env.LOCAL_AGENT_SERVICE_CHECK_TIMEOUT_MS) || 30000, 5000),
    checkTimeoutExplicit: !!Number(process.env.LOCAL_AGENT_SERVICE_CHECK_TIMEOUT_MS),
    extraEnv: {}
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
      parsed.mcpCommand = value;
      index += 1;
    } else if (key === "--project-dir" && value) {
      parsed.projectDir = resolve(value);
      parsed.sourceBridgeScript = resolve(value, "scripts/local-agent-http-bridge.mjs");
      parsed.sourceMcpScript = resolve(value, "scripts/local-agent-mcp.mjs");
      index += 1;
    } else if (key === "--bridge-cwd" && value) {
      parsed.bridgeCwd = resolve(value);
      index += 1;
    } else if (key === "--plist" && value) {
      parsed.plistPath = resolve(value);
      index += 1;
    } else if (key === "--node" && value) {
      parsed.nodePath = value;
      index += 1;
    } else if (key === "--path-env" && value) {
      parsed.pathEnv = value;
      index += 1;
    } else if (key === "--deep") {
      parsed.checkDeep = true;
    } else if (key === "--agents" && value) {
      parsed.checkAgents = parseAgents(value);
      index += 1;
    } else if (key === "--timeout-ms" && value) {
      parsed.checkTimeoutMs = Math.max(Number(value) || parsed.checkTimeoutMs, 5000);
      parsed.checkTimeoutExplicit = true;
      index += 1;
    } else if (key === "--env" && value) {
      const [name, envValue] = parseEnvAssignment(value);
      parsed.extraEnv[name] = envValue;
      index += 1;
    } else {
      usage(2);
    }
  }
  if (parsed.checkDeep && !parsed.checkTimeoutExplicit) {
    parsed.checkTimeoutMs = 180000;
  }
  return parsed;
}

function installService(options) {
  installBridgeRuntime(options);
  mkdirSync(dirname(options.plistPath), { recursive: true });
  mkdirSync(dirname(options.stdoutPath), { recursive: true });
  writeFileSync(options.plistPath, servicePlist(options));
  const target = launchctlTarget();
  runLaunchctl(["bootout", target, options.plistPath], { ignoreFailure: true });
  runLaunchctl(["bootstrap", target, options.plistPath]);
  runLaunchctl(["enable", `${target}/${LABEL}`], { ignoreFailure: true });
  runLaunchctl(["kickstart", "-k", `${target}/${LABEL}`], { ignoreFailure: true });
  process.stdout.write(`Installed ${LABEL}\n${options.plistPath}\n`);
}

function startService(options) {
  if (!existsSync(options.plistPath)) installService(options);
  else {
    if (!isServiceLoaded()) runLaunchctl(["bootstrap", launchctlTarget(), options.plistPath]);
    runLaunchctl(["kickstart", "-k", serviceSpecifier()]);
  }
  statusService(options);
}

function stopService(_options) {
  runLaunchctl(["bootout", serviceSpecifier()], { ignoreFailure: true });
  process.stdout.write(`Stopped ${LABEL}\n`);
}

function restartService(options) {
  stopService(options);
  startService(options);
}

function uninstallService(options) {
  stopService(options);
  if (existsSync(options.plistPath)) unlinkSync(options.plistPath);
  process.stdout.write(`Uninstalled ${LABEL}\n`);
}

function statusService(options) {
  const result = spawnSync("launchctl", ["print", `${launchctlTarget()}/${LABEL}`], { encoding: "utf8" });
  const loaded = result.status === 0;
  const stateMatch = loaded ? /^\s*state = (.+)$/m.exec(result.stdout || "") : null;
  process.stdout.write(JSON.stringify({
    label: LABEL,
    loaded,
    state: stateMatch?.[1]?.trim() || "",
    plistPath: options.plistPath,
    endpoint: `http://${options.host}:${options.port}${options.path}`,
    mcpCommand: options.mcpCommand,
    bridgeScript: options.bridgeScript
  }, null, 2));
  process.stdout.write("\n");
}

async function checkService(options) {
  const endpoint = endpointUrl(options);
  const initialize = await postJsonRpc(endpoint, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "local-agent-service-check",
        version: "0.1.1"
      }
    }
  }, options);
  const toolsList = await postJsonRpc(endpoint, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  }, options);
  const localAgentSummary = options.checkDeep
    ? summarizeLocalAgentCheck(extractToolText(await postJsonRpc(endpoint, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "check_local_agents",
        arguments: localAgentCheckArguments(options)
      }
    }, options)), options.checkAgents)
    : skippedLocalAgentCheck(options.checkAgents);
  const toolNames = toolsList?.result?.tools?.map((tool) => tool.name).filter(Boolean) || [];
  const summary = {
    endpoint,
    mode: options.checkDeep ? "deep" : "quick",
    timeoutMs: options.checkTimeoutMs,
    initialize: {
      ok: !initialize.error,
      serverName: initialize?.result?.serverInfo?.name || "",
      error: initialize?.error?.message || "",
      protocolVersion: initialize?.result?.protocolVersion || ""
    },
    tools: {
      ok: !toolsList.error && toolNames.includes("check_local_agents"),
      error: toolsList?.error?.message || "",
      names: toolNames
    },
    localAgents: localAgentSummary
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.initialize.ok || !summary.tools.ok || (options.checkDeep && !summary.localAgents.ok)) {
    process.exitCode = 1;
  }
}

function servicePlist(options) {
  if (!existsSync(options.bridgeScript)) assertBridgeScript(options.sourceBridgeScript);
  const args = [
    options.nodePath,
    options.bridgeScript,
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--path",
    options.path,
    "--mcp-command",
    options.mcpCommand,
    "--cwd",
    options.bridgeCwd
  ];
  const env = serviceEnvironment(options);
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlEscape(LABEL)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${xmlEscape(arg)}</string>`),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${xmlEscape(options.workingDirectory)}</string>`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...Object.entries(env).flatMap(([key, value]) => [
      `    <key>${xmlEscape(key)}</key>`,
      `    <string>${xmlEscape(value)}</string>`
    ]),
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(options.stdoutPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(options.stderrPath)}</string>`,
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}

function installBridgeRuntime(options) {
  assertBridgeScript(options.sourceBridgeScript);
  assertMcpScript(options.sourceMcpScript);
  mkdirSync(dirname(options.bridgeScript), { recursive: true });
  copyFileSync(options.sourceBridgeScript, options.bridgeScript);
  chmodSync(options.bridgeScript, 0o755);
  if (options.mcpCommand === DEFAULT_MCP_COMMAND) {
    mkdirSync(dirname(DEFAULT_MCP_COMMAND), { recursive: true });
    copyFileSync(options.sourceMcpScript, DEFAULT_MCP_COMMAND);
    chmodSync(DEFAULT_MCP_COMMAND, 0o755);
  }
}

function serviceEnvironment(options) {
  const userName = process.env.USER || process.env.LOGNAME || homedir().split("/").filter(Boolean).pop() || "user";
  const env = {
    PATH: options.pathEnv,
    HOME: process.env.HOME || homedir(),
    USER: userName,
    LOGNAME: process.env.LOGNAME || userName,
    SHELL: process.env.SHELL || "/bin/zsh",
    TMPDIR: process.env.TMPDIR || "/tmp",
    TERM: process.env.TERM || "dumb",
    LANG: process.env.LANG || "C.UTF-8",
    NO_COLOR: "1",
    LOCAL_AGENT_MCP_COMMAND: options.mcpCommand,
    LOCAL_AGENT_BRIDGE_CWD: options.bridgeCwd,
    LOCAL_AGENT_OPENCODE_SPAWN_CWD: options.workingDirectory
  };
  const allowlist = new Set([
    ...SAFE_INHERITED_ENV_KEYS,
    ...String(process.env.LOCAL_AGENT_BRIDGE_ENV_ALLOWLIST || "")
      .split(/[,\s]+/)
      .map((key) => key.trim())
      .filter(Boolean)
  ]);
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== "") {
      env[key] = process.env[key];
    }
  }
  for (const [key, value] of Object.entries(options.extraEnv || {})) {
    env[key] = value;
  }
  return env;
}

function assertBridgeScript(path) {
  if (!existsSync(path)) throw new Error(`Missing bridge script: ${path}`);
  const text = readFileSync(path, "utf8");
  if (!text.includes("local-agent HTTP bridge listening")) {
    throw new Error(`Unexpected bridge script: ${path}`);
  }
}

function assertMcpScript(path) {
  if (!existsSync(path)) throw new Error(`Missing MCP script: ${path}`);
  const text = readFileSync(path, "utf8");
  if (!text.includes("local-agent-mcp") || !text.includes("ask_gemini")) {
    throw new Error(`Unexpected MCP script: ${path}`);
  }
}

function launchctlTarget() {
  return `gui/${process.getuid()}`;
}

function serviceSpecifier() {
  return `${launchctlTarget()}/${LABEL}`;
}

function isServiceLoaded() {
  return spawnSync("launchctl", ["print", serviceSpecifier()], { stdio: "ignore" }).status === 0;
}

function runLaunchctl(args, options = {}) {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (result.status !== 0 && !options.ignoreFailure) {
    throw new Error((result.stderr || result.stdout || `launchctl ${args.join(" ")} failed`).trim());
  }
  return result;
}

async function postJsonRpc(endpoint, payload, options) {
  const timeoutMs = options.checkTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: { message: text || `HTTP ${response.status}` } };
    }
    if (!response.ok) {
      return {
        error: {
          message: body?.error?.message || `HTTP ${response.status}`
        }
      };
    }
    return body;
  } catch (error) {
    return {
      error: {
        message: error?.name === "AbortError"
          ? `Timed out after ${timeoutMs}ms`
          : error?.message || String(error)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractToolText(response) {
  if (response?.error) return `ERROR: ${response.error.message || "tools/call failed"}`;
  return response?.result?.content
    ?.filter((item) => item?.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim() || "";
}

function localAgentCheckArguments(options) {
  const seconds = Math.floor((Number(options.checkTimeoutMs) || 30000) / 1000) - 5;
  const args = {
    timeoutSeconds: Math.min(Math.max(seconds, 5), 120)
  };
  if (options.checkAgents.length) args.agents = options.checkAgents;
  return args;
}

function summarizeLocalAgentCheck(text, agents = []) {
  const selectedAgents = selectedAgentIds(agents);
  if (/^ERROR:/i.test(String(text || "").trim())) {
    return {
      ok: false,
      agents: selectedAgents,
      versions: {},
      smoke: {},
      failures: [{
        agent: "local-agents",
        stage: "service",
        category: classifyAgentFailure(text, false),
        message: failureMessage(text, false)
      }],
      excerpt: text.split(/\r?\n/).slice(0, 36).join("\n")
    };
  }
  const versionText = splitAfterHeading(text, "# CLI versions");
  const smokeText = splitAfterHeading(text, "# Answer smoke test");
  const versions = Object.fromEntries(selectedAgents.map((agent) => [agent, agentSectionOk(versionText, agentLabel(agent), false)]));
  const smoke = Object.fromEntries(selectedAgents.map((agent) => [agent, agentSectionOk(smokeText, agentLabel(agent), true)]));
  const failures = [
    ...agentFailures(versionText, "version", versions, false),
    ...agentFailures(smokeText, "smoke", smoke, true)
  ];
  return {
    ok: Object.values(versions).every(Boolean) && Object.values(smoke).every(Boolean),
    agents: selectedAgents,
    versions,
    smoke,
    failures,
    excerpt: text.split(/\r?\n/).slice(0, 36).join("\n")
  };
}

function skippedLocalAgentCheck(agents = []) {
  return {
    ok: true,
    skipped: true,
    agents: selectedAgentIds(agents),
    versions: {},
    smoke: {},
    excerpt: "Skipped deep local-agent CLI smoke test. Run check --deep to call Gemini, Claude, and opencode."
  };
}

function splitAfterHeading(text, heading) {
  const index = text.indexOf(heading);
  if (index === -1) return "";
  return text.slice(index + heading.length);
}

function agentSectionOk(text, label, requireOkToken) {
  const section = agentSection(text, label);
  if (!section || /^ERROR:/i.test(section)) return false;
  return requireOkToken ? /\bOK\b/.test(section) : true;
}

function agentFailures(text, stage, statusMap, requireOkToken) {
  return Object.entries(statusMap)
    .filter(([, ok]) => !ok)
    .map(([agent]) => {
      const label = agentLabel(agent);
      const section = agentSection(text, label);
      return {
        agent,
        stage,
        category: classifyAgentFailure(section, requireOkToken),
        message: failureMessage(section, requireOkToken)
      };
    });
}

function selectedAgentIds(agents = []) {
  return agents.length ? agents : ["gemini", "claude", "opencode"];
}

function agentLabel(agent) {
  return agent === "opencode" ? "opencode" : agent[0].toUpperCase() + agent.slice(1);
}

function classifyAgentFailure(section, requireOkToken) {
  const text = String(section || "");
  if (/quota_exceeded|Payment Required|exceeded your .*quota|monthly quota/i.test(text)) return "quota_exceeded";
  if (/timed out|timeout/i.test(text)) return "timeout";
  if (/ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket disconnected|TLS connection|proxy/i.test(text)) return "network";
  if (/ENOENT|not found|no such file/i.test(text)) return "missing_cli";
  if (/permission denied|EACCES/i.test(text)) return "permission";
  if (!text) return "missing_output";
  if (requireOkToken && !/\bOK\b/.test(text)) return "unexpected_output";
  return "failed";
}

function failureMessage(section, requireOkToken) {
  const lines = String(section || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "No output returned for this agent";
  if (requireOkToken && !/\bOK\b/.test(section || "") && !/^ERROR:/i.test(lines[0])) {
    return `Expected OK smoke-test response, got: ${lines[0]}`;
  }
  return lines.slice(0, 3).join("\n");
}

function agentSection(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n\\n## |\\n\\n# |$)`).exec(text);
  return match?.[1]?.trim() || "";
}

function endpointUrl(options) {
  return `http://${options.host}:${options.port}${options.path}`;
}

function parseEnvAssignment(value) {
  const separator = value.indexOf("=");
  if (separator <= 0) throw new Error(`Invalid --env assignment: ${value}`);
  const name = value.slice(0, separator);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid environment variable name: ${name}`);
  return [name, value.slice(separator + 1)];
}

function parseAgents(value) {
  const aliases = {
    gemini: "gemini",
    google: "gemini",
    claude: "claude",
    anthropic: "claude",
    opencode: "opencode",
    open_code: "opencode"
  };
  const selected = [];
  for (const raw of String(value || "").split(/[,\s]+/)) {
    const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!normalized) continue;
    const agent = aliases[normalized];
    if (!agent) throw new Error(`Invalid --agents value: ${raw}`);
    if (!selected.includes(agent)) selected.push(agent);
  }
  if (!selected.length) throw new Error("--agents must include gemini, claude, or opencode");
  return selected;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function usage(code) {
  process.stderr.write([
    "Usage:",
    "  node scripts/local-agent-bridge-service.mjs install|start|stop|restart|status|uninstall|check",
    "  node scripts/local-agent-bridge-service.mjs print-plist",
    "",
    "Options: --host HOST --port PORT --path PATH --mcp-command PATH --project-dir PATH --plist PATH --node PATH --path-env PATH --env NAME=VALUE --timeout-ms MS --deep --agents LIST",
    ""
  ].join("\n"));
  process.exit(code);
}
