import { generateChecklist } from "@/lib/gemini/generateChecklist";
import { userFacingGeminiError } from "@/lib/gemini/client";
import { TYPE_LABELS } from "@/lib/documentTypes/config";
import { getClauses, getDocument } from "@/lib/store";

/*
 * POST /api/checklist — Phase 7, AGENTS2.md §7. Request: { docId }.
 * Derives red flags and lawyer questions from the already-classified clause
 * list in one Gemini call — classification must have run first (409
 * otherwise), so this route never re-reads the raw document.
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

  const document = getDocument(docId);
  if (!document) {
    return errorResponse(
      404,
      "We couldn’t find that document. It may have expired — upload your document again.",
    );
  }

  const clauses = getClauses(docId);
  if (!clauses || clauses.length === 0) {
    return errorResponse(422, "That document has no clauses to summarize.");
  }

  if (!document.confirmedType || clauses.some((clause) => clause.riskLevel === undefined)) {
    return errorResponse(
      409,
      "Run the clause analysis first — the checklist is built from the classified clauses.",
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      503,
      "Analysis isn’t configured on this deployment (GEMINI_API_KEY is missing).",
    );
  }

  try {
    const result = await generateChecklist(clauses, TYPE_LABELS[document.confirmedType]);
    return Response.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("[/api/checklist] Gemini call failed:", detail);
    return errorResponse(502, userFacingGeminiError(error));
  }
}
