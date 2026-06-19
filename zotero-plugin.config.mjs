export default {
  source: "addon",
  dist: "build",
  id: "zotero-markdown-summary@diantao.local",
  namespace: "zotero-markdown-summary",
  xpiName: "literature-review-with-llm",
  updateURL: "https://github.com/{{owner}}/{{repo}}/releases/latest/download/update.json",
  xpiDownloadLink: "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",
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
