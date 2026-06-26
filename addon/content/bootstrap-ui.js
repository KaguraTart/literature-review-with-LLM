var registeredItemPaneSectionID = "";
const FALLBACK_WORKBENCH_BUTTON_ID = "zotero-markdown-summary-fallback-button";
const WORKBENCH_BUTTON_STYLE_ID = "zotero-markdown-summary-button-style";
const WORKBENCH_BUTTON_RECOVERY_DELAYS_MS = [250, 1000, 2500, 5000];

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
  if (!win?.document) return;
  installWorkbenchSelectionWatcher(win);
  installWorkbenchButtonWatcher(win);
  if (ensureToolbarButton(win)) return;
  const doc = win.document;
  if (!findToolbar(doc)) {
    win.setTimeout?.(() => registerToolbarButton(win), 1000);
  }
}

function ensureToolbarButton(win) {
  const doc = win?.document;
  if (!doc) return false;
  ensureWorkbenchButtonStyle(doc);
  const toolbar = findToolbar(doc);
  if (!toolbar) return false;
  const existing = doc.getElementById(TOOLBAR_BUTTON_ID);
  if (workbenchButtonIsCurrent(existing, toolbar)) return true;
  existing?.remove?.();
  const button = createToolbarButton(doc, toolbar);
  toolbar.appendChild(button);
  return true;
}

function createToolbarButton(doc, toolbar) {
  const label = t("openWorkbench");
  const imageURL = `chrome://${CHROME_NAME}/content/logo.svg`;
  const iconBackground = workbenchButtonIconBackgroundStyle(imageURL, "20px");
  if (usesHTMLChildren(toolbar)) {
    const button = doc.createElementNS(HTML_NS, "button");
    button.id = TOOLBAR_BUTTON_ID;
    button.type = "button";
    button.setAttribute("class", "zms-toolbar-button");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("label", label);
    button.setAttribute("style", [
      "width:32px",
      "height:28px",
      "min-width:32px",
      "min-height:28px",
      "margin:0 2px",
      "padding:4px",
      "border:0",
      "border-radius:6px",
      "background-color:transparent",
      iconBackground,
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "vertical-align:middle",
      "cursor:default"
    ].join("; "));

    button.addEventListener("click", (event) => {
      if (event?.button && event.button !== 0) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      openWorkbenchForContext();
    });
    return button;
  }

  const button = createXULElement(doc, "toolbarbutton");
  button.id = TOOLBAR_BUTTON_ID;
  button.setAttribute("type", "menu-button");
  button.setAttribute("class", "zotero-tb-button toolbarbutton-1");
  button.setAttribute("image", imageURL);
  button.setAttribute("tabindex", "-1");
  button.setAttribute("label", label);
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.setAttribute("tooltiptext", label);
  button.setAttribute("style", [
    "width: 32px",
    "height: 28px",
    "-moz-context-properties: fill",
    "fill: #ef6f98",
    "min-width: 32px",
    "max-width: 32px",
    "min-height: 28px",
    "max-height: 28px",
    "padding: 4px",
    "overflow: hidden",
    "appearance: none",
    "-moz-appearance: none",
    "background-color: transparent",
    iconBackground,
    `list-style-image: url('${imageURL}')`
  ].join("; "));
  button.addEventListener("command", () => openWorkbenchForContext());
  button.addEventListener("click", (event) => {
    if (event?.button && event.button !== 0) return;
    openWorkbenchForContext();
  });

  const popup = createXULElement(doc, "menupopup");
  popup.appendChild(toolbarMenuItem(doc, label, () => openWorkbenchForContext()));
  popup.appendChild(toolbarMenuItem(doc, t("selfCheck"), () => runSelfCheckForContext()));
  popup.appendChild(toolbarMenuItem(doc, t("openMarkdownReader"), () => openMarkdownReaderForContext()));
  popup.appendChild(toolbarMenuItem(doc, t("batchSelected"), () => batchGenerateSelected(false)));
  popup.appendChild(toolbarMenuItem(doc, t("batchAll"), () => batchGenerateCurrentList(false)));
  popup.appendChild(toolbarMenuItem(doc, t("batchAllUpdate"), () => batchGenerateCurrentList(true)));
  button.appendChild(popup);
  return button;
}

