function registerToolbarButtons() {
  const enumerator = Services.wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    registerToolbarButton(enumerator.getNext());
  }
}

function registerSidenavButtons() {
  const enumerator = Services.wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    registerSidenavButton(enumerator.getNext());
  }
}

function registerToolbarButton(win) {
  if (!win?.document || win.document.getElementById(TOOLBAR_BUTTON_ID)) return;
  installWorkbenchSelectionWatcher(win);
  const doc = win.document;
  const toolbar = findToolbar(doc);
  if (!toolbar) {
    win.setTimeout?.(() => registerToolbarButton(win), 1000);
    return;
  }
  const button = createXULElement(doc, "toolbarbutton");
  button.id = TOOLBAR_BUTTON_ID;
  button.setAttribute("type", "menu-button");
  button.setAttribute("class", "toolbarbutton-1");
  button.setAttribute("tooltiptext", t("openWorkbench"));
  button.setAttribute("image", `chrome://${CHROME_NAME}/content/logo.svg`);
  button.setAttribute("style", `list-style-image: url('chrome://${CHROME_NAME}/content/logo.svg'); -moz-context-properties: fill; fill: #ef6f98;`);
  button.addEventListener("command", () => openWorkbenchForContext());
  button.addEventListener("click", (event) => {
    if (event?.button && event.button !== 0) return;
    openWorkbenchForContext();
  });

  const popup = createXULElement(doc, "menupopup");
  popup.appendChild(toolbarMenuItem(doc, t("openWorkbench"), () => openWorkbenchForContext()));
  popup.appendChild(toolbarMenuItem(doc, t("selfCheck"), () => runSelfCheckForContext()));
  popup.appendChild(toolbarMenuItem(doc, t("openMarkdownReader"), () => openMarkdownReaderForContext()));
  popup.appendChild(toolbarMenuItem(doc, t("batchSelected"), () => batchGenerateSelected(false)));
  popup.appendChild(toolbarMenuItem(doc, t("batchAll"), () => batchGenerateCurrentList(false)));
  popup.appendChild(toolbarMenuItem(doc, t("batchAllUpdate"), () => batchGenerateCurrentList(true)));
  button.appendChild(popup);
  toolbar.appendChild(button);
}

function unregisterToolbarButtons(documentOrWindow) {
  if (documentOrWindow?.document) {
    removeWorkbenchSelectionWatcher(documentOrWindow);
    const doc = documentOrWindow.document;
    doc?.getElementById(TOOLBAR_BUTTON_ID)?.remove();
    doc?.getElementById(SIDENAV_BUTTON_ID)?.remove();
    closeEmbeddedWorkbench(doc);
    return;
  }
  const enumerator = Services.wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    const win = enumerator.getNext();
    removeWorkbenchSelectionWatcher(win);
    const doc = win.document;
    doc?.getElementById(TOOLBAR_BUTTON_ID)?.remove();
    doc?.getElementById(SIDENAV_BUTTON_ID)?.remove();
    closeEmbeddedWorkbench(doc);
  }
}

function registerSidenavButton(win) {
  const doc = win?.document;
  if (!doc || doc.getElementById(SIDENAV_BUTTON_ID)) return;
  installWorkbenchSelectionWatcher(win);
  const sidenav = findContextSidenav(doc);
  if (!sidenav) {
    win.setTimeout?.(() => registerSidenavButton(win), 1000);
    return;
  }
  const button = createSidenavButton(doc, sidenav);
  sidenav.appendChild(button);
}

function findContextSidenav(doc) {
  const candidates = [
    "zotero-context-pane-sidenav",
    "zotero-context-pane-side-nav",
    "zotero-context-sidenav"
  ];
  for (const id of candidates) {
    const element = doc.getElementById(id);
    if (element) return element;
  }
  return doc.querySelector?.('[id$="context-pane-sidenav"], [id$="context-sidenav"]');
}

