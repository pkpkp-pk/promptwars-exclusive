import { randomUUID } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { detectType, type TypeSuggestion } from "@/lib/documentTypes/detectType";
import { userFacingGeminiError } from "@/lib/gemini/client";
import { TYPE_LABELS } from "@/lib/documentTypes/config";
import { segmentClauses } from "@/lib/parser/segmentClauses";
import { saveDocument } from "@/lib/store";

/*
 * POST /api/upload — AGENTS2.md §7. multipart/form-data with a `file` field
 * (PDF or DOCX). Extracts the text deterministically, segments it into
 * clauses (type-agnostic), asks Gemini to suggest the document type, and
 * stores the Document + Clause[] in session state. The type is only ever
 * *suggested* — the client must show it for confirmation before calling
 * /api/classify (constraint 4), so it is stored without a confirmedType. A
 * none_of_these suggestion is rejected with 422 instead of being force-fit
 * into a taxonomy it doesn't belong to.
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Built from TYPE_LABELS so the config stays the single source of truth for
// which types exist and what the user calls them.
const SUPPORTED_TYPES = Object.values(TYPE_LABELS).join(", ");

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      400,
      "Expected a multipart/form-data upload with a file field.",
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return errorResponse(
      400,
      "No file was attached. Attach your document as a PDF or DOCX file.",
    );
  }

  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
    : "";
  if (extension !== ".pdf" && extension !== ".docx") {
    return errorResponse(
      400,
      "That file type isn’t supported. Upload a PDF or DOCX copy of your document.",
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse(
      413,
      "That file is larger than 10 MB. Try a smaller scan or a text-based export.",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let rawText: string;
  try {
    rawText =
      extension === ".pdf" ? await extractPdfText(bytes) : await extractDocxText(bytes);
  } catch {
    return errorResponse(
      422,
      "We couldn’t extract text from that file. It may be corrupted or password-protected.",
    );
  }

  if (rawText.trim().length === 0) {
    return errorResponse(
      422,
      "That file has no selectable text — it looks like a scan. Upload a text-based PDF or a DOCX copy.",
    );
  }

  // File problems are reported first (above); from here on the request is
  // the server's responsibility, so fail with a config error, not a 500.
  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      503,
      "Analysis isn’t configured on this deployment (GEMINI_API_KEY is missing).",
    );
  }

  const docId = randomUUID();
  const clauses = segmentClauses(rawText, docId);

  let suggestion: TypeSuggestion | undefined;
  try {
    suggestion = await detectType(rawText);
  } catch (error) {
    // Degrade, don't fail: the deterministic work (extraction, segmentation)
    // already succeeded, and the review UI has a manual type picker for exactly
    // this case. A transient Gemini outage must not make ingestion unusable.
    // The reason still goes to the logs for diagnosis.
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("[/api/upload] Gemini type detection failed:", detail, "|", userFacingGeminiError(error));
  }

  if (suggestion?.suggestedType === "none_of_these") {
    return errorResponse(
      422,
      `We couldn’t tell what kind of document this is. This tool supports five document types: ${SUPPORTED_TYPES}. If yours is one of them, try uploading a cleaner text-based copy.`,
    );
  }

  saveDocument(
    {
      id: docId,
      filename: file.name,
      rawText,
      uploadedAt: new Date().toISOString(),
      ...(suggestion
        ? {
            suggestedType: suggestion.suggestedType,
            suggestedTypeConfidence: suggestion.confidence,
          }
        : {}),
    },
    clauses,
  );

  return Response.json({
    docId,
    clauseCount: clauses.length,
    ...(suggestion
      ? {
          suggestedType: suggestion.suggestedType,
          suggestedTypeConfidence: suggestion.confidence,
        }
      : {}),
  });
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}