function unregisterToolbarButtons(documentOrWindow) {
  if (documentOrWindow?.document) {
    removeWorkbenchButtonWatcher(documentOrWindow);
    removeWorkbenchSelectionWatcher(documentOrWindow);
    const doc = documentOrWindow.document;
    doc?.getElementById(TOOLBAR_BUTTON_ID)?.remove();
    doc?.getElementById(SIDENAV_BUTTON_ID)?.remove();
    doc?.getElementById(FALLBACK_WORKBENCH_BUTTON_ID)?.remove();
    doc?.getElementById(WORKBENCH_BUTTON_STYLE_ID)?.remove();
    closeEmbeddedWorkbench(doc);
    return;
  }
  if (documentOrWindow?.getElementById) {
    const doc = documentOrWindow;
    const win = doc.defaultView || doc.ownerGlobal;
    removeWorkbenchButtonWatcher(win);
    removeWorkbenchSelectionWatcher(win || doc);
    doc?.getElementById(TOOLBAR_BUTTON_ID)?.remove();
    doc?.getElementById(SIDENAV_BUTTON_ID)?.remove();
    doc?.getElementById(FALLBACK_WORKBENCH_BUTTON_ID)?.remove();
    doc?.getElementById(WORKBENCH_BUTTON_STYLE_ID)?.remove();
    closeEmbeddedWorkbench(doc);
    return;
  }
  const enumerator = Services.wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    const win = enumerator.getNext();
    removeWorkbenchButtonWatcher(win);
    removeWorkbenchSelectionWatcher(win);
    const doc = win.document;
    doc?.getElementById(TOOLBAR_BUTTON_ID)?.remove();
    doc?.getElementById(SIDENAV_BUTTON_ID)?.remove();
    doc?.getElementById(FALLBACK_WORKBENCH_BUTTON_ID)?.remove();
    doc?.getElementById(WORKBENCH_BUTTON_STYLE_ID)?.remove();
    closeEmbeddedWorkbench(doc);
  }
}

function registerSidenavButton(win) {
  const doc = win?.document;
  if (!doc) return;
  installWorkbenchSelectionWatcher(win);
  installWorkbenchButtonWatcher(win);
  if (ensureSidenavButton(win)) return;
  if (!findContextSidenav(doc)) {
    win.setTimeout?.(() => registerSidenavButton(win), 1000);
  }
}

function ensureSidenavButton(win) {
  const doc = win?.document;
  if (!doc) return false;
  ensureWorkbenchButtonStyle(doc);
  const sidenav = findContextSidenav(doc);
  if (!sidenav) return false;
  const host = sidenavButtonInsertionHost(sidenav);
  const existing = doc.getElementById(SIDENAV_BUTTON_ID);
  if (workbenchButtonIsCurrent(existing, host)) return true;
  removeExistingSidenavButton(existing);
  appendSidenavButton(doc, sidenav);
  return true;
}

function registerItemPaneSection() {
  if (registeredItemPaneSectionID || typeof Zotero?.ItemPaneManager?.registerSection !== "function") return false;
  const icon = `chrome://${CHROME_NAME}/content/logo.svg`;
  try {
    const paneID = Zotero.ItemPaneManager.registerSection({
      paneID: ITEM_PANE_SECTION_ID,
      pluginID,
      header: {
        l10nID: "workbench-open-title",
        icon
      },
      sidenav: {
        l10nID: "workbench-open-title",
        icon,
        orderable: true
      },
      onItemChange: ({ item, setEnabled }) => {
        setEnabled?.(itemPaneWorkbenchItemAvailable(item));
      },
      onRender: ({ doc, body, item }) => {
        renderItemPaneWorkbenchEntry(doc, body, item);
      }
    });
    if (!paneID) return false;
    registeredItemPaneSectionID = paneID;
    return true;
  } catch (err) {
    Zotero.debug(`[Markdown Summary] Failed to register item pane entry: ${safeError(err)}`);
    return false;
  }
}

function unregisterItemPaneSection() {
  const paneID = registeredItemPaneSectionID || ITEM_PANE_SECTION_ID;
  if (!paneID || typeof Zotero?.ItemPaneManager?.unregisterSection !== "function") return false;
  try {
    const ok = Zotero.ItemPaneManager.unregisterSection(paneID);
    registeredItemPaneSectionID = "";
    return !!ok;
  } catch (err) {
    Zotero.debug(`[Markdown Summary] Failed to unregister item pane entry: ${safeError(err)}`);
    registeredItemPaneSectionID = "";
    return false;
  }
}

