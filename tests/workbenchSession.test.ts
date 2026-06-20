import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadWorkbenchHelpers() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/workbench.js"), "utf8");
  const context: any = createContext({
    window: { parent: undefined, location: { search: "" }, arguments: [] },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    document: {
      getElementById: () => ({
        addEventListener() {},
        removeEventListener() {},
        classList: { add() {}, remove() {} },
        dataset: {},
        setAttribute() {},
        querySelector: () => null,
        appendChild() {},
        textContent: "",
        click() {},
        focus() {}
      }),
      documentElement: { setAttribute() {}, getAttribute() { return ""; } },
      createElement: () => ({
        className: "",
        textContent: "",
        appendChild() {},
        addEventListener() {},
        dataset: {},
        setAttribute() {}
      }),
      addEventListener() {},
      body: { appendChild() {} }
    },
    console,
    setTimeout: () => 0,
    URL,
    Date
  });
  runInContext(code, context, { filename: "workbench.js" });
  return context as {
    renderSessionAsMarkdown: (messages: any[], t: (k: string) => string, compactionSummary?: string) => string;
    requestMessagesWithHistory: (messages: any[], latestUserText: string, requestPrompt: string, options?: any) => any[];
    sessionIdFromPath: (path: string) => string;
    sessionLabelFromPath: (path: string) => string;
    workbenchModelListRequestForProfile: (profile: any) => { url: string; headers: Record<string, string> } | null;
    workbenchModelOptionsFromItems: (source: any[]) => Array<{ id: string; label: string }>;
    extractResponseText: (protocol: string, data: any) => string;
    providerUsageFromResponse: (data: any) => any;
    providerUsageText: (usage: any) => string;
    streamTextFromData: (protocol: string, data: any) => string;
    isStreamSnapshot: (protocol: string, value: any) => boolean;
  };
}

