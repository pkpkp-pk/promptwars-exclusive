import type { Clause } from "@/lib/types";

/*
 * Deterministic clause segmentation (Phases 1–2). Splits on numbered clause
 * markers; otherwise falls back to blank-line paragraphs, with short ALL-CAPS
 * heading paragraphs (RENT, SECURITY DEPOSIT, …) merged into the paragraph
 * that follows them so headings never stand alone as clauses. Numbering is
 * the stronger signal, so a lease that numbers its clauses is always split on
 * the numbers.
 *
 * Pure function, no LLM and no I/O — constraint 3 in AGENTS.md: the LLM layer
 * only ever sees clauses this function found.
 */

const NUMBERED_MARKER = /^\s*(?:\d{1,3}[.)]|\(\d{1,3}\))\s+/;

/* A short, entirely-uppercase paragraph: a section heading or document title. */
const CAPS_HEADING = /^(?=[^a-z]*[A-Z])[^a-z]{2,60}$/;

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

function mergeCapsHeadings(paragraphs: string[]): string[] {
  const merged: string[] = [];
  let pendingHeading: string | null = null;

  for (const paragraph of paragraphs) {
    if (CAPS_HEADING.test(paragraph.trim())) {
      // Two headings in a row: the earlier one has no body, keep it as-is.
      if (pendingHeading) merged.push(pendingHeading);
      pendingHeading = paragraph.trim();
    } else if (pendingHeading) {
      merged.push(`${pendingHeading}\n${paragraph.trim()}`);
      pendingHeading = null;
    } else {
      merged.push(paragraph);
    }
  }
  if (pendingHeading) merged.push(pendingHeading);

  return merged;
}

export function segmentClauses(rawText: string, docId: string): Clause[] {
  const numbered = chunkByNumberedMarkers(rawText);
  const source =
    numbered.length > 0
      ? numbered
      : mergeCapsHeadings(chunkByParagraphs(rawText));

  return source
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((text, order) => ({ id: `${docId}-c${order}`, docId, text, order }));
}