function renderItemPaneWorkbenchEntry(doc, body, item) {
  if (!doc || !body) return;
  clearElementChildren(body);
  const wrapper = doc.createElementNS(HTML_NS, "div");
  wrapper.setAttribute("class", "zms-item-pane-entry");
  wrapper.setAttribute("style", "display:flex;flex-direction:column;gap:8px;padding:8px 0;");

  const summary = doc.createElementNS(HTML_NS, "p");
  summary.setAttribute("style", "margin:0;color:var(--fill-secondary, #5f6b7a);font:400 12px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.45;");
  summary.textContent = t("itemPaneWorkbenchSummary");

  const button = doc.createElementNS(HTML_NS, "button");
  button.type = "button";
  button.setAttribute("class", "zms-item-pane-open-workbench");
  button.setAttribute("style", "align-self:flex-start;min-height:28px;padding:4px 10px;border:1px solid var(--material-border, #c9d2dc);border-radius:6px;background:var(--material-button, #f7f9fb);color:var(--fill-primary, #1f2933);font:600 12px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;");
  button.textContent = t("openWorkbench");
  button.addEventListener("click", (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (itemPaneWorkbenchItemAvailable(item)) {
      openEmbeddedWorkbench([item]);
      return;
    }
    openWorkbenchForContext();
  });

  wrapper.append(summary, button);
  body.appendChild(wrapper);
}

function clearElementChildren(element) {
  if (typeof element?.replaceChildren === "function") {
    element.replaceChildren();
    return;
  }
  if (Array.isArray(element?.children)) {
    for (const child of [...element.children]) {
      child.parentNode = null;
    }
    element.children = [];
  }
  while (element?.firstChild) {
    element.firstChild.remove?.();
  }
  if (element) element.textContent = "";
}

function itemPaneWorkbenchItemAvailable(item) {
  if (!item) return false;
  if (typeof item.isRegularItem === "function" && item.isRegularItem()) return true;
  if (typeof item.isPDFAttachment === "function" && item.isPDFAttachment()) return true;
  return item.attachmentContentType === "application/pdf";
}

function findContextSidenav(doc) {
  const candidates = [
    "zotero-context-pane-sidenav",
    "zotero-context-pane-side-nav",
    "zotero-context-sidenav",
    "zotero-view-item-sidenav"
  ];
  const found = [];
  for (const id of candidates) {
    const element = doc.getElementById(id);
    if (element) found.push(element);
  }
  const queried = doc.querySelector?.('[id$="context-pane-sidenav"], [id$="context-sidenav"], [id$="view-item-sidenav"], .zotero-view-item-sidenav');
  if (queried) found.push(queried);
  return preferredWorkbenchHost(found);
}

function appendSidenavButton(doc, sidenav) {
  const host = sidenavButtonInsertionHost(sidenav);
  const button = createSidenavButton(doc, host);
  host.appendChild(button);
}

function sidenavButtonInsertionHost(sidenav) {
  return sidenav?._buttonContainer || sidenav?.querySelector?.(".inherit-flex") || sidenav;
}

