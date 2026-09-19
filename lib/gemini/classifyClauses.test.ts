import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyClauses } from "./classifyClauses";
import type { Clause } from "@/lib/types";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function clause(id: string, order: number, text: string): Clause {
  return { id, docId: "d1", text, order };
}

function threeClauses(): Clause[] {
  return [
    clause("d1-c0", 0, "1. The Tenant shall pay a monthly rent of Rs. 18,000."),
    clause("d1-c1", 1, "2. The security deposit of Rs. 1,08,000 is refundable."),
    clause("d1-c2", 2, "3. Either party may terminate on two months' notice."),
  ];
}

/** Wraps a payload the way the Gemini REST API returns structured output. */
function geminiResponse(payload: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status },
  );
}

function requestBody(call: number): {
  contents: { parts: { text: string }[] }[];
  generationConfig: { responseMimeType: string; responseSchema?: unknown };
} {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
}

describe("classifyClauses", () => {
  it("classifies every clause in one batched request and maps results back", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "Sets the monthly rent at Rs. 18,000." },
        { id: "d1-c1", category: "deposit", riskLevel: "standard", explanation: "States the refundable deposit amount." },
        { id: "d1-c2", category: "termination", riskLevel: "standard", explanation: "Allows either party to end the lease on two months' notice." },
      ]),
    );

    const classified = await classifyClauses(threeClauses());

    // One request covering all clauses, not one request per clause.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(classified).toHaveLength(3);
    expect(classified[1]?.category).toBe("deposit");
    expect(classified[1]?.riskLevel).toBe("standard");
    expect(classified[1]?.explanation).toBe("States the refundable deposit amount.");
    expect(classified[1]?.text).toBe("2. The security deposit of Rs. 1,08,000 is refundable.");
    // Input order preserved.
    expect(classified.map((c) => c.id)).toEqual(["d1-c0", "d1-c1", "d1-c2"]);
  });

  it("sends clause text and ids with a JSON-schema-constrained request", async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([]));

    await classifyClauses(threeClauses());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain(":generateContent");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");

    const body = requestBody(0);
    const prompt = body.contents[0]?.parts[0]?.text ?? "";
    expect(prompt).toContain("d1-c0");
    expect(prompt).toContain("monthly rent of Rs. 18,000");
    expect(prompt).toContain("two months' notice");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBeTruthy();
  });

  it("chunks large clause lists into sequential batches and merges the results", async () => {
    // Every batch response covers all ids; the merge must still map by id
    // onto the clauses being classified.
    const clauses = Array.from({ length: 7 }, (_, i) =>
      clause(`d1-c${i}`, i, `${i + 1}. Clause number ${i + 1}.`),
    );
    fetchMock.mockImplementation(async () =>
      geminiResponse(
        clauses.map((c) => ({
          id: c.id,
          category: "other",
          riskLevel: "standard",
          explanation: `Explanation for ${c.id}.`,
        })),
      ),
    );

    const classified = await classifyClauses(clauses, { batchSize: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(classified).toHaveLength(7);
    expect(classified.map((c) => c.id)).toEqual(clauses.map((c) => c.id));
    expect(classified[6]?.explanation).toBe("Explanation for d1-c6.");
  });

  it("leaves a clause unclassified when the model omits it or returns invalid values", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "Sets the rent." },
        { id: "d1-c1", category: "nonsense", riskLevel: "standard", explanation: "Bad enum." },
      ]),
    );

    const classified = await classifyClauses(threeClauses());

    expect(classified[0]?.category).toBe("rent");
    // Invalid category and the omitted clause stay unclassified, never guessed.
    expect(classified[1]?.category).toBeUndefined();
    expect(classified[1]?.explanation).toBeUndefined();
    expect(classified[2]?.riskLevel).toBeUndefined();
  });

  it("throws a clear error when the Gemini API responds with an error status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));

    await expect(classifyClauses(threeClauses())).rejects.toThrow(/status 429/);
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(classifyClauses(threeClauses())).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