describe("workbench session helpers", () => {
  const helpers = loadWorkbenchHelpers();

  it("renders messages as Markdown with role headers", () => {
    const t = (k: string) => k;
    const md = helpers.renderSessionAsMarkdown(
      [
        { role: "user", content: "What is the method?" },
        { role: "assistant", content: "It uses a transformer." }
      ],
      t
    );
    expect(md).toContain("**You**");
    expect(md).toContain("What is the method?");
    expect(md).toContain("**Assistant**");
    expect(md).toContain("It uses a transformer.");
  });

  it("renders assistant token usage metadata in exported session Markdown", () => {
    const t = (k: string) => k;
    const md = helpers.renderSessionAsMarkdown(
      [
        { role: "user", content: "What is the method?" },
        { role: "assistant", content: "It uses a transformer.", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
      ],
      t
    );
    expect(md).toContain("It uses a transformer.");
    expect(md).toContain("_Usage: input 10, output 5, total 15_");
  });

  it("skips compaction marker and empty messages when rendering", () => {
    const t = (k: string) => k;
    const md = helpers.renderSessionAsMarkdown(
      [
        { role: "user", content: "real question" },
        { role: "compaction", summary: "should not appear inline" },
        { role: "assistant", content: "  " }
      ],
      t
    );
    expect(md).toContain("real question");
    expect(md).not.toContain("should not appear inline");
    expect(md).not.toContain("compaction");
  });

  it("prepends a system summary when a compaction entry is provided", () => {
    const t = (k: string) => k;
    const out = helpers.requestMessagesWithHistory(
      [
        { role: "user", content: "old q" },
        { role: "assistant", content: "old a" },
        { role: "user", content: "newest q" }
      ],
      "newest q",
      "rendered prompt",
      { compaction: { summary: "Earlier we discussed X.", at: 1700000000000 } }
    );
    expect(out[0].role).toBe("system");
    expect(out[0].content).toContain("Earlier we discussed X.");
    expect(out[0].content).toContain("2023");
    expect(out[0].content).toMatch(/Earlier conversation summary from .+/);
    // The new user message becomes the final one and there is no duplicate
    expect(out[out.length - 1]).toEqual({ role: "user", content: "rendered prompt" });
    // The historical "newest q" is dropped so the history only has the older
    // user turn, plus the freshly-rendered prompt we just appended.
    const userContents = out.filter((m) => m.role === "user").map((m) => m.content);
    expect(userContents).toEqual(["old q", "rendered prompt"]);
  });

  it("drops the latest user entry that matches the prompt the caller is about to send", () => {
    const out = helpers.requestMessagesWithHistory(
      [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "latest" }
      ],
      "latest",
      "rendered"
    );
    expect(out[out.length - 1]).toEqual({ role: "user", content: "rendered" });
    expect(out.find((m) => m.role === "user" && m.content === "latest")).toBeUndefined();
  });

  it("normalizes pasted model-list endpoints for workbench model loading", () => {
    expect(helpers.workbenchModelListRequestForProfile({
      protocol: "openai_chat",
      endpointMode: "base_url",
      baseURL: "https://router.example/v1/models",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true },
      customHeaders: {}
    })?.url).toBe("https://router.example/v1/models");
    expect(helpers.workbenchModelListRequestForProfile({
      protocol: "anthropic_messages",
      endpointMode: "base_url",
      baseURL: "https://api.anthropic.com/v1/models",
      apiKey: "sk-test-secret",
      capabilities: { modelList: true },
      customHeaders: {}
    })?.url).toBe("https://api.anthropic.com/v1/models");
  });

  it("normalizes model-list options for workbench settings", () => {
    expect(helpers.workbenchModelOptionsFromItems([
      { model: "router-model", displayName: "Router Model" },
      { id: "id-only-model" },
      { name: "name-only-model" },
      "string-model"
    ])).toEqual([
      { id: "id-only-model", label: "id-only-model" },
      { id: "name-only-model", label: "name-only-model" },
      { id: "router-model", label: "Router Model" },
      { id: "string-model", label: "string-model" }
    ]);
  });

  it("extracts model text from wrapped provider responses in the workbench", () => {
    expect(helpers.extractResponseText("openai_chat", {
      data: { choices: [{ message: { content: "wrapped chat text" } }] }
    })).toBe("wrapped chat text");
    expect(helpers.extractResponseText("openai_responses", {
      result: { output_text: "wrapped responses text" }
    })).toBe("wrapped responses text");
    expect(helpers.extractResponseText("openai_chat", {
      body: { message: { content: [{ type: "output_text", text: "wrapped body message" }] } }
    })).toBe("wrapped body message");
    expect(helpers.extractResponseText("openai_chat", {
      candidates: [{ content: { parts: [{ text: "candidate part text" }] } }]
    })).toBe("candidate part text");
    expect(helpers.extractResponseText("anthropic_messages", {
      data: { content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "wrapped anthropic text" }] }
    })).toBe("wrapped anthropic text");
    expect(helpers.extractResponseText("anthropic_messages", {
      payload: { message: { content: [{ type: "redacted_thinking", text: "hidden" }, { type: "text", text: "anthropic message text" }] } }
    })).toBe("anthropic message text");
  });

  it("normalizes wrapped provider usage in the workbench", () => {
    expect(helpers.providerUsageFromResponse({
      data: {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          completion_tokens_details: { reasoning_tokens: 2 }
        }
      }
    })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 2
    });
    expect(helpers.providerUsageText({
      inputTokens: 7,
      outputTokens: 4,
      totalTokens: 11,
      cachedInputTokens: 2
    })).toBe("input 7, output 4, total 11, cached 2");
  });

  it("extracts stream text and snapshots from wrapped provider chunks in the workbench", () => {
    expect(helpers.streamTextFromData("openai_chat", {
      data: { choices: [{ delta: { content: "wrapped chat" } }] }
    })).toBe("wrapped chat");
    expect(helpers.streamTextFromData("openai_responses", {
      result: { type: "response.output_text.delta", delta: "wrapped responses" }
    })).toBe("wrapped responses");
    expect(helpers.streamTextFromData("openai_responses", {
      body: { type: "response.output_text.delta", delta: "wrapped body" }
    })).toBe("wrapped body");
    expect(helpers.streamTextFromData("anthropic_messages", {
      payload: { type: "content_block_delta", delta: { type: "text_delta", text: "wrapped anthropic" } }
    })).toBe("wrapped anthropic");
    expect(helpers.streamTextFromData("anthropic_messages", {
      message: { type: "content_block_delta", delta: { type: "text_delta", text: "wrapped message" } }
    })).toBe("wrapped message");
    expect(helpers.isStreamSnapshot("openai_responses", {
      data: { type: "response.completed", response: { output_text: "snapshot" } }
    })).toBe(true);
  });

  it("extracts a sessionId from a session file path", () => {
    expect(helpers.sessionIdFromPath("/a/b/chat-1700000000000.jsonl")).toBe("chat-1700000000000");
    expect(helpers.sessionIdFromPath("/a/b/notes.md")).toBe("");
  });

  it("labels session entries with a human-readable timestamp", () => {
    const label = helpers.sessionLabelFromPath("/a/chat-1700000000000.jsonl");
    expect(label.startsWith("Chat · ")).toBe(true);
  });
});