function createSidenavButton(doc, host) {
  const label = t("openWorkbench");
  const imageURL = `chrome://${CHROME_NAME}/content/logo.svg`;
  const iconBackground = workbenchButtonIconBackgroundStyle(imageURL, "20px");
  if (elementHasClass(host, "inherit-flex")) {
    return createItemPaneSidenavButton(doc, label, imageURL);
  }
  const isHTMLHost = host.namespaceURI === HTML_NS;
  if (isHTMLHost) {
    const button = doc.createElementNS(HTML_NS, "button");
    button.id = SIDENAV_BUTTON_ID;
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("style", `width:32px;height:32px;margin:2px 0;padding:5px;border:0;background-color:transparent;${iconBackground};border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:default;`);
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
  button.setAttribute("image", imageURL);
  button.setAttribute("tooltiptext", label);
  button.setAttribute("style", `width:32px;height:32px;max-width:32px;max-height:32px;overflow:hidden;list-style-image:url('${imageURL}');-moz-context-properties:fill;fill:#ef6f98;min-width:32px;min-height:32px;margin:2px 0;background-color:transparent;${iconBackground};`);
  button.addEventListener("command", () => openWorkbenchForContext());
  return button;
}

function workbenchButtonIconBackgroundStyle(imageURL, size = "20px") {
  return [
    `background-image:url('${imageURL}')`,
    `background-size:${size} ${size}`,
    "background-repeat:no-repeat",
    "background-position:center"
  ].join(";");
}

function ensureWorkbenchButtonStyle(doc) {
  if (!doc?.documentElement || doc.getElementById?.(WORKBENCH_BUTTON_STYLE_ID)) return;
  const imageURL = `chrome://${CHROME_NAME}/content/logo.svg`;
  const style = doc.createElementNS(HTML_NS, "style");
  style.id = WORKBENCH_BUTTON_STYLE_ID;
  style.textContent = `
    #${TOOLBAR_BUTTON_ID},
    #${SIDENAV_BUTTON_ID},
    #${FALLBACK_WORKBENCH_BUTTON_ID} {
      background-repeat: no-repeat !important;
      background-position: center !important;
      list-style-image: url('${imageURL}') !important;
      -moz-context-properties: fill, fill-opacity !important;
      fill: #ef6f98 !important;
      overflow: hidden !important;
    }
    #${TOOLBAR_BUTTON_ID} {
      width: 32px !important;
      max-width: 32px !important;
      min-width: 32px !important;
      height: 28px !important;
      max-height: 28px !important;
      min-height: 28px !important;
      background-size: 20px 20px !important;
    }
    #${SIDENAV_BUTTON_ID} {
      width: 32px !important;
      max-width: 32px !important;
      min-width: 32px !important;
      height: 32px !important;
      max-height: 32px !important;
      min-height: 32px !important;
      background-size: 20px 20px !important;
    }
    #${FALLBACK_WORKBENCH_BUTTON_ID} {
      width: 36px !important;
      max-width: 36px !important;
      min-width: 36px !important;
      height: 36px !important;
      max-height: 36px !important;
      min-height: 36px !important;
      background-size: 22px 22px !important;
    }
    #${TOOLBAR_BUTTON_ID} image,
    #${TOOLBAR_BUTTON_ID} img,
    #${TOOLBAR_BUTTON_ID} .toolbarbutton-icon,
    #${SIDENAV_BUTTON_ID} image,
    #${SIDENAV_BUTTON_ID} img,
    #${SIDENAV_BUTTON_ID} .toolbarbutton-icon,
    #${FALLBACK_WORKBENCH_BUTTON_ID} image,
    #${FALLBACK_WORKBENCH_BUTTON_ID} img {
      width: 20px !important;
      height: 20px !important;
      max-width: 20px !important;
      max-height: 20px !important;
      object-fit: contain !important;
    }
  `;
  doc.documentElement.appendChild(style);
}

function createItemPaneSidenavButton(doc, label, imageURL) {
  const iconBackground = workbenchButtonIconBackgroundStyle(imageURL, "20px");
  const wrapper = doc.createElementNS(HTML_NS, "div");
  wrapper.setAttribute("class", "pin-wrapper zms-sidenav-open-wrapper");
  wrapper.setAttribute("style", "display:flex;align-items:center;justify-content:center;");

  const button = doc.createElementNS(HTML_NS, "button");
  button.id = SIDENAV_BUTTON_ID;
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("class", "btn zms-sidenav-open-button");
  button.setAttribute("style", [
    "width:28px",
    "height:28px",
    "min-width:28px",
    "min-height:28px",
    "margin:0",
    "padding:4px",
    "border:0",
    "border-radius:6px",
    "background-color:transparent",
    iconBackground,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "cursor:default"
  ].join("; "));

  button.addEventListener("click", (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    openWorkbenchForContext();
  });
  button.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event?.key)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    openWorkbenchForContext();
  });
  wrapper.appendChild(button);
  return wrapper;
}

function elementHasClass(element, className) {
  if (!element) return false;
  if (element.classList?.contains?.(className)) return true;
  return String(element.getAttribute?.("class") || "").split(/\s+/).includes(className);
}