function createSidenavButton(doc, host) {
  const label = t("openWorkbench");
  const imageURL = `chrome://${CHROME_NAME}/content/logo.svg`;
  const isHTMLHost = host.namespaceURI === HTML_NS;
  if (isHTMLHost) {
    const button = doc.createElementNS(HTML_NS, "button");
    button.id = SIDENAV_BUTTON_ID;
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("style", "width:32px;height:32px;margin:2px 0;padding:5px;border:0;background:transparent;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:default;");
    const image = doc.createElementNS(HTML_NS, "img");
    image.src = imageURL;
    image.alt = "";
    image.setAttribute("style", "width:20px;height:20px;display:block;");
    button.appendChild(image);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openWorkbenchForContext();
    });
    return button;
  }
  const button = createXULElement(doc, "toolbarbutton");
  button.id = SIDENAV_BUTTON_ID;
  button.setAttribute("class", "toolbarbutton-1");
  button.setAttribute("tooltiptext", label);
  button.setAttribute("image", imageURL);
  button.setAttribute("style", `list-style-image: url('${imageURL}'); -moz-context-properties: fill; fill: #ef6f98; min-width: 32px; min-height: 32px; margin: 2px 0;`);
  button.addEventListener("command", () => openWorkbenchForContext());
  return button;
}

function findToolbar(doc) {
  const candidates = [
    "zotero-items-toolbar",
    "zotero-toolbar",
    "zotero-collections-toolbar",
    "zotero-item-pane-toolbar"
  ];
  for (const id of candidates) {
    const element = doc.getElementById(id);
    if (element) return element;
  }
  return doc.querySelector?.("toolbar");
}

function toolbarMenuItem(doc, label, onCommand) {
  const item = createXULElement(doc, "menuitem");
  item.setAttribute("label", label);
  item.addEventListener("command", (event) => {
    event.stopPropagation();
    onCommand(event);
  });
  return item;
}

function createXULElement(doc, name) {
  return doc.createXULElement ? doc.createXULElement(name) : doc.createElement(name);
}

function menuItem(label, onCommand, options = {}) {
  return {
    menuType: "menuitem",
    onShowing: (_event, context) => {
      context.menuElem?.setAttribute("label", label);
      const hasRegularItems = regularItemContextAvailable(context);
      const hasWorkbenchItems = workbenchItemContextAvailable(context);
      if (options.requireRegularItems) {
        context.setVisible?.(hasRegularItems);
      }
      if (options.requireWorkbenchItems) {
        context.setVisible?.(hasWorkbenchItems);
      }
      if (options.disableWithoutRegularItems) {
        context.setEnabled?.(hasRegularItems);
      }
      if (options.disableWithoutWorkbenchItems) {
        context.setEnabled?.(hasWorkbenchItems);
      }
    },
    onCommand
  };
}

function regularItemContextAvailable(context) {
  const items = Array.isArray(context?.items) ? context.items : [];
  if (items.length) return items.every((item) => item?.isRegularItem?.());
  try {
    return selectedRegularItems().length > 0;
  } catch (_err) {
    return false;
  }
}

function workbenchItemsForContext(context) {
  if (typeof selectedWorkbenchItems === "function") return selectedWorkbenchItems(context);
  return selectedRegularItems(context);
}

function workbenchItemContextAvailable(context) {
  try {
    return workbenchItemsForContext(context).length > 0;
  } catch (_err) {
    return false;
  }
}

function openPreferences() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  win?.ZoteroPane?.openPreferences(preferencePaneID || "zotero-prefpane-markdown-summary");
}

function openChromeDialog(path, name, payload) {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const chromeURL = `chrome://${CHROME_NAME}/${path.replace(/^content\//, "content/")}`;
  const rootURL = rootURI + path;
  const features = "chrome,centerscreen,resizable,dialog=no";
  try {
    if (win?.openDialog) {
      win.openDialog(chromeURL, `${name}-${Date.now()}`, features, payload || {});
      return;
    }
    Services.ww.openWindow(null, chromeURL, `${name}-${Date.now()}`, features, payload || null);
  } catch (err) {
    Zotero.debug(`[Markdown Summary] Failed to open chrome dialog (${chromeURL}): ${safeError(err)}`);
    if (win?.openDialog) {
      win.openDialog(rootURL, `${name}-${Date.now()}`, features, payload || {});
      return;
    }
    Services.ww.openWindow(null, rootURL, `${name}-${Date.now()}`, features, payload || null);
  }
}

