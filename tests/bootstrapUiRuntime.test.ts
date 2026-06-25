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
  rect: { width: number; height: number } | null = null;
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

  replaceChildren(...children: FakeElement[]) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    this.textContent = "";
    this.append(...children);
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

  getBoundingClientRect() {
    return this.rect || { width: 0, height: 0 };
  }
}

class FakeDocument {
  documentElement = new FakeElement("window");
  defaultView: any = null;

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
  const itemPaneSections: any[] = [];
  const win = {
    document: doc,
    setTimeout: (callback: () => void) => callback(),
    getComputedStyle: overrides.getComputedStyle || (() => ({ display: "block", visibility: "visible", opacity: "1", position: "static" }))
  };
  doc.defaultView = win;
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
    ITEM_PANE_SECTION_ID: "zotero-markdown-summary-workbench-section",
    pluginID: "zotero-markdown-summary@diantao.local",
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
      debug() {},
      ItemPaneManager: {
        registerSection(options: any) {
          itemPaneSections.push(options);
          return `${options.paneID}-registered`;
        },
        unregisterSection(paneID: string) {
          return paneID === "zotero-markdown-summary-workbench-section-registered"
            || paneID === "zotero-markdown-summary-workbench-section";
        }
      }
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
  return { helpers: context as any, doc, win, itemPaneSections };
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
    expect(button?.getAttribute("style")).toContain("background-image:url('chrome://zotero-markdown-summary/content/logo.svg')");
    expect(button?.getAttribute("style")).toContain("max-width: 32px");
    expect(button?.getAttribute("style")).toContain("min-width: 32px");
    expect(button?.eventListeners.get("command")?.length).toBe(1);
    expect(button?.eventListeners.get("click")?.length).toBe(1);
    expect(doc.getElementById("zotero-markdown-summary-button-style")?.textContent).toContain("background-size: 20px 20px");
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

