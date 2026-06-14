import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

function loadWorkbenchHelpers() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/workbench.js"), "utf8");
  const sandbox: any = {
    window: {
      parent: undefined
    },
    navigator: {
      clipboard: {
        writeText() {}
      }
    },
    console
  };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "workbench.js" });
  return context as {
    localAgentConfig: (profile: any, skillId: string) => any;
    localAgentPlan: (profile: any, skillId: string) => any[];
    buildLocalAgentRequestPayload: (localAgent: any, request: any) => any;
    localAgentRequestBody: (localAgent: any, payload: any, payloadMode: string) => any;
    localAgentCallArgs: (localAgent: any) => Record<string, any>;
  };
}

describe("local agent payload helpers", () => {
  const helpers = loadWorkbenchHelpers();

  it("preserves method and args from profile skill-level config", () => {
    const agent = helpers.localAgentConfig(
      {
        model: "default-model",
        bodyExtra: {
          localAgent: {
            endpoint: "127.0.0.1:3333/mcp",
            payloadMode: "jsonrpc",
            "ask-gemini": {
              method: "custom.call",
              args: { provider: "gemini", temperature: 0.3 },
              timeoutSeconds: 9
            }
          }
        }
      },
      "ask-gemini"
    );

    expect(agent).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      tool: "ask_gemini",
      method: "custom.call",
      timeoutSeconds: 9,
      args: {
        provider: "gemini",
        temperature: 0.3
      }
    });
  });

  it("preserves root-level local-agent method and args when no skill override exists", () => {
    const agent = helpers.localAgentConfig(
      {
        model: "default-model",
        bodyExtra: {
          localAgent: {
            endpoint: "http://127.0.0.1:3333/mcp",
            method: "root.call",
            args: { route: "default" },
            body: { shared: true }
          }
        }
      },
      "ask-claude"
    );

    expect(agent).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      tool: "ask_claude",
      method: "root.call",
      args: {
        route: "default",
        shared: true
      }
    });
  });

  it("routes the default local-agents profile to callable skill tools", () => {
    const profile = {
      model: "",
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          payloadMode: "jsonrpc",
          timeoutSeconds: 180,
          "ask-gemini": { tool: "ask_gemini" },
          "ask-claude": { tool: "ask_claude" },
          "ask-opencode": { tool: "ask_opencode" },
          "ask-all-agents": { tool: "ask_all_agents" },
          "ask-gemini-claude": { tool: "ask_all_agents", args: { agents: ["gemini", "claude"] } },
          "check-local-agents": { tool: "check_local_agents", args: { timeoutSeconds: 30 } }
        }
      }
    };

    expect(helpers.localAgentConfig(profile, "ask-gemini")).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      tool: "ask_gemini",
      timeoutSeconds: 180,
      payloadMode: "jsonrpc"
    });
    expect(helpers.localAgentConfig(profile, "ask-claude")).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      tool: "ask_claude",
      timeoutSeconds: 180,
      payloadMode: "jsonrpc"
    });
    expect(helpers.localAgentConfig(profile, "ask-opencode")).toMatchObject({
      endpoint: "http://127.0.0.1:3333/mcp",
      tool: "ask_opencode",
      timeoutSeconds: 180,
      payloadMode: "jsonrpc"
    });
    expect(helpers.localAgentPlan(profile, "ask-all-agents")).toMatchObject([
      { tool: "ask_all_agents", skillId: "ask-all-agents", fallbackToRemote: false }
    ]);
    expect(helpers.localAgentPlan(profile, "ask-gemini-claude")).toMatchObject([
      { tool: "ask_all_agents", skillId: "ask-gemini-claude", fallbackToRemote: false, args: { agents: ["gemini", "claude"] } }
    ]);
    expect(helpers.localAgentPlan(profile, "check-local-agents")).toMatchObject([
      { tool: "check_local_agents", skillId: "check-local-agents", fallbackToRemote: false }
    ]);
  });

  it("only falls back from local agents to remote providers when explicitly configured", () => {
    const defaultProfile = {
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          "ask-all-agents": { tool: "ask_all_agents" },
          "check-local-agents": { tool: "check_local_agents" }
        }
      }
    };
    const fallbackProfile = {
      bodyExtra: {
        localAgent: {
          endpoint: "http://127.0.0.1:3333/mcp",
          "ask-all-agents": { tool: "ask_all_agents", fallbackToRemote: true }
        }
      }
    };

    expect(helpers.localAgentPlan(defaultProfile, "ask-all-agents")[0]).toMatchObject({
      tool: "ask_all_agents",
      fallbackToRemote: false
    });
    expect(helpers.localAgentPlan(defaultProfile, "check-local-agents")[0]).toMatchObject({
      tool: "check_local_agents",
      fallbackToRemote: false
    });
    expect(helpers.localAgentPlan(fallbackProfile, "ask-all-agents")[0]).toMatchObject({
      tool: "ask_all_agents",
      fallbackToRemote: true
    });
  });

  it("merges custom config args and request args", () => {
    const payload = helpers.buildLocalAgentRequestPayload(
      {
        tool: "ask_gemini",
        model: "gemini-2.5-flash",
        args: { temperature: 0.2, max_output_tokens: 1024 },
        timeoutSeconds: 12
      },
      {
        prompt: "给我建议",
        cwd: "/tmp/zotero",
        args: { temperature: 0.8, topK: 5 }
      }
    );

    expect(payload).toMatchObject({
      model: "gemini-2.5-flash",
      temperature: 0.8,
      max_output_tokens: 1024,
      topK: 5,
      timeoutSeconds: 12,
      tool: "ask_gemini",
      prompt: "给我建议",
      cwd: "/tmp/zotero"
    });
  });

  it("passes selected local-agent fan-out targets through profile config", () => {
    const agent = helpers.localAgentConfig(
      {
        model: "",
        bodyExtra: {
          localAgent: {
            endpoint: "http://127.0.0.1:3333/mcp",
            "ask-all-agents": {
              tool: "ask_all_agents",
              args: { agents: ["gemini", "claude"] }
            }
          }
        }
      },
      "ask-all-agents"
    );
    const payload = helpers.buildLocalAgentRequestPayload(agent, {
      prompt: "给我建议",
      cwd: "/tmp/zotero",
      args: helpers.localAgentCallArgs(agent)
    });

    expect(payload).toMatchObject({
      tool: "ask_all_agents",
      prompt: "给我建议",
      cwd: "/tmp/zotero",
      agents: ["gemini", "claude"]
    });
  });

  it("keeps local-agent cwd configurable without leaking it as a tool argument", () => {
    const agent = helpers.localAgentConfig(
      {
        model: "",
        bodyExtra: {
          localAgent: {
            endpoint: "http://127.0.0.1:3333/mcp",
            "ask-all-agents": {
              tool: "ask_all_agents",
              cwd: "/Users/tart"
            }
          }
        }
      },
      "ask-all-agents"
    );

    expect(helpers.localAgentCallArgs(agent)).not.toHaveProperty("cwd");
    expect(helpers.buildLocalAgentRequestPayload(agent, {
      prompt: "给我建议",
      args: helpers.localAgentCallArgs(agent)
    })).toMatchObject({
      tool: "ask_all_agents",
      prompt: "给我建议",
      cwd: "/Users/tart"
    });
  });

  it("keeps check-local tool payload focused on health-check arguments", () => {
    const payload = helpers.buildLocalAgentRequestPayload(
      {
        tool: "check_local_agents",
        timeoutSeconds: 60,
        args: { agents: ["claude"] }
      },
      {
        prompt: "no prompt",
        cwd: "/tmp/zotero",
        args: { includeVersions: true }
      }
    );

    expect(payload).toEqual({
      tool: "check_local_agents",
      timeoutSeconds: 60,
      agents: ["claude"],
      includeVersions: true
    });
  });

  it("passes profile-configured check-local timeout through JSON-RPC arguments", () => {
    const agent = helpers.localAgentConfig(
      {
        model: "",
        bodyExtra: {
          localAgent: {
            endpoint: "http://127.0.0.1:3333/mcp",
            payloadMode: "jsonrpc",
            "check-local-agents": {
              tool: "check_local_agents",
              args: { timeoutSeconds: 75, agents: ["gemini"] }
            }
          }
        }
      },
      "check-local-agents"
    );
    const payload = helpers.buildLocalAgentRequestPayload(agent, {
      prompt: "ignored",
      cwd: "/tmp/zotero",
      args: helpers.localAgentCallArgs(agent)
    });
    const body = helpers.localAgentRequestBody(agent, payload, "jsonrpc");

    expect(body).toMatchObject({
      method: "tools/call",
      params: {
        name: "check_local_agents",
        arguments: {
          timeoutSeconds: 75,
          agents: ["gemini"]
        }
      }
    });
  });

  it("sends empty JSON-RPC arguments for check-local-agents", () => {
    const body = helpers.localAgentRequestBody(
      {
        tool: "check_local_agents"
      },
      {
        tool: "check_local_agents"
      },
      "jsonrpc"
    );

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "check_local_agents",
        arguments: {}
      }
    });
  });

  it("builds JSON-RPC tools/call with method-name dispatch", () => {
    const body = helpers.localAgentRequestBody(
      {
        tool: "ask_claude"
      },
      {
        tool: "ask_claude",
        prompt: "review the paper",
        cwd: "/tmp/zotero"
      },
      "jsonrpc"
    );

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "ask_claude",
        arguments: {
          prompt: "review the paper",
          cwd: "/tmp/zotero"
        }
      }
    });
  });

  it("uses custom method with direct params payload", () => {
    const body = helpers.localAgentRequestBody(
      {
        tool: "ask_claude",
        method: "custom.call"
      },
      {
        tool: "ask_claude",
        payloadType: "json"
      },
      "jsonrpc"
    );

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "custom.call",
      params: {
        tool: "ask_claude",
        payloadType: "json"
      }
    });
  });

  it("forwards simple payload mode as-is", () => {
    const body = helpers.localAgentRequestBody({ method: "noop" }, { prompt: "hi" }, "simple");
    expect(body).toEqual({ prompt: "hi" });
  });

  it("extracts reusable agent args from body/params/payload/args", () => {
    const args = helpers.localAgentCallArgs({
      endpoint: "http://127.0.0.1:3000/mcp",
      timeoutMs: 2000,
      method: "tools/call",
      model: "claude-3.5",
      body: { base: true },
      params: { temperature: 0.2 },
      payload: { max_tokens: 128 },
      args: { max_tokens: 256 },
      extra: "value",
      toolMode: "stdio"
    });

    expect(args).toMatchObject({
      base: true,
      temperature: 0.2,
      max_tokens: 256,
      extra: "value"
    });
    expect(args).not.toHaveProperty("timeoutMs");
    expect(args).not.toHaveProperty("method");
    expect(args).not.toHaveProperty("model");
  });
});
