import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("local agent stdio MCP runtime", () => {
  it("is valid JavaScript", () => {
    execFileSync(process.execPath, ["--check", "scripts/local-agent-mcp.mjs"], { encoding: "utf8" });
  });

  it("handles fragmented Content-Length headers", async () => {
    const runtime = startRuntime();
    try {
      const responsePromise = runtime.nextMessage();
      runtime.writeFramed({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, 12);
      const response = await responsePromise;

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          serverInfo: { name: "local-agent-mcp" },
          capabilities: { tools: {} }
        }
      });
    } finally {
      runtime.stop();
    }
  });

  it("lists callable local agent tools with bounded check schema", async () => {
    const runtime = startRuntime();
    try {
      const responsePromise = runtime.nextMessage();
      runtime.writeFramed({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const response = await responsePromise;
      const tools = response.result.tools;
      const names = tools.map((tool: any) => tool.name);

      expect(names).toEqual([
        "ask_gemini",
        "ask_claude",
        "ask_opencode",
        "ask_all_agents",
        "check_local_agents",
        "ocr_image",
        "extract_pdf_pages"
      ]);
      expect(tools.find((tool: any) => tool.name === "check_local_agents").inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
        properties: {
          timeoutSeconds: { type: "number" },
          agents: {
            type: "array",
            items: { enum: ["gemini", "claude", "opencode"] }
          }
        },
        required: []
      });
      expect(tools.find((tool: any) => tool.name === "ask_claude").inputSchema.required).toEqual(["prompt"]);
      expect(tools.find((tool: any) => tool.name === "ask_all_agents").inputSchema.properties.agents).toMatchObject({
        type: "array",
        items: {
          enum: ["gemini", "claude", "opencode"]
        }
      });
      expect(tools.find((tool: any) => tool.name === "ocr_image").inputSchema.properties.imageBase64).toMatchObject({
        type: "string"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.filePath).toMatchObject({
        type: "string"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.pdfBase64).toMatchObject({
        type: "string"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.ocrFallback).toMatchObject({
        type: "boolean"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.ocrFallback.description).toContain("per-page OCR confidence signals");
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.fullDocumentOcr).toMatchObject({
        type: "boolean"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.maxOcrPages).toMatchObject({
        type: "number"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.ocrPageStrategy).toMatchObject({
        type: "string"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.ocrAutoRepair).toMatchObject({
        type: "boolean"
      });
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.ocrAutoRepair.description).toContain("higher-DPI render");
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.ocrPages.description).toContain("1,3-5");
      expect(tools.find((tool: any) => tool.name === "extract_pdf_pages").inputSchema.properties.minTextChars).toMatchObject({
        type: "number"
      });
    } finally {
      runtime.stop();
    }
  });

  it("runs local OCR through the configured image OCR CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const tesseractBin = fakeBin(dir, "tesseract", "Axis Delay 12 ms");
      const runtime = startRuntime({
        LOCAL_AGENT_TESSERACT_BIN: tesseractBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: {
            name: "ocr_image",
            arguments: {
              imageBase64: Buffer.from("fake image").toString("base64"),
              mimeType: "image/png",
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "tesseract",
          language: "eng",
          mimeType: "image/png",
          text: "Axis Delay 12 ms"
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts page-level PDF text through the configured pdftotext CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const pdftotextBin = fakeBin(
        dir,
        "pdftotext",
        "The proposed method uses graph attention.\fExperiments evaluate delay metrics."
      );
      const runtime = startRuntime({
        LOCAL_AGENT_PDFTOTEXT_BIN: pdftotextBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "extract_pdf_pages",
            arguments: {
              pdfBase64: Buffer.from("%PDF fake").toString("base64"),
              name: "candidate.pdf",
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "pdftotext",
          name: "candidate.pdf",
          pageCount: 2,
          quality: {
            status: "pass",
            engine: "pdftotext",
            pagesWithText: 2,
            emptyPageCount: 0,
            ocrFallbackUsed: false,
            warnings: []
          },
          pages: [
            {
              page: 1,
              pageLabel: "1",
              text: "The proposed method uses graph attention."
            },
            {
              page: 2,
              pageLabel: "2",
              text: "Experiments evaluate delay metrics."
            }
          ]
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to local OCR for scanned PDFs when enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const pdftotextBin = fakeBin(dir, "pdftotext", "");
      const pdftoppmBin = fakePdfToPpmBin(dir, "pdftoppm", 2);
      const tesseractBin = fakeBin(dir, "tesseract", "OCR method text from scanned page.");
      const runtime = startRuntime({
        LOCAL_AGENT_PDFTOTEXT_BIN: pdftotextBin,
        LOCAL_AGENT_PDFTOPPM_BIN: pdftoppmBin,
        LOCAL_AGENT_TESSERACT_BIN: tesseractBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: {
            name: "extract_pdf_pages",
            arguments: {
              pdfBase64: Buffer.from("%PDF scanned fake").toString("base64"),
              name: "scanned.pdf",
              timeoutSeconds: 12,
              ocrFallback: true,
              maxOcrPages: 2,
              ocrLanguage: "eng"
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "tesseract",
          name: "scanned.pdf",
          pageCount: 2,
          ocrFallbackUsed: true,
          textPageCount: 0,
          ocrRenderedPageCount: 2,
          ocrEmptyPageCount: 0,
          ocrLanguage: "eng",
          quality: {
            status: "warning",
            engine: "tesseract",
            pagesWithText: 2,
            emptyPageCount: 0,
            ocrFallbackUsed: true,
            ocrReadablePageCount: 2,
            ocrLowConfidencePageCount: 0,
            ocrErrorPageCount: 0,
            warnings: ["ocr_fallback_used"]
          },
          pages: [
            {
              page: 1,
              pageLabel: "1",
              text: "OCR method text from scanned page.",
              ocr: {
                page: 1,
                status: "ok",
                textChars: 34,
                ocrConfidence: "medium",
                warnings: []
              }
            },
            {
              page: 2,
              pageLabel: "2",
              text: "OCR method text from scanned page.",
              ocr: {
                page: 2,
                status: "ok",
                textChars: 34,
                ocrConfidence: "medium",
                warnings: []
              }
            }
          ]
        });
        expect(parsed.quality.ocrPageSignals).toHaveLength(2);
        expect(parsed.quality.ocrPageSignals[0]).toMatchObject({
          page: 1,
          engine: "tesseract",
          language: "eng",
          status: "ok",
          textChars: 34,
          ocrConfidence: "medium"
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports per-page OCR fallback confidence for empty and failed scanned PDF pages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const pdftotextBin = fakeBin(dir, "pdftotext", "");
      const pdftoppmBin = fakePdfToPpmBin(dir, "pdftoppm", 3);
      const tesseractBin = fakeTesseractByPageBin(dir, "tesseract", {
        1: "dense enough OCR text for a readable scanned page",
        2: "",
        3: { error: "unreadable bitmap", code: 2 }
      });
      const runtime = startRuntime({
        LOCAL_AGENT_PDFTOTEXT_BIN: pdftotextBin,
        LOCAL_AGENT_PDFTOPPM_BIN: pdftoppmBin,
        LOCAL_AGENT_TESSERACT_BIN: tesseractBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 11,
          method: "tools/call",
          params: {
            name: "extract_pdf_pages",
            arguments: {
              pdfBase64: Buffer.from("%PDF scanned partial").toString("base64"),
              name: "partial-scan.pdf",
              timeoutSeconds: 12,
              ocrFallback: true,
              maxOcrPages: 3,
              ocrAutoRepair: false,
              ocrLanguage: "eng"
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "tesseract",
          name: "partial-scan.pdf",
          pageCount: 1,
          ocrFallbackUsed: true,
          ocrRenderedPageCount: 3,
          ocrEmptyPageCount: 2,
          quality: {
            status: "warning",
            engine: "tesseract",
            pagesWithText: 1,
            emptyPageCount: 2,
            ocrReadablePageCount: 1,
            ocrLowConfidencePageCount: 0,
            ocrErrorPageCount: 1
          }
        });
        expect(parsed.quality.warnings).toEqual([
          "ocr_fallback_used",
          "empty_or_unread_pages",
          "ocr_page_errors"
        ]);
        expect(parsed.quality.ocrPageSignals).toEqual([
          expect.objectContaining({ page: 1, status: "ok", ocrConfidence: "medium", textChars: 49, warnings: [] }),
          expect.objectContaining({ page: 2, status: "empty", ocrConfidence: "none", textChars: 0, warnings: ["ocr_page_empty"] }),
          expect.objectContaining({ page: 3, status: "error", ocrConfidence: "error", textChars: 0, warnings: ["ocr_page_error"] })
        ]);
        expect(parsed.quality.ocrPageSignals[2].error).toContain("unreadable bitmap");
        expect(parsed.pages).toHaveLength(1);
        expect(parsed.pages[0]).toMatchObject({
          page: 1,
          text: "dense enough OCR text for a readable scanned page",
          ocr: { status: "ok", ocrConfidence: "medium" }
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repairs empty OCR pages with a higher-DPI retry when enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const pdftotextBin = fakeBin(dir, "pdftotext", "");
      const pdftoppmBin = fakePdfToPpmBin(dir, "pdftoppm", 2);
      const tesseractBin = fakeRepairingTesseractByPageBin(
        dir,
        "tesseract",
        {
          1: "first page OCR text is already readable",
          2: ""
        },
        {
          2: "second page OCR recovered after high DPI rendering"
        }
      );
      const runtime = startRuntime({
        LOCAL_AGENT_PDFTOTEXT_BIN: pdftotextBin,
        LOCAL_AGENT_PDFTOPPM_BIN: pdftoppmBin,
        LOCAL_AGENT_TESSERACT_BIN: tesseractBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 111,
          method: "tools/call",
          params: {
            name: "extract_pdf_pages",
            arguments: {
              pdfBase64: Buffer.from("%PDF scanned repair").toString("base64"),
              name: "repair-scan.pdf",
              timeoutSeconds: 12,
              ocrFallback: true,
              maxOcrPages: 2,
              ocrLanguage: "eng"
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "tesseract",
          name: "repair-scan.pdf",
          pageCount: 2,
          ocrFallbackUsed: true,
          ocrRenderedPageCount: 2,
          ocrEmptyPageCount: 0,
          ocrRepairAttemptedPageCount: 1,
          ocrRepairRecoveredPageCount: 1,
          ocrRepairFailedPageCount: 0,
          quality: {
            status: "warning",
            engine: "tesseract",
            pagesWithText: 2,
            emptyPageCount: 0,
            ocrFallbackUsed: true,
            ocrReadablePageCount: 2,
            ocrRepairAttemptedPageCount: 1,
            ocrRepairRecoveredPageCount: 1,
            ocrRepairFailedPageCount: 0,
            warnings: ["ocr_fallback_used", "ocr_auto_repair_used"]
          }
        });
        expect(parsed.pages.map((page: any) => page.page)).toEqual([1, 2]);
        expect(parsed.pages[1]).toMatchObject({
          page: 2,
          text: "second page OCR recovered after high DPI rendering",
          ocr: {
            status: "ok",
            repairAttempted: true,
            repairDpi: 300,
            repairStatus: "recovered",
            previousStatus: "empty",
            warnings: ["ocr_page_repaired"]
          }
        });
        expect(parsed.quality.ocrPageSignals[1]).toMatchObject({
          page: 2,
          status: "ok",
          repairAttempted: true,
          repairStatus: "recovered",
          previousStatus: "empty",
          warnings: ["ocr_page_repaired"]
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("OCRs sparse middle PDF pages and merges them with pdftotext pages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const pdftotextBin = fakeBin(
        dir,
        "pdftotext",
        [
          "The proposed method uses graph attention on page one.",
          "Experiments evaluate delay metrics on page two.",
          "",
          "Limitations include missing weather robustness checks on page four."
        ].join("\f")
      );
      const pdftoppmBin = fakePdfToPpmBin(dir, "pdftoppm", 4);
      const tesseractBin = fakeTesseractByPageBin(dir, "tesseract", {
        3: "OCR recovered scanned middle page with contribution details."
      });
      const runtime = startRuntime({
        LOCAL_AGENT_PDFTOTEXT_BIN: pdftotextBin,
        LOCAL_AGENT_PDFTOPPM_BIN: pdftoppmBin,
        LOCAL_AGENT_TESSERACT_BIN: tesseractBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 12,
          method: "tools/call",
          params: {
            name: "extract_pdf_pages",
            arguments: {
              pdfBase64: Buffer.from("%PDF sparse middle page").toString("base64"),
              name: "sparse-middle.pdf",
              timeoutSeconds: 12,
              ocrFallback: true,
              ocrPageStrategy: "sparse",
              maxOcrPages: 2,
              minTextChars: 40,
              ocrLanguage: "eng"
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "pdftotext+tesseract",
          name: "sparse-middle.pdf",
          pageCount: 4,
          ocrFallbackUsed: true,
          textPageCount: 3,
          textSlotCount: 4,
          ocrRenderedPageCount: 1,
          ocrEmptyPageCount: 0,
          quality: {
            status: "warning",
            engine: "pdftotext+tesseract",
            pagesWithText: 4,
            expectedPageCount: 4,
            emptyPageCount: 0,
            ocrFallbackUsed: true,
            warnings: ["ocr_fallback_used"]
          }
        });
        expect(parsed.pages.map((page: any) => page.page)).toEqual([1, 2, 3, 4]);
        expect(parsed.pages[2]).toMatchObject({
          page: 3,
          pageLabel: "3",
          text: "OCR recovered scanned middle page with contribution details.",
          ocr: {
            page: 3,
            status: "ok",
            ocrConfidence: "medium"
          }
        });
        expect(parsed.quality.ocrPageSignals).toEqual([
          expect.objectContaining({ page: 3, status: "ok", textChars: 60 })
        ]);
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows explicit full-document OCR beyond the default page cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const pdftotextBin = fakeBin(dir, "pdftotext", Array(15).fill("").join("\f"));
      const pdftoppmBin = fakePdfToPpmBin(dir, "pdftoppm", 15);
      const ocrOutputs: Record<number, string> = {};
      for (let page = 1; page <= 15; page += 1) {
        ocrOutputs[page] = `Full document OCR recovered page ${page} with method evidence and experiment details.`;
      }
      const tesseractBin = fakeTesseractByPageBin(dir, "tesseract", ocrOutputs);
      const runtime = startRuntime({
        LOCAL_AGENT_PDFTOTEXT_BIN: pdftotextBin,
        LOCAL_AGENT_PDFTOPPM_BIN: pdftoppmBin,
        LOCAL_AGENT_TESSERACT_BIN: tesseractBin
      });
      try {
        const responsePromise = runtime.nextMessage(10000);
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 13,
          method: "tools/call",
          params: {
            name: "extract_pdf_pages",
            arguments: {
              pdfBase64: Buffer.from("%PDF full scanned document").toString("base64"),
              name: "full-scan.pdf",
              timeoutSeconds: 30,
              ocrFallback: true,
              ocrPageStrategy: "all",
              fullDocumentOcr: true,
              maxOcrPages: 15,
              minTextChars: 40,
              ocrLanguage: "eng"
            }
          }
        });
        const response = await responsePromise;
        const parsed = JSON.parse(response.result.content[0].text);

        expect(parsed).toMatchObject({
          engine: "tesseract",
          name: "full-scan.pdf",
          pageCount: 15,
          ocrFallbackUsed: true,
          ocrRenderedPageCount: 15,
          ocrEmptyPageCount: 0,
          ocrMaxPages: 15,
          ocrPageStrategy: "all",
          ocrRequestedPageCount: 15,
          ocrTruncatedPageCount: 0,
          ocrFullDocumentUsed: true,
          quality: {
            status: "warning",
            engine: "tesseract",
            pagesWithText: 15,
            expectedPageCount: 15,
            emptyPageCount: 0,
            ocrFallbackUsed: true,
            ocrFullDocumentUsed: true,
            ocrPageStrategy: "all",
            ocrMaxPages: 15,
            ocrRequestedPageCount: 15,
            ocrTruncatedPageCount: 0,
            warnings: ["ocr_fallback_used", "ocr_full_document_used"]
          }
        });
        expect(parsed.pages.map((page: any) => page.page)).toEqual(Array.from({ length: 15 }, (_value, index) => index + 1));
        expect(parsed.quality.ocrPageSignals).toHaveLength(15);
        expect(parsed.quality.ocrPageSignals[14]).toMatchObject({
          page: 15,
          status: "ok",
          ocrConfidence: "medium"
        });
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("limits check_local_agents health checks to requested agents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini health OK");
      const claudeBin = fakeBin(dir, "claude", "Claude should not run", 1);
      const opencodeBin = fakeBin(dir, "opencode", "opencode should not run", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "check_local_agents",
            arguments: {
              agents: ["gemini"],
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini health OK");
        expect(text).not.toContain("## Claude");
        expect(text).not.toContain("## opencode");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns partial ask_all_agents output when one CLI fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini partial answer");
      const claudeBin = fakeBin(dir, "claude", "Claude partial answer");
      const opencodeBin = fakeBin(dir, "opencode", "quota_exceeded", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini partial answer");
        expect(text).toContain("## Claude\nClaude partial answer");
        expect(text).toContain("## opencode\nERROR:");
        expect(text).toContain("quota_exceeded");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an MCP error when every selected ask_all_agents CLI fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini failed", 1);
      const claudeBin = fakeBin(dir, "claude", "Claude failed", 1);
      const opencodeBin = fakeBin(dir, "opencode", "opencode should not run", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              agents: ["gemini", "claude"],
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;

        expect(response.error).toMatchObject({
          code: -32000
        });
        expect(response.error.message).toContain("All local agents failed");
        expect(response.error.message).toContain("Gemini failed");
        expect(response.error.message).toContain("Claude failed");
        expect(response).not.toHaveProperty("result");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns partial ask_all_agents output before the outer timeout when one CLI hangs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini before hang");
      const claudeBin = fakeBin(dir, "claude", "Claude before hang");
      const opencodeBin = slowBin(dir, "opencode", 20000, "opencode too late");
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage(9000);
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 10
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini before hang");
        expect(text).toContain("## Claude\nClaude before hang");
        expect(text).toContain("## opencode\nERROR: CLI call timed out after 5s");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);

  it("limits ask_all_agents fan-out to the requested agents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = fakeBin(dir, "gemini", "Gemini selected");
      const claudeBin = fakeBin(dir, "claude", "Claude selected");
      const opencodeBin = fakeBin(dir, "opencode", "opencode should not run", 1);
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        LOCAL_AGENT_CLAUDE_BIN: claudeBin,
        LOCAL_AGENT_OPENCODE_BIN: opencodeBin,
        LOCAL_AGENT_OPENCODE_SPAWN_CWD: dir
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "ask_all_agents",
            arguments: {
              prompt: "Review this change",
              agents: ["gemini", "claude"],
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;
        const text = response.result.content[0].text;

        expect(text).toContain("## Gemini\nGemini selected");
        expect(text).toContain("## Claude\nClaude selected");
        expect(text).not.toContain("## opencode");
        expect(text).not.toContain("opencode should not run");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retries transient CLI cwd errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = flakyBin(dir, "gemini", "Gemini recovered after retry");
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "ask_gemini",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;

        expect(response.result.content[0].text).toBe("Gemini recovered after retry");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not pass launchd XPC variables to child CLIs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zms-local-agent-"));
    try {
      const geminiBin = envProbeBin(dir, "gemini", "XPC_SERVICE_NAME");
      const runtime = startRuntime({
        LOCAL_AGENT_GEMINI_BIN: geminiBin,
        XPC_SERVICE_NAME: "local.test.service"
      });
      try {
        const responsePromise = runtime.nextMessage();
        runtime.writeFramed({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "ask_gemini",
            arguments: {
              prompt: "Review this change",
              cwd: process.cwd(),
              timeoutSeconds: 5
            }
          }
        });
        const response = await responsePromise;

        expect(response.result.content[0].text).toBe("clean");
      } finally {
        runtime.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function startRuntime(env: Record<string, string> = {}) {
  const child = spawn(process.execPath, ["scripts/local-agent-mcp.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env
    }
  });
  let buffer = Buffer.alloc(0);
  const pending: Array<(message: any) => void> = [];
  const messages: any[] = [];

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const message = readFramedMessage();
      if (!message) break;
      const resolve = pending.shift();
      if (resolve) resolve(message);
      else messages.push(message);
    }
  });

  return {
    writeFramed(payload: any, splitAt = 0) {
      const text = JSON.stringify(payload);
      const frame = `Content-Length: ${Buffer.byteLength(text, "utf8")}\r\n\r\n${text}`;
      if (splitAt > 0) {
        child.stdin.write(frame.slice(0, splitAt));
        setTimeout(() => child.stdin.write(frame.slice(splitAt)), 10);
        return;
      }
      child.stdin.write(frame);
    },
    nextMessage(timeoutMs = 5000) {
      const message = messages.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for MCP response")), timeoutMs);
        pending.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    },
    stop() {
      child.kill();
    }
  };

  function readFramedMessage() {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return null;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) return null;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    const end = start + length;
    if (buffer.length < end) return null;
    const message = JSON.parse(buffer.subarray(start, end).toString("utf8"));
    buffer = buffer.subarray(end);
    return message;
  }
}

function fakeBin(dir: string, name: string, output: string, code = 0) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    code === 0
      ? `process.stdout.write(${JSON.stringify(output)});`
      : `process.stderr.write(${JSON.stringify(output)});`,
    `process.exit(${code});`,
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function fakePdfToPpmBin(dir: string, name: string, pageCount: number) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const prefix = args[args.length - 1];",
    `const pageCount = ${pageCount};`,
    "const flagValue = (flag, fallback) => {",
    "  const index = args.indexOf(flag);",
    "  return index >= 0 ? Number(args[index + 1]) : fallback;",
    "};",
    "const firstPage = Math.max(1, flagValue('-f', 1));",
    "const lastPage = Math.min(pageCount, Math.max(firstPage, flagValue('-l', pageCount)));",
    "for (let page = firstPage; page <= lastPage; page += 1) {",
    "  fs.writeFileSync(`${prefix}-${page}.png`, `fake page ${page}`);",
    "}",
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function fakeTesseractByPageBin(dir: string, name: string, outputs: Record<number, string | { error: string; code?: number }>) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    "const imagePath = process.argv[2] || '';",
    "const match = /-(\\d+)\\.[^.]+$/.exec(imagePath);",
    "const page = match ? Number(match[1]) : 0;",
    `const outputs = ${JSON.stringify(outputs)};`,
    "const output = outputs[page] ?? '';",
    "if (output && typeof output === 'object') {",
    "  process.stderr.write(output.error || 'ocr failed');",
    "  process.exit(output.code || 1);",
    "}",
    "process.stdout.write(String(output || ''));",
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function fakeRepairingTesseractByPageBin(
  dir: string,
  name: string,
  outputs: Record<number, string | { error: string; code?: number }>,
  repairOutputs: Record<number, string | { error: string; code?: number }>
) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    "const imagePath = process.argv[2] || '';",
    "const match = /-(\\d+)\\.[^.]+$/.exec(imagePath);",
    "const page = match ? Number(match[1]) : 0;",
    `const outputs = ${JSON.stringify(outputs)};`,
    `const repairOutputs = ${JSON.stringify(repairOutputs)};`,
    "const source = imagePath.includes('/repair-page-') ? repairOutputs : outputs;",
    "const output = source[page] ?? '';",
    "if (output && typeof output === 'object') {",
    "  process.stderr.write(output.error || 'ocr failed');",
    "  process.exit(output.code || 1);",
    "}",
    "process.stdout.write(String(output || ''));",
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function flakyBin(dir: string, name: string, output: string) {
  const path = join(dir, name);
  const marker = join(dir, `${name}.called`);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const marker = ${JSON.stringify(marker)};`,
    "if (!fs.existsSync(marker)) {",
    "  fs.writeFileSync(marker, '1');",
    "  process.stderr.write('Error: EINTR: process.cwd failed with error interrupted system call, uv_cwd');",
    "  process.exit(1);",
    "}",
    `process.stdout.write(${JSON.stringify(output)});`,
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function slowBin(dir: string, name: string, delayMs: number, output: string) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    `setTimeout(() => process.stdout.write(${JSON.stringify(output)}), ${delayMs});`,
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

function envProbeBin(dir: string, name: string, key: string) {
  const path = join(dir, name);
  writeFileSync(path, [
    "#!/usr/bin/env node",
    `const key = ${JSON.stringify(key)};`,
    "process.stdout.write(process.env[key] || 'clean');",
    ""
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}
