import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDocuments, saveDocument, setConfirmedType } from "@/lib/store";
import { POST } from "./route";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearDocuments();
});

function storedDoc(id: string, type: "lease" | "nda", clauseTexts: string[]) {
  saveDocument(
    { id, filename: `${id}.pdf`, rawText: clauseTexts.join(" "), uploadedAt: new Date().toISOString() },
    clauseTexts.map((text, order) => ({ id: `${id}-c${order}`, docId: id, text, order, category: "deposit", riskLevel: "standard" as const })),
  );
  setConfirmedType(id, type);
}

function embedResponse(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({ embeddings: vectors.map((values) => ({ values })) }),
    { status: 200 },
  );
}

function diffResponse(diffs: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ diffs }) }] } }],
    }),
    { status: 200 },
  );
}

async function compare(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

it("rejects missing ids", async () => {
  expect((await compare({ docAId: "a" })).status).toBe(400);
});

it("rejects comparing a document to itself", async () => {
  storedDoc("a", "lease", ["1. Deposit is Rs. 50,000."]);
  expect((await compare({ docAId: "a", docBId: "a" })).status).toBe(400);
});

it("404s when a document is unknown", async () => {
  storedDoc("a", "lease", ["1. Deposit is Rs. 50,000."]);
  expect((await compare({ docAId: "a", docBId: "gone" })).status).toBe(404);
});

it("409s when confirmed types differ — no cross-type diff", async () => {
  storedDoc("a", "lease", ["1. Deposit is Rs. 50,000."]);
  storedDoc("b", "nda", ["1. Confidentiality lasts two years."]);

  const response = await compare({ docAId: "a", docBId: "b" });
  expect(response.status).toBe(409);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/different document types/i);
  // No Gemini spend on a nonsense comparison.
  expect(fetchMock).not.toHaveBeenCalled();
});

it("aligns same-category clauses by similarity and returns explained diffs", async () => {
  storedDoc("a", "lease", ["1. Deposit is Rs. 50,000, refundable.", "2. Rent is Rs. 18,000 monthly."]);
  storedDoc("b", "lease", ["1. Deposit is Rs. 90,000, non-refundable.", "2. Rent is Rs. 20,000 monthly."]);
  // Per-document embed calls (cached in the store): deposit clauses get
  // [1, 0], rent clauses [0, 1] — each A clause matches its B counterpart.
  fetchMock.mockImplementation(async (url: unknown, init?: { body?: unknown }) => {
    if (String(url).includes("batchEmbedContents")) {
      const body = JSON.parse(String(init?.body)) as {
        requests: { content: { parts: { text: string }[] } }[];
      };
      return embedResponse(
        body.requests.map((r) =>
          r.content.parts[0]?.text.includes("Deposit") ? [1, 0] : [0, 1],
        ),
      );
    }
    return diffResponse([
      { category: "deposit", materialDifference: "B's deposit is higher and non-refundable.", favors: "A" },
      { category: "deposit", materialDifference: "Rent differs by Rs. 2,000.", favors: "A" },
    ]);
  });

  const response = await compare({ docAId: "a", docBId: "b" });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { diffs: { category: string; favors: string; materialDifference: string }[] };
  expect(body.diffs).toHaveLength(2);
  expect(body.diffs[0]?.materialDifference).toContain("non-refundable");
  expect(body.diffs[0]?.favors).toBe("A");

  // First compare: one embed call per document + one comparison call.
  expect(fetchMock).toHaveBeenCalledTimes(3);

  // Repeat compare of the same pair serves the cached diff — zero API calls.
  fetchMock.mockClear();
  const again = await compare({ docAId: "a", docBId: "b" });
  expect(again.status).toBe(200);
  expect(((await again.json()) as { diffs: unknown[] }).diffs).toHaveLength(2);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("returns 502 with quota wording when Gemini is rate-limited", async () => {
  storedDoc("a", "lease", ["1. Deposit is Rs. 50,000."]);
  storedDoc("b", "lease", ["1. Deposit is Rs. 60,000."]);
  fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await compare({ docAId: "a", docBId: "b" });
  expect(response.status).toBe(502);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/usage limit/i);

  errorSpy.mockRestore();
}, 20000);
