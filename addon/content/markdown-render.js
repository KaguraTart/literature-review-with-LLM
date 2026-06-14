function zmsRenderMarkdown(markdown) {
  const root = zmsCreateHtml("div");
  const lines = zmsStripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  let paragraph = [];
  let list = null;
  let inCode = false;
  let codeLines = [];
  let codeLang = "";
  const skipLine = new Set();

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = zmsCreateHtml("p");
    zmsAppendInline(p, paragraph.join(" "));
    root.appendChild(p);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    root.appendChild(list);
    list = null;
  };
  const flushCode = () => {
    const pre = zmsCreateHtml("pre");
    const code = zmsCreateHtml("code");
    if (codeLang) code.setAttribute("data-lang", codeLang);
    code.textContent = codeLines.join("\n");
    pre.appendChild(code);
    root.appendChild(pre);
    codeLines = [];
    codeLang = "";
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (skipLine.has(lineIndex)) continue;
    const codeMatch = line.match(/^```(.*)$/);
    if (codeMatch) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = codeMatch[1].trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const blockMath = line.match(/^\s*\$\$\s*(.*?)\s*\$\$\s*$/);
    if (blockMath) {
      flushParagraph();
      flushList();
      root.appendChild(zmsMathNode(blockMath[1], true));
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      flushParagraph();
      flushList();
      const collected = [];
      let endIndex = lineIndex + 1;
      for (; endIndex < lines.length; endIndex++) {
        if (/^\s*\$\$\s*$/.test(lines[endIndex])) break;
        collected.push(lines[endIndex]);
      }
      root.appendChild(zmsMathNode(collected.join("\n"), true));
      lineIndex = endIndex;
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const h = zmsCreateHtml(`h${heading[1].length}`);
      zmsAppendInline(h, heading[2]);
      root.appendChild(h);
      continue;
    }
    const quote = line.match(/^>\s*(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const blockquote = zmsCreateHtml("blockquote");
      zmsAppendInline(blockquote, quote[1]);
      root.appendChild(blockquote);
      continue;
    }
    if (zmsLooksLikeTable(line, lines, lineIndex)) {
      flushParagraph();
      flushList();
      const tableBlock = zmsCollectTableLines(lines, lineIndex);
      if (tableBlock.lines.length) {
        root.appendChild(zmsRenderTable(tableBlock.lines));
        tableBlock.skip.forEach((index) => skipLine.add(index));
        lineIndex = tableBlock.lastIndex;
        continue;
      }
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.localName !== "ul") list = zmsCreateHtml("ul");
      const li = zmsCreateHtml("li");
      zmsAppendInline(li, bullet[1]);
      list.appendChild(li);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.localName !== "ol") list = zmsCreateHtml("ol");
      const li = zmsCreateHtml("li");
      zmsAppendInline(li, ordered[1]);
      list.appendChild(li);
      continue;
    }
    paragraph.push(line.trim());
  }
  if (inCode) flushCode();
  flushParagraph();
  flushList();
  return root;
}

function zmsStripFrontmatter(markdown) {
  const text = String(markdown || "");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const after = text.slice(end + 4);
  return after.replace(/^\n+/, "");
}

function zmsAppendInline(parent, text) {
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\$\$[^$]+\$\$|\$[^$\n]+\$|\\\([^)]+\\\)|\\\[[\s\S]+?\\\])/g).filter(Boolean);
  for (const part of parts) {
    const code = part.match(/^`([^`]+)`$/);
    if (code) {
      const element = zmsCreateHtml("code");
      element.textContent = code[1];
      parent.appendChild(element);
      continue;
    }
    const strong = part.match(/^\*\*([^*]+)\*\*$/);
    if (strong) {
      const element = zmsCreateHtml("strong");
      element.textContent = strong[1];
      parent.appendChild(element);
      continue;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const element = zmsCreateHtml("a");
      element.textContent = link[1];
      element.href = link[2];
      parent.appendChild(element);
      continue;
    }
    const displayMath = part.match(/^\$\$([\s\S]+)\$\$$/) || part.match(/^\\\[([\s\S]+)\\\]$/);
    if (displayMath) {
      parent.appendChild(zmsMathNode(displayMath[1], true));
      continue;
    }
    const inlineMath = part.match(/^\$([^$\n]+)\$$/) || part.match(/^\\\(([\s\S]+)\\\)$/);
    if (inlineMath) {
      parent.appendChild(zmsMathNode(inlineMath[1], false));
      continue;
    }
    parent.appendChild(document.createTextNode(part));
  }
}

function zmsMathNode(source, display) {
  const element = zmsCreateHtml(display ? "div" : "span");
  element.setAttribute("class", display ? "zms-math zms-math-display" : "zms-math zms-math-inline");
  element.setAttribute("data-tex", String(source || "").trim());
  const content = String(source || "").trim();
  zmsAppendTex(element, content);
  return element;
}

const ZMS_TEX_SYMBOLS = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  le: "≤",
  ge: "≥",
  neq: "≠",
  approx: "≈",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  int: "∫",
  to: "→",
  leftarrow: "←",
  rightarrow: "→"
};

