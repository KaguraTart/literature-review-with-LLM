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
  className = "";

  constructor(localName: string) {
    this.localName = localName;
  }

  appendChild(child: FakeNode) {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name === "class") this.className = value;
  }
}

function serialize(node: FakeNode): string {
  if (node.localName === "#text") return node.textContent;
  const attrs = [
    node.className ? `class=${node.className}` : "",
    ...Object.entries(node.attributes)
      .filter(([key]) => key !== "class")
      .map(([key, value]) => `${key}=${value}`),
    node.href ? `href=${node.href}` : ""
  ].filter(Boolean);
  const attrText = attrs.length ? ` ${attrs.join(" ")}` : "";
  return `<${node.localName}${attrText}>${node.textContent}${node.children.map(serialize).join("")}</${node.localName}>`;
}

function loadMarkdownRenderer() {
  const code = readFileSync(resolve(process.cwd(), "addon/content/markdown-render.js"), "utf8");
  const document = {
    createElementNS: (_namespace: string, tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => {
      const node = new FakeNode("#text");
      node.textContent = text;
      return node;
    }
  };
  const sandbox: any = {
    window: {},
    document
  };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "markdown-render.js" });
  return (context as any).window.ZMSMarkdownRenderer as {
    renderMarkdown: (markdown: string) => FakeNode;
    stripFrontmatter: (markdown: string) => string;
  };
}

describe("shared markdown renderer", () => {
  const renderer = loadMarkdownRenderer();

  it("renders markdown blocks and inline markup", () => {
    const html = serialize(renderer.renderMarkdown([
      "# Title",
      "",
      "> quoted",
      "",
      "| A | B |",
      "|---|---|",
      "| **x** | [paper](https://example.test) |",
      "",
      "```ts",
      "const x = 1;",
      "```"
    ].join("\n")));

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<blockquote>quoted</blockquote>");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>x</strong>");
    expect(html).toContain("<a href=https://example.test>paper</a>");
    expect(html).toContain("<code data-lang=ts>const x = 1;</code>");
  });

  it("renders inline and display math delimiters", () => {
    const html = serialize(renderer.renderMarkdown([
      "Inline $E=mc^2$ and \\(\\alpha_i+\\sqrt{x}\\).",
      "",
      "$$",
      "\\frac{a}{b}=c",
      "$$"
    ].join("\n")));

    expect(html).toContain("class=zms-math zms-math-inline data-tex=E=mc^2>E=mc<sup>2</sup>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("data-tex=\\alpha_i+\\sqrt{x}>");
    expect(html).toContain("α<sub>i</sub>");
    expect(html).toContain("class=zms-tex-sqrt");
    expect(html).toContain("class=zms-math zms-math-display data-tex=\\frac{a}{b}=c>");
    expect(html).toContain("class=zms-tex-frac");
    expect(html).toContain("class=zms-tex-num>a</span>");
    expect(html).toContain("class=zms-tex-den>b</span>");
  });
});
