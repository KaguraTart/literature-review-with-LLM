var chromeHandle;
var registeredMenus = [];
var preferencePaneID = "";
var rootURI = "";
var pluginID = "";

const PREF_PREFIX = "extensions.zoteroMarkdownSummary";
const CHROME_NAME = "zotero-markdown-summary";
const SYSTEM_PROMPT = "你是学术论文阅读助手，输出中文 Markdown 摘要。";
const USER_PROMPT = "请按研究问题、方法、实验、结论、局限、可借鉴点总结。";

async function startup({ id, rootURI: startupRootURI }) {
  pluginID = id;
  rootURI = startupRootURI;
  await Zotero.initializationPromise;
  await Zotero.unlockPromise;
  await Zotero.uiReadyPromise;
  registerChrome();
  preferencePaneID = await registerPreferencePane();
  registerMenus();
}

function shutdown() {
  for (const menuID of registeredMenus) {
    try {
      Zotero.MenuManager.unregisterMenu(menuID);
    } catch (err) {
      Zotero.debug(`[Markdown Summary] Failed to unregister menu: ${safeError(err)}`);
    }
  }
  registeredMenus = [];
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
  preferencePaneID = "";
}

function install() {}
function uninstall() {}

function onMainWindowLoad() {
  registerMenus();
}

function onMainWindowUnload() {}

function registerChrome() {
  if (chromeHandle) return;
  const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [["content", CHROME_NAME, "content/"]]);
}

function registerPreferencePane() {
  return Zotero.PreferencePanes.register({
    pluginID,
    id: "zotero-prefpane-markdown-summary",
    src: rootURI + "content/preferences.xhtml",
    label: "Markdown 摘要",
    defaultXUL: true,
    scripts: [rootURI + "content/preferences.js"],
    stylesheets: [rootURI + "content/preferences.css"]
  });
}

function registerMenus() {
  if (registeredMenus.length) return;
  const common = {
    pluginID,
    target: "main/library/item"
  };
  registeredMenus.push(Zotero.MenuManager.registerMenu({
    ...common,
    menuID: "zotero-markdown-summary-item-actions",
    menus: [
      menuItem("生成 Markdown 总结", (event, context) => runForContext(context, false)),
      menuItem("更新 Markdown 总结", (event, context) => runForContext(context, true)),
      menuItem("打开 Markdown 总结", (event, context) => openForContext(context))
    ]
  }));
  registeredMenus.push(Zotero.MenuManager.registerMenu({
    pluginID,
    target: "main/menubar/tools",
    menuID: "zotero-markdown-summary-tools",
    menus: [
      menuItem("Markdown 摘要设置", () => openPreferences())
    ]
  }));
}

function menuItem(label, onCommand) {
  return {
    menuType: "menuitem",
    onShowing: (_event, context) => {
      context.menuElem?.setAttribute("label", label);
      if (context.items) {
        context.setVisible(context.items.length > 0 && context.items.every((item) => item.isRegularItem()));
      }
    },
    onCommand
  };
}

function openPreferences() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  win?.ZoteroPane?.openPreferences(preferencePaneID || "zotero-prefpane-markdown-summary");
}

async function runForContext(context, force) {
  const items = selectedRegularItems(context);
  if (!items.length) {
    showAlert("请选择至少一个普通文献条目。");
    return;
  }
  const settings = getSettings();
  if (!settings.apiKey) {
    showAlert("请先在插件设置中填写 API Key。");
    return;
  }
  for (const item of items) {
    try {
      await generateForItem(item, settings, force);
      showProgress(`Markdown 摘要已生成：${item.getField("title") || item.key}`);
    } catch (err) {
      showAlert(`生成失败：${safeError(err)}`);
      Zotero.debug(`[Markdown Summary] ${safeError(err)}`);
    }
  }
}

async function openForContext(context) {
  const item = selectedRegularItems(context)[0];
  if (!item) {
    showAlert("请选择一个普通文献条目。");
    return;
  }
  const attachment = await findExistingSummaryAttachment(item, getSettings());
  if (!attachment) {
    showAlert("当前条目下没有 Markdown 摘要附件。");
    return;
  }
  if (typeof attachment.view === "function") {
    await attachment.view();
    return;
  }
  const path = await attachment.getFilePathAsync();
  const file = Zotero.File.pathToFile(path);
  file.launch();
}

