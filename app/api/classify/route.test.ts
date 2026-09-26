import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDocuments, getClauses, getDocument, saveDocument } from "@/lib/store";
import { classifyClauses } from "@/lib/gemini/classifyClauses";
import { CATEGORY_MAP, TYPE_LABELS } from "@/lib/documentTypes/config";
import type { Clause, Document, DocumentType } from "@/lib/types";
import { POST } from "./route";

/*
 * classifyClauses is mocked pass-through (it calls the real implementation by
 * default) so one test can simulate a classifier returning a category outside
 * the confirmed type's taxonomy — impossible through fetch mocking alone,
 * because the real classifyClauses validates against the same taxonomy the
 * route passes in.
 */
vi.mock("@/lib/gemini/classifyClauses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/classifyClauses")>();
  return { ...actual, classifyClauses: vi.fn(actual.classifyClauses) };
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDocuments();
});

function storedDoc(id: string, clauseTexts: string[], suggestedType: DocumentType = "lease"): void {
  const document: Document = {
    id,
    filename: "document.pdf",
    rawText: clauseTexts.join("\n"),
    uploadedAt: "2026-09-19T00:00:00.000Z",
    suggestedType,
    suggestedTypeConfidence: 0.9,
  };
  const clauses: Clause[] = clauseTexts.map((text, order) => ({
    id: `${id}-c${order}`,
    docId: id,
    text,
    order,
  }));
  saveDocument(document, clauses);
}

async function classify(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/classify", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

/** The request the route sent to Gemini, parsed from the fetch mock. */
function geminiRequestBody(call: number): {
  systemInstruction: { parts: { text: string }[] };
  generationConfig: {
    responseSchema: { items: { properties: { category: { enum: string[] } } } };
  };
} {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
}

function geminiOk(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 },
  );
}

it("rejects a request without a docId", async () => {
  const response = await classify({ confirmedType: "lease" });
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/docId/i);
});

it("rejects a request without a confirmedType", async () => {
  const response = await classify({ docId: "d1" });
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/confirmedType/i);
  // Nothing was classified — the type picks the taxonomy, so nothing may run.
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects a confirmedType outside the five supported types", async () => {
  const response = await classify({ docId: "d1", confirmedType: "loan_agreement" });
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/confirmedType/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("returns 404 for an unknown document", async () => {
  const response = await classify({ docId: "missing", confirmedType: "lease" });
  expect(response.status).toBe(404);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/find that document/i);
});

it("returns 503 when the Gemini key is not configured", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  storedDoc("d1", ["1. Rent clause."]);

  const response = await classify({ docId: "d1", confirmedType: "lease" });
  expect(response.status).toBe(503);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/configured/i);
});

it("classifies a stored document and persists the results", async () => {
  storedDoc("d1", [
    "1. The Tenant shall pay a monthly rent of Rs. 18,000.",
    "2. The security deposit of Rs. 1,08,000 is refundable.",
  ]);
  fetchMock.mockResolvedValueOnce(
    geminiOk([
      { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "Sets the monthly rent." },
      { id: "d1-c1", category: "deposit", riskLevel: "unusual", explanation: "States a large refundable deposit." },
    ]),
  );

  const response = await classify({ docId: "d1", confirmedType: "lease" });
  expect(response.status).toBe(200);

  const body = (await response.json()) as { clauses: Clause[] };
  expect(body.clauses).toHaveLength(2);
  expect(body.clauses[1]?.category).toBe("deposit");
  expect(body.clauses[1]?.riskLevel).toBe("unusual");
  expect(body.clauses[1]?.explanation).toBe("States a large refundable deposit.");

  // The store is updated, so a later render of the review page sees results,
  // and the confirmed type is stamped on the stored document.
  expect(getClauses("d1")?.[1]?.riskLevel).toBe("unusual");
  expect(getDocument("d1")?.confirmedType).toBe("lease");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("classifies with the confirmed type's taxonomy, even when it overrides the suggestion", async () => {
  // Upload suggested "lease" (wrong); the user overrides to "nda". The
  // confirmed type — not the suggestion — must drive the taxonomy.
  storedDoc("d2", ["1. The Receiving Party shall keep the Disclosing Party's information confidential."], "lease");
  fetchMock.mockResolvedValueOnce(
    geminiOk([
      { id: "d2-c0", category: "obligations", riskLevel: "standard", explanation: "Requires keeping the other party's information confidential." },
    ]),
  );

  const response = await classify({ docId: "d2", confirmedType: "nda" });
  expect(response.status).toBe(200);

  const body = (await response.json()) as { clauses: Clause[] };
  expect(body.clauses[0]?.category).toBe("obligations");

  const request = geminiRequestBody(0);
  expect(request.systemInstruction.parts[0]?.text).toContain(TYPE_LABELS.nda);
  expect(
    request.generationConfig.responseSchema.items.properties.category.enum,
  ).toEqual(CATEGORY_MAP.nda);
  expect(getDocument("d2")?.confirmedType).toBe("nda");
});

it("coerces a category outside the confirmed type's taxonomy to other before persisting", async () => {
  storedDoc("d1", ["1. Late fee clause.", "2. Notice clause.", "3. Unclassified clause."]);
  // Defense-in-depth path: simulate a classifier returning an unknown
  // category (the real one re-validates, so fetch mocking can't reach this).
  vi.mocked(classifyClauses).mockResolvedValueOnce([
    { id: "d1-c0", docId: "d1", text: "1. Late fee clause.", order: 0, category: "late_fees", riskLevel: "risky", explanation: "Charges a late fee." },
    { id: "d1-c1", docId: "d1", text: "2. Notice clause.", order: 1, category: "termination", riskLevel: "standard", explanation: "Sets a notice period." },
    { id: "d1-c2", docId: "d1", text: "3. Unclassified clause.", order: 2 },
  ]);

  const response = await classify({ docId: "d1", confirmedType: "lease" });
  expect(response.status).toBe(200);

  const body = (await response.json()) as { clauses: Clause[] };
  // Invalid category becomes "other"; valid ones pass through and clauses the
  // classifier left unclassified stay unclassified.
  expect(body.clauses[0]?.category).toBe("other");
  expect(body.clauses[1]?.category).toBe("termination");
  expect(body.clauses[2]?.category).toBeUndefined();

  // The sanitized clauses are what get stored, not the raw classifier output.
  expect(getClauses("d1")?.[0]?.category).toBe("other");
  expect(getDocument("d1")?.confirmedType).toBe("lease");
});

// Real backoff delays run here (no retryDelays override) — 3 models ×
// (750ms + 2250ms) exceeds the 5s default timeout.
it("returns 502 when the Gemini call fails on every model", { timeout: 20000 }, async () => {
  storedDoc("d1", ["1. Rent clause."]);
  fetchMock.mockImplementation(async () => new Response("{}", { status: 500 }));

  const response = await classify({ docId: "d1", confirmedType: "lease" });
  expect(response.status).toBe(502);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/try again/i);
});

it("surfaces the upstream failure detail so the cause is diagnosable", async () => {
  storedDoc("d1", ["1. Rent clause."]);
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }),
      { status: 403 },
    ),
  );
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await classify({ docId: "d1", confirmedType: "lease" });
  expect(response.status).toBe(502);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/status 403/);
  expect(body.error).toMatch(/API key not valid/);
  // The full detail also lands in the server logs (visible in Vercel).
  expect(errorSpy).toHaveBeenCalled();

  errorSpy.mockRestore();
});
