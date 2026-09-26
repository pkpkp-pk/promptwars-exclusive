import { classifyClauses } from "@/lib/gemini/classifyClauses";
import { userFacingGeminiError } from "@/lib/gemini/client";
import { CATEGORY_MAP, TYPE_LABELS } from "@/lib/documentTypes/config";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import type { DocumentType } from "@/lib/types";
import { getClauses, getDocument, setConfirmedType, updateClauses } from "@/lib/store";

/*
 * POST /api/classify — AGENTS2.md §7. Request: { docId, confirmedType }. Runs
 * the batched Gemini classification over the stored clauses using the
 * confirmed type's category taxonomy, persists the annotated clauses, stamps
 * the confirmed type on the stored document, and returns { clauses } where
 * each clause now carries category, riskLevel, and explanation.
 *
 * The type must be the one the user confirmed (AGENTS2.md §2.4) — the upload
 * route's suggestion is never allowed to silently pick a taxonomy here,
 * because a wrong type changes every category downstream.
 */

// CATEGORY_MAP's keys are the source of truth for which document types
// exist — a separate list here could drift from the taxonomies in config.
const DOCUMENT_TYPES: readonly string[] = Object.keys(CATEGORY_MAP);

/** Classification spends ceil(N/25) Gemini calls — cap repeats per IP. */
const CLASSIFY_LIMIT = 30;
const CLASSIFY_WINDOW_MS = 60 * 60 * 1000;

function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && DOCUMENT_TYPES.includes(value);
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let docId: unknown;
  let confirmedType: unknown;
  try {
    const body = (await request.json()) as {
      docId?: unknown;
      confirmedType?: unknown;
    };
    docId = body.docId;
    confirmedType = body.confirmedType;
  } catch {
    return errorResponse(400, "Expected a JSON body with a docId and confirmedType.");
  }

  if (typeof docId !== "string" || docId.length === 0) {
    return errorResponse(400, "Which document? Send the docId from the upload.");
  }

  if (!isDocumentType(confirmedType)) {
    return errorResponse(
      400,
      "Which document type? Send confirmedType — one of the five supported types — from the confirmation step.",
    );
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
    return errorResponse(422, "That document has no clauses to analyze.");
  }

  // Idempotency: re-confirming the same type on an already-classified
  // document (new tab, lost sessionStorage cache) returns the stored result
  // instead of re-paying the full classification.
  if (
    document.confirmedType === confirmedType &&
    clauses.every((clause) => clause.riskLevel !== undefined)
  ) {
    return Response.json({ clauses });
  }

  if (!rateLimit("classify", clientIp(request), CLASSIFY_LIMIT, CLASSIFY_WINDOW_MS)) {
    return errorResponse(
      429,
      "Too many analysis runs from your network — wait a while and try again.",
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      503,
      "Analysis isn’t configured on this deployment (GEMINI_API_KEY is missing).",
    );
  }

  try {
    const classified = await classifyClauses(clauses, {
      categories: CATEGORY_MAP[confirmedType],
      documentTypeName: TYPE_LABELS[confirmedType],
    });

    // Defense-in-depth: the response schema constrains the model to this
    // taxonomy and classifyClauses re-validates every entry against the same
    // list, so an invalid category should be impossible here — but this route
    // is what persists to the store. If a future change on either side ever
    // lets an unknown category through, coerce it to "other" rather than
    // persisting a category no UI, checklist, or comparison knows about.
    // Clauses the model left unclassified (category undefined) stay that way.
    const taxonomy = new Set(CATEGORY_MAP[confirmedType]);
    const safeClauses = classified.map((clause) =>
      clause.category !== undefined && !taxonomy.has(clause.category)
        ? { ...clause, category: "other" }
        : clause,
    );

    updateClauses(docId, safeClauses);
    // Stamp the confirmed type so later routes (/api/compare's same-type
    // check, /api/checklist) and the review UI can rely on it.
    setConfirmedType(docId, confirmedType);
    return Response.json({ clauses: safeClauses });
  } catch (error) {
    // Surface the upstream reason (status + API message) in the logs and the
    // response so a misconfigured key or quota issue is diagnosable in
    // production instead of presenting as an opaque 502. 429 (quota) and 503
    // (demand spike) get distinct wording — userFacingGeminiError owns that.
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("[/api/classify] Gemini call failed:", detail);
    return errorResponse(502, userFacingGeminiError(error));
  }
}
