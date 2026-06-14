import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("writeback smoke verifier", () => {
  it("runs real filesystem preview, backup, atomic write, stale guard, and rollback checks", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/verify-writeback-smoke.mjs", "--json"], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    });
    const report = JSON.parse(stdout);

    expect(report.ok).toBe(true);
    expect(report.keptTemp).toBe(false);
    expect(report.checks.map((entry: any) => [entry.id, entry.ok])).toEqual([
      ["preview.diff", true],
      ["preview.summary", true],
      ["commit.after", true],
      ["commit.backup", true],
      ["commit.temp-cleanup", true],
      ["stale.guard", true],
      ["failure.throws", true],
      ["failure.rollback", true],
      ["failure.backup", true]
    ]);
  });
});
