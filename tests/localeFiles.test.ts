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
});
