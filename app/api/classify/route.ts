import { classifyClauses } from "@/lib/gemini/classifyClauses";
import { getClauses, getDocument, updateClauses } from "@/lib/store";

/*
 * POST /api/classify — AGENTS.md §7. Request: { docId }. Runs the batched
 * Gemini classification over the stored clauses, persists the annotated
 * clauses, and returns { clauses } where each clause now carries category,
 * riskLevel, and explanation.
 */

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let docId: unknown;
  try {
    const body = (await request.json()) as { docId?: unknown };
    docId = body.docId;
  } catch {
    return errorResponse(400, "Expected a JSON body with a docId.");
  }

  if (typeof docId !== "string" || docId.length === 0) {
    return errorResponse(400, "Which document? Send the docId from the upload.");
  }

  if (!getDocument(docId)) {
    return errorResponse(
      404,
      "We couldn’t find that document. It may have expired — upload your lease again.",
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      503,
      "Analysis isn’t configured on this deployment (GEMINI_API_KEY is missing).",
    );
  }

  const clauses = getClauses(docId);
  if (!clauses || clauses.length === 0) {
    return errorResponse(422, "That document has no clauses to analyze.");
  }

  try {
    const classified = await classifyClauses(clauses);
    updateClauses(docId, classified);
    return Response.json({ clauses: classified });
  } catch {
    return errorResponse(502, "The analysis service couldn’t be reached. Please try again.");
  }
}
