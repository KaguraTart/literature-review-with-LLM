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

  it("extracts a sessionId from a session file path", () => {
    expect(helpers.sessionIdFromPath("/a/b/chat-1700000000000.jsonl")).toBe("chat-1700000000000");
    expect(helpers.sessionIdFromPath("/a/b/notes.md")).toBe("");
  });

  it("labels session entries with a human-readable timestamp", () => {
    const label = helpers.sessionLabelFromPath("/a/chat-1700000000000.jsonl");
    expect(label.startsWith("Chat · ")).toBe(true);
  });
});
