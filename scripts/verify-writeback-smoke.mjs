#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile, mkdir, rename, access, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      process.exit(0);
    }
    const report = await runWritebackSmoke(options);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    if (!report.ok) process.exit(1);
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  }
}

export async function runWritebackSmoke(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "zms-writeback-"));
  const checks = [];
  try {
    const helpers = loadWorkbenchHelpers();
    const original = "---\nzoteroItemKey: ITEM\neditCount: 1\n---\n\n# Paper\n\n## Notes\n\nOld note.\n";
    const summaryPath = join(root, "paper.md");
    await writeFile(summaryPath, original, "utf8");

    const preview = helpers.applyMarkdownEdit(original, {
      summaryPath,
      chatSessionId: "chat-1",
      action: "replace_section",
      targetSection: "Notes",
      replacementText: "New checked note.",
      skillId: "paper-deep-summary",
      now: "2026-06-13T00:00:00.000Z"
    });
    const previewText = helpers.writePreviewSummary(preview, {
      summaryPath,
      action: "replace_section",
      targetSection: "Notes",
      translate: (key) => key
    });
    checks.push(check("preview.diff", preview.diff.includes("New checked note."), "Preview diff includes replacement text"));
    checks.push(check("preview.summary", previewText.includes(preview.backupPath), "Preview summary reports backup path"));

    helpers.assertWritePreviewCurrent(preview, await readFile(summaryPath, "utf8"), "stale preview");
    await helpers.commitWritePreview(summaryPath, preview);
    const committed = await readFile(summaryPath, "utf8");
    checks.push(check("commit.after", committed.includes("New checked note."), "Committed file contains edited text"));
    checks.push(check("commit.backup", await readTextIfExists(preview.backupPath) === original, "Backup file preserves original text"));
    checks.push(check("commit.temp-cleanup", !await exists(preview.tempPath), "Temporary write file is removed after commit"));

    const stalePreview = helpers.applyMarkdownEdit(committed, {
      summaryPath,
      chatSessionId: "chat-2",
      action: "append_section",
      targetSection: "Notes",
      replacementText: "Late note.",
      skillId: "paper-deep-summary",
      now: "2026-06-13T00:01:00.000Z"
    });
    await writeFile(summaryPath, `${committed}\nExternal change.\n`, "utf8");
    checks.push(check("stale.guard", throws(() => helpers.assertWritePreviewCurrent(stalePreview, `${committed}\nExternal change.\n`, "stale preview")), "Stale preview is rejected"));

    const failurePath = join(root, "failure.md");
    await writeFile(failurePath, original, "utf8");
    const failingHelpers = loadWorkbenchHelpers({ failTargetPath: failurePath });
    const failingPreview = failingHelpers.applyMarkdownEdit(original, {
      summaryPath: failurePath,
      chatSessionId: "chat-3",
      action: "append_section",
      targetSection: "Notes",
      replacementText: "Should roll back.",
      skillId: "paper-deep-summary",
      now: "2026-06-13T00:02:00.000Z"
    });
    let failedAsExpected = false;
    try {
      await failingHelpers.commitWritePreview(failurePath, failingPreview);
    } catch (error) {
      failedAsExpected = String(error?.message || error).includes("simulated move failure");
    }
    checks.push(check("failure.throws", failedAsExpected, "Injected final move failure is surfaced"));
    checks.push(check("failure.rollback", await readFile(failurePath, "utf8") === original, "Failed write restores original text"));
    checks.push(check("failure.backup", await readTextIfExists(failingPreview.backupPath) === original, "Failed write still leaves backup text"));

    return {
      ok: checks.every((entry) => entry.ok),
      tempRoot: root,
      keptTemp: Boolean(options.keepTemp),
      summaryPath,
      backupPath: preview.backupPath,
      checks
    };
  } finally {
    if (!options.keepTemp) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

function loadWorkbenchHelpers(options = {}) {
  let failTargetMove = Boolean(options.failTargetPath);
  const sandbox = {
    window: {
      parent: undefined,
      IOUtils: {
        readUTF8: (path) => readFile(path, "utf8"),
        writeUTF8: async (path, text) => {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, text, "utf8");
        },
        exists,
        makeDirectory: (path) => mkdir(path, { recursive: true }),
        move: async (from, to) => {
          if (failTargetMove && to === options.failTargetPath) {
            failTargetMove = false;
            await writeFile(to, "partial write", "utf8");
            throw new Error("simulated move failure");
          }
          await mkdir(dirname(to), { recursive: true });
          await rename(from, to);
        },
        remove: (path) => unlink(path)
      },
      PathUtils: {
        join: (...parts) => join(...parts)
      },
      Zotero: {
        File: {},
        Prefs: {
          get: () => ""
        },
        Promise: {
          delay: () => Promise.resolve()
        }
      }
    },
    navigator: {
      clipboard: {
        writeText() {}
      }
    },
    TextDecoder,
    TextEncoder,
    ReadableStream,
    console
  };
  const context = createContext(sandbox);
  const code = readFileSync("addon/content/workbench.js", "utf8");
  runInContext(code, context, { filename: "workbench.js" });
  return context;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readTextIfExists(path) {
  return await exists(path) ? readFile(path, "utf8") : "";
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch (_error) {
    return true;
  }
}

function parseArgs(args) {
  const options = { json: false, keepTemp: false, help: false };
  for (const arg of args) {
    if (arg === "--json") options.json = true;
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function formatReport(report) {
  const lines = [
    report.ok ? "Writeback smoke verification passed" : "Writeback smoke verification failed",
    `tempRoot: ${report.tempRoot}`,
    `keptTemp: ${report.keptTemp}`
  ];
  for (const entry of report.checks) {
    lines.push(`${entry.ok ? "PASS" : "FAIL"} ${entry.id}: ${entry.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return [
    "Usage:",
    "  npm run verify:writeback",
    "  npm run verify:writeback -- --json",
    "",
    "Options:",
    "  --json       Print machine-readable JSON",
    "  --keep-temp  Keep the temporary smoke directory for inspection"
  ].join("\n") + "\n";
}

function isMainModule() {
  const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
  return import.meta.url === entry || fileURLToPath(import.meta.url) === process.argv[1];
}