function zmsAppendTex(parent, source) {
  const text = String(source || "");
  for (let index = 0; index < text.length;) {
    if (text.startsWith("\\frac", index)) {
      const numerator = zmsReadTexGroup(text, index + 5);
      const denominator = numerator ? zmsReadTexGroup(text, numerator.nextIndex) : null;
      if (numerator && denominator) {
        const fraction = zmsCreateHtml("span");
        fraction.setAttribute("class", "zms-tex-frac");
        const num = zmsCreateHtml("span");
        num.setAttribute("class", "zms-tex-num");
        zmsAppendTex(num, numerator.value);
        const den = zmsCreateHtml("span");
        den.setAttribute("class", "zms-tex-den");
        zmsAppendTex(den, denominator.value);
        fraction.appendChild(num);
        fraction.appendChild(den);
        parent.appendChild(fraction);
        index = denominator.nextIndex;
        continue;
      }
    }
    if (text.startsWith("\\sqrt", index)) {
      const radicand = zmsReadTexGroup(text, index + 5);
      if (radicand) {
        const sqrt = zmsCreateHtml("span");
        sqrt.setAttribute("class", "zms-tex-sqrt");
        const symbol = zmsCreateHtml("span");
        symbol.setAttribute("class", "zms-tex-sqrt-symbol");
        symbol.textContent = "√";
        const body = zmsCreateHtml("span");
        body.setAttribute("class", "zms-tex-sqrt-body");
        zmsAppendTex(body, radicand.value);
        sqrt.appendChild(symbol);
        sqrt.appendChild(body);
        parent.appendChild(sqrt);
        index = radicand.nextIndex;
        continue;
      }
    }
    const script = text[index] === "^" || text[index] === "_" ? zmsReadScript(text, index + 1) : null;
    if (script) {
      const element = zmsCreateHtml(text[index] === "^" ? "sup" : "sub");
      zmsAppendTex(element, script.value);
      parent.appendChild(element);
      index = script.nextIndex;
      continue;
    }
    if (text[index] === "\\") {
      const command = text.slice(index + 1).match(/^[A-Za-z]+/);
      if (command) {
        parent.appendChild(document.createTextNode(ZMS_TEX_SYMBOLS[command[0]] || command[0]));
        index += command[0].length + 1;
        continue;
      }
    }
    parent.appendChild(document.createTextNode(text[index]));
    index += 1;
  }
}

function zmsReadScript(text, startIndex) {
  const group = zmsReadTexGroup(text, startIndex);
  if (group) return group;
  const value = text[startIndex] || "";
  return value ? { value, nextIndex: startIndex + 1 } : null;
}

function zmsReadTexGroup(text, startIndex) {
  let index = startIndex;
  while (/\s/.test(text[index] || "")) index += 1;
  if (text[index] !== "{") return null;
  let depth = 0;
  let value = "";
  for (; index < text.length; index++) {
    const char = text[index];
    if (char === "{" && text[index - 1] !== "\\") {
      if (depth > 0) value += char;
      depth += 1;
      continue;
    }
    if (char === "}" && text[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) return { value, nextIndex: index + 1 };
      value += char;
      continue;
    }
    value += char;
  }
  return null;
}

function zmsLooksLikeTable(line, lines, index) {
  if (index === undefined || index < 0) return false;
  return line.includes("|") && lines[index + 1]?.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/);
}

function zmsCollectTableLines(lines, start) {
  const result = {
    lines: [],
    skip: [],
    lastIndex: start
  };
  for (let index = start; index < lines.length; index++) {
    if (!lines[index] || !lines[index].includes("|")) break;
    result.lines.push(lines[index]);
    result.skip.push(index);
    result.lastIndex = index;
  }
  return result;
}

function zmsRenderTable(tableLines) {
  const table = zmsCreateHtml("table");
  const [head, _separator, ...body] = tableLines;
  const thead = zmsCreateHtml("thead");
  const headRow = zmsCreateHtml("tr");
  for (const cell of zmsSplitTableRow(head)) {
    const th = zmsCreateHtml("th");
    zmsAppendInline(th, cell);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = zmsCreateHtml("tbody");
  for (const row of body) {
    const tr = zmsCreateHtml("tr");
    for (const cell of zmsSplitTableRow(row)) {
      const td = zmsCreateHtml("td");
      zmsAppendInline(td, cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function zmsSplitTableRow(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function zmsCreateHtml(tag) {
  return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
}

if (typeof window !== "undefined") {
  window.ZMSMarkdownRenderer = {
    renderMarkdown: zmsRenderMarkdown,
    stripFrontmatter: zmsStripFrontmatter
  };
}
