import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDocuments, saveDocument } from "@/lib/store";
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

/** Store a two-clause lease snippet. */
function storedDoc() {
  saveDocument(
    {
      id: "d1",
      filename: "lease.pdf",
      rawText: "1. Rent is Rs. 18,000 monthly. 2. Two months' notice to terminate.",
      uploadedAt: new Date().toISOString(),
    },
    [
      { id: "d1-c0", docId: "d1", order: 0, text: "1. The Tenant shall pay a monthly rent of Rs. 18,000." },
      { id: "d1-c1", docId: "d1", order: 1, text: "2. Either party may terminate on two months' written notice." },
    ],
  );
}

/** Embedding API response: one vector per requested text, in order. */
function embedResponse(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({ embeddings: vectors.map((values) => ({ values })) }),
    { status: 200 },
  );
}

function answerResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 },
  );
}

async function ask(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

it("rejects a missing docId", async () => {
  const response = await ask({ question: "notice period?" });
  expect(response.status).toBe(400);
});

it("rejects an empty question", async () => {
  storedDoc();
  const response = await ask({ docId: "d1", question: "   " });
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/ask a question/i);
});

it("returns 404 for an unknown document", async () => {
  const response = await ask({ docId: "nope", question: "rent?" });
  expect(response.status).toBe(404);
});

it("answers an in-document question with citations", async () => {
  storedDoc();
  // Question vector close to clause 2 (termination), far from clause 1.
  fetchMock
    .mockResolvedValueOnce(embedResponse([[1, 0], [0, 1], [0.9, 0.1]]))
    .mockResolvedValueOnce(
      answerResponse({
        grounded: true,
        answer: "Either side can end the lease with two months' written notice.",
        citedClauseIds: ["d1-c1"],
      }),
    );

  const response = await ask({ docId: "d1", question: "What's the notice period?" });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    grounded: boolean;
    answer: string;
    citedClauseIds: string[];
  };
  expect(body.grounded).toBe(true);
  expect(body.answer).toContain("two months");
  expect(body.citedClauseIds).toEqual(["d1-c1"]);

  // One batched embedding call, then one generation call.
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const embedBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
    requests: { content: { parts: { text: string }[] } }[];
  };
  expect(embedBody.requests).toHaveLength(3); // question + 2 clauses
  expect(embedBody.requests[0]?.content.parts[0]?.text).toContain("notice period");
});

it("returns grounded: false without a generation call when retrieval misses", async () => {
  storedDoc();
  // Orthogonal vectors — cosine 0, below the threshold.
  fetchMock.mockResolvedValueOnce(embedResponse([[1, 0], [0, 1], [0, 1]]));

  const response = await ask({ docId: "d1", question: "Is this legal in Maharashtra?" });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { grounded: boolean; answer: string; citedClauseIds: string[] };
  expect(body.grounded).toBe(false);
  expect(body.answer).toMatch(/doesn’t address/i);
  expect(body.answer).toMatch(/legal professional/i);
  expect(body.citedClauseIds).toEqual([]);
  // Embedding call only — the generation model is never asked to guess.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("returns 502 with quota wording when the embedding call hits 429", async () => {
  storedDoc();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await ask({ docId: "d1", question: "rent?" }, );
  expect(response.status).toBe(502);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/usage limit/i);

  errorSpy.mockRestore();
}, 20000);

it("returns 503 when the Gemini key is not configured", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  storedDoc();
  const response = await ask({ docId: "d1", question: "rent?" });
  expect(response.status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
});
