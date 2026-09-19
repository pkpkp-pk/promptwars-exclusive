import type { Clause } from "@/lib/types";

/*
 * First-cut deterministic clause segmentation (Phase 1). Splits on numbered
 * clause markers; falls back to blank-line paragraphs when no numbering
 * exists. Phase 2 hardens this against the other fixture formats (ALL-CAPS
 * headings, unstructured text) with a full test matrix.
 *
 * Pure function, no LLM and no I/O — constraint 3 in AGENTS.md: the LLM layer
 * only ever sees clauses this function found.
 */

const NUMBERED_MARKER = /^\s*(?:\d{1,3}[.)]|\(\d{1,3}\))\s+/;

function chunkByNumberedMarkers(rawText: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let sawMarker = false;

  for (const line of rawText.split(/\r?\n/)) {
    if (NUMBERED_MARKER.test(line)) {
      sawMarker = true;
      if (current.join("").trim() !== "") chunks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.join("").trim() !== "") chunks.push(current.join("\n"));

  return sawMarker ? chunks : [];
}

function chunkByParagraphs(rawText: string): string[] {
  return rawText.split(/\n\s*\n/);
}

export function segmentClauses(rawText: string, docId: string): Clause[] {
  const chunks = chunkByNumberedMarkers(rawText);
  const source = chunks.length > 0 ? chunks : chunkByParagraphs(rawText);

  return source
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((text, order) => ({ id: `${docId}-c${order}`, docId, text, order }));
}
