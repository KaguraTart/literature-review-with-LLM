import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

function ids(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([a-z0-9-]+)\s*=/)?.[1])
    .filter((id): id is string => Boolean(id))
    .sort();
}

function loadSharedMessages() {
  const context: any = {};
  createContext(context);
  runInContext(readFileSync("addon/content/messages.js", "utf8"), context, { filename: "messages.js" });
  return context as {
    ZMS_I18N: Record<string, Record<string, Record<string, string>>>;
    zmsMessage: (scope: string, key: string, settingOrLocale?: string, runtimeLocaleValue?: string) => string;
    zmsResolveUiLanguage: (setting?: string | null, locale?: string) => string;
  };
}

function assertBalancedMarkup(path: string) {
  const source = readFileSync(path, "utf8");
  const stack: Array<{ name: string; line: number }> = [];
  const tagPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<([/]?)([A-Za-z][\w:.-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source))) {
    if (!match[2]) continue;
    const closing = match[1] === "/";
    const name = match[2];
    const raw = match[0];
    const line = 1 + source.slice(0, match.index).split(/\r?\n/).length - 1;
    if (!closing && /\/\s*>$/.test(raw)) continue;
    if (!closing) {
      stack.push({ name, line });
      continue;
    }
    const last = stack.pop();
    expect(last, `${path}:${line} closes </${name}> without a matching opener`).toBeTruthy();
    expect(last?.name, `${path}:${line} expected </${last?.name}> but found </${name}>`).toBe(name);
  }
  expect(stack, `${path} has unclosed tag(s): ${stack.map((entry) => `<${entry.name}> at line ${entry.line}`).join(", ")}`).toEqual([]);
}

