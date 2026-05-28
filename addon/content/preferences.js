var ZoteroMarkdownSummaryPrefs = {
  prefix: "extensions.zoteroMarkdownSummary",
  fields: [
    "provider",
    "baseURL",
    "apiKey",
    "model",
    "outputDir",
    "inputMode",
    "maxOutputTokens",
    "temperature",
    "stream"
  ],

  init() {
    for (const field of this.fields) {
      const element = document.getElementById(`zms-${field}`);
      const value = Zotero.Prefs.get(`${this.prefix}.${field}`, true);
      if (field === "stream") element.checked = !!value;
      else element.value = value;
    }
  },

  save() {
    for (const field of this.fields) {
      const element = document.getElementById(`zms-${field}`);
      let value = field === "stream" ? element.checked : element.value;
      if (field === "maxOutputTokens") value = Number(value) || 8192;
      if (field === "temperature") value = Number(value) || 1;
      Zotero.Prefs.set(`${this.prefix}.${field}`, value, true);
    }
    this.setStatus("已保存");
  },

  async testConnection() {
    this.save();
    const provider = Zotero.Prefs.get(`${this.prefix}.provider`, true);
    const baseURL = Zotero.Prefs.get(`${this.prefix}.baseURL`, true).replace(/\/+$/, "");
    const apiKey = Zotero.Prefs.get(`${this.prefix}.apiKey`, true);
    const model = Zotero.Prefs.get(`${this.prefix}.model`, true);
    if (!apiKey) {
      this.setStatus("请先填写 API Key");
      return;
    }
    try {
      const url = provider === "anthropic" ? `${baseURL}/v1/messages` : `${baseURL}/chat/completions`;
      const body = provider === "anthropic"
        ? { model, max_tokens: 32, messages: [{ role: "user", content: "ping" }] }
        : { model, messages: [{ role: "user", content: "ping" }], max_tokens: 32, n: 1 };
      const headers = provider === "anthropic"
        ? { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      this.setStatus(response.ok ? "连接成功" : `连接失败：HTTP ${response.status}`);
    } catch (err) {
      this.setStatus(`连接失败：${err.message || err}`);
    }
  },

  setStatus(message) {
    document.getElementById("zms-status").value = message;
  }
};

window.ZoteroMarkdownSummaryPrefs = ZoteroMarkdownSummaryPrefs;