async function openForContext(context) {
  const item = selectedRegularItems(context)[0];
  if (!item) {
    showAlert(t("selectOneItem"));
    return;
  }
  const attachment = await findExistingSummaryAttachment(item, getSettings());
  if (!attachment) {
    showAlert(t("noSummary"));
    return;
  }
  await openMarkdownReaderForAttachment(attachment, item);
}

async function openMarkdownReaderForContext(context) {
  const item = selectedRegularItems(context)[0];
  if (!item) {
    showAlert(t("selectOneItem"));
    return;
  }
  const attachment = await findExistingSummaryAttachment(item, getSettings()) || await findMarkdownAttachment(item);
  if (!attachment) {
    showAlert(t("noMarkdown"));
    return;
  }
  await openMarkdownReaderForAttachment(attachment, item);
}

async function openMarkdownReaderForAttachment(attachment, parentItem) {
  const path = await attachment.getFilePathAsync();
  if (!path) {
    if (typeof attachment.view === "function") await attachment.view();
    return;
  }
  const payload = {
    path,
    title: attachment.getField("title") || parentItem?.getField?.("title") || leafName(path),
    itemID: parentItem?.id || 0,
    itemKey: parentItem?.key || ""
  };
  if (!openEmbeddedReader(payload)) {
    openChromeDialog("content/reader.xhtml", "zotero-markdown-summary-reader", payload);
  }
}

async function openAttachmentExternally(attachment) {
  if (typeof attachment.view === "function") {
    await attachment.view();
    return;
  }
  const path = await attachment.getFilePathAsync();
  const file = Zotero.File.pathToFile(path);
  file.launch();
}

async function openWorkbenchForContext(context) {
  try {
    const item = workbenchItemsForContext(context)[0];
    if (!item) {
      showAlert(t("selectOneItem"));
      return;
    }
    if (!openEmbeddedWorkbench(item)) {
      openWorkbenchDialog(item);
    }
  } catch (err) {
    Zotero.debug(`[Markdown Summary] Failed to open workbench: ${safeError(err)}`);
    showAlert(`${t("failed")}: ${safeError(err)}`);
  }
}

function openEmbeddedWorkbench(item) {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const doc = win?.document;
  if (!doc) {
    showAlert(t("selectOneItem"));
    return false;
  }
  const hostInfo = findWorkbenchHost(doc);
  const panel = ensureEmbeddedWorkbenchPanel(doc, hostInfo);
  const title = panel.querySelector?.(".zms-embedded-title");
  if (title) title.textContent = t("openWorkbench");
  const frame = doc.getElementById(WORKBENCH_FRAME_ID);
  frame.setAttribute("src", workbenchURL(item));
  panel.setAttribute("data-item-key", item.key || "");
  panel.setAttribute("data-view", "workbench");
  panel.hidden = false;
  panel.removeAttribute("hidden");
  panel.setAttribute("data-mode", hostInfo.mode);
  applyEmbeddedWorkbenchLayout(panel, frame, hostInfo.mode);
  win.setTimeout?.(() => focusEmbeddedFrame(frame), 100);
  return true;
}

function openWorkbenchDialog(item) {
  openChromeDialog("content/workbench.xhtml", "zotero-markdown-summary-workbench", {
    itemID: item?.id || 0,
    itemKey: item?.key || ""
  });
}

