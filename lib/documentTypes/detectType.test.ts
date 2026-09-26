import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectType } from "./detectType";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  // unstubAllGlobals does not restore env stubs in Vitest 3 — without this,
  // a GEMINI_MODEL pinned in one test would shorten every later chain.
  vi.unstubAllEnvs();
});

/*
 * Synthetic samples written for these tests, per AGENTS2.md §2 constraint 6:
 * clearly-labeled synthetic examples, never presented as real documents.
 * Each is a clean, unambiguous example of one supported type; the sale deed
 * is a real-ish document shape that matches none of the five.
 */
const SYNTHETIC_LEASE = `RENTAL AGREEMENT

This Rental Agreement is made on 1 April 2026 between the Owner, Mr. R. Kumar, and the Tenant, Ms. A. Sharma, for Flat 402, Sunrise Apartments, Pune.

1. The Tenant shall pay a monthly rent of Rs. 18,000 by the 5th of every month.
2. The Tenant has paid a refundable security deposit of Rs. 1,08,000.
3. Either party may terminate this agreement on two months' written notice.
4. The Tenant shall keep the premises in good condition and pay electricity and water charges.`;

const SYNTHETIC_FREELANCE = `FREELANCE SERVICES AGREEMENT

This Agreement is made between the Client, Acme Designs Pvt. Ltd., and the Freelancer, Mr. V. Rao, for design services.

1. The Freelancer shall deliver three logo concepts and a brand style guide within 30 days.
2. The Client shall pay Rs. 60,000 within 15 days of each invoice.
3. All intellectual property in the final deliverables transfers to the Client on full payment.
4. Either party may terminate this Agreement on 14 days' written notice.`;

const SYNTHETIC_TOS = `TERMS OF SERVICE AND PRIVACY POLICY

Welcome to StreamLine, a music streaming app.

1. By creating an account you agree to these Terms.
2. We collect your email address, playback history, and device information to run the service.
3. We share usage analytics with advertising partners.
4. You may request deletion of your account and data at any time.
5. We may suspend accounts that violate these Terms.`;

const SYNTHETIC_NDA = `NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement is made between Zenith Labs Ltd. (the Disclosing Party) and Mr. S. Iyer (the Receiving Party).

1. The Receiving Party shall hold all Confidential Information in strict confidence.
2. This obligation lasts for two years from the date of disclosure.
3. The obligations do not apply to information already public.
4. Any breach entitles the Disclosing Party to seek an injunction.`;

const SYNTHETIC_OFFER = `OFFER OF EMPLOYMENT

Dear Ms. N. Patel,

We are pleased to offer you the position of Software Engineer at Orbit Systems Pvt. Ltd.

1. Your annual compensation will be Rs. 12,00,000 (CTC).
2. You will be on probation for six months.
3. Either party may end the employment with 60 days' notice.
4. You shall not join a competitor within 12 months of leaving.
5. All work product created during employment belongs to the company.`;

const SYNTHETIC_SALE_DEED = `DEED OF ABSOLUTE SALE

This Deed is executed on 12 March 2026 between the Seller, Mr. D. Mehta, and the Buyer, Mrs. L. Fernandes.

1. The Seller sells to the Buyer the independent house at Plot 14, Green Park, Goa.
2. The consideration of Rs. 45,00,000 has been paid in full.
3. The Seller hands over vacant possession on execution of this Deed.`;

/** Wraps a payload the way the Gemini REST API returns structured output. */
function geminiResponse(payload: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status },
  );
}

/** A 200 whose text is not valid JSON — what a schema miss looks like. */
function geminiRawText(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 },
  );
}

function requestBody(call: number): {
  systemInstruction: { parts: { text: string }[] };
  contents: { parts: { text: string }[] }[];
  generationConfig: {
    responseMimeType: string;
    responseSchema?: { properties?: Record<string, { enum?: string[] }> };
  };
} {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
}

