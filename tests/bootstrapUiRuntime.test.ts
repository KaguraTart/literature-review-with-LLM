import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const HTML_NS = "http://www.w3.org/1999/xhtml";

class FakeElement {
  id = "";
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  textContent = "";
  hidden = false;
  namespaceURI = "";
  eventListeners = new Map<string, Array<(event?: any) => void>>();
  style: any = {
    position: "",
    removeProperty: (name: string) => {
      if (name === "position") this.style.position = "";
    }
  };
  contentWindow: any = { focus() {} };
  contentDocument: any = null;
  ownerDocument: FakeDocument | null = null;
  ownerGlobal: any = null;

  constructor(public localName: string, namespaceURI = "") {
    this.namespaceURI = namespaceURI;
  }

  setAttribute(name: string, value: string) {
    if (name === "id") this.id = String(value);
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string) {
    if (name === "id") return this.id;
    return this.attributes.get(name) || "";
  }

  hasAttribute(name: string) {
    if (name === "id") return !!this.id;
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === "hidden") this.hidden = false;
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]) {
    for (const child of children) this.appendChild(child);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type: string, listener: (event?: any) => void) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.find((element) => String(element.getAttribute("class")).split(/\s+/).includes(className));
    }
    if (selector === "toolbar") {
      return this.find((element) => element.localName === "toolbar");
    }
    const idSuffixMatch = /\[id\$="([^"]+)"\]/.exec(selector);
    if (idSuffixMatch) {
      return this.find((element) => element.id.endsWith(idSuffixMatch[1]));
    }
    return null;
  }

  find(predicate: (element: FakeElement) => boolean): FakeElement | null {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
    return null;
  }
}

class FakeDocument {
  documentElement = new FakeElement("window");

  createXULElement(name: string) {
    return this.attachOwner(new FakeElement(name));
  }

  createElement(name: string) {
    return this.attachOwner(new FakeElement(name));
  }

  createElementNS(namespaceURI: string, name: string) {
    return this.attachOwner(new FakeElement(name, namespaceURI));
  }

  getElementById(id: string) {
    return this.documentElement.find((element) => element.id === id);
  }

  querySelector(selector: string) {
    return this.documentElement.querySelector(selector);
  }

  attachOwner(element: FakeElement) {
    element.ownerDocument = this;
    return element;
  }
}

function loadBootstrapUi(doc = new FakeDocument(), overrides: Record<string, any> = {}) {
  const code = readFileSync(resolve(process.cwd(), "addon/content/bootstrap-ui.js"), "utf8");
  const win = {
    document: doc,
    setTimeout: (callback: () => void) => callback(),
    getComputedStyle: () => ({ position: "static" })
  };
  doc.documentElement.ownerDocument = doc;
  doc.documentElement.ownerGlobal = win;
  const sandbox: any = {
    HTML_NS,
    CHROME_NAME: "zotero-markdown-summary",
    TOOLBAR_BUTTON_ID: "zotero-markdown-summary-toolbar-button",
    SIDENAV_BUTTON_ID: "zotero-markdown-summary-sidenav-button",
    WORKBENCH_PANEL_ID: "zotero-markdown-summary-workbench-panel",
    WORKBENCH_FRAME_ID: "zotero-markdown-summary-workbench-frame",
    WORKBENCH_STYLE_ID: "zotero-markdown-summary-workbench-style",
    Services: {
      wm: {
        getMostRecentWindow: () => win,
        getEnumerator: () => {
          let used = false;
          return {
            hasMoreElements: () => !used,
            getNext: () => {
              used = true;
              return win;
            }
          };
        }
      },
      prompt: {
        alert() {}
      }
    },
    Zotero: {
      debug() {}
    },
    t: (key: string) => key,
    selectedRegularItems: () => [{ id: 7, key: "ITEM7" }],
    selectedWorkbenchItems: (context?: any) => {
      if (Array.isArray(context?.items)) return context.items.filter((item: any) => item?.isRegularItem?.() || item?.attachmentContentType === "application/pdf");
      return [{ id: 7, key: "ITEM7" }];
    },
    openWorkbenchForContext: () => undefined,
    openMarkdownReaderForContext: () => undefined,
    runSelfCheckForContext: () => undefined,
    batchGenerateSelected: () => undefined,
    batchGenerateCurrentList: () => undefined,
    findExistingSummaryAttachment: async () => null,
    findMarkdownAttachment: async () => null,
    getSettings: () => ({}),
    safeError: (error: any) => error?.message || String(error),
    rootURI: "file:///tmp/",
    Date,
    URLSearchParams,
    console,
    ...overrides
  };
  const context = createContext(sandbox);
  runInContext(code, context, { filename: "bootstrap-ui.js" });
  return { helpers: context as any, doc, win };
}

