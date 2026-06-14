import { describe, expect, it } from "vitest";
import { normalizeOutputLanguage, normalizeUiLanguage, resolveUiLanguage } from "../src/locale.js";

describe("locale helpers", () => {
  it("uses Chinese UI for Chinese runtime locales", () => {
    expect(resolveUiLanguage("auto", "zh-CN")).toBe("zh-CN");
    expect(resolveUiLanguage("auto", "zh-TW")).toBe("zh-CN");
    expect(resolveUiLanguage("auto", "zh-Hans")).toBe("zh-CN");
  });

  it("uses English UI for non-Chinese runtime locales", () => {
    expect(resolveUiLanguage("auto", "en-US")).toBe("en-US");
    expect(resolveUiLanguage("auto", "ja-JP")).toBe("en-US");
    expect(resolveUiLanguage("auto", "")).toBe("en-US");
  });

  it("honors manual UI language settings", () => {
    expect(resolveUiLanguage("en-US", "zh-CN")).toBe("en-US");
    expect(resolveUiLanguage("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("normalizes invalid language settings", () => {
    expect(normalizeUiLanguage("de-DE")).toBe("auto");
    expect(normalizeOutputLanguage("ja-JP")).toBe("ja-JP");
    expect(normalizeOutputLanguage("de-DE")).toBe("zh-CN");
  });
});
