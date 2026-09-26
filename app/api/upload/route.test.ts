import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDocuments, getClauses, getDocument, saveDocument } from "@/lib/store";
import { POST } from "./route";

// Keep the real store but observe saveDocument, so a none_of_these upload
// can be proven to store nothing — a force-fit is never persisted.
vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return { ...actual, saveDocument: vi.fn(actual.saveDocument) };
});

const TEN_MB = 10 * 1024 * 1024;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(saveDocument).mockClear();
  clearDocuments();
});

function fixtureFile(name: string, uploadName: string, type: string): File {
  const bytes = readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url));
  return new File([bytes], uploadName, { type });
}

/** The Gemini response for the upload's single type-detection call. */
function typeDetectionResponse(documentType: string, confidence: number): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ documentType, confidence }) }] } },
      ],
    }),
    { status: 200 },
  );
}

async function upload(file: File | null): Promise<Response> {
  const form = new FormData();
  if (file) form.set("file", file);
  return POST(new Request("http://localhost/api/upload", { method: "POST", body: form }));
}

it("rejects an upload with no file attached", async () => {
  const response = await upload(null);
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/no file/i);
});

it("rejects unsupported file types", async () => {
  const response = await upload(new File(["plain text"], "notes.txt", { type: "text/plain" }));
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/PDF or DOCX/);
});

it("rejects files larger than 10 MB", async () => {
  const oversize = new File([new Uint8Array(TEN_MB + 1)], "lease.pdf", {
    type: "application/pdf",
  });
  const response = await upload(oversize);
  expect(response.status).toBe(413);
});

it("extracts, segments, detects and stores a text PDF end to end", async () => {
  fetchMock.mockResolvedValueOnce(typeDetectionResponse("lease", 0.97));

  const response = await upload(
    fixtureFile("synthetic-lease.pdf", "lease.pdf", "application/pdf"),
  );
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    docId: string;
    clauseCount: number;
    suggestedType: string;
    suggestedTypeConfidence: number;
  };
  expect(body.docId).toBeTruthy();
  expect(body.clauseCount).toBe(9);
  expect(body.suggestedType).toBe("lease");
  expect(body.suggestedTypeConfidence).toBe(0.97);

  const stored = getDocument(body.docId);
  expect(stored?.filename).toBe("lease.pdf");
  expect(stored?.rawText).toContain("monthly rent");
  expect(stored?.rawText.length).toBeGreaterThan(500);
  // Suggested, never confirmed — confirming is the client's step.
  expect(stored?.suggestedType).toBe("lease");
  expect(stored?.suggestedTypeConfidence).toBe(0.97);
  expect(stored?.confirmedType).toBeUndefined();
  expect(getClauses(body.docId)).toHaveLength(9);

  // One detection call per upload, run over the text that was extracted.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
    contents: { parts: { text: string }[] }[];
  };
  expect(sentBody.contents[0]?.parts[0]?.text).toContain("monthly rent");
  expect(saveDocument).toHaveBeenCalledTimes(1);
});

it("extracts, segments, detects and stores a DOCX end to end", async () => {
  fetchMock.mockResolvedValueOnce(typeDetectionResponse("lease", 0.95));

  const response = await upload(
    fixtureFile(
      "synthetic-lease.docx",
      "lease.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  );
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    docId: string;
    clauseCount: number;
    suggestedType: string;
    suggestedTypeConfidence: number;
  };
  expect(body.clauseCount).toBe(9);
  expect(body.suggestedType).toBe("lease");
  expect(body.suggestedTypeConfidence).toBe(0.95);

  const stored = getDocument(body.docId);
  expect(stored?.rawText).toContain("security deposit");
  expect(stored?.suggestedType).toBe("lease");
  expect(stored?.confirmedType).toBeUndefined();
});

it("rejects a PDF with no text layer (a scan)", async () => {
  const response = await upload(fixtureFile("blank.pdf", "scanned.pdf", "application/pdf"));
  expect(response.status).toBe(422);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/scan/i);
});

it("returns 422 and stores nothing when no supported type matches", async () => {
  fetchMock.mockResolvedValueOnce(typeDetectionResponse("none_of_these", 0.88));

  const response = await upload(
    fixtureFile("synthetic-lease.pdf", "mystery.pdf", "application/pdf"),
  );
  expect(response.status).toBe(422);

  const body = (await response.json()) as { error: string };
  // The error lists all five supported types so the user can self-serve.
  expect(body.error).toMatch(/five document types/i);
  expect(body.error).toMatch(/Rental lease/);
  expect(body.error).toMatch(/Freelance \/ client contract/);
  expect(body.error).toMatch(/Terms & privacy policy/);
  expect(body.error).toMatch(/Non-disclosure agreement/);
  expect(body.error).toMatch(/Employment offer letter/);
  // Never force-fit: nothing is stored for an unidentified document.
  expect(saveDocument).not.toHaveBeenCalled();
});

it("returns 503 when the Gemini key is not configured", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");

  const response = await upload(
    fixtureFile("synthetic-lease.pdf", "lease.pdf", "application/pdf"),
  );
  expect(response.status).toBe(503);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/configured/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

// Real backoff delays run here (3 models × 3s of retries) — needs more than
// the 5s default timeout.
it("degrades gracefully when type detection fails on every model", { timeout: 20000 }, async () => {
  fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await upload(
    fixtureFile("synthetic-lease.pdf", "lease.pdf", "application/pdf"),
  );

  // The deterministic work (extraction, segmentation) succeeded — a transient
  // Gemini outage must not make ingestion unusable. The document is stored
  // without a suggestion; the review UI's manual type picker takes over.
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    docId: string;
    clauseCount: number;
    suggestedType?: string;
    suggestedTypeConfidence?: number;
  };
  expect(body.docId).toBeTruthy();
  expect(body.clauseCount).toBe(9);
  expect(body.suggestedType).toBeUndefined();
  expect(body.suggestedTypeConfidence).toBeUndefined();

  const stored = getDocument(body.docId);
  expect(stored?.filename).toBe("lease.pdf");
  expect(stored?.suggestedType).toBeUndefined();
  expect(getClauses(body.docId)).toHaveLength(9);

  // The upstream reason still goes to the logs for diagnosis.
  expect(errorSpy).toHaveBeenCalled();
  expect(saveDocument).toHaveBeenCalledTimes(1);

  errorSpy.mockRestore();
});