function findToolbar(doc) {
  const candidates = [
    "zotero-items-toolbar",
    "zotero-toolbar-item-tree",
    "zotero-toolbar",
    "zotero-collections-toolbar",
    "zotero-item-pane-toolbar"
  ];
  const found = [];
  for (const id of candidates) {
    const element = doc.getElementById(id);
    if (element) found.push(element);
  }
  const queried = doc.querySelector?.("#zotero-toolbar-item-tree #zotero-items-toolbar, #zotero-toolbar-item-tree, [id$='items-toolbar'], toolbar");
  if (queried) found.push(queried);
  return preferredWorkbenchHost(found);
}

function preferredWorkbenchHost(elements) {
  const unique = [];
  for (const element of elements || []) {
    if (element && !unique.includes(element)) unique.push(element);
  }
  return unique
    .filter((element) => !elementLooksHidden(element))
    .sort((left, right) => elementVisibilityScore(right) - elementVisibilityScore(left))[0]
    || unique[0]
    || null;
}

function workbenchButtonIsCurrent(button, host) {
  return !!button && !!host && elementContains(host, button) && !elementLooksHidden(host) && !elementLooksHidden(button);
}

function elementContains(host, child) {
  for (let node = child; node; node = node.parentNode) {
    if (node === host) return true;
  }
  return false;
}

function removeExistingSidenavButton(button) {
  if (!button) return;
  const wrapper = closestSidenavButtonWrapper(button);
  if (wrapper) {
    wrapper.remove?.();
    return;
  }
  button.remove?.();
}

function closestSidenavButtonWrapper(button) {
  for (let node = button?.parentNode; node; node = node.parentNode) {
    if (elementHasClass(node, "zms-sidenav-open-wrapper")) return node;
  }
  return null;
}

function elementLooksHidden(element) {
  for (let node = element; node; node = node.parentNode) {
    if (node.hidden === true) return true;
    const hidden = String(node.getAttribute?.("hidden") || "").toLowerCase();
    if (hidden && hidden !== "false") return true;
    if (String(node.getAttribute?.("collapsed") || "").toLowerCase() === "true") return true;
    if (String(node.getAttribute?.("aria-hidden") || "").toLowerCase() === "true") return true;
    const style = String(node.getAttribute?.("style") || "").toLowerCase().replace(/\s+/g, "");
    if (style.includes("display:none") || style.includes("visibility:hidden")) return true;
    const computed = computedStyleForElement(node);
    if (computed) {
      if (computed.display === "none" || computed.visibility === "hidden" || computed.visibility === "collapse") return true;
      if (computed.opacity === "0" && node === element) return true;
    }
  }
  return false;
}

function elementVisibilityScore(element) {
  if (!element || elementLooksHidden(element)) return -1;
  const rect = safeElementRect(element);
  if (rect) {
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    if (width > 0 && height > 0) return 1000 + Math.min(width * height, 100000);
    if (width > 0 || height > 0) return 500 + width + height;
  }
  return 1;
}

function safeElementRect(element) {
  try {
    if (typeof element?.getBoundingClientRect !== "function") return null;
    return element.getBoundingClientRect();
  } catch (_err) {
    return null;
  }
}

function computedStyleForElement(element) {
  try {
    const win = element?.ownerGlobal || element?.ownerDocument?.defaultView;
    return win?.getComputedStyle?.(element) || null;
  } catch (_err) {
    return null;
  }
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
    const items = workbenchItemsForContext(context);
    const item = items[0];
    if (!item) {
      showAlert(t("selectOneItem"));
      return;
    }
    if (!openEmbeddedWorkbench(items)) {
      openWorkbenchDialog(items);
    }
  } catch (err) {
    Zotero.debug(`[Markdown Summary] Failed to open workbench: ${safeError(err)}`);
    showAlert(`${t("failed")}: ${safeError(err)}`);
  }
}

function openEmbeddedWorkbench(itemOrItems) {
  const items = normalizeWorkbenchItems(itemOrItems);
  const item = items[0];
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
  setEmbeddedFrameSource(frame, workbenchURL(items));
  scheduleEmbeddedFrameRecovery(win, frame, () => openWorkbenchDialog(items));
  panel.setAttribute("data-item-key", item.key || "");
  panel.setAttribute("data-item-keys", items.map((entry) => entry?.key || "").filter(Boolean).join(","));
  panel.setAttribute("data-view", "workbench");
  panel.hidden = false;
  panel.removeAttribute("hidden");
  panel.setAttribute("data-mode", hostInfo.mode);
  applyEmbeddedWorkbenchLayout(panel, frame, hostInfo.mode);
  win.setTimeout?.(() => focusEmbeddedFrame(frame), 100);
  return true;
}

