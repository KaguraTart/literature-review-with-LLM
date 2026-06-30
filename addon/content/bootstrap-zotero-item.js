async function findPdfAttachment(item) {
  if (isPdfAttachmentItem(item)) return item;
  if (typeof item.getBestAttachment === "function") {
    const best = await item.getBestAttachment();
    if (best?.attachmentContentType === "application/pdf") return best;
  }
  const attachmentIDs = typeof item?.getAttachments === "function" ? item.getAttachments() : [];
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    if (isPdfAttachmentItem(attachment)) return attachment;
  }
  return null;
}

async function findExistingSummaryAttachment(item, settings) {
  const prefix = summaryTitlePrefix(item);
  for (const id of item.getAttachments()) {
    const attachment = Zotero.Items.get(id);
    if (!attachment) continue;
    const title = attachment.getField("title") || "";
    if (!title.startsWith(prefix)) continue;
    const path = await attachment.getFilePathAsync().catch(() => "");
    if (!path || path.startsWith(settings.outputDir)) return attachment;
  }
  return null;
}

async function findMarkdownAttachment(item) {
  for (const id of item.getAttachments()) {
    const attachment = Zotero.Items.get(id);
    if (!attachment) continue;
    const title = attachment.getField("title") || "";
    const path = await attachment.getFilePathAsync().catch(() => "");
    const contentType = attachment.attachmentContentType || "";
    if (contentType === "text/markdown" || title.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".md")) {
      return attachment;
    }
  }
  return null;
}

async function linkOrUpdateAttachment(item, outputPath, existing) {
  const title = `${summaryTitlePrefix(item)}.md`;
  if (existing) {
    const previous = summaryAttachmentSnapshot(existing);
    try {
      if (typeof existing.setField === "function") existing.setField("title", title);
      else existing.title = title;
      existing.attachmentPath = outputPath;
      existing.attachmentContentType = existing.attachmentContentType || "text/markdown";
      if (typeof existing.saveTx === "function") {
        await existing.saveTx();
        return existing;
      }
    } catch (_err) {
      restoreSummaryAttachmentSnapshot(existing, previous);
      // Fall back to a fresh linked file if the existing attachment cannot be repaired.
    }
  }
  return Zotero.Attachments.linkFromFile({
    file: outputPath,
    parentItemID: item.id,
    contentType: "text/markdown",
    title
  });
}

function summaryAttachmentSnapshot(attachment) {
  return {
    title: typeof attachment.getField === "function" ? attachment.getField("title") : attachment.title,
    attachmentPath: attachment.attachmentPath,
    attachmentContentType: attachment.attachmentContentType
  };
}

function restoreSummaryAttachmentSnapshot(attachment, snapshot) {
  try {
    if (typeof attachment.setField === "function") attachment.setField("title", snapshot.title || "");
    else attachment.title = snapshot.title;
    attachment.attachmentPath = snapshot.attachmentPath;
    attachment.attachmentContentType = snapshot.attachmentContentType;
  } catch (_err) {
    // Best-effort cleanup before creating a fresh linked attachment.
  }
}

function selectedRegularItems(context) {
  return selectedItems(context).filter((item) => item?.isRegularItem());
}

function selectedWorkbenchItems(context) {
  return uniqueItems(selectedItems(context).map(workbenchItemFromSelection).filter(Boolean));
}

function selectedItems(context) {
  if (Array.isArray(context?.items)) return context.items;
  return Zotero.getActiveZoteroPane?.().getSelectedItems?.() || [];
}

function workbenchItemFromSelection(item) {
  if (!item) return null;
  if (item.isRegularItem?.()) return item;
  const parent = parentRegularItemForAttachment(item);
  if (parent) return parent;
  return isPdfAttachmentItem(item) ? item : null;
}

function parentRegularItemForAttachment(item) {
  const parentID = Number(item?.parentItemID || item?.parentID || 0);
  if (!parentID) return null;
  const parent = Zotero.Items.get(parentID);
  return parent?.isRegularItem?.() ? parent : null;
}

