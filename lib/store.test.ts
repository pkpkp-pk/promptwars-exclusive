import { afterEach, describe, expect, it } from "vitest";
import { clearDocuments, getClauses, getDocument, saveDocument } from "./store";
import type { Clause, Document } from "./types";

afterEach(() => {
  clearDocuments();
});

describe("document store", () => {
  it("stores and returns a document and its clauses", () => {
    const document: Document = {
      id: "d1",
      filename: "lease.pdf",
      rawText: "1. Alpha.",
      uploadedAt: "2026-09-19T00:00:00.000Z",
    };
    const clauses: Clause[] = [{ id: "d1-c0", docId: "d1", text: "1. Alpha.", order: 0 }];

    saveDocument(document, clauses);

    expect(getDocument("d1")).toEqual(document);
    expect(getClauses("d1")).toEqual(clauses);
  });

  it("returns undefined for unknown document ids", () => {
    expect(getDocument("missing")).toBeUndefined();
    expect(getClauses("missing")).toBeUndefined();
  });
});
