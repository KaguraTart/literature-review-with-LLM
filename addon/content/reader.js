var Zotero = window.Zotero || window.parent?.Zotero;
var Services = window.Services || window.parent?.Services;
var IOUtils = window.IOUtils || window.parent?.IOUtils;
var Cc = window.Cc || window.parent?.Cc;
var Ci = window.Ci || window.parent?.Ci;

const ZMS_READER_PREF_PREFIX = "extensions.zoteroMarkdownSummary";
const ZMS_READER_CHROME_CONTENT_URL = "chrome://zotero-markdown-summary/content/";

function readerMessage(key, settingOrLocale) {
  if (typeof zmsMessage !== "function") return key;
  return zmsMessage("reader", key, settingOrLocale, runtimeLocale());
}

var ZoteroMarkdownSummaryReader = {
  state: {
    path: "",
    title: "",
    itemID: 0,
    itemKey: "",
    embedded: false,
    markdown: "",
    uiLanguage: "en-US"
  },

  async init() {
    const payload = launchPayload();
    this.state.path = payload.path || "";
    this.state.title = payload.title || leafName(this.state.path) || this.t("title");
    this.state.itemID = Number(payload.itemID) || 0;
    this.state.itemKey = payload.itemKey || "";
    this.state.embedded = !!payload.embedded;
    this.state.uiLanguage = resolveUiLanguage(pref("uiLanguage"), runtimeLocale());
    if (this.state.embedded) {
      document.documentElement.setAttribute("data-embedded", "true");
    }
    this.applyLanguage();
    await this.reload();
  },

  applyLanguage() {
    document.title = this.state.title || this.t("title");
    document.getElementById("zms-reader-title").textContent = this.state.title || this.t("title");
    document.getElementById("zms-reader-path").textContent = this.state.path;
    document.getElementById("zms-reader-back").textContent = this.t("backWorkbench");
    document.getElementById("zms-reader-back").hidden = !this.state.embedded;
    document.getElementById("zms-reader-refresh").textContent = this.t("refresh");
    document.getElementById("zms-reader-copy").textContent = this.t("copyMarkdown");
    document.getElementById("zms-reader-open-external").textContent = this.t("openExternal");
  },

  async reload() {
    const content = document.getElementById("zms-reader-content");
    try {
      const markdown = await readText(this.state.path);
      this.state.markdown = markdown;
      content.textContent = "";
      content.appendChild(renderMarkdown(markdown));
    } catch (err) {
      content.textContent = `${this.t("loadFailed")}: ${err?.message || err}`;
    }
  },

  openExternal() {
    if (!this.state.path) return;
    Zotero.File.pathToFile(this.state.path).launch();
  },

  copyMarkdown() {
    copyText(this.state.markdown || "");
  },

  backToWorkbench() {
    if (!this.state.embedded) return;
    const params = new URLSearchParams({
      itemID: String(this.state.itemID || ""),
      itemKey: this.state.itemKey || "",
      embedded: "1",
      refresh: String(Date.now())
    });
    window.location.href = `${ZMS_READER_CHROME_CONTENT_URL}workbench.xhtml?${params.toString()}`;
  },

  t(key) {
    return readerMessage(key, this.state.uiLanguage);
  }
};

function renderMarkdown(markdown) {
  if (window.ZMSMarkdownRenderer?.renderMarkdown) {
    return window.ZMSMarkdownRenderer.renderMarkdown(markdown);
  }
  const root = createHtml("div");
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  let paragraph = [];
  let list = null;
  let inCode = false;
  let codeLines = [];
  let codeLang = "";
  const skipLine = new Set();

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = createHtml("p");
    appendInline(p, paragraph.join(" "));
    root.appendChild(p);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    root.appendChild(list);
    list = null;
  };
  const flushCode = () => {
    const pre = createHtml("pre");
    const code = createHtml("code");
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
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const h = createHtml(`h${heading[1].length}`);
      appendInline(h, heading[2]);
      root.appendChild(h);
      continue;
    }
    const quote = line.match(/^>\s*(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const blockquote = createHtml("blockquote");
      appendInline(blockquote, quote[1]);
      root.appendChild(blockquote);
      continue;
    }
    if (looksLikeTable(line, lines, lineIndex)) {
      flushParagraph();
      flushList();
      const tableBlock = collectTableLines(lines, lineIndex);
      if (tableBlock.lines.length) {
        root.appendChild(renderTable(tableBlock.lines));
        tableBlock.skip.forEach((index) => skipLine.add(index));
        lineIndex = tableBlock.lastIndex;
        continue;
      }
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list) list = createHtml("ul");
      const li = createHtml("li");
      appendInline(li, bullet[1]);
      list.appendChild(li);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.localName !== "ol") list = createHtml("ol");
      const li = createHtml("li");
      appendInline(li, ordered[1]);
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

