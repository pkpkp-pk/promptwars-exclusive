import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareClauses } from "./compareClauses";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const pairs = [
  { category: "deposit", docAText: "Deposit is Rs. 50,000, refundable.", docBText: "Deposit is Rs. 90,000, non-refundable." },
  { category: "termination", docAText: "One month's notice." },
];

function diffResponse(diffs: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ diffs }) }] } }],
    }),
    { status },
  );
}

describe("compareClauses", () => {
  it("sends aligned pairs and returns explained diffs in input order", async () => {
    fetchMock.mockResolvedValueOnce(
      diffResponse([
        { category: "termination", materialDifference: "B does not address termination at all.", favors: "A" },
        { category: "deposit", materialDifference: "B's deposit is higher and non-refundable.", favors: "A" },
      ]),
    );

    const diffs = await compareClauses(pairs, "Rental lease");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      contents: { parts: { text: string }[] }[];
      systemInstruction: { parts: { text: string }[] };
    };
    const prompt = body.contents[0]?.parts[0]?.text ?? "";
    expect(prompt).toContain("Rs. 50,000, refundable");
    expect(prompt).toContain("Rs. 90,000, non-refundable");
    expect(prompt).toContain("(not addressed in document B)");
    expect(body.systemInstruction.parts[0]?.text).toContain("material differences");
    expect(body.systemInstruction.parts[0]?.text).toContain("Never comment on wording");

    // Output order follows the input pairs, not the model's ordering.
    expect(diffs[0]?.category).toBe("deposit");
    expect(diffs[0]?.favors).toBe("A");
    expect(diffs[1]?.category).toBe("termination");
    expect(diffs[1]?.docBText).toBeUndefined();
  });

  it("drops pairs the model skipped and diffs with invalid favors values", async () => {
    fetchMock.mockResolvedValueOnce(
      diffResponse([
        { category: "deposit", materialDifference: "Higher in B.", favors: "reader" },
      ]),
    );

    const diffs = await compareClauses(pairs, "Rental lease");

    expect(diffs).toEqual([]);
  });

  it("throws when every model is rate-limited", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));

    await expect(compareClauses(pairs, "Rental lease", { retryDelays: [] })).rejects.toThrow(/status 429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
