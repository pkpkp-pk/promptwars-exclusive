import type { Clause } from "@/lib/types";

/*
 * Deterministic clause segmentation (Phases 1–2). Splits on numbered clause
 * markers; otherwise falls back to blank-line paragraphs, with short ALL-CAPS
 * heading paragraphs (RENT, PAYMENT TERMS, DATA SHARING, …) merged into the
 * paragraph that follows them so headings never stand alone as clauses.
 * Numbering is the stronger signal, so a document that numbers its clauses is
 * always split on the numbers.
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

/*
 * Real-world post-pass bounds (found by testing public deed templates):
 * blank-fill deeds (e.g. state govt rent-deed forms) shatter into 1-40-char
 * fragments on the paragraph fallback — merge anything under
 * MIN_CLAUSE_CHARS into its neighbor. Dense indenture deeds produce the
 * opposite failure: a handful of multi-thousand-char blobs that citations
 * can't point into — split anything over MAX_CLAUSE_CHARS on line
 * boundaries. Both passes are pure text surgery; no content is dropped.
 */
const MIN_CLAUSE_CHARS = 40;
const MAX_CLAUSE_CHARS = 3000;

/** Split an oversized chunk at line boundaries, packing lines up to the cap. */
function splitLarge(chunk: string): string[] {
  if (chunk.length <= MAX_CLAUSE_CHARS) return [chunk];
  const parts: string[] = [];
  let current = "";
  for (const line of chunk.split("\n")) {
    if (current.length + line.length + 1 > MAX_CLAUSE_CHARS && current !== "") {
      parts.push(current);
      current = line;
    } else {
      current = current === "" ? line : `${current}\n${line}`;
    }
  }
  if (current !== "") parts.push(current);
  // Pathological single line over the cap: hard-slice rather than emit a blob.
  return parts.flatMap((part) => {
    if (part.length <= MAX_CLAUSE_CHARS) return [part];
    const slices: string[] = [];
    for (let i = 0; i < part.length; i += MAX_CLAUSE_CHARS) {
      slices.push(part.slice(i, i + MAX_CLAUSE_CHARS));
    }
    return slices;
  });
}

/** Fold undersized fragments into the previous chunk (or the next, for a leading fragment). */
function mergeSmall(chunks: string[]): string[] {
  const merged: string[] = [];
  for (const chunk of chunks) {
    if (chunk.trim().length < MIN_CLAUSE_CHARS && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  // Leading run of fragments merges forward into the first real clause.
  while (merged.length > 1 && merged[0]!.trim().length < MIN_CLAUSE_CHARS) {
    merged[1] = `${merged[0]}\n${merged[1]}`;
    merged.shift();
  }
  return merged;
}

export function segmentClauses(rawText: string, docId: string): Clause[] {
  const numbered = chunkByNumberedMarkers(rawText);
  // mergeSmall only applies to the paragraph fallback: fragmentary output is
  // a fallback failure mode (blank-fill forms), while a numbered document's
  // short clauses are real clauses that must not be merged away. splitLarge
  // runs on both paths — a numbered clause can still be a multi-page blob.
  const source =
    numbered.length > 0
      ? numbered.flatMap(splitLarge)
      : mergeSmall(mergeCapsHeadings(chunkByParagraphs(rawText)).flatMap(splitLarge));

  return source
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    // Collapse the source's hard line wraps (PDF page layout) into single
    // spaces so clause text is flowing prose, not visibly-wrapped lines.
    .map((text, order) => ({
      id: `${docId}-c${order}`,
      docId,
      text: text.replace(/\s+/g, " "),
      order,
    }));
}
