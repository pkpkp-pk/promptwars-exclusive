import { randomUUID } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { segmentClauses } from "@/lib/parser/segmentClauses";
import { saveDocument } from "@/lib/store";

/*
 * POST /api/upload — AGENTS.md §7. multipart/form-data with a `file` field
 * (PDF or DOCX). Extracts the text deterministically, segments it into
 * clauses, stores the Document + Clause[] in session state, and returns
 * { docId, clauseCount }.
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
      "No file was attached. Attach your lease as a PDF or DOCX file.",
    );
  }

  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
    : "";
  if (extension !== ".pdf" && extension !== ".docx") {
    return errorResponse(
      400,
      "That file type isn’t supported. Upload a PDF or DOCX copy of your lease.",
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

  const docId = randomUUID();
  const clauses = segmentClauses(rawText, docId);
  saveDocument(
    {
      id: docId,
      filename: file.name,
      rawText,
      uploadedAt: new Date().toISOString(),
    },
    clauses,
  );

  return Response.json({ docId, clauseCount: clauses.length });
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
