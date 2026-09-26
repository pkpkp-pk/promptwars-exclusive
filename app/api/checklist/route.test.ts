import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDocuments, saveDocument, setConfirmedType } from "@/lib/store";
import { POST } from "./route";
import type { Clause } from "@/lib/types";

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

function storedDoc(clauses: Partial<Clause>[], confirmed = true) {
  saveDocument(
    { id: "d1", filename: "lease.pdf", rawText: "raw", uploadedAt: new Date().toISOString() },
    clauses.map((partial, order) => ({
      id: `d1-c${order}`,
      docId: "d1",
      order,
      text: `${order + 1}. Clause text ${order + 1}.`,
      ...partial,
    })),
  );
  if (confirmed) setConfirmedType("d1", "lease");
}

function checklistResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 },
  );
}

async function checklist(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/checklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

it("rejects a missing docId", async () => {
  expect((await checklist({})).status).toBe(400);
});

it("404s for an unknown document", async () => {
  expect((await checklist({ docId: "gone" })).status).toBe(404);
});

it("409s before classification has run — no fresh document read", async () => {
  storedDoc([{ riskLevel: undefined }], false);

  const response = await checklist({ docId: "d1" });
  expect(response.status).toBe(409);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/analysis first/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("409s when some clauses are still unclassified", async () => {
  storedDoc([{ riskLevel: "standard" }, { riskLevel: undefined }]);

  expect((await checklist({ docId: "d1" })).status).toBe(409);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("returns red flags and lawyer questions from the classified clauses", async () => {
  storedDoc([
    { category: "deposit", riskLevel: "risky", explanation: "Non-refundable deposit." },
    { category: "rent", riskLevel: "standard", explanation: "Sets the rent." },
  ]);
  fetchMock.mockResolvedValueOnce(
    checklistResponse({
      redFlags: ["Clause 1: deposit is non-refundable — you lose it even if you leave on good terms."],
      questionsForLawyer: ["Clause 1: is a non-refundable deposit enforceable in my state?"],
    }),
  );

  const response = await checklist({ docId: "d1" });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { redFlags: string[]; questionsForLawyer: string[] };
  expect(body.redFlags[0]).toContain("Clause 1");
  expect(body.questionsForLawyer[0]).toContain("Clause 1");

  // One call, carrying the classified clauses — not the raw document.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
    contents: { parts: { text: string }[] }[];
    systemInstruction: { parts: { text: string }[] };
  };
  const prompt = sentBody.contents[0]?.parts[0]?.text ?? "";
  expect(prompt).toContain("Clause 1 [deposit, risky]");
  expect(prompt).toContain("Non-refundable deposit.");
  expect(sentBody.systemInstruction.parts[0]?.text).toContain("Never add generic checklist items");
});

it("returns 502 with quota wording when Gemini is rate-limited", async () => {
  storedDoc([{ category: "deposit", riskLevel: "risky" }]);
  fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await checklist({ docId: "d1" });
  expect(response.status).toBe(502);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/usage limit/i);

  errorSpy.mockRestore();
}, 20000);
