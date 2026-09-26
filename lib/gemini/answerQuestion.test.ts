import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestion } from "./answerQuestion";
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
});

const excerpts: Clause[] = [
  { id: "d1-c2", docId: "d1", order: 2, text: "3. Either party may terminate on two months' notice." },
  { id: "d1-c0", docId: "d1", order: 0, text: "1. The Tenant shall pay a monthly rent of Rs. 18,000." },
];

function geminiResponse(payload: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status },
  );
}

describe("answerQuestion", () => {
  it("sends the question and excerpts, returns a cited grounded answer", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({
        grounded: true,
        answer: "Either side can end the lease with two months' written notice.",
        citedClauseIds: ["d1-c2"],
      }),
    );

    const result = await answerQuestion("What's the notice period?", excerpts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      contents: { parts: { text: string }[] }[];
      systemInstruction: { parts: { text: string }[] };
    };
    const prompt = body.contents[0]?.parts[0]?.text ?? "";
    expect(prompt).toContain("What's the notice period?");
    expect(prompt).toContain("id: d1-c2");
    expect(prompt).toContain("two months' notice");
    // The grounding rules reach the model.
    expect(body.systemInstruction.parts[0]?.text).toContain("Answer only from the provided excerpts");
    expect(body.systemInstruction.parts[0]?.text).toContain("citedClauseIds");

    expect(result).toEqual({
      grounded: true,
      answer: "Either side can end the lease with two months' written notice.",
      citedClauseIds: ["d1-c2"],
    });
  });

  it("passes through an ungrounded answer unchanged", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({
        grounded: false,
        answer: "The document does not address this. Consult a qualified legal professional.",
        citedClauseIds: [],
      }),
    );

    const result = await answerQuestion("Is this legal in Maharashtra?", excerpts);

    expect(result.grounded).toBe(false);
    expect(result.citedClauseIds).toEqual([]);
  });

  it("drops citations to clauses the model never saw", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({
        grounded: true,
        answer: "The rent is Rs. 18,000.",
        citedClauseIds: ["d1-c0", "d1-c99"],
      }),
    );

    const result = await answerQuestion("What is the rent?", excerpts);

    // d1-c99 was not among the excerpts — a fabricated reference, removed.
    expect(result.citedClauseIds).toEqual(["d1-c0"]);
  });

  it("treats a malformed payload as a model failure and advances the chain", async () => {
    fetchMock
      .mockResolvedValueOnce(geminiResponse({ grounded: "yes", answer: 42 }))
      .mockResolvedValueOnce(
        geminiResponse({ grounded: true, answer: "Two months' notice.", citedClauseIds: ["d1-c2"] }),
      );

    const result = await answerQuestion("Notice period?", excerpts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.grounded).toBe(true);
  });

  it("throws when every model is rate-limited", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));

    await expect(
      answerQuestion("q", excerpts, { retryDelays: [] }),
    ).rejects.toThrow(/status 429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(answerQuestion("q", excerpts)).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