function openEmbeddedReader(payload) {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const doc = win?.document;
  if (!doc) return false;
  const hostInfo = findWorkbenchHost(doc);
  const panel = ensureEmbeddedWorkbenchPanel(doc, hostInfo);
  const title = panel.querySelector?.(".zms-embedded-title");
  if (title) title.textContent = payload.title || t("openMarkdownReader");
  const frame = doc.getElementById(WORKBENCH_FRAME_ID);
  frame.setAttribute("src", readerURL(payload));
  panel.setAttribute("data-item-key", payload.itemKey || "");
  panel.setAttribute("data-view", "reader");
  panel.hidden = false;
  panel.removeAttribute("hidden");
  panel.setAttribute("data-mode", hostInfo.mode);
  applyEmbeddedWorkbenchLayout(panel, frame, hostInfo.mode);
  win.setTimeout?.(() => focusEmbeddedFrame(frame), 100);
  return true;
}

function findWorkbenchHost(doc) {
  for (const id of ["zotero-pane-stack", "zotero-items-pane", "zotero-pane"]) {
    const host = doc.getElementById(id);
    if (host) return { host, mode: "fixed" };
  }
  for (const id of ["zotero-context-pane", "zotero-context-pane-inner", "zotero-item-pane"]) {
    const host = doc.getElementById(id);
    if (host) return { host, mode: "dock" };
  }
  return { host: doc.documentElement, mode: "fixed" };
}