function openWorkbenchDialog(itemOrItems) {
  const items = normalizeWorkbenchItems(itemOrItems);
  const item = items[0];
  openChromeDialog("content/workbench.xhtml", "zotero-markdown-summary-workbench", {
    itemID: item?.id || 0,
    itemKey: item?.key || "",
    itemIDs: items.map((entry) => entry?.id || 0).filter(Boolean).join(","),
    itemKeys: items.map((entry) => entry?.key || "").filter(Boolean).join(",")
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
  setEmbeddedFrameSource(frame, readerURL(payload));
  scheduleEmbeddedFrameRecovery(win, frame, () => openChromeDialog("content/reader.xhtml", "zotero-markdown-summary-reader", payload));
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
      retryEmbeddedFrameIfError(frame);
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

function installWorkbenchButtonWatcher(win) {
  if (!win?.document || win.__zmsWorkbenchButtonWatcher) return;
  const refresh = () => {
    try {
      ensureWorkbenchButtons(win);
    } catch (err) {
      Zotero.debug(`[Markdown Summary] Failed to refresh toolbar buttons: ${safeError(err)}`);
    }
  };
  const state = {
    interval: win.setInterval?.(refresh, 1500),
    observer: null
  };
  for (const delay of WORKBENCH_BUTTON_RECOVERY_DELAYS_MS) {
    win.setTimeout?.(refresh, delay);
  }
  const MutationObserverCtor = typeof win.MutationObserver === "function"
    ? win.MutationObserver
    : (typeof MutationObserver === "function" ? MutationObserver : null);
  if (MutationObserverCtor && win.document.documentElement) {
    let scheduled = false;
    state.observer = new MutationObserverCtor(() => {
      if (scheduled) return;
      scheduled = true;
      const run = () => {
        scheduled = false;
        refresh();
      };
      if (typeof win.setTimeout === "function") {
        win.setTimeout(run, 120);
      } else {
        run();
      }
    });
    state.observer.observe(win.document.documentElement, { childList: true, subtree: true });
  }
  win.__zmsWorkbenchButtonWatcher = state;
  refresh();
}

function removeWorkbenchButtonWatcher(windowOrDocument) {
  const win = windowOrDocument?.document ? windowOrDocument : windowOrDocument?.defaultView || windowOrDocument?.ownerGlobal;
  const state = win?.__zmsWorkbenchButtonWatcher;
  if (!state) return;
  if (state.interval !== undefined && state.interval !== null) {
    win.clearInterval?.(state.interval);
  }
  state.observer?.disconnect?.();
  delete win.__zmsWorkbenchButtonWatcher;
}

function ensureWorkbenchButtons(win) {
  const toolbar = ensureToolbarButton(win);
  const sidenav = ensureSidenavButton(win);
  const fallback = ensureFallbackWorkbenchButton(win);
  return { toolbar, sidenav, fallback };
}

function ensureFallbackWorkbenchButton(win) {
  const doc = win?.document;
  if (!doc?.documentElement) return false;
  ensureWorkbenchButtonStyle(doc);
  const toolbarButton = doc.getElementById(TOOLBAR_BUTTON_ID);
  const sidenavButton = doc.getElementById(SIDENAV_BUTTON_ID);
  if (workbenchSidenavButtonLooksReliable(sidenavButton) || workbenchToolbarButtonLooksReliable(toolbarButton)) {
    doc.getElementById(FALLBACK_WORKBENCH_BUTTON_ID)?.remove?.();
    return false;
  }
  const existing = doc.getElementById(FALLBACK_WORKBENCH_BUTTON_ID);
  const host = fallbackWorkbenchButtonHost(doc);
  if (workbenchButtonLooksUsable(existing) && existing.parentNode === host) return false;
  existing?.remove?.();
  const button = createFallbackWorkbenchButton(doc, host);
  host.appendChild(button);
  return true;
}

function workbenchButtonLooksUsable(button) {
  return !!button && !elementLooksHidden(button) && elementAttachedToDocument(button);
}

function workbenchToolbarButtonLooksReliable(button) {
  if (!workbenchButtonLooksUsable(button)) return false;
  const host = closestWorkbenchToolbarHost(button);
  if (!host || elementLooksHidden(host)) return false;
  return elementHasUsableLayoutBox(host) && elementHasUsableLayoutBox(button);
}

function workbenchSidenavButtonLooksReliable(button) {
  if (!workbenchButtonLooksUsable(button)) return false;
  const host = closestWorkbenchSidenavHost(button);
  if (!host || elementLooksHidden(host)) return false;
  return elementHasUsableLayoutBox(host) && elementHasUsableLayoutBox(button);
}

function closestWorkbenchToolbarHost(button) {
  for (let node = button?.parentNode; node; node = node.parentNode) {
    const id = String(node.id || node.getAttribute?.("id") || "");
    if ([
      "zotero-items-toolbar",
      "zotero-toolbar-item-tree",
      "zotero-toolbar",
      "zotero-collections-toolbar",
      "zotero-item-pane-toolbar"
    ].includes(id)) return node;
    if (String(node.localName || "").toLowerCase() === "toolbar") return node;
  }
  return null;
}

function closestWorkbenchSidenavHost(button) {
  for (let node = button?.parentNode; node; node = node.parentNode) {
    const id = String(node.id || node.getAttribute?.("id") || "");
    if ([
      "zotero-context-pane-sidenav",
      "zotero-context-pane-side-nav",
      "zotero-context-sidenav",
      "zotero-view-item-sidenav"
    ].includes(id)) return node;
    if (String(node.localName || "").toLowerCase().includes("sidenav")) return node;
  }
  return null;
}

function elementHasUsableLayoutBox(element) {
  const rect = safeElementRect(element);
  if (!rect) return true;
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  if (width > 0 && height > 0) return true;
  return elementHasDeclaredUsableSize(element);
}

function elementHasDeclaredUsableSize(element) {
  const style = String(element?.getAttribute?.("style") || "").toLowerCase();
  const width = cssPixelLengthFromStyle(style, "width") || cssPixelLengthFromStyle(style, "min-width");
  const height = cssPixelLengthFromStyle(style, "height") || cssPixelLengthFromStyle(style, "min-height");
  return width > 0 && height > 0;
}

function cssPixelLengthFromStyle(style, property) {
  if (!style) return 0;
  const pattern = new RegExp(`${property}\\s*:\\s*([0-9.]+)px`);
  const match = pattern.exec(style);
  return match ? Number(match[1]) || 0 : 0;
}

function fallbackWorkbenchButtonHost(doc) {
  const preferredIDs = [
    "zotero-pane-stack",
    "zotero-pane",
    "zotero-items-pane-content",
    "zotero-items-pane",
    "zotero-context-pane"
  ];
  for (const id of preferredIDs) {
    const element = doc.getElementById?.(id);
    if (element && !elementLooksHidden(element)) return element;
  }
  return doc.body || doc.documentElement;
}

function elementAttachedToDocument(element) {
  const doc = element?.ownerDocument;
  if (!doc?.documentElement) return !!element?.parentNode;
  return elementContains(doc.documentElement, element);
}

function createFallbackWorkbenchButton(doc, host) {
  const label = t("openWorkbench");
  const imageURL = `chrome://${CHROME_NAME}/content/logo.svg`;
  const iconBackground = workbenchButtonIconBackgroundStyle(imageURL, "22px");
  const htmlHost = usesHTMLChildren(host);
  const button = htmlHost ? doc.createElementNS(HTML_NS, "button") : createXULElement(doc, "toolbarbutton");
  button.id = FALLBACK_WORKBENCH_BUTTON_ID;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.setAttribute("tooltiptext", label);
  button.setAttribute("class", "zms-fallback-workbench-button");
  button.setAttribute("style", [
    "position:fixed",
    "top:96px",
    "right:12px",
    "z-index:2147483001",
    "width:36px",
    "height:36px",
    "min-width:36px",
    "min-height:36px",
    "padding:6px",
    "border:1px solid rgba(148,163,184,0.55)",
    "border-radius:10px",
    "background-color:rgba(255,255,255,0.94)",
    iconBackground,
    "box-shadow:0 8px 24px rgba(15,23,42,0.22)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "cursor:default"
  ].join("; "));
  if (htmlHost) {
    button.type = "button";
  } else {
    button.setAttribute("label", label);
    button.setAttribute("type", "button");
    button.setAttribute("image", imageURL);
    button.setAttribute("orient", "horizontal");
    button.setAttribute("appearance", "none");
    button.addEventListener("command", () => openWorkbenchForContext());
  }

  button.addEventListener("click", (event) => {
    if (event?.button && event.button !== 0) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    openWorkbenchForContext();
  });
  return button;
}

function refreshEmbeddedWorkbenchForSelection(win) {
  try {
    const doc = win?.document;
    const panel = doc?.getElementById?.(WORKBENCH_PANEL_ID);
    if (!panel || panel.hidden || panel.getAttribute("data-view") === "reader") return;
    const frame = doc.getElementById(WORKBENCH_FRAME_ID);
    if (!frame) return;
    const items = workbenchItemsForContext();
    const item = items[0];
    const itemKeys = items.map((entry) => entry?.key || "").filter(Boolean).join(",");
    if (!item?.key || panel.getAttribute("data-item-keys") === itemKeys) return;
    setEmbeddedFrameSource(frame, workbenchURL(items));
    panel.setAttribute("data-item-key", item.key || "");
    panel.setAttribute("data-item-keys", itemKeys);
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

function workbenchURL(itemOrItems) {
  const items = normalizeWorkbenchItems(itemOrItems);
  const item = items[0] || {};
  const params = new URLSearchParams({
    itemID: String(item.id || ""),
    itemKey: item.key || "",
    itemIDs: items.map((entry) => entry?.id || 0).filter(Boolean).join(","),
    itemKeys: items.map((entry) => entry?.key || "").filter(Boolean).join(","),
    embedded: "1",
    refresh: String(Date.now())
  });
  return contentPageURLs("workbench.xhtml", params);
}

function normalizeWorkbenchItems(itemOrItems) {
  const input = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const key = item?.id || item?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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
  return contentPageURLs("reader.xhtml", params);
}

function contentPageURLs(fileName, params) {
  const query = params.toString();
  const chromeURL = `chrome://${CHROME_NAME}/content/${fileName}?${query}`;
  const rootURL = rootURI ? `${rootURI}content/${fileName}?${query}` : "";
  return {
    primary: chromeURL,
    fallback: rootURL
  };
}

function setEmbeddedFrameSource(frame, urls) {
  if (!frame) return;
  const primary = typeof urls === "string" ? urls : urls?.primary || "";
  const fallback = typeof urls === "string" ? "" : urls?.fallback || "";
  frame.removeAttribute?.("data-zms-fallback-used");
  frame.removeAttribute?.("data-zms-dialog-fallback-used");
  frame.setAttribute("data-zms-fallback-src", fallback);
  frame.setAttribute("src", primary);
}

function retryEmbeddedFrameIfError(frame) {
  try {
    const fallback = frame?.getAttribute?.("data-zms-fallback-src") || "";
    if (!fallback || frame.getAttribute("data-zms-fallback-used") === "1") return;
    if (!embeddedFrameLooksUnusable(frame)) return;
    frame.setAttribute("data-zms-fallback-used", "1");
    frame.setAttribute("src", fallback);
  } catch (_err) {
    // Some frame principals cannot be inspected; the scheduled dialog fallback remains available.
  }
}

function scheduleEmbeddedFrameRecovery(win, frame, dialogFallback) {
  if (!win?.setTimeout || !frame) return;
  win.setTimeout(() => {
    if (!embeddedFrameLooksUnusable(frame)) return;
    retryEmbeddedFrameIfError(frame);
  }, 1200);
  win.setTimeout(() => {
    if (!embeddedFrameLooksUnusable(frame) || frame.getAttribute("data-zms-dialog-fallback-used") === "1") return;
    frame.setAttribute("data-zms-dialog-fallback-used", "1");
    try {
      dialogFallback?.();
    } catch (err) {
      Zotero.debug(`[Markdown Summary] Failed to recover embedded frame: ${safeError(err)}`);
    }
  }, 3000);
}

function embeddedFrameLooksUnusable(frame) {
  try {
    const href = String(frame?.contentWindow?.location?.href || "");
    const doc = frame?.contentDocument;
    const text = `${doc?.title || ""}\n${doc?.body?.textContent || ""}`;
    if (/problem loading page/i.test(String(text))) return true;
    return href === "about:blank";
  } catch (_err) {
    return false;
  }
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