describe("detectType", () => {
  it("identifies a rental lease from a clean synthetic sample", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({ documentType: "lease", confidence: 0.98 }),
    );

    const result = await detectType(SYNTHETIC_LEASE);

    // Detection is a single request for the whole document.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ suggestedType: "lease", confidence: 0.98 });
  });

  it("identifies a freelance contract from a clean synthetic sample", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({ documentType: "freelance_contract", confidence: 0.96 }),
    );

    const result = await detectType(SYNTHETIC_FREELANCE);

    expect(result.suggestedType).toBe("freelance_contract");
    expect(result.confidence).toBe(0.96);
  });

  it("identifies terms of service / privacy policy from a clean synthetic sample", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({ documentType: "tos_privacy_policy", confidence: 0.97 }),
    );

    const result = await detectType(SYNTHETIC_TOS);

    expect(result.suggestedType).toBe("tos_privacy_policy");
    expect(result.confidence).toBe(0.97);
  });

  it("identifies an NDA from a clean synthetic sample", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({ documentType: "nda", confidence: 0.99 }),
    );

    const result = await detectType(SYNTHETIC_NDA);

    expect(result.suggestedType).toBe("nda");
    expect(result.confidence).toBe(0.99);
  });

  it("identifies an employment offer from a clean synthetic sample", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({ documentType: "employment_offer", confidence: 0.95 }),
    );

    const result = await detectType(SYNTHETIC_OFFER);

    expect(result.suggestedType).toBe("employment_offer");
    expect(result.confidence).toBe(0.95);
  });

  it("returns none_of_these for a document that matches no supported type", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({ documentType: "none_of_these", confidence: 0.86 }),
    );

    const result = await detectType(SYNTHETIC_SALE_DEED);

    expect(result).toEqual({ suggestedType: "none_of_these", confidence: 0.86 });
  });

  it("sends the document text with a JSON-schema-constrained request", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse({ documentType: "lease", confidence: 0.9 }),
    );

    await detectType(SYNTHETIC_LEASE);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("models/gemini-3.8-flash:generateContent");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");

    const body = requestBody(0);
    expect(body.contents[0]?.parts[0]?.text).toContain("RENTAL AGREEMENT");
    expect(body.contents[0]?.parts[0]?.text).toContain("monthly rent of Rs. 18,000");
    // The never-force-fit instruction and the escape value both reach the model.
    expect(body.systemInstruction.parts[0]?.text).toContain("none_of_these");
    expect(body.systemInstruction.parts[0]?.text).toContain("Never force-fit");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    const enumValues = body.generationConfig.responseSchema?.properties?.documentType?.enum;
    expect(enumValues).toEqual([
      "lease",
      "freelance_contract",
      "tos_privacy_policy",
      "nda",
      "employment_offer",
      "none_of_these",
    ]);
  });

  it("falls back to gemini-3.7-flash when the primary model is unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(
        geminiResponse({ documentType: "lease", confidence: 0.9 }),
      );

    const result = await detectType(SYNTHETIC_LEASE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url1).toContain("gemini-3.8-flash");
    expect(url2).toContain("gemini-3.7-flash");
    expect(result.suggestedType).toBe("lease");
  });

  it("falls back to gemini-3.6-flash when both newer models fail", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        geminiResponse({ documentType: "nda", confidence: 0.9 }),
      );

    // retryDelays: [] — a 429 walks straight to the next model, as before.
    const result = await detectType(SYNTHETIC_NDA, { retryDelays: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url3] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(url3).toContain("gemini-3.6-flash");
    expect(result.suggestedType).toBe("nda");
  });

  it("throws the last error when every model in the chain fails", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));

    await expect(detectType(SYNTHETIC_LEASE, { retryDelays: [] })).rejects.toThrow(/status 429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a transient 503 on the same model before falling back", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(geminiResponse({ documentType: "lease", confidence: 0.9 }));

    const result = await detectType(SYNTHETIC_LEASE, { retryDelays: [0, 0] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url1).toContain("gemini-3.8-flash");
    expect(url2).toContain("gemini-3.8-flash");
    expect(result.suggestedType).toBe("lease");
  });

  it("does not fall back when the API key itself is rejected", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "API key not valid." } }), {
        status: 400,
      }),
    );

    await expect(detectType(SYNTHETIC_LEASE)).rejects.toThrow(/status 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a pinned GEMINI_MODEL without a fallback chain", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));

    await expect(detectType(SYNTHETIC_LEASE)).rejects.toThrow(/status 404/);
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

    await expect(detectType(SYNTHETIC_LEASE)).rejects.toThrow(
      /status 403: API key not valid/,
    );
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(detectType(SYNTHETIC_LEASE)).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats malformed JSON as a model failure and retries the next model", async () => {
    fetchMock
      .mockResolvedValueOnce(geminiRawText("It looks like a lease to me."))
      .mockResolvedValueOnce(
        geminiResponse({ documentType: "lease", confidence: 0.9 }),
      );

    const result = await detectType(SYNTHETIC_LEASE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.suggestedType).toBe("lease");
  });

  it("treats an out-of-enum type or non-numeric confidence as a model failure", async () => {
    fetchMock
      .mockResolvedValueOnce(
        geminiResponse({ documentType: "mortgage_deed", confidence: 0.9 }),
      )
      .mockResolvedValueOnce(
        geminiResponse({ documentType: "lease", confidence: "0.9" }),
      )
      .mockResolvedValueOnce(
        geminiResponse({ documentType: "lease", confidence: 0.9 }),
      );

    const result = await detectType(SYNTHETIC_LEASE);

    // Both invalid shapes are walked off the chain, never coerced.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ suggestedType: "lease", confidence: 0.9 });
  });
});
