import { afterEach, describe, expect, it } from "vitest";
import {
  clearDocuments,
  getClauses,
  getDocument,
  saveDocument,
  updateClauses,
} from "./store";
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

  it("replaces the stored clauses when classification results come back", () => {
    const document: Document = {
      id: "d2",
      filename: "lease.pdf",
      rawText: "1. Alpha.\n2. Beta.",
      uploadedAt: "2026-09-19T00:00:00.000Z",
    };
    saveDocument(document, [
      { id: "d2-c0", docId: "d2", text: "1. Alpha.", order: 0 },
      { id: "d2-c1", docId: "d2", text: "2. Beta.", order: 1 },
    ]);

    updateClauses("d2", [
      {
        id: "d2-c0",
        docId: "d2",
        text: "1. Alpha.",
        order: 0,
        category: "rent",
        riskLevel: "standard",
        explanation: "Sets the monthly rent.",
      },
      {
        id: "d2-c1",
        docId: "d2",
        text: "2. Beta.",
        order: 1,
        category: "deposit",
        riskLevel: "risky",
        explanation: "Forfeits the deposit.",
      },
    ]);

    const stored = getClauses("d2");
    expect(stored?.map((clause) => clause.riskLevel)).toEqual(["standard", "risky"]);
    expect(getDocument("d2")).toEqual(document);
  });

  it("ignores clause updates for unknown documents", () => {
    expect(() =>
      updateClauses("missing", [{ id: "missing-c0", docId: "missing", text: "x", order: 0 }]),
    ).not.toThrow();
    expect(getDocument("missing")).toBeUndefined();
  });
});