async function generateForItem(item, settings, force) {
  const pdf = await findPdfAttachment(item);
  if (!pdf) throw new Error("未找到 PDF 附件");
  const pdfPath = await pdf.getFilePathAsync();
  if (!pdfPath) throw new Error("PDF 文件路径不可用");
  const input = await buildInput(pdf, pdfPath, settings);
  const sourceHash = hashString(`${item.key}:${pdf.key}:${input.text || input.base64 || ""}`);
  const outputPath = buildOutputPath(item, pdf, settings, sourceHash);
  const existing = await findExistingSummaryAttachment(item, settings);
  if (!force && existing && await IOUtils.exists(outputPath)) {
    showProgress("已存在 Markdown 摘要，可使用更新命令重新生成。");
    return;
  }
  const result = await callProvider({
    provider: settings.provider,
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    model: settings.model,
    request: {
      system: SYSTEM_PROMPT,
      prompt: USER_PROMPT,
      input,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      stream: settings.stream
    }
  }, sourceHash);
  const markdown = renderMarkdown(item, pdf, settings, result);
  await ensureDirectory(settings.outputDir);
  await Zotero.File.putContentsAsync(outputPath, markdown);
  await linkOrUpdateAttachment(item, outputPath, existing);
}

async function buildInput(pdf, pdfPath, settings) {
  if (settings.inputMode === "pdf_base64") {
    if (settings.provider === "minimax") {
      throw new Error("MiniMax OpenAI 兼容接口默认使用文本提取模式");
    }
    const bytes = await IOUtils.read(pdfPath);
    return {
      type: "pdf_base64",
      base64: bytesToBase64(bytes),
      filename: pdf.attachmentFilename || "paper.pdf"
    };
  }
  const text = (await pdf.attachmentText) || "";
  if (!text.trim()) throw new Error("PDF 文本提取为空，请切换输入模式或确认 Zotero 已完成全文索引");
  return { type: "text", text };
}

async function callProvider(summaryRequest, sourceHash) {
  const { provider } = summaryRequest;
  if (provider === "anthropic") {
    return callAnthropic(summaryRequest, sourceHash);
  }
  return callOpenAICompatible(summaryRequest, sourceHash, provider === "openai");
}

async function callOpenAICompatible(summaryRequest, sourceHash, nativeOpenAI) {
  const { baseURL, apiKey, model, request } = summaryRequest;
  const isPdf = request.input.type === "pdf_base64";
  if (isPdf && !nativeOpenAI) {
    throw new Error("当前兼容接口不支持 PDF base64 输入");
  }
  const url = joinURL(baseURL, isPdf ? "/responses" : "/chat/completions");
  const body = isPdf ? {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: `${request.system}\n\n${request.prompt}` },
          {
            type: "input_file",
            filename: request.input.filename || "paper.pdf",
            file_data: `data:application/pdf;base64,${request.input.base64}`
          }
        ]
      }
    ],
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    stream: request.stream
  } : {
    model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: `${request.prompt}\n\n${request.input.text}` }
    ],
    temperature: request.temperature,
    max_tokens: request.maxOutputTokens,
    stream: request.stream,
    n: 1
  };
  if (!nativeOpenAI) {
    body.extra_body = { reasoning_split: true };
  }
  const data = await requestJSON(url, apiKey, body, request.stream);
  return {
    markdown: extractOpenAIText(data),
    usage: data.usage,
    provider: summaryRequest.provider,
    model,
    sourceHash
  };
}

async function callAnthropic(summaryRequest, sourceHash) {
  const { baseURL, apiKey, model, request } = summaryRequest;
  const content = [];
  if (request.input.type === "pdf_base64") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: request.input.base64
      }
    });
  }
  content.push({
    type: "text",
    text: request.input.type === "text" ? `${request.prompt}\n\n${request.input.text}` : request.prompt
  });
  const data = await requestJSON(joinURL(baseURL, "/v1/messages"), apiKey, {
    model,
    system: request.system,
    messages: [{ role: "user", content }],
    max_tokens: request.maxOutputTokens,
    temperature: request.temperature,
    stream: false
  }, false, { "anthropic-version": "2023-06-01" });
  return {
    markdown: extractAnthropicText(data),
    usage: data.usage,
    provider: summaryRequest.provider,
    model,
    sourceHash
  };
}