describe("locale files", () => {
  it("keeps Chinese and English message ids aligned", () => {
    expect(ids("addon/locale/zh-CN/zotero-markdown-summary.ftl")).toEqual(ids("addon/locale/en-US/zotero-markdown-summary.ftl"));
  });

  it("contains the workbench, reader, skill, writeback, settings, and error ids used by the UI", () => {
    const zhIds = ids("addon/locale/zh-CN/zotero-markdown-summary.ftl");
    expect(zhIds).toEqual(expect.arrayContaining([
      "workbench-title",
      "workbench-open-title",
      "chat-send",
      "chat-stop",
      "chat-retry",
      "chat-write-summary",
      "reader-open",
      "reader-back",
      "reader-copy",
      "skill-custom-summary-title",
      "writeback-confirm",
      "settings-save",
      "error-no-profile"
    ]));
  });

  it("keeps shared UI dictionary keys aligned across Chinese and English", () => {
    const { ZMS_I18N } = loadSharedMessages();
    for (const scope of ["bootstrap", "workbench", "reader", "preferences"]) {
      expect(Object.keys(ZMS_I18N["zh-CN"][scope]).sort()).toEqual(Object.keys(ZMS_I18N["en-US"][scope]).sort());
    }
  });

  it("contains shared UI messages for provider, workbench, reader, and batch workflows", () => {
    const { ZMS_I18N } = loadSharedMessages();
    expect(Object.keys(ZMS_I18N["zh-CN"].bootstrap)).toEqual(expect.arrayContaining([
      "batchReport",
      "selfCheckLocalAgentEndpoint",
      "batchSkippedNoPdf",
      "batchFailed",
      "pdfBase64Unsupported"
    ]));
    expect(Object.keys(ZMS_I18N["zh-CN"].workbench)).toEqual(expect.arrayContaining([
      "inputFallbackUnsupported",
      "contextFulltextMissing",
      "ask-all-agents",
      "ask-gemini-claude",
      "loadModels",
      "modelPickerHelp",
      "writeFrontmatter"
    ]));
    expect(Object.keys(ZMS_I18N["zh-CN"].preferences)).toEqual(expect.arrayContaining([
      "profileProtocol",
      "profileEndpointMode",
      "profileCustomHeaders",
      "modelPickerHelp",
      "modelListLoaded",
      "advancedSettings",
      "advancedSettingsHelp",
      "saveAndTest",
      "testFailed"
    ]));
    expect(Object.keys(ZMS_I18N["zh-CN"].reader)).toEqual(expect.arrayContaining([
      "backWorkbench",
      "copyMarkdown",
      "openExternal"
    ]));
  });

  it("resolves shared UI messages by explicit language or runtime locale", () => {
    const { zmsMessage, zmsResolveUiLanguage } = loadSharedMessages();
    expect(zmsResolveUiLanguage("auto", "zh-Hant")).toBe("zh-CN");
    expect(zmsResolveUiLanguage("auto", "fr-FR")).toBe("en-US");
    expect(zmsMessage("preferences", "testFailed", "zh-CN", "en-US")).toBe("连接失败");
    expect(zmsMessage("preferences", "testFailed", "en-US", "zh-CN")).toBe("Connection failed");
    expect(zmsMessage("bootstrap", "batchReport", "zh-CN")).toBe("批量报告");
    expect(zmsMessage("bootstrap", "missingKey", "zh-CN")).toBe("missingKey");
  });

  it("keeps Chinese settings labels localized for configuration fields", () => {
    const { zmsMessage } = loadSharedMessages();

    expect(zmsMessage("preferences", "uiLanguage", "zh-CN")).toBe("界面语言");
    expect(zmsMessage("preferences", "apiKey", "zh-CN")).toBe("API 密钥");
    expect(zmsMessage("preferences", "profileEndpointStatus", "zh-CN")).toBe("接口");
    expect(zmsMessage("preferences", "profileProtocol", "zh-CN")).toBe("接口协议");
    expect(zmsMessage("preferences", "profileCustomHeaders", "zh-CN")).toBe("自定义请求头（JSON）");
    expect(zmsMessage("preferences", "profileBodyExtra", "zh-CN")).toBe("额外请求体（JSON）");
    expect(zmsMessage("preferences", "profileLocalAgentHeaders", "zh-CN")).toBe("代理请求头（JSON）");
    expect(zmsMessage("preferences", "profileLocalAgentSkills", "zh-CN")).toBe("技能级配置（JSON，可选）");
  });

  it("keeps settings and workbench static defaults Chinese-first before runtime localization", () => {
    const preferencesXhtml = readFileSync("addon/content/preferences.xhtml", "utf8");
    const workbenchXhtml = readFileSync("addon/content/workbench.xhtml", "utf8");

    expect(preferencesXhtml).toContain('id="zms-provider-label" value="接口厂商"');
    expect(preferencesXhtml).toContain('id="zms-baseURL-label" value="接口地址"');
    expect(preferencesXhtml).toContain('id="zms-apiKey-label" value="API 密钥"');
    expect(preferencesXhtml).toContain('id="zms-temperature-label" value="温度"');
    expect(preferencesXhtml).toContain('id="zms-profileLocalAgentEndpoint-label" value="代理地址"');
    expect(preferencesXhtml).toContain('class="zms-advanced-settings"');
    expect(preferencesXhtml).toContain('id="zms-advancedSettings-summary">高级设置</html:summary>');
    expect(preferencesXhtml).toContain('<html:div class="zms-outputDir-control">');
    expect(preferencesXhtml).toContain('id="zms-choose-outputDir-button" type="button"');
    expect(preferencesXhtml).toContain('id="zms-save-outputDir-button" type="button"');

    expect(workbenchXhtml).toContain('id="zms-quick-settings-heading">常用设置</html:h2>');
    expect(workbenchXhtml).toContain('id="zms-workbench-provider-label" for="zms-workbench-provider">接口厂商</html:label>');
    expect(workbenchXhtml).toContain('id="zms-load-models-workbench" class="zms-load-models-button" type="button" title="加载当前接口厂商的在线模型">加载在线模型</html:button>');
    expect(workbenchXhtml).toContain('id="zms-status" class="zms-status">就绪</html:div>');
    expect(workbenchXhtml).not.toContain("</html:footer>\n      </html:footer>");
  });

  it("keeps Zotero XHTML templates structurally balanced", () => {
    for (const path of [
      "addon/content/preferences.xhtml",
      "addon/content/reader.xhtml",
      "addon/content/workbench.xhtml"
    ]) {
      assertBalancedMarkup(path);
    }
  });
});