function isPdfAttachmentItem(item) {
  return String(item?.attachmentContentType || "").toLowerCase() === "application/pdf";
}

async function currentListRegularItems(collection) {
  const collectionItems = await regularItemsFromCollection(collection);
  if (collectionItems.length) return collectionItems;

  const pane = Zotero.getActiveZoteroPane();
  const fromItemTree = itemsFromItemTree(pane?.itemsView || pane?.itemTreeView || pane?.itemTree);
  if (fromItemTree.length) return fromItemTree;

  const targetCollection = collection || pane?.getSelectedCollection?.();
  const selectedCollectionItems = await regularItemsFromCollection(targetCollection);
  if (selectedCollectionItems.length) return selectedCollectionItems;
  return selectedRegularItems();
}

async function regularItemsFromCollection(collection) {
  if (!collection) return [];
  if (collection?.getChildItems) {
    const childItems = await collection.getChildItems();
    return childItems.map((item) => typeof item === "number" ? Zotero.Items.get(item) : item).filter((item) => item?.isRegularItem?.());
  }
  if (collection?.getChildItemsAsync) {
    const childItems = await collection.getChildItemsAsync();
    return childItems.map((item) => typeof item === "number" ? Zotero.Items.get(item) : item).filter((item) => item?.isRegularItem?.());
  }
  return [];
}

function collectionContextFromItem(collection, pane) {
  if (!collection) return null;
  const collectionName = (collection.name || "").trim() || (collection.getName?.() || "").trim();
  const rawKey = collection.key || collection.id || collectionName || "collection";
  return {
    id: Number(collection.id || collection.collectionID || 0),
    key: String(rawKey),
    name: collectionName || String(rawKey),
    type: collection.type || "collection",
    outputDir: PathUtils.join(getSettings().outputDir || pref("outputDir") || "", "collections", sanitizeFilename(String(rawKey))),
    parentLibraryID: Number(pane?.view?.selectedLibraryID || pane?.libraryID || collection.libraryID || 0),
    libraryID: Number(collection.libraryID || pane?.view?.selectedLibraryID || pane?.libraryID || 0),
    collection
  };
}

function paperBatchRecord(item, status, extra = {}) {
  return {
    status,
    itemKey: item?.key || "",
    title: item?.getField?.("title") || item?.key || "",
    year: item?.getField?.("date") || "",
    updatedAt: new Date().toISOString(),
    ...extra
  };
}

function itemsFromItemTree(itemTree) {
  if (!itemTree) return [];
  const rowCount = Number(itemTree.rowCount ?? itemTree.getRowCount?.() ?? 0);
  const items = [];
  for (let row = 0; row < rowCount; row++) {
    const item = itemTree.getRow?.(row)?.ref
      || itemTree.getRow?.(row)?.item
      || itemTree.getItemAtRow?.(row)
      || itemTree.getItem?.(row);
    if (item?.isRegularItem?.()) items.push(item);
  }
  return items;
}

function uniqueRegularItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items || []) {
    if (!item?.isRegularItem?.() || seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

async function indexedTextLength(pdf) {
  try {
    return String((await pdf.attachmentText) || "").trim().length;
  } catch (_err) {
    return 0;
  }
}

function uniqueItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items || []) {
    const key = item?.id || item?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function annotationCount(pdf) {
  try {
    const annotations = typeof pdf?.getAnnotations === "function" ? pdf.getAnnotations() : [];
    return Array.isArray(annotations) ? annotations.length : 0;
  } catch (_err) {
    return 0;
  }
}

function noteCount(item) {
  try {
    const notes = typeof item?.getNotes === "function" ? item.getNotes() : [];
    return Array.isArray(notes) ? notes.length : 0;
  } catch (_err) {
    return 0;
  }
}

function summaryTitlePrefix(item) {
  return `Markdown 摘要 - ${item.key}`;
}
