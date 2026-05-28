export default {
  source: "addon",
  dist: "build",
  id: "zotero-markdown-summary@diantao.local",
  namespace: "zotero-markdown-summary",
  xpiName: "zotero-markdown-summary",
  build: {
    assets: "addon/**/*.*",
    fluent: {
      prefixFluentMessages: false,
      prefixLocaleFiles: false,
      ignore: [],
      dts: false
    },
    prefs: {
      prefix: "extensions.zoteroMarkdownSummary",
      prefixPrefKeys: true,
      dts: false
    },
    makeUpdateJson: {
      updates: [],
      hash: false
    }
  }
};
