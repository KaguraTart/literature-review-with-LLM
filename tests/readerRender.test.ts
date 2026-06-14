import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

class FakeNode {
  localName: string;
  children: FakeNode[] = [];
  attributes: Record<string, string> = {};
  textContent = "";
  href = "";

  constructor(localName: string) {
    this.localName = localName;
  }

  appendChild(child: FakeNode) {
    this.children.push(child);
    return child;
  }

  append(...children: FakeNode[]) {
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
}

function serialize(node: FakeNode): string {
  if (node.localName === "#text") return node.textContent;
  const attrs = [
    ...Object.entries(node.attributes).map(([key, value]) => `${key}=${value}`),
    node.href ? `href=${node.href}` : ""
  ].filter(Boolean);
  const attrText = attrs.length ? ` ${attrs.join(" ")}` : "";
  return `<${node.localName}${attrText}>${node.textContent}${node.children.map(serialize).join("")}</${node.localName}>`;
}

function loadReaderHelpers() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/reader.js"), "utf8");
  const document = {
    createElementNS: (_namespace: string, tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => {
      const node = new FakeNode("#text");
      node.textContent = text;
      return node;
    }
  };
  const sandbox: any = {
    window: {
      parent: undefined,
      location: { search: "" }
    },
    document,
    navigator: {
      clipboard: {
        writeText() {}
      }
    },
    console,
    URLSearchParams,
    TextDecoder
  };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "reader.js" });
  return context as {
    renderMarkdown: (markdown: string) => FakeNode;
    stripFrontmatter: (markdown: string) => string;
  };
}

describe("reader markdown rendering", () => {
  const helpers = loadReaderHelpers();

  it("hides YAML frontmatter from rendered summaries", () => {
    const markdown = "---\nzoteroItemKey: ITEM\nprovider: openai\n---\n\n# Paper\n\nBody text.";
    expect(helpers.stripFrontmatter(markdown)).toBe("# Paper\n\nBody text.");
    const html = serialize(helpers.renderMarkdown(markdown));
    expect(html).toContain("<h1>Paper</h1>");
    expect(html).toContain("<p>Body text.</p>");
    expect(html).not.toContain("zoteroItemKey");
  });

  it("renders tables, code blocks, links, and quotes", () => {
    const markdown = [
      "> quoted",
      "",
      "| A | B |",
      "|---|---|",
      "| **x** | [paper](https://example.test) |",
      "",
      "```ts",
      "const x = 1;",
      "```"
    ].join("\n");
    const html = serialize(helpers.renderMarkdown(markdown));
    expect(html).toContain("<blockquote>quoted</blockquote>");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>x</strong>");
    expect(html).toContain("<a href=https://example.test>paper</a>");
    expect(html).toContain("<code data-lang=ts>const x = 1;</code>");
  });
});