function ensureEmbeddedWorkbenchPanel(doc, hostInfo) {
  ensureEmbeddedWorkbenchStyle(doc);
  let panel = doc.getElementById(WORKBENCH_PANEL_ID);
  if (panel && panel.parentNode !== hostInfo.host) {
    panel.remove();
    panel = null;
  }
  if (!panel) {
    const htmlHost = usesHTMLChildren(hostInfo.host);
    panel = htmlHost ? doc.createElementNS(HTML_NS, "section") : createXULElement(doc, "vbox");
    panel.id = WORKBENCH_PANEL_ID;
    panel.setAttribute("class", "zms-embedded-workbench");

    const header = htmlHost ? doc.createElementNS(HTML_NS, "div") : createXULElement(doc, "hbox");
    header.setAttribute("class", "zms-embedded-header");
    if (!htmlHost) header.setAttribute("align", "center");
    header.setAttribute("style", "min-height:34px;padding:0 8px 0 12px;border-bottom:1px solid #d7dce2;background:#ffffff;display:flex;align-items:center;");

    const label = doc.createElementNS(HTML_NS, "span");
    label.setAttribute("class", "zms-embedded-title");
    label.setAttribute("style", "font:600 13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
    label.textContent = t("openWorkbench");

    const spacer = htmlHost ? doc.createElementNS(HTML_NS, "span") : createXULElement(doc, "spacer");
    if (!htmlHost) spacer.setAttribute("flex", "1");
    spacer.setAttribute("style", "flex:1 1 auto;");

    const close = htmlHost ? doc.createElementNS(HTML_NS, "button") : createXULElement(doc, "toolbarbutton");
    close.setAttribute("class", "zms-embedded-close");
    close.setAttribute("tooltiptext", t("closeWorkbench"));
    close.setAttribute("style", "min-width:64px;min-height:28px;margin-inline-start:8px;border:1px solid #c5ced8;border-radius:999px;background:#f8fafc;color:#223040;font:600 12px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;");
    if (htmlHost) {
      close.type = "button";
      close.textContent = t("closeWorkbench");
      close.addEventListener("click", () => closeEmbeddedWorkbench(doc));
    } else {
      close.setAttribute("label", t("closeWorkbench"));
      close.addEventListener("command", () => closeEmbeddedWorkbench(doc));
    }

    const frame = htmlHost ? doc.createElementNS(HTML_NS, "iframe") : createXULElement(doc, "iframe");
    frame.id = WORKBENCH_FRAME_ID;
    frame.setAttribute("class", "zms-embedded-frame");
    if (!htmlHost) frame.setAttribute("flex", "1");
    frame.setAttribute("disablehistory", "true");
    frame.setAttribute("style", "width:100%;min-width:0;min-height:0;border:0;background:#ffffff;display:block;flex:1 1 auto;");
    frame.addEventListener("load", () => {
      const win = frame.ownerDocument?.defaultView || frame.ownerGlobal;
      win?.setTimeout?.(() => focusEmbeddedFrame(frame), 50);
    });

    header.append(label, spacer, close);
    panel.append(header, frame);
    hostInfo.host.appendChild(panel);
  }
  if (hostInfo.mode === "dock") {
    rememberHostPosition(hostInfo.host);
  }
  return panel;
}

function focusEmbeddedFrame(frame) {
  try {
    frame?.contentWindow?.focus?.();
    frame?.contentWindow?.ZoteroMarkdownSummaryWorkbench?.focusComposerInput?.();
    frame?.contentDocument?.getElementById?.("zms-input")?.focus?.({ preventScroll: true });
  } catch (_err) {
    // Cross-document focus can fail while the chrome frame is still loading.
  }
}

function usesHTMLChildren(host) {
  return host?.namespaceURI === HTML_NS || host?.ownerDocument?.contentType === "text/html";
}

function applyEmbeddedWorkbenchLayout(panel, frame, mode) {
  const base = [
    "box-sizing:border-box",
    "min-width:360px",
    "min-height:460px",
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
    "background:#f7f8fa",
    "border-inline-start:1px solid #d7dce2",
    "box-shadow:0 0 18px rgba(15,23,42,0.16)",
    "color:#1f2933",
    "z-index:40"
  ];
  const layout = mode === "dock"
    ? ["position:absolute", "inset:0"]
    : ["position:fixed", "top:92px", "right:0", "bottom:0", "width:min(520px,44vw)", "z-index:2147483000"];
  panel.setAttribute("style", `${base.concat(layout).join(";")};`);
  frame?.setAttribute("style", "width:100%;min-width:0;min-height:0;border:0;background:#ffffff;display:block;flex:1 1 auto;");
}

function rememberHostPosition(host) {
  if (host.hasAttribute("data-zms-previous-position")) return;
  const previous = host.style?.position || "";
  host.setAttribute("data-zms-previous-position", previous || "__empty__");
  const win = host.ownerGlobal;
  const computed = win?.getComputedStyle?.(host);
  if (!computed || computed.position === "static") {
    host.style.position = "relative";
  }
}

function closeEmbeddedWorkbench(doc) {
  const panel = doc?.getElementById?.(WORKBENCH_PANEL_ID);
  if (!panel) {
    removeEmbeddedWorkbenchStyle(doc);
    return;
  }
  const frame = doc.getElementById(WORKBENCH_FRAME_ID);
  frame?.removeAttribute("src");
  const host = panel.parentNode;
  panel.remove();
  restoreHostPosition(host);
  removeEmbeddedWorkbenchStyle(doc);
}

function installWorkbenchSelectionWatcher(win) {
  if (!win || win.__zmsWorkbenchSelectionWatcher) return;
  const watcher = win.setInterval?.(() => refreshEmbeddedWorkbenchForSelection(win), 800);
  if (watcher) win.__zmsWorkbenchSelectionWatcher = watcher;
}

function removeWorkbenchSelectionWatcher(windowOrDocument) {
  const win = windowOrDocument?.document ? windowOrDocument : windowOrDocument?.defaultView || windowOrDocument?.ownerGlobal;
  if (!win?.__zmsWorkbenchSelectionWatcher) return;
  win.clearInterval?.(win.__zmsWorkbenchSelectionWatcher);
  delete win.__zmsWorkbenchSelectionWatcher;
}

function refreshEmbeddedWorkbenchForSelection(win) {
  try {
    const doc = win?.document;
    const panel = doc?.getElementById?.(WORKBENCH_PANEL_ID);
    if (!panel || panel.hidden || panel.getAttribute("data-view") === "reader") return;
    const frame = doc.getElementById(WORKBENCH_FRAME_ID);
    if (!frame) return;
    const item = workbenchItemsForContext()[0];
    if (!item?.key || panel.getAttribute("data-item-key") === item.key) return;
    frame.setAttribute("src", workbenchURL(item));
    panel.setAttribute("data-item-key", item.key || "");
    const title = panel.querySelector?.(".zms-embedded-title");
    if (title) title.textContent = t("openWorkbench");
  } catch (_err) {
    // Selection APIs vary across Zotero panes; polling must stay best-effort.
  }
}

function removeEmbeddedWorkbenchStyle(doc) {
  doc?.getElementById?.(WORKBENCH_STYLE_ID)?.remove();
}

function restoreHostPosition(host) {
  if (!host?.hasAttribute?.("data-zms-previous-position")) return;
  const previous = host.getAttribute("data-zms-previous-position");
  if (previous === "__empty__") host.style.removeProperty("position");
  else host.style.position = previous;
  host.removeAttribute("data-zms-previous-position");
}

function ensureEmbeddedWorkbenchStyle(doc) {
  if (doc.getElementById(WORKBENCH_STYLE_ID)) return;
  const style = doc.createElementNS(HTML_NS, "style");
  style.id = WORKBENCH_STYLE_ID;
  style.textContent = `
    #${WORKBENCH_PANEL_ID} {
      box-sizing: border-box;
      min-width: 360px;
      min-height: 460px;
      background: #f7f8fa;
      border-inline-start: 1px solid #d7dce2;
      box-shadow: 0 0 18px rgba(15, 23, 42, 0.16);
      color: #1f2933;
      z-index: 40;
    }
    #${WORKBENCH_PANEL_ID}[data-mode="dock"] {
      position: absolute;
      inset: 0;
    }
    #${WORKBENCH_PANEL_ID}[data-mode="fixed"] {
      position: fixed;
      top: 92px;
      right: 0;
      bottom: 0;
      width: min(520px, 44vw);
      z-index: 2147483000;
    }
    #${WORKBENCH_PANEL_ID} .zms-embedded-header {
      min-height: 34px;
      padding: 0 8px 0 12px;
      border-bottom: 1px solid #d7dce2;
      background: #ffffff;
    }
    #${WORKBENCH_PANEL_ID} .zms-embedded-title {
      font: 600 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${WORKBENCH_PANEL_ID} .zms-embedded-frame {
      width: 100%;
      min-width: 0;
      min-height: 0;
      border: 0;
      background: #ffffff;
    }
    #${WORKBENCH_PANEL_ID} .zms-embedded-close {
      min-width: 64px;
      min-height: 28px;
      margin-inline-start: 8px;
      border: 1px solid #c5ced8;
      border-radius: 999px;
      background: #f8fafc;
      color: #223040;
      font: 600 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  `;
  doc.documentElement.appendChild(style);
}

function workbenchURL(item) {
  const params = new URLSearchParams({
    itemID: String(item.id || ""),
    itemKey: item.key || "",
    embedded: "1",
    refresh: String(Date.now())
  });
  return `chrome://${CHROME_NAME}/content/workbench.xhtml?${params.toString()}`;
}

function readerURL(payload) {
  const params = new URLSearchParams({
    path: payload.path || "",
    title: payload.title || "",
    itemID: String(payload.itemID || ""),
    itemKey: payload.itemKey || "",
    embedded: "1",
    refresh: String(Date.now())
  });
  return `chrome://${CHROME_NAME}/content/reader.xhtml?${params.toString()}`;
}

function showAlert(message) {
  Services.prompt.alert(null, t("summaryTitle"), message);
}

function showSelfCheckReport(message) {
  Services.prompt.alert(null, t("selfCheckTitle"), message);
  Zotero.debug("[Markdown Summary] Self check completed");
}

function showProgress(message) {
  try {
    const progress = new Zotero.ProgressWindow();
    progress.changeHeadline(t("summaryTitle"));
    new progress.ItemProgress(null, message).setProgress(100);
    progress.show();
    progress.startCloseTimer(3000);
  } catch (_err) {
    Services.prompt.alert(null, t("summaryTitle"), message);
  }
  Zotero.debug(`[Markdown Summary] ${message}`);
}