  it("registers a visible HTML toolbar button when Zotero uses an HTML toolbar", () => {
    const doc = new FakeDocument();
    const toolbar = doc.createElementNS(HTML_NS, "div");
    toolbar.id = "zotero-items-toolbar";
    doc.documentElement.appendChild(toolbar);
    const { helpers } = loadBootstrapUi(doc);

    helpers.registerToolbarButton({ document: doc, setTimeout: (callback: () => void) => callback() });

    const button = doc.getElementById("zotero-markdown-summary-toolbar-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(toolbar);
    expect(button?.localName).toBe("button");
    expect(button?.getAttribute("class")).toContain("zms-toolbar-button");
    expect(button?.getAttribute("aria-label")).toBe("openWorkbench");
    expect(button?.getAttribute("title")).toBe("openWorkbench");
    expect(button?.getAttribute("style")).toContain("display:inline-flex");
    expect(button?.getAttribute("style")).toContain("background-image:url('chrome://zotero-markdown-summary/content/logo.svg')");

    const event = {
      button: 0,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      }
    };
    button?.eventListeners.get("click")?.[0]?.(event);
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(doc.getElementById("zotero-markdown-summary-workbench-panel")).toBeTruthy();
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

  it("registers a Zotero item pane section as a stable right-pane entry", () => {
    const doc = new FakeDocument();
    const host = doc.createElementNS(HTML_NS, "section");
    host.id = "zotero-context-pane";
    doc.documentElement.appendChild(host);
    const { helpers, itemPaneSections } = loadBootstrapUi(doc);

    expect(helpers.registerItemPaneSection()).toBe(true);
    expect(itemPaneSections).toHaveLength(1);
    expect(itemPaneSections[0].paneID).toBe("zotero-markdown-summary-workbench-section");
    expect(itemPaneSections[0].pluginID).toBe("zotero-markdown-summary@diantao.local");
    expect(itemPaneSections[0].header.l10nID).toBe("workbench-open-title");
    expect(itemPaneSections[0].sidenav.icon).toBe("chrome://zotero-markdown-summary/content/logo.svg");

    let enabled = false;
    const item = { id: 42, key: "ITEM42", isRegularItem: () => true };
    itemPaneSections[0].onItemChange({ item, setEnabled: (value: boolean) => { enabled = value; } });
    expect(enabled).toBe(true);

    const body = doc.createElementNS(HTML_NS, "div");
    itemPaneSections[0].onRender({ doc, body, item });
    const button = body.find((element) => String(element.getAttribute("class")).includes("zms-item-pane-open-workbench"));
    expect(button?.textContent).toBe("openWorkbench");
    button?.eventListeners.get("click")?.[0]?.({
      preventDefault() {},
      stopPropagation() {}
    });

    const panel = doc.getElementById("zotero-markdown-summary-workbench-panel");
    const frame = doc.getElementById("zotero-markdown-summary-workbench-frame");
    expect(panel?.parentNode).toBe(host);
    expect(frame?.getAttribute("src")).toContain("itemID=42");
    expect(helpers.unregisterItemPaneSection()).toBe(true);
  });

  it("keeps the manual side button visible after the Zotero pane section is registered", () => {
    const doc = new FakeDocument();
    const sidenav = doc.createElementNS(HTML_NS, "item-pane-sidenav");
    sidenav.id = "zotero-view-item-sidenav";
    sidenav.rect = { width: 34, height: 260 };
    const group = doc.createElementNS(HTML_NS, "div");
    group.setAttribute("class", "inherit-flex");
    sidenav.appendChild(group);
    doc.documentElement.appendChild(sidenav);
    const { helpers, win } = loadBootstrapUi(doc);

    expect(helpers.registerItemPaneSection()).toBe(true);
    helpers.ensureWorkbenchButtons(win);

    const button = doc.getElementById("zotero-markdown-summary-sidenav-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode?.parentNode).toBe(group);
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

  it("registers the side button inside Zotero 9 item-pane sidenav button groups", () => {
    const doc = new FakeDocument();
    const sidenav = doc.createElementNS(HTML_NS, "item-pane-sidenav");
    sidenav.id = "zotero-view-item-sidenav";
    sidenav.rect = { width: 34, height: 260 };
    const group = doc.createElementNS(HTML_NS, "div");
    group.setAttribute("class", "inherit-flex highlight-notes-inactive");
    sidenav.appendChild(group);
    const host = doc.createElementNS(HTML_NS, "section");
    host.id = "zotero-context-pane";
    doc.documentElement.append(sidenav, host);
    const { helpers } = loadBootstrapUi(doc);

    helpers.registerSidenavButton({ document: doc, setTimeout: (callback: () => void) => callback() });

    const button = doc.getElementById("zotero-markdown-summary-sidenav-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode?.parentNode).toBe(group);
    expect(button?.getAttribute("class")).toContain("zms-sidenav-open-button");
    expect(button?.getAttribute("role")).toBe("button");

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
    button?.eventListeners.get("click")?.[0]?.(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(doc.getElementById("zotero-markdown-summary-workbench-panel")).toBeTruthy();
  });

  it("can restore toolbar and sidenav buttons after Zotero removes them during a pane rebuild", () => {
    const doc = new FakeDocument();
    const toolbar = doc.createXULElement("toolbar");
    toolbar.id = "zotero-items-toolbar";
    const sidenav = doc.createElementNS(HTML_NS, "item-pane-sidenav");
    sidenav.id = "zotero-view-item-sidenav";
    const group = doc.createElementNS(HTML_NS, "div");
    group.setAttribute("class", "inherit-flex");
    sidenav.appendChild(group);
    doc.documentElement.append(toolbar, sidenav);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);
    doc.getElementById("zotero-markdown-summary-toolbar-button")?.remove();
    doc.getElementById("zotero-markdown-summary-sidenav-button")?.parentNode?.remove();

    helpers.ensureWorkbenchButtons(win);

    expect(doc.getElementById("zotero-markdown-summary-toolbar-button")?.parentNode).toBe(toolbar);
    expect(doc.getElementById("zotero-markdown-summary-sidenav-button")?.parentNode?.parentNode).toBe(group);
  });

  it("shows a fallback workbench button when Zotero has no visible button host yet", () => {
    const doc = new FakeDocument();
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);

    const button = doc.getElementById("zotero-markdown-summary-fallback-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(doc.documentElement);
    expect(button?.getAttribute("aria-label")).toBe("openWorkbench");

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
    button?.eventListeners.get("click")?.[0]?.(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(doc.getElementById("zotero-markdown-summary-workbench-panel")).toBeTruthy();
  });

  it("keeps the fallback button when Zotero only exposes a zero-size toolbar host", () => {
    const doc = new FakeDocument();
    const toolbar = doc.createXULElement("toolbar");
    toolbar.id = "zotero-items-toolbar";
    toolbar.rect = { width: 0, height: 0 };
    doc.documentElement.appendChild(toolbar);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);

    expect(doc.getElementById("zotero-markdown-summary-toolbar-button")?.parentNode).toBe(toolbar);
    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeTruthy();
  });

  it("removes the fallback button when the normal toolbar entry is visibly measurable", () => {
    const doc = new FakeDocument();
    const toolbar = doc.createXULElement("toolbar");
    toolbar.id = "zotero-items-toolbar";
    toolbar.rect = { width: 420, height: 34 };
    doc.documentElement.appendChild(toolbar);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);
    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeNull();
    expect(doc.getElementById("zotero-markdown-summary-button-style")).toBeTruthy();

    doc.getElementById("zotero-markdown-summary-toolbar-button")?.remove();
    toolbar.rect = { width: 0, height: 0 };
    helpers.ensureWorkbenchButtons(win);

    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeTruthy();
  });

  it("attaches the fallback button to a stable Zotero pane container when available", () => {
    const doc = new FakeDocument();
    const paneStack = doc.createElementNS(HTML_NS, "div");
    paneStack.id = "zotero-pane-stack";
    doc.documentElement.appendChild(paneStack);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);

    const button = doc.getElementById("zotero-markdown-summary-fallback-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(paneStack);
  });

  it("removes the fallback button after a normal side-nav entry becomes available", () => {
    const doc = new FakeDocument();
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);
    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeTruthy();

    const sidenav = doc.createElementNS(HTML_NS, "item-pane-sidenav");
    sidenav.id = "zotero-view-item-sidenav";
    sidenav.rect = { width: 34, height: 260 };
    const group = doc.createElementNS(HTML_NS, "div");
    group.setAttribute("class", "inherit-flex");
    sidenav.appendChild(group);
    doc.documentElement.appendChild(sidenav);

    helpers.ensureWorkbenchButtons(win);

    expect(doc.getElementById("zotero-markdown-summary-sidenav-button")).toBeTruthy();
    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeNull();
  });

  it("keeps the fallback button when the side-nav entry exists only in a zero-size host", () => {
    const doc = new FakeDocument();
    const sidenav = doc.createElementNS(HTML_NS, "item-pane-sidenav");
    sidenav.id = "zotero-view-item-sidenav";
    sidenav.rect = { width: 0, height: 0 };
    const group = doc.createElementNS(HTML_NS, "div");
    group.setAttribute("class", "inherit-flex");
    sidenav.appendChild(group);
    doc.documentElement.appendChild(sidenav);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);

    expect(doc.getElementById("zotero-markdown-summary-sidenav-button")).toBeTruthy();
    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeTruthy();
  });

  it("reports existing visible toolbar and side-nav entries as ensured", () => {
    const doc = new FakeDocument();
    const toolbar = doc.createXULElement("toolbar");
    toolbar.id = "zotero-items-toolbar";
    toolbar.rect = { width: 420, height: 34 };
    const sidenav = doc.createElementNS(HTML_NS, "item-pane-sidenav");
    sidenav.id = "zotero-view-item-sidenav";
    sidenav.rect = { width: 34, height: 260 };
    const group = doc.createElementNS(HTML_NS, "div");
    group.setAttribute("class", "inherit-flex");
    sidenav.appendChild(group);
    doc.documentElement.append(toolbar, sidenav);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);
    const secondPass = helpers.ensureWorkbenchButtons(win);

    expect(secondPass.toolbar).toBe(true);
    expect(secondPass.sidenav).toBe(true);
    expect(secondPass.fallback).toBe(false);
    expect(doc.getElementById("zotero-markdown-summary-toolbar-button")?.parentNode).toBe(toolbar);
    expect(doc.getElementById("zotero-markdown-summary-sidenav-button")?.parentNode?.parentNode).toBe(group);
  });

  it("removes the fallback button during UI unregister", () => {
    const doc = new FakeDocument();
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);
    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeTruthy();

    helpers.unregisterToolbarButtons(win);

    expect(doc.getElementById("zotero-markdown-summary-fallback-button")).toBeNull();
  });

  it("moves the toolbar button out of hidden stale Zotero toolbar hosts", () => {
    const doc = new FakeDocument();
    const staleToolbar = doc.createXULElement("toolbar");
    staleToolbar.id = "zotero-items-toolbar";
    staleToolbar.hidden = true;
    const staleButton = doc.createXULElement("toolbarbutton");
    staleButton.id = "zotero-markdown-summary-toolbar-button";
    staleToolbar.appendChild(staleButton);
    const currentToolbar = doc.createXULElement("toolbar");
    currentToolbar.id = "zotero-toolbar-item-tree";
    doc.documentElement.append(staleToolbar, currentToolbar);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);

    const button = doc.getElementById("zotero-markdown-summary-toolbar-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(currentToolbar);
    expect(staleButton.parentNode).toBeNull();
  });

  it("skips Zotero toolbar hosts hidden by computed CSS", () => {
    const doc = new FakeDocument();
    const cssHiddenToolbar = doc.createXULElement("toolbar");
    cssHiddenToolbar.id = "zotero-items-toolbar";
    cssHiddenToolbar.rect = { width: 300, height: 32 };
    const visibleToolbar = doc.createXULElement("toolbar");
    visibleToolbar.id = "zotero-toolbar-item-tree";
    visibleToolbar.rect = { width: 400, height: 34 };
    doc.documentElement.append(cssHiddenToolbar, visibleToolbar);
    const { helpers, win } = loadBootstrapUi(doc, {
      getComputedStyle: (element: FakeElement) => {
        if (element === cssHiddenToolbar) {
          return { display: "none", visibility: "visible", opacity: "1", position: "static" };
        }
        return { display: "block", visibility: "visible", opacity: "1", position: "static" };
      }
    });

    helpers.ensureWorkbenchButtons(win);

    const button = doc.getElementById("zotero-markdown-summary-toolbar-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(visibleToolbar);
  });

  it("moves the side button out of hidden stale Zotero side-nav hosts", () => {
    const doc = new FakeDocument();
    const staleSidenav = doc.createElementNS(HTML_NS, "item-pane-sidenav");
    staleSidenav.id = "zotero-context-pane-sidenav";
    staleSidenav.hidden = true;
    const staleGroup = doc.createElementNS(HTML_NS, "div");
    staleGroup.setAttribute("class", "inherit-flex");
    const staleWrapper = doc.createElementNS(HTML_NS, "div");
    staleWrapper.setAttribute("class", "pin-wrapper zms-sidenav-open-wrapper");
    const staleButton = doc.createElementNS(HTML_NS, "button");
    staleButton.id = "zotero-markdown-summary-sidenav-button";
    staleWrapper.appendChild(staleButton);
    staleGroup.appendChild(staleWrapper);
    staleSidenav.appendChild(staleGroup);
    const currentSidenav = doc.createElementNS(HTML_NS, "nav");
    currentSidenav.id = "zotero-context-pane-side-nav";
    doc.documentElement.append(staleSidenav, currentSidenav);
    const { helpers, win } = loadBootstrapUi(doc);

    helpers.ensureWorkbenchButtons(win);

    const button = doc.getElementById("zotero-markdown-summary-sidenav-button");
    expect(button).toBeTruthy();
    expect(button?.parentNode).toBe(currentSidenav);
    expect(staleWrapper.parentNode).toBeNull();
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