async function requestJSON(url, apiKey, body, stream, extraHeaders = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          ...extraHeaders
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const text = await response.text();
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await Zotero.Promise.delay(500 * 2 ** attempt);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${redact(text)}`);
      }
      if (stream && response.body) {
        return await readOpenAIStream(response);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        await Zotero.Promise.delay(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError;
}

async function readOpenAIStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const chunk = JSON.parse(payload);
      usage ||= chunk.usage;
      text += chunk.choices?.[0]?.delta?.content || "";
      text += chunk.output?.[0]?.content?.[0]?.text || "";
    }
  }
  return { choices: [{ message: { content: text } }], output_text: text, usage };
}

function extractOpenAIText(data) {
  const text = data.output_text
    || data.choices?.[0]?.message?.content
    || data.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("");
  if (!text) throw new Error("模型没有返回正文");
  return stripThink(String(text).trim());
}

function extractAnthropicText(data) {
  const text = data.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (!text) throw new Error("模型没有返回正文");
  return stripThink(text.trim());
}

async function findPdfAttachment(item) {
  if (typeof item.getBestAttachment === "function") {
    const best = await item.getBestAttachment();
    if (best?.attachmentContentType === "application/pdf") return best;
  }
  for (const id of item.getAttachments()) {
    const attachment = Zotero.Items.get(id);
    if (attachment?.attachmentContentType === "application/pdf") return attachment;
  }
  return null;
}

async function findExistingSummaryAttachment(item, settings) {
  const prefix = summaryTitlePrefix(item);
  for (const id of item.getAttachments()) {
    const attachment = Zotero.Items.get(id);
    if (!attachment) continue;
    const title = attachment.getField("title") || "";
    if (!title.startsWith(prefix)) continue;
    const path = await attachment.getFilePathAsync().catch(() => "");
    if (!path || path.startsWith(settings.outputDir)) return attachment;
  }
  return null;
}

async function linkOrUpdateAttachment(item, outputPath, existing) {
  const title = `${summaryTitlePrefix(item)}.md`;
  if (existing) {
    existing.setField("title", title);
    await existing.saveTx();
    return existing;
  }
  return Zotero.Attachments.linkFromFile({
    file: outputPath,
    parentItemID: item.id,
    contentType: "text/markdown",
    title
  });
}

function renderMarkdown(item, pdf, settings, result) {
  const title = item.getField("title") || item.key;
  const frontmatter = [
    "---",
    `zoteroItemKey: ${item.key}`,
    `pdfAttachmentKey: ${pdf.key}`,
    `sourceHash: ${result.sourceHash}`,
    `summaryVersion: ${settings.summaryVersion}`,
    `provider: ${result.provider}`,
    `model: ${result.model}`,
    `generatedAt: ${new Date().toISOString()}`,
    "---"
  ].join("\n");
  return `${frontmatter}\n\n# ${title}\n\n${result.markdown.trim()}\n`;
}

function buildOutputPath(item, pdf, settings, sourceHash) {
  const base = `${sanitizeFilename(item.getField("date") || "no-date")}-${sanitizeFilename(item.getField("title") || item.key)}-${pdf.key}-${settings.summaryVersion}-${sourceHash.slice(0, 8)}.md`;
  return PathUtils.join(settings.outputDir, base);
}

function selectedRegularItems(context) {
  return (context?.items || Zotero.getActiveZoteroPane().getSelectedItems()).filter((item) => item?.isRegularItem());
}

function getSettings() {
  return {
    provider: pref("provider"),
    baseURL: pref("baseURL").replace(/\/+$/, ""),
    apiKey: pref("apiKey"),
    model: pref("model"),
    outputDir: pref("outputDir"),
    inputMode: pref("inputMode"),
    maxOutputTokens: Number(pref("maxOutputTokens")) || 8192,
    temperature: Number(pref("temperature")),
    stream: !!pref("stream"),
    summaryVersion: pref("summaryVersion") || "1"
  };
}

function pref(key) {
  return Zotero.Prefs.get(`${PREF_PREFIX}.${key}`, true);
}

async function ensureDirectory(path) {
  if (!await IOUtils.exists(path)) {
    await IOUtils.makeDirectory(path, { createAncestors: true, ignoreExisting: true });
  }
}

function showAlert(message) {
  Services.prompt.alert(null, "Markdown 摘要", message);
}

function showProgress(message) {
  try {
    const progress = new Zotero.ProgressWindow();
    progress.changeHeadline("Markdown 摘要");
    new progress.ItemProgress(null, message).setProgress(100);
    progress.show();
    progress.startCloseTimer(3000);
  } catch (_err) {
    Services.prompt.alert(null, "Markdown 摘要", message);
  }
  Zotero.debug(`[Markdown Summary] ${message}`);
}

function summaryTitlePrefix(item) {
  return `Markdown 摘要 - ${item.key}`;
}

function joinURL(baseURL, path) {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function sanitizeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function redact(value) {
  return String(value).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
}

function stripThink(value) {
  return value.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function safeError(err) {
  return redact(err?.message || err || "未知错误");
}
