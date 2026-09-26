import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyClauses } from "./classifyClauses";
import { CATEGORY_MAP, TYPE_LABELS } from "@/lib/documentTypes/config";
import type { Clause } from "@/lib/types";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Vitest 3: unstubAllGlobals does not restore stubEnv values — without
  // this, a pinned-model test leaks GEMINI_MODEL into later fallback tests.
  vi.unstubAllEnvs();
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

/** The options a lease classification call gets — the real lease taxonomy. */
const leaseOptions = {
  categories: CATEGORY_MAP.lease,
  documentTypeName: TYPE_LABELS.lease,
};

/** Wraps a payload the way the Gemini REST API returns structured output. */
function geminiResponse(payload: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status },
  );
}

interface RequestBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { parts: { text: string }[] }[];
  generationConfig: {
    responseMimeType: string;
    responseSchema: { items: { properties: { category: { enum: string[] } } } };
  };
}

function requestBody(call: number): RequestBody {
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

    const classified = await classifyClauses(threeClauses(), leaseOptions);

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

    await classifyClauses(threeClauses(), leaseOptions);

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
    // The schema's category enum is built from the passed taxonomy.
    expect(body.generationConfig.responseSchema.items.properties.category.enum).toEqual(
      CATEGORY_MAP.lease,
    );
    expect(body.systemInstruction.parts[0]?.text).toContain(TYPE_LABELS.lease);
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

    const classified = await classifyClauses(clauses, { ...leaseOptions, batchSize: 3 });

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

    const classified = await classifyClauses(threeClauses(), leaseOptions);

    expect(classified[0]?.category).toBe("rent");
    // Invalid category and the omitted clause stay unclassified, never guessed.
    expect(classified[1]?.category).toBeUndefined();
    expect(classified[1]?.explanation).toBeUndefined();
    expect(classified[2]?.riskLevel).toBeUndefined();
  });

  it("builds the prompt and schema from the supplied taxonomy, not a fixed one (NDA)", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { id: "d1-c0", category: "confidential_info_definition", riskLevel: "standard", explanation: "Defines what counts as confidential information." },
      ]),
    );

    const classified = await classifyClauses(threeClauses(), {
      categories: CATEGORY_MAP.nda,
      documentTypeName: TYPE_LABELS.nda,
    });

    const body = requestBody(0);
    // The schema enum is exactly the passed NDA taxonomy — no lease categories.
    expect(body.generationConfig.responseSchema.items.properties.category.enum).toEqual(
      CATEGORY_MAP.nda,
    );
    expect(body.generationConfig.responseSchema.items.properties.category.enum).not.toContain("rent");

    const systemPrompt = body.systemInstruction.parts[0]?.text ?? "";
    expect(systemPrompt).toContain("Non-disclosure agreement");
    expect(systemPrompt).toContain("confidential_info_definition");
    // No lease-only wording leaks into a non-lease classification.
    expect(systemPrompt).not.toContain("residential lease");
    expect(systemPrompt).not.toContain("tenant");

    expect(classified[0]?.category).toBe("confidential_info_definition");
  });

  it("rejects a category that belongs to a different type's taxonomy", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "A lease category, invalid for an NDA." },
        { id: "d1-c1", category: "duration", riskLevel: "standard", explanation: "States how long the obligations last." },
      ]),
    );

    const classified = await classifyClauses(threeClauses(), {
      categories: CATEGORY_MAP.nda,
      documentTypeName: TYPE_LABELS.nda,
    });

    // "rent" is a real lease category but not in the taxonomy passed for this
    // call, so that clause stays unclassified instead of being mislabeled.
    expect(classified[0]?.category).toBeUndefined();
    expect(classified[1]?.category).toBe("duration");
  });

  it("throws the last error when every model in the chain is rate-limited", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));

    // retryDelays: [] disables per-model retries — pure chain walk, 3 calls.
    await expect(
      classifyClauses(threeClauses(), { ...leaseOptions, retryDelays: [] }),
    ).rejects.toThrow(/status 429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a transient 503 on the same model before falling back", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        geminiResponse([
          { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "Sets the rent." },
        ]),
      );

    const classified = await classifyClauses(threeClauses(), {
      ...leaseOptions,
      retryDelays: [0, 0],
    });

    // Same model absorbs the spike; the chain never advances.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url1).toContain("gemini-3.8-flash");
    expect(url2).toContain("gemini-3.8-flash");
    expect(classified[0]?.category).toBe("rent");
  });

  it("advances the chain only after a model's retries are exhausted", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));

    await expect(
      classifyClauses(threeClauses(), { ...leaseOptions, retryDelays: [0, 0] }),
    ).rejects.toThrow(/status 429/);
    // 3 models × (1 initial + 2 retries).
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("uses gemini-3.8-flash as the primary model", async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([]));

    await classifyClauses(threeClauses(), leaseOptions);

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("models/gemini-3.8-flash:generateContent");
  });

  it("falls back to gemini-3.7-flash when the primary model is unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(
        geminiResponse([
          { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "Sets the rent." },
        ]),
      );

    const classified = await classifyClauses(threeClauses(), leaseOptions);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url1).toContain("gemini-3.8-flash");
    expect(url2).toContain("gemini-3.7-flash");
    expect(classified[0]?.category).toBe("rent");
  });

  it("falls back to gemini-3.6-flash when both newer models fail", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        geminiResponse([
          { id: "d1-c0", category: "rent", riskLevel: "standard", explanation: "Sets the rent." },
        ]),
      );

    // retryDelays: [] — a 429 walks straight to the next model, as before.
    const classified = await classifyClauses(threeClauses(), { ...leaseOptions, retryDelays: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url3] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(url3).toContain("gemini-3.6-flash");
    expect(classified[0]?.category).toBe("rent");
  });

  it("does not fall back when the API key itself is rejected", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "API key not valid." } }), {
        status: 400,
      }),
    );

    await expect(classifyClauses(threeClauses(), leaseOptions)).rejects.toThrow(/status 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a pinned GEMINI_MODEL without a fallback chain", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));

    await expect(classifyClauses(threeClauses(), leaseOptions)).rejects.toThrow(/status 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("gemini-2.5-flash");
  });

  it("includes the API's own error detail when Gemini rejects the request", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { message: "API key not valid. Please pass a valid API key." },
        }),
        { status: 403 },
      ),
    );

    await expect(classifyClauses(threeClauses(), leaseOptions)).rejects.toThrow(
      /status 403: API key not valid/,
    );
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(classifyClauses(threeClauses(), leaseOptions)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
