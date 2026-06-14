async function ensureDirectory(path) {
  if (!await IOUtils.exists(path)) {
    await IOUtils.makeDirectory(path, { createAncestors: true, ignoreExisting: true });
  }
}

async function writeSummaryMarkdown(path, markdown) {
  const timestamp = new Date().toISOString();
  if (await IOUtils.exists(path)) {
    try {
      const current = await readText(path);
      const backup = backupSummaryPath(path, timestamp);
      await ensureDirectory(parentDirectory(backup));
      await writeText(backup, current);
    } catch (_err) {
      // Backup failure should not prevent generating a brand-new summary; original will be replaced safely.
    }
  }
  await writeTextAtomic(path, markdown, tempSummaryPath(path, timestamp));
}

async function writeTextAtomic(path, text, tempPath) {
  await ensureDirectory(parentDirectory(path));
  try {
    await writeText(tempPath, text);
    await IOUtils.move(tempPath, path, { noOverwrite: false });
  } catch (err) {
    try {
      await removeQuietly(tempPath);
    } catch (_ignore) {
      // Ignore cleanup failures; they should not block the source error.
    }
    throw err;
  }
}

function parentDirectory(path) {
  const slashIndex = Math.max(String(path).lastIndexOf("/"), String(path).lastIndexOf("\\"));
  return slashIndex === -1 ? "." : String(path).slice(0, slashIndex);
}

function backupSummaryPath(path, timestamp) {
  const slashIndex = Math.max(String(path).lastIndexOf("/"), String(path).lastIndexOf("\\"));
  const dir = slashIndex === -1 ? "." : String(path).slice(0, slashIndex);
  const file = slashIndex === -1 ? path : String(path).slice(slashIndex + 1);
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  return `${dir}/.bak/${file}.${safeTimestamp}.md`;
}

function tempSummaryPath(path, timestamp) {
  const slashIndex = Math.max(String(path).lastIndexOf("/"), String(path).lastIndexOf("\\"));
  const dir = slashIndex === -1 ? "." : String(path).slice(0, slashIndex);
  const file = slashIndex === -1 ? path : String(path).slice(slashIndex + 1);
  return `${dir}/.${file}.${timestamp.replace(/[:.]/g, "-")}.tmp`;
}

async function readText(path) {
  if (IOUtils.readUTF8) return IOUtils.readUTF8(path);
  return new TextDecoder().decode(await IOUtils.read(path));
}

async function writeText(path, text) {
  await ensureDirectory(parentDirectory(path));
  if (Zotero.File?.putContentsAsync) return Zotero.File.putContentsAsync(path, text);
  if (IOUtils.writeUTF8) return IOUtils.writeUTF8(path, text);
  return IOUtils.write(path, new TextEncoder().encode(text));
}

async function removeQuietly(path) {
  if (!path || !await IOUtils.exists(path)) return;
  if (IOUtils.remove) await IOUtils.remove(path);
  else if (IOUtils.removeFile) await IOUtils.removeFile(path);
}

async function pathExists(path) {
  try {
    return !!path && await IOUtils.exists(path);
  } catch (_err) {
    return false;
  }
}

async function countMarkdownFiles(path) {
  try {
    const children = await IOUtils.getChildren(path);
    return children.filter((childPath) => String(childPath).toLowerCase().endsWith(".md")).length;
  } catch (_err) {
    return 0;
  }
}
