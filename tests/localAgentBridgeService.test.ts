import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("local agent bridge service script", () => {
  it("prints a launchd plist for the HTTP bridge without installing it", () => {
    const output = execFileSync(process.execPath, [
      "scripts/local-agent-bridge-service.mjs",
      "print-plist",
      "--project-dir",
      process.cwd(),
      "--port",
      "3399",
      "--mcp-command",
      "/tmp/local-agent&mcp"
    ], { encoding: "utf8" });

    expect(output).toContain("<key>Label</key>");
    expect(output).toContain("<string>local.zotero-markdown-summary.local-agent-bridge</string>");
    expect(output).toContain(`<string>${resolve(homedir(), ".local/share/zotero-markdown-summary/local-agent-http-bridge.mjs")}</string>`);
    expect(output).toContain(`<string>${homedir()}</string>`);
    expect(output).toContain("<string>--cwd</string>");
    expect(output).toContain(`<string>${homedir()}</string>`);
    expect(output).toContain("<key>LOCAL_AGENT_OPENCODE_SPAWN_CWD</key>");
    expect(output).toContain(`<string>${homedir()}</string>`);
    expect(output).toContain("<key>HOME</key>");
    expect(output).toContain(`<string>${homedir()}</string>`);
    expect(output).toContain("<key>USER</key>");
    expect(output).toContain("<key>LOGNAME</key>");
    expect(output).toContain("<key>SHELL</key>");
    expect(output).toContain("<key>TMPDIR</key>");
    expect(output).toContain("<key>TERM</key>");
    expect(output).toContain("<key>LANG</key>");
    expect(output).toContain("<key>NO_COLOR</key>");
    expect(output).toContain("<string>1</string>");
    expect(output).toContain("<string>--port</string>");
    expect(output).toContain("<string>3399</string>");
    expect(output).toContain("<key>KeepAlive</key>");
    expect(output).toContain("<true/>");
    expect(output).toContain("<string>/tmp/local-agent&amp;mcp</string>");
  });

  it("carries safe proxy env and explicit service env into the launchd plist", () => {
    const output = execFileSync(process.execPath, [
      "scripts/local-agent-bridge-service.mjs",
      "print-plist",
      "--project-dir",
      process.cwd(),
      "--port",
      "3398",
      "--env",
      "LOCAL_AGENT_OPENCODE_MODEL=test-provider/test-model"
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        http_proxy: "http://127.0.0.1:7897",
        https_proxy: "http://127.0.0.1:7897",
        ANTHROPIC_API_KEY: "should-not-be-written"
      }
    });

    expect(output).toContain("<key>http_proxy</key>");
    expect(output).toContain("<string>http://127.0.0.1:7897</string>");
    expect(output).toContain("<key>https_proxy</key>");
    expect(output).toContain("<key>LOCAL_AGENT_OPENCODE_MODEL</key>");
    expect(output).toContain("<string>test-provider/test-model</string>");
    expect(output).not.toContain("ANTHROPIC_API_KEY");
    expect(output).not.toContain("should-not-be-written");
  });

  it("runs quick service checks without invoking local agent tools", async () => {
    await withMockMcpServer(async (port, calls) => {
      const result = await execFileAsync(process.execPath, [
        "scripts/local-agent-bridge-service.mjs",
        "check",
        "--port",
        String(port),
        "--timeout-ms",
        "5000"
      ], { encoding: "utf8" }) as { stdout: string };
      const summary = JSON.parse(result.stdout);

      expect(summary.mode).toBe("quick");
      expect(summary.timeoutMs).toBe(5000);
      expect(summary.initialize.ok).toBe(true);
      expect(summary.tools.ok).toBe(true);
      expect(summary.localAgents).toMatchObject({ ok: true, skipped: true });
      expect(calls.map((call) => call.method)).toEqual(["initialize", "tools/list"]);
    });
  });

  it("runs deep service checks only when explicitly requested", async () => {
    await withMockMcpServer(async (port, calls) => {
      const result = await execFileAsync(process.execPath, [
        "scripts/local-agent-bridge-service.mjs",
        "check",
        "--deep",
        "--port",
        String(port),
        "--timeout-ms",
        "5000"
      ], { encoding: "utf8" }) as { stdout: string };
      const summary = JSON.parse(result.stdout);

      expect(summary.mode).toBe("deep");
      expect(summary.localAgents.ok).toBe(true);
      expect(summary.localAgents.smoke).toEqual({ gemini: true, claude: true, opencode: true });
      expect(calls.map((call) => call.method)).toEqual(["initialize", "tools/list", "tools/call"]);
      expect(calls[2].params).toMatchObject({
        name: "check_local_agents",
        arguments: { timeoutSeconds: 5 }
      });
    });
  });

  it("uses a longer default timeout for deep service checks", async () => {
    await withMockMcpServer(async (port, calls) => {
      const result = await execFileAsync(process.execPath, [
        "scripts/local-agent-bridge-service.mjs",
        "check",
        "--deep",
        "--port",
        String(port)
      ], { encoding: "utf8" }) as { stdout: string };
      const summary = JSON.parse(result.stdout);

      expect(summary.timeoutMs).toBe(180000);
      expect(summary.localAgents.ok).toBe(true);
      expect(calls[2].params.arguments.timeoutSeconds).toBe(120);
    });
  });

  it("limits deep service checks to selected agents", async () => {
    await withMockMcpServer(async (port, calls) => {
      const result = await execFileAsync(process.execPath, [
        "scripts/local-agent-bridge-service.mjs",
        "check",
        "--deep",
        "--agents",
        "gemini,claude",
        "--port",
        String(port),
        "--timeout-ms",
        "5000"
      ], { encoding: "utf8" }) as { stdout: string };
      const summary = JSON.parse(result.stdout);

      expect(summary.localAgents.ok).toBe(true);
      expect(summary.localAgents.agents).toEqual(["gemini", "claude"]);
      expect(summary.localAgents.versions).toEqual({ gemini: true, claude: true });
      expect(summary.localAgents.smoke).toEqual({ gemini: true, claude: true });
      expect(calls[2].params.arguments).toMatchObject({
        timeoutSeconds: 5,
        agents: ["gemini", "claude"]
      });
    }, [
      "# CLI versions",
      "",
      "## Gemini",
      "gemini 1.0.0",
      "",
      "## Claude",
      "claude 1.0.0",
      "",
      "# Answer smoke test",
      "",
      "## Gemini",
      "OK",
      "",
      "## Claude",
      "OK"
    ].join("\n"));
  });

  it("rejects invalid selected agent names", async () => {
    try {
      await execFileAsync(process.execPath, [
        "scripts/local-agent-bridge-service.mjs",
        "check",
        "--deep",
        "--agents",
        "gemini,unknown"
      ], { encoding: "utf8" });
      throw new Error("Expected invalid --agents to fail");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Invalid --agents value: unknown");
    }
  });

  it("reports structured deep-check failures while preserving failure exit status", async () => {
    await withMockMcpServer(async (port) => {
      try {
        await execFileAsync(process.execPath, [
          "scripts/local-agent-bridge-service.mjs",
          "check",
          "--deep",
          "--port",
          String(port),
          "--timeout-ms",
          "5000"
        ], { encoding: "utf8" });
        throw new Error("Expected deep check to fail");
      } catch (error: any) {
        const summary = JSON.parse(error.stdout);

        expect(error.code).toBe(1);
        expect(summary.localAgents.ok).toBe(false);
        expect(summary.localAgents.smoke.gemini).toBe(false);
        expect(summary.localAgents.smoke.opencode).toBe(false);
        expect(summary.localAgents.failures).toEqual([
          expect.objectContaining({
            agent: "gemini",
            stage: "smoke",
            category: "network",
            message: expect.stringContaining("ECONNRESET")
          }),
          expect.objectContaining({
            agent: "opencode",
            stage: "smoke",
            category: "quota_exceeded",
            message: expect.stringContaining("monthly quota")
          })
        ]);
      }
    }, [
      "# CLI versions",
      "",
      "## Gemini",
      "gemini 1.0.0",
      "",
      "## Claude",
      "claude 1.0.0",
      "",
      "## opencode",
      "opencode 1.0.0",
      "",
      "# Answer smoke test",
      "",
      "## Gemini",
      "ERROR: request to https://cloudcode-pa.googleapis.com failed",
      "reason: Client network socket disconnected before secure TLS connection was established",
      "code: ECONNRESET",
      "",
      "## Claude",
      "OK",
      "",
      "## opencode",
      "ERROR: CLI call exited with code 1",
      "Error: You have exceeded your monthly quota"
    ].join("\n"));
  });
});

async function withMockMcpServer(run: (port: number, calls: any[]) => Promise<void>, toolText?: string) {
  const calls: any[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    calls.push(payload);
    const body = responseForPayload(payload, toolText);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port, calls);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

function responseForPayload(payload: any, toolText?: string) {
  if (payload.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: payload.id,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "local-agent-mcp" }
      }
    };
  }
  if (payload.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: payload.id,
      result: {
        tools: [
          { name: "ask_gemini" },
          { name: "ask_claude" },
          { name: "ask_opencode" },
          { name: "ask_all_agents" },
          { name: "check_local_agents" }
        ]
      }
    };
  }
  return {
    jsonrpc: "2.0",
    id: payload.id,
    result: {
      content: [
        {
          type: "text",
          text: toolText || [
            "# CLI versions",
            "",
            "## Gemini",
            "gemini 1.0.0",
            "",
            "## Claude",
            "claude 1.0.0",
            "",
            "## opencode",
            "opencode 1.0.0",
            "",
            "# Answer smoke test",
            "",
            "## Gemini",
            "OK",
            "",
            "## Claude",
            "OK",
            "",
            "## opencode",
            "OK"
          ].join("\n")
        }
      ]
    }
  };
}
