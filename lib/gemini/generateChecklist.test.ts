import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateChecklist } from "./generateChecklist";
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

const clauses: Clause[] = [
  { id: "d1-c0", docId: "d1", order: 0, text: "1. Deposit is non-refundable.", category: "deposit", riskLevel: "risky", explanation: "You lose the deposit." },
  { id: "d1-c1", docId: "d1", order: 1, text: "2. Rent is Rs. 18,000.", category: "rent", riskLevel: "standard", explanation: "Sets the rent." },
];

function checklistResponse(payload: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status },
  );
}

describe("generateChecklist", () => {
  it("sends the classified clauses and returns the checklist", async () => {
    fetchMock.mockResolvedValueOnce(
      checklistResponse({
        redFlags: ["Clause 1: non-refundable deposit."],
        questionsForLawyer: ["Clause 1: is this enforceable?"],
      }),
    );

    const result = await generateChecklist(clauses, "Rental lease");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      contents: { parts: { text: string }[] }[];
    };
    const prompt = body.contents[0]?.parts[0]?.text ?? "";
    expect(prompt).toContain("Clause 1 [deposit, risky]");
    expect(prompt).toContain("Clause 2 [rent, standard]");
    expect(prompt).toContain("You lose the deposit.");

    expect(result.redFlags).toEqual(["Clause 1: non-refundable deposit."]);
    expect(result.questionsForLawyer).toEqual(["Clause 1: is this enforceable?"]);
  });

  it("filters non-string entries from the payload", async () => {
    fetchMock.mockResolvedValueOnce(
      checklistResponse({ redFlags: ["ok", 42, null], questionsForLawyer: [] }),
    );

    const result = await generateChecklist(clauses, "Rental lease");

    expect(result.redFlags).toEqual(["ok"]);
    expect(result.questionsForLawyer).toEqual([]);
  });

  it("throws when every model is rate-limited", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));

    await expect(generateChecklist(clauses, "Rental lease", { retryDelays: [] })).rejects.toThrow(/status 429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
