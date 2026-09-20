import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDocuments, getClauses, saveDocument } from "@/lib/store";
import { POST } from "./route";
import type { Clause, Document } from "@/lib/types";

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

function storedDoc(id: string, clauseTexts: string[]): void {
  const document: Document = {
    id,
    filename: "lease.pdf",
    rawText: clauseTexts.join("\n"),
    uploadedAt: "2026-09-19T00:00:00.000Z",
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

it("rejects a request without a docId", async () => {
  const response = await classify({});
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/docId/i);
});

it("returns 404 for an unknown document", async () => {
  const response = await classify({ docId: "missing" });
  expect(response.status).toBe(404);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/find that document/i);
});

it("returns 503 when the Gemini key is not configured", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  storedDoc("d1", ["1. Rent clause."]);

  const response = await classify({ docId: "d1" });
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
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "Sets the monthly rent." },
                    { id: "d1-c1", category: "deposit", riskLevel: "unusual", explanation: "States a large refundable deposit." },
                  ]),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );

  const response = await classify({ docId: "d1" });
  expect(response.status).toBe(200);

  const body = (await response.json()) as { clauses: Clause[] };
  expect(body.clauses).toHaveLength(2);
  expect(body.clauses[1]?.category).toBe("deposit");
  expect(body.clauses[1]?.riskLevel).toBe("unusual");
  expect(body.clauses[1]?.explanation).toBe("States a large refundable deposit.");

  // The store is updated, so a later render of the review page sees results.
  expect(getClauses("d1")?.[1]?.riskLevel).toBe("unusual");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("returns 502 when the Gemini call fails", async () => {
  storedDoc("d1", ["1. Rent clause."]);
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));

  const response = await classify({ docId: "d1" });
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

  const response = await classify({ docId: "d1" });
  expect(response.status).toBe(502);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/status 403/);
  expect(body.error).toMatch(/API key not valid/);
  // The full detail also lands in the server logs (visible in Vercel).
  expect(errorSpy).toHaveBeenCalled();

  errorSpy.mockRestore();
});