describe("bootstrap UI runtime wiring", () => {
  it("registers the toolbar menu button in a Zotero toolbar", () => {
    const doc = new FakeDocument();
    const toolbar = doc.createXULElement("toolbar");
    toolbar.id = "zotero-items-toolbar";
    doc.documentElement.appendChild(toolbar);
    const { helpers } = loadBootstrapUi(doc);

    helpers.registerToolbarButton({ document: doc, setTimeout: (callback: () => void) => callback() });

    const button = doc.getElementById("zotero-markdown-summary-toolbar-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(toolbar);
    expect(button?.getAttribute("type")).toBe("menu-button");
    expect(button?.getAttribute("label")).toBe("openWorkbench");
    expect(button?.getAttribute("aria-label")).toBe("openWorkbench");
    expect(button?.getAttribute("title")).toBe("openWorkbench");
    expect(button?.getAttribute("image")).toBe("chrome://zotero-markdown-summary/content/logo.svg");
    expect(button?.getAttribute("style")).toContain("min-width: 32px");
    expect(button?.eventListeners.get("command")?.length).toBe(1);
    expect(button?.eventListeners.get("click")?.length).toBe(1);
    const popup = button?.children.find((child) => child.localName === "menupopup");
    expect(popup?.children.map((child) => child.getAttribute("label"))).toEqual([
      "openWorkbench",
      "selfCheck",
      "openMarkdownReader",
      "batchSelected",
      "batchAll",
      "batchAllUpdate"
    ]);
  });

  it("keeps tools menu entries enabled by falling back to the current Zotero selection", () => {
    const { helpers } = loadBootstrapUi();

    expect(helpers.regularItemContextAvailable({})).toBe(true);
    expect(helpers.regularItemContextAvailable({ items: [] })).toBe(true);
    expect(helpers.regularItemContextAvailable({ items: [{ isRegularItem: () => false }] })).toBe(false);
  });

  it("allows the workbench entry for PDF attachments without enabling regular-item actions", () => {
    const { helpers } = loadBootstrapUi();
    const pdfAttachment = { attachmentContentType: "application/pdf", isRegularItem: () => false };
    const hidden: boolean[] = [];
    const enabled: boolean[] = [];

    helpers.menuItem("openWorkbench", () => undefined, { requireWorkbenchItems: true, disableWithoutWorkbenchItems: true }).onShowing(null, {
      items: [pdfAttachment],
      setVisible: (value: boolean) => hidden.push(value),
      setEnabled: (value: boolean) => enabled.push(value)
    });

    expect(helpers.regularItemContextAvailable({ items: [pdfAttachment] })).toBe(false);
    expect(helpers.workbenchItemContextAvailable({ items: [pdfAttachment] })).toBe(true);
    expect(hidden).toEqual([true]);
    expect(enabled).toEqual([true]);
  });

  it("treats missing selection fallback as unavailable instead of throwing", () => {
    const { helpers } = loadBootstrapUi(new FakeDocument(), {
      selectedRegularItems: () => {
        throw new Error("selection unavailable");
      }
    });

    expect(helpers.regularItemContextAvailable({})).toBe(false);
  });

  it("registers the right-side navigation button in an HTML side nav", () => {
    const doc = new FakeDocument();
    const sidenav = doc.createElementNS(HTML_NS, "nav");
    sidenav.id = "zotero-context-pane-sidenav";
    doc.documentElement.appendChild(sidenav);
    const { helpers } = loadBootstrapUi(doc);

    helpers.registerSidenavButton({ document: doc, setTimeout: (callback: () => void) => callback() });

    const button = doc.getElementById("zotero-markdown-summary-sidenav-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(sidenav);
    expect(button?.localName).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("openWorkbench");
    expect(button?.eventListeners.get("click")?.length).toBe(1);
  });

  it("opens the embedded workbench when the HTML side-nav button is clicked", () => {
    const doc = new FakeDocument();
    const sidenav = doc.createElementNS(HTML_NS, "nav");
    sidenav.id = "zotero-context-pane-sidenav";
    const host = doc.createElementNS(HTML_NS, "section");
    host.id = "zotero-context-pane";
    doc.documentElement.append(sidenav, host);
    const { helpers } = loadBootstrapUi(doc);

    helpers.registerSidenavButton({ document: doc, setTimeout: (callback: () => void) => callback() });
    const event = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      }
    };
    doc.getElementById("zotero-markdown-summary-sidenav-button")?.eventListeners.get("click")?.[0]?.(event);

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(panel?.parentNode).toBe(host);
    expect(panel?.getAttribute("data-view")).toBe("workbench");
    expect(frame?.getAttribute("src")).toContain("workbench.xhtml?");
  });

  it("opens an embedded workbench panel with item launch parameters", () => {
    const doc = new FakeDocument();
    const host = doc.createXULElement("vbox");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    const { helpers } = loadBootstrapUi(doc);

    helpers.openEmbeddedWorkbench({ id: 42, key: "ITEM42" });

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    expect(panel).toBeTruthy();
    expect(panel?.parentNode).toBe(host);
    expect(panel?.hidden).toBe(false);
    expect(panel?.getAttribute("data-item-key")).toBe("ITEM42");
    expect(panel?.getAttribute("data-mode")).toBe("dock");
    expect(frame?.getAttribute("src")).toContain("chrome://zotero-markdown-summary/content/workbench.xhtml?");
    expect(frame?.getAttribute("data-zms-fallback-src")).toContain("file:///tmp/content/workbench.xhtml?");
    expect(frame?.getAttribute("src")).toContain("itemID=42");
    expect(frame?.getAttribute("src")).toContain("itemKey=ITEM42");
    expect(frame?.getAttribute("src")).toContain("embedded=1");
  });

  it("passes all selected workbench items into embedded launch parameters", () => {
    const doc = new FakeDocument();
    const host = doc.createXULElement("vbox");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    const { helpers } = loadBootstrapUi(doc);

    helpers.openEmbeddedWorkbench([
      { id: 42, key: "ITEM42" },
      { id: 43, key: "ITEM43" }
    ]);

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    expect(panel?.getAttribute("data-item-key")).toBe("ITEM42");
    expect(panel?.getAttribute("data-item-keys")).toBe("ITEM42,ITEM43");
    expect(frame?.getAttribute("src")).toContain("itemID=42");
    expect(frame?.getAttribute("src")).toContain("itemKey=ITEM42");
    expect(frame?.getAttribute("src")).toContain("itemIDs=42%2C43");
    expect(frame?.getAttribute("src")).toContain("itemKeys=ITEM42%2CITEM43");
  });

  it("refreshes the embedded workbench when the selected papers change", () => {
    const doc = new FakeDocument();
    const host = doc.createXULElement("vbox");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    let selectedItems = [{ id: 42, key: "ITEM42" }];
    const { helpers, win } = loadBootstrapUi(doc, {
      selectedWorkbenchItems: () => selectedItems
    });

    helpers.openEmbeddedWorkbench(selectedItems);
    selectedItems = [
      { id: 43, key: "ITEM43" },
      { id: 44, key: "ITEM44" }
    ];
    helpers.refreshEmbeddedWorkbenchForSelection(win);

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    expect(panel?.getAttribute("data-item-key")).toBe("ITEM43");
    expect(panel?.getAttribute("data-item-keys")).toBe("ITEM43,ITEM44");
    expect(frame?.getAttribute("src")).toContain("itemID=43");
    expect(frame?.getAttribute("src")).toContain("itemIDs=43%2C44");
    expect(frame?.getAttribute("src")).toContain("itemKeys=ITEM43%2CITEM44");
  });

  it("closes the embedded workbench and restores the dock host layout", () => {
    const doc = new FakeDocument();
    const host = doc.createElementNS(HTML_NS, "section");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    const { helpers } = loadBootstrapUi(doc);

    helpers.openEmbeddedWorkbench({ id: 42, key: "ITEM42" });
    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const close = panel?.querySelector(".zms-embedded-close");
    expect(panel?.parentNode).toBe(host);
    expect(host.style.position).toBe("relative");
    expect(host.hasAttribute("data-zms-previous-position")).toBe(true);
    expect(doc.getElementById("zotero-markdown-summary-workbench-style")).toBeTruthy();

    close?.eventListeners.get("click")?.[0]?.({});

    expect(doc.getElementById("zotero-markdown-summary-workbench-panel")).toBeNull();
    expect(doc.getElementById("zotero-markdown-summary-workbench-style")).toBeNull();
    expect(host.style.position).toBe("");
    expect(host.hasAttribute("data-zms-previous-position")).toBe(false);
  });

  it("opens the embedded Markdown reader without letting selection refresh replace it", () => {
    const doc = new FakeDocument();
    const host = doc.createXULElement("vbox");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    let selectedItems = [{ id: 43, key: "ITEM43" }];
    const { helpers, win } = loadBootstrapUi(doc, {
      selectedWorkbenchItems: () => selectedItems
    });

    helpers.openEmbeddedReader({
      path: "/tmp/summary.md",
      title: "Summary Reader",
      itemID: 42,
      itemKey: "ITEM42"
    });
    selectedItems = [{ id: 99, key: "ITEM99" }];
    helpers.refreshEmbeddedWorkbenchForSelection(win);

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    const title = panel?.querySelector(".zms-embedded-title");
    expect(panel?.getAttribute("data-view")).toBe("reader");
    expect(panel?.getAttribute("data-item-key")).toBe("ITEM42");
    expect(title?.textContent).toBe("Summary Reader");
    expect(frame?.getAttribute("src")).toContain("reader.xhtml?");
    expect(frame?.getAttribute("src")).toContain("path=%2Ftmp%2Fsummary.md");
    expect(frame?.getAttribute("src")).not.toContain("ITEM99");
  });

  it("retries an unusable embedded chrome frame with the root fallback URL before dialog fallback", () => {
    const doc = new FakeDocument();
    const host = doc.createXULElement("vbox");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    const { helpers } = loadBootstrapUi(doc);

    helpers.openEmbeddedWorkbench({ id: 42, key: "ITEM42" });
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    frame!.contentWindow = { location: { href: "about:blank" }, focus() {} };
    frame!.contentDocument = { title: "", body: { textContent: "" } };
    const fallback = frame?.getAttribute("data-zms-fallback-src");

    helpers.retryEmbeddedFrameIfError(frame);

    expect(frame?.getAttribute("data-zms-fallback-used")).toBe("1");
    expect(frame?.getAttribute("src")).toBe(fallback);
    expect(frame?.getAttribute("src")).toContain("file:///tmp/content/workbench.xhtml?");
  });

  it("uses HTML elements when embedding the workbench into an HTML host", () => {
    const doc = new FakeDocument();
    const host = doc.createElementNS(HTML_NS, "section");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    const { helpers } = loadBootstrapUi(doc);

    helpers.openEmbeddedWorkbench({ id: 43, key: "PDF43" });

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    expect(panel?.namespaceURI).toBe(HTML_NS);
    expect(panel?.localName).toBe("section");
    expect(frame?.namespaceURI).toBe(HTML_NS);
    expect(panel?.getAttribute("style")).toContain("display:flex");
  });

  it("prefers a fixed pane-stack host over the Zotero detail pane", () => {
    const doc = new FakeDocument();
    const stack = doc.createXULElement("vbox");
    stack.id = "zotero-pane-stack";
    const detailPane = doc.createElementNS(HTML_NS, "section");
    detailPane.id = "zotero-context-pane";
    doc.documentElement.append(stack, detailPane);
    const { helpers } = loadBootstrapUi(doc);

    helpers.openEmbeddedWorkbench({ id: 44, key: "ITEM44" });

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    expect(panel?.parentNode).toBe(stack);
    expect(panel?.getAttribute("data-mode")).toBe("fixed");
    expect(panel?.getAttribute("style")).toContain("position:fixed");
  });
});