function stripFrontmatter(markdown) {
  const text = String(markdown || "");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const after = text.slice(end + 4);
  return after.replace(/^\n+/, "");
}

function appendInline(parent, text) {
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  for (const part of parts) {
    const code = part.match(/^`([^`]+)`$/);
    if (code) {
      const element = createHtml("code");
      element.textContent = code[1];
      parent.appendChild(element);
      continue;
    }
    const strong = part.match(/^\*\*([^*]+)\*\*$/);
    if (strong) {
      const element = createHtml("strong");
      element.textContent = strong[1];
      parent.appendChild(element);
      continue;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const element = createHtml("a");
      element.textContent = link[1];
      element.href = link[2];
      parent.appendChild(element);
      continue;
    }
    parent.appendChild(document.createTextNode(part));
  }
}

function looksLikeTable(line, lines, index) {
  if (index === undefined || index < 0) return false;
  return line.includes("|") && lines[index + 1]?.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/);
}

function collectTableLines(lines, start) {
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

function renderTable(tableLines) {
  const table = createHtml("table");
  const [head, _separator, ...body] = tableLines;
  const thead = createHtml("thead");
  const headRow = createHtml("tr");
  for (const cell of splitTableRow(head)) {
    const th = createHtml("th");
    appendInline(th, cell);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = createHtml("tbody");
  for (const row of body) {
    const tr = createHtml("tr");
    for (const cell of splitTableRow(row)) {
      const td = createHtml("td");
      appendInline(td, cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function splitTableRow(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function createHtml(tag) {
  return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
}

function copyText(text) {
  try {
    navigator.clipboard?.writeText(text);
  } catch (_err) {
    const helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
    helper.copyString(text);
  }
}

async function readText(path) {
  if (IOUtils.readUTF8) return IOUtils.readUTF8(path);
  return new TextDecoder().decode(await IOUtils.read(path));
}

function parseWindowPayload(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_err) {
      return {};
    }
  }
  return value;
}

function launchPayload() {
  const argPayload = parseWindowPayload(window.arguments?.[0]);
  if (Object.keys(argPayload).length) return argPayload;
  return payloadFromLocation();
}

function payloadFromLocation() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return {
      path: params.get("path") || "",
      title: params.get("title") || "",
      itemID: Number(params.get("itemID")) || 0,
      itemKey: params.get("itemKey") || "",
      embedded: params.get("embedded") === "1"
    };
  } catch (_err) {
    return {};
  }
}

function pref(key) {
  return Zotero.Prefs.get(`${ZMS_READER_PREF_PREFIX}.${key}`, true);
}

function resolveUiLanguage(setting, locale) {
  return typeof zmsResolveUiLanguage === "function"
    ? zmsResolveUiLanguage(setting, locale)
    : (setting === "zh-CN" || setting === "en-US" ? setting : (String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"));
}

function runtimeLocale() {
  try {
    return Services.locale.appLocaleAsBCP47 || Services.locale.requestedLocale || "";
  } catch (_err) {
    return "";
  }
}

function leafName(path) {
  const slashIndex = Math.max(String(path).lastIndexOf("/"), String(path).lastIndexOf("\\"));
  return slashIndex === -1 ? String(path) : String(path).slice(slashIndex + 1);
}

window.ZoteroMarkdownSummaryReader = ZoteroMarkdownSummaryReader;
